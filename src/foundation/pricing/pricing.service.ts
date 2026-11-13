import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { validation } from '../../platform/http/index.ts';

const referenceSchema = z.object({
    table_name: z.string(),
    column_name: z.string(),
    soft_deleted: z.boolean(),
});

const quoted = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

// Master harga dipakai tabel module (tipe pasien, tarif tindakan, grading obat), dan Core tidak menulis nama tabel
// module. Rujukannya dibaca dari foreign key yang dipasang migration module ke master ini, jadi daftar pemakainya
// mengikuti module yang terpasang di database itu. Baris rujukan yang sudah dihapus lunak tidak dihitung.
export async function refuseWhileReferenced(
    db: Database,
    table: string,
    scope: { tenantId: string; id: string },
    message: string,
): Promise<void> {
    const references = await db.rows(
        referenceSchema,
        `select source.relname as table_name, source_column.attname as column_name,
                exists (select 1 from pg_attribute d where d.attrelid = source.oid and d.attname = 'deleted_at'
                        and not d.attisdropped) as soft_deleted
         from pg_constraint c
         join pg_class source on source.oid = c.conrelid
         join pg_class target on target.oid = c.confrelid
         join pg_namespace n on n.oid = target.relnamespace
         cross join lateral unnest(c.conkey, c.confkey) as k(source_number, target_number)
         join pg_attribute source_column on source_column.attrelid = c.conrelid and source_column.attnum = k.source_number
         join pg_attribute target_column on target_column.attrelid = c.confrelid and target_column.attnum = k.target_number
         where c.contype = 'f' and n.nspname = 'public' and target.relname = $1 and target_column.attname = 'id'`,
        [table],
    );
    for (const reference of references) {
        const found = await db.one(
            z.object({ found: z.number() }),
            `select 1 as found from ${quoted(reference.table_name)}
             where tenant_id = $1 and ${quoted(reference.column_name)} = $2
             ${reference.soft_deleted ? 'and deleted_at is null' : ''} limit 1`,
            [scope.tenantId, scope.id],
        );
        if (found) validation({ _form: message });
    }
}
