import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import PizZip from 'pizzip';
import { extractText, getDocumentProxy } from 'unpdf';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
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

function documentText(docx: Uint8Array): string {
    const xml = new PizZip(docx).file('word/document.xml')?.asText() ?? '';
    return xml
        .replaceAll(/<\/w:p>/g, '\n')
        .replaceAll(/<[^>]+>/g, '')
        .replaceAll(/[ \t]+/g, ' ');
}

// Etiket obat dicetak mesin cetak Core dari dataset yang didaftarkan farmasi: satu etiket per obat, satu per racikan
// beserta komposisinya, batch dan kedaluwarsa dari penyerahan, kertas 96 × 200 mm dari layout bawaan. Core tidak
// membaca tabel farmasi; datanya lewat service penyerahan yang juga dipakai layar.
describe.skipIf(!process.env.DB_HOST)('drug label', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let prescriptionId: string;
    let prescriptionNumber: string;
    let patientName: string;
    const label = (id = prescriptionId, query = 'format=docx') =>
        `/api/v1/reports/pharmacy.drug-label/records/${id}?${query}`;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Etiket', {
            duties: [...pharmacyDuties, 'pharmacy.dispensing.manage'],
        });
        const farmasi = await pharmacy.location('FARMASI');
        await json(
            await pharmacy.admin.post(`${api}/service-locations`, {
                operating_unit_id: pharmacy.unitId,
                section_id: null,
                location_id: farmasi.id,
            }),
            201,
        );
        const reasonId =
            (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        const tracked = await pharmacy.created(
            `${inventoryApi}/item-tracking-codes`,
            {
                code: 'OBAT',
                name: 'Obat berbatch',
                batch_required: true,
                expiry_required: true,
            },
        );
        const paracetamol = await pharmacy.item('PCT-500', {
            tracking_code_id: tracked.id,
        });
        const amoxicillin = await pharmacy.item('AMX-500', {
            tracking_code_id: tracked.id,
        });
        const draft = (
            await json<{ data: { id: string; version: number } }>(
                await pharmacy.admin.post(`${inventoryApi}/adjustments`, {
                    direction: 'masuk',
                    location_id: farmasi.id,
                    posting_date: '2026-11-01',
                    reason_id: reasonId,
                    lines: [paracetamol, amoxicillin].map((item) => ({
                        item_id: item.id,
                        quantity: 50,
                        unit_cost: 1000,
                        batch_number: `B-${item.code}`,
                        expiry_date: '2027-12-31',
                    })),
                }),
                201,
            )
        ).data;
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
        const issued = await pharmacy.issue([
            { item: paracetamol, quantity: '10', signa: '3 x 1' },
            { compound: 1, requested_quantity: '10', signa: '2 x 1' },
            { item: amoxicillin, quantity: '5', compound: 1 },
        ]);
        patientName = issued.data.patient.name;
        const [queued] = await pharmacy.queued(issued.prescriptionId);
        if (!queued) throw new Error('Resep tidak masuk antrean.');
        prescriptionId = queued.id;
        prescriptionNumber = queued.nomor_resep;
        await json(
            await pharmacy.admin.post(
                `${api}/prescriptions/${prescriptionId}/dispensing/prepare`,
            ),
            200,
        );
    });

    test('a prepared prescription prints one label per drug and per compound, with the batch taken and the patient', async () => {
        const response = await pharmacy.admin.get(label());
        expect(response.status).toBe(200);
        const text = documentText(new Uint8Array(await response.arrayBuffer()));
        expect(text).toContain(`No. ${prescriptionNumber}`);
        expect(text.split(patientName).length - 1).toBe(2);
        expect(text).toContain('3 x 1');
        expect(text).toContain('2 x 1');
        expect(text).toContain('Batch B-PCT-500');
        expect(text).toContain('ED 31 Desember 2027');
        expect(text).toContain('- Obat AMX-500');
        expect(text).not.toContain('{');
    });

    test('the label needs the prescription read permission, and a tenant without pharmacy installed has no label', async () => {
        const clerk = await createMember(pool, pharmacy.tenantId, [
            'core.organization.manage',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            clerk.membershipId,
        );
        const session = browser();
        await session.login(clerk.email, clerk.password);
        expect((await session.get(label())).status).toBe(403);

        const tenantId = await createTenant(pool, 'Tanpa farmasi');
        const stranger = await createMember(pool, tenantId, [
            'pharmacy.dispensing.inquire',
        ]);
        await grantAllOrganizations(pool, tenantId, stranger.membershipId);
        const outside = browser();
        await outside.login(stranger.email, stranger.password);
        expect((await outside.get(label())).status).toBe(404);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the PDF is on 96 x 200 mm label paper and shows the signa and batch',
        async () => {
            const response = await pharmacy.admin.get(
                label(prescriptionId, 'format=pdf'),
            );
            expect(response.status).toBe(200);
            const pdf = await getDocumentProxy(
                new Uint8Array(await response.arrayBuffer()),
            );
            const page = await pdf.getPage(1);
            expect(page.view.map(Math.round)).toEqual([0, 0, 272, 567]);
            const { text } = await extractText(pdf, { mergePages: true });
            expect(text).toContain('3 x 1');
            expect(text).toContain('B-PCT-500');
        },
    );
});
