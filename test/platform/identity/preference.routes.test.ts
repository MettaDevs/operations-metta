import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Shell = { auth: { user: { preferences: Record<string, string> } } };

describe.skipIf(!process.env.DB_HOST)('user preferences', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let first: Browser;
    let second: Browser;
    let firstUserId: string;
    afterAll(close);

    async function preferences(as: Browser) {
        const response = await as.get('/api/v1/shell');
        expect(response.status).toBe(200);
        return ((await response.json()) as Shell).auth.user.preferences;
    }
    const dialogLayout = async (as: Browser) =>
        (await preferences(as)).dialog_layout;

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Setelan');
        const a = await createMember(pool, tenantId);
        const b = await createMember(pool, tenantId);
        firstUserId = a.userId;
        first = browser();
        second = browser();
        await first.login(a.email, a.password);
        await second.login(b.email, b.password);
    });

    test('a user who never chose gets the default layout', async () => {
        expect(await dialogLayout(first)).toBe('compact');
    });

    test('the settings screen lists each preference with its choices', async () => {
        const response = await first.get('/api/v1/preferences');
        expect(response.status).toBe(200);
        const { data } = (await response.json()) as {
            data: {
                key: string;
                label: string;
                options: { value: string }[];
            }[];
        };
        const dialog = data.find((item) => item.key === 'dialog_layout');
        expect(dialog?.label).toBe('Tampilan modal');
        expect(dialog?.options.map((option) => option.value)).toEqual([
            'compact',
            'full',
        ]);
    });

    test('a choice is saved for that user only and survives the next request', async () => {
        const response = await first.put('/api/v1/preferences/dialog_layout', {
            value: 'full',
        });
        expect(response.status).toBe(200);
        expect(
            ((await response.json()) as { data: Record<string, string> }).data
                .dialog_layout,
        ).toBe('full');
        expect(await dialogLayout(first)).toBe('full');
        expect(await dialogLayout(second)).toBe('compact');

        const back = await first.put('/api/v1/preferences/dialog_layout', {
            value: 'compact',
        });
        expect(back.status).toBe(200);
        expect(await dialogLayout(first)).toBe('compact');
    });

    test('an unknown preference is refused', async () => {
        const response = await first.put('/api/v1/preferences/font_size', {
            value: 'large',
        });
        expect(response.status).toBe(404);
    });

    test('a value outside the choices is refused and the saved choice stays', async () => {
        await first.put('/api/v1/preferences/dialog_layout', { value: 'full' });
        for (const body of [{ value: 'wide' }, { value: 1 }, {}]) {
            const response = await first.put(
                '/api/v1/preferences/dialog_layout',
                body,
            );
            expect(response.status).toBe(422);
            expect(
                ((await response.json()) as { errors: Record<string, unknown> })
                    .errors,
            ).toHaveProperty('value');
        }
        expect(await dialogLayout(first)).toBe('full');
    });

    test('a stored value that is no longer a choice reads as the default', async () => {
        await pool.unsafe(
            `update users set preferences = '{"dialog_layout":"wide","retired":"x"}' where id = $1`,
            [firstUserId],
        );
        const stored = await preferences(first);
        expect(stored.dialog_layout).toBe('compact');
        expect(stored).not.toHaveProperty('retired');
    });

    test('a visitor without a session cannot read or change preferences', async () => {
        const visitor = browser();
        expect((await visitor.get('/api/v1/preferences')).status).toBe(401);
        expect(
            (
                await visitor.request(
                    'PUT',
                    '/api/v1/preferences/dialog_layout',
                    {
                        body: { value: 'full' },
                        headers: { 'sec-fetch-site': 'same-origin' },
                    },
                )
            ).status,
        ).toBe(401);
    });
});
