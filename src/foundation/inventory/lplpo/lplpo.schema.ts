import { z } from 'zod';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Cakupan laporan satu lokasi (location_id) atau semua lokasi satu operating unit di legal entity aktif
// (operating_unit_id); tepat satu yang diisi. Kategori ikut subkategorinya.
export const lplpoQuerySchema = z.object({
    from: z.string(),
    to: z.string(),
    location_id: z.string().optional(),
    operating_unit_id: z.string().optional(),
    category_id: z.string().optional(),
});

// Satu baris per barang, semua jumlah dalam satuan dasar. available = opening + receipts. closing = available - usage +
// adjustment, sama dengan jumlah kartu gudang cakupan itu sampai akhir periode. receipts_by_funding berisi setiap
// sumber dana di funding_sources (0 bila tidak ada), dan bersama receipts_without_funding berjumlah receipts.
// optimum adalah jumlah stok maksimum barang di lokasi cakupan, kosong bila belum ditetapkan; suggested adalah
// optimum - closing, tidak kurang dari 0.
export const lplpoRowSchema = z.object({
    item: reference.extend({ unit: z.string() }),
    category: reference.nullable(),
    opening: z.string(),
    receipts: z.string(),
    receipts_by_funding: z.record(z.string(), z.string()),
    receipts_without_funding: z.string(),
    available: z.string(),
    usage: z.string(),
    adjustment: z.string(),
    closing: z.string(),
    optimum: z.string().nullable(),
    requested: z.string(),
    suggested: z.string().nullable(),
});

export const lplpoSchema = z.object({
    funding_sources: z.array(reference),
    rows: z.array(lplpoRowSchema),
});
