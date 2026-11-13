import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from '../../../../../src/platform/database/index.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    ProcedurePrices,
    type ProcedurePriceLookupInput,
} from '../../../src/clinical/procedure/procedure-price.service.ts';
import {
    api,
    createClinic,
    json,
    login,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Entry = { id: string; version: number };
const pricing = '/api/v1/pricing';

// Pemuat pencarian tarif jasa: membaca setelan tipe pasien, spesialis nakes, dan baris harga tindakan dari database,
// lalu mengembalikan baris terpilih beserta komponennya seperti GetDetailKomponenTarif* sistem lama.
describe.skipIf(!process.env.DB_HOST)('procedure price lookup', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let clinic: Clinic;
    let procedureId: string;
    let rows: { wildcard: string; surgery: string };
    let groups: { general: string; foreign: string };
    let types: Record<
        'general' | 'bpjs' | 'none' | 'foreignOwn' | 'foreign',
        string
    >;

    const created = async (
        path: string,
        body: Record<string, unknown>,
        as = clinic.admin,
    ) => (await json<{ data: Entry }>(await as.post(path, body), 201)).data;

    const lookup = async (
        patientTypeId: string,
        input: Partial<ProcedurePriceLookupInput> = {},
    ) => {
        const connection = await pool.reserve();
        try {
            return await new ProcedurePrices(
                new Database(connection, undefined, 'uji'),
                clinic.tenantId,
            ).lookup({
                procedureId,
                patientTypeId,
                practitionerId: null,
                careClassId: null,
                ktpPatient: false,
                location: 'RJ',
                ...input,
            });
        } finally {
            connection.release();
        }
    };

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji Cari Tarif');
        const pricer = await login(pool, browser, clinic.tenantId, [
            'core.pricing-setup.manage',
        ]);
        const general = await created(
            `${pricing}/price-groups`,
            { code: 'UMUM', name: 'Umum' },
            pricer,
        );
        const bpjs = await created(
            `${pricing}/price-groups`,
            { code: 'BPJS', name: 'BPJS' },
            pricer,
        );
        const foreign = await created(
            `${pricing}/price-groups`,
            { code: 'WNA', name: 'WNA' },
            pricer,
        );
        groups = { general: general.id, foreign: foreign.id };
        const facility = await created(
            `${pricing}/charge-components`,
            { code: 'SARANA', name: 'Sarana', sort_order: 0 },
            pricer,
        );
        const [service] = await pool.unsafe<Entry[]>(
            "select id, version from komponen_biaya where tenant_id = $1 and kode = 'PELAYANAN'",
            [clinic.tenantId],
        );
        const surgery = await created(`${api}/specialties`, {
            name: 'Bedah',
            subspecialties: [],
        });
        await pool.unsafe(
            'update sim_m_nakes set spesialisasi_id = $1 where id = $2',
            [surgery.id, clinic.doctor],
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
                price_group_id: general.id,
            }),
            // BPJS sistem lama memakai baris tarif UMUM (JenisPasienID 3) dengan harga BPJS-nya.
            bpjs: await patientType('T-BPJS', {
                price_group_id: bpjs.id,
                procedure_tariff: 'bpjs',
                procedure_tariff_price_group_id: general.id,
            }),
            none: await patientType('T-PEMDA', {
                price_group_id: general.id,
                procedure_tariff: 'none',
            }),
            foreignOwn: await patientType('T-WNA-S', {
                price_group_id: foreign.id,
                procedure_tariff: 'general_own_group',
            }),
            foreign: await patientType('T-WNA-K', {
                price_group_id: foreign.id,
            }),
        };
        const components = [
            {
                charge_component_id: facility.id,
                quantity: '1',
                previous_price: '10000',
                new_price: '15000',
                incentive_percent: '5',
                previous_bpjs_price: '9000',
                new_bpjs_price: '12000',
                hc_incentive_percent: '7.5',
            },
            {
                charge_component_id: service!.id,
                quantity: '1',
                previous_price: '30000',
                new_price: '35000',
                new_bpjs_price: '30000',
            },
        ];
        const procedure = await created(`${api}/procedures`, {
            code: 'J-CARI',
            name: 'Tindakan cari tarif',
            prices: [
                {
                    price_group_id: general.id,
                    location: 'XX',
                    new_price_date: '2026-11-01',
                    components,
                },
                {
                    price_group_id: general.id,
                    specialty_id: surgery.id,
                    new_price_date: '2026-11-02',
                    new_bpjs_price_date: '2026-11-03',
                    components: [components[0]],
                },
            ],
        });
        procedureId = procedure.id;
        const [wildcard, surgeryRow] = await pool.unsafe<{ id: string }[]>(
            'select id from sim_m_tindakan_harga where tindakan_id = $1 order by id',
            [procedureId],
        );
        rows = { wildcard: wildcard!.id, surgery: surgeryRow!.id };
    }, 120_000);

    test('without a doctor only the ALL specialty row is found, with its components in code order', async () => {
        const found = await lookup(types.general);
        expect(found?.step).toBe('class_doctor_specialty');
        expect(found?.price).toMatchObject({
            kind: 'general',
            priceRowId: rows.wildcard,
            price: '50000.0000',
            previousPrice: '40000.0000',
            priceDate: '2026-11-01',
        });
        expect(
            found?.price?.components.map((component) => [
                component.chargeComponentCode,
                component.price,
                component.previousPrice,
                component.incentivePercent,
            ]),
        ).toEqual([
            ['PELAYANAN', '35000.0000', '30000.0000', '0.0000'],
            ['SARANA', '15000.0000', '10000.0000', '5.0000'],
        ]);
    });

    test("the examining doctor's specialty brings in the specialty row, which sorts before XX", async () => {
        const found = await lookup(types.general, {
            practitionerId: clinic.doctor,
        });
        expect(found?.step).toBe('class_specialty');
        expect(found?.price?.priceRowId).toBe(rows.surgery);
        expect(found?.price?.price).toBe('15000.0000');
        // Lokasi kosong tidak menyaring dan tetap mengurutkan menurut kode lokasi.
        const any = await lookup(types.general, {
            practitionerId: clinic.doctor,
            location: null,
        });
        expect(any?.price?.priceRowId).toBe(rows.surgery);
    });

    test('a BPJS patient type searches the general rows through its tariff price group and gets BPJS prices', async () => {
        const found = await lookup(types.bpjs);
        expect(found).toMatchObject({
            tariff: 'bpjs',
            priceGroupId: groups.general,
        });
        expect(found?.price).toMatchObject({
            kind: 'bpjs',
            priceRowId: rows.wildcard,
            price: '42000.0000',
            previousPrice: '9000.0000',
            priceDate: null,
        });
        expect(
            found?.price?.components.map((component) => [
                component.chargeComponentCode,
                component.price,
                component.previousPrice,
                component.incentivePercent,
            ]),
        ).toEqual([
            ['PELAYANAN', '30000.0000', '0.0000', '0.0000'],
            ['SARANA', '12000.0000', '9000.0000', '7.5000'],
        ]);
    });

    test('a patient type without tariff gets no price', async () => {
        expect(await lookup(types.none)).toEqual({
            tariff: 'none',
            priceGroupId: null,
            step: null,
            price: null,
        });
    });

    test('a price group without rows borrows another group only when the tariff allows it', async () => {
        expect(await lookup(types.foreignOwn)).toEqual({
            tariff: 'general_own_group',
            priceGroupId: groups.foreign,
            step: 'price_group',
            price: null,
        });
        const borrowed = await lookup(types.foreign);
        expect(borrowed?.step).toBe('any_price_group');
        // Kedua baris UMUM terpilih; baris berlokasi RJ lebih dulu dari XX.
        expect(borrowed?.price?.priceRowId).toBe(rows.surgery);
    });

    test('an unknown procedure or patient type gives nothing', async () => {
        expect(
            await lookup(types.general, { procedureId: Bun.randomUUIDv7() }),
        ).toBeNull();
        expect(await lookup(Bun.randomUUIDv7())).toBeNull();
    });
});
