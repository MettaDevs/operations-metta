import { z } from 'zod';
import { nullableText } from '@core/platform/http/index.ts';

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
