import { z } from 'zod';
import {
    coreWorkspace,
    type Workspace,
} from '../../../platform/access/index.ts';
import type { Database } from '../../../platform/database/index.ts';
import {
    dateSchema,
    lookupId,
    validation,
} from '../../../platform/http/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '../../../platform/reporting/index.ts';
import { requireLocationAccess } from '../warehouse-employee/location-access.ts';
import { lplpoLayouts } from './lplpo.layout.ts';

export const lplpoFields = {
    location_code: field.text('Kode lokasi'),
    location_name: field.text('Lokasi'),
    date_from: field.date('Dari tanggal'),
    date_to: field.date('Sampai tanggal'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        unit: field.text('Satuan dasar'),
        opening: field.quantity('Stok awal'),
        received: field.quantity('Penerimaan'),
        received_by_funding_source: field.lines('Penerimaan per sumber dana', {
            funding_source: field.text('Sumber dana'),
            quantity: field.quantity('Jumlah'),
        }),
        available: field.quantity('Persediaan (stok awal + penerimaan)'),
        used: field.quantity('Pemakaian'),
        closing: field.quantity('Sisa stok'),
        optimum: field.quantity('Stok optimum (stok maksimum lokasi)'),
        requested: field.quantity('Permintaan'),
    }),
};

const locationSchema = z.object({
    location_code: z.string(),
    location_name: z.string(),
    operating_unit_id: z.string(),
});

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    unit: z.string(),
    opening: z.string(),
    received: z.string(),
    received_by_funding_source: z.array(
        z.object({ funding_source: z.string(), quantity: z.string() }),
    ),
    available: z.string(),
    used: z.string(),
    closing: z.string(),
    optimum: z.string().nullable(),
    requested: z.string(),
});

const linesSql = `
    with gerak as (
        select k.barang_id,
               coalesce(sum(k.jumlah) filter (where k.tanggal_posting < $4::date), 0) as stok_awal,
               coalesce(sum(k.jumlah) filter (where k.tanggal_posting >= $4::date and k.jumlah > 0), 0) as masuk,
               coalesce(-sum(k.jumlah) filter (where k.tanggal_posting >= $4::date and k.jumlah < 0), 0) as keluar
        from gd_tr_kartu_gudang k
        where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id = $3 and k.tanggal_posting <= $5::date
        group by k.barang_id
    ),
    masuk_dana as (
        select k.barang_id, k.sumber_dana_id, sum(k.jumlah) as jumlah
        from gd_tr_kartu_gudang k
        where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id = $3
          and k.tanggal_posting between $4::date and $5::date and k.jumlah > 0
        group by k.barang_id, k.sumber_dana_id
    ),
    minta as (
        select r.barang_id, sum(r.jumlah * r.konversi) as jumlah
        from bl_tr_permintaan r
        where r.tenant_id = $1 and r.legal_entity_id = $2 and r.lokasi_id = $3 and r.deleted_at is null
          and r.tanggal_permintaan between $4::date and $5::date
        group by r.barang_id
    ),
    barang as (
        select barang_id from gerak where stok_awal <> 0 or masuk <> 0 or keluar <> 0
        union
        select barang_id from minta
    )
    select b.kode as item_code, b.nama as item_name, s.kode as unit,
           trim_scale(coalesce(g.stok_awal, 0))::text as opening,
           trim_scale(coalesce(g.masuk, 0))::text as received,
           (select coalesce(json_agg(json_build_object(
                       'funding_source', coalesce(d.nama, 'Tanpa sumber dana'),
                       'quantity', trim_scale(md.jumlah)::text) order by d.kode nulls last), '[]'::json)
            from masuk_dana md
            left join gd_m_sumber_dana d on d.tenant_id = $1 and d.id = md.sumber_dana_id
            where md.barang_id = x.barang_id) as received_by_funding_source,
           trim_scale(coalesce(g.stok_awal, 0) + coalesce(g.masuk, 0))::text as available,
           trim_scale(coalesce(g.keluar, 0))::text as used,
           trim_scale(coalesce(g.stok_awal, 0) + coalesce(g.masuk, 0) - coalesce(g.keluar, 0))::text as closing,
           trim_scale(sku.stok_maksimum)::text as optimum,
           trim_scale(coalesce(m.jumlah, 0))::text as requested
    from barang x
    join gd_m_barang b on b.tenant_id = $1 and b.id = x.barang_id
    join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
    left join gerak g on g.barang_id = x.barang_id
    left join minta m on m.barang_id = x.barang_id
    left join gd_m_barang_lokasi sku on sku.tenant_id = $1 and sku.legal_entity_id = $2 and sku.barang_id = x.barang_id
         and sku.lokasi_id = $3 and sku.deleted_at is null
    order by b.kode, b.id`;

async function lplpo(
    db: Database,
    workspace: Workspace,
    locationId: string,
    parameters: URLSearchParams,
) {
    workspace.guard('inventory-report', 'read');
    if (!lookupId(locationId) || !workspace.legalEntityId) return null;
    const from = parameters.get('from') ?? '';
    const to = parameters.get('to') ?? '';
    const errors: Record<string, string> = {};
    if (!dateSchema.safeParse(from).success)
        errors.from = 'Isi tanggal mulai yang benar.';
    if (!dateSchema.safeParse(to).success)
        errors.to = 'Isi tanggal selesai yang benar.';
    else if (to < from)
        errors.to = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    if (Object.keys(errors).length) validation(errors);
    const location = await db.one(
        locationSchema,
        `select kode as location_code, nama as location_name, operating_unit_id from gd_m_lokasi
         where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
        [workspace.tenantId, workspace.legalEntityId, locationId],
    );
    if (!location) return null;
    await requireLocationAccess(db, workspace, [locationId]);
    const lines = await db.rows(lineSchema, linesSql, [
        workspace.tenantId,
        workspace.legalEntityId,
        locationId,
        from,
        to,
    ]);
    const { operating_unit_id, ...header } = location;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `LPLPO ${header.location_code} ${from} sampai ${to}`,
        values: { ...header, date_from: from, date_to: to, lines },
    };
}

const sample: Values<typeof lplpoFields> = {
    location_code: 'GUDANG',
    location_name: 'Gudang Farmasi',
    date_from: '2026-11-01',
    date_to: '2026-11-30',
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            unit: 'TAB',
            opening: '120',
            received: '500',
            received_by_funding_source: [
                { funding_source: 'APBD', quantity: '300' },
                { funding_source: 'Program', quantity: '200' },
            ],
            available: '620',
            used: '170',
            closing: '450',
            optimum: '600',
            requested: '200',
        },
        {
            item_code: 'ORS',
            item_name: 'Oralit',
            unit: 'SACH',
            opening: '40',
            received: '0',
            received_by_funding_source: [],
            available: '40',
            used: '15',
            closing: '25',
            optimum: null,
            requested: '0',
        },
    ],
};

export const lplpoReport = defineReport({
    code: 'core.lplpo',
    name: 'LPLPO (pemakaian dan permintaan obat)',
    moduleId: 'core',
    permission: 'core.inventory-report.read',
    workspace: (context) => coreWorkspace(context),
    fields: lplpoFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'LPLPO GUDANG 2026-11-01 sampai 2026-11-30',
        values: sample,
    },
    layouts: lplpoLayouts,
    load: lplpo,
});
