import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Ruangan yang melayani section, dari master ruangan unit yang sama.
export const sectionRoomSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
});

// Section: poli atau titik layanan lain di satu operating unit (SIMmSection sistem lama).
export const sectionRowSchema = z.object({
    id: z.string(),
    operating_unit_id: z.string(),
    operating_unit_name: z.string(),
    name: z.string(),
    // Kode dari katalog section.kinds.ts.
    kind: z.string(),
    // Kode pendek yang kelak menjadi segmen nomor pemeriksaan.
    document_code: z.string().nullable(),
    bpjs_clinic_code: z.string().nullable(),
    // Kode dari katalog section.queue-modes.ts.
    queue_mode: z.string(),
    // Awalan nomor antrean, misalnya A untuk A-012.
    queue_prefix: z.string().nullable(),
    // Urut menurut urutan ruangan.
    rooms: z.array(sectionRoomSchema),
    // Klaster yang dilayani section. Kosong berarti section melayani semua klaster.
    clusters: z.array(
        z.object({ id: z.string(), code: z.string(), name: z.string() }),
    ),
    is_active: z.boolean(),
    version: z.number(),
});

export const sectionListQuerySchema = listParametersSchema.extend({
    operating_unit_id: z.string().optional(),
    kind: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

export const sectionInputSchema = z.object({
    operating_unit_id: z.string(),
    name: z.string(),
    kind: z.string(),
    document_code: z.string().nullable().optional(),
    bpjs_clinic_code: z.string().nullable().optional(),
    queue_mode: z.string().optional(),
    queue_prefix: z.string().nullable().optional(),
    // Ruangan yang melayani section, dikirim lengkap: yang tidak disebut lagi dilepas. Tanpa room_ids, ruangan
    // section tidak disentuh.
    room_ids: z.array(z.string()).optional(),
    // Klaster yang dilayani, dikirim lengkap seperti room_ids. Kosong berarti semua klaster.
    cluster_ids: z.array(z.string()).optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
