import { z } from 'zod';

// Angka dari API berupa teks desimal tanpa nol di belakang koma.
const amount = z.string();

// Satu komponen baris harga (SIMdListHargaDetail). Komponen dikenali dari komponen biayanya: sekali per baris harga.
export const priceComponentRowSchema = z.object({
    charge_component_id: z.string(),
    charge_component_code: z.string(),
    charge_component_name: z.string(),
    quantity: amount,
    initial_price: amount,
    previous_price: amount,
    tax_deposit_percent: amount,
    incentive_percent: amount,
    includes_incentive: z.boolean(),
    new_price: amount,
    previous_hc_price: amount,
    new_hc_price: amount,
    hc_incentive_percent: amount,
    previous_bpjs_price: amount,
    new_bpjs_price: amount,
});

// Satu baris harga tindakan (SIMdListHarga). Kunci kosong berarti wildcard sistem lama: kelas XX, spesialis ALL,
// dokter None, kategori operasi ALL. Harga lama dan baru (umum, HC, BPJS) adalah jumlah komponennya.
export const procedurePriceRowSchema = z.object({
    id: z.string(),
    price_group_id: z.string(),
    price_group_name: z.string(),
    care_class_id: z.string().nullable(),
    care_class_name: z.string().nullable(),
    specialty_id: z.string().nullable(),
    specialty_name: z.string().nullable(),
    sub_specialty: z.boolean(),
    doctor_id: z.string().nullable(),
    doctor_name: z.string().nullable(),
    operation_category_id: z.string().nullable(),
    operation_category_name: z.string().nullable(),
    ktp_patient: z.boolean(),
    cito: z.boolean(),
    // Kode dari priceLocations di procedure-price.options.ts.
    location: z.string(),
    detail_incentive: amount,
    component_incentive: amount,
    previous_price: amount,
    new_price: amount,
    previous_hc_price: amount,
    new_hc_price: amount,
    hc_discount_percent: amount,
    new_price_date: z.string(),
    previous_bpjs_price: amount,
    new_bpjs_price: amount,
    new_bpjs_price_date: z.string().nullable(),
    components: z.array(priceComponentRowSchema),
});

// Teks desimal (12.5) atau angka; kosong berarti 0.
const numberInput = z.union([z.string(), z.number()]).nullable().optional();
const idInput = z.string().nullable().optional();

export const priceComponentInputSchema = z.object({
    charge_component_id: z.string().nullable().optional(),
    quantity: numberInput,
    initial_price: numberInput,
    previous_price: numberInput,
    tax_deposit_percent: numberInput,
    incentive_percent: numberInput,
    includes_incentive: z.boolean().optional(),
    new_price: numberInput,
    previous_hc_price: numberInput,
    new_hc_price: numberInput,
    hc_incentive_percent: numberInput,
    previous_bpjs_price: numberInput,
    new_bpjs_price: numberInput,
});

// Harga baris tidak dikirim: server menjumlahkannya dari komponen.
export const procedurePriceInputSchema = z.object({
    // Baris harga tindakan ini yang sudah tersimpan; kosong untuk baris baru.
    id: idInput,
    price_group_id: idInput,
    care_class_id: idInput,
    specialty_id: idInput,
    sub_specialty: z.boolean().optional(),
    doctor_id: idInput,
    operation_category_id: idInput,
    ktp_patient: z.boolean().optional(),
    cito: z.boolean().optional(),
    location: z.string().optional(),
    detail_incentive: numberInput,
    component_incentive: numberInput,
    hc_discount_percent: numberInput,
    new_price_date: z.string().nullable().optional(),
    new_bpjs_price_date: z.string().nullable().optional(),
    components: z.array(priceComponentInputSchema).optional(),
});
