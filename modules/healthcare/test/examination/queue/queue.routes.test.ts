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

type Entry = {
    id: string;
    started_at: string | null;
    finished_at: string | null;
    visit_id: string;
    registration_number: string;
    section_code: string;
    queue_number: number;
    queue_code: string;
    queue_position: number;
    status: string;
    room_id: string | null;
    visit_status: string;
    patient_name: string;
    call_count: number;
};
type Queue = {
    date: string;
    data: Entry[];
    next_cursor: string | null;
    counts: {
        waiting: number;
        called: number;
        in_examination: number;
        done: number;
        no_show: number;
        total: number;
    };
    current: Entry | null;
};

const api = '/api/modules/healthcare/v1';
const examined =
    'Gagal Batal Registrasi! Pasien dengan Registrasi ini sudah dilakukan Pemeriksaan.';

// Antrean poli: panggil berikutnya ke ruangan pemanggil, panggil ulang, lewati, tidak datang, mulai dan selesai periksa
// beserta status kunjungan, izin, batas unit, dan ruangan yang memanggil serentak. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination queue', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let company: string;
    let admin: Browser;
    let unitA: string;
    let unitB: string;
    let umum: string;
    let patientId: string;
    let doctorId: string;
    const sections: Record<string, string> = {};
    const rooms = { L1R1: '', L1R2: '', L1R3: '', B1: '' };

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
        if (units === null) {
            await grantAllOrganizations(pool, tenantId, account.membershipId);
            await pool.unsafe(
                `insert into role_assignment_data_policy_scopes
                     (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at,
                      updated_at)
                 select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
                 from role_assignments where membership_id = $3`,
                [Bun.randomUUIDv7(), tenantId, account.membershipId],
            );
        }
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

    async function room(unit: string, code: string) {
        return (
            await created(`${api}/rooms`, {
                operating_unit_id: unit,
                code,
                name: `Ruang ${code}`,
            })
        ).id;
    }

    async function register(section: string) {
        return (
            await json<{
                data: { id: string; destinations: { id: string }[] };
            }>(
                await admin.post(`${api}/visits`, {
                    patient_id: patientId,
                    patient_type_id: umum,
                    visit_condition: 'sakit',
                    section_id: section,
                }),
                201,
            )
        ).data;
    }

    async function queue(as: Browser, query: string) {
        return json<Queue>(
            await as.get(`${api}/examination/queue?${query}`),
            200,
        );
    }

    async function callNext(as: Browser, section: string, roomId: string) {
        return as.post(`${api}/examination/queue/call-next`, {
            section_id: section,
            room_id: roomId,
        });
    }

    async function act(
        as: Browser,
        id: string,
        action: string,
        body: Record<string, unknown> = {},
    ) {
        return as.post(`${api}/examination/destinations/${id}/${action}`, body);
    }

    async function entry(response: Response) {
        return (await json<{ data: Entry }>(response, 200)).data;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Antrean');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'healthcare.service-setup.manage',
            'healthcare.visit.manage',
            'healthcare.examination.manage',
            'healthcare.practitioner.manage',
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
                name: 'PT Klinik Uji Antrean',
                company_code: `KQ${Date.now() % 100000}`,
                country_code: 'ID',
            })
        ).id;
        unitA = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas Antrean A',
                operating_unit_type: 'department',
                operating_unit_number: 'PQA',
            })
        ).id;
        unitB = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas Antrean B',
                operating_unit_type: 'department',
                operating_unit_number: 'PQB',
            })
        ).id;
        umum = (
            await created(`${api}/patient-types`, {
                code: 'UMUM',
                name: 'Umum',
            })
        ).id;
        patientId = (
            await created(`${api}/patients`, {
                name: 'Pasien Antrean',
                nationality_country_code: 'AU',
                passport_number: `PQ${Math.floor(Math.random() * 1e8)}`,
                gender: 'female',
                birth_date: '1990-05-12',
                phone: '081200000005',
                domicile_address: { street: 'Jl. Antrean No. 1' },
                payment_methods: [{ patient_type_id: umum }],
            })
        ).id;
        const [doctorProfession] = await pool.unsafe<{ id: string }[]>(
            `select id from sim_m_profesi where tenant_id = $1 and kode = 'dokter' and deleted_at is null`,
            [tenantId],
        );
        doctorId = (
            await created(`${api}/practitioners`, {
                name: 'Dokter Antrean',
                nik: String(Date.now()).slice(-12).padStart(16, '5'),
                gender: 'male',
                phone: '081200000006',
                profession_id: doctorProfession!.id,
            })
        ).id;
        for (const code of ['L1R1', 'L1R2', 'L1R3'] as const)
            rooms[code] = await room(unitA, code);
        rooms.B1 = await room(unitB, 'B1');
        sections['Poli Umum'] = (
            await created(`${api}/sections`, {
                operating_unit_id: unitA,
                code: 'UMUM',
                name: 'Poli Umum',
                kind: 'rawat_jalan',
                queue_prefix: 'A',
                room_ids: [rooms.L1R1, rooms.L1R2],
            })
        ).id;
        sections['Poli Gigi'] = (
            await created(`${api}/sections`, {
                operating_unit_id: unitA,
                code: 'GIGI',
                name: 'Poli Gigi',
                kind: 'rawat_jalan',
                room_ids: [rooms.L1R3],
            })
        ).id;
        sections['Poli B'] = (
            await created(`${api}/sections`, {
                operating_unit_id: unitB,
                code: 'POLI-B',
                name: 'Poli B',
                kind: 'rawat_jalan',
                room_ids: [rooms.B1],
            })
        ).id;
    }, 120_000);

    test('rooms call the next patient, recall, skip to the back, examine, and finish the visit', async () => {
        const section = sections['Poli Umum']!;
        const visits = [];
        for (let index = 0; index < 3; index++)
            visits.push(await register(section));
        const metadata = await json<{
            sections: { id: string; rooms: { id: string }[] }[];
            permissions: { manage: boolean };
        }>(await admin.get(`${api}/examination/metadata`), 200);
        expect(
            metadata.sections
                .find((row) => row.id === section)
                ?.rooms.map((row) => row.id),
        ).toEqual([rooms.L1R1, rooms.L1R2]);
        expect(metadata.permissions.manage).toBe(true);

        const first = await entry(await callNext(admin, section, rooms.L1R1));
        expect([first.queue_code, first.status, first.room_id]).toEqual([
            'A-001',
            'dipanggil',
            rooms.L1R1,
        ]);
        // Ruangan yang masih memanggil tidak memanggil pasien lain.
        expect(
            (await refused(await callNext(admin, section, rooms.L1R1))).errors
                .room_id,
        ).toEqual([
            'Ruangan ini masih memanggil A-001. Mulai periksa, lewati, atau tandai tidak datang lebih dulu.',
        ]);
        // Ruangan yang tidak melayani poli ini ditolak.
        expect(
            Object.keys(
                (await refused(await callNext(admin, section, rooms.L1R3)))
                    .errors,
            ),
        ).toEqual(['room_id']);
        const recalled = await entry(await act(admin, first.id, 'recall'));
        expect([recalled.status, recalled.call_count]).toEqual([
            'dipanggil',
            2,
        ]);
        let listed = await queue(
            admin,
            `section_id=${section}&room_id=${rooms.L1R1}`,
        );
        expect(listed.current?.id).toBe(first.id);
        expect(listed.counts).toEqual({
            waiting: 2,
            called: 1,
            in_examination: 0,
            done: 0,
            no_show: 0,
            total: 3,
        });

        // Lewati: nomornya tetap, tetapi ia antre di belakang yang sedang menunggu.
        const skipped = await entry(await act(admin, first.id, 'skip'));
        expect([
            skipped.status,
            skipped.room_id,
            skipped.queue_position,
        ]).toEqual(['menunggu', null, 4]);
        listed = await queue(admin, `section_id=${section}&status=menunggu`);
        expect(listed.data.map((row) => row.queue_code)).toEqual([
            'A-002',
            'A-003',
            'A-001',
        ]);
        const second = await entry(await callNext(admin, section, rooms.L1R1));
        expect(second.queue_code).toBe('A-002');
        // Ruangan lain memanggil pasien sesudahnya ke ruangannya sendiri.
        const third = await entry(await callNext(admin, section, rooms.L1R2));
        expect([third.queue_code, third.room_id]).toEqual([
            'A-003',
            rooms.L1R2,
        ]);

        const started = await entry(await act(admin, second.id, 'start'));
        expect([started.status, started.visit_status, started.room_id]).toEqual(
            ['diperiksa', 'diperiksa', rooms.L1R1],
        );
        expect(started.started_at).not.toBeNull();
        expect(started.finished_at).toBeNull();
        // Kunjungan yang sudah diperiksa tidak bisa dibatalkan di pendaftaran.
        const visit = await json<{ data: { version: number } }>(
            await admin.get(`${api}/visits/${second.visit_id}`),
            200,
        );
        expect(
            (
                await refused(
                    await admin.post(
                        `${api}/visits/${second.visit_id}/cancel`,
                        {
                            version: visit.data.version,
                            reason: 'Salah poli',
                        },
                    ),
                )
            ).message,
        ).toBe(examined);
        expect(
            (await refused(await act(admin, second.id, 'skip'))).errors.status,
        ).toEqual(['Pasien ini sedang diperiksa.']);
        // Selesai periksa menunggu isian wajib periksa fisik tersimpan dan dokter / tenaga medis yang memeriksa.
        const incomplete = (
            await refused(await act(admin, second.id, 'finish'))
        ).errors;
        expect(Object.keys(incomplete)).toContain('physical.pulse_rate');
        expect(incomplete['anamnesis.doctor_id']).toEqual([
            'Pilih dokter / tenaga medis yang memeriksa sebelum menyelesaikan pemeriksaan.',
        ]);
        const record = await json<{
            data: Record<string, unknown> & {
                physical: object;
                anamnesis: object;
            };
        }>(
            await admin.get(
                `${api}/examination/destinations/${second.id}/medical-record`,
            ),
            200,
        );
        await json(
            await admin.put(
                `${api}/examination/destinations/${second.id}/medical-record`,
                {
                    ...record.data,
                    physical: {
                        ...record.data.physical,
                        pulse_rate: 80,
                        respiratory_rate: 20,
                        consciousness: 'COMPOS MENTIS',
                        systolic: 120,
                        diastolic: 80,
                        height: 160,
                        weight: 55,
                        waist_circumference: 70,
                    },
                },
            ),
            200,
        );
        expect(
            Object.keys(
                (await refused(await act(admin, second.id, 'finish'))).errors,
            ),
        ).toEqual(['anamnesis.doctor_id']);
        const saved = await json<{
            data: Record<string, unknown> & { anamnesis: object };
        }>(
            await admin.get(
                `${api}/examination/destinations/${second.id}/medical-record`,
            ),
            200,
        );
        await json(
            await admin.put(
                `${api}/examination/destinations/${second.id}/medical-record`,
                {
                    ...saved.data,
                    anamnesis: { ...saved.data.anamnesis, doctor_id: doctorId },
                },
            ),
            200,
        );
        const finished = await entry(await act(admin, second.id, 'finish'));
        expect([finished.status, finished.visit_status]).toEqual([
            'selesai',
            'selesai',
        ]);
        expect(finished.started_at).toBe(started.started_at);
        expect(finished.finished_at).not.toBeNull();
        // Waktu kunjungan tersimpan di baris kunjungan, sama dengan riwayat antrean.
        const [times] = await pool.unsafe<
            {
                registered: string;
                started: string;
                finished: string;
                visit_finished: string;
                log_started: string;
                log_finished: string;
            }[]
        >(
            `select d.didaftarkan_pada::text as registered, d.mulai_periksa_pada::text as started,
                    d.selesai_periksa_pada::text as finished, r.selesai_pada::text as visit_finished,
                    (select dilakukan_pada::text from sim_tr_antrean_panggilan
                     where tujuan_id = d.id and aksi = 'mulai_periksa') as log_started,
                    (select dilakukan_pada::text from sim_tr_antrean_panggilan
                     where tujuan_id = d.id and aksi = 'selesai_periksa') as log_finished
             from sim_tr_registrasi_tujuan d join sim_tr_registrasi r on r.id = d.registrasi_id
             where d.id = $1`,
            [second.id],
        );
        expect(times!.started).toBe(times!.log_started);
        expect(times!.finished).toBe(times!.log_finished);
        expect(times!.visit_finished).toBe(times!.finished);
        expect(times!.registered <= times!.started).toBe(true);
        expect(
            (await refused(await act(admin, second.id, 'finish'))).errors
                .status,
        ).toEqual(['Pemeriksaan pasien ini sudah selesai.']);

        listed = await queue(admin, `section_id=${section}`);
        expect(listed.counts).toEqual({
            waiting: 1,
            called: 1,
            in_examination: 0,
            done: 1,
            no_show: 0,
            total: 3,
        });
        const history = await pool.unsafe<
            { aksi: string; ruangan_id: string | null }[]
        >(
            `select aksi, ruangan_id from sim_tr_antrean_panggilan where tujuan_id = $1 order by dilakukan_pada, id`,
            [first.id],
        );
        expect(history.map((row) => [row.aksi, row.ruangan_id])).toEqual([
            ['panggil', rooms.L1R1],
            ['panggil_ulang', rooms.L1R1],
            ['lewati', rooms.L1R1],
        ]);
    }, 60_000);

    test('a no-show is not called again but can still be examined, and a waiting patient can be examined directly', async () => {
        const section = sections['Poli Gigi']!;
        const late = await register(section);
        const direct = await register(section);
        const called = await entry(await callNext(admin, section, rooms.L1R3));
        expect(called.id).toBe(late.destinations[0]!.id);
        const absent = await entry(await act(admin, called.id, 'no-show'));
        expect([absent.status, absent.room_id]).toEqual([
            'tidak_datang',
            rooms.L1R3,
        ]);
        // Mulai periksa tanpa dipanggil butuh ruangan yang melayani poli ini.
        const waiting = direct.destinations[0]!.id;
        expect(
            (await refused(await act(admin, waiting, 'start'))).errors.room_id,
        ).toEqual(['Pilih ruangan pemeriksaan.']);
        expect(
            Object.keys(
                (
                    await refused(
                        await act(admin, waiting, 'start', {
                            room_id: rooms.L1R1,
                        }),
                    )
                ).errors,
            ),
        ).toEqual(['room_id']);
        const examinedDirectly = await entry(
            await act(admin, waiting, 'start', { room_id: rooms.L1R3 }),
        );
        expect([examinedDirectly.status, examinedDirectly.room_id]).toEqual([
            'diperiksa',
            rooms.L1R3,
        ]);
        expect(
            (await refused(await callNext(admin, section, rooms.L1R3))).errors
                .section_id,
        ).toEqual(['Belum ada pasien yang menunggu di poli ini.']);
        // Pasien tidak datang yang datang belakangan diperiksa di ruangan tempat ia dipanggil.
        const lateStart = await entry(await act(admin, called.id, 'start'));
        expect([lateStart.status, lateStart.room_id]).toEqual([
            'diperiksa',
            rooms.L1R3,
        ]);
    }, 60_000);

    test('permissions and operating units guard the queue', async () => {
        const viewer = await member(['healthcare.examination.inquire'], null);
        const listed = await queue(
            viewer,
            `section_id=${sections['Poli Umum']}`,
        );
        expect(listed.data.length).toBeGreaterThan(0);
        expect(
            (await callNext(viewer, sections['Poli Umum']!, rooms.L1R1)).status,
        ).toBe(403);
        expect((await act(viewer, listed.data[0]!.id, 'recall')).status).toBe(
            403,
        );
        const outsider = await member(['healthcare.visit.manage'], null);
        expect((await outsider.get(`${api}/examination/queue`)).status).toBe(
            403,
        );

        // Petugas unit B tidak melihat dan tidak memanggil antrean unit A.
        const clerkB = await member(['healthcare.examination.manage'], [unitB]);
        const own = await register(sections['Poli B']!);
        expect((await queue(clerkB, '')).data.map((row) => row.id)).toEqual([
            own.destinations[0]!.id,
        ]);
        expect(
            (
                await clerkB.get(
                    `${api}/examination/destinations/${listed.data[0]!.id}`,
                )
            ).status,
        ).toBe(404);
        expect((await act(clerkB, listed.data[0]!.id, 'recall')).status).toBe(
            404,
        );
        expect(
            (await callNext(clerkB, sections['Poli Umum']!, rooms.L1R1)).status,
        ).toBe(403);
        const called = await entry(
            await callNext(clerkB, sections['Poli B']!, rooms.B1),
        );
        expect(called.id).toBe(own.destinations[0]!.id);
    }, 60_000);

    test('twenty rooms calling at once never get the same patient', async () => {
        const count = 20;
        const crowded: string[] = [];
        for (let index = 0; index < count; index++)
            crowded.push(await room(unitA, `S${String(index)}`));
        const section = (
            await created(`${api}/sections`, {
                operating_unit_id: unitA,
                code: 'SERENTAK',
                name: 'Poli Serentak',
                kind: 'rawat_jalan',
                room_ids: crowded,
            })
        ).id;
        for (let index = 0; index < count; index++) await register(section);
        const responses = await Promise.all(
            crowded.map((roomId) => callNext(admin, section, roomId)),
        );
        expect(responses.map((response) => response.status)).toEqual(
            Array.from({ length: count }, () => 200),
        );
        const [check] = await pool.unsafe(
            `select count(*)::int as called, count(distinct d.id)::int as patients,
                    count(distinct d.ruangan_id)::int as rooms,
                    (select count(*)::int from sim_tr_antrean_panggilan a
                     join sim_tr_registrasi_tujuan x on x.id = a.tujuan_id
                     where x.section_id = $2 and a.aksi = 'panggil') as calls
             from sim_tr_registrasi_tujuan d
             where d.tenant_id = $1 and d.section_id = $2 and d.status = 'dipanggil'`,
            [tenantId, section],
        );
        expect(check as unknown).toEqual({
            called: count,
            patients: count,
            rooms: count,
            calls: count,
        });
        // Antrean habis: ruangan berikutnya mendapat pesan, bukan pasien yang sudah dipanggil.
        const extra = await room(unitA, 'S-extra');
        await pool.unsafe(
            `insert into sim_m_section_ruangan (id, tenant_id, section_id, ruangan_id, created_at, updated_at)
             values ($1, $2, $3, $4, now(), now())`,
            [Bun.randomUUIDv7(), tenantId, section, extra],
        );
        expect((await callNext(admin, section, extra)).status).toBe(422);
        // Satu ruangan yang menekan Panggil dua kali serentak mendapat satu pasien.
        for (let index = 0; index < 2; index++) await register(section);
        const twice = await Promise.all([
            callNext(admin, section, extra),
            callNext(admin, section, extra),
        ]);
        expect(twice.map((response) => response.status).sort()).toEqual([
            200, 422,
        ]);
    }, 120_000);

    async function find(as: Browser, number: string, code: string) {
        return as.get(
            `${api}/examination/visits/${encodeURIComponent(number)}/sections/${encodeURIComponent(code)}`,
        );
    }

    // Tujuan batal untuk section yang sama di kunjungan yang sama: rujuk internal hanya menolak section yang tujuannya
    // masih hidup, jadi kunjungan bisa memegang keduanya.
    async function cancelledCopy(destinationId: string, cancelledAt: string) {
        const id = Bun.randomUUIDv7();
        await pool.unsafe(
            `insert into sim_tr_registrasi_tujuan
                 (id, tenant_id, registrasi_id, urutan, section_id, no_antrean, kode_antrean, no_bukti, status,
                  didaftarkan_pada, batal_pada, created_at, updated_at)
             select $1, d.tenant_id, d.registrasi_id,
                    (select max(urutan) + 1 from sim_tr_registrasi_tujuan where registrasi_id = d.registrasi_id),
                    d.section_id, d.no_antrean, d.kode_antrean, d.no_bukti || '-' || $4, 'batal',
                    d.didaftarkan_pada, $3::timestamp, now(), now()
             from sim_tr_registrasi_tujuan d where d.id = $2`,
            [id, destinationId, cancelledAt, id.slice(-8)],
        );
        return id;
    }

    test('the examination address opens NoReg and section code, ignoring case and preferring the live row', async () => {
        const linkRoom = await room(unitA, 'T1');
        const section = (
            await created(`${api}/sections`, {
                operating_unit_id: unitA,
                code: 'TAUTAN-1',
                name: 'Poli Tautan',
                kind: 'rawat_jalan',
                room_ids: [linkRoom],
            })
        ).id;
        const visit = await register(section);
        const live = visit.destinations[0]!.id;
        // Alamat lama memakai id tujuan; layar membaca NoReg dan kode section darinya lalu pindah ke alamat baru.
        const byId = await entry(
            await admin.get(`${api}/examination/destinations/${live}`),
        );
        expect(byId.section_code).toBe('TAUTAN-1');
        const number = byId.registration_number;
        expect((await entry(await find(admin, number, 'TAUTAN-1'))).id).toBe(
            live,
        );
        expect((await entry(await find(admin, number, 'tautan-1'))).id).toBe(
            live,
        );

        const older = await cancelledCopy(live, '2026-01-01 08:00:00');
        const newer = await cancelledCopy(live, '2026-01-01 09:00:00');
        expect((await entry(await find(admin, number, 'TAUTAN-1'))).id).toBe(
            live,
        );
        await pool.unsafe(
            `update sim_tr_registrasi_tujuan set status = 'batal', batal_pada = '2026-01-01 07:00:00' where id = $1`,
            [live],
        );
        const cancelled = await entry(await find(admin, number, 'TAUTAN-1'));
        expect([cancelled.id, cancelled.status]).toEqual([newer, 'batal']);
        expect(cancelled.id).not.toBe(older);

        expect((await find(admin, number, 'UMUM')).status).toBe(404);
        expect((await find(admin, 'TIDAK-ADA', 'TAUTAN-1')).status).toBe(404);
        const outsider = await member(['healthcare.visit.manage'], null);
        expect((await find(outsider, number, 'TAUTAN-1')).status).toBe(403);
        const clerkB = await member(
            ['healthcare.examination.inquire'],
            [unitB],
        );
        expect((await find(clerkB, number, 'TAUTAN-1')).status).toBe(404);

        // Legal entity lain di tenant yang sama tidak melihat kunjungan ini.
        const account = await createMember(pool, tenantId, [
            'healthcare.examination.inquire',
        ]);
        await grantAllOrganizations(pool, tenantId, account.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, account.membershipId],
        );
        const otherCompany = browser();
        await otherCompany.login(account.email, account.password);
        expect((await find(otherCompany, number, 'TAUTAN-1')).status).toBe(200);
        const second = (
            await created('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Antrean Kedua',
                company_code: `KR${Date.now() % 100000}`,
                country_code: 'ID',
            })
        ).id;
        await json(
            await otherCompany.put('/api/v1/workspace-context', {
                membership_id: account.membershipId,
                legal_entity_id: second,
            }),
            200,
        );
        expect((await find(otherCompany, number, 'TAUTAN-1')).status).toBe(404);

        // Tenant lain dengan kode section dan NoReg yang sama tidak sampai ke kunjungan ini.
        const otherTenant = await createTenant(pool, 'Klinik Uji Antrean Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const stranger = await createMember(pool, otherTenant, [
            'healthcare.examination.inquire',
        ]);
        await grantAllOrganizations(pool, otherTenant, stranger.membershipId);
        const strangerSession = browser();
        await strangerSession.login(stranger.email, stranger.password);
        expect((await find(strangerSession, number, 'TAUTAN-1')).status).toBe(
            404,
        );
    }, 60_000);

    test('the examination page calls its own patient into the caller room, also after a no-show and during the examination', async () => {
        const roomP1 = await room(unitA, 'P1');
        const roomP2 = await room(unitA, 'P2');
        const section = (
            await created(`${api}/sections`, {
                operating_unit_id: unitA,
                code: 'PANGGIL',
                name: 'Poli Panggil',
                kind: 'rawat_jalan',
                queue_prefix: 'C',
                room_ids: [roomP1, roomP2],
            })
        ).id;
        const first = (await register(section)).destinations[0]!.id;
        const second = (await register(section)).destinations[0]!.id;

        // Pasien kedua dipanggil lebih dulu, di luar urutan Panggil berikutnya.
        const called = await entry(
            await act(admin, second, 'call', { room_id: roomP1 }),
        );
        expect([
            called.queue_code,
            called.status,
            called.room_id,
            called.call_count,
        ]).toEqual(['C-002', 'dipanggil', roomP1, 1]);
        expect(
            (await refused(await act(admin, first, 'call'))).errors.room_id,
        ).toEqual(['Pilih ruangan tempat memanggil.']);
        expect(
            Object.keys(
                (
                    await refused(
                        await act(admin, first, 'call', {
                            room_id: rooms.L1R3,
                        }),
                    )
                ).errors,
            ),
        ).toEqual(['room_id']);
        expect(
            (
                await refused(
                    await act(admin, first, 'call', { room_id: roomP1 }),
                )
            ).errors.room_id,
        ).toEqual([
            'Ruangan ini masih memanggil C-002. Mulai periksa, lewati, atau tandai tidak datang lebih dulu.',
        ]);
        expect(
            (
                await refused(
                    await act(admin, second, 'call', {
                        room_id: roomP2,
                    }),
                )
            ).errors.status,
        ).toEqual(['Pasien ini sedang dipanggil.']);

        // Pasien tidak datang dipanggil lagi, sama dengan pasien yang belum diperiksa di sistem lama.
        await entry(await act(admin, second, 'no-show'));
        const again = await entry(
            await act(admin, second, 'call', { room_id: roomP2 }),
        );
        expect([again.status, again.room_id, again.call_count]).toEqual([
            'dipanggil',
            roomP2,
            2,
        ]);
        await entry(await act(admin, second, 'start'));
        // Panggil ulang selama diperiksa tidak mengubah status, seperti tombol Panggil sistem lama selama SedangPeriksa.
        const recalled = await entry(await act(admin, second, 'recall'));
        expect([
            recalled.status,
            recalled.room_id,
            recalled.call_count,
        ]).toEqual(['diperiksa', roomP2, 3]);
        expect(
            (
                await refused(
                    await act(admin, second, 'call', {
                        room_id: roomP1,
                    }),
                )
            ).errors.status,
        ).toEqual(['Pasien ini sedang diperiksa.']);
        const history = await pool.unsafe<{ aksi: string; room: string }[]>(
            `select aksi, ruangan_id as room from sim_tr_antrean_panggilan
             where tujuan_id = $1 order by dilakukan_pada, id`,
            [second],
        );
        expect(history.map((row) => [row.aksi, row.room])).toEqual([
            ['panggil', roomP1],
            ['tidak_datang', roomP1],
            ['panggil', roomP2],
            ['mulai_periksa', roomP2],
            ['panggil_ulang', roomP2],
        ]);

        const viewer = await member(['healthcare.examination.inquire'], null);
        expect(
            (await act(viewer, first, 'call', { room_id: roomP1 })).status,
        ).toBe(403);
    }, 60_000);
});
