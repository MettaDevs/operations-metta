import { z } from 'zod';
import { nowSql, type Bind, type Database } from '../database/index.ts';
import { abort, coded } from '../http/index.ts';

// Bentuk nama yang dinormalisasi untuk pencarian (Party::searchName CoreERP): huruf kecil, spasi dirapikan.
export function searchName(name: string): string {
    return name.toLowerCase().replace(/\s+/gu, ' ').trim();
}

// SaveParty::create CoreERP tanpa nomor party: party dicari lewat nomor perannya, jadi tidak ada number sequence.
// Kunci kiriman yang sama mengembalikan party yang sudah dibuat, sehingga kiriman ulang tidak membuat party kedua.
export async function createParty(
    db: Database,
    tenantId: string,
    data: Record<string, Bind>,
    creationKey: string,
): Promise<{ id: string; created: boolean }> {
    return db.transaction(async () => {
        await db.execute(
            'select pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`party|${tenantId}|${creationKey}`],
        );
        const existing = await db.one(
            z.object({ id: z.string(), deleted: z.boolean() }),
            'select id, deleted_at is not null as deleted from parties where tenant_id = $1 and creation_key = $2',
            [tenantId, creationKey],
        );
        if (existing) {
            if (existing.deleted)
                coded(
                    409,
                    'party_archived',
                    'Kiriman ini sudah menghasilkan pihak yang kini terarsip.',
                );
            return { id: existing.id, created: false };
        }
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        const name = String(data.name);
        await db.insert('parties', {
            ...data,
            id,
            tenant_id: tenantId,
            creation_key: creationKey,
            search_name: searchName(
                typeof data.search_name === 'string' && data.search_name
                    ? data.search_name
                    : name,
            ),
            status: typeof data.status === 'string' ? data.status : 'active',
            language: typeof data.language === 'string' ? data.language : 'id',
            created_at: stamp,
            updated_at: stamp,
        });
        return { id, created: true };
    });
}

// Penulis alamat, kontak, dan identitas satu party diantrekan di baris party-nya.
export async function lockParty(
    db: Database,
    tenantId: string,
    partyId: string,
): Promise<void> {
    const locked = await db.one(
        z.object({ id: z.string() }),
        'select id from parties where tenant_id = $1 and id = $2 and deleted_at is null for update',
        [tenantId, partyId],
    );
    if (!locked) abort(404, 'Not Found');
}
