import { z } from 'zod';

// Status penyerahan, berurutan seperti alur sistem lama: SiapDiserahkan, panggil (Panggil_Date), SudahDiserahkan
// (Serahkan_Date). dibatalkan adalah penyiapan yang dibalik sebelum diserahkan.
export const dispensingStatuses = [
    'draf',
    'disiapkan',
    'dipanggil',
    'diserahkan',
    'dibatalkan',
] as const;
export type DispensingStatus = (typeof dispensingStatuses)[number];

const person = z.object({ id: z.string(), name: z.string() }).nullable();
const batch = z.object({
    id: z.string(),
    batch_number: z.string(),
    expiry_date: z.string().nullable(),
});

export const dispensingHeaderSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(dispensingStatuses),
    location: z
        .object({ id: z.string(), code: z.string(), name: z.string() })
        .nullable(),
    posting_date: z.string().nullable(),
    notes: z.string().nullable(),
    pharmacist: person,
    assistant: person,
    prepared_at: z.string().nullable(),
    prepared_by: person,
    called_at: z.string().nullable(),
    handed_over_at: z.string().nullable(),
    handed_over_by: person,
    // Penerima obat, dicatat saat Serahkan; kosong sebelum diserahkan dan pada penyerahan sebelum kolomnya ada.
    received_by_patient: z.boolean().nullable(),
    receiver_name: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    // Jumlah nilai baris; kosong selama penyerahan belum disiapkan.
    total_amount: z.string().nullable(),
    version: z.number(),
});

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Harga baris yang disalin saat disiapkan: harga per satuan baris dengan angka di belakang koma menurut setelan farmasi,
// % diskon, dan nilai baris.
export const dispensingPriceSchema = z.object({
    unit_price: z.string(),
    discount_percent: z.string(),
    amount: z.string(),
});

// Baris penyerahan untuk satu baris obat resep. id kosong berarti usulan untuk penyerahan yang belum disimpan: jumlah
// dan satuan resep, batch diambil otomatis. taken: batch yang benar-benar diambil saat disiapkan, dari kartu gudang.
export const dispensingLineSchema = z.object({
    id: z.string().nullable(),
    prescription_line_id: z.string(),
    quantity: z.string(),
    unit: reference,
    quantity_per_unit: z.string(),
    units: z.array(reference.extend({ quantity_per_unit: z.string() })),
    batch: batch.nullable(),
    reason: z.string().nullable(),
    // Kosong selama baris belum disiapkan.
    price: dispensingPriceSchema.nullable(),
    taken: z.array(
        z.object({
            batch_number: z.string().nullable(),
            expiry_date: z.string().nullable(),
            quantity: z.string(),
        }),
    ),
});
export type DispensingLine = z.infer<typeof dispensingLineSchema>;

export const dispensingInputSchema = z.object({
    location_id: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    pharmacist_id: z.string().nullable().optional(),
    assistant_id: z.string().nullable().optional(),
    lines: z
        .array(
            z.object({
                prescription_line_id: z.string(),
                quantity: z.union([z.string(), z.number()]),
                // Kosong berarti satuan resep.
                unit_id: z.string().nullable().optional(),
                batch_id: z.string().nullable().optional(),
                reason: z.string().nullable().optional(),
            }),
        )
        .max(200),
    version: z.number().optional(),
});

export const versionInputSchema = z.object({ version: z.number() });

// receiver_name wajib bila obat diterima orang lain dan ditolak bila diterima pasien sendiri; service yang memeriksanya,
// supaya kedua kasus mendapat pesannya sendiri.
export const handOverInputSchema = z.object({
    pharmacist_id: z.string().nullable().optional(),
    received_by_patient: z.boolean(),
    receiver_name: z.string().nullable().optional(),
    version: z.number(),
});
