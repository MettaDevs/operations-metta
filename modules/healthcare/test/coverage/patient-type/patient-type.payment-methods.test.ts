import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import type { Browser } from '../../../../../test/support/operations-app.ts';
import {
    api,
    createClinic,
    json,
    openCashier,
    refused,
    type Clinic,
} from '../../support/examination-fixture.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';

type PatientType = {
    id: string;
    version: number;
    payment_method_ids: string[];
    automatic_payment_method_ids: string[];
};
const patientTypeMessage =
    'Tidak Dapat Menggunakan Tipe Pembayaran, Karena berbeda tipe pasien';

// Jenis bayar per tipe pasien: jenis bayar yang dikhususkan tipe tertentu dan jenis bayar yang melunasi tagihan begitu
// kunjungan selesai. Pengaturannya disimpan di kartu tipe pasien, sampai ke kasir lewat potret kunjungan selesai, dan
// ditegakkan kasir. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('patient type payment methods', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let clinic: Clinic;
    let cashier: Browser;
    const methods: Record<string, string> = {};
    const types: Record<string, PatientType> = {};

    const typePath = `${api}/patient-types`;
    const saveType = (
        type: PatientType | null,
        body: Record<string, unknown>,
    ) =>
        type
            ? clinic.admin.patch(`${typePath}/${type.id}`, {
                  ...body,
                  version: type.version,
              })
            : clinic.admin.post(typePath, body);

    // Kunjungan pasien bertipe itu yang sudah Selesai periksa.
    async function completedVisit(patientTypeId: string) {
        const patientId = (
            await json<{ data: { id: string } }>(
                await clinic.admin.post(`${api}/patients`, {
                    name: 'Pasien Bayar',
                    nationality_country_code: 'AU',
                    passport_number: `P${Math.floor(Math.random() * 1e8)}`,
                    gender: 'female',
                    birth_date: '1985-02-03',
                    phone: '081200000051',
                    domicile_address: { street: 'Jl. Uji No. 2' },
                    payment_methods: [{ patient_type_id: patientTypeId }],
                }),
                201,
            )
        ).data.id;
        const registered = await json<{
            data: { id: string; destinations: { id: string }[] };
        }>(
            await clinic.admin.post(`${api}/visits`, {
                patient_id: patientId,
                patient_type_id: patientTypeId,
                visit_condition: 'sakit',
                section_id: clinic.general,
            }),
            201,
        );
        const destination = registered.data.destinations[0]!.id;
        await json(await clinic.start(destination), 200);
        await json(await clinic.examineBy(destination), 200);
        await json(await clinic.finish(destination), 200);
        return registered.data.id;
    }
    async function completion(visitId: string) {
        return (
            await outboxEnvelopes(
                pool,
                clinic.tenantId,
                'healthcare.visit.completed.v1',
            )
        ).filter((envelope) => envelope.data.visit_id === visitId);
    }

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji Jenis Bayar');
        cashier = await openCashier(pool, browser, clinic.tenantId);
        for (const method of [
            { code: 'PRS', behavior: 'penjamin', party: 'penjamin_kunjungan' },
            { code: 'BPJ', behavior: 'penjamin', party: 'penjamin_kunjungan' },
            { code: 'KRT', behavior: 'non_tunai', requires_merchant: true },
        ])
            methods[method.code] = (
                await json<{ data: { id: string } }>(
                    await cashier.post('/api/v1/billing/payment-methods', {
                        name: method.code,
                        ...method,
                    }),
                    201,
                )
            ).data.id;
        methods.TUN = (
            await pool.unsafe<{ id: string }[]>(
                "select id from jenis_bayar where tenant_id = $1 and kode = 'TUN'",
                [clinic.tenantId],
            )
        )[0]!.id;
    });

    test('a patient type keeps its reserved and automatic methods, and refuses automatic choices that cannot settle on their own', async () => {
        types.IKS = (
            await json<{ data: PatientType }>(
                await saveType(null, {
                    code: 'IKS',
                    name: 'Perusahaan',
                    payment_method_ids: [methods.PRS],
                }),
                201,
            )
        ).data;
        expect(types.IKS.payment_method_ids).toEqual([methods.PRS!]);
        const bpjs = {
            code: 'BPJS',
            name: 'BPJS',
            behaviors: ['settles_automatically'],
            payment_method_ids: [methods.BPJ],
        };
        for (const [automatic, message] of [
            [[], 'Pilih jenis bayar yang melunasi tagihan tipe ini.'],
            [
                [methods.TUN],
                'Pilih jenis bayar aktif yang tidak meminta isian kasir, misalnya bukan tunai atau kartu.',
            ],
            [
                [methods.KRT],
                'Pilih jenis bayar aktif yang tidak meminta isian kasir, misalnya bukan tunai atau kartu.',
            ],
            [
                [methods.BPJ, methods.PRS],
                'Pilih paling banyak satu jenis bayar otomatis per legal entity.',
            ],
            [
                [methods.PRS],
                'Jenis bayar ini khusus tipe pasien lain. Tambahkan juga ke Jenis bayar khusus tipe ini.',
            ],
        ] as const)
            expect(
                await refused(
                    await saveType(null, {
                        ...bpjs,
                        automatic_payment_method_ids: automatic,
                    }),
                ),
            ).toEqual({ automatic_payment_method_ids: [message] });
        expect(
            await refused(
                await saveType(null, {
                    code: 'UMUM2',
                    name: 'Umum',
                    automatic_payment_method_ids: [methods.BPJ],
                }),
            ),
        ).toEqual({
            automatic_payment_method_ids: [
                'Jenis bayar otomatis hanya untuk tipe yang lunas otomatis di kasir.',
            ],
        });
        types.BPJS = (
            await json<{ data: PatientType }>(
                await saveType(null, {
                    ...bpjs,
                    automatic_payment_method_ids: [methods.BPJ],
                }),
                201,
            )
        ).data;
        expect(types.BPJS.automatic_payment_method_ids).toEqual([methods.BPJ!]);
        // Jenis bayar yang tidak dipilih lagi dilepas.
        const released = await json<{ data: PatientType }>(
            await saveType(types.IKS, {
                code: 'IKS',
                name: 'Perusahaan',
                payment_method_ids: [],
            }),
            200,
        );
        expect(released.data.payment_method_ids).toEqual([]);
        types.IKS = (
            await json<{ data: PatientType }>(
                await saveType(released.data, {
                    code: 'IKS',
                    name: 'Perusahaan',
                    payment_method_ids: [methods.PRS],
                }),
                200,
            )
        ).data;
    });

    test('a visit of another type reaches the cashier with the reserved methods, which the cashier refuses', async () => {
        const visitId = await completedVisit(
            (
                await pool.unsafe<{ id: string }[]>(
                    "select id from sim_m_tipe_pasien where tenant_id = $1 and kode = 'UMUM'",
                    [clinic.tenantId],
                )
            )[0]!.id,
        );
        const [sent] = await completion(visitId);
        const contract = await eventContract('healthcare.visit.completed.v1');
        expect(contract.safeParse(sent).error).toBeUndefined();
        expect(
            [...(sent?.data.restricted_payment_method_ids as string[])].sort(),
        ).toEqual([methods.BPJ!, methods.PRS!].sort());
        expect(sent?.data.automatic_payment_method_id).toBeNull();
        expect(
            await refused(
                await cashier.post(
                    `/api/v1/billing/visits/${visitId}/payments`,
                    {
                        lines: [
                            { payment_method_id: methods.PRS, amount: '0' },
                        ],
                    },
                ),
            ),
        ).toEqual({ 'lines.0.amount': [patientTypeMessage] });
    });

    test('a visit of a type that settles automatically is paid with its method as soon as it completes', async () => {
        const visitId = await completedVisit(types.BPJS!.id);
        const [sent] = await completion(visitId);
        expect(sent?.data).toMatchObject({
            restricted_payment_method_ids: [methods.PRS],
            automatic_payment_method_id: methods.BPJ,
        });
        const payments = await pool.unsafe<
            { otomatis: boolean; status: string }[]
        >(
            'select otomatis, status from kasir where tenant_id = $1 and kunjungan_id = $2',
            [clinic.tenantId, visitId],
        );
        expect([...payments]).toEqual([
            { otomatis: true, status: 'diposting' },
        ]);
    });
});
