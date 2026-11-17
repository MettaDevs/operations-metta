import { z } from 'zod';
import { refuse, type Workspace } from '../../../platform/access/index.ts';
import type { Bind, Database } from '../../../platform/database/index.ts';
import { lookupId } from '../../../platform/http/index.ts';

// Satu aturan akses lokasi untuk semua dokumen stok, pola Warehouse Employee BC: lokasi yang ditandai khusus petugas
// hanya terbuka bagi pengguna yang ditugaskan ke sana; lokasi lain terbuka bagi setiap pemegang izin dokumennya.
// Dokumen tanpa lokasi terbuka bagi semua, sama dengan lokasi kosong di BC. Antrean resep farmasi, mutasi, opname,
// penyesuaian, penerimaan, dan retur ke vendor memakai fungsi di berkas ini, bukan pemeriksaan sendiri.

type Actor = Pick<Workspace, 'tenantId' | 'userId'>;

const blocked = (location: string, tenant: string, user: string) =>
    `exists (select 1 from gd_m_lokasi la
             where la.tenant_id = ${tenant} and la.id = ${location} and la.khusus_petugas
               and not exists (select 1 from gd_m_petugas_lokasi pl
                               where pl.tenant_id = la.tenant_id and pl.lokasi_id = la.id
                                 and pl.user_id = ${user} and pl.deleted_at is null))`;

// Predikat daftar: baris tampil bila pengguna boleh bekerja di salah satu lokasi kolomnya. Mutasi menyebut lokasi asal
// dan tujuan, jadi petugas pusling melihat amprah dari gudang ke pusling, tetapi tidak mutasi gudang ke farmasi.
export function allowedLocationsSql(
    actor: Actor,
    bindings: Bind[],
    columns: [string, ...string[]],
): string {
    const tenant = `$${bindings.push(actor.tenantId)}`;
    const user = `$${bindings.push(actor.userId)}`;
    return `(${columns.map((column) => `not ${blocked(column, tenant, user)}`).join(' or ')})`;
}

const deniedSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

async function denied(db: Database, actor: Actor, ids: string[]) {
    if (!ids.length) return [];
    const bindings: Bind[] = [];
    const list = ids.map((id) => `$${bindings.push(id)}`).join(', ');
    return db.rows(
        deniedSchema,
        `select l.id, l.kode as code, l.nama as name from gd_m_lokasi l
         where l.id in (${list}) and ${blocked('l.id', `$${bindings.push(actor.tenantId)}`, `$${bindings.push(actor.userId)}`)}
         order by l.kode`,
        bindings,
    );
}

// Tindakan di lokasi khusus petugas ditolak bagi yang bukan petugasnya. Pemegang izin lokasi stok mendapat tombol yang
// membuka daftar petugas lokasi itu; yang lain diberi tahu harus meminta apa. `anyOf` dipakai dokumen yang cukup
// dikerjakan petugas salah satu lokasinya, misalnya draf mutasi yang boleh disiapkan pihak asal maupun tujuan.
export async function requireLocationAccess(
    db: Database,
    workspace: Workspace,
    locations: (string | null | undefined)[],
    options: { field?: string; anyOf?: boolean } = {},
): Promise<void> {
    const ids = [
        ...new Set(
            locations.filter((id): id is string => Boolean(id && lookupId(id))),
        ),
    ];
    const refused = await denied(db, workspace, ids);
    const first = refused[0];
    if (!first || (options.anyOf && refused.length < ids.length)) return;
    await refuse(db, workspace, {
        message: `Lokasi ${first.code} ${first.name} hanya untuk petugasnya, dan Anda belum terdaftar sebagai petugas di sana.`,
        ...(options.field ? { field: options.field } : {}),
        open: {
            page: 'core.inventory-location',
            recordId: first.id,
            label: `Buka petugas lokasi ${first.code}`,
        },
        otherwise: `Minta pengelola lokasi stok mendaftarkan Anda sebagai petugas lokasi ${first.code}.`,
    });
}

// Lokasi bawaan pengguna di legal entity itu (GetDefaultLocation BC), atau null bila belum ada.
export async function defaultLocation(
    db: Database,
    actor: Actor,
    legalEntityId: string,
): Promise<string | null> {
    const found = await db.one(
        z.object({ id: z.string() }),
        `select pl.lokasi_id as id from gd_m_petugas_lokasi pl
         join gd_m_lokasi l on l.tenant_id = pl.tenant_id and l.id = pl.lokasi_id and l.deleted_at is null
         where pl.tenant_id = $1 and pl.legal_entity_id = $2 and pl.user_id = $3 and pl.bawaan
           and pl.deleted_at is null`,
        [actor.tenantId, legalEntityId, actor.userId],
    );
    return found?.id ?? null;
}
