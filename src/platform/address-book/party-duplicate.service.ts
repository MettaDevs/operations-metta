import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { nowSql, type Bind, type Database } from '../database/index.ts';
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
import { Problems, checkDate, checkText } from './party-address.schema.ts';

export const defaultSearchHitPercent = 60;

const setupSchema = z.object({
    field_code: z.enum(['name', 'birth_date', 'phone']),
    part: z.enum(['first', 'last']),
    length: z.number(),
});
type Setup = z.infer<typeof setupSchema>;
type Identity = {
    name: string | null;
    birth_date: string | null;
    phone: string | null;
};

// Karakter yang dibuang DuplicateManagement.ComposeSearchString BC sebelum bagian depan atau belakang diambil.
const ignored = /[ +"&/,.;:\-_(){}#!£$\\]/gu;

// Nomor telepon Indonesia ditulis dengan awalan 62 atau 0; keduanya disamakan supaya bagian depannya bisa cocok.
function phoneDigits(value: string): string {
    const digits = value.replace(/\D/gu, '');
    return digits.startsWith('62') ? `0${digits.slice(2)}` : digits;
}

// ComposeSearchString BC: buang tanda baca dan spasi, ambil N karakter depan atau belakang, huruf besar, paling
// panjang 10.
export function searchString(
    value: string | null,
    part: 'first' | 'last',
    length: number,
): string | null {
    if (value === null) return null;
    // Dipotong per code point, supaya huruf di luar BMP tidak terbelah.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    const cleaned = [...value.replace(ignored, '')];
    const take = Math.min(length, cleaned.length);
    if (take <= 0) return null;
    const piece =
        part === 'first' ? cleaned.slice(0, take) : cleaned.slice(-take);
    return piece.join('').toUpperCase().slice(0, 10);
}

function strings(setups: Setup[], identity: Identity) {
    return setups.map((setup) => {
        const raw = identity[setup.field_code];
        const value =
            raw === null
                ? null
                : setup.field_code === 'phone'
                  ? phoneDigits(raw)
                  : raw;
        return {
            field_code: setup.field_code,
            part: setup.part,
            search_string: searchString(value, setup.part, setup.length),
        };
    });
}

async function setups(db: Database): Promise<Setup[]> {
    return db.rows(
        setupSchema,
        'select field_code, part, length from party_duplicate_search_setups order by field_code, part',
    );
}

// Menulis ulang search string satu party (MakeContIndex BC). Hanya orang yang diperiksa: BC hanya memeriksa
// Company, keputusan pemilik produk memeriksa Person. Party organisasi tetap punya barisnya, tanpa search string.
export async function refreshSearchStrings(
    db: Database,
    tenantId: string,
    partyId: string,
): Promise<void> {
    const party = await db.one(
        z.object({
            type: z.string(),
            name: z.string(),
            birth_date: z.string().nullable(),
            phone: z.string().nullable(),
        }),
        `select p.type, p.name, p.birth_date::text as birth_date,
                (select e.value from electronic_addresses e
                 join party_locations l on l.location_id = e.location_id and l.party_id = p.id and l.deleted_at is null
                 where e.tenant_id = p.tenant_id and e.type = 'phone' and e.deleted_at is null
                 order by e.is_primary desc, e.created_at, e.id limit 1) as phone
         from parties p where p.tenant_id = $1 and p.id = $2`,
        [tenantId, partyId],
    );
    if (!party) return;
    const person = party.type === 'person';
    for (const row of strings(await setups(db), {
        name: person ? party.name : null,
        birth_date: person ? party.birth_date : null,
        phone: person ? party.phone : null,
    }))
        await db.execute(
            `insert into party_duplicate_search_strings (tenant_id, party_id, field_code, part, search_string)
             values ($1, $2, $3, $4, $5)
             on conflict (party_id, field_code, part) do update set search_string = excluded.search_string`,
            [tenantId, partyId, row.field_code, row.part, row.search_string],
        );
}

const candidateSchema = z.object({
    id: z.string(),
    name: z.string(),
    birth_date: z.string().nullable(),
    matches: z.number(),
});

// Kandidat data ganda: orang lain di tenant ini yang search string-nya cocok paling sedikit Search Hit % dari jumlah
// baris setup (InsDuplCont BC, dibulatkan ke atas). Pasangan yang ditandai bukan ganda dan party yang tidak terlihat
// tidak ikut. Kandidat hanya ditawarkan, tidak menghalangi penyimpanan.
export class PartyDuplicates {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async searchHitPercent(): Promise<{
        percent: number;
        version: number | null;
    }> {
        const row = await this.db.one(
            z.object({ search_hit_percent: z.number(), version: z.number() }),
            'select search_hit_percent, version from party_duplicate_settings where tenant_id = $1',
            [this.workspace.tenantId],
        );
        return row
            ? { percent: row.search_hit_percent, version: row.version }
            : { percent: defaultSearchHitPercent, version: null };
    }

    async settings() {
        this.workspace.guard('organization', 'read');
        const { percent, version } = await this.searchHitPercent();
        return { data: { search_hit_percent: percent, version } };
    }

    // Setelan pertama dibuat tanpa versi; sesudahnya perubahan wajib membawa versi yang dibuka pengguna.
    async updateSettings(request: Request, body: unknown) {
        this.workspace.guard('organization', 'update');
        const input = laravelBody.parse(body);
        const percent = Number(input.search_hit_percent);
        if (
            input.search_hit_percent == null ||
            !Number.isInteger(percent) ||
            percent < 1 ||
            percent > 100
        )
            validation({
                search_hit_percent: 'Isi bilangan bulat 1 sampai 100.',
            });
        const current = await this.searchHitPercent();
        const stamp = nowSql();
        if (current.version === null) {
            await this.db.execute(
                `insert into party_duplicate_settings (tenant_id, search_hit_percent, created_at, updated_at)
                 values ($1, $2, $3, $3) on conflict (tenant_id) do nothing`,
                [this.workspace.tenantId, percent, stamp],
            );
        } else {
            const version = expectedVersion(request, body);
            const changed = await this.db.execute(
                'update party_duplicate_settings set search_hit_percent = $1, updated_at = $2 where tenant_id = $3 and version = $4',
                [percent, stamp, this.workspace.tenantId, version],
            );
            if (!changed) coded(409, 'stale_version', staleMessage);
        }
        return this.settings();
    }

    async candidates(
        identity: Identity,
        exceptPartyId: string | null,
    ): Promise<z.infer<typeof candidateSchema>[]> {
        const lines = await setups(this.db);
        const wanted = strings(lines, identity).filter(
            (row) => row.search_string !== null,
        );
        if (!wanted.length) return [];
        const { percent } = await this.searchHitPercent();
        const threshold = Math.ceil((lines.length * percent) / 100);
        const access = await PartyAccess.open(this.db, this.workspace);
        const bindings: Bind[] = [this.workspace.tenantId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const input = wanted
            .map(
                (row) =>
                    `(${bind(row.field_code)}::text, ${bind(row.part)}::text, ${bind(row.search_string)}::text)`,
            )
            .join(', ');
        const except = exceptPartyId ? bind(exceptPartyId) : null;
        return this.db.rows(
            candidateSchema,
            `with wanted(field_code, part, search_string) as (values ${input})
             select p.id, p.name, p.birth_date::text as birth_date, count(*)::int as matches
             from wanted w
             join party_duplicate_search_strings s
               on s.tenant_id = $1 and s.field_code = w.field_code and s.part = w.part
              and s.search_string = w.search_string
             join parties p on p.tenant_id = s.tenant_id and p.id = s.party_id
             where p.deleted_at is null and p.type = 'person' and ${access.clause('p', bind)}
               ${
                   except
                       ? `and p.id <> ${except} and not exists (
                     select 1 from party_separations x
                     where x.tenant_id = $1 and x.deleted_at is null
                       and x.party_id = least(p.id, ${except}::uuid) and x.other_party_id = greatest(p.id, ${except}::uuid))`
                       : ''
               }
             group by p.id, p.name, p.birth_date
             having count(*) >= ${bind(threshold)}
             order by matches desc, p.name, p.id
             limit 20`,
            bindings,
        );
    }

    // Pemeriksaan sebelum party baru disimpan, dari isian form: nama, tanggal lahir, dan telepon.
    async check(body: unknown) {
        this.workspace.guard('organization', 'read');
        const input = laravelBody.parse(body);
        const problems = new Problems();
        checkText(problems, input, 'name', 200);
        checkDate(problems, input, 'birth_date');
        checkText(problems, input, 'phone', 250);
        problems.fail();
        const text = (value: unknown) =>
            typeof value === 'string' ? value : null;
        return {
            data: await this.candidates(
                {
                    name: text(input.name),
                    birth_date: text(input.birth_date),
                    phone: text(input.phone),
                },
                null,
            ),
        };
    }

    // Kandidat untuk party yang sudah tersimpan, dari search string-nya sendiri.
    async forParty(partyId: string) {
        this.workspace.guard('organization', 'read');
        const identity = await this.db.one(
            z.object({
                name: z.string().nullable(),
                birth_date: z.string().nullable(),
                phone: z.string().nullable(),
            }),
            `select p.name, p.birth_date::text as birth_date,
                    (select e.value from electronic_addresses e
                     join party_locations l on l.location_id = e.location_id and l.party_id = p.id and l.deleted_at is null
                     where e.tenant_id = p.tenant_id and e.type = 'phone' and e.deleted_at is null
                     order by e.is_primary desc, e.created_at, e.id limit 1) as phone
             from parties p where p.tenant_id = $1 and p.id = $2 and p.deleted_at is null and p.type = 'person'`,
            [this.workspace.tenantId, partyId],
        );
        return {
            data: identity ? await this.candidates(identity, partyId) : [],
        };
    }

    // Separate Contacts BC: pasangan ini bukan orang yang sama, jadi tidak ditawarkan lagi sebagai kandidat.
    async separate(partyId: string, body: unknown) {
        this.workspace.guard('organization', 'update');
        const input = laravelBody.parse(body);
        const other =
            typeof input.party_id === 'string'
                ? lookupId(input.party_id)
                : null;
        if (!other || other === partyId)
            validation({ party_id: 'Pilih pihak lain dari daftar kandidat.' });
        const [low, high] = [partyId, other].sort() as [string, string];
        const found = await this.db.rows(
            z.object({ id: z.string() }),
            'select id from parties where tenant_id = $1 and id in ($2, $3) and deleted_at is null',
            [this.workspace.tenantId, low, high],
        );
        if (found.length !== 2) abort(404, 'Not Found');
        const stamp = nowSql();
        await this.db.execute(
            `insert into party_separations (id, tenant_id, party_id, other_party_id, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $5)
             on conflict (tenant_id, party_id, other_party_id) where deleted_at is null do nothing`,
            [Bun.randomUUIDv7(), this.workspace.tenantId, low, high, stamp],
        );
        return { status: 204, headers: {}, body: undefined };
    }

    async unseparate(partyId: string, otherPartyId: string) {
        this.workspace.guard('organization', 'update');
        const other = lookupId(otherPartyId);
        if (!other) abort(404, 'Not Found');
        const [low, high] = [partyId, other].sort() as [string, string];
        const removed = await this.db.execute(
            'update party_separations set deleted_at = $1, updated_at = $1 where tenant_id = $2 and party_id = $3 and other_party_id = $4 and deleted_at is null',
            [nowSql(), this.workspace.tenantId, low, high],
        );
        if (!removed) abort(404, 'Not Found');
        return { status: 204, headers: {}, body: undefined };
    }
}
