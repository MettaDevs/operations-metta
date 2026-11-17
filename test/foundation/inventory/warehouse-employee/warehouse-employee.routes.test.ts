import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string; version: number };
type Employee = {
    id: string;
    is_default: boolean;
    version: number;
    location: { id: string; code: string };
    user: { id: string };
};
type Refusal = {
    errors: Record<string, string[]>;
    actions?: { kind: string; page: string; recordId: string; label: string }[];
};

const employees = `${inventoryApi}/warehouse-employees`;
const transfers = `${inventoryApi}/transfer-orders`;

// Petugas lokasi (Warehouse Employee BC): lokasi yang ditandai khusus petugas hanya terlihat dan bisa dikerjakan
// petugasnya, sedangkan lokasi lain tetap terbuka bagi setiap pemegang izin dokumennya.
describe.skipIf(!process.env.DB_HOST)('warehouse employees', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let warehouse: { id: string };
    let mobile: { id: string };
    let clerk: Browser;
    let clerkUserId: string;
    let adjustmentId: string;
    let itemId: string;

    const restrict = async (id: string) => {
        const location = (
            await json<{ data: Reference[] }>(
                await business.admin.get(`${inventoryApi}/locations`),
                200,
            )
        ).data.find((row) => row.id === id);
        if (!location) throw new Error(`Location ${id} was not listed.`);
        await json(
            await business.admin.patch(
                `${inventoryApi}/locations/${location.id}`,
                {
                    code: location.code,
                    name: location.name,
                    operating_unit_id: business.unitId,
                    restricted_to_employees: true,
                    version: location.version,
                },
            ),
            200,
        );
    };
    const line = () => ({
        item_id: itemId,
        unit_id: business.uom.id,
        quantity: 5,
    });
    const assign = async (
        session: Browser,
        locationId: string,
        userId: string,
        isDefault = false,
    ) =>
        session.post(employees, {
            location_id: locationId,
            user_id: userId,
            is_default: isDefault,
        });
    const listed = async (session: Browser, path: string) =>
        (await json<{ data: { id: string }[] }>(await session.get(path), 200))
            .data;

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Petugas Lokasi',
            [...inventoryDuties, 'core.inventory-transfer.manage'],
        );
        warehouse = await business.location('GUDANG');
        mobile = await business.location('PUSLING');
        itemId = (await business.item('PCT-500')).id;
        adjustmentId = (
            await business.posted('masuk', warehouse.id, [
                { item_id: itemId, quantity: 20, unit_cost: 100 },
            ])
        ).id;
        const account = await createMember(pool, business.tenantId, [
            'core.inventory-adjustment.manage',
            'core.inventory-transfer.manage',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            account.membershipId,
        );
        clerkUserId = account.userId;
        clerk = browser();
        await clerk.login(account.email, account.password);
    });

    test('a tenant that restricts nothing keeps every location open', async () => {
        expect(
            (await listed(clerk, `${inventoryApi}/adjustments`)).map(
                (row) => row.id,
            ),
        ).toContain(adjustmentId);
    });

    test('one default location per user, and one row per user and location', async () => {
        const first = await json<{ data: Employee }>(
            await assign(business.admin, warehouse.id, clerkUserId, true),
            201,
        );
        const second = await json<{ data: Employee }>(
            await assign(business.admin, mobile.id, clerkUserId, true),
            201,
        );
        expect(second.data.is_default).toBe(true);
        const rows = await json<{ data: Employee[] }>(
            await business.admin.get(employees),
            200,
        );
        expect(
            rows.data
                .filter((row) => row.user.id === clerkUserId)
                .map((row) => [row.location.code, row.is_default])
                .sort(),
        ).toEqual([
            ['GUDANG', false],
            ['PUSLING', true],
        ]);
        const duplicate = await json<Refusal>(
            await assign(business.admin, mobile.id, clerkUserId),
            422,
        );
        expect(duplicate.errors.user_id?.[0]).toContain('sudah petugas');
        const current = rows.data.find((row) => row.id === first.data.id);
        if (!current) throw new Error('warehouse assignment was not listed');
        expect(
            (
                await business.admin.delete(`${employees}/${current.id}`, {
                    version: current.version,
                })
            ).status,
        ).toBe(204);
    });

    test('a restricted location hides its documents from everyone but its employees', async () => {
        await restrict(warehouse.id);
        expect(
            (await listed(clerk, `${inventoryApi}/adjustments`)).map(
                (row) => row.id,
            ),
        ).not.toContain(adjustmentId);
        expect(
            (await clerk.get(`${inventoryApi}/adjustments/${adjustmentId}`))
                .status,
        ).toBe(404);
        const created = await json<Refusal>(
            await clerk.post(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: warehouse.id,
                posting_date: '2026-11-01',
                reason_id: business.reason('SALDO-AWAL'),
                lines: [{ item_id: itemId, quantity: 1, unit_cost: 100 }],
            }),
            422,
        );
        expect(created.errors.location_id?.[0]).toBe(
            'Lokasi GUDANG Lokasi GUDANG hanya untuk petugasnya, dan Anda belum terdaftar sebagai petugas di sana.',
        );
    });

    test('a refused user who may open locations gets a button to its employees', async () => {
        const refused = await json<Refusal>(
            await business.admin.post(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: warehouse.id,
                posting_date: '2026-11-01',
                reason_id: business.reason('SALDO-AWAL'),
                lines: [{ item_id: itemId, quantity: 1, unit_cost: 100 }],
            }),
            422,
        );
        expect(refused.actions).toEqual([
            {
                kind: 'open',
                label: 'Buka petugas lokasi GUDANG',
                page: 'core.inventory-location',
                recordId: warehouse.id,
            },
        ]);
        await json(
            await assign(business.admin, warehouse.id, business.member.userId),
            201,
        );
        expect(
            (await listed(business.admin, `${inventoryApi}/adjustments`)).map(
                (row) => row.id,
            ),
        ).toContain(adjustmentId);
    });

    test('a pusling employee sees the request to pusling but cannot ship it from the warehouse', async () => {
        await restrict(mobile.id);
        const order = (
            await json<{ data: { id: string; version: number } }>(
                await clerk.post(transfers, {
                    from_location_id: warehouse.id,
                    to_location_id: mobile.id,
                    posting_date: '2026-11-02',
                    lines: [line()],
                }),
                201,
            )
        ).data;
        const submitted = (
            await json<{ data: { id: string; version: number } }>(
                await clerk.post(`${transfers}/${order.id}/submit`, {
                    version: order.version,
                }),
                200,
            )
        ).data;
        expect((await listed(clerk, transfers)).map((row) => row.id)).toContain(
            order.id,
        );
        const ship = await json<Refusal>(
            await clerk.post(`${transfers}/${submitted.id}/ship`, {
                version: submitted.version,
                posting_date: '2026-11-02',
            }),
            422,
        );
        expect(ship.errors.from_location_id?.[0]).toContain(
            'Lokasi GUDANG Lokasi GUDANG hanya untuk petugasnya',
        );
        const elsewhere = await json<Refusal>(
            await clerk.post(transfers, {
                from_location_id: warehouse.id,
                to_location_id: (
                    await business.location('FARMASI', {
                        restricted_to_employees: true,
                    })
                ).id,
                posting_date: '2026-11-02',
                lines: [line()],
            }),
            422,
        );
        expect(elsewhere.errors._form?.[0]).toContain('hanya untuk petugasnya');
    });
});
