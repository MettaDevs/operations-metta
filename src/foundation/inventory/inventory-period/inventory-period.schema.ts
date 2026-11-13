import { z } from 'zod';

const stamp = z
    .object({ at: z.string(), user_name: z.string().nullable() })
    .nullable();

// Pengguna yang menutup atau membuka lagi periode ditampilkan dengan namanya. Keduanya kosong bila belum pernah terjadi.
export const inventoryPeriodRowSchema = z.object({
    id: z.string(),
    ending_date: z.string(),
    name: z.string(),
    closed: z.boolean(),
    closed_stamp: stamp,
    reopened_stamp: stamp,
    version: z.number(),
});

// Nama kosong diisi bulan dan tahun tanggal akhirnya, seperti Name di BC.
export const inventoryPeriodInputSchema = z.object({
    ending_date: z.iso.date(),
    name: z.string().nullable().optional(),
    version: z.number().optional(),
});
