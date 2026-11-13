import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    refused,
} from '../../../../../test/support/inventory-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type Drug = {
    id: string;
    code: string;
    name: string;
    base_unit_id: string;
    base_unit_name: string;
    dosage_form_id: string | null;
    dosage_form_name: string | null;
    is_prescribable: boolean;
    is_blocked: boolean;
    version: number;
};

type Metadata = {
    permissions: { create: boolean; update: boolean; delete: boolean };
    units: { id: string; code: string; name: string }[];
    dosage_forms: { id: string; code: string; name: string; active: boolean }[];
};

type Item = {
    id: string;
    code: string;
    name: string;
    base_unit: { id: string };
    category: { id: string } | null;
    is_blocked: boolean;
    version: number;
};

const api = '/api/modules/healthcare/v1';

// Obat adalah barang persediaan Core dengan perluasan sim_m_obat ber-id sama: kartu obat menulis barang lewat fungsi
// persediaan dan baris perluasannya dalam satu transaksi, mengikuti legal entity tempat kerja, membawa isian yang hanya
// ada di kartu barang apa adanya, dan Delete-nya ditahan resep, alergi, dan gerak stok. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('drugs', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Awaited<ReturnType<typeof createBusiness>>;
    let admin: Browser;
    let syrup: string;

    async function member(duties: string[]) {
        const account = await createMember(pool, business.tenantId, duties);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            account.membershipId,
        );
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    const body = (overrides: Record<string, unknown> = {}) => ({
        code: `OB${Math.floor(Math.random() * 1e8)}`,
        name: 'Obat uji',
        base_unit_id: business.uom.id,
        dosage_form_id: null,
        is_prescribable: true,
        ...overrides,
    });

    async function create(as: Browser, overrides: Record<string, unknown>) {
        return (
            await json<{ data: Drug }>(
                await as.post(`${api}/drugs`, body(overrides)),
                201,
            )
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
        business = await createBusiness(pool, browser, 'Klinik Uji Obat', [
            ...inventoryDuties,
            'healthcare.clinical-setup.manage',
        ]);
        await entitle(pool, business.tenantId, 'healthcare');
        await recordInstallation(pool, business.tenantId, 'healthcare');
        admin = business.admin;
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

    test('a drug saved on the card is an item of the workspace legal entity that stock can be posted to', async () => {
        const metadata = await json<Metadata>(
            await admin.get(`${api}/drugs/metadata`),
            200,
        );
        expect(metadata.permissions).toEqual({
            create: true,
            update: true,
            delete: true,
        });
        expect(metadata.units).toEqual([
            { id: business.uom.id, code: 'TAB', name: 'Tablet' },
        ]);
        const drug = await create(admin, {
            code: ' pct500 ',
            name: 'Paracetamol 500 mg',
            dosage_form_id: syrup,
        });
        expect(drug).toMatchObject({
            code: 'PCT500',
            name: 'Paracetamol 500 mg',
            base_unit_id: business.uom.id,
            base_unit_name: 'Tablet',
            dosage_form_name: 'Sirup',
            is_prescribable: true,
            is_blocked: false,
        });
        const [stored] = await pool.unsafe<
            {
                item_legal_entity: string;
                drug_legal_entity: string;
                kode: string;
                satuan_dasar_id: string;
            }[]
        >(
            `select b.legal_entity_id as item_legal_entity, o.legal_entity_id as drug_legal_entity, b.kode,
                    b.satuan_dasar_id
             from sim_m_obat o join gd_m_barang b on b.id = o.id
             where o.id = $1 and o.deleted_at is null and b.deleted_at is null`,
            [drug.id],
        );
        expect(stored).toEqual({
            item_legal_entity: business.legalEntityId,
            drug_legal_entity: business.legalEntityId,
            kode: 'PCT500',
            satuan_dasar_id: business.uom.id,
        });
        const items = (
            await json<{ data: Item[] }>(
                await admin.get(`${inventoryApi}/items?q=PCT500`),
                200,
            )
        ).data;
        expect(items.map((item) => [item.id, item.name])).toEqual([
            [drug.id, 'Paracetamol 500 mg'],
        ]);

        const pharmacy = await business.location('FARMASI');
        await business.posted('masuk', pharmacy.id, [
            { item_id: drug.id, quantity: 100, unit_cost: 250 },
        ]);
        expect(await business.stock(drug.id, pharmacy.id)).toEqual({
            '-': 100,
        });
    });

    test('Core checks the item fields and the card checks the dosage form, in one answer', async () => {
        expect(
            await refused(
                await admin.post(
                    `${api}/drugs`,
                    body({
                        code: ' ',
                        name: '',
                        base_unit_id: null,
                        dosage_form_id: Bun.randomUUIDv7(),
                    }),
                ),
            ),
        ).toEqual({
            code: ['Isi kode barang.'],
            name: ['Isi nama barang.'],
            base_unit_id: ['Pilih satuan dasar dari daftar.'],
            dosage_form_id: ['Pilih dari daftar.'],
        });
        await business.item('AMX', { name: 'Amoxicillin dari persediaan' });
        expect(
            await refused(
                await admin.post(`${api}/drugs`, body({ code: 'amx' })),
            ),
        ).toEqual({ code: ['Kode ini sudah dipakai barang lain.'] });
        const [orphans] = await pool.unsafe<{ count: number }[]>(
            `select count(*)::int as count from sim_m_obat o
             where o.tenant_id = $1 and not exists (select 1 from gd_m_barang b where b.id = o.id)`,
            [business.tenantId],
        );
        expect(orphans?.count).toBe(0);
    });

    test('changing a drug keeps what only the item card sets, and a blocked item is not offered to prescriptions', async () => {
        const drug = await create(admin, { name: 'Ibuprofen 400 mg' });
        const item = (
            await json<{ data: Item[] }>(
                await admin.get(`${inventoryApi}/items?q=${drug.code}`),
                200,
            )
        ).data[0]!;
        const category = await json<{ data: { id: string } }>(
            await admin.post(`${inventoryApi}/item-categories`, {
                code: 'OBAT',
                name: 'Obat',
            }),
            201,
        );
        const blocked = (
            await json<{ data: Item }>(
                await admin.patch(`${inventoryApi}/items/${drug.id}`, {
                    code: item.code,
                    name: item.name,
                    base_unit_id: business.uom.id,
                    category_id: category.data.id,
                    is_blocked: true,
                    version: item.version,
                }),
                200,
            )
        ).data;
        expect(
            await admin.patch(`${api}/drugs/${drug.id}`, {
                ...body({ code: drug.code, name: 'Basi' }),
                version: drug.version,
            }),
        ).toHaveProperty('status', 409);
        const changed = (
            await json<{ data: Drug }>(
                await admin.patch(`${api}/drugs/${drug.id}`, {
                    ...body({
                        code: drug.code,
                        name: 'Ibuprofen 400 mg tablet',
                        dosage_form_id: syrup,
                        is_prescribable: true,
                    }),
                    version: blocked.version,
                }),
                200,
            )
        ).data;
        expect(changed).toMatchObject({
            name: 'Ibuprofen 400 mg tablet',
            dosage_form_name: 'Sirup',
            is_prescribable: true,
            is_blocked: true,
        });
        const [kept] = await pool.unsafe<
            { kategori_id: string; diblokir: boolean }[]
        >('select kategori_id, diblokir from gd_m_barang where id = $1', [
            drug.id,
        ]);
        expect(kept).toEqual({
            kategori_id: category.data.id,
            diblokir: true,
        });

        const resting = await create(admin, {
            name: 'Ibuprofen sirup',
            is_prescribable: false,
        });
        const offered = await create(admin, { name: 'Ibuprofen 200 mg' });
        expect(
            (await list(admin, 'q=Ibuprofen&prescribable=true')).map(
                (row) => row.id,
            ),
        ).toEqual([offered.id]);
        expect(
            (await list(admin, 'q=Ibuprofen&prescribable=false'))
                .map((row) => row.id)
                .sort(),
        ).toEqual([drug.id, resting.id].sort());
    });

    test('Delete removes the drug with its item, but not while a prescription, an allergy, or stock uses it', async () => {
        const unused = await create(admin, { name: 'Dihapus' });
        expect(
            (
                await admin.delete(`${api}/drugs/${unused.id}`, {
                    version: unused.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<
            { drug_deleted: boolean; item_deleted: boolean }[]
        >(
            `select o.deleted_at is not null as drug_deleted, b.deleted_at is not null as item_deleted
             from sim_m_obat o join gd_m_barang b on b.id = o.id where o.id = $1`,
            [unused.id],
        );
        expect(row).toEqual({ drug_deleted: true, item_deleted: true });
        expect((await list(admin)).map((entry) => entry.id)).not.toContain(
            unused.id,
        );
        await create(admin, { code: unused.code, name: 'Kode dipakai lagi' });

        const usedMessage = {
            id: [
                'Obat ini sudah dipakai di resep atau alergi pasien. Matikan Boleh diresepkan saja supaya tidak dipilih lagi.',
            ],
        };
        const prescribed = await create(admin, { name: 'Diresepkan' });
        await insertUnchecked(
            `insert into sim_tr_resep_detail (id, tenant_id, resep_id, urutan, obat_id, jumlah, satuan_id, konversi)
             values ($1, $2, $3, 1, $4, 10, $5, 1)`,
            [
                Bun.randomUUIDv7(),
                business.tenantId,
                Bun.randomUUIDv7(),
                prescribed.id,
                business.uom.id,
            ],
        );
        expect(
            await refused(
                await admin.delete(`${api}/drugs/${prescribed.id}`, {
                    version: prescribed.version,
                }),
            ),
        ).toEqual(usedMessage);
        const allergen = await create(admin, { name: 'Alergen' });
        await insertUnchecked(
            `insert into sim_m_pasien_alergi (id, tenant_id, pasien_id, kategori, obat_id, dicatat_pada)
             values ($1, $2, $3, 'obat', $4, now())`,
            [
                Bun.randomUUIDv7(),
                business.tenantId,
                Bun.randomUUIDv7(),
                allergen.id,
            ],
        );
        expect(
            await refused(
                await admin.delete(`${api}/drugs/${allergen.id}`, {
                    version: allergen.version,
                }),
            ),
        ).toEqual(usedMessage);

        const stocked = await create(admin, { name: 'Punya stok' });
        await business.posted('masuk', (await business.location('GUDANG')).id, [
            { item_id: stocked.id, quantity: 5, unit_cost: 100 },
        ]);
        expect(
            await refused(
                await admin.delete(`${api}/drugs/${stocked.id}`, {
                    version: stocked.version,
                }),
            ),
        ).toEqual({
            _form: [
                'Barang ini sudah punya gerak stok, jadi tidak bisa dihapus. Blokir saja supaya tidak dipakai lagi.',
            ],
        });
        const [still] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from sim_m_obat where id = $1',
            [stocked.id],
        );
        expect(still?.deleted).toBe(false);
    });

    test('an examiner adds a drug from the prescription but cannot change or delete it', async () => {
        const examiner = await member(['healthcare.examination.manage']);
        expect(
            (
                await json<Metadata>(
                    await examiner.get(`${api}/drugs/metadata`),
                    200,
                )
            ).permissions,
        ).toEqual({ create: true, update: false, delete: false });
        const added = await create(examiner, { name: 'Ditambah pemeriksa' });
        expect(
            (
                await examiner.patch(`${api}/drugs/${added.id}`, {
                    ...body({ code: added.code, name: 'Diubah' }),
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
        const reader = await member(['healthcare.examination.inquire']);
        expect((await reader.get(`${api}/drugs`)).status).toBe(200);
        expect(
            (await reader.post(`${api}/drugs`, body({ name: 'X' }))).status,
        ).toBe(403);
        const outsider = await member(['healthcare.patient.inquire']);
        expect((await outsider.get(`${api}/drugs`)).status).toBe(403);
    });

    test('drugs belong to one legal entity: another one neither sees nor changes them, and may reuse the code', async () => {
        const ours = await create(admin, { name: 'Milik legal entity satu' });
        const second = (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Obat Kedua',
                    company_code: `O${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        await json(
            await admin.put('/api/v1/workspace-context', {
                membership_id: business.member.membershipId,
                legal_entity_id: second,
            }),
            200,
        );
        expect(
            (
                await json<Metadata>(
                    await admin.get(`${api}/drugs/metadata`),
                    200,
                )
            ).units,
        ).toEqual([]);
        expect((await list(admin)).map((row) => row.id)).not.toContain(ours.id);
        expect(
            (
                await admin.patch(`${api}/drugs/${ours.id}`, {
                    ...body({ code: ours.code }),
                    version: ours.version,
                })
            ).status,
        ).toBe(404);
        expect(
            await refused(
                await admin.post(`${api}/drugs`, body({ code: ours.code })),
            ),
        ).toEqual({ base_unit_id: ['Pilih satuan dasar dari daftar.'] });
        const unit = (
            await json<{ data: { id: string } }>(
                await admin.post(`${inventoryApi}/units-of-measure`, {
                    code: 'TAB',
                    name: 'Tablet',
                }),
                201,
            )
        ).data.id;
        const theirs = await create(admin, {
            code: ours.code,
            base_unit_id: unit,
        });
        const [scopes] = await pool.unsafe<{ count: number }[]>(
            `select count(distinct legal_entity_id)::int as count from sim_m_obat where id = any($1::uuid[])`,
            [[ours.id, theirs.id]],
        );
        expect(scopes?.count).toBe(2);
        await json(
            await admin.put('/api/v1/workspace-context', {
                membership_id: business.member.membershipId,
                legal_entity_id: business.legalEntityId,
            }),
            200,
        );
    });
});
