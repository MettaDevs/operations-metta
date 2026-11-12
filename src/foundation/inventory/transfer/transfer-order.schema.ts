import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { transferModes } from '../item-ledger/stock-policy.ts';

// Amprah: draf disusun lokasi peminta, diajukan, lalu dikirim dan diterima sebagian berkali-kali sampai selesai, atau
// dibatalkan selama belum ada yang dikirim.
export const transferOrderStatuses = [
    'draf',
    'diajukan',
    'selesai',
    'dibatalkan',
] as const;
export const postedTransferStatuses = ['diposting', 'dibatalkan'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

// Jumlah dalam satuan baris (misalnya kotak); kartu gudang menerima jumlah dalam satuan dasar.
export const transferOrderLineInputSchema = z.object({
    id: z.string().nullable().optional(),
    item_id: z.string(),
    unit_id: z.string(),
    quantity: amount,
});

export const transferOrderInputSchema = z.object({
    from_location_id: z.string(),
    to_location_id: z.string(),
    transit_location_id: z.string().nullable().optional(),
    posting_date: z.string(),
    description: z.string().nullable().optional(),
    lines: z.array(transferOrderLineInputSchema).max(500),
    version: z.number().optional(),
});

// Jumlah yang akan dikirim dan diterima pada posting berikutnya. Field yang tidak dikirim tidak berubah.
export const transferQuantitiesInputSchema = z.object({
    lines: z
        .array(
            z.object({
                id: z.string(),
                quantity_to_ship: amount.optional(),
                quantity_to_receive: amount.optional(),
            }),
        )
        .max(500),
    version: z.number().optional(),
});

export const transferPostingInputSchema = z.object({
    posting_date: z.string(),
    version: z.number().optional(),
});

export const transferOrderRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    status: z.enum(transferOrderStatuses),
    from_location: reference,
    to_location: reference,
    transit_location: reference.nullable(),
    // Cara mutasi yang berlaku sekarang: setelan lokasi pemasok, atau legal entity bila lokasi tidak menimpanya.
    transfer_mode: z.enum(transferModes),
    description: z.string().nullable(),
    submitted_at: z.string().nullable(),
    closed_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    version: z.number(),
});

// Semua jumlah dalam satuan baris, kecuali stok di lokasi pemasok yang dalam satuan dasar.
export const transferOrderLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item: reference.extend({ base_unit: z.string() }),
    unit: reference,
    quantity_per_unit: z.string(),
    quantity: z.string(),
    quantity_shipped: z.string(),
    quantity_received: z.string(),
    quantity_in_transit: z.string(),
    quantity_outstanding: z.string(),
    quantity_to_ship: z.string(),
    quantity_to_receive: z.string(),
    supplier_stock: z.string(),
});

export const transferPostingSummarySchema = z.object({
    id: z.string(),
    kind: z.enum(['shipment', 'receipt']),
    number: z.string(),
    posting_date: z.string(),
    status: z.enum(postedTransferStatuses),
});

export const transferOrderListQuerySchema = listParametersSchema.extend({
    status: z.enum(transferOrderStatuses).optional(),
});

// Mutasi dan penerimaan mutasi terposting. Pada penerimaan, lokasi asal adalah lokasi transit.
export const postedTransferRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    status: z.enum(postedTransferStatuses),
    transfer_order: z.object({ id: z.string(), number: z.string() }),
    from_location: reference,
    to_location: reference,
    transit_location: reference.nullable(),
    transfer_mode: z.enum(transferModes),
    amount: z.string(),
    posted_at: z.string(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

export const postedTransferLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item: reference.extend({ base_unit: z.string() }),
    unit: reference,
    quantity_per_unit: z.string(),
    quantity: z.string(),
    batch: z
        .object({
            id: z.string(),
            batch_number: z.string(),
            expiry_date: z.string().nullable(),
        })
        .nullable(),
    funding_source: reference.nullable(),
    procurement_program: reference.nullable(),
    budget_year: z.number().nullable(),
    amount: z.string(),
});

export const postedTransferListQuerySchema = listParametersSchema.extend({
    status: z.enum(postedTransferStatuses).optional(),
    transfer_order_id: z.string().optional(),
});
