import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    api,
    createClinic,
    json,
    login,
    vitals,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Entry = { id: string; version: number };
type Line = {
    procedure_id: string;
    quantity: number;
    doctor_id: string | null;
    tariff?: string | null;
};
type StoredLine = {
    tarif: string;
    jenis_tarif: string;
    kelompok_harga_id: string | null;
    tindakan_harga_id: string | null;
};
type StoredComponent = {
    kode: string;
    qty: string;
    harga_awal: string;
    persen_pajak_titipan: string;
    persen_insentif: string;
    include_insentif: boolean;
    harga: string;
    deleted: boolean;
};
const pricing = '/api/v1/pricing';

// Tarif Biaya Tindakan: dihitung server dengan pencarian tarif sistem lama saat baris pertama kali disimpan, lalu
// dibekukan bersama komponennya, dan sama dengan tarif yang ditampilkan saat tindakan dipilih. Butuh PostgreSQL yang
// sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination procedure charges', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let clinic: Clinic;
    let groups: { general: string; bpjs: string };
    let types: { general: string; bpjs: string; none: string };
    let procedures: {
        injection: string;
        wound: string;
        unpriced: string;
        edited: string;
    };
    let rows: { injection: string; woundKtpOff: string; edited: string };

    const created = async (
        path: string,
        body: Record<string, unknown>,
        as = clinic.admin,
    ) => (await json<{ data: Entry }>(await as.post(path, body), 201)).data;

    // Kunjungan baru dengan tipe pasien itu, sudah Mulai periksa.
    async function examination(
        patientTypeId: string,
        patientId = clinic.patientId,
    ) {
        const registered = await json<{
            data: { destinations: { id: string }[] };
        }>(
            await clinic.admin.post(`${api}/visits`, {
                patient_id: patientId,
                patient_type_id: patientTypeId,
                visit_condition: 'sakit',
                section_id: clinic.general,
            }),
            201,
        );
        const id = registered.data.destinations[0]!.id;
        await json(await clinic.start(id), 200);
        return id;
    }

    const line = (procedureId: string, quantity = 1): Line => ({
        procedure_id: procedureId,
        quantity,
        doctor_id: clinic.doctor,
    });

    // Simpan seperti layar, dengan dokter Anamnesa terisi.
    async function saved(id: string, procedureLines: Line[]) {
        const current = await clinic.show(id);
        return json<{ data: { procedures: Line[] } }>(
            await clinic.admin.put(clinic.recordPath(id), {
                ...current.data,
                physical: {
                    ...(current.data.physical as object),
                    ...vitals,
                },
                anamnesis: {
                    ...(current.data.anamnesis as object),
                    doctor_id: clinic.doctor,
                },
                procedures: procedureLines,
            }),
            200,
        );
    }

    async function storedLines(id: string, procedureId: string) {
        return [
            ...(await pool.unsafe<StoredLine[]>(
                `select trim_scale(t.tarif)::text as tarif, t.jenis_tarif, t.kelompok_harga_id, t.tindakan_harga_id
             from sim_tr_pemeriksaan_tindakan t
             join sim_tr_pemeriksaan p on p.id = t.pemeriksaan_id
             where p.tujuan_id = $1 and t.tindakan_id = $2 and t.deleted_at is null`,
                [id, procedureId],
            )),
        ];
    }

    async function storedComponents(id: string, procedureId: string) {
        return [
            ...(await pool.unsafe<StoredComponent[]>(
                `select b.kode, trim_scale(c.qty)::text as qty, trim_scale(c.harga_awal)::text as harga_awal,
                    trim_scale(c.persen_pajak_titipan)::text as persen_pajak_titipan,
                    trim_scale(c.persen_insentif)::text as persen_insentif, c.include_insentif,
                    trim_scale(c.harga)::text as harga, c.deleted_at is not null as deleted
             from sim_tr_pemeriksaan_tindakan_komponen c
             join sim_tr_pemeriksaan_tindakan t on t.id = c.pemeriksaan_tindakan_id
             join sim_tr_pemeriksaan p on p.id = t.pemeriksaan_id
             join komponen_biaya b on b.id = c.komponen_biaya_id
             where p.tujuan_id = $1 and t.tindakan_id = $2
             order by b.kode`,
                [id, procedureId],
            )),
        ];
    }

    async function pickedTariff(id: string, procedureId: string) {
        return (
            await json<{ data: { tariff: string } }>(
                await clinic.admin.get(
                    `${api}/examination/destinations/${id}/procedure-tariff?procedure_id=${procedureId}`,
                ),
                200,
            )
        ).data.tariff;
    }

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji Tarif Tindakan');
        const pricer = await login(pool, browser, clinic.tenantId, [
            'core.pricing-setup.manage',
        ]);
        groups = {
            general: (
                await created(
                    `${pricing}/price-groups`,
                    { code: 'UMUM', name: 'Umum' },
                    pricer,
                )
            ).id,
            bpjs: (
                await created(
                    `${pricing}/price-groups`,
                    { code: 'BPJS', name: 'BPJS' },
                    pricer,
                )
            ).id,
        };
        const facility = await created(
            `${pricing}/charge-components`,
            { code: 'SARANA', name: 'Sarana', sort_order: 0 },
            pricer,
        );
        const [service] = await pool.unsafe<Entry[]>(
            "select id, version from komponen_biaya where tenant_id = $1 and kode = 'PELAYANAN'",
            [clinic.tenantId],
        );
        const patientType = async (
            code: string,
            body: Record<string, unknown>,
        ) =>
            (
                await created(`${api}/patient-types`, {
                    code,
                    name: code,
                    ...body,
                })
            ).id;
        types = {
            general: await patientType('T-UMUM', {
                price_group_id: groups.general,
            }),
            // BPJS sistem lama mencari baris tarif UMUM dan memakai harga BPJS-nya.
            bpjs: await patientType('T-BPJS', {
                price_group_id: groups.bpjs,
                procedure_tariff: 'bpjs',
                procedure_tariff_price_group_id: groups.general,
            }),
            none: await patientType('T-PEMDA', {
                price_group_id: groups.general,
                procedure_tariff: 'none',
            }),
        };
        const procedure = async (
            code: string,
            prices: Record<string, unknown>[],
        ) =>
            (
                await created(`${api}/procedures`, {
                    code,
                    name: `Tindakan ${code}`,
                    section_ids: [clinic.general],
                    prices: prices.map((price) => ({
                        new_price_date: '2026-11-01',
                        ...price,
                    })),
                })
            ).id;
        const facilityAt = (price: string) => ({
            charge_component_id: facility.id,
            quantity: '1',
            new_price: price,
        });
        procedures = {
            injection: await procedure('J-INJ', [
                {
                    price_group_id: groups.general,
                    components: [
                        {
                            charge_component_id: facility.id,
                            quantity: '2',
                            initial_price: '12000',
                            tax_deposit_percent: '2.5',
                            incentive_percent: '5',
                            includes_incentive: true,
                            new_price: '15000',
                            new_bpjs_price: '10000',
                            hc_incentive_percent: '7.5',
                        },
                        {
                            charge_component_id: service!.id,
                            quantity: '1',
                            new_price: '35000',
                            new_bpjs_price: '25000',
                        },
                    ],
                },
            ]),
            // Baris dokter pemeriksa, baris tanpa KTP (dibuat lebih dulu), dan baris KTP. Poli sistem lama tidak pernah
            // mengirim dokter dan KTP ke pencarian tarif, jadi baris dokter tidak pernah terpilih dan KTP tidak
            // menyaring: baris pertama yang cocok, yaitu baris tanpa KTP, yang dipakai.
            wound: await procedure('J-LUKA', [
                {
                    price_group_id: groups.general,
                    doctor_id: clinic.doctor,
                    components: [facilityAt('90000')],
                },
                {
                    price_group_id: groups.general,
                    ktp_patient: false,
                    components: [facilityAt('70000')],
                },
                {
                    price_group_id: groups.general,
                    ktp_patient: true,
                    components: [facilityAt('60000')],
                },
            ]),
            unpriced: await procedure('J-KOSONG', []),
            edited: await procedure('J-UBAH', [
                {
                    price_group_id: groups.general,
                    components: [facilityAt('15000')],
                },
            ]),
        };
        const priceRows = async (procedureId: string) =>
            (
                await pool.unsafe<{ id: string }[]>(
                    'select id from sim_m_tindakan_harga where tindakan_id = $1 order by id',
                    [procedureId],
                )
            ).map((row) => row.id);
        rows = {
            injection: (await priceRows(procedures.injection))[0]!,
            woundKtpOff: (await priceRows(procedures.wound))[1]!,
            edited: (await priceRows(procedures.edited))[0]!,
        };
    }, 120_000);

    test('adding a procedure stores the legacy tariff, the chosen row, the searched price group, and the components', async () => {
        const id = await examination(types.general);
        const shown = await saved(id, [line(procedures.injection, 3)]);
        expect(shown.data.procedures).toMatchObject([
            {
                procedure_id: procedures.injection,
                quantity: 3,
                tariff: '50000',
            },
        ]);
        expect(await storedLines(id, procedures.injection)).toEqual([
            {
                tarif: '50000',
                jenis_tarif: 'general',
                kelompok_harga_id: groups.general,
                tindakan_harga_id: rows.injection,
            },
        ]);
        expect(await storedComponents(id, procedures.injection)).toEqual([
            {
                kode: 'PELAYANAN',
                qty: '1',
                harga_awal: '0',
                persen_pajak_titipan: '0',
                persen_insentif: '0',
                include_insentif: false,
                harga: '35000',
                deleted: false,
            },
            {
                kode: 'SARANA',
                qty: '2',
                harga_awal: '12000',
                persen_pajak_titipan: '2.5',
                persen_insentif: '5',
                include_insentif: true,
                harga: '15000',
                deleted: false,
            },
        ]);
    });

    test('a BPJS patient type stores the BPJS price and the BPJS component values', async () => {
        const id = await examination(types.bpjs);
        await saved(id, [line(procedures.injection)]);
        expect(await storedLines(id, procedures.injection)).toEqual([
            {
                tarif: '35000',
                jenis_tarif: 'bpjs',
                kelompok_harga_id: groups.general,
                tindakan_harga_id: rows.injection,
            },
        ]);
        expect(
            (await storedComponents(id, procedures.injection)).map(
                (component) => [
                    component.kode,
                    component.harga,
                    component.persen_insentif,
                ],
            ),
        ).toEqual([
            ['PELAYANAN', '25000', '0'],
            ['SARANA', '10000', '7.5'],
        ]);
    });

    test('a patient type without tariff and a procedure without a matching row both store 0 without components', async () => {
        const none = await examination(types.none);
        await saved(none, [line(procedures.injection)]);
        expect(await storedLines(none, procedures.injection)).toEqual([
            {
                tarif: '0',
                jenis_tarif: 'none',
                kelompok_harga_id: null,
                tindakan_harga_id: null,
            },
        ]);
        expect(await storedComponents(none, procedures.injection)).toEqual([]);
        const general = await examination(types.general);
        const shown = await saved(general, [line(procedures.unpriced)]);
        expect(shown.data.procedures[0]?.tariff).toBe('0');
        expect(await storedLines(general, procedures.unpriced)).toEqual([
            {
                tarif: '0',
                jenis_tarif: 'general',
                kelompok_harga_id: groups.general,
                tindakan_harga_id: null,
            },
        ]);
        expect(await storedComponents(general, procedures.unpriced)).toEqual(
            [],
        );
    });

    test('the examining doctor and the visit KTP never reach the tariff lookup, like the old poly page', async () => {
        const nonKtpPatient = (
            await created(`${api}/patients`, {
                name: 'Pasien Tanpa KTP',
                nationality_country_code: 'AU',
                passport_number: `PK${Math.floor(Math.random() * 1e8)}`,
                gender: 'male',
                birth_date: '1990-04-05',
                phone: '081200000051',
                ktp_patient: false,
                domicile_address: { street: 'Jl. Uji No. 2' },
                payment_methods: [{ patient_type_id: types.general }],
            })
        ).id;
        for (const patientId of [clinic.patientId, nonKtpPatient]) {
            const id = await examination(types.general, patientId);
            await saved(id, [line(procedures.wound)]);
            expect(await storedLines(id, procedures.wound)).toEqual([
                {
                    tarif: '70000',
                    jenis_tarif: 'general',
                    kelompok_harga_id: groups.general,
                    tindakan_harga_id: rows.woundKtpOff,
                },
            ]);
        }
        const [visits] = await pool.unsafe<{ ktp: boolean[] }[]>(
            `select array_agg(distinct pasien_ktp) as ktp from sim_tr_registrasi
             where tenant_id = $1 and pasien_id = any($2::uuid[])`,
            [clinic.tenantId, `{${clinic.patientId},${nonKtpPatient}}`],
        );
        expect(visits?.ktp.sort()).toEqual([false, true]);
    });

    test('a saved line keeps its price and components through tariff edits, Qty and doctor changes', async () => {
        const id = await examination(types.general);
        await saved(id, [line(procedures.edited)]);
        const before = await storedComponents(id, procedures.edited);
        const shown = await json<{
            data: Record<string, unknown> & {
                prices: { components: Record<string, unknown>[] }[];
            };
        }>(
            await clinic.admin.get(`${api}/procedures/${procedures.edited}`),
            200,
        );
        await json(
            await clinic.admin.patch(`${api}/procedures/${procedures.edited}`, {
                ...shown.data,
                prices: shown.data.prices.map((price) => ({
                    ...price,
                    components: price.components.map((component) => ({
                        ...component,
                        new_price: '99000',
                    })),
                })),
            }),
            200,
        );
        expect(await pickedTariff(id, procedures.edited)).toBe('99000');
        const after = await saved(id, [
            { ...line(procedures.edited, 4), doctor_id: clinic.dentist },
        ]);
        expect(after.data.procedures).toMatchObject([
            { quantity: 4, doctor_id: clinic.dentist, tariff: '15000' },
        ]);
        expect(await storedLines(id, procedures.edited)).toEqual([
            {
                tarif: '15000',
                jenis_tarif: 'general',
                kelompok_harga_id: groups.general,
                tindakan_harga_id: rows.edited,
            },
        ]);
        expect(await storedComponents(id, procedures.edited)).toEqual(before);
        expect(before.map((component) => component.harga)).toEqual(['15000']);
    });

    test('removing a line soft-deletes its components with it', async () => {
        const id = await examination(types.general);
        await saved(id, [
            line(procedures.injection),
            line(procedures.unpriced),
        ]);
        const shown = await saved(id, [line(procedures.unpriced)]);
        expect(shown.data.procedures.map((row) => row.procedure_id)).toEqual([
            procedures.unpriced,
        ]);
        expect(
            (await storedComponents(id, procedures.injection)).map(
                (component) => [component.kode, component.deleted],
            ),
        ).toEqual([
            ['PELAYANAN', true],
            ['SARANA', true],
        ]);
    });

    test('the tariff shown when a procedure is picked is the one Simpan stores', async () => {
        for (const [type, expected] of [
            [types.general, '50000'],
            [types.bpjs, '35000'],
            [types.none, '0'],
        ] as const) {
            const id = await examination(type);
            expect(await pickedTariff(id, procedures.injection)).toBe(expected);
            const shown = await saved(id, [line(procedures.injection)]);
            expect(shown.data.procedures[0]?.tariff).toBe(expected);
        }
        const id = await examination(types.general);
        expect(await pickedTariff(id, procedures.unpriced)).toBe('0');
        expect(
            (
                await clinic.admin.get(
                    `${api}/examination/destinations/${id}/procedure-tariff?procedure_id=${Bun.randomUUIDv7()}`,
                )
            ).status,
        ).toBe(404);
    });
});
