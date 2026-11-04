import { z } from 'zod';
import type { Database } from './db.ts';

// Melewati batas ini, seluruh cache dikosongkan (optimized.md, bagian 2).
const maximumEntries = 20_000;
const versionSchema = z.object({ version: z.coerce.string() });

type Entry = { expiresAt: number; value: unknown };

// Cache konteks per proses (CONTEXT_CACHE=on). Isinya hanya data per user, keanggotaan, dan tenant yang disebut
// di kunci; objek request, sesi, koneksi, dan hasil pemilihan tempat kerja tidak pernah disimpan.
export class ContextCache {
    private version: string | undefined;
    private readonly entries = new Map<string, Entry>();

    constructor(
        private readonly ttlSeconds: number,
        private readonly now: () => number = Date.now,
    ) {}

    // Tepat satu query versi per request yang membutuhkan user atau konteks. Versi yang berbeda dari milik proses
    // mengosongkan seluruh cache. Data konteks hanya terbaca lewat view yang dikembalikan, jadi selalu sesudah query ini.
    async open(db: Database): Promise<ContextCacheView> {
        const row = await db.one(
            versionSchema,
            'select version from security_context_versions where id = 1',
        );
        if (!row)
            throw new Error('security_context_versions tidak berisi id 1.');
        if (row.version !== this.version) {
            this.entries.clear();
            this.version = row.version;
        }
        return new ContextCacheView(this, row.version);
    }

    async remember<T>(
        version: string,
        key: string,
        load: () => Promise<T>,
        boundary?: () => Promise<number | null>,
    ): Promise<T> {
        const started = this.now();
        // Bila request lain sudah mengganti versi cache, request ini membaca database langsung dan tidak menyimpan,
        // agar data versi lama tidak pernah tercatat sebagai versi baru atau sebaliknya.
        if (this.version === version) {
            const entry = this.entries.get(key);
            if (entry && started < entry.expiresAt) return entry.value as T;
            if (entry) this.entries.delete(key);
        }
        // Batas validitas dihitung sebelum data. Batas yang jatuh di antara keduanya membuat entri langsung
        // kedaluwarsa, bukan membiarkan penugasan yang sudah berakhir bertahan sampai batas berikutnya.
        const limit = boundary ? await boundary() : null;
        const value = await load();
        if (this.version === version) {
            if (this.entries.size >= maximumEntries) this.entries.clear();
            this.entries.set(key, {
                expiresAt: Math.min(
                    started + this.ttlSeconds * 1000,
                    limit ?? Infinity,
                ),
                value,
            });
        }
        return value;
    }
}

// Pegangan satu request atas cache pada versi yang dilihat query versinya. Dimiliki sesi request itu.
export class ContextCacheView {
    constructor(
        private readonly cache: ContextCache,
        private readonly version: string,
    ) {}

    remember<T>(
        key: string,
        load: () => Promise<T>,
        boundary?: () => Promise<number | null>,
    ): Promise<T> {
        return this.cache.remember(this.version, key, load, boundary);
    }
}

// Kolom validitas bertipe timestamp tanpa zona dan berisi UTC, sama seperti model.ts menulis waktu.
export function utcInstant(value: string): number {
    const instant = Date.parse(value.replace(' ', 'T') + 'Z');
    if (Number.isNaN(instant))
        throw new Error('Batas validitas tidak dapat dibaca.');
    return instant;
}
