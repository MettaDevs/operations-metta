import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { environmentKinds, reservedLabels } from './address.ts';
import { connect } from './provision.service.ts';

export const restoreRequestSchema = z.strictObject({
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
    kind: z.enum(environmentKinds),
    database: z
        .string()
        .regex(
            /^[a-z][a-z0-9_]{0,62}$/,
            'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
        )
        .nullable(),
});
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

// Pasangan expire: alamat lingkungan yang dinonaktifkan dinyalakan lagi, sehingga runtime melayaninya sejak permintaan
// berikutnya dengan isi database yang sama. Aman diulang. Alamat yang tidak tercatat, atau yang menunjuk database lain,
// tidak dinyalakan: tidak ada yang bisa dipulihkan dari sana.
export async function restoreEnvironment(
    settings: DatabaseSettings,
    request: RestoreRequest,
    onStep: (step: 'enable-route') => Promise<void> = () => Promise.resolve(),
): Promise<void> {
    await onStep('enable-route');
    const runtime = connect(settings, settings.DB_DATABASE);
    try {
        await runtime.begin(async (transaction) => {
            const [route] = z
                .array(z.object({ database_name: z.string().nullable() }))
                .parse(
                    await transaction.unsafe(
                        'select database_name from environment_routes where tenant_slug = $1 and kind = $2 for update',
                        [request.tenant_slug, request.kind],
                    ),
                );
            if (!route)
                throw new Error(
                    `Address ${request.tenant_slug} (${request.kind}) is not recorded on this runtime.`,
                );
            if (route.database_name !== request.database)
                throw new Error(
                    `Address ${request.tenant_slug} (${request.kind}) points to database ${route.database_name ?? 'runtime'}, not ${request.database ?? 'runtime'}.`,
                );
            await transaction.unsafe(
                'update environment_routes set disabled_at = null where tenant_slug = $1 and kind = $2',
                [request.tenant_slug, request.kind],
            );
        });
    } finally {
        await runtime.end();
    }
}
