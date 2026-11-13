import { z } from 'zod';

const reference = z.object({ id: z.string(), name: z.string() });

// Satu baris Lokasi layanan resep. section kosong berarti lokasi bawaan operating unit itu.
export const serviceLocationRowSchema = z.object({
    id: z.string(),
    operating_unit: reference,
    section: reference.nullable(),
    location: reference.extend({ code: z.string() }),
    // Obat termasuk jasa (IncludeJasa sistem lama): bernilai 0 di tagihan kasir.
    includes_service: z.boolean(),
    version: z.number(),
});

export const serviceLocationInputSchema = z.object({
    operating_unit_id: z.string(),
    section_id: z.string().nullable(),
    location_id: z.string(),
    includes_service: z.boolean().optional(),
    version: z.number().optional(),
});

export const lookupRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

export const sectionRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    operating_unit_name: z.string(),
});
