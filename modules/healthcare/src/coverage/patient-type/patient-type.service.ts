import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
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
    patientTypeInputSchema,
    patientTypeRowSchema,
} from './patient-type.schema.ts';
import { isProcedureTariff } from '../../clinical/procedure/procedure-price.options.ts';
import {
    isPatientTypeBehavior,
    type PatientTypeBehavior,
} from './patient-type.behaviors.ts';

const rowSql = `select * from (
                    select t.id, t.kode as code, t.nama as name, coalesce((select json_agg(b.perilaku order by b.perilaku) from sim_m_tipe_pasien_perilaku b
                         where b.tenant_id = t.tenant_id and b.tipe_pasien_id = t.id and b.deleted_at is null),
                        '[]'::json) as behaviors,
                           t.aktif as is_active, t.bawaan as is_default,
                           t.maks_kunjungan_per_poli_per_hari as max_visits_per_section_per_day,
                           t.kelompok_harga_id as price_group_id, g.nama as price_group_name,
                           t.tarif_jasa as procedure_tariff,
                           t.kelompok_harga_tarif_id as procedure_tariff_price_group_id,
                           tg.nama as procedure_tariff_price_group_name, t.version
                    from sim_m_tipe_pasien t
                    left join kelompok_harga g on g.tenant_id = t.tenant_id and g.id = t.kelompok_harga_id
                    left join kelompok_harga tg on tg.tenant_id = t.tenant_id and tg.id = t.kelompok_harga_tarif_id
                    where t.tenant_id = $1 and t.deleted_at is null) patient_types
                where true`;

function checked(body: unknown) {
    const parsed = patientTypeInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    if (!code) errors.code = 'Isi kode tipe pasien.';
    else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
    if (!name) errors.name = 'Isi nama tipe pasien.';
    else if (name.length > 100) errors.name = 'Paling panjang 100 karakter.';
    const behaviors = [...new Set(data?.behaviors ?? [])];
    if (!behaviors.every(isPatientTypeBehavior))
        errors.behaviors = 'Pilih perilaku dari daftar.';
    const rawLimit = data?.max_visits_per_section_per_day;
    // Tanpa isian berarti tanpa batas; isian kosong dari layar ditolak, karena Number('') bernilai 0.
    const visitLimit =
        rawLimit === undefined
            ? 0
            : String(rawLimit).trim()
              ? Number(rawLimit)
              : Number.NaN;
    if (!Number.isInteger(visitLimit) || visitLimit < 0 || visitLimit > 999)
        errors.max_visits_per_section_per_day =
            'Isi bilangan bulat 0 sampai 999. Isi 0 bila tidak dibatasi.';
    // Tanpa isian berarti tarif umum, bawaan tipe pasien sejak 0035.
    const rawTariff = data?.procedure_tariff ?? 'general';
    const procedureTariff = isProcedureTariff(rawTariff) ? rawTariff : null;
    if (procedureTariff === null)
        errors.procedure_tariff = 'Pilih tarif jasa dari daftar.';
    if (Object.keys(errors).length || !data || procedureTariff === null)
        validation(errors);
    return {
        code,
        name,
        behaviors: behaviors.filter(isPatientTypeBehavior),
        is_active: data.is_active ?? true,
        is_default: data.is_default ?? false,
        max_visits_per_section_per_day: visitLimit,
        price_group_id: data.price_group_id?.trim() ?? null,
        procedure_tariff: procedureTariff,
        procedure_tariff_price_group_id:
            data.procedure_tariff_price_group_id?.trim() || null,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_tipe_pasien_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai tipe pasien lain.' });
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_tipe_pasien_bawaan_unique')
    )
        validation({
            is_default:
                'Tipe pasien lain baru saja dijadikan bawaan. Muat ulang, lalu coba lagi.',
        });
}

// Tipe pasien milik tenant, diisi admin. Perilakunya dibaca dari sim_m_tipe_pasien_perilaku, tidak dari nama atau id.
// memakai_penjamin (0001) tetap ditulis sama dengan perilaku requires_guarantor untuk kode rilis sebelumnya.
export class PatientTypes {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Pilihan kelompok harga untuk kartu tipe pasien. Kelompok nonaktif ikut, supaya tipe yang sudah memegangnya tetap
    // terbaca namanya.
    async metadata() {
        this.workspace.guard('patient-type', 'read');
        return {
            price_groups: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as active from kelompok_harga
                 where tenant_id = $1 and deleted_at is null order by kode`,
                [this.workspace.tenantId],
            ),
        };
    }

    // Kelompok harga dan kelompok harga tarif jasa. Kelompok nonaktif hanya boleh tetap dipakai tipe yang sudah
    // memegangnya di isian yang sama.
    private async checkedPriceGroups(
        data: {
            price_group_id: string | null;
            procedure_tariff_price_group_id: string | null;
        },
        saved: z.infer<typeof patientTypeRowSchema> | null,
    ): Promise<void> {
        const errors: Record<string, string> = {};
        // Teks kosong berarti saklar kelompok harga dinyalakan tanpa memilih kelompok.
        if (data.price_group_id === '')
            errors.price_group_id = 'Pilih kelompok harga.';
        else if (
            !(await this.choosable(
                data.price_group_id,
                saved?.price_group_id ?? null,
            ))
        )
            errors.price_group_id = 'Pilih dari daftar.';
        if (
            !(await this.choosable(
                data.procedure_tariff_price_group_id,
                saved?.procedure_tariff_price_group_id ?? null,
            ))
        )
            errors.procedure_tariff_price_group_id = 'Pilih dari daftar.';
        if (Object.keys(errors).length) validation(errors);
    }

    private async choosable(
        priceGroupId: string | null,
        savedPriceGroupId: string | null,
    ): Promise<boolean> {
        if (priceGroupId === null) return true;
        return (
            lookupId(priceGroupId) !== null &&
            (await this.db.one(
                z.object({ id: z.string() }),
                `select id from kelompok_harga
                 where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                [this.workspace.tenantId, priceGroupId, savedPriceGroupId],
            )) !== undefined
        );
    }

    // Daftar bertahap, dipakai juga pilihan tipe pasien di form pasien, jadi pemegang izin lihat pasien ikut boleh
    // membacanya. `active=1` hanya tipe yang aktif.
    async list(parameters: URLSearchParams) {
        if (
            !this.workspace.permissions.has('healthcare.patient-type.read') &&
            !this.workspace.permissions.has('healthcare.patient.read')
        )
            abort(403, 'Tidak diizinkan.');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name', code: 'code' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => patientTypeRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'healthcare.patient-type.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  patientTypeRowSchema,
                  `${rowSql} and patient_types.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('patient-type', 'update');
        const data = checked(body);
        await this.checkedPriceGroups(data, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                if (data.is_default) await this.clearDefault(id);
                await this.db.insert('sim_m_tipe_pasien', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    kode: data.code,
                    nama: data.name,
                    memakai_penjamin:
                        data.behaviors.includes('requires_guarantor'),
                    aktif: data.is_active,
                    bawaan: data.is_default,
                    maks_kunjungan_per_poli_per_hari:
                        data.max_visits_per_section_per_day,
                    kelompok_harga_id: data.price_group_id,
                    tarif_jasa: data.procedure_tariff,
                    kelompok_harga_tarif_id:
                        data.procedure_tariff_price_group_id,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.writeBehaviors(id, data.behaviors);
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('patient-type', 'update');
        const current = await this.row(id);
        const data = checked(body);
        await this.checkedPriceGroups(data, current);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                if (data.is_default) await this.clearDefault(current.id);
                updated = await this.db.execute(
                    `update sim_m_tipe_pasien set kode = $1, nama = $2, memakai_penjamin = $3, aktif = $4, bawaan = $9,
                     maks_kunjungan_per_poli_per_hari = $10, kelompok_harga_id = $11, tarif_jasa = $12,
                     kelompok_harga_tarif_id = $13, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                    [
                        data.code,
                        data.name,
                        data.behaviors.includes('requires_guarantor'),
                        data.is_active,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                        data.is_default,
                        data.max_visits_per_section_per_day,
                        data.price_group_id,
                        data.procedure_tariff,
                        data.procedure_tariff_price_group_id,
                    ],
                );
                if (updated)
                    await this.writeBehaviors(current.id, data.behaviors);
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Menghapus berarti mengisi deleted_at. Cara bayar pasien yang sudah memakainya tetap menunjuk barisnya.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('patient-type', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update sim_m_tipe_pasien set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
            [
                stamp,
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }

    // Tipe bawaan berpindah: tipe lain yang masih bawaan dilepas tandanya di transaksi yang sama. Indeks unik parsial
    // sim_m_tipe_pasien_bawaan_unique tetap menjaga paling banyak satu bawaan bila dua admin menyimpan bersamaan.
    private async clearDefault(keepId: string): Promise<void> {
        await this.db.execute(
            'update sim_m_tipe_pasien set bawaan = false, updated_at = $1 where tenant_id = $2 and bawaan and id <> $3 and deleted_at is null',
            [nowSql(), this.workspace.tenantId, keepId],
        );
    }

    // Perilaku yang dinyalakan tipe ini: yang tidak dipilih lagi diarsipkan, yang baru ditambah.
    private async writeBehaviors(
        typeId: string,
        behaviors: PatientTypeBehavior[],
    ): Promise<void> {
        const stamp = nowSql();
        const bindings = [stamp, this.workspace.tenantId, typeId, ...behaviors];
        await this.db.execute(
            `update sim_m_tipe_pasien_perilaku set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and tipe_pasien_id = $3 and deleted_at is null
             ${behaviors.length ? `and perilaku not in (${behaviors.map((_, index) => `$${index + 4}`).join(',')})` : ''}`,
            bindings,
        );
        for (const behavior of behaviors)
            await this.db.execute(
                `insert into sim_m_tipe_pasien_perilaku (id, tenant_id, tipe_pasien_id, perilaku, created_at, updated_at)
                 select $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::timestamp, $5::timestamp
                 where not exists (select 1 from sim_m_tipe_pasien_perilaku where tenant_id = $2 and tipe_pasien_id = $3
                                   and perilaku = $4::varchar and deleted_at is null)`,
                [
                    Bun.randomUUIDv7(),
                    this.workspace.tenantId,
                    typeId,
                    behavior,
                    stamp,
                ],
            );
    }
}
