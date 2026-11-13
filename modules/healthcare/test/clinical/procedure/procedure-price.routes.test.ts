import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createTenant,
    entitle,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createClinic,
    json,
    login,
    refused,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Component = {
    charge_component_id: string;
    charge_component_code: string;
    new_price: string;
    previous_price: string;
};
type Price = {
    id: string;
    price_group_name: string;
    care_class_name: string | null;
    specialty_name: string | null;
    doctor_name: string | null;
    operation_category_name: string | null;
    location: string;
    previous_price: string;
    new_price: string;
    new_hc_price: string;
    new_bpjs_price: string;
    new_price_date: string;
    new_bpjs_price_date: string | null;
    components: Component[];
};
type Procedure = { id: string; version: number; prices: Price[] };
type Entry = { id: string; version: number };

const pricing = '/api/v1/pricing';

// Tab Detail Harga kartu Jasa sistem lama (SIMdListHarga dan SIMdListHargaDetail) di kartu tindakan: baris harga dan
// komponennya disimpan bersama tindakan, harga baris adalah jumlah harga komponennya, dan master yang dipakai harga
// tidak bisa dihapus.
describe.skipIf(!process.env.DB_HOST)('procedure price tab', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let clinic: Clinic;
    let pricer: Browser;
    let groups: { general: Entry; insurance: Entry };
    let components: { facility: Entry; service: Entry };
    let careClass: Entry;
    let operationCategory: Entry;
    let specialty: Entry;
    let sequence = 0;

    const created = async <T = Entry>(
        as: Browser,
        path: string,
        body: Record<string, unknown>,
    ) => (await json<{ data: T }>(await as.post(path, body), 201)).data;
    const procedure = (prices: unknown[]) =>
        created<Procedure>(clinic.admin, `${api}/procedures`, {
            code: `J-HRG${++sequence}`,
            name: `Tindakan harga ${sequence}`,
            prices,
        });
    const update = (saved: Procedure, prices: unknown[]) =>
        clinic.admin.patch(`${api}/procedures/${saved.id}`, {
            code: `J-HRG-${saved.id.slice(-6)}`,
            name: 'Tindakan harga diubah',
            prices,
            version: saved.version,
        });
    const general = (componentRows: unknown[]) => ({
        price_group_id: groups.general.id,
        new_price_date: '2026-11-13',
        components: componentRows,
    });
    const sums = async (procedureId: string) => [
        ...(await pool.unsafe<
            {
                header: string;
                summed: string;
                header_hc: string;
                summed_hc: string;
                header_bpjs: string;
                summed_bpjs: string;
                header_old: string;
                summed_old: string;
            }[]
        >(
            `select h.harga_baru::text as header, coalesce(sum(k.harga_baru), 0)::text as summed,
                    h.harga_hc_baru::text as header_hc, coalesce(sum(k.harga_hc_baru), 0)::text as summed_hc,
                    h.harga_bpjs::text as header_bpjs, coalesce(sum(k.harga_bpjs), 0)::text as summed_bpjs,
                    h.harga_lama::text as header_old, coalesce(sum(k.harga_lama), 0)::text as summed_old
             from sim_m_tindakan_harga h
             left join sim_m_tindakan_harga_komponen k on k.tindakan_harga_id = h.id and k.deleted_at is null
             where h.tindakan_id = $1 and h.deleted_at is null
             group by h.id order by h.id`,
            [procedureId],
        )),
    ];

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji Detail Harga');
        pricer = await login(pool, browser, clinic.tenantId, [
            'core.pricing-setup.manage',
        ]);
        groups = {
            general: await created(pricer, `${pricing}/price-groups`, {
                code: 'UMUM',
                name: 'Umum',
            }),
            insurance: await created(pricer, `${pricing}/price-groups`, {
                code: 'ASR',
                name: 'Asuransi',
            }),
        };
        const [service] = await pool.unsafe<Entry[]>(
            "select id, version from komponen_biaya where tenant_id = $1 and kode = 'PELAYANAN'",
            [clinic.tenantId],
        );
        components = {
            facility: await created(pricer, `${pricing}/charge-components`, {
                code: 'SARANA',
                name: 'Sarana',
                sort_order: 0,
            }),
            service: service!,
        };
        const lists = `${api}/diagnosis-references`;
        careClass = await created(clinic.admin, `${lists}/care-classes`, {
            code: 'K1',
            name: 'Kelas 1',
        });
        operationCategory = await created(
            clinic.admin,
            `${lists}/operation-categories`,
            { code: 'KCL', name: 'Kecil' },
        );
        specialty = await created(clinic.admin, `${api}/specialties`, {
            name: 'Bedah',
            subspecialties: [],
        });
    }, 120_000);

    test('two price rows keep their components, and each row price is the plain sum of its components', async () => {
        const metadata = await json<{
            price_groups: { code: string }[];
            doctors: { id: string }[];
            charge_components: { code: string }[];
        }>(await clinic.admin.get(`${api}/procedures/metadata`), 200);
        expect(metadata.price_groups.map((group) => group.code)).toEqual([
            'ASR',
            'UMUM',
        ]);
        expect(metadata.doctors.map((doctor) => doctor.id)).toContain(
            clinic.doctor,
        );
        expect(metadata.doctors.map((doctor) => doctor.id)).not.toContain(
            clinic.nurse,
        );

        const saved = await procedure([
            {
                ...general([
                    {
                        charge_component_id: components.facility.id,
                        quantity: '2',
                        previous_price: '10000',
                        new_price: '15000',
                        new_hc_price: '14000',
                        new_bpjs_price: '12000.25',
                    },
                    {
                        charge_component_id: components.service.id,
                        quantity: '1',
                        previous_price: '30000',
                        new_price: '35000.5',
                        new_hc_price: '33000',
                        new_bpjs_price: '30000',
                    },
                ]),
                // Harga baris tidak diterima dari pemanggil: yang tersimpan jumlah komponennya.
                new_price: '1',
            },
            {
                price_group_id: groups.insurance.id,
                care_class_id: careClass.id,
                specialty_id: specialty.id,
                sub_specialty: true,
                doctor_id: clinic.doctor,
                operation_category_id: operationCategory.id,
                ktp_patient: false,
                cito: true,
                location: 'UGD',
                detail_incentive: '2500',
                hc_discount_percent: '12.5',
                new_price_date: '2026-11-01',
                new_bpjs_price_date: '2026-12-01',
                components: [
                    {
                        charge_component_id: components.facility.id,
                        quantity: '1',
                        new_price: '20000',
                    },
                ],
            },
        ]);
        expect(
            saved.prices.map((price) => ({
                group: price.price_group_name,
                care_class: price.care_class_name,
                specialty: price.specialty_name,
                doctor: price.doctor_name,
                operation_category: price.operation_category_name,
                location: price.location,
                new_price: price.new_price,
                components: price.components.map(
                    (component) => component.charge_component_code,
                ),
            })),
        ).toEqual([
            {
                group: 'Umum',
                care_class: null,
                specialty: null,
                doctor: null,
                operation_category: null,
                location: 'RJ',
                new_price: '50000.5',
                components: ['SARANA', 'PELAYANAN'],
            },
            {
                group: 'Asuransi',
                care_class: 'Kelas 1',
                specialty: 'Bedah',
                doctor: 'Dokter Umum',
                operation_category: 'Kecil',
                location: 'UGD',
                new_price: '20000',
                components: ['SARANA'],
            },
        ]);
        expect(await sums(saved.id)).toEqual([
            {
                header: '50000.5000',
                summed: '50000.5000',
                header_hc: '47000.0000',
                summed_hc: '47000.0000',
                header_bpjs: '42000.2500',
                summed_bpjs: '42000.2500',
                header_old: '40000.0000',
                summed_old: '40000.0000',
            },
            {
                header: '20000.0000',
                summed: '20000.0000',
                header_hc: '0.0000',
                summed_hc: '0.0000',
                header_bpjs: '0.0000',
                summed_bpjs: '0.0000',
                header_old: '0.0000',
                summed_old: '0.0000',
            },
        ]);
        const [stored] = await pool.unsafe<
            {
                pasien_ktp: boolean;
                cyto: boolean;
                sub_spesialis: boolean;
                disc_hc_umum: string;
                insentif_detail: string;
                tgl_harga_baru_bpjs: string;
            }[]
        >(
            `select pasien_ktp, cyto, sub_spesialis, disc_hc_umum::text, insentif_detail::text,
                    tgl_harga_baru_bpjs::text
             from sim_m_tindakan_harga where tindakan_id = $1 and kelas_id is not null`,
            [saved.id],
        );
        expect(stored).toEqual({
            pasien_ktp: false,
            cyto: true,
            sub_spesialis: true,
            disc_hc_umum: '12.5000',
            insentif_detail: '2500.0000',
            tgl_harga_baru_bpjs: '2026-12-01',
        });
        const shown = await json<{ data: Procedure }>(
            await clinic.admin.get(`${api}/procedures/${saved.id}`),
            200,
        );
        expect(shown.data.prices).toEqual(saved.prices);
    });

    test('a component Harga Baru is stored as typed, not recomputed from Harga Awal and the percents', async () => {
        const saved = await procedure([
            general([
                {
                    charge_component_id: components.facility.id,
                    quantity: '1',
                    initial_price: '10000',
                    incentive_percent: '10',
                    tax_deposit_percent: '2.5',
                    new_price: '9000',
                },
            ]),
        ]);
        const [row] = await pool.unsafe<
            { harga_baru: string; harga_awal: string; header: string }[]
        >(
            `select k.harga_baru::text, k.harga_awal::text, h.harga_baru::text as header
             from sim_m_tindakan_harga_komponen k join sim_m_tindakan_harga h on h.id = k.tindakan_harga_id
             where h.tindakan_id = $1`,
            [saved.id],
        );
        expect(row).toEqual({
            harga_baru: '9000.0000',
            harga_awal: '10000.0000',
            header: '9000.0000',
        });
    });

    test('a row or a component left out of the card gets deleted_at, and the row price follows its live components', async () => {
        const saved = await procedure([
            general([
                {
                    charge_component_id: components.facility.id,
                    quantity: '1',
                    new_price: '15000',
                },
                {
                    charge_component_id: components.service.id,
                    quantity: '1',
                    new_price: '35000',
                },
            ]),
            {
                ...general([
                    {
                        charge_component_id: components.facility.id,
                        quantity: '1',
                        new_price: '1000',
                    },
                ]),
                price_group_id: groups.insurance.id,
            },
        ]);
        const [kept, dropped] = saved.prices;
        const updated = await json<{ data: Procedure }>(
            await update(saved, [
                {
                    ...general([
                        {
                            charge_component_id: components.facility.id,
                            quantity: '1',
                            new_price: '15000',
                        },
                    ]),
                    id: kept!.id,
                },
            ]),
            200,
        );
        expect(updated.data.prices.map((price) => price.id)).toEqual([
            kept!.id,
        ]);
        const rows = await pool.unsafe<
            { harga: string; komponen: string | null; live: boolean }[]
        >(
            `select h.id as harga, b.kode as komponen, k.deleted_at is null as live
             from sim_m_tindakan_harga h
             join sim_m_tindakan_harga_komponen k on k.tindakan_harga_id = h.id
             join komponen_biaya b on b.id = k.komponen_biaya_id
             where h.tindakan_id = $1 order by h.id, b.kode`,
            [saved.id],
        );
        expect([...rows]).toEqual([
            { harga: kept!.id, komponen: 'PELAYANAN', live: false },
            { harga: kept!.id, komponen: 'SARANA', live: true },
            { harga: dropped!.id, komponen: 'SARANA', live: false },
        ]);
        const [droppedRow] = await pool.unsafe<{ live: boolean }[]>(
            'select deleted_at is null as live from sim_m_tindakan_harga where id = $1',
            [dropped!.id],
        );
        expect(droppedRow?.live).toBe(false);
        expect((await sums(saved.id)).map((row) => row.header)).toEqual([
            '15000.0000',
        ]);

        // Komponen yang dibuang boleh dipasang lagi di baris yang sama.
        await json(
            await update(updated.data, [
                {
                    ...general([
                        {
                            charge_component_id: components.facility.id,
                            quantity: '1',
                            new_price: '15000',
                        },
                        {
                            charge_component_id: components.service.id,
                            quantity: '1',
                            new_price: '5000',
                        },
                    ]),
                    id: kept!.id,
                },
            ]),
            200,
        );
        expect((await sums(saved.id)).map((row) => row.header)).toEqual([
            '20000.0000',
        ]);
    });

    test('a component repeated within one row, an unknown Lokasi, and a missing Tipe Pasien are refused per field', async () => {
        const errors = await refused(
            await clinic.admin.post(`${api}/procedures`, {
                code: 'J-HRG-SALAH',
                name: 'Salah',
                prices: [
                    {
                        ...general([
                            {
                                charge_component_id: components.facility.id,
                                quantity: '1',
                            },
                            {
                                charge_component_id: components.facility.id,
                                quantity: '1',
                            },
                        ]),
                        location: 'POLI',
                    },
                    { new_price_date: '2026-11-13', components: [] },
                ],
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'prices.0.components.1.charge_component_id',
            'prices.0.location',
            'prices.1.price_group_id',
        ]);
        const [count] = await pool.unsafe<{ count: number }[]>(
            "select count(*)::int as count from sim_m_tindakan where tenant_id = $1 and kode = 'J-HRG-SALAH'",
            [clinic.tenantId],
        );
        expect(count?.count).toBe(0);
    });

    test('a key of another tenant, a nurse as doctor, a row of another procedure, and an inactive key not held are refused per field', async () => {
        const other = await createTenant(pool, 'Klinik Detail Harga Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await login(pool, browser, other, [
            'healthcare.clinical-setup.manage',
        ]);
        const foreignClass = await created(
            stranger,
            `${api}/diagnosis-references/care-classes`,
            { code: 'VIP', name: 'VIP' },
        );
        const [foreignComponent] = await pool.unsafe<{ id: string }[]>(
            'select id from komponen_biaya where tenant_id = $1',
            [other],
        );
        const elsewhere = await procedure([
            general([
                {
                    charge_component_id: components.facility.id,
                    quantity: '1',
                },
            ]),
        ]);
        const held = await procedure([
            {
                ...general([]),
                operation_category_id: operationCategory.id,
            },
        ]);
        await json(
            await clinic.admin.patch(
                `${api}/diagnosis-references/operation-categories/${operationCategory.id}`,
                {
                    code: 'KCL',
                    name: 'Kecil',
                    is_active: false,
                    version: operationCategory.version,
                },
            ),
            200,
        );
        expect(
            await refused(
                await clinic.admin.post(`${api}/procedures`, {
                    code: 'J-HRG-ASING',
                    name: 'Asing',
                    prices: [
                        {
                            ...general([
                                {
                                    charge_component_id: foreignComponent!.id,
                                    quantity: '1',
                                },
                            ]),
                            care_class_id: foreignClass.id,
                            doctor_id: clinic.nurse,
                            operation_category_id: operationCategory.id,
                        },
                    ],
                }),
            ),
        ).toEqual({
            'prices.0.care_class_id': [
                'Baris harga 1: pilih kelas dari daftar.',
            ],
            'prices.0.doctor_id': ['Baris harga 1: pilih dokter dari daftar.'],
            'prices.0.operation_category_id': [
                'Baris harga 1: pilih kategori operasi dari daftar.',
            ],
            'prices.0.components.0.charge_component_id': [
                'Baris harga 1, komponen 1: pilih komponen dari daftar.',
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await update(held, [
                        { ...general([]), id: elsewhere.prices[0]!.id },
                    ]),
                ),
            ),
        ).toEqual(['prices.0.id']);
        // Baris yang sudah memegang kategori operasi nonaktif tetap boleh disimpan.
        await json(
            await update(held, [
                {
                    ...general([]),
                    id: held.prices[0]!.id,
                    operation_category_id: operationCategory.id,
                },
            ]),
            200,
        );
    }, 60_000);

    test('masters used by a live price row cannot be deleted until the procedure holding it is deleted', async () => {
        const lists = `${api}/diagnosis-references`;
        const doctorClass = await created(
            clinic.admin,
            `${lists}/care-classes`,
            { code: 'K2', name: 'Kelas 2' },
        );
        const category = await created(
            clinic.admin,
            `${lists}/operation-categories`,
            { code: 'BSR', name: 'Besar' },
        );
        const surgery = await created(clinic.admin, `${api}/specialties`, {
            name: 'Ortopedi',
            subspecialties: [],
        });
        const group = await created(pricer, `${pricing}/price-groups`, {
            code: 'IKS',
            name: 'Kerja sama',
        });
        const component = await created(
            pricer,
            `${pricing}/charge-components`,
            { code: 'ALAT', name: 'Alat', sort_order: 2 },
        );
        const [doctor] = await pool.unsafe<Entry[]>(
            'select id, version from sim_m_nakes where id = $1',
            [clinic.dentist],
        );
        const saved = await procedure([
            {
                price_group_id: group.id,
                care_class_id: doctorClass.id,
                specialty_id: surgery.id,
                doctor_id: doctor!.id,
                operation_category_id: category.id,
                new_price_date: '2026-11-13',
                components: [
                    { charge_component_id: component.id, quantity: '1' },
                ],
            },
        ]);
        const deletes = [
            {
                as: clinic.admin,
                path: `${lists}/care-classes/${doctorClass.id}`,
                version: doctorClass.version,
            },
            {
                as: clinic.admin,
                path: `${lists}/operation-categories/${category.id}`,
                version: category.version,
            },
            {
                as: clinic.admin,
                path: `${api}/specialties/${surgery.id}`,
                version: surgery.version,
            },
            {
                as: clinic.admin,
                path: `${api}/practitioners/${doctor!.id}`,
                version: doctor!.version,
            },
            {
                as: pricer,
                path: `${pricing}/price-groups/${group.id}`,
                version: group.version,
            },
            {
                as: pricer,
                path: `${pricing}/charge-components/${component.id}`,
                version: component.version,
            },
        ];
        for (const target of deletes)
            expect(
                (
                    await target.as.delete(target.path, {
                        version: target.version,
                    })
                ).status,
            ).toBe(422);

        expect(
            (
                await clinic.admin.delete(`${api}/procedures/${saved.id}`, {
                    version: saved.version,
                })
            ).status,
        ).toBe(204);
        const [left] = await pool.unsafe<{ prices: number; parts: number }[]>(
            `select count(*) filter (where h.deleted_at is null)::int as prices,
                    count(k.id) filter (where k.deleted_at is null)::int as parts
             from sim_m_tindakan_harga h
             left join sim_m_tindakan_harga_komponen k on k.tindakan_harga_id = h.id
             where h.tindakan_id = $1`,
            [saved.id],
        );
        expect(left).toEqual({ prices: 0, parts: 0 });
        for (const target of deletes)
            expect(
                (
                    await target.as.delete(target.path, {
                        version: target.version,
                    })
                ).status,
            ).toBe(204);
    }, 60_000);

    test('a reader sees the price tab but cannot save prices', async () => {
        const saved = await procedure([
            general([
                {
                    charge_component_id: components.facility.id,
                    quantity: '1',
                    new_price: '7000',
                },
            ]),
        ]);
        const reader = await login(pool, browser, clinic.tenantId, [
            'healthcare.clinical-setup.inquire',
        ]);
        const shown = await json<{ data: Procedure }>(
            await reader.get(`${api}/procedures/${saved.id}`),
            200,
        );
        expect(shown.data.prices.map((price) => price.new_price)).toEqual([
            '7000',
        ]);
        expect(
            (
                await reader.patch(`${api}/procedures/${saved.id}`, {
                    code: 'J-BACA',
                    name: 'Dibaca saja',
                    prices: [],
                    version: saved.version,
                })
            ).status,
        ).toBe(403);
        const [live] = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_m_tindakan_harga where tindakan_id = $1 and deleted_at is null',
            [saved.id],
        );
        expect(live?.count).toBe(1);
    });
});
