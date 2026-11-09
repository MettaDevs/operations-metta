import { z } from 'zod';

// Slug tenant menjadi label alamat `<tenant>.<base>`, jadi bentuknya mengikuti label DNS.
const label = z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Slug harus label DNS.');

// Satu lingkungan yang disiapkan: database-nya (null berarti database bersama runtime), customer, tenant, dan admin
// pertama. Id datang dari control plane, pemilik registrinya, sehingga penyiapan yang diulang menemukan tenant yang
// sama dan tidak membuat apa pun lagi.
export const provisionRequestSchema = z.object({
    database: z
        .string()
        .regex(
            /^[a-z][a-z0-9_]{0,62}$/,
            'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
        )
        .nullable(),
    client: z.object({
        id: z.uuid(),
        legal_name: z.string().trim().min(1).max(255),
        slug: label,
    }),
    tenant: z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(255),
        slug: label,
    }),
    admin: z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(255),
        email: z.email().max(255).toLowerCase(),
        password_hash: z.string().regex(/^\$2[aby]\$\d\d\$/, 'Hash bcrypt.'),
    }),
});
export type ProvisionRequest = z.infer<typeof provisionRequestSchema>;
