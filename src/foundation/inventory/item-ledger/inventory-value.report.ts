import { z } from 'zod';
import {
    coreWorkspace,
    type Workspace,
} from '../../../platform/access/index.ts';
import type { Bind, Database } from '../../../platform/database/index.ts';
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
import { categoryTreeSql, exists } from '../inventory.service.ts';
import { requireLocationAccess } from '../warehouse-employee/location-access.ts';
import { inventoryValueLayouts } from './inventory-value.layout.ts';

// Nilai persediaan satu lokasi dalam satu periode, per barang dan sumber dana: padanan Inventory Valuation (1001)
// Business Central dengan saringan lokasi, dan pengganti Excel nilai persediaan sistem lama. Nilainya nilai kartu
// gudang, biaya sebenarnya setiap gerak, bukan jumlah dikali satu harga seperti sistem lama (keputusan pemilik produk,
// 20 November 2026). Sumber dana ikut baris keluar dari baris masuk yang diambilnya, jadi pengeluaran pun terpecah per
// sumber dana.
export const inventoryValueFields = {
    location_code: field.text('Kode lokasi'),
    location_name: field.text('Lokasi'),
    date_from: field.date('Dari tanggal'),
    date_to: field.date('Sampai tanggal'),
    category_code: field.text('Kode kategori yang disaring'),
    category_name: field.text('Kategori yang disaring'),
    lines: field.lines('Barang per sumber dana', {
        funding_source_code: field.text('Kode sumber dana'),
        funding_source_name: field.text('Sumber dana'),
        category_code: field.text('Kode kategori barang'),
        category_name: field.text('Kategori barang'),
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        unit: field.text('Satuan'),
        unit_cost: field.unitAmount('Harga satuan'),
        opening_quantity: field.quantity('Stok awal (jumlah)'),
        opening_value: field.money('Stok awal (nilai)'),
        received_quantity: field.quantity('Penerimaan (jumlah)'),
        received_value: field.money('Penerimaan (nilai)'),
        issued_quantity: field.quantity('Pengeluaran (jumlah)'),
        issued_value: field.money('Pengeluaran (nilai)'),
        closing_quantity: field.quantity('Stok akhir (jumlah)'),
        closing_value: field.money('Stok akhir (nilai)'),
    }),
};

const locationSchema = z.object({
    location_code: z.string(),
    location_name: z.string(),
    operating_unit_id: z.string(),
});

const categorySchema = z.object({
    category_code: z.string(),
    category_name: z.string(),
});

const lineSchema = z.object({
    funding_source_code: z.string().nullable(),
    funding_source_name: z.string(),
    category_code: z.string().nullable(),
    category_name: z.string().nullable(),
    item_code: z.string(),
    item_name: z.string(),
    unit: z.string(),
    unit_cost: z.string().nullable(),
    opening_quantity: z.string(),
    opening_value: z.string(),
    received_quantity: z.string(),
    received_value: z.string(),
    issued_quantity: z.string(),
    issued_value: z.string(),
    closing_quantity: z.string(),
    closing_value: z.string(),
});

// Penerimaan dan pengeluaran dipisah menurut tanda jumlah, sama dengan LPLPO, supaya dua laporan dari kartu gudang yang
// sama memberi angka yang sama; pembatalan penerimaan terhitung pengeluaran. Stok akhir = stok awal + penerimaan -
// pengeluaran, sama dengan jumlah kartu gudang sampai tanggal akhir. Harga satuan adalah nilai akhir dibagi jumlah
// akhir. Baris yang semuanya nol tidak ikut.
const linesSql = (categoryAt: string | null) => `
    with recursive ${categoryAt ? `${categoryTreeSql(categoryAt)},` : ''}
    gerak as (
        select k.barang_id, k.sumber_dana_id,
               coalesce(sum(k.jumlah) filter (where k.tanggal_posting < $4::date), 0) as stok_awal,
               coalesce(sum(k.nilai) filter (where k.tanggal_posting < $4::date), 0) as nilai_awal,
               coalesce(sum(k.jumlah) filter (where k.tanggal_posting >= $4::date and k.jumlah > 0), 0) as masuk,
               coalesce(sum(k.nilai) filter (where k.tanggal_posting >= $4::date and k.jumlah > 0), 0) as nilai_masuk,
               coalesce(-sum(k.jumlah) filter (where k.tanggal_posting >= $4::date and k.jumlah < 0), 0) as keluar,
               coalesce(-sum(k.nilai) filter (where k.tanggal_posting >= $4::date and k.jumlah < 0), 0) as nilai_keluar
        from gd_tr_kartu_gudang k
        where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id = $3 and k.tanggal_posting <= $5::date
        group by k.barang_id, k.sumber_dana_id
    ),
    akhir as (
        select g.*, g.stok_awal + g.masuk - g.keluar as stok_akhir,
               g.nilai_awal + g.nilai_masuk - g.nilai_keluar as nilai_akhir
        from gerak g
    )
    select d.kode as funding_source_code, coalesce(d.nama, 'Tanpa sumber dana') as funding_source_name,
           c.kode as category_code, c.nama as category_name,
           b.kode as item_code, b.nama as item_name, s.kode as unit,
           case when a.stok_akhir <> 0 then trim_scale(a.nilai_akhir / a.stok_akhir)::text end as unit_cost,
           trim_scale(a.stok_awal)::text as opening_quantity, trim_scale(a.nilai_awal)::text as opening_value,
           trim_scale(a.masuk)::text as received_quantity, trim_scale(a.nilai_masuk)::text as received_value,
           trim_scale(a.keluar)::text as issued_quantity, trim_scale(a.nilai_keluar)::text as issued_value,
           trim_scale(a.stok_akhir)::text as closing_quantity, trim_scale(a.nilai_akhir)::text as closing_value
    from akhir a
    join gd_m_barang b on b.tenant_id = $1 and b.id = a.barang_id
    join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
    left join gd_m_kategori c on c.tenant_id = $1 and c.id = b.kategori_id
    left join gd_m_sumber_dana d on d.tenant_id = $1 and d.id = a.sumber_dana_id
    where (a.stok_awal <> 0 or a.nilai_awal <> 0 or a.masuk <> 0 or a.keluar <> 0)
      ${categoryAt ? 'and b.kategori_id in (select id from kategori)' : ''}
    order by d.kode nulls last, d.id, b.kode, b.id`;

async function inventoryValue(
    db: Database,
    workspace: Workspace,
    locationId: string,
    parameters: URLSearchParams,
) {
    workspace.guard('inventory-report', 'read');
    if (!lookupId(locationId) || !workspace.legalEntityId) return null;
    const scope = {
        tenantId: workspace.tenantId,
        legalEntityId: workspace.legalEntityId,
    };
    const from = parameters.get('from') ?? '';
    const to = parameters.get('to') ?? '';
    const categoryId = parameters.get('category_id') ?? '';
    const errors: Record<string, string> = {};
    if (!dateSchema.safeParse(from).success)
        errors.from = 'Isi tanggal mulai yang benar.';
    if (!dateSchema.safeParse(to).success)
        errors.to = 'Isi tanggal selesai yang benar.';
    else if (to < from)
        errors.to = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    if (categoryId && !(await exists(db, 'gd_m_kategori', scope, categoryId)))
        errors.category_id = 'Pilih kategori dari daftar.';
    if (Object.keys(errors).length) validation(errors);
    const location = await db.one(
        locationSchema,
        `select kode as location_code, nama as location_name, operating_unit_id from gd_m_lokasi
         where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
        [scope.tenantId, scope.legalEntityId, locationId],
    );
    if (!location) return null;
    await requireLocationAccess(db, workspace, [locationId]);
    const category = categoryId
        ? await db.one(
              categorySchema,
              `select kode as category_code, nama as category_name from gd_m_kategori
               where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
              [scope.tenantId, scope.legalEntityId, categoryId],
          )
        : undefined;
    const bindings: Bind[] = [
        scope.tenantId,
        scope.legalEntityId,
        locationId,
        from,
        to,
    ];
    if (categoryId) bindings.push(categoryId);
    const lines = await db.rows(
        lineSchema,
        linesSql(categoryId ? '$6' : null),
        bindings,
    );
    const { operating_unit_id, ...header } = location;
    return {
        legalEntityId: scope.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Nilai persediaan ${header.location_code} ${from} sampai ${to}`,
        values: {
            ...header,
            date_from: from,
            date_to: to,
            category_code: category?.category_code ?? null,
            category_name: category?.category_name ?? null,
            lines,
        },
    };
}

const line = (
    funding: { code: string | null; name: string },
    item: { code: string; name: string; unit: string },
    numbers: {
        unit_cost: string | null;
        opening: [string, string];
        received: [string, string];
        issued: [string, string];
        closing: [string, string];
    },
) => ({
    funding_source_code: funding.code,
    funding_source_name: funding.name,
    category_code: 'OBT',
    category_name: 'Obat',
    item_code: item.code,
    item_name: item.name,
    unit: item.unit,
    unit_cost: numbers.unit_cost,
    opening_quantity: numbers.opening[0],
    opening_value: numbers.opening[1],
    received_quantity: numbers.received[0],
    received_value: numbers.received[1],
    issued_quantity: numbers.issued[0],
    issued_value: numbers.issued[1],
    closing_quantity: numbers.closing[0],
    closing_value: numbers.closing[1],
});

const fundA = { code: 'D01', name: 'Dana contoh A' };
const fundB = { code: 'D02', name: 'Dana contoh B' };
const tablet = { code: 'PCT-500', name: 'Parasetamol 500 mg', unit: 'TAB' };

const sample: Values<typeof inventoryValueFields> = {
    location_code: 'GUDANG',
    location_name: 'Gudang Farmasi',
    date_from: '2026-11-01',
    date_to: '2026-11-30',
    category_code: null,
    category_name: null,
    lines: [
        line(fundA, tablet, {
            unit_cost: '250',
            opening: ['120', '30000'],
            received: ['500', '125000'],
            issued: ['170', '42500'],
            closing: ['450', '112500'],
        }),
        line(
            fundA,
            { code: 'ORS', name: 'Oralit', unit: 'SACH' },
            {
                unit_cost: '1200.5',
                opening: ['40', '48020'],
                received: ['0', '0'],
                issued: ['15', '18007.5'],
                closing: ['25', '30012.5'],
            },
        ),
        line(
            fundB,
            { code: 'SPT-3', name: 'Spuit 3 ml', unit: 'PCS' },
            {
                unit_cost: null,
                opening: ['10', '15000'],
                received: ['0', '0'],
                issued: ['10', '15000'],
                closing: ['0', '0'],
            },
        ),
        line({ code: null, name: 'Tanpa sumber dana' }, tablet, {
            unit_cost: '250',
            opening: ['0', '0'],
            received: ['5', '1250'],
            issued: ['0', '0'],
            closing: ['5', '1250'],
        }),
    ],
};

export const inventoryValueReport = defineReport({
    code: 'core.inventory-value',
    name: 'Nilai persediaan',
    moduleId: 'core',
    permission: 'core.inventory-report.read',
    workspace: (context) => coreWorkspace(context),
    fields: inventoryValueFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Nilai persediaan GUDANG 2026-11-01 sampai 2026-11-30',
        values: sample,
    },
    layouts: inventoryValueLayouts,
    load: inventoryValue,
});
