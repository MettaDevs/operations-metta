import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '../../../../src/foundation/billing/index.ts';
import { Database } from '../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../src/platform/events/index.ts';
import { createBillingBusiness } from '../../../support/billing-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

type Stored = {
    kode: string;
    qty: string;
    nilai: string;
    status: string;
    live: boolean;
    komponen: string[];
};

// Penerima kasir untuk biaya pemeriksaan dan kunjungan, lewat publishEvent seperti penerbitnya: potret biaya mengganti
// baris terbuka pemeriksaan itu, baris yang sudah ditagih tidak disentuh, event yang sama hanya diproses sekali,
// kunjungan yang dibuka kembali keluar dari daftar sampai selesai lagi, dan kunjungan batal membuang baris terbukanya.
// Diperiksa dengan SQL langsung ke tabel kasir.
describe.skipIf(!process.env.DB_HOST)('billing charge events', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let component: string;
    const visitId = Bun.randomUUIDv7();
    const examinationId = Bun.randomUUIDv7();
    const lines = { injection: Bun.randomUUIDv7(), wound: Bun.randomUUIDv7() };

    async function publish(type: string, data: Record<string, unknown>) {
        const connection = await pool.reserve();
        const db = new Database(connection, undefined, Bun.randomUUIDv7());
        try {
            return await db.transaction(() =>
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

    const line = (id: string, code: string, quantity: string) => ({
        line_id: id,
        procedure_id: Bun.randomUUIDv7(),
        procedure_code: code,
        procedure_name: `Tindakan ${code}`,
        service_group_id: null,
        service_group_name: 'Tindakan Medis',
        service_group_order: 1,
        category_name: null,
        quantity,
        tariff: '25000',
        doctor_id: null,
        doctor_name: null,
        section_id: Bun.randomUUIDv7(),
        section_name: 'Poli Umum',
        date: '2026-11-13',
        components: [{ charge_component_id: component, value: '25000' }],
    });
    const charges = (rows: ReturnType<typeof line>[]) =>
        publish('healthcare.examination.charges-replaced.v1', {
            examination_id: examinationId,
            visit_id: visitId,
            registration_number: 'REG-1',
            lines: rows,
        });

    const complete = () =>
        publish('healthcare.visit.completed.v1', {
            visit_id: visitId,
            registration_number: 'REG-1',
            date: '2026-11-13',
            registered_at: '2026-11-13T01:00:00Z',
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: '000001',
                name: 'Pasien Uji',
            },
            patient_type: { id: Bun.randomUUIDv7(), name: 'UMUM' },
            guarantor: null,
            card_number: null,
            sections: [{ id: Bun.randomUUIDv7(), name: 'Poli Umum' }],
        });
    const visit = () =>
        pool.unsafe<{ status: string; pasien_nama: string }[]>(
            'select status, pasien_nama from kunjungan_kasir where tenant_id = $1 and kunjungan_id = $2',
            [tenantId, visitId],
        );

    async function stored(): Promise<Stored[]> {
        return [
            ...(await pool.unsafe<Stored[]>(
                `select r.jenis_biaya_kode as kode, trim_scale(r.qty)::text as qty, trim_scale(r.nilai)::text as nilai,
                        r.status, r.deleted_at is null as live,
                        coalesce((select array_agg(trim_scale(c.nilai)::text) from kunjungan_kasir_detail_komponen c
                                  where c.kunjungan_kasir_detail_id = r.id and c.deleted_at is null), '{}') as komponen
                 from kunjungan_kasir_detail r where r.tenant_id = $1 and r.kunjungan_id = $2
                 order by r.deleted_at nulls first, r.jenis_biaya_kode`,
                [tenantId, visitId],
            )),
        ];
    }

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Rincian Biaya',
            [],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        const [row] = await pool.unsafe<{ id: string }[]>(
            'select id from komponen_biaya where tenant_id = $1 limit 1',
            [tenantId],
        );
        component = row!.id;
    });

    test('a charge snapshot sent twice leaves one open set of lines with their components', async () => {
        const snapshot = [
            line(lines.injection, 'J-INJ', '2'),
            line(lines.wound, 'J-LUKA', '1'),
        ];
        await charges(snapshot);
        await charges(snapshot);
        expect(await stored()).toEqual([
            {
                kode: 'J-INJ',
                qty: '2',
                nilai: '25000',
                status: 'terbuka',
                live: true,
                komponen: ['25000'],
            },
            {
                kode: 'J-LUKA',
                qty: '1',
                nilai: '25000',
                status: 'terbuka',
                live: true,
                komponen: ['25000'],
            },
        ]);
    });

    test('a changed snapshot updates the line it still has and removes the one it dropped', async () => {
        await charges([line(lines.injection, 'J-INJ', '3')]);
        expect(
            (await stored()).map((row) => [row.kode, row.qty, row.live]),
        ).toEqual([
            ['J-INJ', '3', true],
            ['J-LUKA', '1', false],
        ]);
    });

    test('a billed line is not touched by a later snapshot', async () => {
        await pool.unsafe(
            "update kunjungan_kasir_detail set status = 'ditagih' where tenant_id = $1 and sumber_baris_id = $2",
            [tenantId, lines.injection],
        );
        await charges([]);
        expect(
            (await stored()).map((row) => [row.kode, row.qty, row.status]),
        ).toEqual([
            ['J-INJ', '3', 'ditagih'],
            ['J-LUKA', '1', 'terbuka'],
        ]);
        await pool.unsafe(
            "update kunjungan_kasir_detail set status = 'terbuka' where tenant_id = $1 and sumber_baris_id = $2",
            [tenantId, lines.injection],
        );
    });

    test('a reopened visit leaves the cashier list with its open lines kept until it is completed again', async () => {
        await charges([line(lines.wound, 'J-LUKA', '1')]);
        await complete();
        await publish('healthcare.visit.reopened.v1', {
            visit_id: visitId,
            registration_number: 'REG-1',
        });
        expect((await visit())[0]?.status).toBe('dibuka');
        expect(
            (await stored())
                .filter((row) => row.live)
                .map((row) => [row.kode, row.status]),
        ).toEqual([['J-LUKA', 'terbuka']]);
        await complete();
        expect((await visit())[0]?.status).toBe('selesai');
    });

    test('a completed visit enters the cashier list, and a cancelled one leaves it with its open lines', async () => {
        await charges([line(lines.wound, 'J-LUKA', '1')]);
        await complete();
        expect([...(await visit())]).toEqual([
            { status: 'selesai', pasien_nama: 'Pasien Uji' },
        ]);
        await publish('healthcare.visit.cancelled.v1', {
            visit_id: visitId,
            registration_number: 'REG-1',
        });
        expect((await visit())[0]?.status).toBe('batal');
        expect((await stored()).filter((row) => row.live)).toEqual([]);
    });
});
