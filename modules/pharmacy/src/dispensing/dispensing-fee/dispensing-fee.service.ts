import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    isoSql,
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
} from '@core/foundation/inventory/index.ts';
import {
    amountInput,
    Currency,
    decimalsHint,
    localCurrencyCode,
} from '@core/foundation/currency/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import type { ChargeFee } from '@core/foundation/billing/index.ts';
import { priceGroupAvailable } from '../otc-sale-location/otc-sale-location.service.ts';
import {
    billedFeeSchema,
    dispensingFeeInputSchema,
    dispensingFeeRowSchema,
    feeKindSchema,
    type BilledFee,
    type FeeKind,
} from './dispensing-fee.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

// Kode baris tagihan kasir, sama dengan Kode baris racikan BILLFarmasiDetail sistem lama.
const feeCodes: Record<FeeKind, string> = { racik: 'RACIKAN', resep: 'RESEP' };

const rowSql = `select * from (
                    select m.id, m.jenis as kind, m.version, trim_scale(m.nilai)::text as amount,
                           coalesce(l.kode, '') as location_code, coalesce(g.kode, '') as price_group_code,
                           case when l.id is null then null
                                else json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) end as location,
                           case when g.id is null then null
                                else json_build_object('id', g.id, 'code', g.kode, 'name', g.nama) end as price_group
                    from far_m_biaya_pelayanan m
                    left join gd_m_lokasi l on l.tenant_id = m.tenant_id and l.id = m.lokasi_id
                    left join kelompok_harga g on g.tenant_id = m.tenant_id and g.id = m.kelompok_harga_id
                    where m.tenant_id = $1 and m.legal_entity_id = $2 and m.deleted_at is null) dispensing_fees
                where true`;

type Rate = { setupId: string; amount: string };
export type FeeRates = Record<FeeKind, Rate | null>;

// Nilai biaya racik dan resep yang berlaku untuk satu lokasi dan kelompok harga. Baris yang paling khusus menang:
// kelompok harga yang cocok lebih dulu, lalu lokasi yang cocok. Tanpa baris, jenis itu bernilai null (tidak ditagih).
export async function feeRates(
    db: Database,
    scope: Scope,
    target: { locationId: string; priceGroupId: string | null },
): Promise<FeeRates> {
    const rows = await db.rows(
        z.object({ id: z.string(), kind: feeKindSchema, amount: z.string() }),
        `select distinct on (jenis) id, jenis as kind, trim_scale(nilai)::text as amount
         from far_m_biaya_pelayanan
         where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null
           and (lokasi_id = $3 or lokasi_id is null)
           and (kelompok_harga_id = $4::uuid or kelompok_harga_id is null)
         order by jenis, kelompok_harga_id is null, lokasi_id is null`,
        [
            scope.tenantId,
            scope.legalEntityId,
            target.locationId,
            target.priceGroupId,
        ],
    );
    const rate = (kind: FeeKind): Rate | null => {
        const row = rows.find((candidate) => candidate.kind === kind);
        return row && Decimal.of(row.amount).compare(Decimal.of('0')) > 0
            ? { setupId: row.id, amount: row.amount }
            : null;
    };
    return { racik: rate('racik'), resep: rate('resep') };
}

// Baris obat yang menentukan biaya: compound adalah nomor racikan, null untuk obat tunggal. Hanya baris yang benar-benar
// diserahkan (jumlah lebih dari 0) yang dihitung.
export type FeeBasis = { lineId: string; compound: number | null };

export type PlannedFee = {
    kind: FeeKind;
    lineId: string | null;
    compound: number | null;
    setupId: string;
    amount: string;
};

// Satu biaya racik per racikan, dan satu biaya resep per obat tunggal kecuali penjualan tanpa resep. Keduanya tidak
// dikali jumlah (details.php sistem lama).
export function plannedFees(
    rates: FeeRates,
    lines: FeeBasis[],
    withoutPrescription: boolean,
): PlannedFee[] {
    const fees: PlannedFee[] = [];
    const compounds = new Set<number>();
    for (const line of lines) {
        if (line.compound !== null) {
            if (rates.racik && !compounds.has(line.compound)) {
                compounds.add(line.compound);
                fees.push({
                    kind: 'racik',
                    lineId: null,
                    compound: line.compound,
                    ...rates.racik,
                });
            }
        } else if (rates.resep && !withoutPrescription)
            fees.push({
                kind: 'resep',
                lineId: line.lineId,
                compound: null,
                ...rates.resep,
            });
    }
    return fees;
}

// Nilai biaya yang diketik pemegang izin ubah harga, bila berbeda dengan nilai dari setelan (amount).
export type FeeOverride = { amount: string; userId: string; reason: string };

export async function freezeFees(
    db: Database,
    scope: Scope,
    billId: string,
    fees: (PlannedFee & { override?: FeeOverride })[],
): Promise<void> {
    const stamp = nowSql();
    for (const fee of fees)
        await db.insert('bill_farmasi_biaya', {
            id: Bun.randomUUIDv7(),
            tenant_id: scope.tenantId,
            legal_entity_id: scope.legalEntityId,
            bill_farmasi_id: billId,
            jenis: fee.kind,
            bill_farmasi_detail_id: fee.lineId,
            racikan_ke: fee.compound,
            biaya_pelayanan_id: fee.setupId,
            nilai: fee.override?.amount ?? fee.amount,
            nilai_hitung: fee.amount,
            nilai_diubah_pada: fee.override ? stamp : null,
            nilai_diubah_oleh_user_id: fee.override?.userId ?? null,
            alasan_ubah_nilai: fee.override?.reason ?? null,
            created_at: stamp,
            updated_at: stamp,
        });
}

export const feeName = (
    kind: FeeKind,
    subject: { compound: number | null; itemName: string | null },
) =>
    kind === 'racik'
        ? `Biaya racik Racikan ${String(subject.compound ?? '')}`
        : `Biaya resep ${subject.itemName ?? ''}`;

// Biaya yang dibekukan untuk penyerahan atau penjualan. keptLineIds adalah baris obat yang masih ditagih sesudah
// retur: biaya resep obat yang habis diretur tidak ditagih lagi, biaya racik tetap.
export async function billedFees(
    db: Database,
    tenantId: string,
    dispensingIds: string[],
    keptLineIds: Set<string>,
): Promise<(BilledFee & { dispensing_id: string })[]> {
    if (!dispensingIds.length) return [];
    const rows = await db.rows(
        billedFeeSchema.omit({ name: true }).extend({
            dispensing_id: z.string(),
            line_id: z.string().nullable(),
            compound: z.number().nullable(),
            item_name: z.string().nullable(),
        }),
        `select f.id, f.bill_farmasi_id as dispensing_id, f.jenis as kind, f.biaya_pelayanan_id as setup_id,
                f.bill_farmasi_detail_id as line_id, f.racikan_ke as compound, b.nama as item_name,
                trim_scale(f.nilai)::text as amount, trim_scale(f.nilai_hitung)::text as computed_amount,
                case when f.nilai_diubah_pada is null then null else json_build_object(
                    'by', u.name, 'at', ${isoSql('f.nilai_diubah_pada')}, 'reason', f.alasan_ubah_nilai) end as changed
         from bill_farmasi_biaya f
         left join users u on u.id = f.nilai_diubah_oleh_user_id
         left join bill_farmasi_detail d on d.tenant_id = f.tenant_id and d.id = f.bill_farmasi_detail_id
         left join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
         where f.tenant_id = $1 and f.bill_farmasi_id = any($2::uuid[]) and f.deleted_at is null
         order by f.bill_farmasi_id, f.jenis, coalesce(d.urutan, f.racikan_ke), f.id`,
        [tenantId, `{${dispensingIds.join(',')}}`],
    );
    return rows
        .filter((row) => row.line_id === null || keptLineIds.has(row.line_id))
        .map((row) => ({
            id: row.id,
            dispensing_id: row.dispensing_id,
            kind: row.kind,
            setup_id: row.setup_id,
            name: feeName(row.kind, {
                compound: row.compound,
                itemName: row.item_name,
            }),
            amount: row.amount,
            computed_amount: row.computed_amount,
            changed: row.changed,
        }));
}

// Baris tagihan kasir untuk biaya yang ditagih. Biaya yang diubah menjadi 0 tidak ditagih, sama dengan setelan bernilai 0.
export const chargeFees = (fees: BilledFee[]): ChargeFee[] =>
    fees
        .filter((fee) => Decimal.of(fee.amount).compare(Decimal.of('0')) > 0)
        .map((fee) => ({
            line_id: fee.id,
            fee_id: fee.setup_id,
            code: feeCodes[fee.kind],
            name: fee.name,
            amount: fee.amount,
        }));

const messages = {
    kind: 'Pilih jenis biaya.',
    location_id: 'Pilih lokasi dari daftar.',
    price_group_id: 'Pilih kelompok harga dari daftar.',
};

// Setelan Biaya racik dan resep: nilai per legal entity, boleh dipersempit ke lokasi stok dan kelompok harga.
export class DispensingFees {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('dispensing-fee', 'read');
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: {
                kind: 'kind',
                location: 'location_code',
                price_group: 'price_group_code',
                amount: 'amount',
            },
            searchColumns: [
                'location_code',
                "location->>'name'",
                'price_group_code',
                "price_group->>'name'",
            ],
            numericColumns: ['amount'],
            defaultSort: 'kind',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => dispensingFeeRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'pharmacy.dispensing-fee.update',
            ),
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(
                  dispensingFeeRowSchema,
                  `${rowSql} and dispensing_fees.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(
        body: unknown,
        current: z.infer<typeof dispensingFeeRowSchema> | null,
    ) {
        const data = parseInput(dispensingFeeInputSchema, body, messages);
        const scope = this.scope;
        const errors: Record<string, string> = {};
        const kind = feeKindSchema.safeParse(data.kind);
        if (!kind.success) errors.kind = messages.kind;
        const locationId = data.location_id || null;
        if (
            locationId !== null &&
            locationId !== current?.location?.id &&
            !(lookupId(locationId)
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from gd_m_lokasi
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                         and not transit`,
                      [scope.tenantId, scope.legalEntityId, locationId],
                  )
                : undefined)
        )
            errors.location_id = messages.location_id;
        const priceGroupId = data.price_group_id || null;
        if (
            priceGroupId !== null &&
            !(await priceGroupAvailable(
                this.db,
                scope.tenantId,
                priceGroupId,
                current?.price_group?.id ?? null,
            ))
        )
            errors.price_group_id = messages.price_group_id;
        const { amount_decimals: decimals } = await new Currency(
            this.db,
            scope.tenantId,
        ).precision(localCurrencyCode);
        const amount = amountInput(data.amount, decimals);
        if (amount === null)
            errors.amount = `Isi nilai 0 atau lebih, ${decimalsHint(decimals)}.`;
        if (Object.keys(errors).length || !kind.success || amount === null)
            validation(errors);
        return { kind: kind.data, locationId, priceGroupId, amount };
    }

    private taken(error: unknown): never {
        if (
            sqlErrorCode(error) === '23505' &&
            error instanceof Error &&
            error.message.includes('far_m_biaya_pelayanan_kunci_unique')
        )
            validation({
                kind: 'Biaya ini sudah diatur untuk lokasi dan kelompok harga yang sama. Ubah baris yang ada.',
            });
        throw error;
    }

    async create(body: unknown) {
        this.workspace.guard('dispensing-fee', 'update');
        const data = await this.checked(body, null);
        const scope = this.scope;
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('far_m_biaya_pelayanan', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                jenis: data.kind,
                lokasi_id: data.locationId,
                kelompok_harga_id: data.priceGroupId,
                nilai: data.amount,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.taken(error);
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Nilai baru berlaku untuk resep yang disiapkan dan penjualan yang disimpan sesudahnya; biaya yang sudah dibekukan
    // tidak berubah.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('dispensing-fee', 'update');
        const current = await this.row(id);
        const data = await this.checked(body, current);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update far_m_biaya_pelayanan
                 set jenis = $1, lokasi_id = $2, kelompok_harga_id = $3, nilai = $4, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                [
                    data.kind,
                    data.locationId,
                    data.priceGroupId,
                    data.amount,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    version,
                ],
            );
        } catch (error) {
            this.taken(error);
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(current.id) },
        };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('dispensing-fee', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            `update far_m_biaya_pelayanan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [stamp, this.scope.tenantId, current.id, version],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
