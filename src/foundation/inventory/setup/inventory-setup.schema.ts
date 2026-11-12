import { z } from 'zod';
import { pickingMethods, transferModes } from '../item-ledger/stock-policy.ts';

// Metode harga pokok baru FIFO; rata-rata menyusul bersama jurnal keuangan.
export const costingMethods = ['fifo'] as const;

export const inventorySetupRowSchema = z.object({
    picking_method: z.enum(pickingMethods),
    refuse_negative_stock: z.boolean(),
    transfer_mode: z.enum(transferModes),
    costing_method: z.enum(costingMethods),
    version: z.number(),
});

export const inventorySetupInputSchema = z.object({
    picking_method: z.enum(pickingMethods),
    refuse_negative_stock: z.boolean(),
    transfer_mode: z.enum(transferModes),
    costing_method: z.enum(costingMethods).optional(),
    version: z.number(),
});

// Timpaan per operating unit. picking_method kosong berarti mengikuti legal entity; version kosong berarti unit itu
// belum punya baris timpaan.
export const unitSetupRowSchema = z.object({
    operating_unit: z.object({ id: z.string(), name: z.string() }),
    picking_method: z.enum(pickingMethods).nullable(),
    version: z.number().nullable(),
});

export const unitSetupInputSchema = z.object({
    picking_method: z.enum(pickingMethods).nullable(),
    version: z.number().nullable(),
});
