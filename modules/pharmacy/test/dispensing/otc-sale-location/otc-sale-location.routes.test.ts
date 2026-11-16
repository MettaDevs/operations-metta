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
    pharmacyDuties,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type OtcSaleLocation = {
    id: string;
    location: Reference;
    price_group: Reference | null;
    version: number;
};
type Options = { locations: (Reference & { price_group: Reference | null })[] };

// Lokasi penjualan obat bebas: satu baris hidup per lokasi stok berarti lokasi itu boleh menjual obat bebas, dengan
// kelompok harga bawaannya. Hapus bersifat lunak dan mencabut izin menjual; lokasi yang sama boleh diatur lagi.
describe.skipIf(!process.env.DB_HOST)('OTC sale locations', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let counter: Reference;
    let umum: Reference;
    const path = `${api}/otc-sale-locations`;

    const options = async () =>
        (
            await json<{ data: Options }>(
                await pharmacy.admin.get(`${api}/otc-sales/options`),
                200,
            )
        ).data.locations;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Apotek Uji Lokasi', {
            duties: [
                ...pharmacyDuties,
                'pharmacy.otc-sale.operate',
                'core.pricing-setup.manage',
                'core.reference-data.manage',
            ],
        });
        counter = await pharmacy.location('LOKET');
        umum = await pharmacy.created('/api/v1/pricing/price-groups', {
            code: 'UMUM',
            name: 'Umum',
        });
    });

    test('a location is allowed once, its price group changes with the version, and delete withdraws it', async () => {
        expect(await options()).toEqual([]);
        const created = (
            await json<{ data: OtcSaleLocation }>(
                await pharmacy.admin.post(path, {
                    location_id: counter.id,
                    price_group_id: umum.id,
                }),
                201,
            )
        ).data;
        expect(created).toMatchObject({
            location: { id: counter.id, code: 'LOKET' },
            price_group: { id: umum.id, code: 'UMUM', name: 'Umum' },
        });
        expect(await options()).toEqual([
            {
                id: counter.id,
                code: 'LOKET',
                name: counter.name,
                price_group: { id: umum.id, code: 'UMUM', name: 'Umum' },
            },
        ]);
        expect(
            await refused(
                await pharmacy.admin.post(path, { location_id: counter.id }),
            ),
        ).toEqual({
            location_id: [
                'Lokasi ini sudah boleh menjual obat bebas. Ubah baris yang ada.',
            ],
        });

        const basePrice = (
            await json<{ data: OtcSaleLocation }>(
                await pharmacy.admin.patch(`${path}/${created.id}`, {
                    price_group_id: null,
                    version: created.version,
                }),
                200,
            )
        ).data;
        expect(basePrice.price_group).toBeNull();
        expect(basePrice.location.id).toBe(counter.id);
        expect(
            (
                await pharmacy.admin.patch(`${path}/${created.id}`, {
                    price_group_id: umum.id,
                    version: created.version,
                })
            ).status,
        ).toBe(409);

        expect(
            (
                await pharmacy.admin.delete(`${path}/${created.id}`, {
                    version: basePrice.version,
                })
            ).status,
        ).toBe(204);
        const [archived] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from far_m_lokasi_penjualan where id = $1',
            [created.id],
        );
        expect(archived?.deleted).toBe(true);
        expect(await options()).toEqual([]);
        await json(
            await pharmacy.admin.post(path, { location_id: counter.id }),
            201,
        );
    });

    test('transit, foreign, and unknown references are refused field by field', async () => {
        const transit = await pharmacy.location('TRANSIT', {
            is_transit: true,
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path, {
                        location_id: transit.id,
                    }),
                ),
            ),
        ).toEqual(['location_id']);
        const other = await createPharmacy(pool, browser, 'Apotek Uji Lain', {
            duties: [...pharmacyDuties, 'core.pricing-setup.manage'],
        });
        const foreign = await other.location('LAIN');
        const foreignGroup = await other.created(
            '/api/v1/pricing/price-groups',
            { code: 'LAIN', name: 'Lain' },
        );
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path, {
                        location_id: foreign.id,
                        price_group_id: foreignGroup.id,
                    }),
                ),
            ).sort(),
        ).toEqual(['location_id', 'price_group_id']);
        expect(
            (
                await pharmacy.admin.patch(`${path}/${Bun.randomUUIDv7()}`, {
                    price_group_id: null,
                    version: 1,
                })
            ).status,
        ).toBe(404);
    });

    test('a member without the pharmacy setup duty cannot change the setting', async () => {
        const seller = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.otc-sale.operate',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            seller.membershipId,
        );
        const signedIn = browser();
        await signedIn.login(seller.email, seller.password);
        const shelf = await pharmacy.location('RAK');
        expect(
            (await signedIn.post(path, { location_id: shelf.id })).status,
        ).toBe(403);
        expect((await signedIn.get(path)).status).toBe(403);
    });
});
