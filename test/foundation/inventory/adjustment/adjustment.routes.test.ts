import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Adjustment,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Document = Omit<Adjustment, 'lines'> & {
    posting_date: string;
    lines: { id: string; line_no: number; quantity: string }[];
};

// Dokumen penyesuaian stok: draf bernomor per legal entity, posting yang aman diulang, pembatalan posting, dan izin.
describe.skipIf(!process.env.DB_HOST)('inventory adjustments', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    const path = `${inventoryApi}/adjustments`;
    let business: Business;
    let location: { id: string };
    let item: { id: string };
    afterAll(close);

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Penyesuaian',
        );
        location = await business.location('GUDANG');
        item = await business.item('PNY-1');
    });

    const line = (quantity: number | string) => ({
        item_id: item.id,
        quantity,
        unit_cost: 1000,
    });

    async function ledgerRows(documentId: string) {
        const [counted] = await pool.unsafe<
            { originals: number; reversals: number }[]
        >(
            `select count(*) filter (where dibalik_dari is null)::int as originals,
                    count(*) filter (where dibalik_dari is not null)::int as reversals
             from gd_tr_kartu_gudang where tenant_id = $1 and sumber_id = $2`,
            [business.tenantId, documentId],
        );
        return counted;
    }

    test('a draft is numbered per legal entity, keeps its saved lines in place, and can be deleted while it is a draft', async () => {
        const draft = (await business.draft('masuk', location.id, [
            line(2),
            line(3),
        ])) as Document;
        expect(draft.number).toMatch(/^PNY-\d{8}$/);
        expect(draft.status).toBe('draf');
        const [kept, dropped] = draft.lines;
        const updated = await json<{ data: Document }>(
            await business.admin.patch(`${path}/${draft.id}`, {
                direction: 'masuk',
                location_id: location.id,
                posting_date: '2026-11-02',
                reason_id: business.reason('SALDO-AWAL'),
                lines: [{ ...line(5), id: kept?.id }, line(1.5)],
                version: draft.version,
            }),
            200,
        );
        expect(
            updated.data.lines.map((entry) => [entry.line_no, entry.quantity]),
        ).toEqual([
            [1, '5'],
            [2, '1.5'],
        ]);
        expect(updated.data.lines[0]?.id).toBe(kept?.id ?? '');
        const [archived] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from gd_tr_penyesuaian_detail where id = $1',
            [dropped?.id ?? ''],
        );
        expect(archived?.deleted).toBe(true);
        expect(
            (
                await business.admin.delete(`${path}/${draft.id}`, {
                    version: updated.data.version,
                })
            ).status,
        ).toBe(204);
        expect((await business.admin.get(`${path}/${draft.id}`)).status).toBe(
            404,
        );
    });

    test('a second legal entity gets the same first number and both documents persist', async () => {
        const other = await createBusiness(pool, browser, 'Klinik Uji Nomor');
        const otherLocation = await other.location('GUDANG');
        const otherItem = await other.item('PNY-1');
        const first = await other.draft('masuk', otherLocation.id, [
            { item_id: otherItem.id, quantity: 1, unit_cost: 1 },
        ]);
        const secondEntity = (
            await json<{ data: { id: string } }>(
                await other.admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Nomor Kedua',
                    company_code: `N${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        await json(
            await other.admin.put('/api/v1/workspace-context', {
                membership_id: other.member.membershipId,
                legal_entity_id: secondEntity,
            }),
            200,
        );
        const secondLocation = await other.location('GUDANG');
        const units = (
            await json<{ data: { id: string; code: string }[] }>(
                await other.admin.get(`${inventoryApi}/units-of-measure`),
                200,
            )
        ).data;
        expect(units).toEqual([]);
        expect(
            Object.keys(
                await refused(
                    await other.admin.post(`${inventoryApi}/items`, {
                        code: 'PNY-1',
                        name: 'Barang lintas legal entity',
                        base_unit_id: other.uom.id,
                    }),
                ),
            ),
        ).toEqual(['base_unit_id']);
        const unit = await json<{ data: { id: string } }>(
            await other.admin.post(`${inventoryApi}/units-of-measure`, {
                code: 'TAB',
                name: 'Tablet',
            }),
            201,
        );
        const secondItem = await other.item('PNY-1', {
            base_unit_id: unit.data.id,
        });
        const second = await json<{ data: Document }>(
            await other.admin.post(path, {
                direction: 'masuk',
                location_id: secondLocation.id,
                posting_date: '2026-11-01',
                reason_id: (
                    await json<{ data: { id: string; code: string }[] }>(
                        await other.admin.get(`${inventoryApi}/reason-codes`),
                        200,
                    )
                ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id,
                lines: [{ item_id: secondItem.id, quantity: 1, unit_cost: 1 }],
            }),
            201,
        );
        expect(second.data.number).toBe(first.number);
        expect(secondItem.id).not.toBe(otherItem.id);
    });

    test('posting again, in sequence or at the same time, is a no-op that writes no second row', async () => {
        const draft = await business.draft('masuk', location.id, [
            line(2),
            line(4),
        ]);
        const posted = await json<{ data: Document }>(
            await business.post(draft),
            200,
        );
        expect(posted.data.status).toBe('diposting');
        const again = await json<{ data: Document }>(
            await business.post(draft),
            200,
        );
        expect(again.data.status).toBe('diposting');
        expect(await ledgerRows(draft.id)).toEqual({
            originals: 2,
            reversals: 0,
        });

        const racing = await business.draft('masuk', location.id, [line(1)]);
        const responses = await Promise.all([
            business.post(racing),
            business.post(racing),
            business.post(racing),
        ]);
        expect(responses.map((response) => response.status)).toEqual([
            200, 200, 200,
        ]);
        expect(await ledgerRows(racing.id)).toEqual({
            originals: 1,
            reversals: 0,
        });
    });

    test('a posted document cannot be edited or deleted, and reversing it twice is a no-op', async () => {
        const posted = await business.posted('masuk', location.id, [line(3)]);
        expect(
            Object.keys(
                await refused(
                    await business.admin.patch(`${path}/${posted.id}`, {
                        direction: 'masuk',
                        location_id: location.id,
                        posting_date: '2026-11-01',
                        reason_id: business.reason('SALDO-AWAL'),
                        lines: [line(9)],
                        version: posted.version,
                    }),
                ),
            ),
        ).toEqual(['_form']);
        expect(
            Object.keys(
                await refused(
                    await business.admin.delete(`${path}/${posted.id}`, {
                        version: posted.version,
                    }),
                ),
            ),
        ).toEqual(['_form']);
        const reversed = await json<{ data: Document }>(
            await business.reverse(posted),
            200,
        );
        expect(reversed.data.status).toBe('dibatalkan');
        await json(await business.reverse(posted), 200);
        expect(await ledgerRows(posted.id)).toEqual({
            originals: 1,
            reversals: 1,
        });
        expect(
            Object.keys(await refused(await business.post(reversed.data))),
        ).toEqual(['_form']);
    });

    test('the entries of a document show the batches taken by its lines and the rows that reversed them', async () => {
        const profile = await business.trackingCode('ENTRI', {
            batch_required: true,
            expiry_required: true,
        });
        const tracked = await business.item('ENTRI-1', {
            tracking_code_id: profile.id,
        });
        const receive = (batch: string, expiry: string, quantity: number) => ({
            item_id: tracked.id,
            quantity,
            batch_number: batch,
            expiry_date: expiry,
            unit_cost: 100,
        });
        await business.posted('masuk', location.id, [
            receive('LAMA', '2027-12-31', 2),
            receive('DEKAT', '2027-01-31', 2),
        ]);
        const issued = await business.posted('keluar', location.id, [
            { item_id: tracked.id, quantity: 3 },
        ]);
        const shown = await json<{
            data: {
                lines: {
                    item: { batch_required: boolean; expiry_required: boolean };
                }[];
            };
        }>(await business.admin.get(`${path}/${issued.id}`), 200);
        expect(shown.data.lines[0]?.item).toMatchObject({
            batch_required: true,
            expiry_required: true,
        });
        type Entry = {
            batch: { batch_number: string; expiry_date: string } | null;
            quantity: string;
            cost_amount: string;
            reversed_entry_id: string | null;
        };
        const entries = async () =>
            (
                await json<{ data: Entry[] }>(
                    await business.admin.get(`${path}/${issued.id}/entries`),
                    200,
                )
            ).data.map((entry) => [
                entry.batch?.batch_number,
                entry.batch?.expiry_date,
                entry.quantity,
                entry.cost_amount,
                entry.reversed_entry_id === null,
            ]);
        expect(await entries()).toEqual([
            ['DEKAT', '2027-01-31', '-2', '-200', true],
            ['LAMA', '2027-12-31', '-1', '-100', true],
        ]);
        await json(await business.reverse(issued), 200);
        expect((await entries()).map((entry) => entry.slice(0, 3))).toEqual([
            ['DEKAT', '2027-01-31', '-2'],
            ['LAMA', '2027-12-31', '-1'],
            ['DEKAT', '2027-01-31', '2'],
            ['LAMA', '2027-12-31', '1'],
        ]);
    });

    test('the list filters by stock direction and status while keeping its own sort direction', async () => {
        const inbound = await business.draft('masuk', location.id, [line(1)]);
        const outbound = await business.draft('keluar', location.id, [
            { item_id: item.id, quantity: 1 },
        ]);
        const numbers = async (query: string) =>
            (
                await json<{ data: { number: string; direction: string }[] }>(
                    await business.admin.get(`${path}?${query}`),
                    200,
                )
            ).data.map((row) => [row.number, row.direction]);
        const outboundDrafts = await numbers(
            'stock_direction=keluar&status=draf&sort=number&direction=desc',
        );
        expect(outboundDrafts).toContainEqual([outbound.number, 'keluar']);
        expect(
            outboundDrafts.every(([, direction]) => direction === 'keluar'),
        ).toBe(true);
        expect(outboundDrafts.map(([number]) => number)).not.toContain(
            inbound.number,
        );
        const sorted = outboundDrafts.map(([number]) => number);
        expect(sorted).toEqual([...sorted].sort().reverse());
    });

    test('lines are checked against the direction of the document', async () => {
        const transit = await business.location('TRANSIT', {
            is_transit: true,
        });
        const batch = await business.posted('masuk', location.id, [
            { ...line(1), batch_number: 'cek', expiry_date: '2027-01-31' },
        ]);
        expect(batch.status).toBe('diposting');
        const create = (body: Record<string, unknown>) =>
            business.admin.post(path, {
                direction: 'masuk',
                location_id: location.id,
                posting_date: '2026-11-01',
                reason_id: business.reason('SALDO-AWAL'),
                lines: [line(1)],
                ...body,
            });
        expect(
            Object.keys(
                await refused(
                    await create({
                        location_id: transit.id,
                        lines: [
                            {
                                item_id: item.id,
                                quantity: '1.00001',
                                unit_cost: 1,
                            },
                            { item_id: item.id, quantity: 1 },
                            { ...line(1), expiry_date: '2027-01-31' },
                        ],
                    }),
                ),
            ).sort(),
        ).toEqual([
            'lines.0.quantity',
            'lines.1.unit_cost',
            'lines.2.batch_number',
            'location_id',
        ]);
        expect(
            Object.keys(
                await refused(
                    await create({
                        direction: 'keluar',
                        reason_id: business.reason('PEMUSNAHAN'),
                        lines: [
                            line(1),
                            {
                                item_id: item.id,
                                quantity: 1,
                                batch_number: 'X',
                            },
                            {
                                item_id: item.id,
                                quantity: 1,
                                batch_id: Bun.randomUUIDv7(),
                            },
                            {
                                item_id: 'bukan-barang',
                                quantity: 1,
                                batch_id: Bun.randomUUIDv7(),
                            },
                        ],
                    }),
                ),
            ).sort(),
        ).toEqual([
            'lines.0.unit_cost',
            'lines.1.batch_number',
            'lines.2.batch_id',
            'lines.3.batch_id',
            'lines.3.item_id',
        ]);
    });

    test('reading, editing drafts, posting, and reversing are separate rights, and another tenant sees nothing', async () => {
        const draft = await business.draft('masuk', location.id, [line(1)]);
        const reader = await createMember(pool, business.tenantId, [
            'core.inventory-adjustment.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const session = browser();
        await session.login(reader.email, reader.password);
        expect((await session.get(`${path}/${draft.id}`)).status).toBe(200);
        expect(
            (
                await session.post(path, {
                    direction: 'masuk',
                    location_id: location.id,
                    posting_date: '2026-11-01',
                    reason_id: business.reason('SALDO-AWAL'),
                    lines: [],
                })
            ).status,
        ).toBe(403);
        expect(
            (await session.post(`${path}/${draft.id}/post`, { version: 1 }))
                .status,
        ).toBe(403);
        expect(
            (await session.post(`${path}/${draft.id}/reverse`, { version: 1 }))
                .status,
        ).toBe(403);
        const stranger = await createBusiness(
            pool,
            browser,
            'Klinik Uji Asing',
        );
        expect((await stranger.admin.get(`${path}/${draft.id}`)).status).toBe(
            404,
        );
        expect((await stranger.post(draft)).status).toBe(404);
    });
});
