import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { entryKinds } from './item-ledger.posting.ts';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const batch = z
    .object({
        id: z.string(),
        batch_number: z.string(),
        expiry_date: z.string().nullable(),
    })
    .nullable();

export const stockQuerySchema = listParametersSchema.extend({
    item_id: z.string().optional(),
    location_id: z.string().optional(),
});

export const stockRowSchema = z.object({
    id: z.string(),
    item: reference.extend({ unit: z.string() }),
    location: reference,
    batch,
    quantity: z.string(),
});

export const ledgerQuerySchema = listParametersSchema.extend({
    item_id: z.string(),
    location_id: z.string().optional(),
    batch_id: z.string().optional(),
    kind: z.enum(entryKinds).optional(),
    from: z.string(),
    to: z.string(),
});

export const ledgerRowSchema = z.object({
    id: z.string(),
    posting_date: z.string(),
    kind: z.enum(entryKinds),
    document: z.object({
        type: z.string(),
        id: z.string(),
        number: z.string().nullable(),
    }),
    location: reference,
    batch,
    quantity: z.string(),
    // Bagian baris yang belum diterapkan: stok yang masih ada pada baris masuk, atau kekurangan pada baris keluar.
    remaining_quantity: z.string(),
    cost_amount: z.string(),
    // Saldo berjalan sejak opening_balance atas baris yang lolos saringan.
    balance: z.string(),
    reversed_entry_id: z.string().nullable(),
});
