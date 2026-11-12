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
import { codeListInputSchema, codeListRowSchema } from './code-list.schema.ts';

export type CodeList = {
    table: string;
    resource: string;
    label: string;
    usage: { sql: string; message: string };
};

export const unitsOfMeasure: CodeList = {
    table: 'gd_m_satuan',
    resource: 'inventory-unit',
    label: 'satuan',
    usage: {
        sql: 'select 1 as found from gd_m_barang where tenant_id = $1 and satuan_dasar_id = $2 and deleted_at is null limit 1',
        message:
            'Satuan ini masih menjadi satuan dasar barang. Ganti satuan barang itu lebih dulu.',
    },
};

// Alasan bawaan per legal entity diisi migration 0024 (gd_isi_acuan); setelah itu milik tenant sepenuhnya.
export const reasonCodes: CodeList = {
    table: 'gd_m_alasan',
    resource: 'inventory-reason',
    label: 'alasan',
    usage: {
        sql: 'select 1 as found from gd_tr_penyesuaian where tenant_id = $1 and alasan_id = $2 and deleted_at is null limit 1',
        message:
            'Alasan ini sudah dipakai dokumen penyesuaian, jadi tidak bisa dihapus.',
    },
};

export class CodeLists {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        private readonly kind: CodeList,
    ) {}

    private get rowSql() {
        return `select * from (
                    select k.id, k.kode as code, k.nama as name, k.version
                    from ${this.kind.table} k
                    where k.tenant_id = $1 and k.legal_entity_id = $2 and k.deleted_at is null) entries
                where true`;
    }

    private checked(body: unknown) {
        const data = parseInput(
            codeListInputSchema,
            body,
            codeAndNameMessages(this.kind.label),
        );
        const errors: Record<string, string> = {};
        const values = codeAndName(data, errors, this.kind.label, {
            code: 20,
            name: 100,
        });
        if (Object.keys(errors).length) validation(errors);
        return values;
    }

    private codeTaken(error: unknown): void {
        if (violates(error, `${this.kind.table}_kode_unique`))
            validation({
                code: `Kode ini sudah dipakai ${this.kind.label} lain.`,
            });
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard(this.kind.resource, 'read');
        const batch = await incrementalList(this.db, {
            query: this.rowSql,
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
            data: batch.data.map((row) => codeListRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                `core.${this.kind.resource}.update`,
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  codeListRowSchema,
                  `${this.rowSql} and entries.id = $3`,
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
        this.workspace.guard(this.kind.resource, 'update');
        const legalEntityId = activeLegalEntity(this.workspace);
        const data = this.checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert(this.kind.table, {
                id,
                tenant_id: this.workspace.tenantId,
                legal_entity_id: legalEntityId,
                kode: data.code,
                nama: data.name,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard(this.kind.resource, 'update');
        const current = await this.row(id);
        const data = this.checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update ${this.kind.table} set kode = $1, nama = $2, updated_at = $3
                 where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard(this.kind.resource, 'update');
        const current = await this.row(id);
        await inUse(
            this.db,
            [this.kind.usage],
            [this.workspace.tenantId, current.id],
        );
        const deleted = await this.db.execute(
            `update ${this.kind.table} set deleted_at = $1, updated_at = $1
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
