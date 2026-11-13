import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    json,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Setup = {
    data: { unit_price_decimals: number; version: number | null };
    can_manage: boolean;
};

// Setelan farmasi per legal entity: tanpa baris berarti harga satuan obat dibulatkan ke rupiah (0), simpanan pertama
// membuat barisnya, versi basi ditolak, nilai di luar 0 sampai 4 ditolak pada isiannya, legal entity lain memegang
// setelannya sendiri, dan pemegang duty lihat tidak bisa mengubahnya. Isi tabel dibaca lewat SQL. Butuh PostgreSQL yang
// sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('pharmacy setup', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;

    const path = `${api}/setup`;
    const show = async () => json<Setup>(await pharmacy.admin.get(path), 200);
    const save = (body: Record<string, unknown>) =>
        pharmacy.admin.put(path, body);
    const stored = async (legalEntityId: string) =>
        (
            await pool.unsafe<{ decimals: number }[]>(
                `select desimal_harga_satuan as decimals from far_m_parameter
                 where tenant_id = $1 and legal_entity_id = $2`,
                [pharmacy.tenantId, legalEntityId],
            )
        ).map((row) => row.decimals);

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Setelan');
    });

    test('a legal entity without a setting reads 0, the first save creates its row, and a stale version is refused', async () => {
        expect(await show()).toEqual({
            data: { unit_price_decimals: 0, version: null },
            can_manage: true,
        });
        expect(await stored(pharmacy.legalEntityId)).toEqual([]);

        const created = await json<Setup>(
            await save({ unit_price_decimals: 4, version: null }),
            200,
        );
        expect(created.data).toEqual({ unit_price_decimals: 4, version: 1 });
        expect(await stored(pharmacy.legalEntityId)).toEqual([4]);
        expect((await show()).data).toEqual(created.data);

        const changed = await json<Setup>(
            await save({ unit_price_decimals: 2, version: 1 }),
            200,
        );
        expect(changed.data).toEqual({ unit_price_decimals: 2, version: 2 });
        for (const body of [
            { unit_price_decimals: 3, version: 1 },
            { unit_price_decimals: 3, version: null },
        ])
            expect((await save(body)).status).toBe(409);
        expect(await stored(pharmacy.legalEntityId)).toEqual([2]);
    });

    test('a value outside 0 to 4 is refused on its field', async () => {
        const { version } = (await show()).data;
        for (const decimals of [5, -1, 1.5, '2', null])
            expect(
                Object.keys(
                    await refused(
                        await save({ unit_price_decimals: decimals, version }),
                    ),
                ),
            ).toEqual(['unit_price_decimals']);
        expect((await show()).data.version).toBe(version);
    });

    test('another legal entity reads and saves its own setting', async () => {
        const second = (
            await json<{ data: { id: string } }>(
                await pharmacy.admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Farmasi Uji Setelan Kedua',
                    company_code: `S${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        const switchTo = async (legalEntityId: string) =>
            json(
                await pharmacy.admin.put('/api/v1/workspace-context', {
                    membership_id: pharmacy.member.membershipId,
                    legal_entity_id: legalEntityId,
                }),
                200,
            );
        const own = (await show()).data;
        await switchTo(second);
        expect((await show()).data).toEqual({
            unit_price_decimals: 0,
            version: null,
        });
        await json(await save({ unit_price_decimals: 4, version: null }), 200);
        await switchTo(pharmacy.legalEntityId);
        expect((await show()).data).toEqual(own);
        expect(await stored(second)).toEqual([4]);
        expect(await stored(pharmacy.legalEntityId)).toEqual([
            own.unit_price_decimals,
        ]);
    });

    test('a viewer of pharmacy setup reads the setting but cannot change it', async () => {
        const viewer = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.setup.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            viewer.membershipId,
        );
        const session = browser();
        await session.login(viewer.email, viewer.password);
        const seen = await json<Setup>(await session.get(path), 200);
        expect(seen.can_manage).toBe(false);
        expect(
            (
                await session.put(path, {
                    unit_price_decimals: 0,
                    version: seen.data.version,
                })
            ).status,
        ).toBe(403);
        expect((await show()).data).toEqual(seen.data);
    });
});
