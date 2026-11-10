import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { nowSql, sqlErrorCode, type Database } from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    HttpFailure,
    laravelBody,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import { Problems } from './party-address.schema.ts';

const typeSchema = z.object({
    code: z.string(),
    name: z.string(),
    number_pattern: z.string().nullable(),
    data_sensitivity: z.string(),
});
type IdentificationType = z.infer<typeof typeSchema>;
const rowSchema = z.object({
    id: z.string(),
    type_code: z.string(),
    type_name: z.string(),
    data_sensitivity: z.string(),
    number: z.string(),
    version: z.number(),
});

// Nomor berklasifikasi sensitive (NIK, No. KK) tampil dengan empat angka terakhir saja.
export function maskNumber(number: string): string {
    return '*'.repeat(Math.max(number.length - 4, 0)) + number.slice(-4);
}

const nikTaken = 'NIK ini sudah tercatat pada pihak lain.';
const typeTaken =
    'Pihak ini sudah punya nomor jenis ini. Ubah nomor yang sudah ada.';

// Nomor identitas party: NIK, No. KK, paspor, dan jenis lain dari party_identification_types. NIK unik per tenant;
// No. KK boleh sama karena sekeluarga berbagi satu KK. Satu party paling banyak satu nomor per jenis. Nomor sensitif
// disamarkan bagi yang tidak memegang izin Lihat nomor identitas utuh (pola Data Sensitivity BC).
export class PartyIdentifications {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get seesFull(): boolean {
        return this.workspace.permissions.has('core.party-identification.read');
    }

    async types(): Promise<IdentificationType[]> {
        return this.db.rows(
            typeSchema,
            'select code, name, number_pattern, data_sensitivity from party_identification_types order by sort_order, code',
        );
    }

    private present(row: z.infer<typeof rowSchema>) {
        const masked = row.data_sensitivity === 'sensitive' && !this.seesFull;
        return {
            id: row.id,
            type_code: row.type_code,
            type_name: row.type_name,
            number: masked ? maskNumber(row.number) : row.number,
            masked,
            version: row.version,
        };
    }

    private rowSql(filter: string): string {
        return `select i.id, i.type_code, t.name as type_name, t.data_sensitivity, i.number, i.version
                from party_identifications i join party_identification_types t on t.code = i.type_code
                where i.tenant_id = $1 and i.party_id = $2 and i.deleted_at is null ${filter}`;
    }

    async list(partyId: string) {
        const rows = await this.db.rows(
            rowSchema,
            `${this.rowSql('')} order by t.sort_order, i.type_code`,
            [this.workspace.tenantId, partyId],
        );
        return rows.map((row) => this.present(row));
    }

    // Jenis dan nomor yang dikirim: jenis dari daftar, nomor tanpa spasi dan berhuruf besar, sesuai pola jenisnya.
    check(
        input: Record<string, unknown>,
        types: IdentificationType[],
        fixedType: string | null = null,
    ) {
        const problems = new Problems();
        const typeCode = fixedType ?? input.type_code;
        const type = types.find((item) => item.code === typeCode);
        if (!fixedType && !type)
            problems.add(
                'type_code',
                typeCode == null
                    ? 'Pilih jenis nomor identitas.'
                    : 'Pilih jenis dari daftar.',
            );
        const number =
            typeof input.number === 'string'
                ? input.number.replace(/\s+/gu, '').toUpperCase()
                : null;
        if (number === null || number === '')
            problems.add('number', 'Isi nomor.');
        else if (
            type?.number_pattern &&
            !new RegExp(type.number_pattern, 'u').test(number)
        )
            problems.add('number', `Format ${type.name} tidak sesuai.`);
        return { type_code: String(typeCode), number: number ?? '', problems };
    }

    // Pemeriksaan unik di aplikasi, sebelum indeks yang memutuskan permintaan bersamaan.
    async ensureFree(
        partyId: string,
        typeCode: string,
        number: string,
        except: string | null,
        field: string,
    ) {
        const sameType = await this.db.one(
            z.object({ found: z.boolean() }),
            `select true as found from party_identifications
             where tenant_id = $1 and party_id = $2 and type_code = $3 and deleted_at is null ${except ? 'and id <> $4' : ''}`,
            except
                ? [this.workspace.tenantId, partyId, typeCode, except]
                : [this.workspace.tenantId, partyId, typeCode],
        );
        if (sameType) validation({ [`${field}type_code`]: typeTaken });
        if (typeCode !== 'nik') return;
        const used = await this.db.one(
            z.object({ found: z.boolean() }),
            `select true as found from party_identifications
             where tenant_id = $1 and type_code = 'nik' and number = $2 and deleted_at is null and party_id <> $3`,
            [this.workspace.tenantId, number, partyId],
        );
        if (used) validation({ [`${field}number`]: nikTaken });
    }

    private async write<T>(
        field: string,
        action: () => Promise<T>,
    ): Promise<T> {
        try {
            return await action();
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (sqlErrorCode(error) === '23505') {
                if (message.includes('party_identifications_nik_unique'))
                    validation({ [`${field}number`]: nikTaken });
                if (message.includes('party_identifications_one_per_type'))
                    validation({ [`${field}type_code`]: typeTaken });
            }
            throw error;
        }
    }

    async insert(
        partyId: string,
        typeCode: string,
        number: string,
        field = '',
    ) {
        await this.ensureFree(partyId, typeCode, number, null, field);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        await this.write(field, () =>
            this.db.insert('party_identifications', {
                id,
                tenant_id: this.workspace.tenantId,
                party_id: partyId,
                type_code: typeCode,
                number,
                created_at: stamp,
                updated_at: stamp,
            }),
        );
        return id;
    }

    // Nomor identitas yang ikut dikirim bersama party baru, dengan kesalahan per baris `identifications.<n>.<field>`.
    async checkMany(input: unknown) {
        if (input === null || input === undefined) return [];
        if (!Array.isArray(input) || input.length > 20)
            validation({
                identifications: 'Isi paling banyak 20 nomor identitas.',
            });
        const types = await this.types();
        const problems = new Problems();
        const items = input.map((item, index) => {
            const checked = this.check(laravelBody.parse(item), types);
            problems.merge(`identifications.${index}`, checked.problems.errors);
            return { type_code: checked.type_code, number: checked.number };
        });
        items.forEach((item, index) => {
            if (
                items.findIndex(
                    (other) => other.type_code === item.type_code,
                ) !== index
            )
                problems.add(`identifications.${index}.type_code`, typeTaken);
        });
        problems.fail();
        return items;
    }

    async insertMany(
        partyId: string,
        items: { type_code: string; number: string }[],
    ) {
        for (const [index, item] of items.entries())
            await this.insert(
                partyId,
                item.type_code,
                item.number,
                `identifications.${index}.`,
            );
    }

    // Nomor satu jenis milik party, diganti dari fitur pemilik peran di transaksi pemanggil: nomor baru ditambah atau
    // menggantikan yang lama, dan null mengarsipkannya. Pemanggil sudah memeriksa izinnya sendiri. `field` adalah
    // nama isian pemanggil untuk pesan kesalahan.
    async replaceNumber(
        partyId: string,
        typeCode: string,
        input: string | null,
        field: string,
    ): Promise<void> {
        const current = await this.db.one(
            z.object({ id: z.string(), number: z.string() }),
            `select id, number from party_identifications
             where tenant_id = $1 and party_id = $2 and type_code = $3 and deleted_at is null for update`,
            [this.workspace.tenantId, partyId, typeCode],
        );
        if (input === null) {
            if (current)
                await this.db.execute(
                    'update party_identifications set deleted_at = $1, updated_at = $1 where id = $2',
                    [nowSql(), current.id],
                );
            return;
        }
        const checked = this.check(
            { number: input },
            await this.types(),
            typeCode,
        );
        if (checked.problems.failed)
            validation({
                [field]: checked.problems.errors.number ?? ['Isi nomor.'],
            });
        if (current?.number === checked.number) return;
        try {
            if (!current) {
                await this.insert(partyId, typeCode, checked.number, '');
                return;
            }
            await this.ensureFree(
                partyId,
                typeCode,
                checked.number,
                current.id,
                '',
            );
            await this.write('', () =>
                this.db.execute(
                    'update party_identifications set number = $1, updated_at = $2 where id = $3',
                    [checked.number, nowSql(), current.id],
                ),
            );
        } catch (error) {
            const errors =
                error instanceof HttpFailure && error.status === 422
                    ? z
                          .object({
                              errors: z.record(z.string(), z.array(z.string())),
                          })
                          .safeParse(error.body).data?.errors
                    : undefined;
            if (errors) validation({ [field]: Object.values(errors).flat() });
            throw error;
        }
    }

    async create(partyId: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        const checked = this.check(laravelBody.parse(body), await this.types());
        checked.problems.fail();
        const id = await this.db.transaction(() =>
            this.insert(partyId, checked.type_code, checked.number),
        );
        return {
            status: 201,
            headers: {},
            body: { data: await this.one(partyId, id) },
        };
    }

    async update(request: Request, partyId: string, id: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        const current = await this.row(partyId, id);
        const checked = this.check(
            laravelBody.parse(body),
            await this.types(),
            current.type_code,
        );
        checked.problems.fail();
        const version = expectedVersion(request, body);
        await this.ensureFree(
            partyId,
            current.type_code,
            checked.number,
            current.id,
            '',
        );
        await this.write('', () =>
            this.claim(current.id, version, 'number = $5', [checked.number]),
        );
        return {
            status: 200,
            headers: {},
            body: { data: await this.one(partyId, id) },
        };
    }

    async delete(request: Request, partyId: string, id: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        const current = await this.row(partyId, id);
        await this.claim(
            current.id,
            expectedVersion(request, body),
            'deleted_at = $5',
            [nowSql()],
        );
        return { status: 204, headers: {}, body: undefined };
    }

    private async row(partyId: string, id: string) {
        const found = lookupId(id)
            ? await this.db.one(rowSchema, this.rowSql('and i.id = $3'), [
                  this.workspace.tenantId,
                  partyId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async one(partyId: string, id: string) {
        return this.present(await this.row(partyId, id));
    }

    private async claim(
        id: string,
        version: number,
        assignments: string,
        values: string[],
    ) {
        const claimed = await this.db.execute(
            `update party_identifications set ${assignments}, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [nowSql(), this.workspace.tenantId, id, version, ...values],
        );
        if (!claimed) coded(409, 'stale_version', staleMessage);
    }
}
