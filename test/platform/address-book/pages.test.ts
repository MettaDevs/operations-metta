import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { pageFiles, readPage } from '../../../scripts/generate-client.ts';
import { sysAdminArea } from '../../../src/platform/access/navigation.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

const src = join(import.meta.dir, '..', '..', '..', 'src', 'platform');

test('the address book screens are app pages at their menu addresses, guarded by the route permissions', () => {
    const pages = [
        join(src, 'address-book', 'global-address-book.page.tsx'),
        join(src, 'address-book', 'occupations.page.tsx'),
        join(src, 'address-book', 'duplicate-settings.page.tsx'),
        join(src, 'geography', 'address-setup.page.tsx'),
    ].map((file) => readPage(file));
    expect(pages.map(({ path, layout }) => ({ path, layout }))).toEqual([
        { path: '/sysadmin/address-book/parties', layout: 'app' },
        { path: '/sysadmin/address-book/occupations', layout: 'app' },
        { path: '/sysadmin/address-book/duplicate-check', layout: 'app' },
        { path: '/sysadmin/geography/address-setup', layout: 'app' },
    ]);
    // Route tree dirakit dari setiap `.page.tsx`, jadi keempat halaman ada di dalamnya.
    const tree = new Set(pageFiles().map((file) => readPage(file).path));
    for (const page of pages) expect(tree.has(page.path)).toBe(true);
    const menu = (group: string) =>
        sysAdminArea.groups
            .find((entry) => entry.id === group)
            ?.items.map((item) => [item.href, item.permission]);
    expect(menu('address-book')).toEqual([
        ['/sysadmin/address-book/parties', 'core.organization.read'],
        ['/sysadmin/address-book/occupations', 'core.organization.read'],
        ['/sysadmin/address-book/duplicate-check', 'core.organization.read'],
    ]);
    expect(menu('geography')).toEqual([
        ['/sysadmin/geography/address-setup', 'core.reference-data.read'],
    ]);
});

// Bacaan yang dipanggil layar dan belum diuji test route lain: bentuk baris yang sampai ke layar, dan props layar
// Setup alamat. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('address book screen reads', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let manager: Browser;
    let reader: Browser;
    afterAll(close);

    async function login(duties: string[]) {
        const member = await createMember(pool, tenantId, duties);
        const session = browser();
        await session.login(member.email, member.password);
        return session;
    }

    async function json<T>(response: Response, status = 200): Promise<T> {
        expect(response.status).toBe(status);
        return (await response.json()) as T;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Layar Buku Alamat');
        manager = await login([
            'core.organization.manage',
            'core.reference-data.manage',
        ]);
        reader = await login([
            'core.organization.inquire',
            'core.reference-data.inquire',
        ]);
    });

    test('the directory, options, occupations, and sharable addresses return the rows the screens read', async () => {
        const occupation = await json<{ data: { id: string } }>(
            await manager.post('/api/v1/occupations', { name: 'Penenun' }),
            201,
        );
        const party = await json<{ data: { id: string } }>(
            await manager.post('/api/v1/parties', {
                type: 'person',
                status: 'active',
                name: 'Wayan Layar',
                occupation_id: occupation.data.id,
                nationality_country_code: 'id',
                party_details: {
                    locations: [
                        {
                            name: 'Rumah',
                            purposes: ['home'],
                            country_region_code: 'ID',
                            street: 'Jalan Contoh 1',
                        },
                    ],
                },
            }),
            201,
        );
        const other = await json<{ data: { id: string } }>(
            await manager.post('/api/v1/parties', {
                type: 'person',
                status: 'active',
                name: 'Made Layar',
            }),
            201,
        );

        const list = await json<{
            data: Record<string, unknown>[];
            next_cursor: string | null;
        }>(await reader.get('/api/v1/parties?q=wayan%20layar&type=person'));
        expect(list.data).toHaveLength(1);
        expect(list.data[0]).toMatchObject({
            id: party.data.id,
            name: 'Wayan Layar',
            occupation_id: occupation.data.id,
            occupation_name: 'Penenun',
            nationality_country_code: 'ID',
            address: 'Jalan Contoh 1',
            roles: [],
        });

        const options = await json<{ data: { id: string; type: string }[] }>(
            await reader.get('/api/v1/parties/options?q=layar'),
        );
        expect(options.data.map((row) => row.id).sort()).toEqual(
            [party.data.id, other.data.id].sort(),
        );

        const occupations = await json<{
            data: Record<string, unknown>[];
        }>(await reader.get('/api/v1/occupations?q=penenun'));
        expect(occupations.data).toEqual([
            { id: occupation.data.id, name: 'Penenun', version: 1 },
        ]);

        // Rumah Wayan bisa dipakai bersama oleh Made, dan tidak ditawarkan lagi kepada Wayan sendiri.
        const sharable = await json<{ data: Record<string, unknown>[] }>(
            await manager.get(
                `/api/v1/parties/${other.data.id}/sharable-locations?q=jalan%20contoh`,
            ),
        );
        expect(sharable.data).toHaveLength(1);
        expect(sharable.data[0]).toMatchObject({
            name: 'Rumah',
            formatted: 'Jalan Contoh 1',
            country_region_code: 'ID',
            group_of_houses_id: null,
        });
        expect(
            (
                await json<{ data: unknown[] }>(
                    await manager.get(
                        `/api/v1/parties/${party.data.id}/sharable-locations?q=jalan%20contoh`,
                    ),
                )
            ).data,
        ).toEqual([]);
    });

    test('the address setup screen learns from the server whether the member may change it', async () => {
        expect(
            await json(await manager.get('/api/v1/settings/address-setup')),
        ).toEqual({ canManage: true });
        expect(
            await json(await reader.get('/api/v1/settings/address-setup')),
        ).toEqual({ canManage: false });
        const outsider = await login(['core.organization.inquire']);
        expect(
            (await outsider.get('/api/v1/settings/address-setup')).status,
        ).toBe(403);
    });
});
