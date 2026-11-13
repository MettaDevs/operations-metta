import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBillingBusiness,
    json,
    legalEntity,
    refused,
    selectLegalEntity,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import { createMember } from '../../../support/tenant-fixtures.ts';

const api = '/api/v1/billing/payment-methods';

type PaymentMethod = { id: string; code: string; version: number };
type ImportResult = {
    legacy_id: number;
    legacy_name: string;
    imported: boolean;
    code: string | null;
    behavior: string | null;
    notes: string[];
};

// mJenisBayar Puskesmas Kuta 1, dibaca 13 November 2026 lewat SELECT ... FOR JSON PATH (hanya nilai master).
const kutaPaymentTypes = [
    [4, 'TUNAI', 1, 'TUN', { Cash: true }],
    [5, 'DIJAMIN KE PERUSAHAAN', 5, 'IKS', { Jaminan: true }],
    [7, 'KARTU KREDIT/DEBIT', 2, 'BNK', { Bank: true }],
    [9, 'KREDIT / BON', 7, 'KRE', {}],
    [11, 'TAGIHAN L.O.G', 6, 'LOG', { Jaminan: true }],
    [12, 'BEBAN/KEUNTUNGAN KLINIK', 99, 'BEB', { Others: true }],
    [13, 'DIJAMIN BPJS', 4, 'BPJ', { Jaminan: true }],
    [19, 'BON KARYAWAN', 8, 'BKA', { Others: true }],
    [29, 'BEBAN FASKES LAIN', 9, 'BFL', { Others: true }],
] as const;
const legacyRows = (rows: readonly (typeof kutaPaymentTypes)[number][]) =>
    rows.map(([IDBayar, Description, NoUrut, Kode, flags]) => ({
        IDBayar,
        Description,
        NoUrut,
        Kode,
        Cash: false,
        Bank: false,
        CC: false,
        Jaminan: false,
        Others: false,
        ...flags,
        Active: true,
    }));

// Jenis bayar Core per legal entity: kode unik selama barisnya belum dihapus, satu tunai aktif per legal entity, isian
// tambahan yang hanya berlaku untuk perilakunya, hapus ditolak selama dipakai, dan impor mJenisBayar sistem lama.
describe.skipIf(!process.env.DB_HOST)('payment methods', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let membershipId: string;
    let admin: Browser;

    const create = (body: Record<string, unknown>) => admin.post(api, body);
    const stored = async (entity = legalEntityId) =>
        pool.unsafe<
            {
                kode: string;
                nama: string;
                label_kasir: string | null;
                urutan: number;
                perilaku: string;
                pihak: string;
                wajib_merchan: boolean;
                wajib_referensi: boolean;
                biaya_tambahan: boolean;
                menampung_sisa: boolean;
                dihitung_tutup_kas: boolean;
                tampil_di_kasir: boolean;
                aktif: boolean;
                id_bayar_lama: number | null;
            }[]
        >(
            `select kode, nama, label_kasir, urutan, perilaku, pihak, wajib_merchan, wajib_referensi, biaya_tambahan,
                    menampung_sisa, dihitung_tutup_kas, tampil_di_kasir, aktif, id_bayar_lama
             from jenis_bayar where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null
             order by urutan, kode`,
            [tenantId, entity],
        );

    beforeAll(async () => {
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Jenis Bayar',
            ['core.billing-setup.manage'],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        membershipId = business.member.membershipId;
        admin = business.admin;
    });

    test("importing Kuta's mJenisBayar draws the legacy cashier screen from data, and leaves out the row whose behavior the data does not show", async () => {
        const results = (
            await json<{ data: ImportResult[] }>(
                await admin.post(`${api}/legacy-import`, {
                    rows: legacyRows(kutaPaymentTypes),
                }),
                200,
            )
        ).data;
        expect(
            results.map((row) => [row.legacy_id, row.imported, row.behavior]),
        ).toEqual([
            [4, true, 'tunai'],
            [5, true, 'penjamin'],
            [7, true, 'non_tunai'],
            [9, true, 'piutang'],
            [11, true, 'penjamin'],
            [12, true, 'beban'],
            [13, true, 'penjamin'],
            [19, true, 'piutang'],
            [29, false, null],
        ]);
        expect(results.at(-1)?.notes.join(' ')).toContain(
            'tidak bisa ditentukan',
        );

        const flagsOf = (row: Awaited<ReturnType<typeof stored>>[number]) =>
            [
                row.wajib_merchan && 'wajib_merchan',
                row.wajib_referensi && 'wajib_referensi',
                row.biaya_tambahan && 'biaya_tambahan',
                row.menampung_sisa && 'menampung_sisa',
                row.dihitung_tutup_kas && 'dihitung_tutup_kas',
            ].filter(Boolean);
        expect(
            (await stored()).map((row) => [
                row.id_bayar_lama,
                row.kode,
                row.label_kasir ?? row.nama,
                row.perilaku,
                row.pihak,
                flagsOf(row),
                row.tampil_di_kasir,
                row.aktif,
            ]),
        ).toEqual([
            // Isian layar kasir Kuta, berurut letaknya di layar.
            [
                4,
                'TUN',
                'TUNAI',
                'tunai',
                'tidak',
                ['dihitung_tutup_kas'],
                true,
                true,
            ],
            [
                7,
                'BNK',
                'KARTU KREDIT/DEBIT',
                'non_tunai',
                'tidak',
                ['wajib_merchan', 'biaya_tambahan', 'dihitung_tutup_kas'],
                true,
                true,
            ],
            [
                13,
                'BPJ',
                'DIJAMIN BPJS',
                'penjamin',
                'penjamin_kunjungan',
                [],
                true,
                true,
            ],
            [
                5,
                'IKS',
                'PERUSAHAAN',
                'penjamin',
                'penjamin_kunjungan',
                [],
                true,
                true,
            ],
            [
                19,
                'BKA',
                'KREDIT / BON',
                'piutang',
                'pilih_pihak',
                [],
                true,
                true,
            ],
            [
                12,
                'BEB',
                'BEBAN/KEUNTUNGAN RS',
                'beban',
                'tidak',
                [],
                true,
                true,
            ],
            [
                9,
                'KRE',
                'Pasien BON',
                'piutang',
                'pasien',
                ['menampung_sisa'],
                true,
                true,
            ],
            // Tidak punya isian di layar kasir lama.
            [
                11,
                'LOG',
                'TAGIHAN L.O.G',
                'penjamin',
                'penjamin_kunjungan',
                [],
                false,
                true,
            ],
        ]);
    });

    test('importing the same rows again adds nothing and says which method each row already became', async () => {
        const before = (await stored()).length;
        const results = (
            await json<{ data: ImportResult[] }>(
                await admin.post(`${api}/legacy-import`, {
                    rows: legacyRows(kutaPaymentTypes),
                }),
                200,
            )
        ).data;
        expect(results.filter((row) => row.imported)).toEqual([]);
        expect(results.find((row) => row.legacy_id === 4)?.notes).toEqual([
            'Sudah diimpor sebagai TUN.',
        ]);
        expect((await stored()).length).toBe(before);
    });

    test('a second card sharing a legacy code is saved under a code of its own, and a row flagged only Others is not imported', async () => {
        const entity = await legalEntity(admin, 'PT Klinik Uji Kartu Kedua');
        await selectLegalEntity(admin, membershipId, entity);
        const results = (
            await json<{ data: ImportResult[] }>(
                await admin.post(`${api}/legacy-import`, {
                    rows: [
                        ...legacyRows(kutaPaymentTypes.slice(2, 3)),
                        {
                            IDBayar: 8,
                            Description: 'KARTU KREDIT/DEBIT 2',
                            NoUrut: 3,
                            Kode: 'BNK',
                            Bank: true,
                            Active: true,
                        },
                        // Baris sintetis: hanya flag Others, tanpa isian di layar kasir lama.
                        {
                            IDBayar: 20,
                            Description: 'POIN',
                            NoUrut: 10,
                            Kode: 'PON',
                            Others: true,
                            Active: true,
                        },
                    ],
                }),
                200,
            )
        ).data;
        expect(
            results.map((row) => [row.legacy_id, row.imported, row.code]),
        ).toEqual([
            [7, true, 'BNK'],
            [8, true, 'BNK-8'],
            [20, false, null],
        ]);
        const second = (await stored(entity)).find(
            (row) => row.id_bayar_lama === 8,
        );
        expect(second).toMatchObject({
            perilaku: 'non_tunai',
            wajib_merchan: true,
            tampil_di_kasir: false,
            urutan: 103,
        });
        await selectLegalEntity(admin, membershipId, legalEntityId);
    });

    test('a code is unique in its legal entity until the method is deleted', async () => {
        const created = await json<{ data: PaymentMethod }>(
            await create({ code: 'qris', name: 'QRIS', behavior: 'non_tunai' }),
            201,
        );
        expect(created.data.code).toBe('QRIS');
        expect(
            Object.keys(
                await refused(
                    await create({
                        code: 'QRIS',
                        name: 'QRIS lain',
                        behavior: 'non_tunai',
                    }),
                ),
            ),
        ).toEqual(['code']);
        expect(
            (
                await admin.delete(`${api}/${created.data.id}`, {
                    version: created.data.version,
                })
            ).status,
        ).toBe(204);
        await json(
            await create({ code: 'QRIS', name: 'QRIS', behavior: 'non_tunai' }),
            201,
        );
    });

    test('a legal entity has one active cash method; an inactive one or one in another legal entity is allowed', async () => {
        expect(
            Object.keys(
                await refused(
                    await create({
                        code: 'TUN2',
                        name: 'Tunai kedua',
                        behavior: 'tunai',
                    }),
                ),
            ),
        ).toEqual(['behavior']);
        const inactive = await json<{ data: PaymentMethod }>(
            await create({
                code: 'TUN2',
                name: 'Tunai kedua',
                behavior: 'tunai',
                is_active: false,
            }),
            201,
        );
        expect(
            Object.keys(
                await refused(
                    await admin.patch(`${api}/${inactive.data.id}`, {
                        code: 'TUN2',
                        name: 'Tunai kedua',
                        behavior: 'tunai',
                        is_active: true,
                        version: inactive.data.version,
                    }),
                ),
            ),
        ).toEqual(['behavior']);
        const other = await legalEntity(admin, 'PT Klinik Uji Tunai Lain');
        await selectLegalEntity(admin, membershipId, other);
        await json(
            await create({ code: 'TUN', name: 'TUNAI', behavior: 'tunai' }),
            201,
        );
        await selectLegalEntity(admin, membershipId, legalEntityId);
    });

    test('an option or a party that does not belong to the behavior is refused per field', async () => {
        const errors = await refused(
            await create({
                code: 'BPJS2',
                name: 'BPJS',
                behavior: 'penjamin',
                party: 'pasien',
                requires_merchant: true,
                counted_at_close: true,
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'counted_at_close',
            'party',
            'requires_merchant',
        ]);
        expect(
            Object.keys(
                await refused(
                    await create({ code: 'X', name: 'X', behavior: 'poin' }),
                ),
            ),
        ).toEqual(['behavior']);
    });

    test('a method in use is not deleted, and is deleted once nothing uses it', async () => {
        const method = await json<{ data: PaymentMethod }>(
            await create({
                code: 'EDC2',
                name: 'EDC 2',
                behavior: 'non_tunai',
            }),
            201,
        );
        // Tabel pemakai sintetis: hapus ditolak lewat foreign key apa pun ke jenis_bayar, juga milik module.
        await pool.unsafe(
            `create table if not exists uji_pemakai_jenis_bayar (
                 id uuid primary key, tenant_id uuid not null, jenis_bayar_id uuid not null,
                 deleted_at timestamp,
                 foreign key (tenant_id, jenis_bayar_id) references jenis_bayar (tenant_id, id))`,
        );
        const usage = Bun.randomUUIDv7();
        await pool.unsafe(
            'insert into uji_pemakai_jenis_bayar (id, tenant_id, jenis_bayar_id) values ($1, $2, $3)',
            [usage, tenantId, method.data.id],
        );
        try {
            expect(
                Object.keys(
                    await refused(
                        await admin.delete(`${api}/${method.data.id}`, {
                            version: method.data.version,
                        }),
                    ),
                ),
            ).toEqual(['_form']);
            await pool.unsafe(
                'update uji_pemakai_jenis_bayar set deleted_at = now() where id = $1',
                [usage],
            );
            expect(
                (
                    await admin.delete(`${api}/${method.data.id}`, {
                        version: method.data.version,
                    })
                ).status,
            ).toBe(204);
        } finally {
            await pool.unsafe('drop table if exists uji_pemakai_jenis_bayar');
        }
    });

    test('a viewer reads methods but cannot add or import one', async () => {
        const reader = await createMember(pool, tenantId, [
            'core.billing-setup.inquire',
        ]);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'uji.semua-organisasi', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, reader.membershipId],
        );
        const viewer = browser();
        await viewer.login(reader.email, reader.password);
        const listed = await json<{ data: unknown[]; can_manage: boolean }>(
            await viewer.get(`${api}?active=1`),
            200,
        );
        expect(listed.can_manage).toBe(false);
        expect(listed.data.length).toBeGreaterThan(0);
        expect(
            (
                await viewer.post(api, {
                    code: 'Y',
                    name: 'Y',
                    behavior: 'beban',
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await viewer.post(`${api}/legacy-import`, {
                    rows: legacyRows(kutaPaymentTypes),
                })
            ).status,
        ).toBe(403);
    });
});
