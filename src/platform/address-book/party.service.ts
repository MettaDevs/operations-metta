import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { isoSql, nowSql, type Bind, type Database } from '../database/index.ts';
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
import { PartyAccess } from './party-access.service.ts';
import {
    Problems,
    checkDate,
    checkDetails,
    checkId,
    checkText,
    contactTypes,
    type Fields,
} from './party-address.schema.ts';
import { PartyAddresses } from './party-address.service.ts';
import {
    PartyDuplicates,
    refreshSearchStrings,
} from './party-duplicate.service.ts';
import { PartyIdentifications } from './party-identification.service.ts';
import { PartyRelationships } from './party-relationship.service.ts';
import { partyRowSchema } from './party.schema.ts';
import { createParty, searchName } from './party-store.service.ts';

// Isian identitas bersama party (Party::PROFILE_FIELDS CoreERP) beserta isian form pasien legacy yang menjadi milik
// party: warga negara, tempat lahir, agama, pendidikan, dan pekerjaan.
const textFields: Record<string, number> = {
    known_as: 200,
    personal_title: 200,
    personal_suffix: 200,
    first_name: 200,
    middle_name: 200,
    last_name: 200,
    initials: 200,
    professional_title: 200,
    professional_suffix: 200,
    organization_number: 200,
    duns_number: 200,
    interests: 2000,
    memo: 10000,
    birth_place: 120,
};
const referenceFields = [
    'gender',
    'marital_status',
    'abc_code',
    'language',
    'religion',
    'education',
];
const dateFields = ['birth_date', 'anniversary_date'];
const countFields = ['number_of_children', 'number_of_employees'];
const profileFields = [
    'tax_number',
    ...Object.keys(textFields),
    ...referenceFields,
    ...dateFields,
    ...countFields,
    'nationality_country_code',
    'occupation_id',
];

const partySql = (seesPrivate: boolean) => `
    select p.id, p.type, p.name, p.search_name, p.status, p.version, ${isoSql('p.deleted_at')} as deleted_at,
           p.tax_number, p.known_as, p.language, p.personal_title, p.personal_suffix, p.first_name, p.middle_name,
           p.last_name, p.initials, p.professional_title, p.professional_suffix, p.gender, p.marital_status,
           p.organization_number, p.duns_number, p.abc_code, p.birth_date::text as birth_date,
           p.anniversary_date::text as anniversary_date, p.number_of_children, p.number_of_employees, p.interests,
           p.memo, p.nationality_country_code, p.birth_place, p.religion, p.education, p.occupation_id,
           occupation.name as occupation_name, main_address.city, main_address.formatted as address
    from parties p
    left join occupations occupation on occupation.id = p.occupation_id
    left join lateral (
        select pa.city, pa.formatted from party_locations pl join postal_addresses pa on pa.location_id = pl.location_id
        where pl.tenant_id = p.tenant_id and pl.party_id = p.id and pl.deleted_at is null and pl.is_primary
          ${seesPrivate ? '' : 'and not pl.is_private'}
        limit 1) main_address on true`;

const roleSchema = z.object({
    party_id: z.string(),
    code: z.string(),
    name: z.string(),
    company: z.string().nullable(),
    legal_entity_id: z.string(),
});

const text = (value: unknown) => (typeof value === 'string' ? value : null);

// Direktori party (GlobalAddressBookController CoreERP) tanpa nomor party: orang mencari party lewat nama atau
// nomor perannya. Satu orang atau organisasi sungguhan adalah satu party; perannya per legal entity.
export class Parties {
    private accessCache: PartyAccess | null = null;

    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private async access(): Promise<PartyAccess> {
        return (this.accessCache ??= await PartyAccess.open(
            this.db,
            this.workspace,
        ));
    }

    private get seesPrivate(): boolean {
        return this.workspace.permissions.has('core.private-location.read');
    }

    // Party tenant ini yang terlihat bagi pengguna. Yang lain dijawab 404, supaya keberadaannya tidak bocor.
    async require(
        partyId: string,
        archived = false,
    ): Promise<{ id: string; type: string }> {
        const access = await this.access();
        const bindings: Bind[] = [this.workspace.tenantId, lookupId(partyId)];
        const found = bindings[1]
            ? await this.db.one(
                  z.object({ id: z.string(), type: z.string() }),
                  `select p.id, p.type from parties p
                   where p.tenant_id = $1 and p.id = $2 and p.deleted_at is ${archived ? 'not null' : 'null'}
                     and ${access.clause('p', (value) => {
                         bindings.push(value);
                         return `$${bindings.length}`;
                     })}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Peran yang ditampilkan hanya peran yang boleh dilihat pengguna, supaya peran seperti pasien tidak terbaca dari
    // party yang terlihat lewat peran lain.
    private async roles(partyIds: string[]) {
        const access = await this.access();
        if (!partyIds.length || !access.visibleRoles.length)
            return new Map<string, z.infer<typeof roleSchema>[]>();
        const rows = await this.db.rows(
            roleSchema,
            `select r.party_id, r.role_code as code, pr.name, le.name as company, r.legal_entity_id
             from party_role_registrations r
             join party_roles pr on pr.code = r.role_code
             left join organizations le on le.id = r.legal_entity_id
             where r.tenant_id = $1 and r.party_id in (${partyIds.map((_, index) => `$${index + 2}`).join(',')})
               and r.role_code in (${access.visibleRoles.map((_, index) => `$${index + partyIds.length + 2}`).join(',')})
             order by pr.sort_order, le.name, r.id`,
            [this.workspace.tenantId, ...partyIds, ...access.visibleRoles],
        );
        return Map.groupBy(rows, (row) => row.party_id);
    }

    private async present(rows: z.infer<typeof partyRowSchema>[]) {
        const roles = await this.roles(rows.map((row) => row.id));
        return rows.map((row) => ({
            ...row,
            roles: (roles.get(row.id) ?? []).map(
                ({ party_id: _, ...role }) => role,
            ),
        }));
    }

    async row(partyId: string, archived = false) {
        const party = await this.db.one(
            partyRowSchema,
            `${partySql(this.seesPrivate)} where p.tenant_id = $1 and p.id = $2 and p.deleted_at is ${archived ? 'not null' : 'null'}`,
            [this.workspace.tenantId, partyId],
        );
        if (!party) abort(404, 'Not Found');
        const [presented] = await this.present([party]);
        return presented!;
    }

    // Daftar bertahap direktori dengan pencarian nama dan saringan jenis, status, peran, dan arsip.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('organization', 'read');
        const access = await this.access();
        const bindings: Bind[] = [this.workspace.tenantId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const filters = [
            'p.tenant_id = $1',
            parameters.get('archived') === 'only'
                ? 'p.deleted_at is not null'
                : 'p.deleted_at is null',
            access.clause('p', bind),
        ];
        for (const field of ['type', 'status'] as const) {
            const value = parameters.get(field);
            if (value) filters.push(`p.${field} = ${bind(value)}`);
        }
        const role = parameters.get('role');
        if (role)
            filters.push(
                `exists (select 1 from party_role_registrations r where r.tenant_id = p.tenant_id and r.party_id = p.id and r.role_code = ${bind(role)})`,
            );
        const batch = await incrementalList(this.db, {
            query: `${partySql(this.seesPrivate)} where ${filters.join(' and ')}`,
            bindings,
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name', 'search_name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: await this.present(
                batch.data.map((row) => partyRowSchema.parse(row)),
            ),
            next_cursor: batch.next_cursor,
        };
    }

    // Pilihan party aktif untuk lookup di layar lain, paling banyak 30.
    async options(parameters: URLSearchParams) {
        this.workspace.guard('organization', 'read');
        const access = await this.access();
        const bindings: Bind[] = [this.workspace.tenantId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const keyword = (parameters.get('q') ?? '').trim();
        const filters = [
            'p.tenant_id = $1',
            "p.status = 'active'",
            'p.deleted_at is null',
            access.clause('p', bind),
        ];
        if (keyword)
            filters.push(
                `p.search_name like ${bind(`%${searchName(keyword).replace(/[\\%_]/g, '\\$&')}%`)}`,
            );
        return {
            data: await this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    type: z.string(),
                }),
                `select p.id, p.name, p.type from parties p where ${filters.join(' and ')} order by p.name, p.id limit 30`,
                bindings,
            ),
        };
    }

    async metadata() {
        this.workspace.guard('organization', 'read');
        const rows = <S extends z.ZodType>(schema: S, query: string) =>
            this.db.rows(schema, query);
        const references = await rows(
            z.object({
                category: z.string(),
                code: z.string(),
                name: z.string(),
            }),
            'select category, code, name from party_reference_values order by category, name',
        );
        return {
            data: {
                canManage: this.workspace.permissions.has(
                    'core.organization.update',
                ),
                partyTypes: await rows(
                    z.object({ code: z.string(), name: z.string() }),
                    'select code, name from party_types order by code',
                ),
                referenceValues: Object.fromEntries(
                    Map.groupBy(references, (row) => row.category).entries(),
                ),
                relationshipTypes: await rows(
                    z.object({
                        code: z.string(),
                        name: z.string(),
                        inverse_name: z.string(),
                        from_type: z.string(),
                        to_type: z.string(),
                    }),
                    'select code, name, inverse_name, from_type, to_type from party_relationship_types order by code',
                ),
                locationPurposes: await rows(
                    z.object({ code: z.string(), name: z.string() }),
                    'select code, name from location_purposes order by sort_order',
                ),
                countries: await rows(
                    z.object({ code: z.string(), name: z.string() }),
                    'select code, name from country_regions order by name',
                ),
                contactTypes,
                identificationTypes: await rows(
                    z.object({ code: z.string(), name: z.string() }),
                    'select code, name from party_identification_types order by sort_order, code',
                ),
                roles: await rows(
                    z.object({ code: z.string(), name: z.string() }),
                    'select code, name from party_roles order by sort_order, code',
                ),
            },
        };
    }

    async show(partyId: string) {
        this.workspace.guard('organization', 'read');
        await this.require(partyId);
        const organization = await this.db.one(
            z.object({ organization_id: z.string() }),
            'select organization_id from organization_parties where tenant_id = $1 and party_id = $2',
            [this.workspace.tenantId, partyId],
        );
        return {
            data: {
                ...(await this.row(partyId)),
                organization_id: organization?.organization_id ?? null,
                identifications: await new PartyIdentifications(
                    this.db,
                    this.workspace,
                ).list(partyId),
                relationships: await new PartyRelationships(
                    this.db,
                    this.workspace,
                ).list(partyId),
            },
        };
    }

    // validated() GlobalAddressBookController CoreERP, ditambah isian identitas baru. Isian yang tidak dikirim tidak
    // diubah; pada party baru ia kosong.
    private async check(
        input: Fields,
        current: { type: string; name: string; search_name: string } | null,
    ) {
        const problems = new Problems();
        if (typeof input.name !== 'string' || !/\S/u.test(input.name))
            problems.add('name', 'Isi nama.');
        else checkText(problems, input, 'name', 200);
        const types =
            current === null ? ['person', 'organization'] : [current.type];
        if (input.type == null) problems.add('type', 'Pilih jenis pihak.');
        else if (!types.includes(String(input.type)))
            problems.add(
                'type',
                current === null
                    ? 'Pilih jenis pihak dari daftar.'
                    : 'Jenis pihak yang sudah tersimpan tidak dapat diganti. Buat pihak yang sesuai dan tautkan akun bisnisnya.',
            );
        checkText(problems, input, 'search_name', 200);
        // Buku alamat sebagai kelompok pencarian belum pindah; kirimannya ditolak supaya tidak hilang diam-diam.
        if (input.address_book_ids != null)
            problems.add(
                'address_book_ids',
                'Kelompok buku alamat belum dapat disimpan bersama pihak.',
            );
        if (!['active', 'inactive'].includes(String(input.status)))
            problems.add('status', 'Pilih status aktif atau nonaktif.');
        for (const [field, max] of Object.entries(textFields))
            checkText(problems, input, field, max);
        const references = new Set(
            (
                await this.db.rows(
                    z.object({ key: z.string() }),
                    "select category || ':' || code as key from party_reference_values",
                )
            ).map((row) => row.key),
        );
        for (const field of referenceFields) {
            const value = input[field];
            if (
                value != null &&
                !(
                    typeof value === 'string' &&
                    references.has(`${field}:${value}`)
                )
            )
                problems.add(field, 'Pilih dari daftar.');
        }
        const today = new Date().toISOString().slice(0, 10);
        for (const field of dateFields) {
            checkDate(problems, input, field);
            if (
                typeof input[field] === 'string' &&
                (input[field] as string) > today &&
                !problems.errors[field]
            )
                problems.add(field, 'Tanggal tidak boleh melewati hari ini.');
        }
        for (const field of countFields) {
            const value = input[field];
            if (value == null) continue;
            const number = typeof value === 'number' ? value : Number(value);
            if (!Number.isInteger(number) || number < 0 || number > 100_000_000)
                problems.add(field, 'Isi bilangan bulat 0 sampai 100.000.000.');
        }
        if (input.tax_number != null) {
            checkText(problems, input, 'tax_number', 32);
            if (
                typeof input.tax_number === 'string' &&
                !/^[0-9.\- ]+$/.test(input.tax_number)
            )
                problems.add(
                    'tax_number',
                    'NPWP hanya berisi angka, titik, tanda hubung, dan spasi.',
                );
        }
        if (input.nationality_country_code != null) {
            const code =
                text(input.nationality_country_code)?.toUpperCase() ?? null;
            const country = code
                ? await this.db.one(
                      z.object({ code: z.string() }),
                      'select code from country_regions where code = $1',
                      [code],
                  )
                : undefined;
            if (!country)
                problems.add(
                    'nationality_country_code',
                    'Pilih negara dari daftar.',
                );
        }
        checkId(problems, input, 'occupation_id');
        if (
            typeof input.occupation_id === 'string' &&
            !problems.errors.occupation_id
        ) {
            const occupation = await this.db.one(
                z.object({ id: z.string() }),
                'select id from occupations where tenant_id = $1 and id = $2 and deleted_at is null',
                [this.workspace.tenantId, input.occupation_id],
            );
            if (!occupation)
                problems.add('occupation_id', 'Pilih pekerjaan dari daftar.');
        }
        return problems;
    }

    // Kolom party dari kiriman yang sudah diperiksa.
    private columns(
        input: Fields,
        current: { name: string; search_name: string } | null,
    ) {
        const data: Record<string, Bind> = {
            name: String(input.name).trim(),
            type: String(input.type),
            status: String(input.status),
        };
        for (const field of profileFields) {
            if (!(field in input)) {
                if (current === null) data[field] = null;
                continue;
            }
            const value = input[field] ?? null;
            data[field] =
                value === null
                    ? null
                    : countFields.includes(field)
                      ? Number(value)
                      : field === 'nationality_country_code'
                        ? String(value).toUpperCase()
                        : String(value);
        }
        if (
            !('search_name' in input) &&
            current !== null &&
            current.search_name !== searchName(current.name)
        )
            data.search_name = current.search_name;
        else
            data.search_name = searchName(
                text(input.search_name)?.trim() || String(data.name),
            );
        return data;
    }

    async create(request: Request, body: unknown) {
        this.workspace.guard('organization', 'update');
        const input = laravelBody.parse(body);
        const problems = await this.check(input, null);
        problems.fail();
        const addresses = new PartyAddresses(this.db, this.workspace);
        const details = checkDetails(
            input.party_details,
            await addresses.references(),
        );
        const identifications = new PartyIdentifications(
            this.db,
            this.workspace,
        );
        const numbers = await identifications.checkMany(input.identifications);
        const header = request.headers.get('idempotency-key');
        const key = `directory:${header && /^[A-Za-z0-9._:-]{8,120}$/.test(header) ? header : Bun.randomUUIDv7()}`;
        const { id, created } = await this.db.transaction(async () => {
            const result = await createParty(
                this.db,
                this.workspace.tenantId,
                this.columns(input, null),
                key,
            );
            if (result.created) {
                await identifications.insertMany(result.id, numbers);
                await addresses.saveDetails(result.id, details);
                await refreshSearchStrings(
                    this.db,
                    this.workspace.tenantId,
                    result.id,
                );
            }
            return result;
        });
        const duplicates = await new PartyDuplicates(
            this.db,
            this.workspace,
        ).forParty(id);
        return {
            status: created ? 201 : 200,
            headers: {},
            body: { data: await this.row(id), duplicates: duplicates.data },
        };
    }

    async update(request: Request, partyId: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        await this.require(partyId);
        const current = await this.db.one(
            z.object({
                type: z.string(),
                name: z.string(),
                search_name: z.string(),
            }),
            'select type, name, search_name from parties where tenant_id = $1 and id = $2',
            [this.workspace.tenantId, partyId],
        );
        const input = laravelBody.parse(body);
        const problems = await this.check(input, current!);
        problems.fail();
        const version = expectedVersion(request, body);
        const data = this.columns(input, current!);
        await this.db.transaction(async () => {
            await this.claim(partyId, version);
            const organization = await this.db.one(
                z.object({ found: z.boolean() }),
                'select true as found from organization_parties where tenant_id = $1 and party_id = $2',
                [this.workspace.tenantId, partyId],
            );
            if (organization && data.name !== current!.name)
                validation({
                    name: 'Ubah nama organisasi melalui halaman Organisasi agar identitasnya tetap sama.',
                });
            const columns = Object.keys(data);
            await this.db.execute(
                `update parties set ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where tenant_id = $${columns.length + 2} and id = $${columns.length + 3}`,
                [
                    ...Object.values(data),
                    nowSql(),
                    this.workspace.tenantId,
                    partyId,
                ],
            );
            await refreshSearchStrings(
                this.db,
                this.workspace.tenantId,
                partyId,
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(partyId) },
        };
    }

    // Mengarsipkan party: deleted_at diisi, barisnya tetap. Party yang masih dipakai peran atau organisasi ditolak.
    async destroy(request: Request, partyId: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        await this.require(partyId);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.claim(partyId, version);
            const used = await this.db.one(
                z.object({ found: z.boolean() }),
                `select true as found where exists (select 1 from party_role_registrations where tenant_id = $1 and party_id = $2)
                    or exists (select 1 from organization_parties where tenant_id = $1 and party_id = $2)`,
                [this.workspace.tenantId, partyId],
            );
            if (used)
                validation({
                    party: 'Pihak ini masih dipakai akun bisnis atau organisasi. Nonaktifkan untuk menghentikan pemakaian baru.',
                });
            const stamp = nowSql();
            await this.db.execute(
                'update parties set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, this.workspace.tenantId, partyId],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    async restore(request: Request, partyId: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        await this.require(partyId, true);
        const version = expectedVersion(request, body);
        const restored = await this.db.execute(
            'update parties set deleted_at = null, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is not null',
            [nowSql(), this.workspace.tenantId, partyId, version],
        );
        if (!restored) coded(409, 'stale_version', staleMessage);
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(partyId) },
        };
    }

    private async claim(partyId: string, version: number) {
        const claimed = await this.db.execute(
            'update parties set version = $1 where tenant_id = $2 and id = $3 and version = $1 and deleted_at is null',
            [version, this.workspace.tenantId, partyId],
        );
        if (!claimed) coded(409, 'stale_version', staleMessage);
    }
}
