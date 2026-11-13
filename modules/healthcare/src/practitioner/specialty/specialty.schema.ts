import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Spesialis tenaga kesehatan beserta sub spesialisnya (SIMmSpesialisasi dan SIMmSubSpesialis sistem lama). Dipilih di
// kartu nakes, dan kelak menjadi kunci tarif tindakan.
export const specialtyRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    subspecialties: z.array(z.object({ id: z.string(), name: z.string() })),
    version: z.number(),
});

export const specialtyListQuerySchema = listParametersSchema;

// Sub spesialis dikirim lengkap: baris tanpa id ditambah, baris yang tidak disebut lagi dihapus. Tanpa subspecialties,
// sub spesialis tidak disentuh.
export const specialtyInputSchema = z.object({
    name: z.string(),
    subspecialties: z
        .array(
            z.object({
                id: z.string().nullable().optional(),
                name: z.string(),
            }),
        )
        .optional(),
    version: z.number().optional(),
});
