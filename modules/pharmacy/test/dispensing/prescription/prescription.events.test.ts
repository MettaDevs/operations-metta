import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from '../../../../../src/platform/database/index.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { receivePrescription } from '../../../src/dispensing/prescription/prescription.events.ts';
import {
    createPharmacy,
    issuedType,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

// Resep yang dikirim dokter masuk antrean farmasi lewat healthcare.prescription.issued.v1: hanya untuk tenant yang
// memasang module ini, sekali per event dan sekali per resep, dan isi yang tidak cocok dilewati tanpa membatalkan
// resep dokter. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'prescriptions arriving from healthcare',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);
        let pharmacy: Pharmacy;
        let amoxicillin: { id: string; code: string; name: string };

        beforeAll(async () => {
            pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Event');
            amoxicillin = await pharmacy.item('AMX-500');
        });

        const outbox = async (eventId: string) =>
            (
                await pool.unsafe<{ found: number }[]>(
                    'select count(*)::int as found from outbox_events where id = $1',
                    [eventId],
                )
            )[0]?.found;
        const processed = async (eventId: string) =>
            (
                await pool.unsafe<{ found: number }[]>(
                    'select count(*)::int as found from far_processed_events where event_id = $1',
                    [eventId],
                )
            )[0]?.found;

        test('a sent prescription is queued with every line, including the compound header and its components', async () => {
            const { envelope, prescriptionId } = await pharmacy.issue([
                { item: amoxicillin, quantity: '10', signa: '3x1' },
                { compound: 1, requested_quantity: '12', signa: '2x1' },
                { item: amoxicillin, compound: 1, quantity: '2.5' },
            ]);
            const [row] = await pharmacy.queued(prescriptionId);
            expect(row?.lines).toBe(3);
            expect(await processed(envelope.id)).toBe(1);
            const lines = await pool.unsafe<
                {
                    barang_id: string | null;
                    racikan_ke: number | null;
                    jumlah: string | null;
                    jumlah_permintaan: string | null;
                    signa: string | null;
                }[]
            >(
                `select barang_id, racikan_ke, trim_scale(jumlah)::text as jumlah,
                        trim_scale(jumlah_permintaan)::text as jumlah_permintaan, signa
                 from far_tr_resep_detail where resep_id = $1 order by urutan`,
                [row?.id ?? null],
            );
            expect([...lines]).toEqual([
                {
                    barang_id: amoxicillin.id,
                    racikan_ke: null,
                    jumlah: '10',
                    jumlah_permintaan: null,
                    signa: '3x1',
                },
                {
                    barang_id: null,
                    racikan_ke: 1,
                    jumlah: null,
                    jumlah_permintaan: '12',
                    signa: '2x1',
                },
                {
                    barang_id: amoxicillin.id,
                    racikan_ke: 1,
                    jumlah: '2.5',
                    jumlah_permintaan: null,
                    signa: null,
                },
            ]);
        });

        test('the same event delivered twice, or the same prescription in a second event, is queued once', async () => {
            const { envelope, prescriptionId, data } = await pharmacy.issue([
                { item: amoxicillin, quantity: '6' },
            ]);
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                await db.transaction(() => receivePrescription(db, envelope));
            } finally {
                connection.release();
            }
            const again = await pharmacy.issue([], {
                data: { ...data },
            });
            expect(await outbox(again.envelope.id)).toBe(1);
            const rows = await pharmacy.queued(prescriptionId);
            expect(rows.length).toBe(1);
            expect(rows[0]?.lines).toBe(1);
            expect(await processed(envelope.id)).toBe(1);
        });

        test('a payload that does not match the contract is skipped: the doctor still sends, the queue stays clean, and the event is not marked processed', async () => {
            const before = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from far_tr_resep where tenant_id = $1',
                [pharmacy.tenantId],
            );
            for (const broken of [
                { lines: [] },
                { patient: { id: 'bukan-uuid', name: 'Tanpa NRM' } },
                { issued_at: '13/11/2026 09:15' },
                {
                    lines: [
                        {
                            id: Bun.randomUUIDv7(),
                            order: 1,
                            item: amoxicillin,
                            compound: null,
                            quantity: 'sepuluh',
                            unit: null,
                            requested_quantity: null,
                            signa: null,
                            usage_instruction: null,
                            notes: null,
                        },
                    ],
                },
            ]) {
                const { envelope } = await pharmacy.issue(
                    [{ item: amoxicillin, quantity: '1' }],
                    { data: broken, validate: false },
                );
                expect(await outbox(envelope.id)).toBe(1);
                expect(await processed(envelope.id)).toBe(0);
            }
            const after = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from far_tr_resep where tenant_id = $1',
                [pharmacy.tenantId],
            );
            expect(after[0]?.found).toBe(before[0]?.found);
        });

        test('a prescription naming items the legal entity does not have is skipped', async () => {
            const other = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Event Lain',
            );
            const foreign = await other.item('LAIN-1');
            const { envelope, prescriptionId } = await pharmacy.issue([
                { item: foreign, quantity: '1' },
            ]);
            expect(await outbox(envelope.id)).toBe(1);
            expect(await pharmacy.queued(prescriptionId)).toEqual([]);
            expect(await processed(envelope.id)).toBe(0);
        });

        test('a tenant that has not installed the pharmacy module receives nothing', async () => {
            const clinic = await createPharmacy(
                pool,
                browser,
                'Klinik Tanpa Farmasi',
                { installed: false },
            );
            const item = await clinic.item('PCT-500');
            const { envelope, prescriptionId } = await clinic.issue([
                { item, quantity: '10' },
            ]);
            expect(envelope.type).toBe(issuedType);
            expect(await outbox(envelope.id)).toBe(1);
            expect(await clinic.queued(prescriptionId)).toEqual([]);
            expect(await processed(envelope.id)).toBe(0);
        });
    },
);
