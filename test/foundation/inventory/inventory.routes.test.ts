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

    test('a new legal entity starts with FEFO, refused negative stock, direct transfers, FIFO cost, and four reasons', async () => {
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
        const reasons = await json<{ data: { code: string }[] }>(
            await business.admin.get(`${inventoryApi}/reason-codes`),
            200,
        );
        expect(reasons.data.map((reason) => reason.code)).toEqual([
            'KEDALUWARSA',
            'PEMAKAIAN',
            'PEMUSNAHAN',
            'SALDO-AWAL',
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
