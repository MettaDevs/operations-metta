import type postgres from 'postgres';
import { z } from 'zod';
import type { EnvironmentKind } from './address.ts';

const routeSchema = z.object({
    tenant_id: z.string(),
    tenant_slug: z.string(),
    kind: z.enum(['production', 'sandbox', 'demo']),
    name: z.string(),
    database_name: z.string().nullable(),
});
export type EnvironmentRoute = z.infer<typeof routeSchema>;

// Alamat yang dinonaktifkan (lingkungan dihapus lunak) tidak pernah ditemukan, jadi runtime menjawabnya 404.
export async function findRoute(
    runtime: postgres.Sql,
    tenantSlug: string,
    kind: EnvironmentKind,
): Promise<EnvironmentRoute | null> {
    const rows = await runtime.unsafe(
        'select tenant_id, tenant_slug, kind, name, database_name from environment_routes where tenant_slug = $1 and kind = $2 and disabled_at is null',
        [tenantSlug, kind],
        { prepare: true },
    );
    return rows[0] ? routeSchema.parse(rows[0]) : null;
}

// Alamat yang sudah menunjuk tenant lain atau database lain tidak pernah dipindah diam-diam: itu tanda dua lingkungan
// berebut alamat yang sama.
export async function recordRoute(
    runtime: postgres.Sql,
    route: EnvironmentRoute,
): Promise<void> {
    await runtime.unsafe(
        'insert into environment_routes (tenant_slug, kind, tenant_id, name, database_name) values ($1, $2, $3, $4, $5) on conflict (tenant_slug, kind) do nothing',
        [
            route.tenant_slug,
            route.kind,
            route.tenant_id,
            route.name,
            route.database_name,
        ],
    );
    const recorded = await findRoute(runtime, route.tenant_slug, route.kind);
    if (
        recorded?.tenant_id !== route.tenant_id ||
        recorded.database_name !== route.database_name
    )
        throw new Error(
            `Address ${route.tenant_slug} (${route.kind}) already points to another environment.`,
        );
}
