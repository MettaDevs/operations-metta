import { z } from 'zod';
import { decimalInput } from '@core/foundation/inventory/index.ts';
import { idSchema, listParametersSchema } from '@core/platform/http/index.ts';

// Isi event healthcare.prescription.issued.v1 yang dibaca module ini, menurut kontrak
// contracts/events/healthcare.prescription.issued.v1.yaml. Module tidak meng-import module lain, jadi bentuknya ditulis
// di sini dan diuji terhadap berkas kontrak itu. Field yang tidak dikenal dilewati, supaya field opsional baru di versi
// yang sama tidak membuat resep terlewat.
const decimalText = z.string().regex(/^[0-9]+(\.[0-9]+)?$/);
const positiveDecimal = decimalText.refine((value) => {
    const parsed = decimalInput(value);
    return parsed !== null && parsed > 0n;
});
const positiveSmallint = z.number().int().min(1).max(32767);
// Panjang teks mengikuti kolom far_tr_resep; teks yang lebih panjang membuat resep dilewati, bukan gagal disimpan.
const text = (max: number) => z.string().max(max);
const reference = z.object({
    id: idSchema,
    code: text(50),
    name: text(200),
});
const issuedLineSchema = z.object({
    id: idSchema,
    order: z.number().int().min(1),
    item: reference.nullable(),
    compound: z.number().int().min(1).nullable(),
    quantity: decimalText.nullable(),
    unit: reference.nullable(),
    // Pesan yang belum membawanya ditulis dalam satuan dasar, jadi isinya 1.
    quantity_per_unit: positiveDecimal.nullable().optional(),
    requested_quantity: decimalText.nullable(),
    signa: text(100).nullable(),
    usage_instruction: text(150).nullable(),
    // Dosis yang ditulis dokter. Pesan yang belum membawanya ditulis sebelum dosis dicatat, jadi tanpa dosis.
    frequency_per_day: positiveSmallint.nullable().optional(),
    dose: positiveDecimal.nullable().optional(),
    dose_unit: reference.nullable().optional(),
    route: z
        .object({ code: text(40), name: text(150) })
        .nullable()
        .optional(),
    duration_days: positiveSmallint.nullable().optional(),
    notes: text(500).nullable(),
});
export const issuedPrescriptionSchema = z.object({
    legal_entity_id: idSchema,
    org_unit_id: idSchema,
    data: z.object({
        prescription_id: idSchema,
        prescription_number: text(60).min(1),
        registration_number: text(60).min(1),
        issued_at: z.iso.datetime(),
        notes: text(500).nullable(),
        patient: z.object({
            id: idSchema,
            medical_record_number: text(60),
            name: text(200),
            birth_date: z.iso.date().nullable(),
            // KTP kunjungan untuk grading harga obat. Pesan yang belum membawanya dianggap KTP, bawaan sistem lama.
            ktp: z.boolean().optional(),
        }),
        doctor: z.object({ id: idSchema, name: text(200) }).nullable(),
        section: z.object({ id: idSchema, name: text(150) }),
        // Kelompok harga pembeli untuk harga obat saat disiapkan. Pesan yang belum membawanya dihargai tanpa kelompok.
        price_group: reference.nullable().optional(),
        lines: z
            .array(issuedLineSchema)
            .min(1)
            .refine(
                (lines) =>
                    lines.some((line) => line.item !== null) &&
                    lines.every(
                        (line) =>
                            (line.item !== null && line.quantity !== null) ||
                            (line.item === null && line.compound !== null),
                    ),
                'Resep berisi sedikitnya satu obat, dan setiap baris adalah obat berjumlah atau kepala racikan.',
            ),
    }),
});
export type IssuedPrescription = z.infer<typeof issuedPrescriptionSchema>;

// Antrean resep di farmasi. Lokasi yang melayani: pilihan petugas farmasi di resep itu, lalu Lokasi layanan resep
// untuk section asalnya, lalu bawaan operating unit-nya; kosong bila belum ada yang mengaturnya.
const locationSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
// Status resep di antrean: menunggu (belum disiapkan, termasuk yang drafnya sudah disimpan), lalu status penyerahannya.
export const queueStatuses = [
    'menunggu',
    'disiapkan',
    'dipanggil',
    'diserahkan',
] as const;
export type QueueStatus = (typeof queueStatuses)[number];

export const prescriptionRowSchema = z.object({
    id: z.string(),
    prescription_number: z.string(),
    registration_number: z.string(),
    issued_at: z.string(),
    received_at: z.string(),
    patient_name: z.string(),
    medical_record_number: z.string(),
    birth_date: z.string().nullable(),
    doctor_name: z.string().nullable(),
    section_name: z.string(),
    operating_unit_name: z.string(),
    location: locationSchema.nullable(),
    item_count: z.number(),
    version: z.number(),
    queue_status: z.enum(queueStatuses),
    dispensing_status: z
        .enum(['draf', 'disiapkan', 'dipanggil', 'diserahkan'])
        .nullable(),
    dispensing_number: z.string().nullable(),
    dispensing_version: z.number().nullable(),
    called_at: z.string().nullable(),
    handed_over_at: z.string().nullable(),
});

export const prescriptionLineSchema = z.object({
    id: z.string(),
    order: z.number(),
    item: locationSchema.nullable(),
    compound: z.number().nullable(),
    quantity: z.string().nullable(),
    unit: locationSchema.nullable(),
    quantity_per_unit: z.string().nullable(),
    requested_quantity: z.string().nullable(),
    signa: z.string().nullable(),
    usage_instruction: z.string().nullable(),
    frequency_per_day: z.number().nullable(),
    dose: z.string().nullable(),
    dose_unit: locationSchema.nullable(),
    route: z.object({ code: z.string(), name: z.string() }).nullable(),
    duration_days: z.number().nullable(),
    notes: z.string().nullable(),
});

export const prescriptionSchema = prescriptionRowSchema.extend({
    notes: z.string().nullable(),
    lines: z.array(prescriptionLineSchema),
});

// location: id lokasi stok, atau `none` untuk resep yang belum punya lokasi. date: tanggal resep diterbitkan menurut
// zona waktu legal entity.
export const prescriptionListQuerySchema = listParametersSchema.extend({
    location: z.string().max(100).optional(),
    date: z.string().max(10).optional(),
    status: z.enum(queueStatuses).optional(),
});
