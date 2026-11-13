import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

const defaultUnit = reference.extend({ quantity_per_unit: z.string() });

// refuse_negative_stock kosong berarti mengikuti parameter persediaan legal entity. inventory adalah stok di semua
// lokasi dalam satuan dasar. has_entries berarti barang sudah punya kartu gudang, sehingga profil pelacakannya terkunci.
// has_open_entries berarti masih ada baris kartu gudang dengan sisa, sehingga satuan dasarnya terkunci; begitu semua
// sisa tertutup, satuan dasar boleh diganti lagi.
export const itemRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    base_unit: reference,
    // Satuan beli dan satuan jual bawaan (Purch. dan Sales Unit of Measure di BC) beserta isinya dalam satuan dasar.
    // Tanpa pilihan berarti satuan dasar, yang isinya 1.
    purchase_unit: defaultUnit,
    sales_unit: defaultUnit,
    category: reference.nullable(),
    tracking_code: reference.nullable(),
    // Dari profil pelacakan, supaya dokumen tahu kapan nomor batch dan kedaluwarsa wajib diisi.
    batch_required: z.boolean(),
    expiry_required: z.boolean(),
    refuse_negative_stock: z.boolean().nullable(),
    is_blocked: z.boolean(),
    // Harga dasar per satuan dasar (Harga_Jual sistem lama), dinaikkan posting penerimaan ke harga beli tertinggi per
    // satuan dasar dan boleh diubah tangan. Harga jual obat dihitung dari harga ini.
    base_price: z.string(),
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
// purchase_unit_id dan sales_unit_id yang tidak dikirim berarti satuan dasar saat membuat dan tetap saat mengubah.
// base_price yang tidak dikirim berarti 0 saat membuat dan tetap saat mengubah, jadi kartu obat layanan kesehatan yang
// menulis barang lewat updateItem tidak menghapusnya.
export const itemInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    base_unit_id: z.string(),
    purchase_unit_id: z.string().nullable().optional(),
    sales_unit_id: z.string().nullable().optional(),
    category_id: z.string().nullable().optional(),
    tracking_code_id: z.string().nullable().optional(),
    refuse_negative_stock: z.boolean().nullable().optional(),
    is_blocked: z.boolean().optional(),
    base_price: z.union([z.number(), z.string()]).optional(),
    version: z.number().optional(),
});

export const batchRowSchema = z.object({
    id: z.string(),
    batch_number: z.string(),
    expiry_date: z.string().nullable(),
});
