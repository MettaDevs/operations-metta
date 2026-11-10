import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type postgres from 'postgres';
import {
    NumberIssuer,
    type NumberRequest,
    NumberSequences,
} from '../../../src/foundation/number-sequence/index.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { Database, createPool } from '../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../src/platform/http/index.ts';
import {
    createFiscalCalendar,
    createLegalEntity,
    createModule,
    createOperatingUnit,
    createReference,
    createSequence,
} from '../../support/number-sequence-fixtures.ts';
import { createTenant } from '../../support/tenant-fixtures.ts';

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

// Penerbit nomor dan pengaturannya. Scope dipilih dari organisasi dan tanggal dokumen, nomor diambil di dalam
// transaksi dokumen, dan penjaga nomor kembar yang ada tetap berlaku. Butuh PostgreSQL yang sudah dimigrasi.
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

    // Satu dokumen: nomor diambil di dalam transaksinya, seperti pemanggil sungguhan.
    function issue(
        tenantId: string,
        request: Omit<NumberRequest, 'documentDate'> & {
            documentDate?: string;
        },
    ): Promise<string> {
        return withDb((db) =>
            db.transaction(() =>
                new NumberIssuer(db, { tenantId, moduleId: appId }).issue({
                    documentDate: '2026-11-10',
                    ...request,
                }),
            ),
        );
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

    function thrown(work: Promise<unknown>): Promise<string> {
        return work.then(
            () => 'tidak gagal',
            (error: unknown) => String(error),
        );
    }

    async function rows(query: string, parameters: (string | null)[] = []) {
        return pool.unsafe<Record<string, unknown>[]>(query, parameters);
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
        const first = await issue(tenantId, {
            reference: reference.code,
            key: 'a',
        });
        const second = await issue(tenantId, {
            reference: reference.code,
            key: 'b',
        });
        expect([first, second]).toEqual(['DOKU00001', 'DOKU00002']);
        const [allocation] = await rows(
            'select first_number::int as first, last_number::int as last, next_number::int as next from number_sequence_allocations where sequence_id=$1',
            [sequenceId],
        );
        expect(allocation).toEqual({ first: 1, last: 20, next: 3 });
        const [counter] = await rows(
            'select next_number::int as next, scope_key from number_sequence_counters where sequence_id=$1',
            [sequenceId],
        );
        expect(counter).toEqual({ next: 21, scope_key: 'tenant:' + tenantId });
        const events = await rows(
            'select event_type from number_sequence_audit_events where sequence_id=$1',
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
        const request = { reference: reference.code, key: 'kunci' };
        expect(await issue(tenantId, request)).toBe('DOKU00001');
        expect(await issue(tenantId, request)).toBe('DOKU00001');
        expect(
            await issue(tenantId, { reference: reference.code, key: 'lain' }),
        ).toBe('DOKU00002');
        const [count] = await rows(
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
        const first = await issue(tenantId, {
            reference: reference.code,
            key: 'a',
        });
        await rows(
            "insert into number_sequence_reusable_numbers (sequence_id, scope_key, period_key, numeric_value) values ($1, $2, 'all', 7)",
            [sequenceId, 'tenant:' + tenantId],
        );
        const reused = await issue(tenantId, {
            reference: reference.code,
            key: 'b',
        });
        const next = await issue(tenantId, {
            reference: reference.code,
            key: 'c',
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
        await rows(
            "insert into number_sequence_issues (id, sequence_id, app_id, scope_key, period_key, formatted_value, idempotency_key, is_manual, issued_at) values ($1, $2, $3, $4, 'all', 'DOKU00001', 'manual', true, now())",
            [Bun.randomUUIDv7(), sequenceId, appId, 'tenant:' + tenantId],
        );
        expect(
            await issue(tenantId, { reference: reference.code, key: 'a' }),
        ).toBe('DOKU00002');
    });

    test('the maximum stops issuing', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        await createSequence(pool, tenantId, reference.id, {
            minimum_number: 1,
            maximum_number: 2,
            preallocation_enabled: false,
        });
        await issue(tenantId, { reference: reference.code, key: 'a' });
        await issue(tenantId, { reference: reference.code, key: 'b' });
        expect(
            await failure(
                issue(tenantId, { reference: reference.code, key: 'c' }),
            ),
        ).toContain('batas maksimum');
    });

    test('issuing outside the document transaction is a programming error', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        await createSequence(pool, tenantId, reference.id, {});
        expect(
            await thrown(
                withDb((db) =>
                    new NumberIssuer(db, { tenantId, moduleId: appId }).issue({
                        reference: reference.code,
                        key: 'a',
                        documentDate: '2026-11-10',
                    }),
                ),
            ),
        ).toContain('inside the document transaction');
    });

    test('two units in one tenant each have their own sequence and format for one reference', async () => {
        const tenantId = await createTenant(pool);
        const company = await createLegalEntity(pool, tenantId, 'PTA');
        const unitA = await createOperatingUnit(pool, tenantId, 'Puskesmas A');
        const unitB = await createOperatingUnit(pool, tenantId, 'Puskesmas B');
        const reference = await createReference(pool, appId, 'Nomor rekam', [
            'operating_unit',
        ]);
        await withDb(async (db) => {
            const service = new NumberSequences(db, tenantId, null);
            for (const [unit, prefix] of [
                [unitA, 'A-'],
                [unitB, 'B-'],
            ] as const)
                await service.create({
                    ...settings,
                    reference_id: reference.id,
                    scope_type: 'operating_unit',
                    operating_unit_id: unit,
                    segments: [
                        { type: 'constant', value: prefix },
                        { type: 'number', length: 6 },
                    ],
                });
        });
        const document = (unit: string, key: string) =>
            issue(tenantId, {
                reference: reference.code,
                key,
                legalEntityId: company,
                operatingUnitId: unit,
            });
        expect(await document(unitA, 'a1')).toBe('A-000001');
        expect(await document(unitB, 'b1')).toBe('B-000001');
        expect(await document(unitA, 'a2')).toBe('A-000002');
        const counters = await rows(
            'select c.scope_key from number_sequence_counters c join tenant_number_sequences s on s.id=c.sequence_id where s.reference_id=$1 order by c.scope_key',
            [reference.id],
        );
        expect(counters.map((row) => row.scope_key)).toEqual(
            ['operating_unit:' + unitA, 'operating_unit:' + unitB].sort(),
        );
    });

    test('the scope comes from the document and a missing scope is refused, not redirected', async () => {
        const tenantId = await createTenant(pool);
        const companyA = await createLegalEntity(pool, tenantId, 'PTA');
        const companyB = await createLegalEntity(pool, tenantId, 'PTB');
        const reference = await createReference(pool, appId, 'Dokumen uji', [
            'legal_entity',
        ]);
        await createSequence(pool, tenantId, reference.id, {
            scope_type: 'legal_entity',
            legal_entity_id: companyA,
            segments: [
                { type: 'scope' },
                { type: 'constant', value: '-' },
                { type: 'number', length: 4 },
            ],
        });
        expect(
            await issue(tenantId, {
                reference: reference.code,
                key: 'a',
                legalEntityId: companyA,
            }),
        ).toBe('PTA-0001');
        expect(
            await failure(
                issue(tenantId, {
                    reference: reference.code,
                    key: 'b',
                    legalEntityId: companyB,
                }),
            ),
        ).toContain('belum diatur untuk Perusahaan PTB');
        expect(
            await failure(
                issue(tenantId, { reference: reference.code, key: 'c' }),
            ),
        ).toContain('belum menyebut perusahaannya');
    });

    test('the fiscal period comes from the document date, not from today', async () => {
        const tenantId = await createTenant(pool);
        const calendar = await createFiscalCalendar(
            pool,
            tenantId,
            [2025, 2026],
        );
        const company = await createLegalEntity(
            pool,
            tenantId,
            'PTA',
            calendar.id,
        );
        const reference = await createReference(pool, appId, 'Dokumen uji', [
            'legal_entity',
        ]);
        await createSequence(pool, tenantId, reference.id, {
            scope_type: 'legal_entity',
            legal_entity_id: company,
            reset_period: 'fiscal_period',
            segments: [
                { type: 'fiscal_year' },
                { type: 'constant', value: '/' },
                { type: 'fiscal_period', length: 2 },
                { type: 'constant', value: '/' },
                { type: 'number', length: 3 },
            ],
        });
        const document = (date: string, key: string) =>
            issue(tenantId, {
                reference: reference.code,
                key,
                legalEntityId: company,
                documentDate: date,
            });
        expect(await document('2025-03-15', 'a')).toBe('FY2025/03/001');
        expect(await document('2025-03-31', 'b')).toBe('FY2025/03/002');
        expect(await document('2025-04-01', 'c')).toBe('FY2025/04/001');
        expect(await failure(document('2027-01-01', 'd'))).toContain(
            'Kalender fiskal belum tersedia untuk tanggal dokumen 2027-01-01',
        );
    });

    test('a legal entity and fiscal period scope picks the sequence of the document date', async () => {
        const tenantId = await createTenant(pool);
        const calendar = await createFiscalCalendar(pool, tenantId, [2026]);
        const company = await createLegalEntity(
            pool,
            tenantId,
            'PTA',
            calendar.id,
        );
        const reference = await createReference(pool, appId, 'Voucher', [
            'legal_entity',
        ]);
        const march = calendar.periods.get('2026-03')?.id ?? '';
        const april = calendar.periods.get('2026-04')?.id ?? '';
        await withDb(async (db) => {
            const service = new NumberSequences(db, tenantId, null);
            for (const [period, prefix] of [
                [march, 'MAR'],
                [april, 'APR'],
            ] as const)
                await service.create({
                    ...settings,
                    maximum_number: 9999,
                    reference_id: reference.id,
                    scope_type: 'legal_entity_fiscal_period',
                    legal_entity_id: company,
                    fiscal_period_id: period,
                    segments: [
                        { type: 'constant', value: prefix },
                        { type: 'number', length: 4 },
                    ],
                });
        });
        const document = (date: string, key: string) =>
            issue(tenantId, {
                reference: reference.code,
                key,
                legalEntityId: company,
                documentDate: date,
            });
        expect(await document('2026-03-31', 'a')).toBe('MAR0001');
        expect(await document('2026-04-01', 'b')).toBe('APR0001');
        expect(await failure(document('2026-05-02', 'c'))).toContain(
            'pada periode fiskal tanggal 2026-05-02',
        );
    });

    test('a number is not issued when the document fails to save', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const sequenceId = await createSequence(
            pool,
            tenantId,
            reference.id,
            {},
        );
        expect(
            await thrown(
                withDb((db) =>
                    db.transaction(async () => {
                        await new NumberIssuer(db, {
                            tenantId,
                            moduleId: appId,
                        }).issue({
                            reference: reference.code,
                            key: 'gagal',
                            documentDate: '2026-11-10',
                        });
                        throw new Error('Simpan dokumen gagal.');
                    }),
                ),
            ),
        ).toContain('Simpan dokumen gagal.');
        const [state] = await rows(
            'select (select count(*)::int from number_sequence_issues where sequence_id=$1) as issues, (select count(*)::int from number_sequence_allocations where sequence_id=$1) as blocks, (select count(*)::int from number_sequence_counters where sequence_id=$1) as counters',
            [sequenceId],
        );
        expect(state).toEqual({ issues: 0, blocks: 0, counters: 0 });
        expect(
            await issue(tenantId, { reference: reference.code, key: 'ulang' }),
        ).toBe('DOKU00001');
    });

    test('parallel documents on separate connections never share a number', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        await createSequence(pool, tenantId, reference.id, {
            preallocation_quantity: 3,
        });
        const continuous = await createReference(pool, appId, 'Faktur');
        await createSequence(pool, tenantId, continuous.id, {
            is_continuous: true,
            preallocation_quantity: 4,
        });
        const batches = await Promise.all(
            Array.from({ length: 6 }, async (_, worker) => {
                const plain: string[] = [];
                const gapless: string[] = [];
                for (let index = 0; index < 6; index++) {
                    plain.push(
                        await issue(tenantId, {
                            reference: reference.code,
                            key: `w${worker}-${index}`,
                        }),
                    );
                    gapless.push(
                        await issue(tenantId, {
                            reference: continuous.code,
                            key: `c${worker}-${index}`,
                        }),
                    );
                }
                return { plain, gapless };
            }),
        );
        const plain = batches.flatMap((batch) => batch.plain);
        const gapless = batches.flatMap((batch) => batch.gapless).sort();
        expect(new Set(plain).size).toBe(36);
        expect(new Set(gapless).size).toBe(36);
        // Continuous: tanpa celah.
        expect(gapless[0]).toBe('DOKU00001');
        expect(gapless.at(-1)).toBe('DOKU00036');
    });

    test('a continuous number from a failed document returns to the pool', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Faktur');
        await createSequence(pool, tenantId, reference.id, {
            is_continuous: true,
        });
        expect(
            await issue(tenantId, { reference: reference.code, key: 'a' }),
        ).toBe('DOKU00001');
        expect(
            await thrown(
                withDb((db) =>
                    db.transaction(async () => {
                        await new NumberIssuer(db, {
                            tenantId,
                            moduleId: appId,
                        }).issue({
                            reference: reference.code,
                            key: 'b',
                            documentDate: '2026-11-10',
                        });
                        throw new Error('Simpan dokumen gagal.');
                    }),
                ),
            ),
        ).toContain('Simpan dokumen gagal.');
        expect(
            await issue(tenantId, { reference: reference.code, key: 'c' }),
        ).toBe('DOKU00002');
    });

    test('scope and its value cannot change after creation, Continuous can', async () => {
        const tenantId = await createTenant(pool);
        const companyA = await createLegalEntity(pool, tenantId, 'PTA');
        const companyB = await createLegalEntity(pool, tenantId, 'PTB');
        const reference = await createReference(pool, appId, 'Dokumen uji', [
            'tenant',
            'legal_entity',
        ]);
        const segments = [
            { type: 'constant', value: 'DOK' },
            { type: 'number', length: 6 },
        ];
        const sequence = await withDb((db) =>
            new NumberSequences(db, tenantId, null).create({
                ...settings,
                reference_id: reference.id,
                scope_type: 'legal_entity',
                legal_entity_id: companyA,
                segments,
            }),
        );
        expect(
            await issue(tenantId, {
                reference: reference.code,
                key: 'a',
                legalEntityId: companyA,
            }),
        ).toBe('DOK000001');
        const update = (changes: Record<string, unknown>) =>
            withDb(async (db) => {
                const service = new NumberSequences(db, tenantId, null);
                const current = await service.find(sequence.id);
                return service.update(sequence.id, {
                    ...settings,
                    segments,
                    version: current.version,
                    ...changes,
                });
            });
        expect(await failure(update({ legal_entity_id: companyB }))).toContain(
            'Scope dan nilainya tidak dapat diubah',
        );
        expect(await failure(update({ scope_type: 'tenant' }))).toContain(
            'Scope dan nilainya tidak dapat diubah',
        );
        expect(
            await failure(
                update({
                    segments: [
                        { type: 'constant', value: 'X' },
                        { type: 'number', length: 6 },
                    ],
                }),
            ),
        ).toContain('Format tidak dapat diubah');
        expect(
            await rows(
                'update tenant_number_sequences set legal_entity_id=$1 where id=$2',
                [companyB, sequence.id],
            ).then(
                () => 'diubah',
                (error: unknown) => String(error),
            ),
        ).toContain('tidak dapat diubah setelah dibuat');

        const continuous = await update({ is_continuous: true });
        expect(continuous.is_continuous).toBe(true);
        // Blok non-continuous yang tersisa dilewati: urutan baru mulai sesudah blok terakhir, tanpa nomor kembar.
        expect(
            await issue(tenantId, {
                reference: reference.code,
                key: 'b',
                legalEntityId: companyA,
            }),
        ).toBe('DOK000021');
        const back = await update({
            is_continuous: false,
            preallocation_enabled: false,
            status: 'stopped',
        });
        expect([back.is_continuous, back.status]).toEqual([false, 'stopped']);
        expect(
            await failure(
                issue(tenantId, {
                    reference: reference.code,
                    key: 'c',
                    legalEntityId: companyA,
                }),
            ),
        ).toContain('belum diatur');
    });

    test('one active sequence per scope value, one scope type per reference', async () => {
        const tenantId = await createTenant(pool);
        const company = await createLegalEntity(pool, tenantId, 'PTA');
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const create = (changes: Record<string, unknown>) =>
            withDb((db) =>
                new NumberSequences(db, tenantId, null).create({
                    ...settings,
                    reference_id: reference.id,
                    scope_type: 'legal_entity',
                    legal_entity_id: company,
                    segments: [
                        { type: 'constant', value: 'LAMA' },
                        { type: 'number', length: 6 },
                    ],
                    ...changes,
                }),
            );
        await create({});
        expect(
            await failure(
                create({
                    segments: [
                        { type: 'constant', value: 'BARU' },
                        { type: 'number', length: 6 },
                    ],
                }),
            ),
        ).toContain('Sudah ada pengaturan nomor aktif');
        expect(
            await failure(
                create({
                    scope_type: 'tenant',
                    legal_entity_id: null,
                    segments: [
                        { type: 'constant', value: 'SEMUA' },
                        { type: 'number', length: 6 },
                    ],
                }),
            ),
        ).toContain('scope lain');
        // Kebijakan baru: buat sebagai draft, hentikan yang lama, lalu aktifkan.
        const draft = await create({
            status: 'draft',
            segments: [
                { type: 'constant', value: 'BARU' },
                { type: 'number', length: 6 },
            ],
        });
        expect(draft.status).toBe('draft');
    });

    test('identical formats that would collide inside one company are refused', async () => {
        const tenantId = await createTenant(pool);
        const companyA = await createLegalEntity(pool, tenantId, 'PTA');
        const companyB = await createLegalEntity(pool, tenantId, 'PTB');
        const unitA = await createOperatingUnit(pool, tenantId, 'Unit A');
        const unitB = await createOperatingUnit(pool, tenantId, 'Unit B');
        const companies = await createReference(pool, appId, 'Per PT', [
            'legal_entity',
        ]);
        const units = await createReference(pool, appId, 'Per unit', [
            'operating_unit',
        ]);
        const segments = [
            { type: 'constant', value: 'SO-' },
            { type: 'number', length: 4 },
        ];
        await withDb(async (db) => {
            const service = new NumberSequences(db, tenantId, null);
            // F&O: SO-0029 boleh ada di setiap company, karena dokumen dijaga per perusahaan.
            for (const company of [companyA, companyB])
                await service.create({
                    ...settings,
                    maximum_number: 9999,
                    reference_id: companies.id,
                    scope_type: 'legal_entity',
                    legal_entity_id: company,
                    segments,
                });
            await service.create({
                ...settings,
                maximum_number: 4999,
                reference_id: units.id,
                scope_type: 'operating_unit',
                operating_unit_id: unitA,
                segments,
            });
        });
        const second = (changes: Record<string, unknown>) =>
            withDb((db) =>
                new NumberSequences(db, tenantId, null).create({
                    ...settings,
                    reference_id: units.id,
                    scope_type: 'operating_unit',
                    operating_unit_id: unitB,
                    segments,
                    maximum_number: 9999,
                    ...changes,
                }),
            );
        expect(await failure(second({}))).toContain('nomornya bisa kembar');
        const separate = await second({ minimum_number: 5000 });
        expect(separate.minimum_number).toBe(5000n);
    });

    test('allow user changes accepts a lower or higher number only when allowed', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Dokumen uji');
        const sequenceId = await createSequence(pool, tenantId, reference.id, {
            preallocation_enabled: false,
        });
        for (const key of ['a', 'b', 'c'])
            await issue(tenantId, { reference: reference.code, key });
        const typed = (number: string, key: string) =>
            issue(tenantId, { reference: reference.code, key, number });
        expect(await failure(typed('DOKU00010', 'x'))).toContain(
            'tidak mengizinkan nomor diubah',
        );
        await rows(
            'update tenant_number_sequences set allow_higher_number=true where id=$1',
            [sequenceId],
        );
        expect(await typed('DOKU00010', 'x')).toBe('DOKU00010');
        expect(await failure(typed('DOKU00001', 'y'))).toContain(
            'ke nomor yang lebih kecil',
        );
        expect(await failure(typed('DOK-10', 'y'))).toContain(
            'tidak mengikuti format DOKU#####',
        );
        await rows(
            'update tenant_number_sequences set allow_lower_number=true where id=$1',
            [sequenceId],
        );
        expect(await failure(typed('DOKU00002', 'y'))).toContain(
            'sudah digunakan',
        );
        expect(await failure(typed('DOKU00000', 'y'))).toContain(
            'di antara 1 dan 19999',
        );
        // Nomor otomatis berikutnya melewati nomor yang sudah dipakai pengguna.
        for (let index = 4; index < 10; index++)
            await issue(tenantId, {
                reference: reference.code,
                key: `n${index}`,
            });
        expect(
            await issue(tenantId, { reference: reference.code, key: 'n10' }),
        ).toBe('DOKU00011');
    });

    test('an abandoned continuous reservation expires, shows in the status list, and is cleaned up', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Faktur');
        const sequenceId = await createSequence(pool, tenantId, reference.id, {
            is_continuous: true,
        });
        const issuer = (db: Database) =>
            new NumberIssuer(db, { tenantId, moduleId: appId });
        const request = {
            reference: reference.code,
            key: 'form-1',
            documentDate: '2026-11-10',
        };
        const reservation = await withDb((db) => issuer(db).reserve(request));
        expect(reservation.number).toBe('DOKU00001');
        expect(reservation.expiresAt).not.toBeNull();
        const replay = await withDb((db) => issuer(db).reserve(request));
        expect(replay.id).toBe(reservation.id);
        const service = (db: Database) =>
            new NumberSequences(db, tenantId, null);
        const list = await withDb((db) => service(db).statusList(sequenceId));
        expect(list.map((row) => [row.number, row.expired])).toEqual([
            ['DOKU00001', false],
        ]);
        expect(await withDb((db) => service(db).cleanup(sequenceId))).toBe(0);
        await rows(
            "update number_sequence_reservations set expires_at=now() at time zone 'utc' - interval '1 minute' where id=$1",
            [reservation.id],
        );
        expect(await withDb((db) => service(db).cleanup(sequenceId))).toBe(1);
        expect(
            await withDb((db) => service(db).statusList(sequenceId)),
        ).toEqual([]);
        // Nomor yang dilepas kembali ke pool dan dipakai dokumen berikutnya, jadi tidak ada celah.
        expect(
            await issue(tenantId, { reference: reference.code, key: 'doc' }),
        ).toBe('DOKU00001');
        // Pesanan yang sudah dilepas tidak bisa dikonfirmasi lagi, dan kuncinya tidak diputar ulang.
        expect(
            await failure(
                withDb((db) =>
                    db.transaction(() => issuer(db).confirm(reservation.id)),
                ),
            ),
        ).toContain('sudah dibatalkan atau dilepas');
        expect(
            await failure(withDb((db) => issuer(db).reserve(request))),
        ).toContain('Gunakan kunci baru');
    });

    test('an expired reservation is released lazily before the next reservation', async () => {
        const tenantId = await createTenant(pool);
        const reference = await createReference(pool, appId, 'Faktur');
        await createSequence(pool, tenantId, reference.id, {
            is_continuous: true,
        });
        const issuer = (db: Database) =>
            new NumberIssuer(db, { tenantId, moduleId: appId });
        const reserve = (key: string) =>
            withDb((db) =>
                issuer(db).reserve({
                    reference: reference.code,
                    key,
                    documentDate: '2026-11-10',
                }),
            );
        const first = await reserve('form-1');
        await rows(
            "update number_sequence_reservations set expires_at=now() at time zone 'utc' - interval '1 minute' where id=$1",
            [first.id],
        );
        const second = await reserve('form-2');
        expect(second.number).toBe('DOKU00001');
        const confirmed = await withDb((db) =>
            db.transaction(() => issuer(db).confirm(second.id)),
        );
        expect(confirmed).toBe('DOKU00001');
        const [issued] = await rows(
            "select count(*)::int as count from number_sequence_issues where app_id=$1 and idempotency_key='form-2'",
            [appId],
        );
        expect(issued?.count).toBe(1);
    });
});
