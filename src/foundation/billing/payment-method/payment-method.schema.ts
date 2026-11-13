import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Jenis bayar (mJenisBayar sistem lama) milik legal entity aktif. behavior dan party adalah kode dari katalog
// payment-method.behaviors.ts.
export const paymentMethodRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    // Label di layar kasir bila beda dari nama, misalnya "Pasien BON" untuk KREDIT / BON. Kosong berarti nama.
    cashier_label: z.string().nullable(),
    sort_order: z.number(),
    behavior: z.string(),
    party: z.string(),
    requires_merchant: z.boolean(),
    requires_reference: z.boolean(),
    allows_surcharge: z.boolean(),
    takes_remainder: z.boolean(),
    counted_at_close: z.boolean(),
    shown_at_cashier: z.boolean(),
    is_active: z.boolean(),
    // IDBayar sistem lama untuk jenis bayar hasil impor.
    legacy_id: z.number().nullable(),
    version: z.number(),
});

export const paymentMethodListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const paymentMethodInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    cashier_label: z.string().nullable().optional(),
    // Layar mengirim isian teks apa adanya; service yang memeriksa bilangan bulatnya.
    sort_order: z.union([z.number(), z.string()]).optional(),
    behavior: z.string(),
    party: z.string().optional(),
    requires_merchant: z.boolean().optional(),
    requires_reference: z.boolean().optional(),
    allows_surcharge: z.boolean().optional(),
    takes_remainder: z.boolean().optional(),
    counted_at_close: z.boolean().optional(),
    shown_at_cashier: z.boolean().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});

// Bit mJenisBayar dibaca dari hasil SELECT ... FOR JSON PATH (true/false; kolom NULL tidak ditulis) atau dari ekspor
// lain yang menulis 1/0. Bit yang kosong berarti tidak menyala, sama dengan `where Active = 1` di sistem lama.
const legacyBit = z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .nullable()
    .optional()
    .transform((value) => value === true || value === 1);

export const legacyPaymentTypeSchema = z.object({
    IDBayar: z.number().int(),
    Description: z.string(),
    NoUrut: z.number().int().nullable().optional(),
    Kode: z.string().nullable().optional(),
    Cash: legacyBit,
    Bank: legacyBit,
    CC: legacyBit,
    Jaminan: legacyBit,
    Others: legacyBit,
    Active: legacyBit,
});
export type LegacyPaymentType = z.infer<typeof legacyPaymentTypeSchema>;

export const legacyImportInputSchema = z.object({
    rows: z.array(legacyPaymentTypeSchema).min(1),
});

export const legacyImportResultSchema = z.object({
    legacy_id: z.number(),
    legacy_name: z.string(),
    imported: z.boolean(),
    code: z.string().nullable(),
    behavior: z.string().nullable(),
    notes: z.array(z.string()),
});
