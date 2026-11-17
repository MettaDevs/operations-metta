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

// Siapa, kapan, dan mengapa harga atau biaya diubah dari hitungan sistem. Kosong bila sama dengan hitungan.
export const priceChangeSchema = z
    .object({ by: z.string(), at: z.string(), reason: z.string() })
    .nullable();

// Harga baris yang disalin saat disiapkan: harga per satuan baris dengan angka di belakang koma menurut setelan farmasi,
// % diskon, dan nilai baris, semuanya yang dipakai. computed_* adalah hitungan sistem saat Siapkan.
export const dispensingPriceSchema = z.object({
    unit_price: z.string(),
    discount_percent: z.string(),
    amount: z.string(),
    computed_unit_price: z.string(),
    computed_discount_percent: z.string(),
    changed: priceChangeSchema,
});

// Siapa yang menyetujui obat resep diganti: Permenkes 68/2010 Pasal 7, "atas persetujuan dokter dan/atau pasien".
export const substitutionConsents = [
    'dokter',
    'pasien',
    'dokter_dan_pasien',
] as const;

const unitOption = reference.extend({ quantity_per_unit: z.string() });

// Obat resep yang diganti obat pengganti (Originally Ordered No. BC). by dan at kosong pada usulan dari penyerahan yang
// dibatalkan, karena penggantiannya baru tercatat saat disimpan lagi.
export const substitutionSchema = z.object({
    prescribed_item: reference,
    consent: z.enum(substitutionConsents),
    reason: z.string(),
    by: z.string().nullable(),
    at: z.string().nullable(),
});

// Baris penyerahan untuk satu baris obat resep. id kosong berarti usulan untuk penyerahan yang belum disimpan: jumlah
// dan satuan resep, batch diambil otomatis. taken: batch yang benar-benar diambil saat disiapkan, dari kartu gudang.
// item adalah obat yang diserahkan, dan units satuan obat itu. item_options: obat yang boleh diserahkan untuk baris
// ini selama belum disiapkan, obat resep lebih dulu lalu obat penggantinya; kosong bila obat resep tidak punya
// pengganti atau sesudah disiapkan.
export const dispensingLineSchema = z.object({
    id: z.string().nullable(),
    prescription_line_id: z.string(),
    item: reference,
    substitution: substitutionSchema.nullable(),
    item_options: z.array(
        z.object({
            item: reference,
            is_prescribed: z.boolean(),
            notes: z.string().nullable(),
            units: z.array(unitOption),
        }),
    ),
    quantity: z.string(),
    unit: reference,
    quantity_per_unit: z.string(),
    units: z.array(unitOption),
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
                // Obat yang diserahkan; kosong berarti obat resep. Obat lain wajib obat pengganti obat resep, dengan
                // persetujuan dan alasannya.
                item_id: z.string().nullable().optional(),
                substitution_consent: z.string().nullable().optional(),
                substitution_reason: z.string().nullable().optional(),
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

const decimal = z.union([z.string(), z.number()]);

// Ubah harga sesudah Siapkan: harga satuan dan % diskon per baris penyerahan, dan nilai per baris biaya racik atau resep.
// Baris yang tidak dikirim tidak berubah. reason berlaku untuk setiap baris yang berbeda dengan hitungan sistem.
export const dispensingPriceInputSchema = z.object({
    reason: z.string().nullable().optional(),
    lines: z
        .array(
            z.object({
                id: z.string(),
                unit_price: decimal,
                discount_percent: decimal,
            }),
        )
        .max(200)
        .optional(),
    fees: z
        .array(z.object({ id: z.string(), amount: decimal }))
        .max(200)
        .optional(),
    version: z.number(),
});

// receiver_name wajib bila obat diterima orang lain dan ditolak bila diterima pasien sendiri; service yang memeriksanya,
// supaya kedua kasus mendapat pesannya sendiri.
export const handOverInputSchema = z.object({
    pharmacist_id: z.string().nullable().optional(),
    received_by_patient: z.boolean(),
    receiver_name: z.string().nullable().optional(),
    version: z.number(),
});

// Batal resep. version adalah versi penyerahan aktif yang dilihat layar, atau null bila resep belum punya penyerahan,
// supaya resep yang disiapkan orang lain sesudah layar dimuat tidak ikut dibatalkan tanpa terlihat.
export const prescriptionCancelInputSchema = z.object({
    reason: z.string(),
    version: z.number().nullable(),
});
