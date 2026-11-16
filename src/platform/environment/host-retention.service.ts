import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { applyRetention, type RetentionResult } from '../retention/index.ts';
import { connect } from './provision.service.ts';

export type HostRetention = {
    database: string;
    results: RetentionResult[];
    error: unknown;
};

// Retensi untuk setiap database di host ini: database runtime, yang memegang tenant bila server hanya punya satu
// lingkungan, dan database setiap alamat aktif di environment_routes. Database yang tidak bisa dibuka menjadi hasil
// gagal, bukan galat yang menghentikan database lain. Alamat yang dinonaktifkan tidak diproses; databasenya menunggu
// dibuang purgeEnvironment.
export async function applyHostRetention(
    settings: DatabaseSettings,
    now: Date = new Date(),
): Promise<HostRetention[]> {
    const runtime = connect(settings, settings.DB_DATABASE);
    let routed: { database_name: string }[];
    try {
        routed = z
            .array(z.object({ database_name: z.string() }))
            .parse(
                await runtime.unsafe(
                    'select distinct database_name from environment_routes where disabled_at is null and database_name is not null order by database_name',
                ),
            );
    } finally {
        await runtime.end();
    }
    const outcomes: HostRetention[] = [];
    for (const database of [
        settings.DB_DATABASE,
        ...routed.map((route) => route.database_name),
    ]) {
        const sql = connect(settings, database);
        try {
            outcomes.push({
                database,
                results: await applyRetention(sql, now),
                error: null,
            });
        } catch (error) {
            outcomes.push({ database, results: [], error });
        } finally {
            await sql.end({ timeout: 5 });
        }
    }
    return outcomes;
}
