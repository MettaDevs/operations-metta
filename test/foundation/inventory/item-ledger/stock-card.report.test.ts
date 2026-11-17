import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import {
    createBusiness,
    inventoryApi,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { documentText } from '../../../support/receipt-fixture.ts';

type Reference = { id: string; code: string; name: string; version: number };
type Refusal = { errors: Record<string, string[]> };

// Kartu stok satu barang di satu lokasi dan satu periode (report "Inventory - Transaction Detail" BC): saldo awal dari
// gerak sebelum periode, gerak dalam periode dengan saldo berjalan, lalu saldo akhir yang sama dengan kartu gudang.
describe.skipIf(!process.env.DB_HOST)('stock card', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let warehouse: { id: string };
    let item: { id: string };

    const print = (query: Record<string, string>) =>
        business.admin.get(
            `/api/v1/reports/core.stock-card/records/${item.id}?${new URLSearchParams(
                { format: 'docx', ...query },
            ).toString()}`,
        );
    const november = {
        location_id: '',
        from: '2026-11-01',
        to: '2026-11-30',
    };

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Kartu Stok');
        warehouse = await business.location('GUDANG');
        const other = await business.location('APOTEK');
        november.location_id = warehouse.id;
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        item = await business.item('KS-1', { tracking_code_id: tracked.id });
        const batch = (number: string, quantity: number) => ({
            item_id: item.id,
            quantity,
            unit_cost: 100,
            batch_number: number,
            expiry_date: '2027-09-30',
        });
        await business.posted(
            'masuk',
            warehouse.id,
            [batch('S-1', 10)],
            '2026-10-20',
        );
        await business.posted(
            'masuk',
            warehouse.id,
            [batch('S-2', 20)],
            '2026-11-03',
        );
        await business.posted(
            'masuk',
            other.id,
            [batch('S-9', 5)],
            '2026-11-05',
        );
        await business.posted(
            'keluar',
            warehouse.id,
            [{ item_id: item.id, quantity: 7 }],
            '2026-11-10',
        );
        await business.posted(
            'masuk',
            warehouse.id,
            [batch('S-3', 3)],
            '2026-12-02',
        );
    });

    test('opening balance, each movement with its running balance and batch, and a closing balance that matches the ledger', async () => {
        const response = await print(november);
        expect(response.status).toBe(200);
        const text = documentText(new Uint8Array(await response.arrayBuffer()));
        expect(text).toContain('KARTU STOK');
        expect(text).toContain(': KS-1 Barang KS-1\nLokasi\n: GUDANG');
        expect(text).toContain(': 1 November 2026 s.d. 30 November 2026');
        expect(text).toContain('Saldo awal\n: 10 TAB');
        expect(text).toContain(
            '3 November 2026\nPNY-00000002\nPenyesuaian tambah\nS-2\n30 September 2027\n20\n\n30\n',
        );
        expect(text).toContain(
            '10 November 2026\nPNY-00000004\nPemakaian\nS-1\n30 September 2027\n\n7\n23\n',
        );
        expect(text).not.toContain('S-9');
        expect(text).not.toContain('S-3');
        expect(text).toContain(
            'Jumlah masuk\n20 TAB\nJumlah keluar\n7 TAB\nSaldo akhir\n23 TAB',
        );
        expect(text).not.toContain('{');
        const [ledger] = await pool.unsafe<{ balance: string }[]>(
            `select trim_scale(sum(jumlah))::text as balance from gd_tr_kartu_gudang
             where tenant_id = $1 and barang_id = $2 and lokasi_id = $3 and tanggal_posting <= '2026-11-30'`,
            [business.tenantId, item.id, warehouse.id],
        );
        expect(ledger?.balance).toBe('23');
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the PDF is A4 landscape and carries the closing balance',
        async () => {
            const response = await print({ ...november, format: 'pdf' });
            expect(response.status).toBe(200);
            const pdf = await getDocumentProxy(
                new Uint8Array(await response.arrayBuffer()),
            );
            expect((await pdf.getPage(1)).view.map(Math.round)).toEqual([
                0, 0, 842, 595,
            ]);
            const { text } = await extractText(pdf, { mergePages: true });
            expect(text).toContain('KARTU STOK');
            expect(text).toContain('23 TAB');
        },
    );

    test('a missing location or a period that ends before it starts is refused', async () => {
        const refused = await json<Refusal>(
            await print({ from: '2026-11-30', to: '2026-11-01' }),
            422,
        );
        expect(Object.keys(refused.errors).sort()).toEqual([
            'location_id',
            'to',
        ]);
    });

    test('a location kept for its own employees is refused to others', async () => {
        const location = (
            await json<{ data: Reference[] }>(
                await business.admin.get(`${inventoryApi}/locations`),
                200,
            )
        ).data.find((row) => row.id === warehouse.id);
        if (!location) throw new Error('No warehouse.');
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
        const refused = await json<Refusal>(await print(november), 422);
        expect(Object.keys(refused.errors)).toEqual(['_form']);
    });
});
