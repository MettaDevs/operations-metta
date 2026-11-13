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
                           tg.nama as procedure_tariff_price_group_name,
                           coalesce((select json_agg(j.jenis_bayar_id order by j.jenis_bayar_id)
                                     from sim_m_tipe_pasien_jenis_bayar j
                                     where j.tenant_id = t.tenant_id and j.tipe_pasien_id = t.id and j.deleted_at is null),
                                    '[]'::json) as payment_method_ids,
                           coalesce((select json_agg(o.jenis_bayar_id order by o.jenis_bayar_id)
                                     from sim_m_tipe_pasien_jenis_bayar_otomatis o
                                     where o.tenant_id = t.tenant_id and o.tipe_pasien_id = t.id and o.deleted_at is null),
                                    '[]'::json) as automatic_payment_method_ids,
                           t.version
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
    const paymentMethodIds = [...new Set(data?.payment_method_ids ?? [])];
    const automaticPaymentMethodIds = [
        ...new Set(data?.automatic_payment_method_ids ?? []),
    ];
    const settles = behaviors.includes('settles_automatically');
    if (!settles && automaticPaymentMethodIds.length)
        errors.automatic_payment_method_ids =
            'Jenis bayar otomatis hanya untuk tipe yang lunas otomatis di kasir.';
    if (settles && !automaticPaymentMethodIds.length)
        errors.automatic_payment_method_ids =
            'Pilih jenis bayar yang melunasi tagihan tipe ini.';
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
        payment_method_ids: paymentMethodIds,
        automatic_payment_method_ids: automaticPaymentMethodIds,
    };
}

type CheckedPatientType = ReturnType<typeof checked>;

// Jenis bayar kasir (Core) yang bisa dipilih kartu tipe pasien. Jenis bayar otomatis tidak boleh meminta isian kasir:
// tunai dihitung di laci, sedangkan merchan, nomor referensi, biaya tambahan, dan pihak bon diketik kasir saat membayar.
const paymentMethodSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    legal_entity_id: z.string(),
    legal_entity_name: z.string(),
    active: z.boolean(),
    settles_automatically: z.boolean(),
});
const paymentMethodSql = `select j.id, j.kode as code, j.nama as name, j.legal_entity_id, o.name as legal_entity_name,
                                 j.aktif as active,
                                 j.perilaku <> 'tunai' and not j.wajib_merchan and not j.wajib_referensi
                                     and not j.biaya_tambahan and j.pihak <> 'pilih_pihak' as settles_automatically
                          from jenis_bayar j
                          join organizations o on o.tenant_id = j.tenant_id and o.id = j.legal_entity_id
                          where j.tenant_id = $1 and j.deleted_at is null`;

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
            payment_methods: await this.db.rows(
                paymentMethodSchema,
                `${paymentMethodSql} order by o.name, j.urutan, j.kode`,
                [this.workspace.tenantId],
            ),
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

    // Jenis bayar khusus dan jenis bayar otomatis. Jenis bayar otomatis wajib aktif, tidak meminta isian kasir, paling
    // banyak satu per legal entity, dan boleh dipakai tipe ini: jenis bayar yang dikhususkan tipe lain harus ikut
    // dikhususkan tipe ini juga.
    private async checkedPaymentMethods(
        data: CheckedPatientType,
        typeId: string | null,
    ): Promise<void> {
        const ids = [
            ...data.payment_method_ids,
            ...data.automatic_payment_method_ids,
        ];
        const valid = ids.every((id) => lookupId(id) !== null);
        const known = new Map(
            (valid
                ? await this.db.rows(
                      paymentMethodSchema,
                      `${paymentMethodSql} and j.id = any($2::uuid[])`,
                      [this.workspace.tenantId, `{${ids.join(',')}}`],
                  )
                : []
            ).map((method) => [method.id, method]),
        );
        const errors: Record<string, string> = {};
        if (!data.payment_method_ids.every((id) => known.has(id)))
            errors.payment_method_ids = 'Pilih jenis bayar dari daftar.';
        const automatic = data.automatic_payment_method_ids.map((id) =>
            known.get(id),
        );
        const legalEntities = automatic.map(
            (method) => method?.legal_entity_id,
        );
        const elsewhere = valid
            ? await this.db.rows(
                  z.object({ id: z.string() }),
                  `select distinct jenis_bayar_id as id from sim_m_tipe_pasien_jenis_bayar
                   where tenant_id = $1 and jenis_bayar_id = any($2::uuid[]) and deleted_at is null
                     and tipe_pasien_id is distinct from $3::uuid`,
                  [
                      this.workspace.tenantId,
                      `{${data.automatic_payment_method_ids.join(',')}}`,
                      typeId,
                  ],
              )
            : [];
        if (
            automatic.some(
                (method) => !method?.active || !method.settles_automatically,
            )
        )
            errors.automatic_payment_method_ids =
                'Pilih jenis bayar aktif yang tidak meminta isian kasir, misalnya bukan tunai atau kartu.';
        else if (new Set(legalEntities).size !== legalEntities.length)
            errors.automatic_payment_method_ids =
                'Pilih paling banyak satu jenis bayar otomatis per legal entity.';
        else if (
            elsewhere.some(
                (method) => !data.payment_method_ids.includes(method.id),
            )
        )
            errors.automatic_payment_method_ids =
                'Jenis bayar ini khusus tipe pasien lain. Tambahkan juga ke Jenis bayar khusus tipe ini.';
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
        await this.checkedPaymentMethods(data, null);
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
                await this.writePaymentMethods(id, data);
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
        await this.checkedPaymentMethods(data, current.id);
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
                if (updated) {
                    await this.writeBehaviors(current.id, data.behaviors);
                    await this.writePaymentMethods(current.id, data);
                }
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

    // Jenis bayar khusus dan otomatis tipe ini: yang tidak dipilih lagi diarsipkan, yang baru ditambah.
    private async writePaymentMethods(
        typeId: string,
        data: CheckedPatientType,
    ): Promise<void> {
        const stamp = nowSql();
        for (const [table, ids] of [
            ['sim_m_tipe_pasien_jenis_bayar', data.payment_method_ids],
            [
                'sim_m_tipe_pasien_jenis_bayar_otomatis',
                data.automatic_payment_method_ids,
            ],
        ] as const) {
            await this.db.execute(
                `update ${table} set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and tipe_pasien_id = $3 and deleted_at is null
                   and not (jenis_bayar_id = any($4::uuid[]))`,
                [stamp, this.workspace.tenantId, typeId, `{${ids.join(',')}}`],
            );
            for (const id of ids)
                await this.db.execute(
                    `insert into ${table} (id, tenant_id, tipe_pasien_id, jenis_bayar_id, created_at, updated_at)
                     select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamp, $5::timestamp
                     where not exists (select 1 from ${table} where tenant_id = $2 and tipe_pasien_id = $3
                                       and jenis_bayar_id = $4 and deleted_at is null)`,
                    [
                        Bun.randomUUIDv7(),
                        this.workspace.tenantId,
                        typeId,
                        id,
                        stamp,
                    ],
                );
        }
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
