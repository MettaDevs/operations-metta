import { z } from 'zod';
import type { Bind, Database } from '@core/platform/database/index.ts';
import { dateSchema, lookupId } from '@core/platform/http/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
    unitAmountStorageDecimals,
} from '@core/foundation/currency/index.ts';
import {
    Decimal,
    decimalsHint,
    percentScale,
} from '@core/platform/money/index.ts';
import {
    lookupProcedurePrice,
    type ChosenPrice,
    type TariffStep,
} from './procedure-price.lookup.ts';
import {
    componentNumberFields,
    isPriceLocation,
    isProcedureTariff,
    priceNumberFields,
    priceSumFields,
    type PriceLocation,
    type PriceNumberKind,
    type ProcedureTariff,
} from './procedure-price.options.ts';
import {
    procedurePriceInputSchema,
    procedurePriceRowSchema,
} from './procedure-price.schema.ts';

export type ProcedurePrice = z.infer<typeof procedurePriceRowSchema>;
type Errors = Record<string, string>;
type Values = Record<string, Bind>;
export type CheckedPrice = {
    id: string | null;
    values: Values;
    components: Values[];
};

const numberText = (alias: string, column: string) =>
    `trim_scale(${alias}.${column})::text`;
const componentJson = Object.entries(componentNumberFields)
    .map(([field, { column }]) => `'${field}', ${numberText('c', column)}`)
    .join(', ');
const headerNumbers = Object.entries({
    ...priceNumberFields,
    ...priceSumFields,
})
    .map(([field, { column }]) => `${numberText('h', column)} as ${field}`)
    .join(', ');

const pricesSql = `
    select h.id, h.kelompok_harga_id as price_group_id, g.nama as price_group_name,
           h.kelas_id as care_class_id, k.nama as care_class_name,
           h.spesialisasi_id as specialty_id, s.nama as specialty_name, h.sub_spesialis as sub_specialty,
           h.nakes_id as doctor_id, p.name as doctor_name,
           h.kategori_operasi_id as operation_category_id, o.nama as operation_category_name,
           h.pasien_ktp as ktp_patient, h.cyto as cito, h.lokasi as location, ${headerNumbers},
           h.tgl_harga_baru::text as new_price_date, h.tgl_harga_baru_bpjs::text as new_bpjs_price_date,
           coalesce((select json_agg(json_build_object(
                                'charge_component_id', c.komponen_biaya_id, 'charge_component_code', b.kode,
                                'charge_component_name', b.nama, 'includes_incentive', c.include_insentif,
                                ${componentJson}) order by c.id)
                     from sim_m_tindakan_harga_komponen c
                     join komponen_biaya b on b.tenant_id = c.tenant_id and b.id = c.komponen_biaya_id
                     where c.tenant_id = h.tenant_id and c.tindakan_harga_id = h.id and c.deleted_at is null),
                    '[]'::json) as components
    from sim_m_tindakan_harga h
    join kelompok_harga g on g.tenant_id = h.tenant_id and g.id = h.kelompok_harga_id
    left join sim_m_kelas k on k.tenant_id = h.tenant_id and k.id = h.kelas_id
    left join sim_m_spesialisasi s on s.tenant_id = h.tenant_id and s.id = h.spesialisasi_id
    left join sim_m_nakes n on n.tenant_id = h.tenant_id and n.id = h.nakes_id
    left join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
    left join sim_m_kategori_operasi o on o.tenant_id = h.tenant_id and o.id = h.kategori_operasi_id
    where h.tenant_id = $1 and h.tindakan_id = $2 and h.deleted_at is null
    order by h.id`;

// Kunci baris harga yang dipilih dari master, dengan baris master yang boleh dipilih: yang masih ada, dan yang aktif
// kecuali sudah dipegang baris harga itu. Spesialis tidak punya status aktif. Dokter adalah nakes berprofesi Dokter /
// Tenaga Medis.
const priceKeys = {
    price_group_id: {
        column: 'kelompok_harga_id',
        label: 'kelompok harga',
        sql: `select id, aktif as active from kelompok_harga
              where tenant_id = $1 and deleted_at is null and id = any($2::uuid[])`,
    },
    care_class_id: {
        column: 'kelas_id',
        label: 'kelas',
        sql: `select id, aktif as active from sim_m_kelas
              where tenant_id = $1 and deleted_at is null and id = any($2::uuid[])`,
    },
    specialty_id: {
        column: 'spesialisasi_id',
        label: 'spesialis',
        sql: `select id, true as active from sim_m_spesialisasi
              where tenant_id = $1 and deleted_at is null and id = any($2::uuid[])`,
    },
    doctor_id: {
        column: 'nakes_id',
        label: 'dokter',
        sql: `select n.id, n.aktif and pr.isi_tenaga_medis as active
              from sim_m_nakes n
              join sim_m_profesi pr on pr.tenant_id = n.tenant_id and pr.id = n.profesi_id
              where n.tenant_id = $1 and n.deleted_at is null and n.id = any($2::uuid[])`,
    },
    operation_category_id: {
        column: 'kategori_operasi_id',
        label: 'kategori operasi',
        sql: `select id, aktif as active from sim_m_kategori_operasi
              where tenant_id = $1 and deleted_at is null and id = any($2::uuid[])`,
    },
} as const;
type PriceKey = keyof typeof priceKeys;
const priceKeyNames: PriceKey[] = keysOf(priceKeys);
const componentSql = `select id, aktif as active from komponen_biaya
                      where tenant_id = $1 and deleted_at is null and id = any($2::uuid[])`;

const choiceRow = z.object({ id: z.string(), active: z.boolean() });
const choice = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
});

const moneyLimit = Decimal.of('1000000000000000');
const numberLimit = Decimal.of('100000');
const zero = Decimal.of('0');

// Banyak angka di belakang koma per jenis isian: harga mengikuti presisi harga satuan mata uang tenant, sedangkan Qty dan
// persen komponen memakai satu skala persen. Semua disimpan dengan skala kolomnya, numeric(19,4) dan numeric(9,4).
type Scales = Record<PriceNumberKind, number>;
const columnScale = unitAmountStorageDecimals;

// Teks desimal berskala kolomnya, atau null bila bukan angka, lebih halus dari skalanya, atau di luar kolomnya. Kosong
// berarti 0, sama dengan sistem lama yang menyimpan isian kosong sebagai 0.
function decimal(
    raw: string | number | null | undefined,
    kind: PriceNumberKind,
    scales: Scales,
): string | null {
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (text === '') return zero.fixed(columnScale);
    let value: Decimal;
    try {
        value = Decimal.of(text);
    } catch {
        return null;
    }
    if (value.rounded(scales[kind]).compare(value) !== 0) return null;
    const outside =
        kind === 'money'
            ? value.compare(zero) < 0 || value.compare(moneyLimit) >= 0
            : value.compare(numberLimit) >= 0 ||
              value.compare(zero.minus(numberLimit)) <= 0;
    return outside ? null : value.fixed(columnScale);
}

const invalidNumber = (kind: PriceNumberKind, scales: Scales) =>
    kind === 'money'
        ? `diisi angka 0 atau lebih, ${decimalsHint(scales.money)}.`
        : `diisi angka, ${decimalsHint(scales.number)}.`;

// Baris harga hidup tindakan untuk pencarian tarif, urutan id uuidv7 (urutan dibuat), padanan ListHargaID.
const candidatesSql = `
    select id, kelompok_harga_id as "priceGroupId", kelas_id as "careClassId", spesialisasi_id as "specialtyId",
           nakes_id as "doctorId", kategori_operasi_id as "operationCategoryId", pasien_ktp as "ktpPatient",
           cyto as cito, lokasi as location, harga_lama::text as "previousPrice", harga_baru::text as "newPrice",
           tgl_harga_baru::text as "newPriceDate", harga_bpjs_lama::text as "previousBpjsPrice",
           harga_bpjs::text as "bpjsPrice", tgl_harga_baru_bpjs::text as "bpjsPriceDate"
    from sim_m_tindakan_harga
    where tenant_id = $1 and tindakan_id = $2 and deleted_at is null
    order by id`;
const candidateRow = z.object({
    id: z.string(),
    priceGroupId: z.string(),
    careClassId: z.string().nullable(),
    specialtyId: z.string().nullable(),
    doctorId: z.string().nullable(),
    operationCategoryId: z.string().nullable(),
    ktpPatient: z.boolean(),
    cito: z.boolean(),
    location: z.string(),
    previousPrice: z.string(),
    newPrice: z.string(),
    newPriceDate: z.string(),
    previousBpjsPrice: z.string(),
    bpjsPrice: z.string(),
    bpjsPriceDate: z.string().nullable(),
});

// Komponen baris harga terpilih seperti GetDetailKomponenTarifNonKerjasama dan GetDetailKomponenTarifJKN: tarif BPJS
// memakai Harga Lama/Baru BPJS dan Insentif HC (%) sebagai harga dan persen insentifnya. Urutan kode komponen, padanan
// kunci KomponenBiayaID sistem lama.
const componentsSql = `
    select c.komponen_biaya_id as "chargeComponentId", b.kode as "chargeComponentCode",
           b.nama as "chargeComponentName", c.qty::text as quantity, c.harga_awal::text as "initialPrice",
           c.harga_awal_lama::text as "previousInitialPrice", c.persen_pajak_titipan::text as "taxDepositPercent",
           c.include_insentif as "includesIncentive",
           (case when $3::boolean then c.harga_bpjs_lama else c.harga_lama end)::text as "previousPrice",
           (case when $3::boolean then c.harga_bpjs else c.harga_baru end)::text as price,
           (case when $3::boolean then c.persen_insentif_hc else c.persen_insentif end)::text as "incentivePercent"
    from sim_m_tindakan_harga_komponen c
    join komponen_biaya b on b.tenant_id = c.tenant_id and b.id = c.komponen_biaya_id
    where c.tenant_id = $1 and c.tindakan_harga_id = $2 and c.deleted_at is null
    order by b.kode, c.id`;
const lookupComponent = z.object({
    chargeComponentId: z.string(),
    chargeComponentCode: z.string(),
    chargeComponentName: z.string(),
    quantity: z.string(),
    initialPrice: z.string(),
    previousInitialPrice: z.string(),
    taxDepositPercent: z.string(),
    includesIncentive: z.boolean(),
    previousPrice: z.string(),
    price: z.string(),
    incentivePercent: z.string(),
});
export type LookupComponent = z.infer<typeof lookupComponent>;

// Tarif jasa yang didapat tindakan untuk pasien. tariff: kode tarif jasa tipe pasien saat dicari. priceGroupId:
// kelompok harga yang dicari tarifnya, null untuk tarif none. step: langkah pencarian yang terpilih (null untuk tarif
// none); price null berarti tanpa tarif, juga bila saringan sesudah langkah mengosongkan hasilnya.
export type ProcedurePriceLookup = {
    tariff: ProcedureTariff;
    priceGroupId: string | null;
    step: TariffStep | null;
    price: (ChosenPrice & { components: LookupComponent[] }) | null;
};

// Masukan dari poli: tindakan, tipe pasien kunjungan, dokter pemeriksa (nakes) atau kosong, kelas atau kosong, KTP
// pasien, dan lokasi (RJ). Cyto dan kategori operasi tetap 0 dan ALL, seperti panggilan poli sistem lama.
export type ProcedurePriceLookupInput = {
    procedureId: string;
    patientTypeId: string;
    practitionerId: string | null;
    careClassId: string | null;
    ktpPatient: boolean;
    location: PriceLocation | null;
};

function keysOf<T extends object>(object: T): (keyof T & string)[] {
    return Object.keys(object).filter((key): key is keyof T & string =>
        Object.hasOwn(object, key),
    );
}

// Tab Detail Harga kartu Jasa sistem lama: baris harga tindakan beserta komponennya, disimpan bersama tindakan.
export class ProcedurePrices {
    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
    ) {}

    async list(procedureId: string): Promise<ProcedurePrice[]> {
        return this.db.rows(procedurePriceRowSchema, pricesSql, [
            this.tenantId,
            procedureId,
        ]);
    }

    // Pilihan form harga. Yang nonaktif ikut, supaya baris yang sudah memegangnya tetap terbaca namanya.
    async choices() {
        const tenant = [this.tenantId];
        const ordered = (table: string) =>
            this.db.rows(
                choice,
                `select id, kode as code, nama as name, aktif as active from ${table}
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                tenant,
            );
        return {
            price_groups: await this.db.rows(
                choice,
                `select id, kode as code, nama as name, aktif as active from kelompok_harga
                 where tenant_id = $1 and deleted_at is null order by kode`,
                tenant,
            ),
            // Tipe Pasien bawaan form harga sistem lama adalah UMUM (JenisPasienID 3), tipe pasien bawaan pasien baru.
            // Di sini: kelompok harga tipe pasien bawaan tenant.
            default_price_group_id:
                (
                    await this.db.one(
                        z.object({ id: z.string() }),
                        `select t.kelompok_harga_id as id from sim_m_tipe_pasien t
                         join kelompok_harga g on g.tenant_id = t.tenant_id and g.id = t.kelompok_harga_id
                         where t.tenant_id = $1 and t.bawaan and t.deleted_at is null
                           and g.aktif and g.deleted_at is null`,
                        tenant,
                    )
                )?.id ?? null,
            care_classes: await ordered('sim_m_kelas'),
            specialties: await this.db.rows(
                z.object({ id: z.string(), name: z.string() }),
                `select id, nama as name from sim_m_spesialisasi
                 where tenant_id = $1 and deleted_at is null order by nama`,
                tenant,
            ),
            doctors: await this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    active: z.boolean(),
                }),
                `select n.id, p.name, n.aktif as active
                 from sim_m_nakes n
                 join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
                 join sim_m_profesi pr on pr.tenant_id = n.tenant_id and pr.id = n.profesi_id
                 where n.tenant_id = $1 and n.deleted_at is null and pr.isi_tenaga_medis
                 order by p.name, n.id`,
                tenant,
            ),
            operation_categories: await ordered('sim_m_kategori_operasi'),
            charge_components: await ordered('komponen_biaya'),
            // Presisi harga satuan mata uang lokal, untuk Harga Baru yang dihitung form komponen.
            price_decimals: unitAmountDecimals(
                await new Currency(this.db, this.tenantId).precision(
                    localCurrencyCode,
                ),
            ),
        };
    }

    private async known(sql: string, ids: string[]) {
        const valid = [...new Set(ids)].filter((id) => lookupId(id));
        const rows = valid.length
            ? await this.db.rows(choiceRow, sql, [
                  this.tenantId,
                  `{${valid.join(',')}}`,
              ])
            : [];
        return new Map(rows.map((row) => [row.id, row.active]));
    }

    // Seluruh baris harga tindakan, dikirim lengkap. Baris tersimpan dikenali dari id-nya dan harus milik tindakan ini;
    // komponen dikenali dari komponen biayanya, kunci SIMdListHargaDetail. Pesan menyebut nomor baris di grid.
    async checked(
        rows: unknown[],
        saved: ProcedurePrice[],
        errors: Errors,
    ): Promise<CheckedPrice[]> {
        const parsed = rows.map((row) =>
            procedurePriceInputSchema.safeParse(row),
        );
        const valid = parsed.flatMap((row) => (row.success ? [row.data] : []));
        const scales: Scales = {
            money: unitAmountDecimals(
                await new Currency(this.db, this.tenantId).precision(
                    localCurrencyCode,
                ),
            ),
            number: percentScale,
        };
        const known = new Map<PriceKey, Map<string, boolean>>();
        for (const key of priceKeyNames)
            known.set(
                key,
                await this.known(
                    priceKeys[key].sql,
                    valid.flatMap((row) => row[key]?.trim() || []),
                ),
            );
        const knownComponents = await this.known(
            componentSql,
            valid.flatMap((row) =>
                (row.components ?? []).flatMap(
                    (component) => component.charge_component_id?.trim() || [],
                ),
            ),
        );
        const savedById = new Map(saved.map((price) => [price.id, price]));
        const seen = new Set<string>();
        const checked: CheckedPrice[] = [];

        parsed.forEach((row, index) => {
            const field = (name: string) => `prices.${index}.${name}`;
            const where = `Baris harga ${index + 1}`;
            if (!row.success) {
                errors[`prices.${index}`] = `${where} tidak terbaca.`;
                return;
            }
            const data = row.data;
            const id = data.id?.trim() || null;
            const held = id ? savedById.get(id) : undefined;
            if (id !== null && (!held || seen.has(id)))
                errors[field('id')] =
                    `${where} sudah tidak ada. Muat ulang tindakan ini.`;
            if (id) seen.add(id);

            const values: Values = {};
            for (const key of priceKeyNames) {
                const value = data[key]?.trim() || null;
                const { column, label } = priceKeys[key];
                values[column] = value;
                if (value === null) {
                    if (key === 'price_group_id')
                        errors[field(key)] = `${where}: pilih ${label}.`;
                    continue;
                }
                const active = known.get(key)?.get(value);
                if (active === undefined || !(active || held?.[key] === value))
                    errors[field(key)] =
                        `${where}: pilih ${label} dari daftar.`;
            }
            const location = data.location ?? 'RJ';
            if (!isPriceLocation(location))
                errors[field('location')] =
                    `${where}: pilih lokasi dari daftar.`;
            for (const name of keysOf(priceNumberFields)) {
                const { column, kind, label } = priceNumberFields[name];
                const value = decimal(data[name], kind, scales);
                values[column] = value;
                if (value === null)
                    errors[field(name)] =
                        `${where}: ${label} ${invalidNumber(kind, scales)}`;
            }
            const newPriceDate = data.new_price_date?.trim() ?? '';
            if (!dateSchema.safeParse(newPriceDate).success)
                errors[field('new_price_date')] =
                    `${where}: isi Tanggal Harga Baru.`;
            const bpjsDate = data.new_bpjs_price_date?.trim() || null;
            if (bpjsDate !== null && !dateSchema.safeParse(bpjsDate).success)
                errors[field('new_bpjs_price_date')] =
                    `${where}: Tanggal Harga Baru BPJS bukan tanggal.`;

            const components: Values[] = [];
            const chosen = new Set<string>();
            const heldComponents = new Set(
                held?.components.map((item) => item.charge_component_id),
            );
            (data.components ?? []).forEach((component, position) => {
                const part = (name: string) =>
                    field(`components.${position}.${name}`);
                const at = `${where}, komponen ${position + 1}`;
                const componentId =
                    component.charge_component_id?.trim() || null;
                const active =
                    componentId === null
                        ? undefined
                        : knownComponents.get(componentId);
                if (componentId === null)
                    errors[part('charge_component_id')] =
                        `${at}: pilih komponen.`;
                else if (
                    active === undefined ||
                    !(active || heldComponents.has(componentId))
                )
                    errors[part('charge_component_id')] =
                        `${at}: pilih komponen dari daftar.`;
                else if (chosen.has(componentId))
                    errors[part('charge_component_id')] =
                        `${at}: komponen ini sudah ada di baris harga ini.`;
                if (componentId !== null) chosen.add(componentId);
                const componentValues: Values = {
                    komponen_biaya_id: componentId,
                    include_insentif: component.includes_incentive ?? false,
                };
                for (const name of keysOf(componentNumberFields)) {
                    const { column, kind, label } = componentNumberFields[name];
                    const raw = component[name];
                    const blank =
                        raw === undefined ||
                        raw === null ||
                        String(raw).trim() === '';
                    // Qty bertanda wajib di form sistem lama; isian angka lain yang kosong berarti 0.
                    const value =
                        name === 'quantity' && blank
                            ? null
                            : decimal(raw, kind, scales);
                    componentValues[column] = value;
                    if (value === null)
                        errors[part(name)] = blank
                            ? `${at}: isi ${label}.`
                            : `${at}: ${label} ${invalidNumber(kind, scales)}`;
                }
                components.push(componentValues);
            });

            // Dijumlahkan di server, bukan di peramban seperti sistem lama, supaya baris dan komponennya tidak pernah
            // berbeda.
            for (const name of keysOf(priceSumFields)) {
                const { column } = priceSumFields[name];
                const componentColumn = componentNumberFields[name].column;
                values[column] = components
                    .reduce((sum, component) => {
                        const value = component[componentColumn];
                        return typeof value === 'string'
                            ? sum.plus(Decimal.of(value))
                            : sum;
                    }, zero)
                    .fixed(columnScale);
            }
            checked.push({
                id,
                values: {
                    ...values,
                    sub_spesialis: data.sub_specialty ?? false,
                    pasien_ktp: data.ktp_patient ?? true,
                    cyto: data.cito ?? false,
                    lokasi: location,
                    tgl_harga_baru: newPriceDate,
                    tgl_harga_baru_bpjs: bpjsDate,
                },
                components,
            });
        });
        return checked;
    }

    // Baris harga dan komponen yang tidak dikirim lagi diberi deleted_at; sistem lama menghapusnya fisik
    // (Service_helper::update_service). Baris tersimpan diubah di tempat, komponen dikenali dari komponen biayanya.
    async write(
        procedureId: string,
        prices: CheckedPrice[],
        saved: ProcedurePrice[],
        stamp: string,
    ): Promise<void> {
        const kept = new Set(prices.flatMap((price) => price.id ?? []));
        await this.removePrices(
            saved
                .filter((price) => !kept.has(price.id))
                .map((price) => price.id),
            stamp,
        );
        for (const price of prices) {
            const priceId = price.id ?? Bun.randomUUIDv7();
            if (price.id)
                await this.update(
                    'sim_m_tindakan_harga',
                    { ...price.values, updated_at: stamp },
                    { id: price.id },
                );
            else
                await this.db.insert('sim_m_tindakan_harga', {
                    id: priceId,
                    tenant_id: this.tenantId,
                    tindakan_id: procedureId,
                    ...price.values,
                    created_at: stamp,
                    updated_at: stamp,
                });
            const componentIds = price.components.map(
                (component) => component.komponen_biaya_id,
            );
            await this.db.execute(
                `update sim_m_tindakan_harga_komponen set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and tindakan_harga_id = $3 and deleted_at is null
                   and not (komponen_biaya_id = any($4::uuid[]))`,
                [stamp, this.tenantId, priceId, `{${componentIds.join(',')}}`],
            );
            for (const component of price.components) {
                const { komponen_biaya_id: componentId = null, ...values } =
                    component;
                const updated = await this.update(
                    'sim_m_tindakan_harga_komponen',
                    { ...values, updated_at: stamp },
                    {
                        tindakan_harga_id: priceId,
                        komponen_biaya_id: componentId,
                    },
                );
                if (!updated)
                    await this.db.insert('sim_m_tindakan_harga_komponen', {
                        id: Bun.randomUUIDv7(),
                        tenant_id: this.tenantId,
                        tindakan_harga_id: priceId,
                        komponen_biaya_id: componentId,
                        ...values,
                        created_at: stamp,
                        updated_at: stamp,
                    });
            }
        }
    }

    // Tarif tindakan untuk pasien, pengganti GetTarifBiayaNonKerjasama/GetTarifBiayaJKN_BUFF dan saringan PHP-nya.
    // null bila tindakan atau tipe pasien tidak ada. Tipe pasien yang dihapus atau nonaktif tetap dibaca, karena
    // kunjungan yang sudah memakainya tetap menunjuknya. Nakes dibaca tanpa melihat statusnya, seperti Vw_Dokter.
    async lookup(
        input: ProcedurePriceLookupInput,
    ): Promise<ProcedurePriceLookup | null> {
        if (!lookupId(input.procedureId) || !lookupId(input.patientTypeId))
            return null;
        const procedure = await this.db.one(
            z.object({
                variesByCito: z.boolean(),
                variesByOperationCategory: z.boolean(),
            }),
            `select variabel_cyto as "variesByCito", variabel_kategori_operasi as "variesByOperationCategory"
             from sim_m_tindakan where tenant_id = $1 and id = $2 and deleted_at is null`,
            [this.tenantId, input.procedureId],
        );
        const patientType = await this.db.one(
            z.object({
                tariff: z.string(),
                priceGroupId: z.string().nullable(),
            }),
            `select tarif_jasa as tariff, coalesce(kelompok_harga_tarif_id, kelompok_harga_id) as "priceGroupId"
             from sim_m_tipe_pasien where tenant_id = $1 and id = $2`,
            [this.tenantId, input.patientTypeId],
        );
        if (
            !procedure ||
            !patientType ||
            !isProcedureTariff(patientType.tariff)
        )
            return null;
        // Nakes yang tidak dikenal tetap dicari sebagai dokter tanpa spesialis, seperti DokterID yang tidak ada di
        // Vw_Dokter.
        const doctorId =
            input.practitionerId !== null && lookupId(input.practitionerId)
                ? input.practitionerId
                : null;
        const doctor = doctorId
            ? {
                  id: doctorId,
                  specialtyId:
                      (
                          await this.db.one(
                              z.object({ id: z.string().nullable() }),
                              `select spesialisasi_id as id from sim_m_nakes where tenant_id = $1 and id = $2`,
                              [this.tenantId, doctorId],
                          )
                      )?.id ?? null,
              }
            : null;
        const prices = (
            await this.db.rows(candidateRow, candidatesSql, [
                this.tenantId,
                input.procedureId,
            ])
        ).flatMap(({ location, ...row }) =>
            isPriceLocation(location) ? [{ ...row, location }] : [],
        );
        const result = lookupProcedurePrice(
            { ...procedure, prices },
            {
                tariff: patientType.tariff,
                priceGroupId: patientType.priceGroupId,
                doctor,
                careClassId: input.careClassId,
                cito: false,
                operationCategoryId: null,
                ktpPatient: input.ktpPatient,
                location: input.location,
            },
        );
        const searched = {
            tariff: patientType.tariff,
            priceGroupId:
                result.step === null ? null : patientType.priceGroupId,
            step: result.step,
        };
        if (!result.price) return { ...searched, price: null };
        const components = await this.db.rows(lookupComponent, componentsSql, [
            this.tenantId,
            result.price.priceRowId,
            result.price.kind === 'bpjs',
        ]);
        return { ...searched, price: { ...result.price, components } };
    }

    // Tindakan yang dihapus membawa harganya, supaya master yang hanya dipakai harga itu bisa dihapus.
    async removeAll(procedureId: string, stamp: string): Promise<void> {
        await this.removePrices(
            (await this.list(procedureId)).map((price) => price.id),
            stamp,
        );
    }

    private async removePrices(ids: string[], stamp: string): Promise<void> {
        if (!ids.length) return;
        const list = `{${ids.join(',')}}`;
        await this.db.execute(
            `update sim_m_tindakan_harga_komponen set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and tindakan_harga_id = any($3::uuid[]) and deleted_at is null`,
            [stamp, this.tenantId, list],
        );
        await this.db.execute(
            `update sim_m_tindakan_harga set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = any($3::uuid[]) and deleted_at is null`,
            [stamp, this.tenantId, list],
        );
    }

    // Baris yang masih ada dengan kunci ini diubah; jumlah baris yang berubah dikembalikan.
    private async update(
        table: string,
        values: Values,
        keys: Values,
    ): Promise<number> {
        const set = Object.keys(values);
        const where = Object.keys(keys);
        return this.db.execute(
            `update ${table}
             set ${set.map((column, index) => `${column} = $${index + 1}`).join(', ')}
             where tenant_id = $${set.length + 1} and deleted_at is null
               and ${where.map((column, index) => `${column} = $${set.length + index + 2}`).join(' and ')}`,
            [...Object.values(values), this.tenantId, ...Object.values(keys)],
        );
    }
}
