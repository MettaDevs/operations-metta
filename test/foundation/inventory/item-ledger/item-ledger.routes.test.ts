import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type StockRow = {
    location: { code: string };
    batch: { batch_number: string } | null;
    quantity: string;
};
type LedgerRow = {
    posting_date: string;
    kind: string;
    quantity: string;
    remaining_quantity: string;
    balance: string;
    batch: { batch_number: string } | null;
    document: { type: string; number: string | null };
};

// Stok per lokasi dan batch, dan kartu stok dengan saldo berjalan, dibaca dari kartu gudang tanpa saldo tersimpan.
describe.skipIf(!process.env.DB_HOST)('inventory stock and stock card', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let business: Business;
    let item: { id: string };
    let store: { id: string };
    let pharmacy: { id: string };
    afterAll(close);

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Kartu');
        const profile = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        store = await business.location('GUDANG');
        pharmacy = await business.location('APOTEK');
        item = await business.item('KARTU-1', { tracking_code_id: profile.id });
        const receipt = (quantity: number, batch: string, expiry: string) => ({
            item_id: item.id,
            quantity,
            batch_number: batch,
            expiry_date: expiry,
            unit_cost: 500,
        });
        await business.posted(
            'masuk',
            store.id,
            [receipt(5, 's1', '2027-01-31')],
            '2026-10-01',
        );
        await business.posted(
            'masuk',
            store.id,
            [receipt(3, 's2', '2027-06-30')],
            '2026-10-03',
        );
        await business.posted(
            'keluar',
            store.id,
            [{ item_id: item.id, quantity: 4 }],
            '2026-10-05',
        );
        await business.posted(
            'masuk',
            pharmacy.id,
            [receipt(2, 'p1', '2027-03-31')],
            '2026-10-07',
        );
    });

    test('stock lists the open quantity per location and batch', async () => {
        const stock = await json<{ data: StockRow[] }>(
            await business.admin.get(
                `${inventoryApi}/stock?item_id=${item.id}`,
            ),
            200,
        );
        expect(
            stock.data.map((row) => [
                row.location.code,
                row.batch?.batch_number,
                row.quantity,
            ]),
        ).toEqual([
            ['APOTEK', 'P1', '2'],
            ['GUDANG', 'S1', '1'],
            ['GUDANG', 'S2', '3'],
        ]);
    });

    test('the stock card starts from the balance before the range and runs it row by row', async () => {
        const card = await json<{ opening_balance: string; data: LedgerRow[] }>(
            await business.admin.get(
                `${inventoryApi}/item-ledger-entries?item_id=${item.id}&location_id=${store.id}&from=2026-10-02&to=2026-10-31`,
            ),
            200,
        );
        expect(card.opening_balance).toBe('5');
        expect(
            card.data.map((row) => [
                row.posting_date,
                row.kind,
                row.batch?.batch_number,
                row.quantity,
                row.balance,
                row.document.type,
            ]),
        ).toEqual([
            ['2026-10-03', 'penyesuaian_tambah', 'S2', '3', '8', 'penyesuaian'],
            ['2026-10-05', 'pemakaian', 'S1', '-4', '4', 'penyesuaian'],
        ]);
        expect(card.data[0]?.document.number).toMatch(/^PNY-/);
    });

    test('the stock card filters by kind and shows what is left of each row', async () => {
        const card = await json<{ opening_balance: string; data: LedgerRow[] }>(
            await business.admin.get(
                `${inventoryApi}/item-ledger-entries?item_id=${item.id}&location_id=${store.id}&kind=penyesuaian_tambah&from=2026-10-01&to=2026-10-31`,
            ),
            200,
        );
        expect(card.opening_balance).toBe('0');
        expect(
            card.data.map((row) => [
                row.kind,
                row.batch?.batch_number,
                row.quantity,
                row.remaining_quantity,
            ]),
        ).toEqual([
            ['penyesuaian_tambah', 'S1', '5', '1'],
            ['penyesuaian_tambah', 'S2', '3', '3'],
        ]);
    });

    test('stock is readable only with the stock right', async () => {
        const outsider = await createMember(pool, business.tenantId, [
            'core.inventory-setup.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            outsider.membershipId,
        );
        const session = browser();
        await session.login(outsider.email, outsider.password);
        expect(
            (await session.get(`${inventoryApi}/stock?item_id=${item.id}`))
                .status,
        ).toBe(403);
    });
});
