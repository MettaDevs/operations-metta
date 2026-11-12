import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type Destination = {
    section_id: string;
    practice_schedule_id: string | null;
    practitioner_id: string | null;
    queue_number: number;
    queue_code: string;
    examination_number: string;
    status: string;
};
type Visit = {
    id: string;
    version: number;
    registration_number: string;
    operating_unit_id: string;
    patient_id: string;
    date: string;
    patient_type_id: string;
    guarantor_id: string | null;
    card_number: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    visit_condition: string;
    age_years: number | null;
    age_months: number | null;
    visit_kind: string;
    screening_category_name: string | null;
    screening_category_color: string | null;
    status: string;
    cancel_reason: string | null;
    patient_conditions: { id: string; name: string }[];
    screening_signs: { id: string; name: string }[];
    destinations: Destination[];
};
type Metadata = {
    date: string;
    patient_types: { id: string; behaviors: string[] }[];
    patient_conditions: { id: string; name: string }[];
    screening_categories: {
        name: string;
        severity: number;
        color: string;
        signs: { id: string; name: string }[];
    }[];
    sections: {
        id: string;
        operating_unit_id: string;
        schedules: {
            id: string;
            practitioner_id: string;
            registered: number;
            full: boolean;
        }[];
    }[];
    permissions: { create: boolean; cancel: boolean };
};
type Listing = {
    data: {
        id: string;
        registration_number: string;
        status: string;
        patient_id: string;
        visit_condition: string;
        address: string | null;
    }[];
    next_cursor: string | null;
    counts: {
        waiting: number;
        in_examination: number;
        done: number;
        cancelled: number;
        total: number;
    };
};

const api = '/api/modules/healthcare/v1';
const visitLimit =
    'Pasien sudah memiliki registrasi hari ini di poli yang sama.';
const full = 'Kuota jadwal dokter ini sudah penuh.';
const examined =
    'Gagal Batal Registrasi! Pasien dengan Registrasi ini sudah dilakukan Pemeriksaan.';
// NIK di test ini angka contoh yang jelas palsu, bukan nomor orang sungguhan.
const nik = () =>
    `96000000000${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;

// Pendaftaran kunjungan: NoReg, NoBukti, dan antrean dari server, kuota jadwal, batas kunjungan per poli, baru/lama,
// salin cara bayar ke pasien, batal, batas unit, isolasi tenant, izin, dan pendaftaran serentak. Butuh PostgreSQL yang
// sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('visit registration', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    // Profesi bawaan tenant dari migration 0022, menurut kodenya.
    const professions: Record<string, string> = {};
    async function loadProfessions() {
        for (const row of await pool.unsafe<{ kode: string; id: string }[]>(
            'select kode, id from sim_m_profesi where tenant_id = $1 and deleted_at is null',
            [tenantId],
        ))
            professions[row.kode] = row.id;
    }

    let tenantId: string;
    let company: string;
    let admin: Browser;
    let today: string;
    let unitA: string;
    let unitB: string;
    let umum: string;
    let bpjs: string;
    let bpjsKesehatan: string;
    let pagi: string;
    let sore: string;
    const sections: Record<string, string> = {};
    const practitioners: Record<string, string> = {};
    let metadata: Metadata;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function refused(response: Response) {
        return json<{ message: string; errors: Record<string, string[]> }>(
            response,
            422,
        );
    }

    async function created(path: string, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(path, body),
                201,
            )
        ).data;
    }

    async function member(duties: string[], units: string[] | null) {
        const account = await createMember(pool, tenantId, duties);
        if (units === null)
            await grantAllOrganizations(pool, tenantId, account.membershipId);
        for (const unit of units ?? [])
            await pool.unsafe(
                `insert into role_assignment_data_policy_scopes
                     (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id,
                      include_descendants, valid_from, created_at, updated_at)
                 select $1, $2, id, 'healthcare.patient-unit', $3, $4, false, now() - interval '1 day', now(), now()
                 from role_assignments where membership_id = $5`,
                [
                    Bun.randomUUIDv7(),
                    tenantId,
                    company,
                    unit,
                    account.membershipId,
                ],
            );
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    async function patient(name: string, birthDate = '1990-05-12') {
        return (
            await created(`${api}/patients`, {
                name,
                nationality_country_code: 'AU',
                passport_number: `PV${Math.floor(Math.random() * 1e8)}`,
                gender: 'female',
                birth_date: birthDate,
                phone: '081200000003',
                domicile_address: { street: 'Jl. Kunjungan No. 1' },
                payment_methods: [{ patient_type_id: umum }],
            })
        ).id;
    }

    async function practitioner(name: string) {
        return (
            await created(`${api}/practitioners`, {
                name,
                nik: nik(),
                gender: 'male',
                phone: '081200000004',
                profession_id: professions.dokter,
            })
        ).id;
    }

    async function schedule(
        section: string,
        doctor: string,
        capacity: number | null,
        session = pagi,
    ) {
        return created(`${api}/practice-schedules`, {
            section_id: section,
            date: today,
            practitioner_id: doctor,
            session_id: session,
            capacity,
        });
    }

    function body(extra: Record<string, unknown>) {
        return {
            patient_type_id: umum,
            visit_condition: 'sakit',
            ...extra,
        };
    }

    async function register(
        as: Browser,
        extra: Record<string, unknown>,
        headers: Record<string, string> = {},
    ) {
        return as.request('POST', `${api}/visits`, {
            body: body(extra),
            headers,
        });
    }

    async function registered(extra: Record<string, unknown>) {
        return (await json<{ data: Visit }>(await register(admin, extra), 201))
            .data;
    }

    async function cancel(as: Browser, visit: Visit, reason = 'Salah poli') {
        return as.post(`${api}/visits/${visit.id}/cancel`, {
            version: visit.version,
            reason,
        });
    }

    async function registeredCount(scheduleId: string): Promise<number> {
        const [row] = await pool.unsafe(
            'select jumlah_terdaftar from sim_tr_jadwal_praktik where id = $1',
            [scheduleId],
        );
        return Number(row?.jumlah_terdaftar);
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Kunjungan');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        await loadProfessions();
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'healthcare.service-setup.manage',
            'healthcare.practitioner.manage',
            'healthcare.practice-schedule.manage',
            'healthcare.visit.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, owner.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, owner.membershipId],
        );
        admin = browser();
        await admin.login(owner.email, owner.password);
        company = (
            await created('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Kunjungan',
                company_code: `KV${Date.now() % 100000}`,
                country_code: 'ID',
            })
        ).id;
        unitA = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas A',
                operating_unit_type: 'department',
                operating_unit_number: 'PKA',
            })
        ).id;
        unitB = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas B',
                operating_unit_type: 'department',
                operating_unit_number: 'PKB',
            })
        ).id;
        umum = (
            await created(`${api}/patient-types`, {
                code: 'UMUM',
                name: 'Umum',
            })
        ).id;
        bpjs = (
            await created(`${api}/patient-types`, {
                code: 'BPJS',
                name: 'BPJS',
                behaviors: ['requires_guarantor', 'requires_card_number'],
                max_visits_per_section_per_day: 1,
            })
        ).id;
        bpjsKesehatan = (
            await created(`${api}/guarantors`, {
                name: 'BPJS Kesehatan Uji',
                patient_type_id: bpjs,
            })
        ).id;
        pagi = (
            await created(`${api}/practice-sessions`, {
                name: 'Pagi',
                start_time: '08:00',
                end_time: '12:00',
            })
        ).id;
        sore = (
            await created(`${api}/practice-sessions`, {
                name: 'Sore',
                start_time: '14:00',
                end_time: '18:00',
            })
        ).id;
        for (const [name, unit, extra] of [
            ['Poli Umum', unitA, { queue_prefix: 'A' }],
            ['Poli Gigi', unitA, { queue_mode: 'per_jadwal' }],
            ['Laboratorium', unitA, { kind: 'penunjang' }],
            ['Poli Serentak', unitA, {}],
            ['Poli Unit B', unitB, {}],
        ] as const)
            sections[name] = (
                await created(`${api}/sections`, {
                    operating_unit_id: unit,
                    name,
                    kind: 'rawat_jalan',
                    ...extra,
                })
            ).id;
        for (const name of [
            'Dokter Umum',
            'Dokter Pengganti',
            'Dokter Gigi',
            'Dokter Kuota',
            'Dokter Serentak',
            'Dokter B',
        ])
            practitioners[name] = await practitioner(name);
        today = (
            await json<{ date: string }>(
                await admin.get(`${api}/visits/metadata`),
                200,
            )
        ).date;
    }, 120_000);

    test('reference data is seeded per tenant and the form lists sections with today’s schedules', async () => {
        await schedule(
            sections['Poli Umum']!,
            practitioners['Dokter Umum']!,
            null,
        );
        metadata = await json<Metadata>(
            await admin.get(`${api}/visits/metadata`),
            200,
        );
        expect(metadata.patient_conditions.map((row) => row.name)).toEqual([
            'Handaya',
            'Difabel',
            'Lansia',
            'Lain-lain',
        ]);
        expect(
            metadata.screening_categories.map((row) => [
                row.name,
                row.severity,
                row.color,
                row.signs.length,
            ]),
        ).toEqual([
            ['Merah', 1, 'triage-red', 4],
            ['Oranye', 2, 'triage-orange', 2],
            ['Kuning', 3, 'triage-yellow', 3],
            ['Hijau', 4, 'triage-green', 1],
        ]);
        const poli = metadata.sections.find(
            (row) => row.id === sections['Poli Umum'],
        );
        expect(poli?.schedules.map((row) => row.practitioner_id)).toEqual([
            practitioners['Dokter Umum']!,
        ]);
        expect(metadata.permissions).toEqual({ create: true, cancel: true });
        // Pemasangan ulang tidak menggandakan data acuan.
        await pool.unsafe(
            "update core_module_installations set status = 'installed', updated_at = now() where tenant_id = $1 and module_id = 'healthcare'",
            [tenantId],
        );
        const [count] = await pool.unsafe(
            'select count(*)::int as count from sim_m_keadaan_pasien where tenant_id = $1',
            [tenantId],
        );
        expect(Number(count?.count)).toBe(4);
    }, 30_000);

    test('a visit gets numbers and a queue from the server and copies its payer to the patient', async () => {
        const patientId = await patient('Pasien Satu', '1990-05-12');
        const scheduleId = metadata.sections.find(
            (row) => row.id === sections['Poli Umum'],
        )!.schedules[0]!.id;
        const kuning = metadata.screening_categories[2]!.signs[0]!.id;
        const oranye = metadata.screening_categories[1]!.signs[1]!.id;
        const visit = await registered({
            patient_id: patientId,
            patient_type_id: bpjs,
            guarantor_id: bpjsKesehatan,
            card_number: '0001234567890',
            height_cm: '160.25',
            weight_kg: 55,
            patient_condition_ids: [metadata.patient_conditions[2]!.id],
            screening_sign_ids: [kuning, oranye],
            section_id: sections['Poli Umum'],
            practice_schedule_id: scheduleId,
            // Nomor dari klien diabaikan.
            registration_number: 'PALSU',
            queue_number: 99,
        });
        expect(visit.registration_number).toMatch(/^PKA-REG-\d{8}$/);
        expect(visit.destinations).toHaveLength(1);
        expect(visit.destinations[0]).toEqual(
            expect.objectContaining({
                section_id: sections['Poli Umum'],
                practice_schedule_id: scheduleId,
                practitioner_id: practitioners['Dokter Umum'],
                queue_number: 1,
                queue_code: 'A-001',
                status: 'menunggu',
            }),
        );
        expect(visit.destinations[0]!.examination_number).toMatch(
            /^PKA-RJ-\d{8}$/,
        );
        expect(visit).toEqual(
            expect.objectContaining({
                operating_unit_id: unitA,
                date: today,
                visit_kind: 'baru',
                status: 'terdaftar',
                height_cm: 160.3,
                weight_kg: 55,
                screening_category_name: 'Oranye',
                screening_category_color: 'triage-orange',
                card_number: '0001234567890',
            }),
        );
        expect(visit.age_years).toBeGreaterThanOrEqual(35);
        expect(visit.patient_conditions.map((row) => row.name)).toEqual([
            'Lansia',
        ]);
        expect(await registeredCount(scheduleId)).toBe(1);
        const payment = await pool.unsafe(
            'select tipe_pasien_id, penjamin_id, nomor_kartu from sim_m_pasien_cara_bayar where pasien_id = $1 and utama and deleted_at is null',
            [patientId],
        );
        expect(payment as unknown).toEqual([
            {
                tipe_pasien_id: bpjs,
                penjamin_id: bpjsKesehatan,
                nomor_kartu: '0001234567890',
            },
        ]);
        // Kunjungan kedua di bulan yang sama adalah kunjungan lama, dengan nomor antrean berikutnya.
        const second = await registered({
            patient_id: patientId,
            section_id: sections['Poli Umum'],
            practice_schedule_id: scheduleId,
        });
        expect(second.visit_kind).toBe('lama');
        expect(second.destinations[0]!.queue_code).toBe('A-002');
        expect(second.registration_number).not.toBe(visit.registration_number);
        const shown = await json<{ data: Visit }>(
            await admin.get(`${api}/visits/${visit.id}`),
            200,
        );
        expect(shown.data.screening_signs).toHaveLength(2);
    }, 30_000);

    test('the patient type decides whether guarantor and card number are required', async () => {
        const patientId = await patient('Pasien Penjamin');
        const response = await refused(
            await register(admin, {
                patient_id: patientId,
                patient_type_id: bpjs,
                section_id: sections.Laboratorium,
            }),
        );
        expect(Object.keys(response.errors).sort()).toEqual([
            'card_number',
            'guarantor_id',
        ]);
        const unknown = await refused(
            await register(admin, {
                patient_id: patientId,
                visit_condition: 'pingsan',
                screening_sign_ids: [Bun.randomUUIDv7()],
                section_id: sections.Laboratorium,
            }),
        );
        expect(Object.keys(unknown.errors).sort()).toEqual([
            'screening_sign_ids',
            'visit_condition',
        ]);
    }, 30_000);

    test('the visit limit of the patient type refuses a second visit to the same section that day', async () => {
        const patientId = await patient('Pasien Batas');
        const bpjsBody = {
            patient_id: patientId,
            patient_type_id: bpjs,
            guarantor_id: bpjsKesehatan,
            card_number: '0009999',
            section_id: sections.Laboratorium,
        };
        const first = await registered(bpjsBody);
        const second = await refused(await register(admin, bpjsBody));
        expect(second.message).toBe(visitLimit);
        // Section lain hari yang sama boleh.
        await registered({
            ...bpjsBody,
            section_id: sections['Poli Umum'],
            practice_schedule_id: metadata.sections.find(
                (row) => row.id === sections['Poli Umum'],
            )!.schedules[0]!.id,
        });
        // Kunjungan yang dibatalkan tidak dihitung.
        await json(await cancel(admin, first), 200);
        await registered(bpjsBody);
        // Tipe tanpa batas (0) boleh berkali-kali.
        await registered({
            patient_id: patientId,
            section_id: sections.Laboratorium,
        });
        await registered({
            patient_id: patientId,
            section_id: sections.Laboratorium,
        });
    }, 30_000);

    test('a cancelled visit does not make the next one a returning visit', async () => {
        const patientId = await patient('Pasien Baru Lagi');
        const first = await registered({
            patient_id: patientId,
            section_id: sections.Laboratorium,
        });
        await json(await cancel(admin, first), 200);
        const next = await registered({
            patient_id: patientId,
            section_id: sections.Laboratorium,
        });
        expect(next.visit_kind).toBe('baru');
    }, 30_000);

    test('practitioners come from today’s schedule, including the substitute', async () => {
        const patientId = await patient('Pasien Jadwal');
        // Section yang punya jadwal hari ini mewajibkan jadwal.
        expect(
            Object.keys(
                (
                    await refused(
                        await register(admin, {
                            patient_id: patientId,
                            section_id: sections['Poli Umum'],
                        }),
                    )
                ).errors,
            ),
        ).toEqual(['practice_schedule_id']);
        // Section tanpa jadwal hari ini didaftarkan tanpa nakes.
        const lab = await registered({
            patient_id: patientId,
            section_id: sections.Laboratorium,
        });
        expect(lab.destinations[0]!.practitioner_id).toBeNull();
        // Jadwal section lain dan jadwal batal ditolak.
        const gigi = await schedule(
            sections['Poli Gigi']!,
            practitioners['Dokter Gigi']!,
            null,
        );
        expect(
            (
                await refused(
                    await register(admin, {
                        patient_id: patientId,
                        section_id: sections['Poli Umum'],
                        practice_schedule_id: gigi.id,
                    }),
                )
            ).errors.practice_schedule_id,
        ).toBeDefined();
        const cancelled = await schedule(
            sections['Poli Umum']!,
            practitioners['Dokter Gigi']!,
            null,
            sore,
        );
        await json(
            await admin.patch(`${api}/practice-schedules/${cancelled.id}`, {
                status: 'batal',
                cancel_reason: 'Cuti',
                version: cancelled.version,
            }),
            200,
        );
        expect(
            (
                await register(admin, {
                    patient_id: patientId,
                    section_id: sections['Poli Umum'],
                    practice_schedule_id: cancelled.id,
                })
            ).status,
        ).toBe(422);
        // Nakes pengganti yang tercatat di jadwal.
        const substituted = await schedule(
            sections['Poli Gigi']!,
            practitioners['Dokter Umum']!,
            null,
            sore,
        );
        await json(
            await admin.patch(`${api}/practice-schedules/${substituted.id}`, {
                substitute_practitioner_id: practitioners['Dokter Pengganti'],
                version: substituted.version,
            }),
            200,
        );
        const visit = await registered({
            patient_id: patientId,
            section_id: sections['Poli Gigi'],
            practice_schedule_id: substituted.id,
        });
        expect(visit.destinations[0]!.practitioner_id).toBe(
            practitioners['Dokter Pengganti']!,
        );
        // Antrean per jadwal: setiap jadwal mulai dari 1.
        expect(visit.destinations[0]!.queue_number).toBe(1);
        const other = await registered({
            patient_id: patientId,
            section_id: sections['Poli Gigi'],
            practice_schedule_id: gigi.id,
        });
        expect(other.destinations[0]!.queue_number).toBe(1);
    }, 30_000);

    test('a full schedule refuses registration until a visit is cancelled', async () => {
        const quota = await schedule(
            sections['Poli Umum']!,
            practitioners['Dokter Kuota']!,
            2,
            sore,
        );
        const visits: Visit[] = [];
        for (const name of ['Kuota 1', 'Kuota 2'])
            visits.push(
                await registered({
                    patient_id: await patient(name),
                    section_id: sections['Poli Umum'],
                    practice_schedule_id: quota.id,
                }),
            );
        const third = await patient('Kuota 3');
        const refusal = await refused(
            await register(admin, {
                patient_id: third,
                section_id: sections['Poli Umum'],
                practice_schedule_id: quota.id,
            }),
        );
        expect(refusal.message).toBe(full);
        expect(await registeredCount(quota.id)).toBe(2);
        await json(await cancel(admin, visits[0]!), 200);
        expect(await registeredCount(quota.id)).toBe(1);
        await registered({
            patient_id: third,
            section_id: sections['Poli Umum'],
            practice_schedule_id: quota.id,
        });
        expect(await registeredCount(quota.id)).toBe(2);
    }, 30_000);

    test('cancel needs a reason and the current version, and is refused once examined', async () => {
        const visit = await registered({
            patient_id: await patient('Pasien Batal'),
            section_id: sections.Laboratorium,
        });
        expect(
            Object.keys(
                (await refused(await cancel(admin, visit, ' '))).errors,
            ),
        ).toEqual(['reason']);
        expect(
            (
                await admin.post(`${api}/visits/${visit.id}/cancel`, {
                    version: visit.version + 1,
                    reason: 'Salah',
                })
            ).status,
        ).toBe(409);
        const examinedVisit = await registered({
            patient_id: await patient('Pasien Diperiksa'),
            section_id: sections.Laboratorium,
        });
        await pool.unsafe(
            "update sim_tr_registrasi set status = 'diperiksa' where id = $1",
            [examinedVisit.id],
        );
        const refusal = await refused(
            await cancel(admin, {
                ...examinedVisit,
                version: examinedVisit.version + 1,
            }),
        );
        expect(refusal.message).toBe(examined);
        const cancelled = (
            await json<{ data: Visit }>(await cancel(admin, visit), 200)
        ).data;
        expect(cancelled).toEqual(
            expect.objectContaining({
                status: 'batal',
                cancel_reason: 'Salah poli',
            }),
        );
        expect(cancelled.destinations[0]!.status).toBe('batal');
        expect((await cancel(admin, cancelled)).status).toBe(422);
    }, 30_000);

    test('the same idempotency key returns the same visit', async () => {
        const patientId = await patient('Pasien Ulang');
        const headers = { 'idempotency-key': `visit-${Bun.randomUUIDv7()}` };
        const first = await json<{ data: Visit }>(
            await register(
                admin,
                { patient_id: patientId, section_id: sections.Laboratorium },
                headers,
            ),
            201,
        );
        const again = await json<{ data: Visit }>(
            await register(
                admin,
                { patient_id: patientId, section_id: sections.Laboratorium },
                headers,
            ),
            200,
        );
        expect(again.data.id).toBe(first.data.id);
    }, 30_000);

    test('the list filters, searches, and counts by status', async () => {
        const all = await json<Listing>(
            await admin.get(`${api}/visits?per_page=100`),
            200,
        );
        expect(all.counts.total).toBe(all.data.length);
        expect(all.counts.cancelled).toBeGreaterThan(0);
        expect(
            all.counts.waiting +
                all.counts.in_examination +
                all.counts.done +
                all.counts.cancelled,
        ).toBe(all.counts.total);
        expect(all.counts.in_examination).toBe(1);
        const cancelled = await json<Listing>(
            await admin.get(`${api}/visits?status=batal&per_page=100`),
            200,
        );
        expect(cancelled.data.every((row) => row.status === 'batal')).toBe(
            true,
        );
        expect(cancelled.data).toHaveLength(all.counts.cancelled);
        // Penghitung tidak ikut saringan status.
        expect(cancelled.counts).toEqual(all.counts);
        const bySection = await json<Listing>(
            await admin.get(
                `${api}/visits?section_id=${sections['Poli Gigi']}&per_page=100`,
            ),
            200,
        );
        expect(bySection.counts.total).toBe(2);
        const number = all.data[0]!.registration_number;
        const searched = await json<Listing>(
            await admin.get(`${api}/visits?q=${encodeURIComponent(number)}`),
            200,
        );
        expect(searched.data.map((row) => row.registration_number)).toEqual([
            number,
        ]);
        const yesterday = await json<Listing>(
            await admin.get(`${api}/visits?from=2020-01-01&to=2020-01-02`),
            200,
        );
        expect(yesterday.counts.total).toBe(0);
        // Riwayat kunjungan satu pasien di layar pendaftaran membaca saringan pasien.
        const own = all.data[0]!;
        const byPatient = await json<Listing>(
            await admin.get(
                `${api}/visits?patient_id=${own.patient_id}&per_page=100`,
            ),
            200,
        );
        expect(byPatient.data.map((row) => row.id)).toEqual(
            all.data
                .filter((row) => row.patient_id === own.patient_id)
                .map((row) => row.id),
        );
        expect(byPatient.data.map((row) => row.visit_condition)).toContain(
            'sakit',
        );
        expect(own.address).toContain('Jl. Kunjungan No. 1');
    }, 30_000);

    test('a clerk only registers and sees visits of the units granted to them', async () => {
        await schedule(
            sections['Poli Unit B']!,
            practitioners['Dokter B']!,
            null,
        );
        const clerk = await member(['healthcare.visit.manage'], [unitB]);
        const patientId = await patient('Pasien Unit');
        expect(
            (
                await register(clerk, {
                    patient_id: patientId,
                    section_id: sections.Laboratorium,
                })
            ).status,
        ).toBe(403);
        const clerkMetadata = await json<Metadata>(
            await clerk.get(`${api}/visits/metadata`),
            200,
        );
        expect(clerkMetadata.sections.map((row) => row.id)).toEqual([
            sections['Poli Unit B']!,
        ]);
        const own = (
            await json<{ data: Visit }>(
                await register(clerk, {
                    patient_id: patientId,
                    section_id: sections['Poli Unit B'],
                    practice_schedule_id:
                        clerkMetadata.sections[0]!.schedules[0]!.id,
                }),
                201,
            )
        ).data;
        expect(own.registration_number).toMatch(/^PKB-REG-/);
        const listed = await json<Listing>(
            await clerk.get(`${api}/visits?per_page=100`),
            200,
        );
        expect(listed.data.map((row) => row.id)).toEqual([own.id]);
        expect(listed.counts.total).toBe(1);
        const [other] = await pool.unsafe(
            'select id from sim_tr_registrasi where tenant_id = $1 and operating_unit_id = $2 limit 1',
            [tenantId, unitA],
        );
        expect(
            (await clerk.get(`${api}/visits/${String(other?.id)}`)).status,
        ).toBe(404);
        // Pengguna tanpa unit tidak mendaftarkan dan tidak melihat apa pun.
        const unitless = await member(['healthcare.visit.manage'], []);
        expect(
            (
                await register(unitless, {
                    patient_id: patientId,
                    section_id: sections['Poli Unit B'],
                })
            ).status,
        ).not.toBe(201);
        expect((await unitless.get(`${api}/visits/${own.id}`)).status).toBe(
            404,
        );
    }, 30_000);

    test('permissions guard reading, registering, and cancelling', async () => {
        const reader = await member(['healthcare.visit.inquire'], null);
        expect((await reader.get(`${api}/visits`)).status).toBe(200);
        const metadataForReader = await json<Metadata>(
            await reader.get(`${api}/visits/metadata`),
            200,
        );
        expect(metadataForReader.permissions).toEqual({
            create: false,
            cancel: false,
        });
        const patientId = await patient('Pasien Izin');
        expect(
            (
                await register(reader, {
                    patient_id: patientId,
                    section_id: sections.Laboratorium,
                })
            ).status,
        ).toBe(403);
        const visit = await registered({
            patient_id: patientId,
            section_id: sections.Laboratorium,
        });
        expect((await cancel(reader, visit)).status).toBe(403);
        const outsider = await member(['healthcare.patient.inquire'], null);
        expect((await outsider.get(`${api}/visits`)).status).toBe(403);
    }, 30_000);

    test('another tenant never sees these visits', async () => {
        const visit = (
            await json<Listing>(
                await admin.get(`${api}/visits?per_page=1`),
                200,
            )
        ).data[0]!;
        const otherTenant = await createTenant(pool, 'Klinik Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const account = await createMember(pool, otherTenant, [
            'core.organization.manage',
            'healthcare.visit.manage',
        ]);
        await grantAllOrganizations(pool, otherTenant, account.membershipId);
        const stranger = browser();
        await stranger.login(account.email, account.password);
        await json(
            await stranger.post('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Lain',
                company_code: `KL${Date.now() % 100000}`,
                country_code: 'ID',
            }),
            201,
        );
        expect((await stranger.get(`${api}/visits/${visit.id}`)).status).toBe(
            404,
        );
        const listed = await json<Listing>(
            await stranger.get(`${api}/visits`),
            200,
        );
        expect(listed.counts.total).toBe(0);
        const [seeded] = await pool.unsafe(
            'select count(*)::int as count from sim_m_skrining_tanda where tenant_id = $1',
            [otherTenant],
        );
        expect(Number(seeded?.count)).toBe(10);
    }, 30_000);

    test('fifty simultaneous registrations never share a number and never exceed the quota', async () => {
        const capacity = 40;
        const busy = await schedule(
            sections['Poli Serentak']!,
            practitioners['Dokter Serentak']!,
            capacity,
        );
        const patients: string[] = [];
        for (let index = 0; index < 50; index++)
            patients.push(await patient(`Pasien Serentak ${index}`));
        const responses = await Promise.all(
            patients.map((patientId) =>
                register(admin, {
                    patient_id: patientId,
                    section_id: sections['Poli Serentak'],
                    practice_schedule_id: busy.id,
                }),
            ),
        );
        const statuses = responses.map((response) => response.status);
        expect(statuses.filter((status) => status === 201)).toHaveLength(
            capacity,
        );
        expect(statuses.filter((status) => status === 422)).toHaveLength(
            50 - capacity,
        );
        const [check] = await pool.unsafe(
            `select count(*)::int as visits,
                    count(distinct r.no_reg)::int as registration_numbers,
                    count(distinct d.no_bukti)::int as examination_numbers,
                    count(distinct d.no_antrean)::int as queue_numbers,
                    min(d.no_antrean)::int as first_queue,
                    max(d.no_antrean)::int as last_queue,
                    (select jumlah_terdaftar from sim_tr_jadwal_praktik where id = $2) as registered
             from sim_tr_registrasi r
             join sim_tr_registrasi_tujuan d on d.registrasi_id = r.id
             where r.tenant_id = $1 and d.section_id = $3 and r.status <> 'batal'`,
            [tenantId, busy.id, sections['Poli Serentak']!],
        );
        expect(check as unknown).toEqual({
            visits: capacity,
            registration_numbers: capacity,
            examination_numbers: capacity,
            queue_numbers: capacity,
            first_queue: 1,
            last_queue: capacity,
            registered: capacity,
        });
        // Tanpa jadwal yang mengunci, penghitung antrean dan nomor dokumen sendiri yang menjaga keunikan.
        const responsesWithoutSchedule = await Promise.all(
            patients.map((patientId) =>
                register(admin, {
                    patient_id: patientId,
                    section_id: sections.Laboratorium,
                }),
            ),
        );
        expect(
            responsesWithoutSchedule.every(
                (response) => response.status === 201,
            ),
        ).toBe(true);
        const [lab] = await pool.unsafe(
            `select count(*)::int as visits, count(distinct d.no_antrean)::int as queue_numbers,
                    (select count(distinct no_reg)::int from sim_tr_registrasi where tenant_id = $1) as registration_numbers,
                    (select count(*)::int from sim_tr_registrasi where tenant_id = $1) as all_visits,
                    (select count(distinct no_bukti)::int from sim_tr_registrasi_tujuan where tenant_id = $1) as examination_numbers
             from sim_tr_registrasi_tujuan d
             join sim_tr_registrasi r on r.id = d.registrasi_id
             where d.tenant_id = $1 and d.section_id = $2 and r.tanggal = $3::date`,
            [tenantId, sections.Laboratorium!, today],
        );
        expect(lab?.queue_numbers).toBe(lab?.visits);
        expect(lab?.registration_numbers).toBe(lab?.all_visits);
        expect(lab?.examination_numbers).toBe(lab?.all_visits);
    }, 120_000);
});
