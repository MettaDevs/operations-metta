import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { nowSql, type Bind, type Database } from '../database/index.ts';
import { resolvePostalRegions } from '../geography/index.ts';
import {
    abort,
    coded,
    HttpFailure,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import {
    flag,
    type Fields,
    type PartyDetails,
    type References,
} from './party-address.schema.ts';
import { refreshSearchStrings } from './party-duplicate.service.ts';
import { createParty, lockParty, searchName } from './party-store.service.ts';

const contactLocationName = 'Informasi kontak';
const regionIds = [
    'province_id',
    'regency_id',
    'district_id',
    'village_id',
    'postal_code_id',
    'group_of_houses_id',
] as const;

const locationSchema = z.object({
    id: z.string(),
    version: z.number(),
    location_id: z.string(),
    is_location_owner: z.boolean(),
    owner_party_name: z.string().nullable(),
    name: z.string(),
    purposes: z.array(z.string()),
    is_primary: z.boolean(),
    is_private: z.boolean(),
    valid_from: z.string().nullable(),
    valid_to: z.string().nullable(),
    shared_with: z.number(),
    country_region_code: z.string().nullable(),
    province_id: z.string().nullable(),
    regency_id: z.string().nullable(),
    district_id: z.string().nullable(),
    village_id: z.string().nullable(),
    postal_code_id: z.string().nullable(),
    group_of_houses_id: z.string().nullable(),
    province: z.string().nullable(),
    city: z.string().nullable(),
    district: z.string().nullable(),
    village: z.string().nullable(),
    group_of_houses: z.string().nullable(),
    rt: z.string().nullable(),
    rw: z.string().nullable(),
    street: z.string().nullable(),
    building: z.string().nullable(),
    postbox: z.string().nullable(),
    postal_code: z.string().nullable(),
    formatted: z.string(),
});
const sharableSchema = locationSchema.pick({
    id: true,
    name: true,
    formatted: true,
    country_region_code: true,
    province_id: true,
    regency_id: true,
    district_id: true,
    village_id: true,
    postal_code_id: true,
    group_of_houses_id: true,
    province: true,
    city: true,
    district: true,
    village: true,
    group_of_houses: true,
    rt: true,
    rw: true,
    street: true,
    building: true,
    postbox: true,
    postal_code: true,
});
const contactSchema = z.object({
    id: z.string(),
    version: z.number(),
    is_location_owner: z.boolean(),
    type: z.string(),
    value: z.string(),
    purpose: z.string().nullable(),
    is_primary: z.boolean(),
    address_id: z.string().nullable(),
    address_name: z.string().nullable(),
});
const linkSchema = z.object({
    id: z.string(),
    location_id: z.string(),
    is_primary: z.boolean(),
    owner_party_id: z.string().nullable(),
});
const contactRowSchema = z.object({
    id: z.string(),
    location_id: z.string(),
    type: z.string(),
    is_primary: z.boolean(),
});
const postalSchema = z.object({
    id: z.string(),
    village: z.string().nullable(),
    rt: z.string().nullable(),
    rw: z.string().nullable(),
    group_of_houses: z.string().nullable(),
    province_id: z.string().nullable(),
    regency_id: z.string().nullable(),
    district_id: z.string().nullable(),
    village_id: z.string().nullable(),
    postal_code_id: z.string().nullable(),
    group_of_houses_id: z.string().nullable(),
});

const clean = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

// PostalAddressFormatter CoreERP: jalan dan gedung, PO Box, RT/RW, dusun/banjar, kelurahan, kecamatan, lalu kota,
// provinsi, dan kode pos. Nama negara hanya untuk alamat di luar Indonesia. Dokumen menyalin bentuk ini, jadi
// perubahan alamat kemudian tidak menulis ulang dokumen lama.
export function formatPostalAddress(
    fields: Record<string, string | null>,
    countryName: string | null,
): string {
    const lines: string[] = [];
    const join = (values: (string | null | undefined)[], separator: string) =>
        values.filter((value) => value).join(separator);
    const street = join([fields.street, fields.building], ', ');
    if (street) lines.push(street);
    if (fields.postbox) lines.push(`PO Box ${fields.postbox}`);
    const neighborhood = join(
        [
            fields.rt ? `RT ${fields.rt}` : null,
            fields.rw ? `RW ${fields.rw}` : null,
        ],
        ' / ',
    );
    if (neighborhood) lines.push(neighborhood);
    if (fields.group_of_houses) lines.push(fields.group_of_houses);
    if (fields.village) lines.push(fields.village);
    if (fields.district) lines.push(fields.district);
    const city = join(
        [join([fields.city, fields.province], ', '), fields.postal_code],
        ' ',
    ).trim();
    if (city) lines.push(city);
    const country = (fields.country_region_code ?? '').toUpperCase();
    if (country && country !== 'ID') lines.push(countryName ?? country);
    return lines.join('\n');
}

// Alamat dan kontak satu party (OrganizationAddressBook CoreERP). Bentuknya mengikuti Dynamics 365: alamat adalah
// tautan party ke tempat, tempat dapat dipakai beberapa pihak, dan kontak menempel ke tempat. Id alamat di API adalah
// id tautan. Melepas alamat mengarsipkan tautannya saja. Tautan privat hanya terlihat bagi pemegang izin Lihat alamat
// privat, beserta kontak di tempatnya.
export class PartyAddresses {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get tenantId(): string {
        return this.workspace.tenantId;
    }

    private get seesPrivate(): boolean {
        return this.workspace.permissions.has('core.private-location.read');
    }

    async references(): Promise<References> {
        const purposes = await this.db.rows(
            z.object({ code: z.string() }),
            'select code from location_purposes order by sort_order',
        );
        const countries = await this.db.rows(
            z.object({ code: z.string() }),
            'select code from country_regions',
        );
        return {
            purposes: new Set(purposes.map((row) => row.code)),
            countries: new Set(countries.map((row) => row.code)),
        };
    }

    // Party milik organisasi, dibuat saat pertama dibutuhkan supaya organisasi lama ikut punya. Nama dan jenisnya
    // disamakan dengan organisasi setiap kali dibaca.
    async organizationParty(organizationId: string): Promise<string> {
        const organization = await this.db.one(
            z.object({
                id: z.string(),
                name: z.string(),
                classification: z.string(),
            }),
            'select id, name, classification from organizations where tenant_id = $1 and id = $2',
            [this.tenantId, organizationId],
        );
        if (!organization) abort(404, 'Not Found');
        const linked = await this.db.one(
            z.object({
                party_id: z.string(),
                name: z.string(),
                type: z.string(),
            }),
            `select l.party_id, p.name, p.type from organization_parties l join parties p on p.id = l.party_id
             where l.tenant_id = $1 and l.organization_id = $2`,
            [this.tenantId, organizationId],
        );
        if (linked) {
            if (
                linked.name !== organization.name ||
                linked.type !== organization.classification
            )
                await this.db.execute(
                    'update parties set name = $1, search_name = $2, type = $3, updated_at = $4 where id = $5',
                    [
                        organization.name,
                        searchName(organization.name),
                        organization.classification,
                        nowSql(),
                        linked.party_id,
                    ],
                );
            return linked.party_id;
        }
        return this.db.transaction(async () => {
            await this.db.execute(
                'select id from organizations where tenant_id = $1 and id = $2 for update',
                [this.tenantId, organizationId],
            );
            const existing = await this.db.one(
                z.object({ party_id: z.string() }),
                'select party_id from organization_parties where tenant_id = $1 and organization_id = $2',
                [this.tenantId, organizationId],
            );
            if (existing) return existing.party_id;
            const { id } = await createParty(
                this.db,
                this.tenantId,
                {
                    type: organization.classification,
                    name: organization.name,
                    status: 'active',
                },
                `organization:${organizationId}`,
            );
            const stamp = nowSql();
            await this.db.insert('organization_parties', {
                organization_id: organizationId,
                tenant_id: this.tenantId,
                party_id: id,
                created_at: stamp,
                updated_at: stamp,
            });
            return id;
        });
    }

    private locationSql(filter: string): string {
        return `
            select pl.id, pl.version, pl.location_id, l.owner_party_id = pl.party_id as is_location_owner,
                   owner.name as owner_party_name, l.name,
                   coalesce((select json_agg(lp.code order by lp.sort_order)
                             from party_location_purposes plp join location_purposes lp on lp.code = plp.purpose_code
                             where plp.party_location_id = pl.id and plp.deleted_at is null), '[]') as purposes,
                   pl.is_primary, pl.is_private, pl.valid_from::text as valid_from, pl.valid_to::text as valid_to,
                   (select count(*) from party_locations other
                    where other.location_id = pl.location_id and other.party_id <> pl.party_id
                      and other.deleted_at is null)::int as shared_with,
                   pa.country_region_code, pa.province_id, pa.regency_id, pa.district_id, pa.village_id,
                   pa.postal_code_id, pa.group_of_houses_id, pa.province, pa.city, pa.district, pa.village,
                   pa.group_of_houses, pa.rt, pa.rw, pa.street, pa.building, pa.postbox, pa.postal_code, pa.formatted
            from party_locations pl
            join locations l on l.id = pl.location_id and l.deleted_at is null
            join postal_addresses pa on pa.location_id = l.id
            left join parties owner on owner.id = l.owner_party_id and owner.deleted_at is null
            where pl.tenant_id = $1 and pl.party_id = $2 and pl.deleted_at is null
              ${this.seesPrivate ? '' : 'and not pl.is_private'} ${filter}`;
    }

    async locations(partyId: string) {
        return this.db.rows(
            locationSchema,
            `${this.locationSql('')} order by pl.is_primary desc, pl.created_at, pl.id`,
            [this.tenantId, partyId],
        );
    }

    private async location(partyId: string, linkId: string) {
        const found = await this.db.one(
            locationSchema,
            this.locationSql('and pl.id = $3'),
            [this.tenantId, partyId, linkId],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Tautan party yang tampil sebagai alamat: tempatnya beralamat pos dan terlihat bagi pengguna ini.
    private async addressLink(partyId: string, linkId: unknown) {
        const id = typeof linkId === 'string' ? lookupId(linkId) : null;
        const link = id
            ? await this.db.one(
                  linkSchema,
                  `select pl.id, pl.location_id, pl.is_primary, l.owner_party_id
                   from party_locations pl join locations l on l.id = pl.location_id
                   where pl.tenant_id = $1 and pl.party_id = $2 and pl.id = $3 and pl.deleted_at is null
                     and exists (select 1 from postal_addresses pa where pa.location_id = pl.location_id)
                     ${this.seesPrivate ? '' : 'and not pl.is_private'}`,
                  [this.tenantId, partyId, id],
              )
            : undefined;
        if (!link) abort(404, 'Not Found');
        return link;
    }

    private ensureOwner(partyId: string, ownerPartyId: string | null): void {
        if (ownerPartyId !== partyId)
            validation({
                address_id:
                    'Alamat dan kontak bersama hanya dapat diubah melalui pihak pemiliknya. Buka pihak pemilik di buku alamat, atau tambahkan alamat baru untuk pihak ini.',
            });
    }

    // Klaim versi baris yang dibuka pengguna (RowVersion::claim CoreERP): baris yang hilang 404, versi lama 409.
    private async claim(table: string, id: string, version: number) {
        const claimed = await this.db.execute(
            `update ${table} set updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [nowSql(), this.tenantId, id, version],
        );
        if (!claimed) coded(409, 'stale_version', staleMessage);
    }

    // Tempat beralamat pos milik tenant yang bisa ditautkan ke party ini. Tempat yang ditandai privat oleh party mana
    // pun tidak ditawarkan.
    async sharableLocations(partyId: string, parameters: URLSearchParams) {
        const batch = await incrementalList(this.db, {
            query: `select l.id, l.name, pa.formatted, pa.country_region_code, pa.province_id, pa.regency_id,
                           pa.district_id, pa.village_id, pa.postal_code_id, pa.group_of_houses_id, pa.province, pa.city,
                           pa.district, pa.village, pa.group_of_houses, pa.rt, pa.rw, pa.street, pa.building, pa.postbox,
                           pa.postal_code
                    from locations l join postal_addresses pa on pa.location_id = l.id
                    where l.tenant_id = $1 and l.deleted_at is null
                      and not exists (select 1 from party_locations own where own.location_id = l.id
                                      and own.party_id = $2 and own.deleted_at is null)
                      and not exists (select 1 from party_locations private where private.location_id = l.id
                                      and private.is_private and private.deleted_at is null)`,
            bindings: [this.tenantId, partyId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name', 'formatted'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => sharableSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    // Membuat atau mengubah satu alamat (saveLocation CoreERP). `location_id` menautkan tempat yang sudah ada tanpa
    // mengubah alamat posnya. Alamat pertama otomatis utama.
    async saveLocation(
        partyId: string,
        data: Fields,
        linkId: string | null = null,
        version = 0,
    ) {
        return this.db.transaction(async () => {
            await lockParty(this.db, this.tenantId, partyId);
            let locationId: string;
            let link: { id: string; is_primary: boolean } | null = null;
            if (linkId !== null) {
                const found = await this.addressLink(partyId, linkId);
                await this.claim('party_locations', found.id, version);
                this.ensureOwner(partyId, found.owner_party_id);
                locationId = found.location_id;
                link = found;
            } else if (data.location_id != null) {
                const shared = await this.db.one(
                    z.object({ id: z.string() }),
                    `select l.id from locations l where l.tenant_id = $1 and l.id = $2 and l.deleted_at is null
                       and exists (select 1 from postal_addresses pa where pa.location_id = l.id)
                       and not exists (select 1 from party_locations private where private.location_id = l.id
                                       and private.is_private and private.deleted_at is null)`,
                    [this.tenantId, data.location_id as string],
                );
                if (!shared) abort(404, 'Not Found');
                locationId = shared.id;
                link =
                    (await this.db.one(
                        z.object({ id: z.string(), is_primary: z.boolean() }),
                        'select id, is_primary from party_locations where tenant_id = $1 and party_id = $2 and location_id = $3 and deleted_at is null',
                        [this.tenantId, partyId, locationId],
                    )) ?? null;
            } else {
                locationId = Bun.randomUUIDv7();
                const stamp = nowSql();
                await this.db.insert('locations', {
                    id: locationId,
                    tenant_id: this.tenantId,
                    name: String(data.name),
                    owner_party_id: partyId,
                    created_at: stamp,
                    updated_at: stamp,
                });
            }
            await this.db.execute(
                'select id from locations where tenant_id = $1 and id = $2 for update',
                [this.tenantId, locationId],
            );

            const others = await this.db.one(
                z.object({ found: z.boolean() }),
                `select true as found from party_locations pl
                 where pl.tenant_id = $1 and pl.party_id = $2 and pl.deleted_at is null
                   and exists (select 1 from postal_addresses pa where pa.location_id = pl.location_id)
                   ${link ? 'and pl.id <> $3' : ''} limit 1`,
                link
                    ? [this.tenantId, partyId, link.id]
                    : [this.tenantId, partyId],
            );
            const primary =
                !others ||
                flag(data.is_primary) === true ||
                (link !== null && link.is_primary && !('is_primary' in data));
            if (primary)
                await this.db.execute(
                    `update party_locations set is_primary = false, updated_at = $1
                     where tenant_id = $2 and party_id = $3 and deleted_at is null and is_primary
                     ${link ? 'and id <> $4' : ''}`,
                    link
                        ? [nowSql(), this.tenantId, partyId, link.id]
                        : [nowSql(), this.tenantId, partyId],
                );
            const linkFields: Record<string, Bind> = {
                is_primary: primary,
                ...('is_private' in data
                    ? { is_private: flag(data.is_private) ?? false }
                    : {}),
                ...('valid_from' in data
                    ? { valid_from: (data.valid_from as string | null) ?? null }
                    : {}),
                ...('valid_to' in data
                    ? { valid_to: (data.valid_to as string | null) ?? null }
                    : {}),
            };
            const stamp = nowSql();
            if (link) {
                const columns = Object.keys(linkFields);
                await this.db.execute(
                    `update party_locations set ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')},
                         updated_at = $${columns.length + 1}
                     where id = $${columns.length + 2}`,
                    [...Object.values(linkFields), stamp, link.id],
                );
            } else {
                link = { id: Bun.randomUUIDv7(), is_primary: primary };
                await this.db.insert('party_locations', {
                    id: link.id,
                    tenant_id: this.tenantId,
                    party_id: partyId,
                    location_id: locationId,
                    ...linkFields,
                    created_at: stamp,
                    updated_at: stamp,
                });
            }

            if (data.location_id == null || linkId !== null) {
                await this.db.execute(
                    'update locations set name = $1, updated_at = $2 where id = $3 and name is distinct from $1',
                    [String(data.name), stamp, locationId],
                );
                await this.savePostalAddress(locationId, data);
            }
            await this.syncPurposes(link.id, (data.purposes as string[]) ?? []);
            return this.location(partyId, link.id);
        });
    }

    private async savePostalAddress(locationId: string, input: Fields) {
        const existing = await this.db.one(
            postalSchema,
            `select id, village, rt, rw, group_of_houses, province_id, regency_id, district_id, village_id,
                    postal_code_id, group_of_houses_id
             from postal_addresses where tenant_id = $1 and location_id = $2`,
            [this.tenantId, locationId],
        );
        const data = await resolvePostalRegions(
            this.db,
            this.tenantId,
            input,
            existing ?? null,
        );
        const kept = (field: 'village' | 'rt' | 'rw' | 'group_of_houses') =>
            clean(field in data ? data[field] : existing?.[field]);
        const fields = {
            country_region_code: String(data.country_region_code).toUpperCase(),
            province: clean(data.province),
            city: clean(data.city),
            district: clean(data.district),
            village: kept('village'),
            group_of_houses: kept('group_of_houses'),
            rt: kept('rt'),
            rw: kept('rw'),
            street: clean(data.street),
            building: clean(data.building),
            postbox: clean(data.postbox),
            postal_code: clean(data.postal_code),
        };
        const country = await this.db.one(
            z.object({ name: z.string() }),
            'select name from country_regions where code = $1',
            [fields.country_region_code],
        );
        const row: Record<string, Bind> = {
            ...fields,
            ...Object.fromEntries(
                regionIds.map((field) => [
                    field,
                    (data[field] as string | null) ?? null,
                ]),
            ),
            formatted: formatPostalAddress(fields, country?.name ?? null),
        };
        const stamp = nowSql();
        if (existing) {
            const columns = Object.keys(row);
            await this.db.execute(
                `update postal_addresses set ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where id = $${columns.length + 2}`,
                [...Object.values(row), stamp, existing.id],
            );
        } else
            await this.db.insert('postal_addresses', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.tenantId,
                location_id: locationId,
                ...row,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    private async syncPurposes(linkId: string, purposes: string[]) {
        const stamp = nowSql();
        const current = await this.db.rows(
            z.object({ purpose_code: z.string() }),
            'select purpose_code from party_location_purposes where party_location_id = $1 and deleted_at is null',
            [linkId],
        );
        for (const { purpose_code } of current)
            if (!purposes.includes(purpose_code))
                await this.db.execute(
                    'update party_location_purposes set deleted_at = $1, updated_at = $1 where party_location_id = $2 and purpose_code = $3 and deleted_at is null',
                    [stamp, linkId, purpose_code],
                );
        const kept = new Set(current.map((row) => row.purpose_code));
        for (const code of purposes)
            if (!kept.has(code))
                await this.db.insert('party_location_purposes', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.tenantId,
                    party_location_id: linkId,
                    purpose_code: code,
                    created_at: stamp,
                    updated_at: stamp,
                });
    }

    // Melepas alamat: tautannya diarsipkan, tempatnya tidak. Bila yang dilepas utama, alamat tertua naik.
    async deleteLocation(partyId: string, linkId: string, version: number) {
        await this.db.transaction(async () => {
            await lockParty(this.db, this.tenantId, partyId);
            const link = await this.addressLink(partyId, linkId);
            await this.claim('party_locations', link.id, version);
            const stamp = nowSql();
            await this.db.execute(
                'update party_locations set is_primary = false, deleted_at = $1, updated_at = $1 where id = $2',
                [stamp, link.id],
            );
            if (link.is_primary)
                await this.db.execute(
                    `update party_locations set is_primary = true, updated_at = $1 where id = (
                         select pl.id from party_locations pl
                         where pl.tenant_id = $2 and pl.party_id = $3 and pl.deleted_at is null
                           and exists (select 1 from postal_addresses pa where pa.location_id = pl.location_id)
                         order by pl.created_at, pl.id limit 1)`,
                    [stamp, this.tenantId, partyId],
                );
        });
    }

    private contactSql(filter: string): string {
        return `
            select e.id, e.version, l.owner_party_id = pl.party_id as is_location_owner, e.type, e.value, e.purpose,
                   e.is_primary,
                   case when pa.id is null then null else pl.id end as address_id,
                   case when pa.id is null then null else l.name end as address_name
            from electronic_addresses e
            join party_locations pl on pl.location_id = e.location_id and pl.party_id = $2 and pl.deleted_at is null
            join locations l on l.id = e.location_id
            left join postal_addresses pa on pa.location_id = l.id
            where e.tenant_id = $1 and e.deleted_at is null ${this.seesPrivate ? '' : 'and not pl.is_private'} ${filter}`;
    }

    async contacts(partyId: string) {
        return this.db.rows(
            contactSchema,
            `${this.contactSql('')} order by e.type, e.is_primary desc, e.created_at, e.id`,
            [this.tenantId, partyId],
        );
    }

    private async contactRow(partyId: string, contactId: string) {
        const id = lookupId(contactId);
        const found = id
            ? await this.db.one(
                  contactRowSchema,
                  `select e.id, e.location_id, e.type, e.is_primary from electronic_addresses e
                   join party_locations pl on pl.location_id = e.location_id and pl.party_id = $2 and pl.deleted_at is null
                   where e.tenant_id = $1 and e.id = $3 and e.deleted_at is null
                     ${this.seesPrivate ? '' : 'and not pl.is_private'}`,
                  [this.tenantId, partyId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Kontak umum menempel ke alamat utama milik party ini; tanpa itu ke tempat "Informasi kontak" yang tidak tampil
    // sebagai alamat.
    private async defaultContactLocation(partyId: string): Promise<string> {
        const primary = await this.db.one(
            z.object({ location_id: z.string() }),
            `select pl.location_id from party_locations pl join locations l on l.id = pl.location_id
             where pl.tenant_id = $1 and pl.party_id = $2 and pl.deleted_at is null and pl.is_primary
               and l.owner_party_id = $2 and exists (select 1 from postal_addresses pa where pa.location_id = pl.location_id)
             limit 1`,
            [this.tenantId, partyId],
        );
        if (primary) return primary.location_id;
        const existing = await this.db.one(
            z.object({ location_id: z.string() }),
            `select pl.location_id from party_locations pl join locations l on l.id = pl.location_id
             where pl.tenant_id = $1 and pl.party_id = $2 and pl.deleted_at is null and l.owner_party_id = $2
               and not exists (select 1 from postal_addresses pa where pa.location_id = pl.location_id)
             order by pl.created_at, pl.id limit 1`,
            [this.tenantId, partyId],
        );
        if (existing) return existing.location_id;
        const locationId = Bun.randomUUIDv7();
        const stamp = nowSql();
        await this.db.insert('locations', {
            id: locationId,
            tenant_id: this.tenantId,
            name: contactLocationName,
            owner_party_id: partyId,
            created_at: stamp,
            updated_at: stamp,
        });
        await this.db.insert('party_locations', {
            id: Bun.randomUUIDv7(),
            tenant_id: this.tenantId,
            party_id: partyId,
            location_id: locationId,
            is_primary: false,
            created_at: stamp,
            updated_at: stamp,
        });
        return locationId;
    }

    // Membuat atau mengubah kontak (saveContact CoreERP). Kontak pertama satu jenis di satu tempat otomatis utama.
    async saveContact(
        partyId: string,
        data: Fields,
        contactId: string | null = null,
        version = 0,
    ) {
        const saved = await this.db.transaction(async () => {
            await lockParty(this.db, this.tenantId, partyId);
            const contact =
                contactId === null
                    ? null
                    : await this.contactRow(partyId, contactId);
            const locationId =
                data.address_id != null
                    ? (await this.addressLink(partyId, data.address_id))
                          .location_id
                    : contact !== null && !('address_id' in data)
                      ? contact.location_id
                      : await this.defaultContactLocation(partyId);
            const locked = await this.db.rows(
                z.object({
                    id: z.string(),
                    owner_party_id: z.string().nullable(),
                }),
                'select id, owner_party_id from locations where tenant_id = $1 and id in ($2, $3) order by id for update',
                [this.tenantId, locationId, contact?.location_id ?? locationId],
            );
            for (const location of locked)
                this.ensureOwner(partyId, location.owner_party_id);
            if (contact)
                await this.claim('electronic_addresses', contact.id, version);
            const type = String(data.type);
            const siblings = await this.db.one(
                z.object({ found: z.boolean() }),
                `select true as found from electronic_addresses
                 where tenant_id = $1 and location_id = $2 and type = $3 and deleted_at is null
                   ${contact ? 'and id <> $4' : ''} limit 1`,
                contact
                    ? [this.tenantId, locationId, type, contact.id]
                    : [this.tenantId, locationId, type],
            );
            const keepsPrimary =
                contact !== null &&
                contact.is_primary &&
                contact.type === type &&
                contact.location_id === locationId &&
                !('is_primary' in data);
            const primary =
                !siblings || flag(data.is_primary) === true || keepsPrimary;
            const stamp = nowSql();
            if (primary)
                await this.db.execute(
                    `update electronic_addresses set is_primary = false, updated_at = $1
                     where tenant_id = $2 and location_id = $3 and type = $4 and deleted_at is null and is_primary
                     ${contact ? 'and id <> $5' : ''}`,
                    contact
                        ? [stamp, this.tenantId, locationId, type, contact.id]
                        : [stamp, this.tenantId, locationId, type],
                );
            const fields = {
                location_id: locationId,
                type,
                value: String(data.value).trim(),
                purpose: clean(data.purpose),
                is_primary: primary,
            };
            const id = contact?.id ?? Bun.randomUUIDv7();
            if (contact)
                await this.db.execute(
                    'update electronic_addresses set location_id = $1, type = $2, value = $3, purpose = $4, is_primary = $5, updated_at = $6 where id = $7',
                    [...Object.values(fields), stamp, id],
                );
            else
                await this.db.insert('electronic_addresses', {
                    id,
                    tenant_id: this.tenantId,
                    ...fields,
                    created_at: stamp,
                    updated_at: stamp,
                });
            if (
                contact?.is_primary &&
                (contact.location_id !== locationId || contact.type !== type)
            )
                await this.promoteOldest(
                    contact.location_id,
                    contact.type,
                    stamp,
                );
            await refreshSearchStrings(this.db, this.tenantId, partyId);
            return id;
        });
        const [row] = await this.db.rows(
            contactSchema,
            `${this.contactSql('and e.id = $3')}`,
            [this.tenantId, partyId, saved],
        );
        return row!;
    }

    private async promoteOldest(
        locationId: string,
        type: string,
        stamp: string,
    ) {
        await this.db.execute(
            `update electronic_addresses set is_primary = true, updated_at = $1 where id = (
                 select id from electronic_addresses
                 where tenant_id = $2 and location_id = $3 and type = $4 and deleted_at is null
                 order by created_at, id limit 1)`,
            [stamp, this.tenantId, locationId, type],
        );
    }

    async deleteContact(partyId: string, contactId: string, version: number) {
        await this.db.transaction(async () => {
            await lockParty(this.db, this.tenantId, partyId);
            const contact = await this.contactRow(partyId, contactId);
            const location = await this.db.one(
                z.object({ owner_party_id: z.string().nullable() }),
                'select owner_party_id from locations where tenant_id = $1 and id = $2 for update',
                [this.tenantId, contact.location_id],
            );
            this.ensureOwner(partyId, location?.owner_party_id ?? null);
            await this.claim('electronic_addresses', contact.id, version);
            const stamp = nowSql();
            await this.db.execute(
                'update electronic_addresses set is_primary = false, deleted_at = $1, updated_at = $1 where id = $2',
                [stamp, contact.id],
            );
            if (contact.is_primary)
                await this.promoteOldest(
                    contact.location_id,
                    contact.type,
                    stamp,
                );
            await refreshSearchStrings(this.db, this.tenantId, partyId);
        });
    }

    // SavePartyDetails CoreERP: alamat dan kontak yang ikut dikirim bersama party atau organisasi baru, disimpan dalam
    // transaksi pemanggil. Kesalahan satu baris dilaporkan dengan awalan barisnya.
    async saveDetails(partyId: string, details: PartyDetails): Promise<void> {
        if (!details.locations.length && !details.contacts.length) return;
        this.workspace.guard('organization', 'update');
        const links = new Map<string, string>();
        for (const [index, location] of details.locations.entries()) {
            const { key, ...data } = location;
            const saved = await this.prefixed(
                `party_details.locations.${index}`,
                () => this.saveLocation(partyId, data),
            );
            if (typeof key === 'string') links.set(key, saved.id);
        }
        for (const [index, contact] of details.contacts.entries()) {
            const { address_key, ...data } = contact;
            if (typeof address_key === 'string')
                data.address_id = links.get(address_key);
            await this.prefixed(`party_details.contacts.${index}`, () =>
                this.saveContact(partyId, data),
            );
        }
    }

    private async prefixed<T>(
        prefix: string,
        action: () => Promise<T>,
    ): Promise<T> {
        try {
            return await action();
        } catch (error) {
            const errors =
                error instanceof HttpFailure && error.status === 422
                    ? (error.body as { errors?: Record<string, string[]> })
                          .errors
                    : undefined;
            if (errors)
                validation(
                    Object.fromEntries(
                        Object.entries(errors).map(([field, messages]) => [
                            `${prefix}.${field}`,
                            messages,
                        ]),
                    ),
                );
            throw error;
        }
    }
}
