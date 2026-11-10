import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { reservedLabels } from './address.ts';
import { assertEnvironmentDatabase, connect } from './provision.service.ts';

// Produksi tidak pernah dibuang lewat worker, jadi jenisnya ditolak sejak parameter dibaca.
export const purgeRequestSchema = z.strictObject({
    tenant_slug: z
        .string()
        .regex(
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
            'Slug harus label DNS.',
        )
        .refine(
            (slug) => !reservedLabels.has(slug),
            'Slug ini dipakai layanan lain.',
        ),
    kind: z.enum(['sandbox', 'demo']),
    database: z
        .string()
        .regex(
            /^[a-z][a-z0-9_]{0,62}$/,
            'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
        )
        .nullable(),
});
export type PurgeRequest = z.infer<typeof purgeRequestSchema>;

// Satu-satunya operasi yang tidak dapat dibatalkan: database lingkungan dibuang permanen. Alamatnya tetap tercatat
// nonaktif sebagai nisan. Penjaga terakhirnya ada di sini: database yang masih ditunjuk alamat aktif mana pun, termasuk
// alamat lingkungan ini sendiri yang sudah dipulihkan, tidak pernah dibuang. Database null berarti database bersama
// runtime, yang memuat tenant lain, jadi tidak ada yang dibuang. `IF EXISTS` membuatnya aman diulang, dan `FORCE`
// memutus sesi yang masih menempel supaya satu koneksi yang lupa ditutup tidak menahannya selamanya.
export async function purgeEnvironment(
    settings: DatabaseSettings,
    request: PurgeRequest,
    onStep: (step: 'check-route' | 'drop-database') => Promise<void> = () =>
        Promise.resolve(),
): Promise<void> {
    await onStep('check-route');
    const runtime = connect(settings, settings.DB_DATABASE);
    try {
        const active = z
            .array(z.object({ tenant_slug: z.string(), kind: z.string() }))
            .parse(
                await runtime.unsafe(
                    `select tenant_slug, kind from environment_routes
                     where disabled_at is null
                       and ((tenant_slug = $1 and kind = $2) or ($3::text is not null and database_name = $3))`,
                    [request.tenant_slug, request.kind, request.database],
                ),
            );
        const [route] = active;
        if (route)
            throw new Error(
                `Address ${route.tenant_slug} (${route.kind}) is still active; the environment must be expired before its database is purged.`,
            );
        if (request.database === null) return;
        assertEnvironmentDatabase(settings, request.database);
        await onStep('drop-database');
        // Nama sudah lolos pola huruf kecil, angka, dan garis bawah, jadi aman ditulis sebagai identifier.
        await runtime.unsafe(
            `drop database if exists "${request.database}" with (force)`,
        );
    } finally {
        await runtime.end();
    }
}
