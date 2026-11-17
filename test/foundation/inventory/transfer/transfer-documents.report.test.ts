import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { documentText } from '../../../support/receipt-fixture.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Order = {
    id: string;
    number: string;
    version: number;
    postings: { id: string; kind: 'shipment' | 'receipt'; number: string }[];
};

const path = `${inventoryApi}/transfer-orders`;

// Permintaan barang, mutasi, dan penerimaan mutasi dicetak mesin cetak Core dari dataset persediaan: lokasi asal dan
// tujuan, batch dan kedaluwarsa per baris, nilai dengan terbilang, pengirim dan penerima dari pengguna yang memposting,
// dan penanda tangan unit kerja lokasi penerbit dari Kop surat. Diperiksa dari berkas Word yang diunduh.
describe.skipIf(!process.env.DB_HOST)('transfer documents', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let order: Order;
    let shipmentId: string;
    let receiptId: string;
    let shipmentNumber: string;
    let userName: string;
    const print = async (code: string, id: string, query = 'format=docx') =>
        business.admin.get(`/api/v1/reports/${code}/records/${id}?${query}`);
    const text = async (code: string, id: string) => {
        const response = await print(code, id);
        expect(response.status).toBe(200);
        return documentText(new Uint8Array(await response.arrayBuffer()));
    };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Cetak Amprah',
            [
                ...inventoryDuties,
                'core.vendor.manage',
                'core.purchase-receipt.manage',
                'core.inventory-transfer.manage',
                'core.report-layout.manage',
            ],
        );
        const created = async <T = Reference>(
            route: string,
            body: Record<string, unknown>,
        ) =>
            (
                await json<{ data: T }>(
                    await business.admin.post(route, body),
                    201,
                )
            ).data;
        const warehouse = await business.location('GUDANG', {
            transfer_mode: 'kirim_terima',
        });
        const pharmacy = await business.location('FARMASI');
        await business.location('TRANSIT', { is_transit: true });
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        const item = await business.item('PCT-500', {
            tracking_code_id: tracked.id,
        });
        const apbd = await created(`${inventoryApi}/funding-sources`, {
            code: 'APBD',
            name: 'Dana APBD',
        });
        const vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Cetak',
        });
        const receipt = await created<{ id: string; version: number }>(
            '/api/v1/purchasing/receipts',
            {
                vendor_id: vendor.id,
                location_id: warehouse.id,
                posting_date: '2026-11-01',
                lines: [
                    {
                        item_id: item.id,
                        unit_id: business.uom.id,
                        quantity: 40,
                        unit_cost: 1250,
                        batch_number: 'B-CETAK',
                        expiry_date: '2027-12-31',
                        funding_source_id: apbd.id,
                        budget_year: 2026,
                    },
                ],
            },
        );
        await json(
            await business.admin.post(
                `/api/v1/purchasing/receipts/${receipt.id}/post`,
                { version: receipt.version },
            ),
            200,
        );
        const drafted = await created<Order>(path, {
            from_location_id: warehouse.id,
            to_location_id: pharmacy.id,
            posting_date: '2026-11-10',
            description: 'Stok poli minggu ini',
            lines: [
                { item_id: item.id, unit_id: business.uom.id, quantity: 12 },
            ],
        });
        const step = async (current: Order, action: string, date?: string) =>
            (
                await json<{ data: Order }>(
                    await business.admin.post(
                        `${path}/${current.id}/${action}`,
                        {
                            version: current.version,
                            ...(date ? { posting_date: date } : {}),
                        },
                    ),
                    200,
                )
            ).data;
        order = await step(drafted, 'submit');
        const shipped = await step(order, 'ship', '2026-11-11');
        const received = await step(shipped, 'receive', '2026-11-12');
        const posting = (kind: 'shipment' | 'receipt') => {
            const found = received.postings.find(
                (entry) => entry.kind === kind,
            );
            if (!found) throw new Error(`Tidak ada ${kind}.`);
            return found;
        };
        shipmentId = posting('shipment').id;
        shipmentNumber = posting('shipment').number;
        receiptId = posting('receipt').id;
        const [user] = await pool.unsafe<{ name: string }[]>(
            `select u.name from users u join tenant_memberships m on m.user_id = u.id
             where m.id = $1`,
            [business.member.membershipId],
        );
        userName = user?.name ?? '';
        await json(
            await business.admin.put(`/api/v1/letterheads/${business.unitId}`, {
                display_name: 'Puskesmas Uji Cetak',
                signers: [
                    {
                        title: 'Kepala Puskesmas',
                        name: 'Pejabat Uji',
                        id_number: 'NIP 1980',
                    },
                ],
            }),
            200,
        );
    });

    test('the request shows both locations, the items requested, the requester, and the unit officials', async () => {
        const request = await text('core.transfer-order', order.id);
        expect(request).toContain('PERMINTAAN BARANG');
        expect(request).toContain(order.number);
        expect(request).toContain('Puskesmas Uji Cetak');
        expect(request).toContain('Lokasi FARMASI');
        expect(request).toContain('Lokasi GUDANG');
        expect(request).toContain('Barang PCT-500');
        expect(request).toContain('Stok poli minggu ini');
        expect(request).toContain(`( ${userName} )`);
        expect(request).toContain('Kepala Puskesmas');
        expect(request).toContain('Pejabat Uji');
        expect(request).toContain('NIP 1980');
        expect(request).not.toContain('{');
    });

    test('the shipment lists each batch with its expiry, funding, and value, with the sender named', async () => {
        const shipment = await text('core.transfer-shipment', shipmentId);
        expect(shipment).toContain('MUTASI BARANG');
        expect(shipment).toContain(shipmentNumber);
        expect(shipment).toContain(order.number);
        expect(shipment).toContain('B-CETAK');
        expect(shipment).toContain('31 Desember 2027');
        expect(shipment).toContain('Dana APBD');
        expect(shipment).toContain('15.000');
        expect(shipment).toContain('Lima Belas Ribu Rupiah');
        expect(shipment).toContain(`( ${userName} )`);
        expect(shipment).toContain('Lokasi TRANSIT');
        expect(shipment).not.toContain('{');
    });

    test('the receipt names who shipped and who received from transit', async () => {
        const receipt = await text('core.transfer-receipt', receiptId);
        expect(receipt).toContain('PENERIMAAN MUTASI BARANG');
        expect(receipt).toContain('B-CETAK');
        expect(receipt.split(`( ${userName} )`).length - 1).toBe(2);
        expect(receipt).not.toContain('{');
    });

    test('printing needs the transfer read permission, and another tenant cannot find the document', async () => {
        const clerk = await createMember(pool, business.tenantId, [
            'core.organization.manage',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            clerk.membershipId,
        );
        const session = browser();
        await session.login(clerk.email, clerk.password);
        expect(
            (
                await session.get(
                    `/api/v1/reports/core.transfer-shipment/records/${shipmentId}?format=docx`,
                )
            ).status,
        ).toBe(403);

        const tenantId = await createTenant(pool, 'Tenant lain cetak amprah');
        const stranger = await createMember(pool, tenantId, [
            'core.inventory-transfer.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, stranger.membershipId);
        const outside = browser();
        await outside.login(stranger.email, stranger.password);
        expect(
            (
                await outside.get(
                    `/api/v1/reports/core.transfer-order/records/${order.id}?format=docx`,
                )
            ).status,
        ).toBe(404);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the shipment PDF is A4 landscape and carries the batch',
        async () => {
            const response = await print(
                'core.transfer-shipment',
                shipmentId,
                'format=pdf',
            );
            expect(response.status).toBe(200);
            const pdf = await getDocumentProxy(
                new Uint8Array(await response.arrayBuffer()),
            );
            const page = await pdf.getPage(1);
            expect(page.view.map(Math.round)).toEqual([0, 0, 842, 595]);
            const { text: content } = await extractText(pdf, {
                mergePages: true,
            });
            expect(content).toContain('B-CETAK');
        },
    );
});
