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

type Drug = {
    id: string;
    code: string | null;
    name: string;
    unit_id: string;
    unit_name: string;
    dosage_form_id: string | null;
    dosage_form_name: string | null;
    is_active: boolean;
    version: number;
};

type Option = { id: string; code: string; name: string; active: boolean };

type Metadata = {
    permissions: { create: boolean; update: boolean; delete: boolean };
    units: Option[];
    dosage_forms: Option[];
};

const api = '/api/modules/healthcare/v1';

// Master obat: satuan bawaan dari pemasangan module, kode opsional tetapi unik bila diisi, satuan dan bentuk sediaan
// aktif dari daftar pendek, Delete lunak yang ditahan bila sudah dipakai resep atau alergi pasien, izin, dan batas
// tenant. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('drugs', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let metadata: Metadata;
    let tablet: string;
    let bottle: string;
    let syrup: string;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function refused(response: Response) {
        return (await json<{ errors: Record<string, string[]> }>(response, 422))
            .errors;
    }

    async function member(tenant: string, duties: string[]) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    async function create(as: Browser, body: Record<string, unknown>) {
        return (
            await json<{ data: Drug }>(await as.post(`${api}/drugs`, body), 201)
        ).data;
    }

    const list = async (as: Browser, query = '') =>
        (
            await json<{ data: Drug[] }>(
                await as.get(`${api}/drugs?${query}`),
                200,
            )
        ).data;

    // Baris pemakai disisipkan langsung tanpa resep atau pasien sungguhan: yang diuji hanya penahan Delete.
    // session_replication_role hanya berlaku di transaksi ini, jadi foreign key tabel bersama tetap utuh.
    async function insertUnchecked(statement: string, values: string[]) {
        await pool.begin(async (sql) => {
            await sql.unsafe('set local session_replication_role = replica');
            await sql.unsafe(statement, values);
        });
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Obat');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, ['healthcare.clinical-setup.manage']);
        metadata = await json<Metadata>(
            await admin.get(`${api}/drugs/metadata`),
            200,
        );
        const unit = (code: string) =>
            metadata.units.find((row) => row.code === code)!.id;
        tablet = unit('TABLET');
        bottle = unit('BOTOL');
        syrup = (
            await json<{ data: { id: string } }>(
                await admin.post(`${api}/diagnosis-references/dosage-forms`, {
                    code: 'SIRUP',
                    name: 'Sirup',
                }),
                201,
            )
        ).data.id;
    }, 60_000);

    test('units are seeded when the module is installed and dosage forms start empty', () => {
        expect(metadata.permissions).toEqual({
            create: true,
            update: true,
            delete: true,
        });
        expect(metadata.units.slice(0, 3).map((row) => row.code)).toEqual([
            'TUBE',
            'TABLET',
            'BOTOL',
        ]);
        expect(metadata.units.every((row) => row.active)).toBe(true);
    });

    test('a drug is created with an optional code, found, changed, and refuses a stale version', async () => {
        const added = await create(admin, {
            code: ' PCT500 ',
            name: 'Paracetamol 500 mg',
            unit_id: tablet,
        });
        expect(added).toMatchObject({
            code: 'PCT500',
            name: 'Paracetamol 500 mg',
            unit_id: tablet,
            unit_name: 'TAB',
            dosage_form_id: null,
            dosage_form_name: null,
            is_active: true,
        });
        const first = await create(admin, {
            code: '',
            name: 'Obat batuk hitam',
            unit_id: bottle,
            dosage_form_id: syrup,
        });
        const second = await create(admin, {
            name: 'Obat batuk putih',
            unit_id: bottle,
        });
        expect([first.code, second.code, first.dosage_form_name]).toEqual([
            null,
            null,
            'Sirup',
        ]);
        expect((await list(admin, 'q=batuk')).map((row) => row.id)).toEqual([
            first.id,
            second.id,
        ]);
        expect((await list(admin, 'q=pct')).map((row) => row.id)).toEqual([
            added.id,
        ]);

        const changed = (
            await json<{ data: Drug }>(
                await admin.patch(`${api}/drugs/${added.id}`, {
                    code: null,
                    name: 'Paracetamol 500 mg tablet',
                    unit_id: tablet,
                    dosage_form_id: syrup,
                    is_active: false,
                    version: added.version,
                }),
                200,
            )
        ).data;
        expect(changed).toMatchObject({
            code: null,
            name: 'Paracetamol 500 mg tablet',
            dosage_form_id: syrup,
            is_active: false,
        });
        expect(
            (await list(admin, 'status=inactive')).map((row) => row.id),
        ).toEqual([added.id]);
        expect(
            (
                await admin.patch(`${api}/drugs/${added.id}`, {
                    name: 'Basi',
                    unit_id: tablet,
                    version: added.version,
                })
            ).status,
        ).toBe(409);
    });

    test('name and unit are required, lengths are checked, and a filled code is unique regardless of case', async () => {
        expect(
            await refused(
                await admin.post(`${api}/drugs`, { code: '', name: ' ' }),
            ),
        ).toEqual({ name: ['Isi nama obat.'], unit_id: ['Pilih satuan.'] });
        expect(
            await refused(
                await admin.post(`${api}/drugs`, {
                    code: 'X'.repeat(31),
                    name: 'N'.repeat(201),
                    unit_id: tablet,
                }),
            ),
        ).toEqual({
            code: ['Paling panjang 30 karakter.'],
            name: ['Paling panjang 200 karakter.'],
        });
        await create(admin, {
            code: 'AMX',
            name: 'Amoxicillin',
            unit_id: tablet,
        });
        expect(
            await refused(
                await admin.post(`${api}/drugs`, {
                    code: 'amx',
                    name: 'Amoxicillin lagi',
                    unit_id: tablet,
                }),
            ),
        ).toEqual({ code: ['Kode ini sudah ada di daftar obat.'] });
    });

    test('only active units and dosage forms are accepted, except the ones already saved on the drug', async () => {
        for (const unitId of [Bun.randomUUIDv7(), 'bukan-id'])
            expect(
                await refused(
                    await admin.post(`${api}/drugs`, {
                        name: 'Satuan salah',
                        unit_id: unitId,
                        dosage_form_id: Bun.randomUUIDv7(),
                    }),
                ),
            ).toEqual({
                unit_id: ['Pilih dari daftar.'],
                dosage_form_id: ['Pilih dari daftar.'],
            });

        const vial = metadata.units.find((row) => row.code === 'VIAL')!.id;
        const kept = await create(admin, {
            name: 'Injeksi',
            unit_id: vial,
            dosage_form_id: syrup,
        });
        await pool.unsafe(
            'update sim_m_satuan_obat set aktif = false where id = $1',
            [vial],
        );
        await pool.unsafe(
            'update sim_m_bentuk_sediaan set aktif = false where id = $1',
            [syrup],
        );
        try {
            expect(
                await refused(
                    await admin.post(`${api}/drugs`, {
                        name: 'Baru dengan pilihan nonaktif',
                        unit_id: vial,
                        dosage_form_id: syrup,
                    }),
                ),
            ).toEqual({
                unit_id: ['Pilih dari daftar.'],
                dosage_form_id: ['Pilih dari daftar.'],
            });
            const changed = (
                await json<{ data: Drug }>(
                    await admin.patch(`${api}/drugs/${kept.id}`, {
                        name: 'Injeksi tetap',
                        unit_id: vial,
                        dosage_form_id: syrup,
                        version: kept.version,
                    }),
                    200,
                )
            ).data;
            expect([changed.unit_id, changed.dosage_form_id]).toEqual([
                vial,
                syrup,
            ]);
        } finally {
            await pool.unsafe(
                'update sim_m_satuan_obat set aktif = true where id = $1',
                [vial],
            );
            await pool.unsafe(
                'update sim_m_bentuk_sediaan set aktif = true where id = $1',
                [syrup],
            );
        }
    });

    test('delete is soft, frees the code, and is refused once a prescription or an allergy uses the drug', async () => {
        const unused = await create(admin, {
            code: 'HAPUS',
            name: 'Dihapus',
            unit_id: tablet,
        });
        expect(
            (
                await admin.delete(`${api}/drugs/${unused.id}`, {
                    version: unused.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted_at: Date | null }[]>(
            'select deleted_at from sim_m_obat where id = $1',
            [unused.id],
        );
        expect(row?.deleted_at).not.toBeNull();
        expect((await list(admin)).map((entry) => entry.id)).not.toContain(
            unused.id,
        );
        await create(admin, {
            code: 'HAPUS',
            name: 'Kode dipakai lagi',
            unit_id: tablet,
        });

        const usedMessage = {
            id: [
                'Obat ini sudah dipakai di resep atau alergi pasien. Nonaktifkan saja supaya tidak dipilih lagi.',
            ],
        };
        const prescribed = await create(admin, {
            name: 'Diresepkan',
            unit_id: tablet,
        });
        await insertUnchecked(
            `insert into sim_tr_resep_detail (id, tenant_id, resep_id, urutan, obat_id, jumlah)
             values ($1, $2, $3, 1, $4, 10)`,
            [Bun.randomUUIDv7(), tenantId, Bun.randomUUIDv7(), prescribed.id],
        );
        expect(
            await refused(
                await admin.delete(`${api}/drugs/${prescribed.id}`, {
                    version: prescribed.version,
                }),
            ),
        ).toEqual(usedMessage);

        const allergen = await create(admin, {
            name: 'Alergen',
            unit_id: tablet,
        });
        await insertUnchecked(
            `insert into sim_m_pasien_alergi_obat (id, tenant_id, pasien_id, obat_id)
             values ($1, $2, $3, $4)`,
            [Bun.randomUUIDv7(), tenantId, Bun.randomUUIDv7(), allergen.id],
        );
        expect(
            await refused(
                await admin.delete(`${api}/drugs/${allergen.id}`, {
                    version: allergen.version,
                }),
            ),
        ).toEqual(usedMessage);
    });

    test('an examiner adds a drug from the prescription but cannot change or delete it', async () => {
        const examiner = await member(tenantId, [
            'healthcare.examination.manage',
        ]);
        expect(
            (
                await json<Metadata>(
                    await examiner.get(`${api}/drugs/metadata`),
                    200,
                )
            ).permissions,
        ).toEqual({ create: true, update: false, delete: false });
        const added = await create(examiner, {
            name: 'Ditambah pemeriksa',
            unit_id: tablet,
        });
        expect(
            (
                await examiner.patch(`${api}/drugs/${added.id}`, {
                    name: 'Diubah',
                    unit_id: tablet,
                    version: added.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await examiner.delete(`${api}/drugs/${added.id}`, {
                    version: added.version,
                })
            ).status,
        ).toBe(403);

        const reader = await member(tenantId, [
            'healthcare.examination.inquire',
        ]);
        expect((await reader.get(`${api}/drugs`)).status).toBe(200);
        expect(
            (
                await reader.post(`${api}/drugs`, {
                    name: 'X',
                    unit_id: tablet,
                })
            ).status,
        ).toBe(403);
        const outsider = await member(tenantId, ['healthcare.patient.inquire']);
        expect((await outsider.get(`${api}/drugs`)).status).toBe(403);
    });

    test('another tenant neither sees nor changes our drugs nor uses our units', async () => {
        const ours = await create(admin, {
            code: 'MILIK',
            name: 'Milik kami',
            unit_id: tablet,
        });
        const other = await createTenant(pool, 'Klinik Obat Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await member(other, [
            'healthcare.clinical-setup.manage',
        ]);
        expect((await list(stranger)).map((row) => row.id)).not.toContain(
            ours.id,
        );
        expect(
            (
                await stranger.patch(`${api}/drugs/${ours.id}`, {
                    name: 'Diambil',
                    unit_id: tablet,
                    version: ours.version,
                })
            ).status,
        ).toBe(404);
        expect(
            await refused(
                await stranger.post(`${api}/drugs`, {
                    code: 'MILIK',
                    name: 'Satuan tenant lain',
                    unit_id: tablet,
                }),
            ),
        ).toEqual({ unit_id: ['Pilih dari daftar.'] });
        const theirs = await json<Metadata>(
            await stranger.get(`${api}/drugs/metadata`),
            200,
        );
        await create(stranger, {
            code: 'MILIK',
            name: 'Kode sama di tenant lain',
            unit_id: theirs.units[0]!.id,
        });
    });
});
