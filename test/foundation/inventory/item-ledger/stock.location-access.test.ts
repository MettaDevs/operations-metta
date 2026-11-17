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
type Located = { location: { code: string } };
type Refusal = { errors: Record<string, string[]> };
type Stock = { items: { lines: Located[] }[] };

describe.skipIf(!process.env.DB_HOST)(
    'stock reads and warehouse employees',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);

        let business: Business;
        let warehouse: { id: string };
        let mobile: { id: string };
        let itemId: string;
        let clerk: Browser;

        const codes = (rows: Located[]) =>
            [...new Set(rows.map((row) => row.location.code))].sort();
        const stock = async (query: string) =>
            codes(
                (
                    await json<{ data: Located[] }>(
                        await clerk.get(`${inventoryApi}/stock?${query}`),
                        200,
                    )
                ).data,
            );
        const ledger = (query: string) =>
            clerk.get(
                `${inventoryApi}/item-ledger-entries?item_id=${itemId}&from=2026-11-01&to=2026-11-30${query}`,
            );
        const byLocation = (query: string) =>
            clerk.get(
                `${inventoryApi}/reports/stock-by-location?as_of=2026-11-30${query}`,
            );
        const locations = async (query: string) =>
            (
                await json<{ data: Reference[] }>(
                    await clerk.get(`${inventoryApi}/locations?${query}`),
                    200,
                )
            ).data
                .map((row) => row.code)
                .sort();
        const refusal = async (response: Response) =>
            Object.keys((await json<Refusal>(response, 422)).errors);

        beforeAll(async () => {
            business = await createBusiness(
                pool,
                browser,
                'Klinik Uji Stok Petugas Lokasi',
                [...inventoryDuties, 'core.inventory-report.inquire'],
            );
            warehouse = await business.location('GUDANG');
            mobile = await business.location('PUSLING');
            const pharmacy = await business.location('APOTEK');
            itemId = (await business.item('PCT-500')).id;
            for (const location of [warehouse, mobile, pharmacy])
                await business.posted(
                    'masuk',
                    location.id,
                    [{ item_id: itemId, quantity: 10, unit_cost: 100 }],
                    '2026-11-05',
                );
            const account = await createMember(pool, business.tenantId, [
                'core.inventory-item.inquire',
                'core.inventory-setup.inquire',
                'core.inventory-report.inquire',
            ]);
            await grantAllOrganizations(
                pool,
                business.tenantId,
                account.membershipId,
            );
            clerk = browser();
            await clerk.login(account.email, account.password);
            await json(
                await business.admin.post(
                    `${inventoryApi}/warehouse-employees`,
                    {
                        location_id: warehouse.id,
                        user_id: account.userId,
                        is_default: true,
                    },
                ),
                201,
            );
        });

        test('without restricted locations every location is readable', async () => {
            expect(await stock(`item_id=${itemId}`)).toEqual([
                'APOTEK',
                'GUDANG',
                'PUSLING',
            ]);
            expect(await locations('accessible=true')).toEqual([
                'APOTEK',
                'GUDANG',
                'PUSLING',
            ]);
        });

        test('a restricted location is read only by its employees', async () => {
            const all = (
                await json<{ data: Reference[] }>(
                    await business.admin.get(`${inventoryApi}/locations`),
                    200,
                )
            ).data;
            for (const id of [warehouse.id, mobile.id]) {
                const location = all.find((row) => row.id === id);
                if (!location)
                    throw new Error(`Location ${id} was not listed.`);
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
            }

            expect(await stock(`item_id=${itemId}`)).toEqual([
                'APOTEK',
                'GUDANG',
            ]);
            expect(await stock(`location_id=${warehouse.id}`)).toEqual([
                'GUDANG',
            ]);
            expect(
                await refusal(
                    await clerk.get(
                        `${inventoryApi}/stock?location_id=${mobile.id}`,
                    ),
                ),
            ).toEqual(['_form']);

            const card = await json<{
                opening_balance: string;
                data: Located[];
            }>(await ledger(''), 200);
            expect(codes(card.data)).toEqual(['APOTEK', 'GUDANG']);
            expect(
                codes(
                    (
                        await json<{ data: Located[] }>(
                            await ledger(`&location_id=${warehouse.id}`),
                            200,
                        )
                    ).data,
                ),
            ).toEqual(['GUDANG']);
            expect(
                await refusal(await ledger(`&location_id=${mobile.id}`)),
            ).toEqual(['_form']);

            const report = await json<Stock>(await byLocation(''), 200);
            expect(codes(report.items.flatMap((group) => group.lines))).toEqual(
                ['APOTEK', 'GUDANG'],
            );
            expect(
                await refusal(await byLocation(`&location_id=${mobile.id}`)),
            ).toEqual(['_form']);

            expect(await locations('accessible=true')).toEqual([
                'APOTEK',
                'GUDANG',
            ]);
            expect(await locations('')).toEqual([
                'APOTEK',
                'GUDANG',
                'PUSLING',
            ]);
        });
    },
);
