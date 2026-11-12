import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    codeAndName,
    codeAndNameMessages,
    inUse,
    parseInput,
    violates,
} from '../inventory.service.ts';
import {
    trackingCodeInputSchema,
    trackingCodeRowSchema,
} from './tracking-code.schema.ts';

const rowSql = `select * from (
                    select p.id, p.kode as code, p.nama as name, p.wajib_batch as batch_required,
                           p.wajib_kedaluwarsa as expiry_required, p.tolak_kedaluwarsa as strict_expiry, p.version
                    from gd_m_profil_pelacakan p
                    where p.tenant_id = $1 and p.legal_entity_id = $2 and p.deleted_at is null) profiles
                where true`;

function checked(body: unknown) {
    const data = parseInput(
        trackingCodeInputSchema,
        body,
        codeAndNameMessages('profil pelacakan'),
    );
    const errors: Record<string, string> = {};
    const { code, name } = codeAndName(data, errors, 'profil pelacakan', {
        code: 20,
        name: 100,
    });
    const batchRequired = data.batch_required ?? false;
    const expiryRequired = data.expiry_required ?? false;
    if (expiryRequired && !batchRequired)
        errors.expiry_required =
            'Wajib kedaluwarsa butuh wajib batch, karena tanggal kedaluwarsa dicatat per batch.';
    if (Object.keys(errors).length) validation(errors);
    return {
        code,
        name,
        batchRequired,
        expiryRequired,
        strictExpiry: data.strict_expiry ?? false,
    };
}

function codeTaken(error: unknown): void {
    if (violates(error, 'gd_m_profil_pelacakan_kode_unique'))
        validation({ code: 'Kode ini sudah dipakai profil pelacakan lain.' });
}

export class TrackingCodes {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-tracking', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [
                this.workspace.tenantId,
                activeLegalEntity(this.workspace),
            ],
            parameters,
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => trackingCodeRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-tracking.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  trackingCodeRowSchema,
                  `${rowSql} and profiles.id = $3`,
                  [
                      this.workspace.tenantId,
                      activeLegalEntity(this.workspace),
                      id,
                  ],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-tracking', 'update');
        const legalEntityId = activeLegalEntity(this.workspace);
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('gd_m_profil_pelacakan', {
                id,
                tenant_id: this.workspace.tenantId,
                legal_entity_id: legalEntityId,
                kode: data.code,
                nama: data.name,
                wajib_batch: data.batchRequired,
                wajib_kedaluwarsa: data.expiryRequired,
                tolak_kedaluwarsa: data.strictExpiry,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Wajib batch tidak berubah setelah barang berprofil ini punya kartu gudang, seperti Lot Specific Tracking di BC:
    // baris lama tanpa batch tidak boleh tiba-tiba menjadi milik barang yang wajib batch, atau sebaliknya.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-tracking', 'update');
        const current = await this.row(id);
        const data = checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                await this.db.execute(
                    'select id from gd_m_profil_pelacakan where tenant_id = $1 and id = $2 for update',
                    [this.workspace.tenantId, current.id],
                );
                if (data.batchRequired !== current.batch_required) {
                    const posted = await this.db.one(
                        z.object({ found: z.number() }),
                        `select 1 as found from gd_m_barang b
                         where b.tenant_id = $1 and b.profil_pelacakan_id = $2
                           and exists (select 1 from gd_tr_kartu_gudang k where k.tenant_id = b.tenant_id
                                       and k.barang_id = b.id)
                         limit 1`,
                        [this.workspace.tenantId, current.id],
                    );
                    if (posted)
                        validation({
                            batch_required:
                                'Barang dengan profil ini sudah punya gerak stok, jadi wajib batch tidak bisa diubah. Buat profil baru untuk barang lain.',
                        });
                }
                updated = await this.db.execute(
                    `update gd_m_profil_pelacakan set kode = $1, nama = $2, wajib_batch = $3, wajib_kedaluwarsa = $4,
                            tolak_kedaluwarsa = $5, updated_at = $6
                     where tenant_id = $7 and id = $8 and version = $9 and deleted_at is null`,
                    [
                        data.code,
                        data.name,
                        data.batchRequired,
                        data.expiryRequired,
                        data.strictExpiry,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                    ],
                );
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-tracking', 'update');
        const current = await this.row(id);
        await inUse(
            this.db,
            [
                {
                    sql: 'select 1 as found from gd_m_barang where tenant_id = $1 and profil_pelacakan_id = $2 and deleted_at is null limit 1',
                    message:
                        'Profil ini masih dipakai barang. Ganti profil barang itu lebih dulu.',
                },
                {
                    sql: 'select 1 as found from gd_m_kategori where tenant_id = $1 and profil_pelacakan_id = $2 and deleted_at is null limit 1',
                    message:
                        'Profil ini masih menjadi bawaan kategori barang. Ganti bawaan kategori itu lebih dulu.',
                },
            ],
            [this.workspace.tenantId, current.id],
        );
        const deleted = await this.db.execute(
            `update gd_m_profil_pelacakan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [
                nowSql(),
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
