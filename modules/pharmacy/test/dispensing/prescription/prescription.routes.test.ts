import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { createMember } from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    json,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Row = {
    id: string;
    prescription_number: string;
    patient_name: string;
    medical_record_number: string;
    doctor_name: string | null;
    section_name: string;
    location: { id: string; code: string; name: string } | null;
    item_count: number;
};

// Antrean resep: lokasi yang melayani datang dari Lokasi layanan resep (section asal menimpa bawaan unit), resep tanpa
// lokasi tetap terlihat dan tersaring sendiri, dan resep legal entity lain tidak terlihat. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('prescription queue', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let item: { id: string; code: string; name: string };
    const poliUmum = {
        id: '00000000-0000-7000-8000-0000000000a1',
        name: 'Poli Umum',
    };
    const pusling = {
        id: '00000000-0000-7000-8000-0000000000a2',
        name: 'Pusling',
    };

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Antrean');
        item = await pharmacy.item('PCT-500');
    });

    const list = async (query = '') =>
        (
            await json<{ data: Row[] }>(
                await pharmacy.admin.get(`${api}/prescriptions${query}`),
                200,
            )
        ).data;
    const queueRow = async (number: string, query = '') =>
        (await list(query)).find((row) => row.prescription_number === number);

    test('a prescription is served by its section mapping, else by its unit default, and stays visible without either', async () => {
        const regular = await pharmacy.location('FARMASI');
        const mobile = await pharmacy.location('FAR-PUSLING');
        const unmapped = await pharmacy.issue([{ item, quantity: '10' }], {
            section: poliUmum,
        });
        const before = await queueRow(unmapped.data.prescription_number);
        expect(before?.location).toBeNull();
        expect(
            (await list('?location=none')).map(
                (row) => row.prescription_number,
            ),
        ).toContain(unmapped.data.prescription_number);
        await json(
            await pharmacy.admin.post(`${api}/service-locations`, {
                operating_unit_id: pharmacy.unitId,
                section_id: null,
                location_id: regular.id,
            }),
            201,
        );
        const fromPusling = await pharmacy.issue([{ item, quantity: '4' }], {
            section: pusling,
        });
        await json(
            await pharmacy.admin.post(`${api}/service-locations`, {
                operating_unit_id: pharmacy.unitId,
                section_id: pusling.id,
                location_id: mobile.id,
            }),
            201,
        );
        expect(
            (await queueRow(unmapped.data.prescription_number))?.location?.id,
        ).toBe(regular.id);
        const served = await queueRow(fromPusling.data.prescription_number);
        expect(served?.location?.id).toBe(mobile.id);
        expect(served).toMatchObject({
            patient_name: fromPusling.data.patient.name,
            medical_record_number:
                fromPusling.data.patient.medical_record_number,
            doctor_name: 'dr. Uji',
            section_name: 'Pusling',
            item_count: 1,
        });
        expect(
            (await list(`?location=${mobile.id}`)).map(
                (row) => row.prescription_number,
            ),
        ).toEqual([fromPusling.data.prescription_number]);
        expect(
            (await list('?location=none')).map(
                (row) => row.prescription_number,
            ),
        ).not.toContain(unmapped.data.prescription_number);
    });

    test('the queue is filtered by the date the prescription was issued and searched by patient', async () => {
        const issued = await pharmacy.issue([{ item, quantity: '1' }], {
            data: { issued_at: '2026-11-12T18:30:00Z' },
        });
        // 18.30 UTC tanggal 12 adalah 01.30 WIB tanggal 13, zona waktu bawaan legal entity.
        expect(
            (await list('?date=2026-11-13')).map(
                (row) => row.prescription_number,
            ),
        ).toContain(issued.data.prescription_number);
        expect(
            (await list('?date=2026-11-12')).map(
                (row) => row.prescription_number,
            ),
        ).not.toContain(issued.data.prescription_number);
        expect(
            (
                await list(`?q=${encodeURIComponent(issued.data.patient.name)}`)
            ).map((row) => row.prescription_number),
        ).toEqual([issued.data.prescription_number]);
    });

    test('a prescription shows its lines as sent, compound header included', async () => {
        const { data } = await pharmacy.issue([
            { item, quantity: '10', signa: '3x1' },
            { compound: 1, requested_quantity: '10', signa: '2x1' },
            { item, compound: 1, quantity: '0.5' },
        ]);
        const row = await queueRow(data.prescription_number);
        const shown = (
            await json<{
                data: {
                    prescription_number: string;
                    lines: {
                        item: { id: string } | null;
                        compound: number | null;
                        quantity: string | null;
                        requested_quantity: string | null;
                        usage_instruction: string | null;
                    }[];
                };
            }>(await pharmacy.admin.get(`${api}/prescriptions/${row?.id}`), 200)
        ).data;
        expect(
            shown.lines.map((line) => [
                line.item?.id ?? null,
                line.compound,
                line.quantity,
                line.requested_quantity,
            ]),
        ).toEqual([
            [item.id, null, '10', null],
            [null, 1, null, '10'],
            [item.id, 1, '0.5', null],
        ]);
    });

    test('prescriptions of another legal entity are neither listed nor opened, and unknown or malformed ids are 404', async () => {
        const second = (
            await json<{ data: { id: string } }>(
                await pharmacy.admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Farmasi Uji Kedua',
                    company_code: `F${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        const switchTo = (legalEntityId: string) =>
            pharmacy.admin.put('/api/v1/workspace-context', {
                membership_id: pharmacy.member.membershipId,
                legal_entity_id: legalEntityId,
            });
        await json(await switchTo(second), 200);
        const unit = (
            await json<{ data: { id: string; code: string; name: string } }>(
                await pharmacy.admin.post(
                    '/api/v1/inventory/units-of-measure',
                    {
                        code: 'TAB',
                        name: 'Tablet',
                    },
                ),
                201,
            )
        ).data;
        const foreignItem = (
            await json<{ data: { id: string; code: string; name: string } }>(
                await pharmacy.admin.post('/api/v1/inventory/items', {
                    code: 'LINTAS-1',
                    name: 'Obat lintas',
                    base_unit_id: unit.id,
                }),
                201,
            )
        ).data;
        const foreign = await pharmacy.issue(
            [{ item: foreignItem, quantity: '1' }],
            { legalEntityId: second },
        );
        const [queued] = await pharmacy.queued(foreign.prescriptionId);
        expect((await queueRow(foreign.data.prescription_number))?.id).toBe(
            queued?.id,
        );
        await json(await switchTo(pharmacy.legalEntityId), 200);
        expect(
            await queueRow(foreign.data.prescription_number),
        ).toBeUndefined();
        expect(
            (await pharmacy.admin.get(`${api}/prescriptions/${queued?.id}`))
                .status,
        ).toBe(404);
        expect(
            (await pharmacy.admin.get(`${api}/prescriptions/bukan-uuid`))
                .status,
        ).toBe(404);
        expect(
            (
                await pharmacy.admin.get(
                    `${api}/prescriptions/${Bun.randomUUIDv7()}`,
                )
            ).status,
        ).toBe(404);
    });

    test('the queue needs a pharmacy duty', async () => {
        const outsider = await createMember(pool, pharmacy.tenantId, [
            'core.inventory-item.inquire',
        ]);
        const session = browser();
        await session.login(outsider.email, outsider.password);
        expect((await session.get(`${api}/prescriptions`)).status).toBe(403);
    });
});
