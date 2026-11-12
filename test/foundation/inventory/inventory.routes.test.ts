import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Business,
} from '../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../support/tenant-fixtures.ts';

type Setup = {
    picking_method: string;
    refuse_negative_stock: boolean;
    transfer_mode: string;
    costing_method: string;
    version: number;
};
type UnitSetup = {
    operating_unit: { id: string };
    picking_method: string | null;
    version: number | null;
};

// Parameter persediaan dan master pendukungnya: nilai bawaan yang lahir bersama legal entity, timpaan per operating
// unit, lokasi, satuan, alasan, kategori, profil pelacakan, dan hak aksesnya.
describe.skipIf(!process.env.DB_HOST)('inventory setup and masters', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let business: Business;
    afterAll(close);

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Master');
    });

    test('a new legal entity starts with FEFO, refused negative stock, direct transfers, FIFO cost, and four reasons of which unit use counts as consumption', async () => {
        const setup = await json<{ data: Setup }>(
            await business.admin.get(`${inventoryApi}/setup`),
            200,
        );
        expect(setup.data).toEqual({
            picking_method: 'fefo',
            refuse_negative_stock: true,
            transfer_mode: 'langsung',
            costing_method: 'fifo',
            version: 1,
        });
        const reasons = await json<{
            data: { code: string; consumption: boolean }[];
        }>(await business.admin.get(`${inventoryApi}/reason-codes`), 200);
        expect(
            reasons.data.map((reason) => [reason.code, reason.consumption]),
        ).toEqual([
            ['KEDALUWARSA', false],
            ['PEMAKAIAN', true],
            ['PEMUSNAHAN', false],
            ['SALDO-AWAL', false],
        ]);
    });

    test('setup changes need the current version, and an operating unit override is created once and cleared later', async () => {
        const body = {
            picking_method: 'fifo',
            refuse_negative_stock: false,
            transfer_mode: 'kirim_terima',
        };
        expect(
            (
                await business.admin.put(`${inventoryApi}/setup`, {
                    ...body,
                    version: 99,
                })
            ).status,
        ).toBe(409);
        const saved = await json<{ data: Setup }>(
            await business.admin.put(`${inventoryApi}/setup`, {
                ...body,
                version: 1,
            }),
            200,
        );
        expect(saved.data).toEqual({
            ...body,
            costing_method: 'fifo',
            version: 2,
        });
        const unitPath = `${inventoryApi}/setup/operating-units/${business.unitId}`;
        const created = await json<{ data: UnitSetup }>(
            await business.admin.put(unitPath, {
                picking_method: 'manual',
                version: null,
            }),
            200,
        );
        expect(created.data.picking_method).toBe('manual');
        expect(
            (
                await business.admin.put(unitPath, {
                    picking_method: 'fefo',
                    version: null,
                })
            ).status,
        ).toBe(409);
        await json(
            await business.admin.put(unitPath, {
                picking_method: null,
                version: created.data.version,
            }),
            200,
        );
        const units = await json<{ data: UnitSetup[] }>(
            await business.admin.get(`${inventoryApi}/setup/operating-units`),
            200,
        );
        expect(
            units.data.find(
                (unit) => unit.operating_unit.id === business.unitId,
            ),
        ).toMatchObject({ picking_method: null, version: 2 });
    });

    test('one save writes the setup and a new operating unit override together, and a stale unit version writes neither', async () => {
        const setupPath = `${inventoryApi}/setup`;
        const unitId = await business.operatingUnit('Unit Simpan Sekali');
        const current = (
            await json<{ data: Setup }>(
                await business.admin.get(setupPath),
                200,
            )
        ).data;
        const general = {
            picking_method: current.picking_method,
            refuse_negative_stock: current.refuse_negative_stock,
            transfer_mode: current.transfer_mode,
        };
        const saved = await json<{ data: Setup; units: UnitSetup[] }>(
            await business.admin.put(setupPath, {
                ...general,
                refuse_negative_stock: !current.refuse_negative_stock,
                version: current.version,
                units: [
                    {
                        operating_unit_id: unitId,
                        picking_method: 'manual',
                        version: null,
                    },
                ],
            }),
            200,
        );
        expect(saved.data).toMatchObject({
            refuse_negative_stock: !current.refuse_negative_stock,
            version: current.version + 1,
        });
        const override = { picking_method: 'manual', version: 1 };
        expect(
            saved.units.find((unit) => unit.operating_unit.id === unitId),
        ).toMatchObject(override);

        for (const version of [null, 99]) {
            const stale = await business.admin.put(setupPath, {
                ...general,
                version: saved.data.version,
                units: [
                    {
                        operating_unit_id: unitId,
                        picking_method: 'fifo',
                        version,
                    },
                ],
            });
            expect(stale.status).toBe(409);
        }
        const missing = crypto.randomUUID();
        expect(
            Object.keys(
                await refused(
                    await business.admin.put(setupPath, {
                        ...general,
                        version: saved.data.version,
                        units: [
                            {
                                operating_unit_id: missing,
                                picking_method: 'fifo',
                                version: null,
                            },
                        ],
                    }),
                ),
            ),
        ).toEqual([`units.${missing}.operating_unit_id`]);
        expect(
            (
                await json<{ data: Setup }>(
                    await business.admin.get(setupPath),
                    200,
                )
            ).data,
        ).toEqual(saved.data);
        const units = await json<{ data: UnitSetup[] }>(
            await business.admin.get(`${setupPath}/operating-units`),
            200,
        );
        expect(
            units.data.find((unit) => unit.operating_unit.id === unitId),
        ).toMatchObject(override);
    });

    test('a location needs an operating unit, a known picking method, and a code unique in the legal entity', async () => {
        const errors = await refused(
            await business.admin.post(`${inventoryApi}/locations`, {
                code: 'L1',
                name: 'Lokasi',
                operating_unit_id: Bun.randomUUIDv7(),
                picking_method: 'lifo',
            }),
        );
        expect(Object.keys(errors)).toEqual(['picking_method']);
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(`${inventoryApi}/locations`, {
                        code: 'L1',
                        name: 'Lokasi',
                        operating_unit_id: Bun.randomUUIDv7(),
                    }),
                ),
            ),
        ).toEqual(['operating_unit_id']);
        await business.location('l1');
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(`${inventoryApi}/locations`, {
                        code: 'L1',
                        name: 'Kembar',
                        operating_unit_id: business.unitId,
                    }),
                ),
            ),
        ).toEqual(['code']);
    });

    test('a unit code is stored upper case and unique, and a unit or reason in use cannot be deleted', async () => {
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(
                        `${inventoryApi}/units-of-measure`,
                        { code: 'tab', name: 'Tablet lagi' },
                    ),
                ),
            ),
        ).toEqual(['code']);
        await business.item('PAKAI-SATUAN');
        expect(
            Object.keys(
                await refused(
                    await business.admin.delete(
                        `${inventoryApi}/units-of-measure/${business.uom.id}`,
                        { version: 1 },
                    ),
                ),
            ),
        ).toEqual(['_form']);
        const reason = await json<{ data: { id: string; version: number } }>(
            await business.admin.post(`${inventoryApi}/reason-codes`, {
                code: 'rusak',
                name: 'Rusak',
            }),
            201,
        );
        const location = await business.location('ALASAN');
        await json(
            await business.admin.post(`${inventoryApi}/adjustments`, {
                direction: 'keluar',
                location_id: location.id,
                posting_date: '2026-11-01',
                reason_id: reason.data.id,
                lines: [],
            }),
            201,
        );
        expect(
            Object.keys(
                await refused(
                    await business.admin.delete(
                        `${inventoryApi}/reason-codes/${reason.data.id}`,
                        { version: reason.data.version },
                    ),
                ),
            ),
        ).toEqual(['_form']);
    });

    test('a category cannot sit under its own descendant, and a profile requiring expiry also requires batch', async () => {
        const create = async (code: string, parentId: string | null) =>
            (
                await json<{ data: { id: string; version: number } }>(
                    await business.admin.post(
                        `${inventoryApi}/item-categories`,
                        { code, name: code, parent_id: parentId },
                    ),
                    201,
                )
            ).data;
        const parent = await create('INDUK', null);
        const child = await create('ANAK', parent.id);
        expect(
            Object.keys(
                await refused(
                    await business.admin.patch(
                        `${inventoryApi}/item-categories/${parent.id}`,
                        {
                            code: 'INDUK',
                            name: 'INDUK',
                            parent_id: child.id,
                            version: parent.version,
                        },
                    ),
                ),
            ),
        ).toEqual(['parent_id']);
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(
                        `${inventoryApi}/item-tracking-codes`,
                        {
                            code: 'SALAH',
                            name: 'Salah',
                            expiry_required: true,
                        },
                    ),
                ),
            ),
        ).toEqual(['expiry_required']);
    });

    test('the setup shows the number format of every inventory document', async () => {
        const setup = await json<{
            numbering: {
                reference: { code: string };
                sequences: { format: string; status: string }[];
            }[];
            can_open_numbering: boolean;
        }>(await business.admin.get(`${inventoryApi}/setup`), 200);
        expect(
            setup.numbering.map((entry) => entry.reference.code).sort(),
        ).toEqual([
            'core.inventory-adjustment-number',
            'core.inventory-transfer-order-number',
            'core.inventory-transfer-receipt-number',
            'core.inventory-transfer-shipment-number',
        ]);
        expect(
            setup.numbering.find(
                (entry) =>
                    entry.reference.code === 'core.inventory-adjustment-number',
            )?.sequences,
        ).toEqual([
            expect.objectContaining({
                format: 'PNY-########',
                status: 'active',
            }),
        ]);
        expect(
            setup.numbering.every((entry) => entry.sequences.length === 1),
        ).toBe(true);
    });

    test('categories list as a tree, parents before children and siblings by code, across batches', async () => {
        const create = async (code: string, parentId: string | null) =>
            (
                await json<{ data: { id: string } }>(
                    await business.admin.post(
                        `${inventoryApi}/item-categories`,
                        { code, name: code, parent_id: parentId },
                    ),
                    201,
                )
            ).data.id;
        const drugs = await create('P-OBAT', null);
        await create('P-ALKES', null);
        const pain = await create('P-OBAT-NYERI', drugs);
        await create('P-OBAT-ANTIBIO', drugs);
        await create('P-OBAT-NYERI-TAB', pain);
        const rows: { code: string; depth: number; has_children: boolean }[] =
            [];
        let cursor: string | null = null;
        do {
            const batch: {
                data: typeof rows;
                next_cursor: string | null;
            } = await json(
                await business.admin.get(
                    `${inventoryApi}/item-categories?per_page=2${cursor ? `&cursor=${cursor}` : ''}`,
                ),
                200,
            );
            rows.push(...batch.data);
            cursor = batch.next_cursor;
        } while (cursor);
        expect(
            rows
                .filter((row) => row.code.startsWith('P-'))
                .map((row) => [row.code, row.depth, row.has_children]),
        ).toEqual([
            ['P-ALKES', 0, false],
            ['P-OBAT', 0, true],
            ['P-OBAT-ANTIBIO', 1, false],
            ['P-OBAT-NYERI', 1, true],
            ['P-OBAT-NYERI-TAB', 2, false],
        ]);
    });

    test('locations filter out transit ones, and the card offers the active operating units', async () => {
        await business.location('JALAN', { is_transit: true });
        await business.location('SIMPAN');
        const codes = async (query: string) =>
            (
                await json<{ data: { code: string }[] }>(
                    await business.admin.get(
                        `${inventoryApi}/locations?${query}`,
                    ),
                    200,
                )
            ).data.map((row) => row.code);
        expect(await codes('transit=false')).toContain('SIMPAN');
        expect(await codes('transit=false')).not.toContain('JALAN');
        expect(await codes('transit=true')).toEqual(['JALAN']);
        const units = await json<{
            data: { id: string; name: string; number: string | null }[];
        }>(
            await business.admin.get(
                `${inventoryApi}/locations/operating-units`,
            ),
            200,
        );
        expect(units.data.map((unit) => unit.id)).toContain(business.unitId);
        expect(units.data.every((unit) => unit.number !== null)).toBe(true);
    });

    test('each master is guarded by its own right', async () => {
        const viewer = await createMember(pool, business.tenantId, [
            'core.inventory-setup.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            viewer.membershipId,
        );
        const session = browser();
        await session.login(viewer.email, viewer.password);
        expect((await session.get(`${inventoryApi}/locations`)).status).toBe(
            200,
        );
        expect((await session.get(`${inventoryApi}/setup`)).status).toBe(200);
        expect(
            (
                await session.post(`${inventoryApi}/locations`, {
                    code: 'X',
                    name: 'X',
                    operating_unit_id: business.unitId,
                })
            ).status,
        ).toBe(403);
        expect((await session.get(`${inventoryApi}/items`)).status).toBe(403);
        expect((await session.get(`${inventoryApi}/adjustments`)).status).toBe(
            403,
        );
    });
});
