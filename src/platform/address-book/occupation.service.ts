import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import {
    isoSql,
    nowSql,
    sqlErrorCode,
    type Database,
} from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    laravelBody,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import { Problems, checkText } from './party-address.schema.ts';

const rowSchema = z.object({
    id: z.string(),
    name: z.string(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    version: z.number(),
});
const listRowSchema = rowSchema.pick({ id: true, name: true, version: true });
const rowSql = `select id, name, ${isoSql('created_at')} as created_at, ${isoSql('updated_at')} as updated_at, version
                from occupations`;
const taken = 'Pekerjaan dengan nama ini sudah ada.';

// Master pekerjaan per tenant, dipilih di isian pekerjaan party. Master setup kecil: hanya nama dan id, tanpa kode
// dan tanpa number sequence (aturan "Kode dan nomor dokumen").
export class Occupations {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('organization', 'read');
        const batch = await incrementalList(this.db, {
            query: 'select id, name, version from occupations where tenant_id = $1 and deleted_at is null',
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => listRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private name(body: unknown): string {
        const input = laravelBody.parse(body);
        const problems = new Problems();
        checkText(problems, input, 'name', 120, true);
        problems.fail();
        return String(input.name);
    }

    private async ensureFree(name: string, except: string | null) {
        const found = await this.db.one(
            z.object({ found: z.boolean() }),
            `select true as found from occupations where tenant_id = $1 and lower(name) = lower($2) and deleted_at is null
             ${except ? 'and id <> $3' : ''}`,
            except
                ? [this.workspace.tenantId, name, except]
                : [this.workspace.tenantId, name],
        );
        if (found) validation({ name: taken });
    }

    private async write(action: () => Promise<unknown>) {
        try {
            await action();
        } catch (error) {
            if (
                sqlErrorCode(error) === '23505' &&
                error instanceof Error &&
                error.message.includes('occupations_name_unique')
            )
                validation({ name: taken });
            throw error;
        }
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  rowSchema,
                  `${rowSql} where tenant_id = $1 and id = $2 and deleted_at is null`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('organization', 'update');
        const name = this.name(body);
        await this.ensureFree(name, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        await this.write(() =>
            this.db.insert('occupations', {
                id,
                tenant_id: this.workspace.tenantId,
                name,
                created_at: stamp,
                updated_at: stamp,
            }),
        );
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        await this.row(id);
        const name = this.name(body);
        const version = expectedVersion(request, body);
        await this.ensureFree(name, id);
        await this.write(() => this.claim(id, version, 'name = $5', name));
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async delete(request: Request, id: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        await this.row(id);
        await this.claim(
            id,
            expectedVersion(request, body),
            'deleted_at = $5',
            nowSql(),
        );
        return { status: 204, headers: {}, body: undefined };
    }

    private async claim(
        id: string,
        version: number,
        assignment: string,
        value: string,
    ) {
        const claimed = await this.db.execute(
            `update occupations set ${assignment}, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [nowSql(), this.workspace.tenantId, id, version, value],
        );
        if (!claimed) coded(409, 'stale_version', staleMessage);
    }
}
