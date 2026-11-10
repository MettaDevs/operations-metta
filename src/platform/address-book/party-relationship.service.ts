import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import {
    isoSql,
    nowSql,
    sqlErrorCode,
    type Bind,
    type Database,
} from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    laravelBody,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import { PartyAccess } from './party-access.service.ts';
import { Problems, checkDate } from './party-address.schema.ts';

const rowSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    from_party_id: z.string(),
    to_party_id: z.string(),
    relationship_type_code: z.string(),
    valid_from: z.string(),
    valid_to: z.string().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
    version: z.number(),
});
const rowColumns = `r.id, r.tenant_id, r.from_party_id, r.to_party_id, r.relationship_type_code,
                    r.valid_from::text as valid_from, r.valid_to::text as valid_to,
                    ${isoSql('r.created_at')} as created_at, ${isoSql('r.updated_at')} as updated_at,
                    r.created_by_user_id, r.updated_by_user_id, r.version`;
const rowSql = `select ${rowColumns} from party_relationships r`;

// Hubungan party bertanggal (party_relationships), pola Relationship types F&O: orang tua/anak, pasangan, anggota
// KK, bekerja di, dan jenis CoreERP. Hubungan berarah dari pihak pertama ke pihak kedua, jenis kedua pihak harus
// sesuai jenis hubungannya, dan hubungan yang sama tidak boleh berlaku pada rentang tanggal yang tumpang tindih.
export class PartyRelationships {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Hubungan party ini dengan pihak yang terlihat bagi pengguna. Pihak yang sudah diarsipkan tetap tampil.
    async list(partyId: string) {
        const access = await PartyAccess.open(this.db, this.workspace);
        const bindings: Bind[] = [this.workspace.tenantId, partyId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        return this.db.rows(
            rowSchema.extend({ from_name: z.string(), to_name: z.string() }),
            `select ${rowColumns},
                    case when f.deleted_at is null then f.name else 'Pihak terarsip' end as from_name,
                    case when t.deleted_at is null then t.name else 'Pihak terarsip' end as to_name
             from party_relationships r
             join parties f on f.id = r.from_party_id
             join parties t on t.id = r.to_party_id
             where r.tenant_id = $1 and r.deleted_at is null and (r.from_party_id = $2 or r.to_party_id = $2)
               and (r.from_party_id = $2 or f.deleted_at is not null or ${access.clause('f', bind)})
               and (r.to_party_id = $2 or t.deleted_at is not null or ${access.clause('t', bind)})
             order by r.valid_from, r.id`,
            bindings,
        );
    }

    private async check(partyId: string, body: unknown) {
        const input = laravelBody.parse(body);
        const problems = new Problems();
        for (const field of ['from_party_id', 'to_party_id']) {
            const value = input[field];
            if (value == null) problems.add(field, 'Pilih pihak.');
            else if (typeof value !== 'string' || !lookupId(value))
                problems.add(field, 'Pilih pihak dari daftar.');
        }
        if (
            typeof input.from_party_id === 'string' &&
            input.from_party_id === input.to_party_id
        )
            problems.add('to_party_id', 'Pilih pihak lain.');
        const type =
            typeof input.relationship_type_code === 'string'
                ? await this.db.one(
                      z.object({
                          code: z.string(),
                          from_type: z.string(),
                          to_type: z.string(),
                      }),
                      'select code, from_type, to_type from party_relationship_types where code = $1',
                      [input.relationship_type_code],
                  )
                : undefined;
        if (!type)
            problems.add(
                'relationship_type_code',
                'Pilih jenis hubungan dari daftar.',
            );
        if (input.valid_from == null)
            problems.add('valid_from', 'Isi tanggal mulai berlaku.');
        checkDate(problems, input, 'valid_from');
        checkDate(problems, input, 'valid_to');
        if (
            typeof input.valid_from === 'string' &&
            typeof input.valid_to === 'string' &&
            input.valid_to < input.valid_from
        )
            problems.add(
                'valid_to',
                'Tanggal akhir tidak boleh sebelum tanggal mulai.',
            );
        problems.fail();
        if (!type)
            throw new Error('Jenis hubungan lolos pemeriksaan tanpa nilai.');
        const data = {
            from_party_id: input.from_party_id as string,
            to_party_id: input.to_party_id as string,
            relationship_type_code: type.code,
            valid_from: input.valid_from as string,
            valid_to: (input.valid_to as string | null | undefined) ?? null,
        };
        if (data.from_party_id !== partyId && data.to_party_id !== partyId)
            validation({
                from_party_id:
                    'Hubungan harus menyertakan pihak yang sedang dibuka.',
            });
        // Kedua pihak harus ada di tenant ini dan terlihat bagi pengguna.
        const access = await PartyAccess.open(this.db, this.workspace);
        const bindings: Bind[] = [
            this.workspace.tenantId,
            data.from_party_id,
            data.to_party_id,
        ];
        const participants = await this.db.rows(
            z.object({ id: z.string(), type: z.string() }),
            `select p.id, p.type from parties p
             where p.tenant_id = $1 and p.id in ($2, $3) and p.deleted_at is null
               and ${access.clause('p', (value) => {
                   bindings.push(value);
                   return `$${bindings.length}`;
               })}`,
            bindings,
        );
        if (participants.length !== 2) abort(404, 'Not Found');
        const identity = (id: string) =>
            participants.find((party) => party.id === id)?.type === 'person'
                ? 'person'
                : 'organization';
        if (
            identity(data.from_party_id) !== type.from_type ||
            identity(data.to_party_id) !== type.to_type
        )
            validation({
                relationship_type_code:
                    'Jenis kedua pihak tidak sesuai dengan hubungan yang dipilih.',
            });
        return data;
    }

    async save(
        request: Request,
        partyId: string,
        body: unknown,
        relationshipId: string | null,
    ) {
        this.workspace.guard('organization', 'update');
        const data = await this.check(partyId, body);
        const id = await this.db.transaction(async () => {
            await this.db.execute(
                'select pg_advisory_xact_lock(hashtextextended($1, 0))',
                [
                    `party-relationship|${this.workspace.tenantId}|${data.from_party_id}|${data.to_party_id}|${data.relationship_type_code}`,
                ],
            );
            let id = relationshipId;
            if (id !== null) {
                await this.row(partyId, id);
                const version = expectedVersion(request, body);
                const claimed = await this.db.execute(
                    'update party_relationships set updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                    [nowSql(), this.workspace.tenantId, id, version],
                );
                if (!claimed) coded(409, 'stale_version', staleMessage);
            }
            const overlap = await this.db.one(
                z.object({ found: z.boolean() }),
                `select true as found from party_relationships
                 where tenant_id = $1 and from_party_id = $2 and to_party_id = $3 and relationship_type_code = $4
                   and deleted_at is null and valid_from <= $5::date and (valid_to is null or valid_to >= $6::date)
                   ${id ? 'and id <> $7' : ''} limit 1`,
                [
                    this.workspace.tenantId,
                    data.from_party_id,
                    data.to_party_id,
                    data.relationship_type_code,
                    data.valid_to ?? '9999-12-31',
                    data.valid_from,
                    ...(id ? [id] : []),
                ],
            );
            if (overlap)
                validation({
                    valid_from:
                        'Hubungan yang sama sudah berlaku pada rentang tanggal ini.',
                });
            const stamp = nowSql();
            try {
                if (id === null) {
                    id = Bun.randomUUIDv7();
                    await this.db.insert('party_relationships', {
                        id,
                        tenant_id: this.workspace.tenantId,
                        ...data,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                } else
                    await this.db.execute(
                        `update party_relationships set from_party_id = $1, to_party_id = $2, relationship_type_code = $3,
                             valid_from = $4, valid_to = $5, updated_at = $6 where id = $7`,
                        [
                            data.from_party_id,
                            data.to_party_id,
                            data.relationship_type_code,
                            data.valid_from,
                            data.valid_to,
                            stamp,
                            id,
                        ],
                    );
            } catch (error) {
                if (sqlErrorCode(error) === '23505')
                    validation({
                        relationship_type_code:
                            'Hubungan ini sudah tercatat pada tanggal yang sama.',
                    });
                throw error;
            }
            return id;
        });
        return {
            status: relationshipId === null ? 201 : 200,
            headers: {},
            body: { data: await this.row(partyId, id) },
        };
    }

    async delete(
        request: Request,
        partyId: string,
        relationshipId: string,
        body: unknown,
    ) {
        this.workspace.guard('organization', 'update');
        await this.row(partyId, relationshipId);
        const version = expectedVersion(request, body);
        const stamp = nowSql();
        const removed = await this.db.execute(
            'update party_relationships set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
            [stamp, this.workspace.tenantId, relationshipId, version],
        );
        if (!removed) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }

    private async row(partyId: string, id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  rowSchema,
                  `${rowSql} where r.tenant_id = $1 and r.id = $2 and r.deleted_at is null
                     and (r.from_party_id = $3 or r.to_party_id = $3)`,
                  [this.workspace.tenantId, id, partyId],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }
}
