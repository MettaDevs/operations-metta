import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { reservedLabels } from './address.ts';
import { connect } from './provision.service.ts';

export const expireRequestSchema = z.strictObject({
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
    database: z
        .string()
        .regex(
            /^[a-z][a-z0-9_]{0,62}$/,
            'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
        )
        .nullable(),
});
export type ExpireRequest = z.infer<typeof expireRequestSchema>;

// Demo yang kedaluwarsa berhenti melayani: alamat `<tenant>.demo.<base>` dinonaktifkan, sehingga runtime menjawabnya
// 404 sejak permintaan berikutnya, termasuk untuk sesi yang masih login. Database dan isinya tidak disentuh, karena
// masih boleh dipulihkan sampai masa tenggangnya habis. Aman diulang, dan alamat yang tidak tercatat berarti tidak ada
// yang perlu dihentikan. Alamat demo yang menunjuk database lain tidak pernah dinonaktifkan.
export async function expireEnvironment(
    settings: DatabaseSettings,
    request: ExpireRequest,
    onStep: (step: 'disable-route') => Promise<void> = () => Promise.resolve(),
): Promise<void> {
    await onStep('disable-route');
    const runtime = connect(settings, settings.DB_DATABASE);
    try {
        await runtime.begin(async (transaction) => {
            const [route] = z
                .array(z.object({ database_name: z.string().nullable() }))
                .parse(
                    await transaction.unsafe(
                        "select database_name from environment_routes where tenant_slug = $1 and kind = 'demo' for update",
                        [request.tenant_slug],
                    ),
                );
            if (!route) return;
            if (route.database_name !== request.database)
                throw new Error(
                    `Address ${request.tenant_slug} (demo) points to database ${route.database_name ?? 'runtime'}, not ${request.database ?? 'runtime'}.`,
                );
            await transaction.unsafe(
                "update environment_routes set disabled_at = now() where tenant_slug = $1 and kind = 'demo' and disabled_at is null",
                [request.tenant_slug],
            );
        });
    } finally {
        await runtime.end();
    }
}
