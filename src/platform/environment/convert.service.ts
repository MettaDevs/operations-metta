import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { reservedLabels } from './address.ts';
import { connect } from './provision.service.ts';

export const convertRequestSchema = z.strictObject({
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
    name: z.string().trim().min(1).max(100),
});
export type ConvertRequest = z.infer<typeof convertRequestSchema>;

const routeRowSchema = z.object({
    kind: z.enum(['production', 'demo']),
    database_name: z.string().nullable(),
});

// Menjadikan demo produksi di tempat: alamat `<tenant>.demo.<base>` pindah ke `<tenant>.<base>` dan menunjuk database
// yang sama, jadi seluruh isi demo ikut. Database lingkungannya tidak disentuh. Aman diulang: alamat produksi yang
// sudah menunjuk database demo itu berarti konversinya pernah selesai. Alamat produksi yang menunjuk database lain
// tidak pernah ditimpa.
export async function convertEnvironment(
    settings: DatabaseSettings,
    request: ConvertRequest,
    onStep: (step: 'move-route') => Promise<void> = () => Promise.resolve(),
): Promise<void> {
    await onStep('move-route');
    const runtime = connect(settings, settings.DB_DATABASE);
    try {
        await runtime.begin(async (transaction) => {
            const rows = z
                .array(routeRowSchema)
                .parse(
                    await transaction.unsafe(
                        "select kind, database_name from environment_routes where tenant_slug = $1 and kind in ('demo', 'production') for update",
                        [request.tenant_slug],
                    ),
                );
            const demo = rows.find((row) => row.kind === 'demo');
            const production = rows.find((row) => row.kind === 'production');
            if (production) {
                if (production.database_name === request.database && !demo)
                    return;
                throw new Error(
                    `Address ${request.tenant_slug} (production) already points to another environment.`,
                );
            }
            if (!demo)
                throw new Error(
                    `Address ${request.tenant_slug} (demo) is not recorded on this runtime.`,
                );
            if (demo.database_name !== request.database)
                throw new Error(
                    `Address ${request.tenant_slug} (demo) points to database ${demo.database_name ?? 'runtime'}, not ${request.database ?? 'runtime'}.`,
                );
            await transaction.unsafe(
                "update environment_routes set kind = 'production', name = $2 where tenant_slug = $1 and kind = 'demo'",
                [request.tenant_slug, request.name],
            );
        });
    } finally {
        await runtime.end();
    }
}
