import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type postgres from 'postgres';
import { NumberIssuer } from '../../../src/foundation/number-sequence/index.ts';
import type { Workspace } from '../../../src/platform/access/index.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { Database, createPool } from '../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../src/platform/http/index.ts';
import {
    createLegalEntity,
    createModule,
    createReference,
    createSequence,
} from '../../support/number-sequence-fixtures.ts';
import { createTenant } from '../../support/tenant-fixtures.ts';

// Perilaku penerbit nomor sebelum scope pindah ke dokumen. Test ini mengunci yang ada lebih dulu, supaya perubahan
// berikutnya terlihat sebagai perubahan test, bukan perubahan diam-diam. Butuh PostgreSQL yang sudah dimigrasi.
describe.skipIf(!process.env.DB_HOST)('number issuer', () => {
    let pool: postgres.Sql;
    let appId: string;

    beforeAll(async () => {
        pool = createPool(
            loadConfig({
                ...process.env,
                APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
            }),
        );
        appId = await createModule(pool);
    });
    afterAll(async () => {
        await pool.end();
    });

    async function withDb<T>(work: (db: Database) => Promise<T>): Promise<T> {
        const connection = await pool.reserve();
        try {
            return await work(new Database(connection, undefined, 'uji'));
        } finally {
            connection.release();
        }
    }

    function workspace(
        tenantId: string,
        legalEntityId: string | null = null,
    ): Workspace {
        return {
            tenantId,
            moduleId: appId,
            legalEntityId,
            orgUnitId: null,
        } as unknown as Workspace;
    }

    async function failure(work: Promise<unknown>): Promise<string> {
        try {
            await work;
        } catch (error) {
            if (error instanceof HttpFailure) return JSON.stringify(error.body);
            throw error;
        }
        throw new Error('Expected a failure.');
    }

    test('preallocated tenant sequence issues numbers in order from one block', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const sequenceId = await createSequence(
            pool,
            tenantId,
            reference.id,
            {},
        );
        const numbers = await withDb(async (db) => {
            const issuer = new NumberIssuer(db, workspace(tenantId));
            return [
                await issuer.issue(reference.code, 'a'),
                await issuer.issue(reference.code, 'b'),
            ];
        });
        expect(numbers).toEqual(['DOKU00001', 'DOKU00002']);
        const [allocation] = await pool.unsafe<Record<string, unknown>[]>(
            'select first_number::int as first, last_number::int as last, next_number::int as next from number_sequence_allocations where sequence_id=$1',
            [sequenceId],
        );
        expect(allocation).toEqual({ first: 1, last: 20, next: 3 });
        const [counter] = await pool.unsafe<Record<string, unknown>[]>(
            'select next_number::int as next, scope_key from number_sequence_counters where sequence_id=$1',
            [sequenceId],
        );
        expect(counter).toEqual({ next: 21, scope_key: 'tenant:' + tenantId });
        const events = await pool.unsafe<Record<string, unknown>[]>(
            'select event_type from number_sequence_audit_events where sequence_id=$1 order by occurred_at, event_type',
            [sequenceId],
        );
        expect(events.map((event) => String(event.event_type)).sort()).toEqual([
            'issued',
            'issued',
            'preallocated',
        ]);
    });

    test('the same idempotency key replays the same number', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const sequenceId = await createSequence(
            pool,
            tenantId,
            reference.id,
            {},
        );
        const [first, replay, next] = await withDb(async (db) => {
            const issuer = new NumberIssuer(db, workspace(tenantId));
            return [
                await issuer.issue(reference.code, 'kunci'),
                await issuer.issue(reference.code, 'kunci'),
                await issuer.issue(reference.code, 'lain'),
            ];
        });
        expect(first).toBe('DOKU00001');
        expect(replay).toBe('DOKU00001');
        expect(next).toBe('DOKU00002');
        const [count] = await pool.unsafe<Record<string, unknown>[]>(
            'select count(*)::int as count from number_sequence_issues where sequence_id=$1',
            [sequenceId],
        );
        expect(count?.count).toBe(2);
    });

    test('without preallocation a returned number is reused before the counter moves', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const sequenceId = await createSequence(pool, tenantId, reference.id, {
            preallocation_enabled: false,
        });
        const first = await withDb((db) =>
            new NumberIssuer(db, workspace(tenantId)).issue(
                reference.code,
                'a',
            ),
        );
        await pool.unsafe<Record<string, unknown>[]>(
            "insert into number_sequence_reusable_numbers (sequence_id, scope_key, period_key, numeric_value) values ($1, $2, 'all', 7)",
            [sequenceId, 'tenant:' + tenantId],
        );
        const [reused, next] = await withDb(async (db) => {
            const issuer = new NumberIssuer(db, workspace(tenantId));
            return [
                await issuer.issue(reference.code, 'b'),
                await issuer.issue(reference.code, 'c'),
            ];
        });
        expect([first, reused, next]).toEqual([
            'DOKU00001',
            'DOKU00007',
            'DOKU00002',
        ]);
    });

    test('a number already recorded as issued is skipped', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const sequenceId = await createSequence(
            pool,
            tenantId,
            reference.id,
            {},
        );
        await pool.unsafe<Record<string, unknown>[]>(
            "insert into number_sequence_issues (id, sequence_id, app_id, scope_key, period_key, formatted_value, idempotency_key, is_manual, issued_at) values ($1, $2, $3, $4, 'all', 'DOKU00001', 'manual', true, now())",
            [Bun.randomUUIDv7(), sequenceId, appId, 'tenant:' + tenantId],
        );
        const number = await withDb((db) =>
            new NumberIssuer(db, workspace(tenantId)).issue(
                reference.code,
                'a',
            ),
        );
        expect(number).toBe('DOKU00002');
    });

    test('a legal entity sequence takes its organization from the workspace', async () => {
        const tenantId = await createTenant(pool);
        const company = await createLegalEntity(pool, tenantId, 'PTA');
        const reference = await createReference(pool, appId, 'Dokumen uji');
        await createSequence(pool, tenantId, reference.id, {
            scope_type: 'legal_entity',
            segments: [
                { type: 'scope' },
                { type: 'constant', value: '-' },
                { type: 'number', length: 4 },
            ],
        });
        const number = await withDb((db) =>
            new NumberIssuer(db, workspace(tenantId, company)).issue(
                reference.code,
                'a',
            ),
        );
        expect(number).toBe('PTA-0001');
        expect(
            await failure(
                withDb((db) =>
                    new NumberIssuer(db, workspace(tenantId)).issue(
                        reference.code,
                        'b',
                    ),
                ),
            ),
        ).toContain('Context organisasi untuk sequence ini belum tersedia.');
    });

    test('a continuous sequence and a missing sequence are refused', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        expect(
            await failure(
                withDb((db) =>
                    new NumberIssuer(db, workspace(tenantId)).issue(
                        reference.code,
                        'a',
                    ),
                ),
            ),
        ).toContain('Sequence aktif tidak ditemukan');
        await createSequence(pool, tenantId, reference.id, {
            is_continuous: true,
        });
        expect(
            await failure(
                withDb((db) =>
                    new NumberIssuer(db, workspace(tenantId)).issue(
                        reference.code,
                        'a',
                    ),
                ),
            ),
        ).toContain('reserve lalu confirm');
    });

    test('the maximum stops issuing', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        await createSequence(pool, tenantId, reference.id, {
            minimum_number: 1,
            maximum_number: 2,
            preallocation_enabled: false,
        });
        const message = await failure(
            withDb(async (db) => {
                const issuer = new NumberIssuer(db, workspace(tenantId));
                await issuer.issue(reference.code, 'a');
                await issuer.issue(reference.code, 'b');
                await issuer.issue(reference.code, 'c');
            }),
        );
        expect(message).toContain('batas maksimum');
    });

    test('parallel issuers on separate connections never share a number', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        await createSequence(pool, tenantId, reference.id, {
            preallocation_quantity: 3,
        });
        const batches = await Promise.all(
            Array.from({ length: 6 }, (_, worker) =>
                withDb(async (db) => {
                    const issuer = new NumberIssuer(db, workspace(tenantId));
                    const numbers: string[] = [];
                    for (let index = 0; index < 8; index++)
                        numbers.push(
                            await issuer.issue(
                                reference.code,
                                `w${worker}-${index}`,
                            ),
                        );
                    return numbers;
                }),
            ),
        );
        const numbers = batches.flat();
        expect(new Set(numbers).size).toBe(48);
    });
});
