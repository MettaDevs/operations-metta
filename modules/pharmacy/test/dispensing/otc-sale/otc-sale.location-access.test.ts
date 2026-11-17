import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    inventoryApi,
    json,
    pharmacyDuties,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type Location = Reference & { version: number };
type Refusal = {
    errors: Record<string, string[]>;
    actions?: { page: string; recordId: string }[];
};

const sales = `${api}/otc-sales`;

// Satu farmasi, lokasi diatur: petugas loket pusling hanya melihat penjualan obat bebas di pusling, dan penjualan di
// loket farmasi biasa yang dibuka lewat alamatnya ditolak dengan nama lokasinya. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('OTC sales per location', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let clerk: Browser;
    let regular: Reference;
    let mobile: Reference;
    const sold = { regular: '', mobile: '' };

    async function sell(location: Reference, item: Reference) {
        const lines = [
            { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 1 },
        ];
        const { total } = (
            await json<{ data: { total: string } }>(
                await pharmacy.admin.post(`${sales}/quote`, {
                    location_id: location.id,
                    lines,
                }),
                200,
            )
        ).data;
        return (
            await json<{ data: { id: string } }>(
                await pharmacy.admin.post(sales, {
                    location_id: location.id,
                    lines,
                    expected_total: total,
                    payment: { received: total },
                }),
                201,
            )
        ).data.id;
    }

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Apotek Uji Petugas', {
            duties: [
                ...pharmacyDuties,
                'pharmacy.otc-sale.operate',
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        });
        regular = await pharmacy.location('FARMASI');
        mobile = await pharmacy.location('PUSLING');
        const item = await pharmacy.item('OTC-LOK', { base_price: '1000' });
        const reasonId =
            (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        for (const location of [regular, mobile]) {
            await pharmacy.created(`${api}/otc-sale-locations`, {
                location_id: location.id,
            });
            const draft = await pharmacy.created<{
                id: string;
                version: number;
            }>(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: location.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [{ item_id: item.id, quantity: 10, unit_cost: 500 }],
            });
            await json(
                await pharmacy.admin.post(
                    `${inventoryApi}/adjustments/${draft.id}/post`,
                    { version: draft.version },
                ),
                200,
            );
        }
        await pharmacy.created('/api/v1/billing/payment-methods', {
            code: 'TUN',
            name: 'Tunai',
            behavior: 'tunai',
        });
        await json(
            await pharmacy.admin.post('/api/v1/billing/clerks/start', {}),
            201,
        );
        sold.regular = await sell(regular, item);
        sold.mobile = await sell(mobile, item);

        const account = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.otc-sale.operate',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            account.membershipId,
        );
        clerk = browser();
        await clerk.login(account.email, account.password);
        const locations = (
            await json<{ data: Location[] }>(
                await pharmacy.admin.get(`${inventoryApi}/locations`),
                200,
            )
        ).data;
        for (const location of locations)
            await json(
                await pharmacy.admin.patch(
                    `${inventoryApi}/locations/${location.id}`,
                    {
                        code: location.code,
                        name: location.name,
                        operating_unit_id: pharmacy.unitId,
                        restricted_to_employees: true,
                        version: location.version,
                    },
                ),
                200,
            );
        await json(
            await pharmacy.admin.post(`${inventoryApi}/warehouse-employees`, {
                location_id: mobile.id,
                user_id: account.userId,
                is_default: true,
            }),
            201,
        );
    });

    const listed = async (session: Browser) =>
        (
            await json<{ data: { id: string }[] }>(
                await session.get(sales),
                200,
            )
        ).data.map((row) => row.id);

    test('the pusling employee lists pusling sales only; an unassigned user lists none', async () => {
        expect(await listed(clerk)).toEqual([sold.mobile]);
        expect(await listed(pharmacy.admin)).toEqual([]);
    });

    test('the counter offers only the locations the user may sell at', async () => {
        const options = await json<{ data: { locations: Reference[] } }>(
            await clerk.get(`${sales}/options`),
            200,
        );
        expect(options.data.locations.map((row) => row.id)).toEqual([
            mobile.id,
        ]);
    });

    test('opening a sale at another location by its address is refused with the location named', async () => {
        await json(await clerk.get(`${sales}/${sold.mobile}`), 200);
        await json(await clerk.get(`${sales}/${sold.mobile}/returns`), 200);
        for (const path of [
            `${sales}/${sold.regular}`,
            `${sales}/${sold.regular}/returns`,
        ]) {
            const refusal = await json<Refusal>(await clerk.get(path), 422);
            expect(refusal.errors._form?.[0]).toContain(
                'Lokasi FARMASI hanya untuk petugasnya',
            );
            expect(refusal.actions).toBeUndefined();
        }
        const manager = await json<Refusal>(
            await pharmacy.admin.get(`${sales}/${sold.regular}`),
            422,
        );
        expect(manager.actions?.[0]).toMatchObject({
            page: 'core.inventory-location',
            recordId: regular.id,
        });
    });
});
