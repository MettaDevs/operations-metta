import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import {
    createBusiness,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { documentText } from '../../../support/receipt-fixture.ts';

// LPLPO satu lokasi satu periode, kolom prosedur SIMPUS_LPLPO sistem lama: stok awal dari kartu gudang sebelum periode,
// penerimaan dan pemakaian dalam periode, persediaan, sisa stok, stok optimum dari stok maksimum lokasi, dan permintaan
// pembelian lokasi itu.
describe.skipIf(!process.env.DB_HOST)('lplpo', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let warehouse: { id: string };
    const november = { from: '2026-11-01', to: '2026-11-30' };

    const print = (
        locationId: string,
        query: Record<string, string>,
        format = 'docx',
    ) =>
        business.admin.get(
            `/api/v1/reports/core.lplpo/records/${locationId}?${new URLSearchParams(
                { format, ...query },
            ).toString()}`,
        );
    const requested = async (
        location: { id: string },
        item: { id: string },
        quantity: number,
        createdAt: string,
    ) => {
        const { data } = await json<{ data: { id: string } }>(
            await business.admin.post('/api/v1/purchasing/requisitions', {
                location_id: location.id,
                item_id: item.id,
                quantity,
                due_date: '2026-11-25',
            }),
            201,
        );
        await pool.unsafe(
            'update bl_tr_permintaan set created_at = $1 where id = $2',
            [createdAt, data.id],
        );
    };

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji LPLPO', [
            ...inventoryDuties,
            'core.inventory-report.inquire',
            'core.purchase-requisition.manage',
        ]);
        warehouse = await business.location('GUDANG');
        const pharmacy = await business.location('FARMASI');
        const used = await business.item('OBT-A');
        const idle = await business.item('OBT-B');
        const asked = await business.item('OBT-C');
        const elsewhere = await business.item('OBT-D');
        const stock = (item: { id: string }, quantity: number) => [
            { item_id: item.id, quantity, unit_cost: 100 },
        ];
        await business.posted(
            'masuk',
            warehouse.id,
            stock(used, 50),
            '2026-10-15',
        );
        await business.posted(
            'masuk',
            warehouse.id,
            stock(idle, 10),
            '2026-10-01',
        );
        await business.posted(
            'masuk',
            warehouse.id,
            stock(used, 30),
            '2026-11-05',
        );
        await business.posted(
            'keluar',
            warehouse.id,
            [{ item_id: used.id, quantity: 20 }],
            '2026-11-12',
        );
        await business.posted(
            'masuk',
            warehouse.id,
            stock(used, 9),
            '2026-12-01',
        );
        await business.posted(
            'masuk',
            pharmacy.id,
            stock(elsewhere, 5),
            '2026-11-05',
        );
        await json(
            await business.admin.post('/api/v1/inventory/stockkeeping-units', {
                item_id: used.id,
                location_id: warehouse.id,
                minimum_quantity: 10,
                maximum_quantity: 100,
            }),
            201,
        );
        // Dibuat 31 Oktober pukul 18.00 UTC, yaitu 1 November di zona waktu Indonesia mana pun.
        await requested(warehouse, asked, 15, '2026-10-31 18:00:00');
        await requested(warehouse, asked, 4, '2026-10-20 03:00:00');
        await requested(pharmacy, asked, 99, '2026-11-10 03:00:00');
    });

    test('each item with stock, movement, or a request gets opening, received, available, used, closing, optimum, and requested', async () => {
        const response = await print(warehouse.id, november);
        expect(response.status).toBe(200);
        const text = documentText(new Uint8Array(await response.arrayBuffer()));
        expect(text).toContain('LAPORAN PEMAKAIAN DAN LEMBAR PERMINTAAN OBAT');
        expect(text).toContain(': 1 November 2026 s.d. 30 November 2026');
        expect(text).toContain(
            'OBT-A\nBarang OBT-A\nTAB\n50\n30\n80\n20\n60\n100\n0\n',
        );
        expect(text).toContain(
            'OBT-B\nBarang OBT-B\nTAB\n10\n0\n10\n0\n10\n\n0\n',
        );
        expect(text).toContain(
            'OBT-C\nBarang OBT-C\nTAB\n0\n0\n0\n0\n0\n\n15\n',
        );
        expect(text).not.toContain('OBT-D');
        expect(text).not.toContain('{');
        const [ledger] = await pool.unsafe<{ closing: string }[]>(
            `select trim_scale(sum(k.jumlah))::text as closing from gd_tr_kartu_gudang k
             join gd_m_barang b on b.id = k.barang_id
             where k.tenant_id = $1 and k.lokasi_id = $2 and b.kode = 'OBT-A' and k.tanggal_posting <= '2026-11-30'`,
            [business.tenantId, warehouse.id],
        );
        expect(ledger?.closing).toBe('60');
    });

    test('a period that ends before it starts is refused', async () => {
        const refused = await json<{ errors: Record<string, string[]> }>(
            await print(warehouse.id, { from: '2026-11-30', to: '2026-11-01' }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['to']);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the PDF is A4 landscape',
        async () => {
            const response = await print(warehouse.id, november, 'pdf');
            expect(response.status).toBe(200);
            const pdf = await getDocumentProxy(
                new Uint8Array(await response.arrayBuffer()),
            );
            expect((await pdf.getPage(1)).view.map(Math.round)).toEqual([
                0, 0, 842, 595,
            ]);
            const { text } = await extractText(pdf, { mergePages: true });
            expect(text).toContain('OBT-A');
        },
    );
});
