import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from '../../support/tenant-fixtures.ts';

type Policy = {
    id: string;
    name: string;
    data_type: { code: string; name: string };
    is_active: boolean;
    effective_from: string;
    legal_entities: { id: string; name: string }[];
    version: number;
};

// Sys Admin → Data sharing: kebijakan umum Core, pola cross-company data sharing F&O. Jenis data didaftarkan pemiliknya
// di data_sharing_types; di sini dua jenis data uji milik Core, supaya aturannya diuji tanpa module.
describe.skipIf(!process.env.DB_HOST)('data sharing policies', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    const path = '/api/v1/data-sharing-policies';
    let tenantId: string;
    let admin: Browser;
    let viewer: Browser;
    let outsider: Browser;
    let first: string;
    let second: string;
    let third: string;
    afterAll(close);

    async function legalEntity(name: string, code: string) {
        const response = await admin.post('/api/v1/organizations', {
            classification: 'legal_entity',
            name,
            company_code: code,
            country_code: 'ID',
        });
        expect(response.status).toBe(201);
        return ((await response.json()) as { data: { id: string } }).data.id;
    }

    async function login(duties: string[]) {
        const member = await createMember(pool, tenantId, duties);
        const session = browser();
        await session.login(member.email, member.password);
        return session;
    }

    beforeAll(async () => {
        await pool.unsafe(
            `insert into data_sharing_types (code, app_id, name, created_at, updated_at)
             values ('test.alpha', 'core', 'Data uji A', now(), now()), ('test.beta', 'core', 'Data uji B', now(), now())
             on conflict (code) do nothing`,
        );
        tenantId = await createTenant(pool, 'Klinik Uji Data Sharing');
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'core.data-sharing.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, owner.membershipId);
        admin = browser();
        await admin.login(owner.email, owner.password);
        first = await legalEntity('PT Satu Sharing', 'SATU');
        second = await legalEntity('PT Dua Sharing', 'DUA');
        third = await legalEntity('PT Tiga Sharing', 'TIGA');
        viewer = await login(['core.data-sharing.inquire']);
        outsider = await login(['core.organization.inquire']);
    });

    test('the data to share comes from installed owners only, and a module that is not installed offers nothing', async () => {
        const types = (
            (await (await admin.get(`${path}/data-types`)).json()) as {
                data: { code: string }[];
            }
        ).data.map((type) => type.code);
        expect(types).toContain('test.alpha');
        expect(types).toContain('test.beta');
        // Master pasien milik module healthcare, yang tidak terpasang untuk tenant ini.
        expect(types).not.toContain('healthcare.patient');
        const refused = await admin.post(path, {
            name: 'Pasien tanpa module',
            data_type_code: 'healthcare.patient',
            effective_from: '2026-01-01',
            legal_entity_ids: [first, second],
        });
        expect(refused.status).toBe(422);
        expect(
            ((await refused.json()) as { errors: Record<string, string[]> })
                .errors.data_type_code,
        ).toEqual(['Pilih data yang di-share dari daftar.']);
    });

    test('a company joins one active policy per kind of data, and a policy needs at least two companies', async () => {
        const one = await admin.post(path, {
            name: 'Satu saja',
            data_type_code: 'test.alpha',
            effective_from: '2026-01-01',
            legal_entity_ids: [first],
        });
        expect(one.status).toBe(422);
        const alpha = await admin.post(path, {
            name: 'Grup A',
            data_type_code: 'test.alpha',
            effective_from: '2026-01-01',
            legal_entity_ids: [first, second],
        });
        expect(alpha.status).toBe(201);
        const created = ((await alpha.json()) as { data: Policy }).data;
        expect(created.data_type).toEqual({
            code: 'test.alpha',
            name: 'Data uji A',
        });
        expect(
            created.legal_entities.map((entity) => entity.id).sort(),
        ).toEqual([first, second].sort());
        // Perusahaan yang sama untuk jenis data yang sama ditolak selama kebijakan pertama aktif.
        const clash = await admin.post(path, {
            name: 'Grup A lain',
            data_type_code: 'test.alpha',
            effective_from: '2026-01-01',
            legal_entity_ids: [second, third],
        });
        expect(clash.status).toBe(422);
        expect(
            ((await clash.json()) as { errors: Record<string, string[]> })
                .errors.legal_entity_ids?.[0],
        ).toContain('PT Dua Sharing sudah ikut kebijakan aktif "Grup A"');
        // Jenis data lain bebas memakai perusahaan yang sama.
        expect(
            (
                await admin.post(path, {
                    name: 'Grup B',
                    data_type_code: 'test.beta',
                    effective_from: '2026-01-01',
                    legal_entity_ids: [first, second, third],
                })
            ).status,
        ).toBe(201);
        // Kebijakan nonaktif tidak menghalangi.
        const inactive = await admin.post(path, {
            name: 'Grup A cadangan',
            data_type_code: 'test.alpha',
            is_active: false,
            effective_from: '2026-01-01',
            legal_entity_ids: [second, third],
        });
        expect(inactive.status).toBe(201);
        // Pilihan perusahaan memberi tahu kebijakan aktif yang sudah diikuti, per jenis data.
        const entities = (
            (await (
                await admin.get(`${path}/legal-entities?data_type=test.alpha`)
            ).json()) as {
                data: { id: string; policy_name: string | null }[];
            }
        ).data;
        expect(
            entities.find((entity) => entity.id === second)?.policy_name,
        ).toBe('Grup A');
        expect(
            entities.find((entity) => entity.id === third)?.policy_name,
        ).toBeNull();
        // Perubahan tercatat di change log.
        const [log] = await pool.unsafe<{ changes: number }[]>(
            "select count(*)::int as changes from change_log_entries where table_name = 'data_sharing_policies' and record_id = $1",
            [created.id],
        );
        expect(Number(log?.changes)).toBeGreaterThanOrEqual(1);
        const list = (
            (await (
                await admin.get(`${path}?data_type=test.alpha`)
            ).json()) as {
                data: Policy[];
            }
        ).data.map((policy) => policy.name);
        expect(list).toEqual(['Grup A', 'Grup A cadangan']);
    });

    test('the screen is guarded by Core permissions of its own', async () => {
        expect((await outsider.get(path)).status).toBe(403);
        expect((await outsider.get(`${path}/data-types`)).status).toBe(403);
        const read = await viewer.get(path);
        expect(read.status).toBe(200);
        expect(
            ((await read.json()) as { can_manage: boolean }).can_manage,
        ).toBe(false);
        expect(
            (
                await viewer.post(path, {
                    name: 'Tidak boleh',
                    data_type_code: 'test.beta',
                    effective_from: '2026-01-01',
                    legal_entity_ids: [first, second],
                })
            ).status,
        ).toBe(403);
        expect(
            ((await (await admin.get(path)).json()) as { can_manage: boolean })
                .can_manage,
        ).toBe(true);
    });
});
