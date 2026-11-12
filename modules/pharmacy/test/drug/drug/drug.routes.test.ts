import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { recordInstallation } from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    json,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type DrugClass = { id: string; code: string; name: string; version: number };
type Drug = {
    id: string;
    code: string;
    drug_class: { id: string; code: string } | null;
    is_generic: boolean;
    is_formulary: boolean;
    version: number;
};

// Golongan obat adalah data acuan per legal entity yang diisi saat module dipasang, bukan daftar di kode; data obat
// farmasi adalah perluasan barang Core yang lahir saat pertama kali disimpan. Butuh PostgreSQL yang sudah dimigrasi;
// dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'drug classes and pharmacy drug data',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);
        let pharmacy: Pharmacy;

        beforeAll(async () => {
            pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Obat');
        });

        const classes = async (as = pharmacy) =>
            (
                await json<{ data: DrugClass[] }>(
                    await as.admin.get(`${api}/drug-classes`),
                    200,
                )
            ).data;
        const drugs = async (query = '') =>
            (
                await json<{ data: Drug[] }>(
                    await pharmacy.admin.get(`${api}/drugs${query}`),
                    200,
                )
            ).data;

        test('every legal entity of a tenant with the module gets the five drug classes as editable data', async () => {
            expect((await classes()).map((row) => row.code)).toEqual([
                'NARKOTIKA',
                'PSIKOTROPIKA',
                'KERAS',
                'BEBAS-TERBATAS',
                'BEBAS',
            ]);
            const late = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Pasang Belakangan',
                { installed: false },
            );
            const seeded = async () =>
                (
                    await pool.unsafe<{ found: number }[]>(
                        'select count(*)::int as found from far_m_golongan_obat where tenant_id = $1',
                        [late.tenantId],
                    )
                )[0]?.found;
            expect(await seeded()).toBe(0);
            await recordInstallation(pool, late.tenantId, 'pharmacy');
            expect(await seeded()).toBe(5);
        });

        test('a drug class is created, renamed, and kept while a drug still uses it', async () => {
            const created = (
                await json<{ data: DrugClass }>(
                    await pharmacy.admin.post(`${api}/drug-classes`, {
                        code: ' prekursor ',
                        name: 'Prekursor farmasi',
                    }),
                    201,
                )
            ).data;
            expect(created.code).toBe('PREKURSOR');
            expect(
                await refused(
                    await pharmacy.admin.post(`${api}/drug-classes`, {
                        code: 'PREKURSOR',
                        name: 'Ganda',
                    }),
                ),
            ).toEqual({ code: ['Kode ini sudah dipakai golongan obat lain.'] });
            const renamed = (
                await json<{ data: DrugClass }>(
                    await pharmacy.admin.patch(
                        `${api}/drug-classes/${created.id}`,
                        {
                            code: 'PREKURSOR',
                            name: 'Prekursor',
                            version: created.version,
                        },
                    ),
                    200,
                )
            ).data;
            expect(renamed.name).toBe('Prekursor');
            const item = await pharmacy.item('EFD-30');
            await json(
                await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                    drug_class_id: created.id,
                    is_generic: false,
                    is_formulary: false,
                    version: 0,
                }),
                200,
            );
            expect(
                Object.keys(
                    await refused(
                        await pharmacy.admin.delete(
                            `${api}/drug-classes/${created.id}`,
                            { version: renamed.version },
                        ),
                    ),
                ),
            ).toEqual(['_form']);
        });

        test('pharmacy data is written on the Core item of the active legal entity, once per version', async () => {
            const item = await pharmacy.item('AMX-500');
            const keras = (await classes()).find((row) => row.code === 'KERAS');
            const [fresh] = (await drugs('?q=AMX-500')).filter(
                (row) => row.id === item.id,
            );
            expect(fresh).toMatchObject({
                drug_class: null,
                is_generic: false,
                is_formulary: false,
                version: 0,
            });
            const saved = (
                await json<{ data: Drug }>(
                    await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                        drug_class_id: keras?.id,
                        is_generic: true,
                        is_formulary: true,
                        version: 0,
                    }),
                    200,
                )
            ).data;
            expect(saved).toMatchObject({
                drug_class: { id: keras?.id, code: 'KERAS' },
                is_generic: true,
                is_formulary: true,
                version: 1,
            });
            expect(
                (
                    await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                        drug_class_id: null,
                        is_generic: false,
                        is_formulary: true,
                        version: 0,
                    })
                ).status,
            ).toBe(409);
            expect(
                (await drugs(`?drug_class=${keras?.id}&generic=true`)).map(
                    (row) => row.id,
                ),
            ).toEqual([item.id]);
            const other = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Obat Lain',
            );
            const [foreignClass] = await classes(other);
            expect(
                await refused(
                    await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                        drug_class_id: foreignClass?.id,
                        is_generic: true,
                        is_formulary: true,
                        version: saved.version,
                    }),
                ),
            ).toEqual({ drug_class_id: ['Pilih golongan obat dari daftar.'] });
            const foreignItem = await other.item('LAIN-1');
            expect(
                (
                    await pharmacy.admin.put(`${api}/drugs/${foreignItem.id}`, {
                        drug_class_id: null,
                        is_generic: false,
                        is_formulary: false,
                        version: 0,
                    })
                ).status,
            ).toBe(404);
            expect(
                (
                    await pharmacy.admin.put(`${api}/drugs/bukan-uuid`, {
                        drug_class_id: null,
                        is_generic: false,
                        is_formulary: false,
                        version: 0,
                    })
                ).status,
            ).toBe(404);
        });
    },
);
