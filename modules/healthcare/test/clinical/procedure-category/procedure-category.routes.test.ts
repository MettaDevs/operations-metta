import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type Category = {
    id: string;
    group_id: string;
    code: string;
    name: string;
    international_name: string | null;
    version: number;
};
const api = '/api/modules/healthcare/v1';

// Kategori tindakan (Kategori jasa sistem lama): kode unik per tenant tanpa membedakan huruf besar, kelompok wajib,
// dan kategori yang dipakai tindakan tidak bisa dihapus atau dipindah kelompok.
describe.skipIf(!process.env.DB_HOST)('procedure categories', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;
    let viewer: Browser;
    let groups: { medical: string; lab: string };

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
            await json<{ data: Category }>(
                await admin.post(`${api}/procedure-categories`, body),
                201,
            )
        ).data;

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Kategori');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'healthcare.clinical-setup.manage',
        ]);
        admin = browser();
        await admin.login(owner.email, owner.password);
        const reader = await createMember(pool, tenantId, [
            'healthcare.clinical-setup.inquire',
        ]);
        viewer = browser();
        await viewer.login(reader.email, reader.password);
        const group = async (code: string) =>
            (
                await json<{ data: { id: string } }>(
                    await admin.post(`${api}/procedure-groups`, {
                        code,
                        name: code,
                    }),
                    201,
                )
            ).data.id;
        groups = { medical: await group('TM'), lab: await group('LAB') };
    });

    test('a category is saved with its code, names, and group, and the code is unique regardless of case', async () => {
        const category = await create({
            group_id: groups.lab,
            code: 'HEM',
            name: 'Hematologi',
            international_name: 'Hematology',
        });
        expect(category).toMatchObject({
            group_id: groups.lab,
            code: 'HEM',
            name: 'Hematologi',
            international_name: 'Hematology',
        });
        expect(
            await errorsOf(
                await admin.post(`${api}/procedure-categories`, {
                    group_id: groups.lab,
                    code: 'hem',
                    name: 'Lain',
                }),
            ),
        ).toEqual(['code']);
    });

    test('code, name, and group are required', async () => {
        expect(
            await errorsOf(
                await admin.post(`${api}/procedure-categories`, {
                    group_id: null,
                    code: ' ',
                    name: '',
                }),
            ),
        ).toEqual(['code', 'group_id', 'name']);
    });

    test('a viewer reads categories but cannot add one', async () => {
        expect((await viewer.get(`${api}/procedure-categories`)).status).toBe(
            200,
        );
        expect(
            (
                await viewer.post(`${api}/procedure-categories`, {
                    group_id: groups.lab,
                    code: 'X',
                    name: 'X',
                })
            ).status,
        ).toBe(403);
    });

    test('a category used by a procedure keeps its group and cannot be deleted until the procedure is gone', async () => {
        const category = await create({
            group_id: groups.medical,
            code: 'TIND',
            name: 'Tindakan',
        });
        const procedure = await json<{ data: { id: string; version: number } }>(
            await admin.post(`${api}/procedures`, {
                code: 'J1',
                name: 'Jahit',
                group_id: groups.medical,
                category_id: category.id,
            }),
            201,
        );
        expect(
            await errorsOf(
                await admin.patch(
                    `${api}/procedure-categories/${category.id}`,
                    {
                        group_id: groups.lab,
                        code: 'TIND',
                        name: 'Tindakan',
                        version: category.version,
                    },
                ),
            ),
        ).toEqual(['group_id']);
        expect(
            await errorsOf(
                await admin.delete(
                    `${api}/procedure-categories/${category.id}`,
                    { version: category.version },
                ),
            ),
        ).toEqual(['_form']);
        expect(
            (
                await admin.delete(`${api}/procedures/${procedure.data.id}`, {
                    version: procedure.data.version,
                })
            ).status,
        ).toBe(204);
        expect(
            (
                await admin.delete(
                    `${api}/procedure-categories/${category.id}`,
                    { version: category.version },
                )
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from sim_m_tindakan_kategori where id = $1',
            [category.id],
        );
        expect(row?.deleted).toBe(true);
    });
});
