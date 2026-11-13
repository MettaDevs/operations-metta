import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type Section = {
    id: string;
    operating_unit_id: string;
    operating_unit_name: string;
    name: string;
    kind: string;
    code: string;
    document_code: string | null;
    bpjs_clinic_code: string | null;
    queue_mode: string;
    queue_prefix: string | null;
    rooms: Room[];
    is_active: boolean;
    version: number;
};
type Room = {
    id: string;
    code: string;
    name: string;
    is_active: boolean;
};
type Metadata = {
    operating_units: { id: string; name: string }[];
    permissions: { create: boolean; update: boolean; delete: boolean };
};

const api = '/api/modules/healthcare/v1/sections';

// Master section: section per operating unit, nama unik per unit dan kode unik per tenant selama belum dihapus, Delete
// mengisi deleted_at,
// tenant terpisah, dan setiap aksi dijaga permission-nya sendiri. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila
// DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('section master', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let company: string;
    let induk: string;
    let barat: string;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function organization(as: Browser, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string } }>(
                await as.post('/api/v1/organizations', body),
                201,
            )
        ).data.id;
    }

    async function member(tenant: string, duties: string[]) {
        const created = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, created.membershipId);
        const session = browser();
        await session.login(created.email, created.password);
        return session;
    }

    async function created(body: Record<string, unknown>) {
        return (await json<{ data: Section }>(await admin.post(api, body), 201))
            .data;
    }

    async function names(query: string) {
        return (
            await json<{ data: Section[] }>(
                await admin.get(`${api}?per_page=100&${query}`),
                200,
            )
        ).data.map((section) => section.name);
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Section');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, [
            'core.organization.manage',
            'healthcare.service-setup.manage',
        ]);
        company = await organization(admin, {
            classification: 'legal_entity',
            name: 'PT Klinik Uji Section',
            company_code: `KS${Date.now() % 100000}`,
            country_code: 'ID',
        });
        induk = await organization(admin, {
            classification: 'operating_unit',
            name: 'Puskesmas Induk',
            operating_unit_type: 'department',
            operating_unit_number: 'SEC-1',
        });
        barat = await organization(admin, {
            classification: 'operating_unit',
            name: 'Puskesmas Barat',
            operating_unit_type: 'department',
            operating_unit_number: 'SEC-2',
        });
    }, 60_000);

    test('a section is created, changed, and refuses a stale version', async () => {
        const metadata = await json<Metadata>(
            await admin.get(`${api}/metadata`),
            200,
        );
        expect(metadata.operating_units.map((unit) => unit.id).sort()).toEqual(
            [induk, barat].sort(),
        );
        expect(metadata.permissions).toEqual({
            create: true,
            update: true,
            delete: true,
        });
        const section = await created({
            operating_unit_id: induk,
            code: ' UMUM ',
            name: ' Poli Umum ',
            kind: 'rawat_jalan',
            document_code: 'PU',
        });
        expect(section).toEqual(
            expect.objectContaining({
                operating_unit_id: induk,
                operating_unit_name: 'Puskesmas Induk',
                code: 'UMUM',
                name: 'Poli Umum',
                kind: 'rawat_jalan',
                document_code: 'PU',
                bpjs_clinic_code: null,
                is_active: true,
            }),
        );
        const updated = await json<{ data: Section }>(
            await admin.patch(`${api}/${section.id}`, {
                operating_unit_id: induk,
                code: 'UMUM',
                name: 'Poli Umum',
                kind: 'rawat_jalan',
                document_code: 'PU',
                bpjs_clinic_code: '001',
                is_active: false,
                version: section.version,
            }),
            200,
        );
        expect(updated.data).toEqual(
            expect.objectContaining({
                bpjs_clinic_code: '001',
                is_active: false,
            }),
        );
        expect(updated.data.version).toBe(section.version + 1);
        const stale = await admin.patch(`${api}/${section.id}`, {
            operating_unit_id: induk,
            code: 'UMUM',
            name: 'Poli Umum',
            kind: 'rawat_jalan',
            version: section.version,
        });
        expect(stale.status).toBe(409);
        const [row] = await pool.unsafe<Record<string, unknown>[]>(
            'select tenant_id, kode, nama, jenis, kode_no_bukti, kode_poli_bpjs, aktif from sim_m_section where id = $1',
            [section.id],
        );
        expect(row).toEqual({
            tenant_id: tenantId,
            kode: 'UMUM',
            nama: 'Poli Umum',
            jenis: 'rawat_jalan',
            kode_no_bukti: 'PU',
            kode_poli_bpjs: '001',
            aktif: false,
        });
    }, 30_000);

    test('the form refuses a missing code and name, a kind outside the catalog, and a legal entity as unit', async () => {
        const response = await admin.post(api, {
            operating_unit_id: induk,
            name: '',
            kind: 'poli',
        });
        const body = await json<{ errors: Record<string, string[]> }>(
            response,
            422,
        );
        expect(Object.keys(body.errors).sort()).toEqual([
            'code',
            'kind',
            'name',
        ]);
        expect(body.errors.code).toEqual(['Isi kode section.']);
        const notUnit = await admin.post(api, {
            operating_unit_id: company,
            code: 'GIGI-LE',
            name: 'Poli Gigi',
            kind: 'rawat_jalan',
        });
        expect(
            Object.keys(
                (await json<{ errors: Record<string, string[]> }>(notUnit, 422))
                    .errors,
            ),
        ).toEqual(['operating_unit_id']);
    }, 30_000);

    test('a name is unique per operating unit until the section is deleted', async () => {
        const first = await created({
            operating_unit_id: induk,
            code: 'GIGI',
            name: 'Poli Gigi',
            kind: 'rawat_jalan',
        });
        const twin = await admin.post(api, {
            operating_unit_id: induk,
            code: 'GIGI-2',
            name: 'poli gigi',
            kind: 'rawat_jalan',
        });
        expect(
            (await json<{ errors: Record<string, string[]> }>(twin, 422)).errors
                .name,
        ).toBeDefined();
        await created({
            operating_unit_id: barat,
            code: 'GIGI-BARAT',
            name: 'Poli Gigi',
            kind: 'rawat_jalan',
        });
        expect(
            (
                await admin.delete(`${api}/${first.id}`, {
                    version: first.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from sim_m_section where id = $1',
            [first.id],
        );
        expect(row?.deleted).toBe(true);
        expect(await names(`operating_unit_id=${induk}`)).not.toContain(
            'Poli Gigi',
        );
        expect(
            (
                await admin.patch(`${api}/${first.id}`, {
                    operating_unit_id: induk,
                    code: 'GIGI',
                    name: 'Poli Gigi',
                    kind: 'rawat_jalan',
                    version: first.version,
                })
            ).status,
        ).toBe(404);
        await created({
            operating_unit_id: induk,
            code: 'GIGI',
            name: 'Poli Gigi',
            kind: 'rawat_jalan',
        });
    }, 30_000);

    test('a code is required, short, and unique per tenant regardless of case until the section is deleted', async () => {
        const long = await admin.post(api, {
            operating_unit_id: induk,
            code: 'K'.repeat(21),
            name: 'Poli KIA',
            kind: 'rawat_jalan',
        });
        expect(
            (await json<{ errors: Record<string, string[]> }>(long, 422))
                .errors,
        ).toEqual({ code: ['Paling panjang 20 karakter.'] });
        const first = await created({
            operating_unit_id: induk,
            code: 'KIA',
            name: 'Poli KIA',
            kind: 'rawat_jalan',
        });
        // Alamat pemeriksaan tidak membawa unit, jadi kode juga tidak boleh dipakai section unit lain.
        const twin = await admin.post(api, {
            operating_unit_id: barat,
            code: 'kia',
            name: 'Poli KIA',
            kind: 'rawat_jalan',
        });
        expect(
            (await json<{ errors: Record<string, string[]> }>(twin, 422))
                .errors,
        ).toEqual({ code: ['Kode ini sudah dipakai section lain.'] });
        const renamed = await admin.patch(`${api}/${first.id}`, {
            operating_unit_id: induk,
            code: 'Umum',
            name: 'Poli KIA',
            kind: 'rawat_jalan',
            version: first.version,
        });
        expect(
            (await json<{ errors: Record<string, string[]> }>(renamed, 422))
                .errors,
        ).toEqual({ code: ['Kode ini sudah dipakai section lain.'] });
        expect(await names('q=kia')).toEqual(['Poli KIA']);
        expect(
            (
                await admin.delete(`${api}/${first.id}`, {
                    version: first.version,
                })
            ).status,
        ).toBe(204);
        const again = await created({
            operating_unit_id: induk,
            code: 'kia',
            name: 'Poli KIA',
            kind: 'rawat_jalan',
        });
        expect(again.code).toBe('kia');
        const [codes] = await pool.unsafe<{ live: number; all: number }[]>(
            `select count(*) filter (where deleted_at is null)::int as live, count(*)::int as all
             from sim_m_section where tenant_id = $1 and lower(kode) = 'kia'`,
            [tenantId],
        );
        expect(codes).toEqual({ live: 1, all: 2 });
    }, 30_000);

    test('a new section shares one queue across its rooms unless told otherwise', async () => {
        const section = await created({
            operating_unit_id: induk,
            code: 'LAB',
            name: 'Laboratorium',
            kind: 'penunjang',
        });
        expect(section.queue_mode).toBe('bersama');
        expect(section.queue_prefix).toBeNull();
        expect(section.rooms).toEqual([]);
        const scheduled = await json<{ data: Section }>(
            await admin.patch(`${api}/${section.id}`, {
                operating_unit_id: induk,
                code: 'LAB',
                name: 'Laboratorium',
                kind: 'penunjang',
                queue_mode: 'per_jadwal',
                queue_prefix: 'L',
                version: section.version,
            }),
            200,
        );
        expect(scheduled.data.queue_mode).toBe('per_jadwal');
        expect(scheduled.data.queue_prefix).toBe('L');
        const refused = await admin.patch(`${api}/${section.id}`, {
            operating_unit_id: induk,
            code: 'LAB',
            name: 'Laboratorium',
            kind: 'penunjang',
            queue_mode: 'acak',
            version: scheduled.data.version,
        });
        expect(
            Object.keys(
                (await json<{ errors: Record<string, string[]> }>(refused, 422))
                    .errors,
            ),
        ).toEqual(['queue_mode']);
    }, 30_000);

    async function room(unit: string, code: string) {
        return (
            await json<{ data: { id: string; version: number } }>(
                await admin.post('/api/modules/healthcare/v1/rooms', {
                    operating_unit_id: unit,
                    code,
                    name: `Ruang ${code}`,
                }),
                201,
            )
        ).data;
    }

    test('one room serves several sections of its unit, and leaves them when it is deleted', async () => {
        const r1 = await room(induk, 'L1R1');
        const r2 = await room(induk, 'L1R2');
        const morning = await created({
            operating_unit_id: induk,
            code: 'PAGI',
            name: 'Poli Umum Pagi',
            kind: 'rawat_jalan',
            room_ids: [r1.id, r2.id],
        });
        const evening = await created({
            operating_unit_id: induk,
            code: 'SORE',
            name: 'Poli Umum Sore',
            kind: 'rawat_jalan',
            room_ids: [r1.id],
        });
        expect(morning.rooms.map((item) => item.code)).toEqual([
            'L1R1',
            'L1R2',
        ]);
        expect(evening.rooms.map((item) => item.code)).toEqual(['L1R1']);
        const metadata = await json<{
            rooms: { id: string; operating_unit_id: string }[];
        }>(await admin.get(`${api}/metadata`), 200);
        expect(metadata.rooms.map((item) => item.id)).toEqual(
            expect.arrayContaining([r1.id, r2.id]),
        );
        // Melepas satu ruangan dari section pagi tidak mengubah section sore.
        const released = await json<{ data: Section }>(
            await admin.patch(`${api}/${morning.id}`, {
                operating_unit_id: induk,
                code: 'PAGI',
                name: 'Poli Umum Pagi',
                kind: 'rawat_jalan',
                room_ids: [r2.id],
                version: morning.version,
            }),
            200,
        );
        expect(released.data.rooms.map((item) => item.code)).toEqual(['L1R2']);
        // Mengubah section tanpa room_ids tidak menyentuh ruangannya.
        const untouched = await json<{ data: Section }>(
            await admin.patch(`${api}/${morning.id}`, {
                operating_unit_id: induk,
                code: 'PAGI',
                name: 'Poli Umum Pagi',
                kind: 'rawat_jalan',
                version: released.data.version,
            }),
            200,
        );
        expect(untouched.data.rooms).toEqual(released.data.rooms);
        // Ruangan yang dihapus hilang dari section yang memakainya; sectionnya tetap ada.
        expect(
            (
                await admin.delete(
                    `/api/modules/healthcare/v1/rooms/${r1.id}`,
                    {
                        version: r1.version,
                    },
                )
            ).status,
        ).toBe(204);
        const [after] = (
            await json<{ data: Section[] }>(
                await admin.get(`${api}?q=Poli%20Umum%20Sore`),
                200,
            )
        ).data;
        expect(after?.rooms).toEqual([]);
        const [links] = await pool.unsafe<{ live: number; archived: number }[]>(
            `select count(*) filter (where deleted_at is null)::int as live,
                    count(*) filter (where deleted_at is not null)::int as archived
             from sim_m_section_ruangan where ruangan_id = $1`,
            [r1.id],
        );
        expect(links).toEqual({ live: 0, archived: 2 });
    }, 30_000);

    test('a section only takes rooms of its own operating unit', async () => {
        const west = await room(barat, 'B1');
        const own = await room(induk, 'I9');
        const refused = await admin.post(api, {
            operating_unit_id: induk,
            code: 'MATA',
            name: 'Poli Mata',
            kind: 'rawat_jalan',
            room_ids: [own.id, west.id],
        });
        expect(
            Object.keys(
                (await json<{ errors: Record<string, string[]> }>(refused, 422))
                    .errors,
            ),
        ).toEqual(['room_ids']);
        const section = await created({
            operating_unit_id: induk,
            code: 'MATA',
            name: 'Poli Mata',
            kind: 'rawat_jalan',
            room_ids: [own.id],
        });
        // Pindah unit dengan ruangan unit lama ditolak, juga tanpa mengirim room_ids.
        const moved = await admin.patch(`${api}/${section.id}`, {
            operating_unit_id: barat,
            code: 'MATA',
            name: 'Poli Mata',
            kind: 'rawat_jalan',
            version: section.version,
        });
        expect(moved.status).toBe(422);
        const movedWithRooms = await json<{ data: Section }>(
            await admin.patch(`${api}/${section.id}`, {
                operating_unit_id: barat,
                code: 'MATA',
                name: 'Poli Mata',
                kind: 'rawat_jalan',
                room_ids: [west.id],
                version: section.version,
            }),
            200,
        );
        expect(movedWithRooms.data.rooms.map((item) => item.id)).toEqual([
            west.id,
        ]);
    }, 30_000);

    test('the list filters by unit, kind, and status, and searches by name', async () => {
        await created({
            operating_unit_id: barat,
            code: 'IGD',
            name: 'IGD Barat',
            kind: 'gawat_darurat',
        });
        await created({
            operating_unit_id: barat,
            code: 'FAR-1',
            name: 'Apotek Barat',
            kind: 'farmasi',
            is_active: false,
        });
        expect(await names(`operating_unit_id=${barat}`)).toEqual([
            'Apotek Barat',
            'IGD Barat',
            'Poli Gigi',
            'Poli Mata',
        ]);
        expect(await names('kind=gawat_darurat')).toEqual(['IGD Barat']);
        expect(
            await names(`operating_unit_id=${barat}&status=inactive`),
        ).toEqual(['Apotek Barat']);
        expect(await names(`operating_unit_id=${barat}&status=active`)).toEqual(
            ['IGD Barat', 'Poli Gigi', 'Poli Mata'],
        );
        expect(await names('q=apotek')).toEqual(['Apotek Barat']);
        expect(await names('q=far-1')).toEqual(['Apotek Barat']);
    }, 30_000);

    test('another tenant cannot see or change these sections', async () => {
        const [section] = (
            await json<{ data: Section[] }>(
                await admin.get(`${api}?per_page=1`),
                200,
            )
        ).data;
        const otherTenant = await createTenant(pool, 'Klinik Uji Section Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const outsider = await member(otherTenant, [
            'healthcare.service-setup.manage',
        ]);
        expect(
            (await json<{ data: Section[] }>(await outsider.get(api), 200))
                .data,
        ).toEqual([]);
        expect(
            (await json<Metadata>(await outsider.get(`${api}/metadata`), 200))
                .operating_units,
        ).toEqual([]);
        expect(
            (
                await outsider.patch(`${api}/${section?.id}`, {
                    operating_unit_id: induk,
                    code: 'DIAMBIL',
                    name: 'Diambil',
                    kind: 'kasir',
                    version: section?.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await outsider.post(api, {
                    operating_unit_id: induk,
                    code: 'ASING',
                    name: 'Poli Asing',
                    kind: 'rawat_jalan',
                })
            ).status,
        ).toBe(422);
    }, 30_000);

    test('permissions decide who reads, creates, changes, and deletes sections', async () => {
        const reader = await member(tenantId, [
            'healthcare.service-setup.inquire',
        ]);
        const sections = await json<{ data: Section[] }>(
            await reader.get(`${api}?per_page=1`),
            200,
        );
        const section = sections.data[0];
        if (!section) throw new Error('Belum ada section.');
        expect(
            (await json<Metadata>(await reader.get(`${api}/metadata`), 200))
                .permissions,
        ).toEqual({ create: false, update: false, delete: false });
        expect(
            (
                await reader.post(api, {
                    operating_unit_id: induk,
                    code: 'ANAK',
                    name: 'Poli Anak',
                    kind: 'rawat_jalan',
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await reader.patch(`${api}/${section.id}`, {
                    operating_unit_id: section.operating_unit_id,
                    code: section.code,
                    name: section.name,
                    kind: section.kind,
                    version: section.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await reader.delete(`${api}/${section.id}`, {
                    version: section.version,
                })
            ).status,
        ).toBe(403);
        const stranger = await member(tenantId, ['core.organization.inquire']);
        expect((await stranger.get(api)).status).toBe(403);
        expect((await stranger.get(`${api}/metadata`)).status).toBe(403);
    }, 30_000);
});
