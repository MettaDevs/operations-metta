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

type Reference = { id: string; code: string; name: string };
const reference = ({ id, code, name }: Reference): Reference => ({
    id,
    code,
    name,
});
type Listing = {
    data: {
        id: string;
        substitute: Reference;
        notes: string | null;
        version: number;
    }[];
    can_manage: boolean;
};

// Obat pengganti diisi di kartu data obat farmasi. Isinya diperiksa lewat SQL atas far_m_obat_pengganti.
describe.skipIf(!process.env.DB_HOST)('item substitutions', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let brand: Reference;
    let generic: Reference;
    let other: Reference;
    const path = (itemId: string, suffix = '') =>
        `${api}/drugs/${itemId}/substitutions${suffix}`;
    const pairs = async () =>
        (
            await pool.unsafe<{ from: string; to: string; deleted: boolean }[]>(
                `select barang_id as from, barang_pengganti_id as to, deleted_at is not null as deleted
                 from far_m_obat_pengganti where tenant_id = $1 order by created_at, id`,
                [pharmacy.tenantId],
            )
        ).map((row) => ({ ...row }));

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Pengganti');
        brand = reference(await pharmacy.item('MERK-1'));
        generic = reference(await pharmacy.item('GEN-1'));
        other = reference(await pharmacy.item('LAIN-1'));
    });

    test('adding a two-way substitute records both directions, and each card lists its own', async () => {
        const listing = await json<Listing>(
            await pharmacy.admin.post(path(brand.id), {
                substitute_item_id: generic.id,
                notes: 'Generik, zat aktif sama',
                interchangeable: true,
            }),
            200,
        );
        expect(listing.data).toMatchObject([
            { substitute: generic, notes: 'Generik, zat aktif sama' },
        ]);
        expect(await pairs()).toEqual([
            { from: brand.id, to: generic.id, deleted: false },
            { from: generic.id, to: brand.id, deleted: false },
        ]);
        expect(
            (
                await json<Listing>(
                    await pharmacy.admin.get(path(generic.id)),
                    200,
                )
            ).data.map((row) => row.substitute.id),
        ).toEqual([brand.id]);
    });

    test('a duplicate, the item itself, or an unknown item is refused without writing', async () => {
        const before = await pairs();
        expect(
            await refused(
                await pharmacy.admin.post(path(brand.id), {
                    substitute_item_id: generic.id,
                }),
            ),
        ).toEqual({
            substitute_item_id: ['Obat ini sudah tercatat sebagai pengganti.'],
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path(brand.id), {
                        substitute_item_id: brand.id,
                    }),
                ),
            ),
        ).toEqual(['substitute_item_id']);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path(brand.id), {
                        substitute_item_id: Bun.randomUUIDv7(),
                    }),
                ),
            ),
        ).toEqual(['substitute_item_id']);
        expect(await pairs()).toEqual(before);
    });

    test('Delete removes one direction softly and needs the current version', async () => {
        await json(
            await pharmacy.admin.post(path(brand.id), {
                substitute_item_id: other.id,
                interchangeable: false,
            }),
            200,
        );
        const row = (
            await json<Listing>(await pharmacy.admin.get(path(brand.id)), 200)
        ).data.find((entry) => entry.substitute.id === other.id);
        if (!row) throw new Error('Pengganti tidak tercatat.');
        expect(
            (
                await pharmacy.admin.delete(path(brand.id, `/${row.id}`), {
                    version: row.version + 1,
                })
            ).status,
        ).toBe(409);
        const listing = await json<Listing>(
            await pharmacy.admin.delete(path(brand.id, `/${row.id}`), {
                version: row.version,
            }),
            200,
        );
        expect(listing.data.map((entry) => entry.substitute.id)).toEqual([
            generic.id,
        ]);
        expect(await pairs()).toContainEqual({
            from: brand.id,
            to: other.id,
            deleted: true,
        });
    });

    test('a user who can only read drug data sees the list but cannot change it', async () => {
        const account = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.setup.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            account.membershipId,
        );
        const reader = browser();
        await reader.login(account.email, account.password);
        const listing = await json<Listing>(
            await reader.get(path(brand.id)),
            200,
        );
        expect(listing.can_manage).toBe(false);
        expect(
            (
                await reader.post(path(brand.id), {
                    substitute_item_id: other.id,
                })
            ).status,
        ).toBe(403);
    });
});
