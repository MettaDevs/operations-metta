import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    api,
    createClinic,
    json,
    login,
    openCashier,
    refused,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Referral = {
    id: string;
    section_name: string;
    queue_code: string;
    practitioner_name: string | null;
    status: string;
    note: string | null;
};
type Discharge = {
    status_id: string | null;
    follow_up: boolean | null;
    follow_up_date: string | null;
    consultant_id: string | null;
    referral_destination: string | null;
    referral_specialty: string | null;
    referral_reason: string | null;
    death_time_category: string | null;
    death_date: string | null;
    death_time: string | null;
    internal_referrals: Referral[];
};
type Status = {
    id: string;
    code: string;
    name: string;
    behavior: string | null;
    active: boolean;
};

const paid =
    'Kunjungan ini sudah dibayar di kasir. Batalkan pembayarannya dulu untuk menambah rujuk internal.';

// Panel Status Pasien dan rujuk internal halaman pemeriksaan: data acuan dari sistem lama, setiap status tersimpan
// beserta isiannya, rujuk internal membuat tujuan baru dengan antrean dan NoBukti, poli ganda ditolak, pemeriksaan
// rujukan menunggu poli asal selesai, status kunjungan, rujuk internal sesudah Selesai periksa sampai dibayar, batas
// tenant, dan izin. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination discharge status', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let clinic: Clinic;
    let statuses: Record<string, Status>;

    const discharge = async (id: string) =>
        (await clinic.show(id)).data.discharge as Discharge;
    const refer = (
        id: string,
        body: Record<string, unknown>,
        as = clinic.admin,
    ) =>
        as.post(`${api}/examination/destinations/${id}/internal-referrals`, {
            status_id: statuses.RujukInternal!.id,
            ...body,
        });
    async function started() {
        const visit = await clinic.visit();
        await json(await clinic.start(visit.destinationId), 200);
        return visit;
    }
    async function destination(id: string) {
        const [row] = await pool.unsafe<
            {
                status: string;
                no_antrean: number;
                kode_antrean: string;
                no_bukti: string;
                asal_tujuan_id: string | null;
                nakes_id: string | null;
                urutan: number;
                didaftarkan_pada: string;
                mulai_periksa_pada: string | null;
                selesai_periksa_pada: string | null;
            }[]
        >(
            `select status, no_antrean, kode_antrean, no_bukti, asal_tujuan_id, nakes_id, urutan,
                    didaftarkan_pada::text, mulai_periksa_pada::text, selesai_periksa_pada::text
             from sim_tr_registrasi_tujuan where id = $1`,
            [id],
        );
        return row!;
    }
    const visitStatus = async (visitId: string) =>
        (
            await pool.unsafe<{ status: string }[]>(
                'select status from sim_tr_registrasi where id = $1',
                [visitId],
            )
        )[0]!.status;

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji Status');
        const metadata = await json<{
            discharge_statuses: Status[];
            options: Record<string, { code: string; name: string }[]>;
        }>(
            await clinic.admin.get(
                `${api}/examination/medical-record/metadata`,
            ),
            200,
        );
        statuses = Object.fromEntries(
            metadata.discharge_statuses.map((row) => [row.code, row]),
        );
    }, 120_000);

    test('the five old statuses and the death-time options are seeded per tenant', async () => {
        const metadata = await json<{
            discharge_statuses: Status[];
            options: Record<string, { code: string; name: string }[]>;
        }>(
            await clinic.admin.get(
                `${api}/examination/medical-record/metadata`,
            ),
            200,
        );
        expect(
            metadata.discharge_statuses.map((row) => [
                row.code,
                row.name,
                row.behavior,
                row.active,
            ]),
        ).toEqual([
            ['RawatJalan', 'Rawat Jalan', 'rawat_jalan', true],
            ['TindakLanjutRI', 'Rawat Inap', 'rawat_inap', false],
            ['RujukInternal', 'Rujuk Internal', 'rujuk_internal', true],
            ['RujukEksternal', 'Rujuk Eksternal', 'rujuk_eksternal', true],
            ['Meninggal', 'Meninggal', 'meninggal', true],
        ]);
        expect(
            metadata.options.waktu_meninggal?.map((row) => [
                row.code,
                row.name,
            ]),
        ).toEqual([
            ['MeninggalSblm48', '< 48 Jam'],
            ['MeninggalStl48', '> 48 Jam'],
        ]);
        const { destinationId } = await clinic.visit();
        expect(await discharge(destinationId)).toEqual({
            status_id: null,
            follow_up: null,
            follow_up_date: null,
            consultant_id: null,
            referral_destination: null,
            referral_specialty: null,
            referral_reason: null,
            death_time_category: null,
            death_date: null,
            death_time: null,
            internal_referrals: [],
        });
    });

    test('each status saves its own fields and clears the fields of the others', async () => {
        const { destinationId } = await started();
        const save = async (value: Partial<Discharge>) =>
            json<{ data: { discharge: Discharge } }>(
                await clinic.save(destinationId, {
                    discharge: {
                        ...(await discharge(destinationId)),
                        ...value,
                    },
                }),
                200,
            );

        let saved = await save({
            status_id: statuses.RawatJalan!.id,
            follow_up: true,
            follow_up_date: '2026-12-01',
        });
        expect(saved.data.discharge).toMatchObject({
            status_id: statuses.RawatJalan!.id,
            follow_up: true,
            follow_up_date: '2026-12-01',
        });

        saved = await save({
            status_id: statuses.RujukEksternal!.id,
            referral_destination: 'RSUD Kota',
            referral_specialty: 'Penyakit Dalam',
            referral_reason: 'Perlu pemeriksaan lanjutan',
        });
        expect(saved.data.discharge).toMatchObject({
            status_id: statuses.RujukEksternal!.id,
            follow_up: null,
            follow_up_date: null,
            referral_destination: 'RSUD Kota',
            referral_specialty: 'Penyakit Dalam',
            referral_reason: 'Perlu pemeriksaan lanjutan',
        });

        saved = await save({
            status_id: statuses.Meninggal!.id,
            death_time_category: 'MeninggalStl48',
            death_date: '2026-11-12',
            death_time: '14:30',
        });
        expect(saved.data.discharge).toMatchObject({
            status_id: statuses.Meninggal!.id,
            referral_destination: null,
            referral_specialty: null,
            referral_reason: null,
            death_time_category: 'MeninggalStl48',
            death_date: '2026-11-12',
            death_time: '14:30',
        });

        // Rawat Inap nonaktif sampai tenant mengaktifkannya; sesudah itu dokter konsul tersimpan.
        expect(
            await refused(
                await clinic.save(destinationId, {
                    discharge: {
                        ...(await discharge(destinationId)),
                        status_id: statuses.TindakLanjutRI!.id,
                    },
                }),
            ),
        ).toEqual({
            'discharge.status_id': ['Pilih status pasien dari daftar.'],
        });
        await pool.unsafe(
            'update sim_m_status_pulang set aktif = true where id = $1',
            [statuses.TindakLanjutRI!.id],
        );
        saved = await save({
            status_id: statuses.TindakLanjutRI!.id,
            consultant_id: clinic.doctor,
        });
        expect(saved.data.discharge).toMatchObject({
            status_id: statuses.TindakLanjutRI!.id,
            consultant_id: clinic.doctor,
            death_time_category: null,
            death_date: null,
            death_time: null,
        });
        await pool.unsafe(
            'update sim_m_status_pulang set aktif = false where id = $1',
            [statuses.TindakLanjutRI!.id],
        );
        // Status yang tersimpan tetap diterima walau sejak itu nonaktif.
        await save({});

        const [row] = await pool.unsafe<
            { status_pulang_id: string; dokter_konsul_id: string }[]
        >(
            'select status_pulang_id, dokter_konsul_id from sim_tr_registrasi_tujuan where id = $1',
            [destinationId],
        );
        expect(row).toEqual({
            status_pulang_id: statuses.TindakLanjutRI!.id,
            dokter_konsul_id: clinic.doctor,
        });
    });

    test('a status refuses invalid fields', async () => {
        const { destinationId } = await started();
        const current = await discharge(destinationId);
        expect(
            await refused(
                await clinic.save(destinationId, {
                    discharge: {
                        ...current,
                        status_id: statuses.RawatJalan!.id,
                        follow_up: true,
                        follow_up_date: null,
                    },
                }),
            ),
        ).toEqual({
            'discharge.follow_up_date': ['Isi tanggal check up kembali.'],
        });
        expect(
            await refused(
                await clinic.save(destinationId, {
                    discharge: {
                        ...current,
                        status_id: statuses.Meninggal!.id,
                        death_time_category: 'Kemarin',
                        death_date: '12-11-2026',
                        death_time: '25:00',
                    },
                }),
            ),
        ).toEqual({
            'discharge.death_time_category': ['Pilih dari daftar.'],
            'discharge.death_date': ['Isian ini tidak sah.'],
            'discharge.death_time': ['Isian ini tidak sah.'],
        });
        expect(
            await refused(
                await clinic.save(destinationId, {
                    discharge: { ...current, status_id: Bun.randomUUIDv7() },
                }),
            ),
        ).toEqual({
            'discharge.status_id': ['Pilih status pasien dari daftar.'],
        });
    });

    test('rujuk internal creates a destination with its own queue number and NoBukti, refuses the same poli, and waits for the referring poli', async () => {
        const { visitId, destinationId } = await started();
        const first = await destination(destinationId);

        // Poli tujuan yang ditawarkan: section unit kunjungan yang belum ada di kunjungan ini, dengan jadwal hari itu.
        const options = await json<{
            data: { id: string; name: string; schedules: { id: string }[] }[];
        }>(
            await clinic.admin.get(
                `${api}/examination/destinations/${destinationId}/internal-referrals/options`,
            ),
            200,
        );
        expect(options.data.map((row) => row.name)).toEqual([
            'Poli Gigi',
            'Poli KIA',
        ]);
        expect(
            options.data.find((row) => row.name === 'Poli Gigi')?.schedules,
        ).toMatchObject([{ id: clinic.dentalSchedule }]);

        // Poli bersama jadwal wajib memilih nakes dari jadwalnya.
        expect(
            await refused(
                await refer(destinationId, { section_id: clinic.dental }),
            ),
        ).toEqual({
            practice_schedule_id: [
                'Pilih nakes dari jadwal praktik hari ini di section ini.',
            ],
        });
        await json(await clinic.save(destinationId, {}), 200);
        const before = (await clinic.show(destinationId)).data.version;
        const referred = await json<{
            data: { version: number; discharge: Discharge };
        }>(
            await refer(destinationId, {
                section_id: clinic.dental,
                practice_schedule_id: clinic.dentalSchedule,
                note: 'Gigi berlubang',
            }),
            200,
        );
        expect(referred.data.discharge.status_id).toBe(
            statuses.RujukInternal!.id,
        );
        // Rujukan mengubah isi rekam medis, jadi layar yang memuat versi lama dipasang ulang.
        expect(referred.data.version).toBe(Number(before) + 1);
        const [referral] = referred.data.discharge.internal_referrals;
        expect(referral).toMatchObject({
            section_name: 'Poli Gigi',
            queue_code: 'G-001',
            practitioner_name: 'Dokter Gigi',
            status: 'menunggu',
            note: 'Gigi berlubang',
        });
        const second = await destination(referral!.id);
        expect(second).toMatchObject({
            status: 'menunggu',
            no_antrean: 1,
            kode_antrean: 'G-001',
            asal_tujuan_id: destinationId,
            nakes_id: clinic.dentist,
            urutan: 2,
        });
        expect(second.no_bukti).not.toBe(first.no_bukti);
        expect(second.no_bukti).toMatch(/-RJ-\d{8}$/);
        // Rujukan didaftarkan saat dirujuk, sesudah poli asal mulai memeriksa, seperti SIMtrDataRegPasien.Jam.
        expect(first.mulai_periksa_pada).not.toBeNull();
        expect(second.didaftarkan_pada >= first.mulai_periksa_pada!).toBe(true);
        expect(second.mulai_periksa_pada).toBeNull();
        const [schedule] = await pool.unsafe<{ jumlah_terdaftar: number }[]>(
            'select jumlah_terdaftar from sim_tr_jadwal_praktik where id = $1',
            [clinic.dentalSchedule],
        );
        expect(schedule?.jumlah_terdaftar).toBe(1);

        // Poli yang sudah ada di kunjungan, termasuk poli asal sendiri, ditolak dengan pesan sistem lama.
        for (const section of [clinic.dental, clinic.general])
            expect(
                await refused(
                    await refer(destinationId, {
                        section_id: section,
                        practice_schedule_id: clinic.dentalSchedule,
                    }),
                ),
            ).toEqual({
                section_id: ['Sudah Terdapat Data Pada Poli yang Sama.'],
            });

        // Rujukan tampil di antrean poli tujuan beserta poli asalnya.
        const queue = await json<{
            data: { id: string; referrer_section_name: string | null }[];
        }>(
            await clinic.admin.get(
                `${api}/examination/queue?section_id=${clinic.dental}&date=${clinic.today}`,
            ),
            200,
        );
        expect(queue.data).toContainEqual(
            expect.objectContaining({
                id: referral!.id,
                referrer_section_name: 'Poli Umum',
            }),
        );

        // Panggil berikutnya melewati rujukan yang poli asalnya belum selesai, dan Mulai periksa ditolak.
        expect(
            await refused(
                await clinic.admin.post(`${api}/examination/queue/call-next`, {
                    section_id: clinic.dental,
                    room_id: clinic.room,
                }),
            ),
        ).toEqual({
            section_id: ['Belum ada pasien yang menunggu di poli ini.'],
        });
        expect(await refused(await clinic.start(referral!.id))).toEqual({
            status: [
                'Tidak Dapat Memulai Pemeriksaan Karena Pemeriksaan Di Poli Umum Belum Selesai.',
            ],
        });

        // Poli asal selesai, kunjungan tetap terbuka karena rujukan belum diperiksa.
        await json(await clinic.examineBy(destinationId), 200);
        await json(await clinic.finish(destinationId), 200);
        expect(await visitStatus(visitId)).toBe('diperiksa');

        const called = await json<{ data: { id: string } }>(
            await clinic.admin.post(`${api}/examination/queue/call-next`, {
                section_id: clinic.dental,
                room_id: clinic.room,
            }),
            200,
        );
        expect(called.data.id).toBe(referral!.id);
        await json(await clinic.start(referral!.id), 200);
        // Catatan rujukan menjadi keluhan utama awal pemeriksaan rujukan.
        const opened = (await clinic.show(referral!.id)).data.anamnesis as {
            chief_complaint: string | null;
        };
        expect(opened.chief_complaint).toBe('Gigi berlubang');
        await json(await clinic.save(referral!.id, {}), 200);
        await json(await clinic.finish(referral!.id), 200);
        expect(await visitStatus(visitId)).toBe('selesai');
    });

    test('a referral to a poli without a schedule has no practitioner, and a status other than rujuk internal is refused', async () => {
        const { destinationId } = await started();
        expect(
            await refused(
                await refer(destinationId, {
                    section_id: clinic.lab,
                    status_id: statuses.RawatJalan!.id,
                }),
            ),
        ).toEqual({ status_id: ['Pilih status rujuk internal.'] });
        expect(
            await refused(
                await refer(destinationId, { section_id: Bun.randomUUIDv7() }),
            ),
        ).toEqual({ section_id: ['Pilih poli dari daftar.'] });
        const referred = await json<{ data: { discharge: Discharge } }>(
            await refer(destinationId, { section_id: clinic.lab }),
            200,
        );
        expect(referred.data.discharge.internal_referrals).toMatchObject([
            { section_name: 'Poli KIA', practitioner_name: null },
        ]);
    });

    test('a referral after Selesai periksa reopens the unpaid visit and takes it off the cashier list until the new poli finishes, and a paid visit refuses it', async () => {
        const { visitId, destinationId } = await started();
        await json(await clinic.examineBy(destinationId), 200);
        await json(await clinic.finish(destinationId), 200);
        const visit = async () =>
            (
                await pool.unsafe<{ status: string; finished: boolean }[]>(
                    'select status, selesai_pada is not null as finished from sim_tr_registrasi where id = $1',
                    [visitId],
                )
            )[0];
        expect(await visit()).toEqual({ status: 'selesai', finished: true });
        const cashier = await openCashier(pool, browser, clinic.tenantId);
        const payable = async () =>
            (
                await json<{ data: { id: string }[] }>(
                    await cashier.get(
                        `/api/v1/billing/visits?from=${clinic.today}&to=${clinic.today}`,
                    ),
                    200,
                )
            ).data.some((row) => row.id === visitId);
        expect(await payable()).toBe(true);

        const referred = await json<{ data: { discharge: Discharge } }>(
            await refer(destinationId, { section_id: clinic.lab }),
            200,
        );
        const [referral] = referred.data.discharge.internal_referrals;
        expect(referral).toMatchObject({
            section_name: 'Poli KIA',
            status: 'menunggu',
        });
        expect(await visit()).toEqual({ status: 'diperiksa', finished: false });
        expect(await payable()).toBe(false);
        expect(
            (
                await cashier.post(
                    `/api/v1/billing/visits/${visitId}/payments`,
                    { received: '0' },
                )
            ).status,
        ).toBe(404);
        const contract = await eventContract('healthcare.visit.reopened.v1');
        const sent = (
            await outboxEnvelopes(
                pool,
                clinic.tenantId,
                'healthcare.visit.reopened.v1',
            )
        ).filter((envelope) => envelope.data.visit_id === visitId);
        expect(sent).toHaveLength(1);
        expect(contract.safeParse(sent[0]).error).toBeUndefined();

        // Poli asal sudah selesai, jadi rujukan bisa langsung diperiksa; kunjungan selesai lagi dan kembali ke kasir.
        await json(await clinic.start(referral!.id), 200);
        await json(await clinic.examineBy(referral!.id), 200);
        await json(await clinic.finish(referral!.id), 200);
        expect(await visit()).toEqual({ status: 'selesai', finished: true });
        expect(await payable()).toBe(true);

        await json(
            await cashier.post(`/api/v1/billing/visits/${visitId}/payments`, {
                received: '0',
            }),
            201,
        );
        expect(
            await refused(
                await refer(destinationId, {
                    section_id: clinic.dental,
                    practice_schedule_id: clinic.dentalSchedule,
                }),
            ),
        ).toEqual({ status: [paid] });
        expect(await visit()).toEqual({ status: 'selesai', finished: true });
        expect(
            (await discharge(destinationId)).internal_referrals,
        ).toHaveLength(1);
    });

    test('a referral is refused before the examination starts', async () => {
        const { destinationId } = await clinic.visit();
        expect(
            await refused(
                await refer(destinationId, { section_id: clinic.lab }),
            ),
        ).toEqual({
            status: ['Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !'],
        });
    });

    test('another tenant cannot see or refer, and only examination.manage may refer', async () => {
        const { destinationId } = await started();
        const other = await createClinic(pool, browser, 'Klinik Uji Lain');
        expect(
            (
                await other.admin.get(
                    `${api}/examination/destinations/${destinationId}/internal-referrals/options`,
                )
            ).status,
        ).toBe(404);
        expect(
            (await refer(destinationId, { section_id: other.lab }, other.admin))
                .status,
        ).toBe(404);
        const reader = await login(pool, browser, clinic.tenantId, [
            'healthcare.examination.inquire',
        ]);
        expect(
            (
                await reader.get(
                    `${api}/examination/destinations/${destinationId}/internal-referrals/options`,
                )
            ).status,
        ).toBe(200);
        expect(
            (await refer(destinationId, { section_id: clinic.lab }, reader))
                .status,
        ).toBe(403);
        const outsider = await login(pool, browser, clinic.tenantId, []);
        expect(
            (
                await outsider.get(
                    `${api}/examination/destinations/${destinationId}/internal-referrals/options`,
                )
            ).status,
        ).toBe(403);
    });
});
