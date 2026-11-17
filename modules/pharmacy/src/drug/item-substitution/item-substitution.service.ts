import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
} from '@core/foundation/inventory/index.ts';
import {
    itemSubstitutionInputSchema,
    itemSubstitutionRowSchema,
} from './item-substitution.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

const rowSql = `select p.id, json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) as substitute,
                       s.nama as base_unit_name, p.keterangan as notes, b.diblokir as is_blocked, p.version
                from far_m_obat_pengganti p
                join gd_m_barang b on b.tenant_id = p.tenant_id and b.id = p.barang_pengganti_id
                join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                where p.tenant_id = $1 and p.legal_entity_id = $2 and p.deleted_at is null and b.deleted_at is null`;

const messages = {
    substitute_item_id: 'Pilih obat pengganti dari daftar.',
    notes: 'Keterangan paling banyak 100 karakter.',
    interchangeable: 'Pilih ya atau tidak.',
};

// Obat pengganti yang masih bisa dipilih saat resep disiapkan: barangnya tidak dihapus dan tidak diblokir. Kunci peta
// adalah obat resep.
export async function substitutesOf(
    db: Database,
    scope: Scope,
    itemIds: string[],
): Promise<
    Map<
        string,
        { id: string; code: string; name: string; notes: string | null }[]
    >
> {
    const substitutes = new Map<
        string,
        { id: string; code: string; name: string; notes: string | null }[]
    >();
    const ids = [...new Set(itemIds.filter((id) => lookupId(id)))];
    if (!ids.length) return substitutes;
    const rows = await db.rows(
        z.object({
            item_id: z.string(),
            id: z.string(),
            code: z.string(),
            name: z.string(),
            notes: z.string().nullable(),
        }),
        `select p.barang_id as item_id, b.id, b.kode as code, b.nama as name, p.keterangan as notes
         from far_m_obat_pengganti p
         join gd_m_barang b on b.tenant_id = p.tenant_id and b.id = p.barang_pengganti_id
         where p.tenant_id = $1 and p.legal_entity_id = $2 and p.barang_id = any($3::uuid[])
           and p.deleted_at is null and b.deleted_at is null and not b.diblokir
         order by p.barang_id, b.nama, b.kode`,
        [scope.tenantId, scope.legalEntityId, `{${ids.join(',')}}`],
    );
    for (const { item_id: itemId, ...substitute } of rows)
        substitutes.set(itemId, [
            ...(substitutes.get(itemId) ?? []),
            substitute,
        ]);
    return substitutes;
}

// Obat pengganti satu obat, diisi di kartu data obat farmasi (Item Substitutions BC dari kartu barang). Hak baca dan
// ubahnya sama dengan data obat farmasi.
export class ItemSubstitutions {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private async item(id: string): Promise<boolean> {
        if (!lookupId(id)) return false;
        return (
            (await this.db.one(
                z.object({ id: z.string() }),
                `select id from gd_m_barang
                 where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                [this.scope.tenantId, this.scope.legalEntityId, id],
            )) !== undefined
        );
    }

    async list(itemId: string) {
        this.workspace.guard('drug', 'read');
        if (!(await this.item(itemId))) abort(404, 'Not Found');
        return {
            data: await this.db.rows(
                itemSubstitutionRowSchema,
                `${rowSql} and p.barang_id = $3 order by b.nama, b.kode`,
                [this.scope.tenantId, this.scope.legalEntityId, itemId],
            ),
            can_manage: this.workspace.permissions.has('pharmacy.drug.update'),
        };
    }

    async create(itemId: string, body: unknown) {
        this.workspace.guard('drug', 'update');
        if (!(await this.item(itemId))) abort(404, 'Not Found');
        const data = parseInput(itemSubstitutionInputSchema, body, messages);
        const notes = data.notes?.trim() || null;
        if (notes && notes.length > 100) validation({ notes: messages.notes });
        const substituteId = data.substitute_item_id;
        if (substituteId === itemId)
            validation({
                substitute_item_id:
                    'Pilih obat lain. Obat tidak bisa menjadi pengganti dirinya sendiri.',
            });
        if (!(await this.item(substituteId)))
            validation({ substitute_item_id: messages.substitute_item_id });
        const pairs: [string, string][] = [[itemId, substituteId]];
        if (data.interchangeable) pairs.push([substituteId, itemId]);
        const stamp = nowSql();
        await this.db.transaction(async () => {
            for (const [index, [from, to]] of pairs.entries()) {
                const written = await this.db.execute(
                    `insert into far_m_obat_pengganti (id, tenant_id, legal_entity_id, barang_id, barang_pengganti_id,
                                                       keterangan, created_at, updated_at)
                     select $1, $2, $3, $4, $5, $6, $7, $7
                     where not exists (select 1 from far_m_obat_pengganti
                                       where tenant_id = $2 and barang_id = $4 and barang_pengganti_id = $5
                                         and deleted_at is null)`,
                    [
                        Bun.randomUUIDv7(),
                        this.scope.tenantId,
                        this.scope.legalEntityId,
                        from,
                        to,
                        notes,
                        stamp,
                    ],
                );
                if (!written && index === 0)
                    validation({
                        substitute_item_id:
                            'Obat ini sudah tercatat sebagai pengganti.',
                    });
            }
        });
        return this.list(itemId);
    }

    // Hapus lunak satu arah saja; arah sebaliknya, bila ada, dihapus dari kartu obat itu sendiri. Penyerahan yang sudah
    // memakai pengganti ini tidak berubah.
    async destroy(
        request: Request,
        itemId: string,
        substitutionId: string,
        body: unknown,
    ) {
        this.workspace.guard('drug', 'update');
        const version = expectedVersion(request, body);
        const found = lookupId(substitutionId)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from far_m_obat_pengganti
                 where tenant_id = $1 and legal_entity_id = $2 and id = $3 and barang_id = $4 and deleted_at is null`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      substitutionId,
                      itemId,
                  ],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        const stamp = nowSql();
        const deleted = await this.db.execute(
            `update far_m_obat_pengganti set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [stamp, this.scope.tenantId, found.id, version],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return this.list(itemId);
    }
}
