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
import { entryKinds } from './item-ledger.posting.ts';
import { movementLabel } from './movement.ts';
import { stockCardLayouts } from './stock-card.layout.ts';

export const stockCardFields = {
    item_code: field.text('Kode barang'),
    item_name: field.text('Nama barang'),
    unit: field.text('Satuan dasar'),
    location_code: field.text('Kode lokasi'),
    location_name: field.text('Lokasi'),
    date_from: field.date('Dari tanggal'),
    date_to: field.date('Sampai tanggal'),
    opening_balance: field.quantity('Saldo awal'),
    total_in: field.quantity('Jumlah masuk'),
    total_out: field.quantity('Jumlah keluar'),
    closing_balance: field.quantity('Saldo akhir'),
    lines: field.lines('Gerak stok', {
        posting_date: field.date('Tanggal'),
        document_number: field.text('Nomor dokumen'),
        movement: field.text('Jenis gerak'),
        batch_number: field.text('Batch'),
        expiry_date: field.date('Kedaluwarsa'),
        quantity_in: field.quantity('Masuk'),
        quantity_out: field.quantity('Keluar'),
        balance: field.quantity('Saldo'),
    }),
};

const headerSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    unit: z.string(),
    location_code: z.string(),
    location_name: z.string(),
    operating_unit_id: z.string(),
    opening_balance: z.string(),
});

const entrySchema = z.object({
    posting_date: z.string(),
    document_number: z.string().nullable(),
    kind: z.enum(entryKinds),
    source_type: z.string(),
    reversal: z.boolean(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    quantity_in: z.string().nullable(),
    quantity_out: z.string().nullable(),
    balance: z.string(),
});

const totalsSchema = z.object({
    total_in: z.string(),
    total_out: z.string(),
    closing_balance: z.string(),
});

async function stockCard(
    db: Database,
    workspace: Workspace,
    itemId: string,
    parameters: URLSearchParams,
) {
    workspace.guard('inventory-stock', 'read');
    if (!lookupId(itemId) || !workspace.legalEntityId) return null;
    const locationId = parameters.get('location_id') ?? '';
    const from = parameters.get('from') ?? '';
    const to = parameters.get('to') ?? '';
    const errors: Record<string, string> = {};
    if (!lookupId(locationId)) errors.location_id = 'Pilih lokasi.';
    if (!dateSchema.safeParse(from).success)
        errors.from = 'Isi tanggal mulai yang benar.';
    if (!dateSchema.safeParse(to).success)
        errors.to = 'Isi tanggal selesai yang benar.';
    else if (to < from)
        errors.to = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    if (Object.keys(errors).length) validation(errors);
    await requireLocationAccess(db, workspace, [locationId]);
    const scope = [workspace.tenantId, workspace.legalEntityId, itemId];
    const header = await db.one(
        headerSchema,
        `select b.kode as item_code, b.nama as item_name, s.kode as unit, l.kode as location_code,
                l.nama as location_name, l.operating_unit_id,
                trim_scale(coalesce((select sum(k.jumlah) from gd_tr_kartu_gudang k
                                     where k.tenant_id = b.tenant_id and k.legal_entity_id = b.legal_entity_id
                                       and k.barang_id = b.id and k.lokasi_id = l.id
                                       and k.tanggal_posting < $5::date), 0))::text as opening_balance
         from gd_m_barang b
         join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
         join gd_m_lokasi l on l.tenant_id = b.tenant_id and l.legal_entity_id = b.legal_entity_id and l.id = $4
         where b.tenant_id = $1 and b.legal_entity_id = $2 and b.id = $3`,
        [...scope, locationId, from],
    );
    if (!header) return null;
    const period = `from gd_tr_kartu_gudang k
         left join gd_m_batch t on t.tenant_id = k.tenant_id and t.id = k.batch_id
         where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id = $3 and k.lokasi_id = $4
           and k.tanggal_posting between $5::date and $6::date`;
    const bindings = [...scope, locationId, from, to, header.opening_balance];
    const entries = await db.rows(
        entrySchema,
        `select k.tanggal_posting::text as posting_date, k.sumber_nomor as document_number, k.jenis as kind,
                k.sumber_jenis as source_type, k.dibalik_dari is not null as reversal,
                t.no_batch as batch_number, t.kedaluwarsa::text as expiry_date,
                case when k.jumlah > 0 then trim_scale(k.jumlah)::text end as quantity_in,
                case when k.jumlah < 0 then trim_scale(-k.jumlah)::text end as quantity_out,
                trim_scale($7::numeric + sum(k.jumlah) over (order by k.tanggal_posting, k.id))::text as balance
         ${period}
         order by k.tanggal_posting, k.id`,
        bindings,
    );
    const totals = await db.one(
        totalsSchema,
        `select trim_scale(coalesce(sum(k.jumlah) filter (where k.jumlah > 0), 0))::text as total_in,
                trim_scale(coalesce(-sum(k.jumlah) filter (where k.jumlah < 0), 0))::text as total_out,
                trim_scale($7::numeric + coalesce(sum(k.jumlah), 0))::text as closing_balance
         ${period}`,
        bindings,
    );
    if (!totals) throw new Error('Stock card totals returned no row.');
    const { operating_unit_id, ...item } = header;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Kartu stok ${item.item_code} ${item.location_code} ${from} sampai ${to}`,
        values: {
            ...item,
            date_from: from,
            date_to: to,
            ...totals,
            lines: entries.map(({ kind, source_type, reversal, ...entry }) => ({
                ...entry,
                movement: movementLabel({
                    kind,
                    sourceType: source_type,
                    inbound: entry.quantity_in !== null,
                    reversal,
                }),
            })),
        },
    };
}

const sample: Values<typeof stockCardFields> = {
    item_code: 'PCT-500',
    item_name: 'Parasetamol 500 mg',
    unit: 'TAB',
    location_code: 'GUDANG',
    location_name: 'Gudang Farmasi',
    date_from: '2026-11-01',
    date_to: '2026-11-30',
    opening_balance: '120',
    total_in: '500',
    total_out: '170',
    closing_balance: '450',
    lines: [
        {
            posting_date: '2026-11-03',
            document_number: 'PNR-00000012',
            movement: 'Terima dari vendor',
            batch_number: 'B-2611',
            expiry_date: '2028-06-30',
            quantity_in: '500',
            quantity_out: null,
            balance: '620',
        },
        {
            posting_date: '2026-11-10',
            document_number: 'MUT-00000004',
            movement: 'Mutasi keluar',
            batch_number: 'B-2611',
            expiry_date: '2028-06-30',
            quantity_in: null,
            quantity_out: '170',
            balance: '450',
        },
    ],
};

export const stockCardReport = defineReport({
    code: 'core.stock-card',
    name: 'Kartu stok',
    moduleId: 'core',
    permission: 'core.inventory-stock.read',
    workspace: (context) => coreWorkspace(context),
    fields: stockCardFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Kartu stok PCT-500 GUDANG 2026-11-01 sampai 2026-11-30',
        values: sample,
    },
    layouts: stockCardLayouts,
    load: stockCard,
});
