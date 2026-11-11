import postgres from 'postgres';
import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { connect } from './provision.service.ts';

export type HostReportEnvironment = {
    tenant_slug: string;
    kind: 'production' | 'sandbox' | 'demo';
    database: string | null;
    healthy: boolean;
    problem: string | null;
    size_bytes: number | null;
    migrations: Record<string, string>;
};
export type HostReport = {
    release: string;
    environments: HostReportEnvironment[];
};

const routeSchema = z.object({
    tenant_slug: z.string(),
    kind: z.enum(['production', 'sandbox', 'demo']),
    database_name: z.string().nullable(),
});

// Batas waktu membuka satu database lingkungan saat menyusun laporan, supaya satu database yang macet tidak menahan
// laporan seluruh host.
const connectTimeoutSeconds = 5;

// Keadaan satu lingkungan menurut database-nya sendiri: migration terakhir per pemilik, ukurannya, dan apakah tenant
// pemilik alamatnya ada di sana. Kegagalan membuka atau membaca menjadi laporan tidak sehat beserta sebabnya, bukan
// galat yang menghentikan laporan lingkungan lain.
async function inspect(
    settings: DatabaseSettings,
    route: z.infer<typeof routeSchema>,
): Promise<HostReportEnvironment> {
    const base = {
        tenant_slug: route.tenant_slug,
        kind: route.kind,
        database: route.database_name,
    };
    const sql = postgres({
        host: settings.DB_HOST,
        port: settings.DB_PORT,
        database: route.database_name ?? settings.DB_DATABASE,
        username: settings.DB_USERNAME,
        password: settings.DB_PASSWORD,
        max: 1,
        connect_timeout: connectTimeoutSeconds,
        onnotice: () => {
            // NOTICE PostgreSQL sengaja tidak dicetak.
        },
    });
    try {
        const migrations = Object.fromEntries(
            z
                .array(z.object({ owner: z.string(), name: z.string() }))
                .parse(
                    await sql.unsafe(
                        'select owner, max(name) as name from public.schema_migrations group by owner order by owner',
                    ),
                )
                .map((row) => [row.owner, row.name]),
        );
        const [size] = z
            .array(z.object({ bytes: z.coerce.number() }))
            .parse(
                await sql.unsafe(
                    'select pg_database_size(current_database()) as bytes',
                ),
            );
        const [tenant] = z
            .array(z.object({ present: z.boolean() }))
            .parse(
                await sql.unsafe(
                    'select exists (select 1 from tenants where slug = $1) as present',
                    [route.tenant_slug],
                ),
            );
        return {
            ...base,
            healthy: tenant?.present === true,
            problem: tenant?.present
                ? null
                : 'Tenant pemilik alamat ini tidak ada di database lingkungannya.',
            size_bytes: size?.bytes ?? null,
            migrations,
        };
    } catch (error) {
        return {
            ...base,
            healthy: false,
            problem: `Database lingkungan tidak bisa dibaca: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`,
            size_bytes: null,
            migrations: {},
        };
    } finally {
        await sql.end({ timeout: 5 });
    }
}

// Laporan host untuk control plane: rilis yang dijalankan image ini, dan keadaan setiap lingkungan yang alamatnya aktif
// di database runtime. Alamat yang dinonaktifkan (lingkungan dihapus lunak) tidak dilaporkan.
export async function gatherHostReport(
    settings: DatabaseSettings,
    release: string,
): Promise<HostReport> {
    const runtime = connect(settings, settings.DB_DATABASE);
    let routes: z.infer<typeof routeSchema>[];
    try {
        routes = z
            .array(routeSchema)
            .parse(
                await runtime.unsafe(
                    'select tenant_slug, kind, database_name from environment_routes where disabled_at is null order by tenant_slug, kind',
                ),
            );
    } finally {
        await runtime.end();
    }
    const environments: HostReportEnvironment[] = [];
    for (const route of routes)
        environments.push(await inspect(settings, route));
    return { release, environments };
}
