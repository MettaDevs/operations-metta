import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Data obat farmasi: perluasan barang persediaan Core (far_m_obat, id sama dengan barang). Kode, nama, dan satuan dasar
// dibaca dari barang; golongan, generik, dan formularium milik module ini. version 0 berarti barang ini belum pernah
// diberi data farmasi.
export const drugRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    base_unit_name: z.string(),
    drug_class: z
        .object({ id: z.string(), code: z.string(), name: z.string() })
        .nullable(),
    is_generic: z.boolean(),
    is_formulary: z.boolean(),
    is_blocked: z.boolean(),
    version: z.number(),
});

// drug_class: id golongan, atau `none` untuk barang yang belum digolongkan.
export const drugListQuerySchema = listParametersSchema.extend({
    drug_class: z.string().max(100).optional(),
    generic: z.enum(['true', 'false']).optional(),
    formulary: z.enum(['true', 'false']).optional(),
});

export const drugInputSchema = z.object({
    drug_class_id: z.string().nullable(),
    is_generic: z.boolean(),
    is_formulary: z.boolean(),
    version: z.number(),
});
