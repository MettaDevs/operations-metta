import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '../../../../src/foundation/billing/index.ts';
import { Database } from '../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../src/platform/events/index.ts';
import {
    createBillingBusiness,
    json,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';

type Listed = {
    data: { id: string; patient_name: string; paid: boolean }[];
    counts: { unpaid: number; paid: number; total: number };
    from: string;
    to: string;
};
type Shown = {
    data: {
        visit: { registration_number: string; patient_name: string };
        charges: { name: string; quantity: string; value: string }[];
        totals: { value: string; original_value: string };
    };
};

// Daftar Pembayaran dan Form Pembayaran baca-saja di atas kunjungan dan biaya yang dikirim layanan kesehatan lewat
// event: kunjungan selesai di rentang tanggal tampil belum dibayar, kunjungan batal tidak, dan Nilai form memakai
// rumus kasir Kuta atas baris biaya terbuka.
describe.skipIf(!process.env.DB_HOST)('billing visits', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let cashier: Browser;
    const visits = { paid: Bun.randomUUIDv7(), cancelled: Bun.randomUUIDv7() };

    async function publish(type: string, data: Record<string, unknown>) {
        const connection = await pool.reserve();
        const db = new Database(connection, undefined, Bun.randomUUIDv7());
        try {
            await db.transaction(() =>
                publishEvent(db, {
                    type: type as `${string}.${string}.${string}.v1`,
                    tenantId,
                    legalEntityId,
                    data: data as Record<string, string>,
                }),
            );
        } finally {
            connection.release();
        }
    }

    const completed = (visitId: string, name: string, date: string) =>
        publish('healthcare.visit.completed.v1', {
            visit_id: visitId,
            registration_number: `REG-${name}`,
            date,
            registered_at: `${date}T01:00:00Z`,
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: name,
                name: `Pasien ${name}`,
            },
            patient_type: { id: Bun.randomUUIDv7(), name: 'UMUM' },
            guarantor: null,
            card_number: null,
            sections: [{ id: Bun.randomUUIDv7(), name: 'Poli Umum' }],
        });

    const line = (code: string, quantity: string, tariff: string) => ({
        line_id: Bun.randomUUIDv7(),
        procedure_id: Bun.randomUUIDv7(),
        procedure_code: code,
        procedure_name: `Tindakan ${code}`,
        service_group_id: null,
        service_group_name: 'Tindakan Medis',
        service_group_order: 1,
        category_name: null,
        quantity,
        tariff,
        doctor_id: null,
        doctor_name: 'dr. Uji',
        section_id: Bun.randomUUIDv7(),
        section_name: 'Poli Umum',
        date: '2026-11-13',
        components: [],
    });

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Daftar Pembayaran',
            ['core.payment.inquire'],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        cashier = business.admin;
        await completed(visits.paid, 'A', '2026-11-13');
        await completed(visits.cancelled, 'B', '2026-11-13');
        await completed(Bun.randomUUIDv7(), 'C', '2026-11-12');
        await publish('healthcare.visit.cancelled.v1', {
            visit_id: visits.cancelled,
            registration_number: 'REG-B',
        });
        await publish('healthcare.examination.charges-replaced.v1', {
            examination_id: Bun.randomUUIDv7(),
            visit_id: visits.paid,
            registration_number: 'REG-A',
            lines: [line('J-1', '2', '80000'), line('J-2', '1', '15000')],
        });
    });

    test('the list shows completed visits of the date range as unpaid, without cancelled ones', async () => {
        const listed = await json<Listed>(
            await cashier.get(
                '/api/v1/billing/visits?from=2026-11-13&to=2026-11-13',
            ),
            200,
        );
        expect(listed.data.map((row) => [row.patient_name, row.paid])).toEqual([
            ['Pasien A', false],
        ]);
        expect(listed.counts).toEqual({ unpaid: 1, paid: 0, total: 1 });
        const wider = await json<Listed>(
            await cashier.get(
                '/api/v1/billing/visits?from=2026-11-12&to=2026-11-13&q=pasien',
            ),
            200,
        );
        expect(wider.data.map((row) => row.patient_name).sort()).toEqual([
            'Pasien A',
            'Pasien C',
        ]);
    });

    test('the payment form shows the open charges and the Kuta invoice value', async () => {
        const shown = await json<Shown>(
            await cashier.get(`/api/v1/billing/visits/${visits.paid}`),
            200,
        );
        expect(shown.data.visit.registration_number).toBe('REG-A');
        expect(
            shown.data.charges.map((charge) => [
                charge.name,
                charge.quantity,
                charge.value,
            ]),
        ).toEqual([
            ['Tindakan J-1', '2', '80000'],
            ['Tindakan J-2', '1', '15000'],
        ]);
        expect(shown.data.totals).toEqual({
            value: '175000',
            original_value: '175000',
        });
        expect(
            (await cashier.get(`/api/v1/billing/visits/${visits.cancelled}`))
                .status,
        ).toBe(404);
    });
});
