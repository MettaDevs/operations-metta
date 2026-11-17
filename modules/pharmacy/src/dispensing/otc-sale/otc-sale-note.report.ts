import type { Workspace } from '@core/platform/access/index.ts';
import type { Database } from '@core/platform/database/index.ts';
import { documentPayment } from '@core/foundation/billing/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '@core/platform/reporting/index.ts';
import { z } from 'zod';
import { moduleWorkspace } from '../../module.ts';
import { otcSaleNoteLayouts } from './otc-sale-note.layout.ts';
import { OtcSales } from './otc-sale.service.ts';

// Nota penjualan obat bebas, pola posted Sales Invoice BC (laporan Standard Sales - Invoice). Baris dan total dibaca
// lewat kartu penjualan yang juga dipakai layar, jadi angkanya sama dengan yang ditagih kasir sesudah retur.
// Pembayaran dibaca dari kasir Core lewat documentPayment, bukan dari tabelnya. Belum ada PPN: tagihan kasir tidak
// membawa pajak.
export const otcSaleNoteFields = {
    number: field.text('Nomor penjualan'),
    sold_at: field.datetime('Waktu penjualan'),
    location: field.text('Lokasi'),
    buyer_name: field.text('Pembeli'),
    seller: field.text('Petugas loket'),
    lines: field.lines('Obat', {
        code: field.text('Kode obat'),
        name: field.text('Nama obat'),
        quantity: field.quantity('Jumlah terjual'),
        unit: field.text('Satuan'),
        returned: field.flag('Ada yang diretur'),
        returned_quantity: field.quantity('Jumlah diretur'),
        net_quantity: field.quantity('Jumlah ditagih'),
        unit_price: field.unitAmount('Harga satuan'),
        discounted: field.flag('Ada diskon'),
        discount_percent: field.quantity('Diskon %'),
        amount: field.money('Nilai'),
    }),
    fees: field.lines('Biaya resep', {
        name: field.text('Biaya'),
        amount: field.money('Nilai'),
    }),
    total: field.money('Total', { words: true }),
    paid: field.flag('Sudah dibayar'),
    payment_number: field.text('Nomor bukti bayar'),
    paid_at: field.datetime('Waktu bayar'),
    has_surcharge: field.flag('Ada biaya kartu'),
    surcharge: field.money('Biaya kartu'),
    paid_total: field.money('Total dibayar'),
    tenders: field.lines('Cara bayar', {
        name: field.text('Jenis bayar'),
        amount: field.money('Nilai'),
    }),
    received: field.money('Uang diterima'),
    change: field.money('Kembalian'),
    cashier: field.text('Kasir'),
};

const headerSchema = z.object({
    operating_unit_id: z.string(),
    seller: z.string().nullable(),
});

async function otcSaleNote(db: Database, workspace: Workspace, saleId: string) {
    const { data: sale } = await new OtcSales(db, workspace).show(saleId);
    const header = await db.one(
        headerSchema,
        `select h.operating_unit_id, u.name as seller
         from bill_farmasi h left join users u on u.id = h.diserahkan_oleh_user_id
         where h.tenant_id = $1 and h.id = $2`,
        [workspace.tenantId, sale.id],
    );
    const payment = await documentPayment(db, workspace.tenantId, sale.id);
    const values: Values<typeof otcSaleNoteFields> = {
        number: sale.number,
        sold_at: sale.handed_over_at,
        location: sale.location.name,
        buyer_name: sale.buyer_name,
        seller: header?.seller ?? null,
        lines: sale.lines.map((line) => {
            const returned = Decimal.of(line.quantity).minus(
                Decimal.of(line.net_quantity),
            );
            return {
                code: line.item.code,
                name: line.item.name,
                quantity: line.quantity,
                unit: line.unit_code,
                returned: returned.compare(Decimal.of('0')) > 0,
                returned_quantity: returned.normalized(),
                net_quantity: line.net_quantity,
                unit_price: line.unit_price,
                discounted:
                    Decimal.of(line.discount_percent).compare(
                        Decimal.of('0'),
                    ) !== 0,
                discount_percent: line.discount_percent,
                amount: line.amount,
            };
        }),
        fees: sale.fees
            .filter(
                (fee) => Decimal.of(fee.amount).compare(Decimal.of('0')) !== 0,
            )
            .map((fee) => ({ name: fee.name, amount: fee.amount })),
        total: sale.total,
        paid: payment !== null,
        payment_number: payment?.number ?? null,
        paid_at: payment?.paid_at ?? null,
        has_surcharge:
            payment !== null &&
            Decimal.of(payment.surcharge).compare(Decimal.of('0')) !== 0,
        surcharge: payment?.surcharge ?? null,
        paid_total: payment?.total ?? null,
        tenders: payment?.tenders ?? [],
        received: payment?.received ?? null,
        change: payment?.change ?? null,
        cashier: payment?.cashier ?? null,
    };
    return {
        legalEntityId: workspace.legalEntityId ?? '',
        operatingUnitId: header?.operating_unit_id ?? null,
        fileName: `Nota ${sale.number}`,
        values,
    };
}

export const otcSaleNoteReport = defineReport({
    code: 'pharmacy.otc-sale-note',
    name: 'Nota penjualan obat bebas',
    moduleId: 'pharmacy',
    permission: 'pharmacy.otc-sale.read',
    workspace: (context) => moduleWorkspace(context),
    fields: otcSaleNoteFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Nota FAR-2611-0004',
        values: {
            number: 'FAR-2611-0004',
            sold_at: '2026-11-17T03:10:00.000000Z',
            location: 'Farmasi',
            buyer_name: 'Pembeli Contoh',
            seller: 'Petugas Contoh',
            lines: [
                {
                    code: 'PCT-500',
                    name: 'Parasetamol 500 mg',
                    quantity: '10',
                    unit: 'TAB',
                    returned: true,
                    returned_quantity: '2',
                    net_quantity: '8',
                    unit_price: '1200',
                    discounted: false,
                    discount_percent: '0',
                    amount: '9600',
                },
                {
                    code: 'ORS',
                    name: 'Oralit',
                    quantity: '2',
                    unit: 'SCH',
                    returned: false,
                    returned_quantity: '0',
                    net_quantity: '2',
                    unit_price: '1000',
                    discounted: true,
                    discount_percent: '10',
                    amount: '1800',
                },
            ],
            fees: [{ name: 'Biaya resep Parasetamol 500 mg', amount: '2000' }],
            total: '13400',
            paid: true,
            payment_number: 'KSR-00000013',
            paid_at: '2026-11-17T03:10:00.000000Z',
            has_surcharge: false,
            surcharge: '0',
            paid_total: '13400',
            tenders: [{ name: 'Tunai', amount: '13400' }],
            received: '20000',
            change: '6600',
            cashier: 'Petugas Contoh',
        },
    },
    layouts: otcSaleNoteLayouts,
    load: otcSaleNote,
});
