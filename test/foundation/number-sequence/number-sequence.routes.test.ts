import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createLegalEntity,
    createModule,
    createOperatingUnit,
    createReference,
} from '../../support/number-sequence-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
} from '../../support/tenant-fixtures.ts';

type Sequence = {
    id: string;
    scope_type: string;
    scope_value_name: string | null;
    format: string;
    status: string;
    is_continuous: boolean;
    next_number: number;
    used: boolean;
    version: number;
};

const path = '/api/v1/number-sequences';
const settings = {
    status: 'active',
    is_continuous: false,
    allow_automatic: true,
    allow_manual: false,
    allow_lower_number: false,
    allow_higher_number: false,
    reset_period: 'never',
    preallocation_enabled: true,
    preallocation_quantity: 20,
    minimum_number: 1,
    maximum_number: 999999,
};

// Layar Nomor dokumen lewat HTTP: izin baca dan ubah, daftar dengan saringan, kartu, scope yang tetap, Status list,
// dan Manual cleanup. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('number sequence screen', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let manager: Browser;
    let reader: Browser;
    let outsider: Browser;
    let unitA: string;
    let unitB: string;
    let reference: { id: string; code: string };
    afterAll(close);

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Nomor');
        await createLegalEntity(pool, tenantId, 'KUN');
        unitA = await createOperatingUnit(pool, tenantId, 'Puskesmas A');
        unitB = await createOperatingUnit(pool, tenantId, 'Puskesmas B');
        const appId = await createModule(pool);
        await entitle(pool, tenantId, appId);
        reference = await createReference(pool, appId, 'Nomor rekam medis', [
            'operating_unit',
        ]);
        const managing = await createMember(pool, tenantId, [
            'core.number-sequence.manage',
        ]);
        manager = browser();
        await manager.login(managing.email, managing.password);
        const reading = await createMember(pool, tenantId, [
            'core.number-sequence.inquire',
        ]);
        reader = browser();
        await reader.login(reading.email, reading.password);
        const plain = await createMember(pool, tenantId, [
            'core.organization.inquire',
        ]);
        outsider = browser();
        await outsider.login(plain.email, plain.password);
    });

    async function create(unit: string, prefix: string): Promise<Sequence> {
        const response = await manager.post(path, {
            ...settings,
            reference_id: reference.id,
            scope_type: 'operating_unit',
            operating_unit_id: unit,
            segments: [
                { type: 'constant', value: prefix },
                { type: 'number', length: 6 },
            ],
        });
        expect(response.status).toBe(201);
        return ((await response.json()) as { data: Sequence }).data;
    }

    test('two units get their own sequence, listed and filtered by reference', async () => {
        const first = await create(unitA, 'A-');
        const second = await create(unitB, 'B-');
        expect([first.format, second.format]).toEqual(['A-######', 'B-######']);
        expect(first.scope_value_name).toBe('Puskesmas A');
        const response = await reader.get(
            `${path}?reference_id=${reference.id}&sort=scope_value_name`,
        );
        expect(response.status).toBe(200);
        const { data } = (await response.json()) as { data: Sequence[] };
        expect(data.map((row) => row.scope_value_name)).toEqual([
            'Puskesmas A',
            'Puskesmas B',
        ]);
        const metadata = await reader.get(`${path}/metadata`);
        expect(
            ((await metadata.json()) as { data: { canManage: boolean } }).data
                .canManage,
        ).toBe(false);
    });

    test('the list shows Smallest, Largest, and Next, and the card shows the block in use', async () => {
        const unit = await createOperatingUnit(
            pool,
            tenantId,
            'Puskesmas D',
            'PKD',
        );
        const response = await manager.post(path, {
            ...settings,
            reference_id: reference.id,
            scope_type: 'operating_unit',
            operating_unit_id: unit,
            segments: [
                { type: 'scope' },
                { type: 'constant', value: '-' },
                { type: 'number', length: 6 },
            ],
        });
        expect(response.status).toBe(201);
        const created = (
            (await response.json()) as {
                data: Sequence & {
                    allocated_next: number | null;
                    allocated_last: number | null;
                };
            }
        ).data;
        expect(created.format).toBe('PKD-######');
        expect(created.next_number).toBe(1);
        expect(created.allocated_next).toBeNull();
        await pool.unsafe(
            "insert into number_sequence_counters (id, sequence_id, scope_key, period_key, next_number, created_at, updated_at) values ($1, $2, $3, 'all', 21, now(), now())",
            [Bun.randomUUIDv7(), created.id, 'operating_unit:' + unit],
        );
        await pool.unsafe(
            "insert into number_sequence_allocations (id, sequence_id, scope_key, period_key, first_number, last_number, next_number, created_at, updated_at) values ($1, $2, $3, 'all', 1, 20, 4, now(), now())",
            [Bun.randomUUIDv7(), created.id, 'operating_unit:' + unit],
        );
        const list = await reader.get(`${path}?reference_id=${reference.id}`);
        const row = (
            (await list.json()) as {
                data: (Sequence & {
                    minimum_number: number;
                    maximum_number: number;
                })[];
            }
        ).data.find((item) => item.id === created.id);
        expect(row).toEqual(
            expect.objectContaining({
                minimum_number: 1,
                maximum_number: 999999,
                next_number: 21,
                format: 'PKD-######',
            }),
        );
        const card = await reader.get(`${path}/${created.id}`);
        expect(
            (
                (await card.json()) as {
                    data: { allocated_next: number; allocated_last: number };
                }
            ).data,
        ).toEqual(
            expect.objectContaining({ allocated_next: 4, allocated_last: 20 }),
        );
    });

    test('reading needs the inquire duty and changing needs the manage duty', async () => {
        expect((await outsider.get(path)).status).toBe(403);
        const response = await reader.post(path, {
            ...settings,
            reference_id: reference.id,
            scope_type: 'operating_unit',
            operating_unit_id: unitA,
            segments: [{ type: 'number', length: 6 }],
        });
        expect(response.status).toBe(403);
    });

    test('scope is fixed, Continuous and status can change, and the status list can be cleaned up', async () => {
        const unit = await createOperatingUnit(pool, tenantId, 'Puskesmas C');
        const sequence = await create(unit, 'C-');
        const patch = (changes: Record<string, unknown>, version: number) =>
            manager.patch(`${path}/${sequence.id}`, {
                ...settings,
                segments: [
                    { type: 'constant', value: 'C-' },
                    { type: 'number', length: 6 },
                ],
                version,
                ...changes,
            });
        const moved = await patch(
            { operating_unit_id: unitA },
            sequence.version,
        );
        expect(moved.status).toBe(422);
        expect(await moved.text()).toContain(
            'Scope dan nilainya tidak dapat diubah',
        );
        const continuous = await patch(
            { is_continuous: true },
            sequence.version,
        );
        expect(continuous.status).toBe(200);
        const updated = ((await continuous.json()) as { data: Sequence }).data;
        expect(updated.is_continuous).toBe(true);

        const reservationId = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into number_sequence_reservations (id, sequence_id, app_id, scope_key, numeric_value, formatted_value, idempotency_key, status, expires_at, created_at, updated_at) select $1, $2, r.app_id, $3, 1, 'C-000001', 'form-1', 'reserved', now() at time zone 'utc' - interval '1 minute', now(), now() from app_number_sequence_references r where r.id = $4",
            [
                reservationId,
                sequence.id,
                'operating_unit:' + unit,
                reference.id,
            ],
        );
        const list = await reader.get(`${path}/${sequence.id}/status-list`);
        const rows = (
            (await list.json()) as {
                data: { number: string; expired: boolean }[];
            }
        ).data;
        expect(rows).toEqual([
            expect.objectContaining({ number: 'C-000001', expired: true }),
        ]);
        expect(
            (await reader.post(`${path}/${sequence.id}/cleanup`)).status,
        ).toBe(403);
        const cleaned = await manager.post(`${path}/${sequence.id}/cleanup`);
        expect(cleaned.status).toBe(200);
        expect(
            ((await cleaned.json()) as { data: { released: number } }).data
                .released,
        ).toBe(1);
        const after = await reader.get(`${path}/${sequence.id}/status-list`);
        expect(((await after.json()) as { data: unknown[] }).data).toEqual([]);
    });
});
