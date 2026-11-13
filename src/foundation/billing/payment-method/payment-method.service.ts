import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    isReferenced,
    nowSql,
    sqlErrorCode,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { localCurrencyCode } from '../../currency/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import {
    behaviorRule,
    isPaymentMethodBehavior,
    isPaymentMethodParty,
    paymentMethodOptionFields,
} from './payment-method.behaviors.ts';
import { planLegacyImport } from './payment-method.legacy.ts';
import {
    legacyImportInputSchema,
    paymentMethodInputSchema,
    paymentMethodRowSchema,
} from './payment-method.schema.ts';

const rowSql = `select * from (
                    select j.id, j.kode as code, j.nama as name, j.label_kasir as cashier_label, j.urutan as sort_order,
                           j.perilaku as behavior, j.pihak as party, j.wajib_merchan as requires_merchant,
                           j.wajib_referensi as requires_reference, j.biaya_tambahan as allows_surcharge,
                           j.menampung_sisa as takes_remainder, j.dihitung_tutup_kas as counted_at_close,
                           j.tampil_di_kasir as shown_at_cashier, j.aktif as is_active,
                           j.mata_uang as currency_code, j.id_bayar_lama as legacy_id, j.version
                    from jenis_bayar j
                    where j.tenant_id = $1 and j.legal_entity_id = $2 and j.deleted_at is null) methods
                where true`;

function checked(body: unknown) {
    const parsed = paymentMethodInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim().toUpperCase() ?? '';
    const name = data?.name.trim() ?? '';
    const label = data?.cashier_label?.trim() ?? '';
    if (!code) errors.code = 'Isi kode jenis bayar.';
    else if (code.length > 20)
        errors.code = 'Kode jenis bayar paling banyak 20 karakter.';
    if (!name) errors.name = 'Isi nama jenis bayar.';
    else if (name.length > 100)
        errors.name = 'Nama jenis bayar paling banyak 100 karakter.';
    if (label.length > 100)
        errors.cashier_label = 'Label di kasir paling banyak 100 karakter.';
    const raw = data?.sort_order;
    // Tanpa isian berarti 0; isian kosong dari layar ditolak, karena Number('') bernilai 0.
    const sortOrder =
        raw === undefined ? 0 : String(raw).trim() ? Number(raw) : Number.NaN;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi bilangan bulat 0 sampai 999.';
    const behavior =
        data && isPaymentMethodBehavior(data.behavior) ? data.behavior : null;
    if (behavior === null) errors.behavior = 'Pilih perilaku dari daftar.';
    const rule = behavior === null ? null : behaviorRule(behavior);
    const party = data?.party ?? rule?.parties[0] ?? '';
    if (rule && !(isPaymentMethodParty(party) && rule.parties.includes(party)))
        errors.party = 'Pilih pihak dari daftar.';
    const options: Record<string, boolean> = {};
    for (const { option, column } of paymentMethodOptionFields) {
        const on = data?.[option] ?? false;
        if (on && rule && !rule.options.includes(option))
            errors[option] =
                `Tidak berlaku untuk perilaku ${rule.label.toLowerCase()}.`;
        options[column] = on;
    }
    const currency = data?.currency_code?.trim().toUpperCase() || null;
    if (currency && options.menampung_sisa)
        errors.currency_code =
            'Jenis bayar yang menampung sisa selalu memakai mata uang lokal.';
    if (Object.keys(errors).length || !data || behavior === null)
        validation(errors);
    return {
        kode: code,
        nama: name,
        label_kasir: label || null,
        urutan: sortOrder,
        perilaku: behavior,
        pihak: party,
        ...options,
        tampil_di_kasir: data.shown_at_cashier ?? true,
        aktif: data.is_active ?? true,
        mata_uang: currency,
    };
}

// Pelanggaran indeks unik menjadi pesan per isian, juga saat dua admin menyimpan bersamaan.
function uniqueTaken(error: unknown): void {
    if (sqlErrorCode(error) !== '23505' || !(error instanceof Error)) return;
    if (error.message.includes('jenis_bayar_kode_unique'))
        validation({ code: 'Kode ini sudah dipakai jenis bayar lain.' });
    if (error.message.includes('jenis_bayar_tunai_unique'))
        validation({
            behavior:
                'Legal entity ini sudah punya jenis bayar tunai aktif untuk mata uang ini. Nonaktifkan yang lama lebih dulu.',
        });
    if (error.message.includes('jenis_bayar_menampung_sisa_unique'))
        validation({
            takes_remainder:
                'Sudah ada jenis bayar aktif yang menampung sisa. Matikan isian itu di jenis bayar yang lama lebih dulu.',
        });
}

// Jenis bayar milik legal entity aktif. Layar kasir membaca daftar ini, jadi menambah jenis bayar tidak mengubah kode.
export class PaymentMethods {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dibaca sesudah izin diperiksa, supaya anggota tanpa izin mendapat 403, bukan permintaan memilih legal entity.
    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    // Mata uang asing yang sudah disetel di Sys Admin › Mata uang, pilihan isian Mata uang.
    private async foreignCurrencies(): Promise<string[]> {
        return (
            await this.db.rows(
                z.object({ currency_code: z.string() }),
                `select currency_code from currency_precisions
                 where tenant_id = $1 and currency_code <> $2 order by currency_code`,
                [this.workspace.tenantId, localCurrencyCode],
            )
        ).map((row) => row.currency_code);
    }

    private async checkedCurrency(currency: string | null): Promise<void> {
        if (currency && !(await this.foreignCurrencies()).includes(currency))
            validation({
                currency_code:
                    'Pilih mata uang asing yang sudah disetel di Sys Admin › Mata uang, atau kosongkan untuk mata uang lokal.',
            });
    }

    // `active=1` hanya jenis bayar yang aktif.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('payment-method', 'read');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: {
                sort_order: 'sort_order',
                code: 'code',
                name: 'name',
            },
            searchColumns: ['code', 'name', 'cashier_label'],
            numericColumns: ['sort_order'],
            defaultSort: 'sort_order',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => paymentMethodRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.payment-method.update',
            ),
            local_currency: localCurrencyCode,
            currencies: await this.foreignCurrencies(),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  paymentMethodRowSchema,
                  `${rowSql} and methods.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('payment-method', 'update');
        const data = checked(body);
        await this.checkedCurrency(data.mata_uang);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('jenis_bayar', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                ...data,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            uniqueTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('payment-method', 'update');
        const current = await this.row(id);
        const data = checked(body);
        await this.checkedCurrency(data.mata_uang);
        // Clerk End menjumlah jumlah valuta per jenis bayar, jadi satu jenis bayar hanya pernah memegang satu mata uang.
        if (
            (current.currency_code ?? null) !== data.mata_uang &&
            (await isReferenced(this.db, 'jenis_bayar', {
                tenantId: this.scope.tenantId,
                id: current.id,
            }))
        )
            validation({
                currency_code:
                    'Jenis bayar ini sudah dipakai, jadi mata uangnya tidak bisa diubah. Buat jenis bayar baru untuk mata uang lain.',
            });
        let updated = 0;
        try {
            const columns = Object.entries(data);
            updated = await this.db.execute(
                `update jenis_bayar
                 set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where tenant_id = $${columns.length + 2} and legal_entity_id = $${columns.length + 3}
                   and id = $${columns.length + 4} and version = $${columns.length + 5} and deleted_at is null`,
                [
                    ...columns.map(([, value]) => value),
                    nowSql(),
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            uniqueTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('payment-method', 'update');
        const current = await this.row(id);
        if (
            await isReferenced(this.db, 'jenis_bayar', {
                tenantId: this.scope.tenantId,
                id: current.id,
            })
        )
            validation({
                _form: 'Jenis bayar ini sudah dipakai, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipakai di pembayaran baru.',
            });
        const deleted = await this.db.execute(
            `update jenis_bayar set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and legal_entity_id = $3 and id = $4 and version = $5 and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                this.scope.legalEntityId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }

    // Impor mJenisBayar sistem lama ke legal entity aktif dalam satu transaksi. Baris yang tidak bisa diimpor dilaporkan
    // dengan alasannya dan tidak menghentikan baris lain.
    async importLegacy(body: unknown) {
        this.workspace.guard('payment-method', 'update');
        const parsed = legacyImportInputSchema.safeParse(body);
        if (!parsed.success)
            validation({
                rows: 'Tempel hasil SELECT mJenisBayar dalam bentuk JSON: daftar baris dengan IDBayar, Description, NoUrut, Kode, dan flag-nya.',
            });
        const plans = await this.db.transaction(async () => {
            const existing = await this.db.rows(
                z.object({
                    kode: z.string(),
                    id_bayar_lama: z.number().nullable(),
                    tunai_aktif: z.boolean(),
                    sisa_aktif: z.boolean(),
                }),
                `select kode, id_bayar_lama, perilaku = 'tunai' and aktif as tunai_aktif,
                        menampung_sisa and aktif as sisa_aktif
                 from jenis_bayar
                 where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null
                 for update`,
                [this.scope.tenantId, this.scope.legalEntityId],
            );
            const planned = planLegacyImport(parsed.data.rows, {
                codes: new Set(existing.map((row) => row.kode)),
                imported: new Map(
                    existing.flatMap((row) =>
                        row.id_bayar_lama === null
                            ? []
                            : [[row.id_bayar_lama, row.kode] as const],
                    ),
                ),
                activeCash: existing.some((row) => row.tunai_aktif),
                activeRemainder: existing.some((row) => row.sisa_aktif),
            });
            const stamp = nowSql();
            for (const plan of planned)
                if (plan.draft)
                    await this.db.insert('jenis_bayar', {
                        id: Bun.randomUUIDv7(),
                        tenant_id: this.scope.tenantId,
                        legal_entity_id: this.scope.legalEntityId,
                        ...plan.draft,
                        created_at: stamp,
                        updated_at: stamp,
                    });
            return planned;
        });
        return {
            data: plans.map((plan) => ({
                legacy_id: plan.legacyId,
                legacy_name: plan.legacyName,
                imported: plan.draft !== null,
                code: plan.draft?.kode ?? null,
                behavior: plan.draft?.perilaku ?? null,
                notes: plan.notes,
            })),
        };
    }
}
