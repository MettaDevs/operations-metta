import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// refuse_negative_stock kosong berarti mengikuti parameter persediaan legal entity. inventory adalah stok di semua
// lokasi dalam satuan dasar. has_entries berarti barang sudah punya kartu gudang, sehingga profil pelacakannya terkunci.
// has_open_entries berarti masih ada baris kartu gudang dengan sisa, sehingga satuan dasarnya terkunci; begitu semua
// sisa tertutup, satuan dasar boleh diganti lagi.
export const itemRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    base_unit: reference,
    category: reference.nullable(),
    tracking_code: reference.nullable(),
    // Dari profil pelacakan, supaya dokumen tahu kapan nomor batch dan kedaluwarsa wajib diisi.
    batch_required: z.boolean(),
    expiry_required: z.boolean(),
    refuse_negative_stock: z.boolean().nullable(),
    is_blocked: z.boolean(),
    inventory: z.string(),
    has_entries: z.boolean(),
    has_open_entries: z.boolean(),
    version: z.number(),
});

export const itemListQuerySchema = listParametersSchema.extend({
    category_id: z.string().optional(),
    blocked: z.enum(['true', 'false']).optional(),
});

// tracking_code_id yang tidak dikirim saat membuat barang disalin dari kategorinya; saat mengubah, berarti tetap.
export const itemInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    base_unit_id: z.string(),
    category_id: z.string().nullable().optional(),
    tracking_code_id: z.string().nullable().optional(),
    refuse_negative_stock: z.boolean().nullable().optional(),
    is_blocked: z.boolean().optional(),
    version: z.number().optional(),
});

export const batchRowSchema = z.object({
    id: z.string(),
    batch_number: z.string(),
    expiry_date: z.string().nullable(),
});
