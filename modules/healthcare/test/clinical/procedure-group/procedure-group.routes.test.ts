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

type Group = {
    id: string;
    code: string;
    name: string;
    international_name: string | null;
    treatment_group: string;
    sort_order: number;
    is_active: boolean;
    version: number;
};
const api = '/api/modules/healthcare/v1';

// Kelompok tindakan (Group Jasa sistem lama): Nama internasional dan Kelompok Perawatan form sistem lama, kode unik per
// tenant tanpa membedakan huruf besar, Delete ditahan selama tindakan atau kategori tindakan memakainya, dan izin
// tindakan.
describe.skipIf(!process.env.DB_HOST)('procedure groups', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;
    let viewer: Browser;
    let examiner: Browser;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }
    const errorsOf = async (response: Response) =>
        Object.keys(
            (await json<{ errors: Record<string, string[]> }>(response, 422))
                .errors,
        ).sort();
    const create = async (body: Record<string, unknown>) =>
        (
            await json<{ data: Group }>(
                await admin.post(`${api}/procedure-groups`, body),
                201,
            )
        ).data;
    const stored = async (id: string) =>
        (
            await pool.unsafe<
                {
                    nama_internasional: string | null;
                    kelompok_perawatan: string;
                    urutan: number;
                }[]
            >(
                'select nama_internasional, kelompok_perawatan, urutan from sim_m_tindakan_kelompok where id = $1',
                [id],
            )
        )[0];
    const signIn = async (tenantId: string, duty: string) => {
        const account = await createMember(pool, tenantId, [duty]);
        await grantAllOrganizations(pool, tenantId, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    };

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Kelompok');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await signIn(tenantId, 'healthcare.clinical-setup.manage');
        viewer = await signIn(tenantId, 'healthcare.clinical-setup.inquire');
        examiner = await signIn(tenantId, 'healthcare.examination.manage');
    }, 60_000);

    test('a new group is for every treatment group, has no international name, and is active', async () => {
        const group = await create({ code: 'TM', name: 'Tindakan Medis' });
        expect(group).toMatchObject({
            international_name: null,
            treatment_group: 'ALL',
            sort_order: 0,
            is_active: true,
        });
        expect(await stored(group.id)).toEqual({
            nama_internasional: null,
            kelompok_perawatan: 'ALL',
            urutan: 0,
        });
    });

    test('the legacy fields are saved, changed, and read back', async () => {
        const group = await create({
            code: 'LAB',
            name: 'Laboratorium',
            international_name: ' Laboratory ',
            treatment_group: 'RJ',
            sort_order: 3,
        });
        expect(await stored(group.id)).toEqual({
            nama_internasional: 'Laboratory',
            kelompok_perawatan: 'RJ',
            urutan: 3,
        });
        await json(
            await admin.patch(`${api}/procedure-groups/${group.id}`, {
                code: 'LAB',
                name: 'Laboratorium',
                international_name: 'Clinical Laboratory',
                treatment_group: 'RI',
                sort_order: 4,
                version: group.version,
            }),
            200,
        );
        expect(await stored(group.id)).toEqual({
            nama_internasional: 'Clinical Laboratory',
            kelompok_perawatan: 'RI',
            urutan: 4,
        });
        const listed = (
            await json<{ data: Group[] }>(
                await admin.get(`${api}/procedure-groups?q=Laboratorium`),
                200,
            )
        ).data;
        expect(listed.map((row) => [row.code, row.treatment_group])).toEqual([
            ['LAB', 'RI'],
        ]);
    });

    test('an unknown treatment group and missing code and name are refused per field', async () => {
        expect(
            await errorsOf(
                await admin.post(`${api}/procedure-groups`, {
                    code: 'UGD',
                    name: 'Gawat Darurat',
                    treatment_group: 'UGD',
                }),
            ),
        ).toEqual(['treatment_group']);
        expect(
            await errorsOf(
                await admin.post(`${api}/procedure-groups`, {
                    code: ' ',
                    name: '',
                }),
            ),
        ).toEqual(['code', 'name']);
    });

    test('the code is unique regardless of case', async () => {
        await create({ code: 'RAD', name: 'Radiologi' });
        expect(
            await errorsOf(
                await admin.post(`${api}/procedure-groups`, {
                    code: 'rad',
                    name: 'Radiologi lain',
                }),
            ),
        ).toEqual(['code']);
    });

    test('a group used by a procedure or a procedure category cannot be deleted until both let go', async () => {
        const group = await create({ code: 'OP', name: 'Operasi' });
        const category = (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(`${api}/procedure-categories`, {
                    group_id: group.id,
                    code: 'OPK',
                    name: 'Operasi kecil',
                }),
                201,
            )
        ).data;
        const procedure = (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(`${api}/procedures`, {
                    code: 'OP1',
                    name: 'Eksisi',
                    group_id: group.id,
                    category_id: category.id,
                }),
                201,
            )
        ).data;
        const remove = () =>
            admin.delete(`${api}/procedure-groups/${group.id}`, {
                version: group.version,
            });
        expect(await errorsOf(await remove())).toEqual(['_form']);
        expect(
            (
                await admin.delete(`${api}/procedures/${procedure.id}`, {
                    version: procedure.version,
                })
            ).status,
        ).toBe(204);
        expect(await errorsOf(await remove())).toEqual(['_form']);
        expect(
            (
                await admin.delete(
                    `${api}/procedure-categories/${category.id}`,
                    { version: category.version },
                )
            ).status,
        ).toBe(204);
        expect((await remove()).status).toBe(204);
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from sim_m_tindakan_kelompok where id = $1',
            [group.id],
        );
        expect(row?.deleted).toBe(true);
    });

    test('a viewer reads groups, and neither a viewer nor an examiner who may add procedures can add one', async () => {
        expect((await viewer.get(`${api}/procedure-groups`)).status).toBe(200);
        await json(
            await examiner.post(`${api}/procedures`, {
                code: 'PX1',
                name: 'Tindakan dari pemeriksaan',
            }),
            201,
        );
        for (const session of [viewer, examiner])
            expect(
                (
                    await session.post(`${api}/procedure-groups`, {
                        code: 'X',
                        name: 'X',
                    })
                ).status,
            ).toBe(403);
    });

    test('groups are served only by their own endpoint, and the menu entry asks for procedure access', async () => {
        expect(
            (await admin.get(`${api}/diagnosis-references/procedure-groups`))
                .status,
        ).toBe(404);
        const [entry] = await pool.unsafe<{ permission: string | null }[]>(
            `select item->>'permission' as permission
             from apps, jsonb_array_elements(navigation) area, jsonb_array_elements(area->'items') item
             where apps.id = 'healthcare' and item->>'id' = 'procedure-groups'`,
        );
        expect(entry?.permission).toBe('healthcare.procedure.read');
    });
});
