import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type postgres from 'postgres';
import { z } from 'zod';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import {
    alreadyProcessed,
    onEvent,
    publishEvent,
    type EventEnvelope,
    type EventType,
} from '../../../src/platform/events/index.ts';

// Event antar module: baris outbox dan handler module penerima berada di transaksi penerbit. Butuh PostgreSQL yang
// sudah dimigrasi. Setiap test memakai nama event dan module sendiri, karena daftar handler milik proses.
describe.skipIf(!process.env.DB_HOST)('events between modules', () => {
    let pool: postgres.Sql;
    let connection: postgres.ReservedSql;
    let db: Database;
    const requestCorrelation = Bun.randomUUIDv7();
    const processedTable = 'uji_processed_events';

    beforeAll(async () => {
        pool = createPool(
            loadConfig({
                ...process.env,
                APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
            }),
        );
        connection = await pool.reserve();
        db = new Database(connection, undefined, requestCorrelation);
        // Tabel event yang sudah diproses milik module penerima, bentuknya sama dengan aset_processed_core_events.
        await db.execute(
            `create temporary table ${processedTable} (id uuid primary key, tenant_id uuid not null,
             event_id uuid not null, processed_at timestamp(0) not null, unique (tenant_id, event_id))`,
        );
    });
    afterAll(async () => {
        connection.release();
        await pool.end();
    });

    const unique = () => Bun.randomUUIDv7().slice(-12);
    const prescriptionIssued = (): EventType =>
        `uji-${unique()}.prescription.issued.v1`;

    async function install(
        tenantId: string,
        moduleId: string,
        status: 'installed' | 'disabled' | 'uninstalled' = 'installed',
    ) {
        await pool.unsafe(
            `insert into core_module_installations (tenant_id, module_id, version, status, installed_at, created_at, updated_at)
             values ($1, $2, '1.0.0', $3, now(), now(), now())`,
            [tenantId, moduleId, status],
        );
    }

    // Dibaca lewat koneksi lain, jadi hanya baris yang sudah di-commit yang terlihat.
    async function committedOutbox(eventId: string) {
        return z
            .array(
                z.object({
                    type: z.string(),
                    tenant_id: z.string(),
                    payload: z.unknown(),
                    correlation_id: z.string().nullable(),
                    legal_entity_id: z.string().nullable(),
                    org_unit_id: z.string().nullable(),
                    published_at: z.string().nullable(),
                }),
            )
            .parse(
                await pool.unsafe(
                    `select type, tenant_id, payload, correlation_id, legal_entity_id, org_unit_id, published_at
                     from outbox_events where id = $1`,
                    [eventId],
                ),
            );
    }

    async function outboxInside(eventId: string) {
        return db.rows(
            z.object({ id: z.string() }),
            'select id from outbox_events where id = $1',
            [eventId],
        );
    }

    test('the outbox row commits with the fact that published it', async () => {
        const tenantId = Bun.randomUUIDv7();
        const legalEntityId = Bun.randomUUIDv7();
        const orgUnitId = Bun.randomUUIDv7();
        const type = prescriptionIssued();
        const data = { prescription_id: Bun.randomUUIDv7(), lines: 2 };

        const { envelope, inside, outside } = await db.transaction(async () => {
            const envelope = await publishEvent(db, {
                type,
                tenantId,
                legalEntityId,
                orgUnitId,
                data,
            });
            return {
                envelope,
                inside: await outboxInside(envelope.id),
                outside: await committedOutbox(envelope.id),
            };
        });

        expect(inside).toHaveLength(1);
        expect(outside).toHaveLength(0);
        expect(envelope).toEqual({
            id: envelope.id,
            type,
            occurred_at: expect.stringMatching(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
            ),
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            org_unit_id: orgUnitId,
            correlation_id: requestCorrelation,
            data,
        });
        expect(await committedOutbox(envelope.id)).toEqual([
            {
                type,
                tenant_id: tenantId,
                payload: data,
                correlation_id: requestCorrelation,
                legal_entity_id: legalEntityId,
                org_unit_id: orgUnitId,
                published_at: null,
            },
        ]);
    });

    test('the outbox row leaves with a rolled back fact', async () => {
        let eventId = '';

        expect(
            db.transaction(async () => {
                eventId = (
                    await publishEvent(db, {
                        type: prescriptionIssued(),
                        tenantId: Bun.randomUUIDv7(),
                        data: {},
                    })
                ).id;
                throw new Error('resep batal disimpan');
            }),
        ).rejects.toThrow('resep batal disimpan');
        expect(eventId).not.toBe('');
        expect(await committedOutbox(eventId)).toHaveLength(0);
        expect(await outboxInside(eventId)).toHaveLength(0);
    });

    test('publishing outside a transaction is refused before anything is written', async () => {
        const tenantId = Bun.randomUUIDv7();
        const type = prescriptionIssued();

        expect(publishEvent(db, { type, tenantId, data: {} })).rejects.toThrow(
            'di dalam transaksi',
        );
        expect(
            await pool.unsafe(
                'select 1 from outbox_events where tenant_id = $1',
                [tenantId],
            ),
        ).toHaveLength(0);
    });

    test('an envelope without organization omits both fields, and an explicit correlation id wins', async () => {
        const origin = Bun.randomUUIDv7();
        const envelope = await db.transaction(() =>
            publishEvent(db, {
                type: prescriptionIssued(),
                tenantId: Bun.randomUUIDv7(),
                correlationId: origin,
                data: { status: 'dispensed' },
            }),
        );

        expect(Object.keys(envelope).sort()).toEqual([
            'correlation_id',
            'data',
            'id',
            'occurred_at',
            'tenant_id',
            'type',
        ]);
        expect(envelope.correlation_id).toBe(origin);
        expect(await committedOutbox(envelope.id)).toMatchObject([
            {
                correlation_id: origin,
                legal_entity_id: null,
                org_unit_id: null,
            },
        ]);
    });

    test('handlers run inside the publisher transaction only for modules installed for that tenant', async () => {
        const type = prescriptionIssued();
        const pharmacy = `uji-farmasi-${unique()}`;
        const disabled = `uji-gudang-${unique()}`;
        const uninstalled = `uji-kasir-${unique()}`;
        const absent = `uji-lab-${unique()}`;
        const tenantId = Bun.randomUUIDv7();
        const otherTenantId = Bun.randomUUIDv7();
        await install(tenantId, pharmacy);
        await install(tenantId, disabled, 'disabled');
        await install(tenantId, uninstalled, 'uninstalled');
        await install(otherTenantId, absent);
        const received: {
            moduleId: string;
            envelope: EventEnvelope;
            outboxVisible: number;
            sameConnection: boolean;
        }[] = [];
        for (const moduleId of [pharmacy, disabled, uninstalled, absent])
            onEvent(type, moduleId, async (handlerDb, envelope) => {
                received.push({
                    moduleId,
                    envelope,
                    outboxVisible: (
                        await handlerDb.rows(
                            z.object({ id: z.string() }),
                            'select id from outbox_events where id = $1',
                            [envelope.id],
                        )
                    ).length,
                    sameConnection: handlerDb === db,
                });
            });

        const published = await db.transaction(() =>
            publishEvent(db, { type, tenantId, data: { lines: 1 } }),
        );

        expect(received).toEqual([
            {
                moduleId: pharmacy,
                envelope: published,
                outboxVisible: 1,
                sameConnection: true,
            },
        ]);

        received.length = 0;
        await db.transaction(() =>
            publishEvent(db, {
                type,
                tenantId: Bun.randomUUIDv7(),
                data: {},
            }),
        );
        expect(received).toEqual([]);
    });

    test('a handler that throws rolls back the fact, its outbox row, and what earlier handlers wrote', async () => {
        const type = prescriptionIssued();
        const pharmacy = `uji-farmasi-${unique()}`;
        const billing = `uji-kasir-${unique()}`;
        const tenantId = Bun.randomUUIDv7();
        await install(tenantId, pharmacy);
        await install(tenantId, billing);
        let eventId = '';
        onEvent(type, pharmacy, async (handlerDb, envelope) => {
            eventId = envelope.id;
            expect(
                await alreadyProcessed(handlerDb, processedTable, envelope),
            ).toBe(false);
        });
        onEvent(type, billing, () =>
            Promise.reject(new Error('koneksi database kasir terputus')),
        );

        expect(
            db.transaction(() =>
                publishEvent(db, { type, tenantId, data: {} }),
            ),
        ).rejects.toThrow('koneksi database kasir terputus');
        expect(eventId).not.toBe('');
        expect(await committedOutbox(eventId)).toHaveLength(0);
        expect(
            await db.rows(
                z.object({ id: z.string() }),
                `select id from ${processedTable} where event_id = $1`,
                [eventId],
            ),
        ).toHaveLength(0);
    });

    test('a delivered event is recognised by its id within the tenant, across transactions', async () => {
        const envelope: EventEnvelope = {
            id: Bun.randomUUIDv7(),
            type: prescriptionIssued(),
            occurred_at: '2026-11-12T08:00:00Z',
            tenant_id: Bun.randomUUIDv7(),
            correlation_id: Bun.randomUUIDv7(),
            data: {},
        };
        const otherTenant = { ...envelope, tenant_id: Bun.randomUUIDv7() };

        const first = await db.transaction(async () => [
            await alreadyProcessed(db, processedTable, envelope),
            await alreadyProcessed(db, processedTable, envelope),
            await alreadyProcessed(db, processedTable, otherTenant),
        ]);
        const redelivered = await db.transaction(() =>
            alreadyProcessed(db, processedTable, envelope),
        );

        expect(first).toEqual([false, true, false]);
        expect(redelivered).toBe(true);
        expect(alreadyProcessed(db, processedTable, envelope)).rejects.toThrow(
            'di dalam transaksi',
        );
    });

    test('event names follow module.aggregate.action.vN', () => {
        expect(() =>
            onEvent('Farmasi.resep.terbit.v1', 'farmasi', () =>
                Promise.resolve(),
            ),
        ).toThrow('module.aggregate.action.vN');
        expect(
            db.transaction(() =>
                publishEvent(db, {
                    type: 'farmasi.resep.terbit.v0',
                    tenantId: Bun.randomUUIDv7(),
                    data: {},
                }),
            ),
        ).rejects.toThrow('module.aggregate.action.vN');
    });
});
