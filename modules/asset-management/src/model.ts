import { z } from 'zod';
import { validation } from '@core/platform/errors.ts';
import { dateSchema, idSchema, nullableText } from '@core/platform/model.ts';
import { Decimal } from '@core/platform/money.ts';

const amountInput = z
    .union([z.string(), z.number()])
    .transform((input, context) => {
        try {
            const decimal = Decimal.of(
                typeof input === 'number' ? input.toFixed(10) : input,
            );
            if (decimal.compare(Decimal.of('0')) < 0)
                throw new Error('Negative amount.');
            return decimal.normalized();
        } catch {
            context.addIssue({
                code: 'custom',
                message:
                    'The value must be a number greater than or equal to 0.',
            });
            return z.NEVER;
        }
    });
const optionalId = idSchema.nullable().optional().default(null);
const optionalString = (length: number) =>
    z.string().max(length).nullable().optional().default(null);
export const attributeInputSchema = z.object({
    tipe_atribut_id: idSchema,
    nilai: z.json(),
});
const detailInputSchema = z.object({
    nama: z.string().min(1).max(150),
    group_aset_id: idSchema,
    jenis_aset_id: idSchema,
    kondisi_aset_id: optionalId,
    pabrikan_aset_id: optionalId,
    model_aset_id: optionalId,
    model_number: optionalString(150),
    jumlah: z.coerce.number().int().min(1).max(500),
    nilai_per_unit: amountInput,
    ppn_per_unit: amountInput
        .nullable()
        .optional()
        .transform((value) => value ?? '0'),
    residu_per_unit: amountInput
        .nullable()
        .optional()
        .transform((value) => value ?? '0'),
    akumulasi_per_unit: amountInput
        .nullable()
        .optional()
        .transform((value) => value ?? '0'),
    periode_berjalan: z.coerce
        .number()
        .int()
        .min(0)
        .max(1200)
        .nullable()
        .optional()
        .transform((value) => value ?? 0),
    saldo_awal_buku: z
        .array(
            z.object({
                buku_id: idSchema,
                akumulasi_per_unit: amountInput,
                periode_berjalan: z.coerce.number().int().min(0).max(1200),
            }),
        )
        .nullable()
        .optional()
        .default(null),
    permintaan_pembelian_detail_id: optionalId,
    atribut: z.array(attributeInputSchema).optional().default([]),
    keterangan: optionalString(2000),
});
export const receiptInputSchema = z.object({
    legal_entity_id: idSchema,
    responsible_org_unit_id: optionalId,
    receiving_org_unit_id: optionalId,
    tanggal: dateSchema,
    tanggal_siap_pakai: dateSchema.nullable().optional().default(null),
    diterima_oleh_user_id: optionalString(64),
    penanggung_jawab_user_id: optionalString(64),
    lokasi_aset_id: optionalId,
    currency_code: z.string().length(3),
    keterangan: optionalString(2000),
    cara_perolehan: z
        .enum(['pembelian', 'hibah', 'saldo_awal'])
        .optional()
        .default('pembelian'),
    vendor_id: optionalId,
    vendor_invoice_reference: optionalString(80),
    purchase_order_reference: optionalString(80),
    vendor_invoice_date: dateSchema.nullable().optional().default(null),
    details: z.preprocess(
        (value) =>
            value && typeof value === 'object' && !Array.isArray(value)
                ? Object.values(value)
                : value,
        z.array(detailInputSchema).min(1),
    ),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;
export type DetailInput = z.infer<typeof detailInputSchema>;

export function parseReceipt(value: unknown): ReceiptInput {
    const result = receiptInputSchema.safeParse(value);
    if (!result.success)
        validation(
            Object.fromEntries(
                result.error.issues.map((issue) => [
                    issue.path.join('.'),
                    issue.message,
                ]),
            ),
        );
    if (
        result.data.tanggal_siap_pakai !== null &&
        result.data.tanggal_siap_pakai < result.data.tanggal
    )
        validation({
            tanggal_siap_pakai:
                'The tanggal siap pakai field must be a date after or equal to tanggal.',
        });
    return result.data;
}

export const headerSchema = z
    .object({
        id: z.string(),
        tenant_id: z.string(),
        creation_key: z.string(),
        kode: z.string(),
        legal_entity_id: z.string(),
        responsible_org_unit_id: z.string(),
        receiving_org_unit_id: nullableText,
        tanggal: z.string(),
        tanggal_siap_pakai: nullableText,
        diterima_oleh_user_id: nullableText,
        penanggung_jawab_user_id: nullableText,
        lokasi_aset_id: nullableText,
        currency_code: z.string(),
        keterangan: nullableText,
        status: z.string(),
        version: z.number(),
        deleted_at: nullableText,
        created_at: z.string(),
        updated_at: z.string(),
        cara_perolehan: z.string(),
        vendor_id: nullableText,
        vendor_invoice_reference: nullableText,
        vendor_invoice_date: nullableText,
        created_by_user_id: z.coerce.number().nullable(),
        updated_by_user_id: z.coerce.number().nullable(),
        purchase_order_reference: nullableText,
    })
    .catchall(z.json());
export type ReceiptHeader = z.infer<typeof headerSchema>;
export const detailSchema = z
    .object({
        id: z.string(),
        tenant_id: z.string(),
        penerimaan_aset_id: z.string(),
        line_number: z.number(),
        nama: z.string(),
        group_aset_id: z.string(),
        jenis_aset_id: z.string(),
        kondisi_aset_id: nullableText,
        pabrikan_aset_id: nullableText,
        model_aset_id: nullableText,
        model_number: nullableText,
        jumlah: z.number(),
        nilai_per_unit: z.string(),
        residu_per_unit: z.string(),
        permintaan_pembelian_detail_id: nullableText,
        atribut: z
            .array(attributeInputSchema)
            .nullable()
            .transform((value) => value ?? []),
        keterangan: nullableText,
        created_at: z.string(),
        updated_at: z.string(),
        ppn_per_unit: z.string(),
        akumulasi_per_unit: z.string(),
        periode_berjalan: z.number(),
        saldo_awal_buku: z.json(),
        created_by_user_id: z.coerce.number().nullable(),
        updated_by_user_id: z.coerce.number().nullable(),
        version: z.number(),
    })
    .catchall(z.json());
export type ReceiptDetail = z.infer<typeof detailSchema>;

export const assetSchema = z.object({
    id: z.string(),
    kode: z.string(),
    nama: z.string(),
    legal_entity_id: z.string(),
    responsible_org_unit_id: nullableText,
    group_aset_id: z.string(),
    kelompok_harta_fiskal_id: nullableText,
    jenis_aset_id: z.string(),
    kondisi_aset_id: nullableText,
    pabrikan_aset_id: nullableText,
    model_aset_id: nullableText,
    induk_aset_id: nullableText,
    lokasi_aset_id: nullableText,
    financial_dimension_org_unit_id: nullableText,
    serial_number: nullableText,
    model_number: nullableText,
    acquired_on: z.string(),
    placed_in_service_on: nullableText,
    acquisition_value: z.string(),
    currency_code: z.string(),
    lifecycle_state: z.string(),
    is_budgeted: z.boolean(),
    keterangan: nullableText,
    version: z.number(),
});
export type AssetView = z.infer<typeof assetSchema>;
