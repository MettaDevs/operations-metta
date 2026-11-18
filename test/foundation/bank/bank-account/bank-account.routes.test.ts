import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Account = {
    id: string;
    code: string;
    name: string;
    bank_name: string;
    account_number: string;
    currency_code: string | null;
    blocked: boolean;
    version: number;
};
type Errors = { errors: Record<string, string[]> };

const path = '/api/v1/bank/accounts';

describe.skipIf(!process.env.DB_HOST)('bank accounts', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let business: Business;

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Rekening', [
            ...inventoryDuties,
            'core.bank-account.manage',
        ]);
        await pool.unsafe(
            `insert into currency_precisions (id, tenant_id, currency_code, amount_decimals, unit_amount_decimals,
                                              created_at, updated_at)
             values (gen_random_uuid(), $1, 'USD', 2, 2, now(), now())`,
            [business.tenantId],
        );
    });

    const create = async (body: Record<string, unknown>) =>
        (
            await json<{ data: Account }>(
                await business.admin.post(path, body),
                201,
            )
        ).data;
    const usable = async () =>
        (
            await json<{ data: Account[] }>(
                await business.admin.get(`${path}?usable=1`),
                200,
            )
        ).data.map((account) => account.code);

    test('a code is uppercased, unique among live accounts, and free again after delete', async () => {
        const account = await create({
            code: ' bca-ops ',
            name: 'Operasional',
            bank_name: 'BCA',
            account_number: '1234567890',
        });
        expect(account).toMatchObject({
            code: 'BCA-OPS',
            bank_name: 'BCA',
            currency_code: null,
            blocked: false,
        });
        const taken = await json<Errors>(
            await business.admin.post(path, {
                code: 'BCA-OPS',
                name: 'Lain',
                bank_name: 'BCA',
                account_number: '1',
            }),
            422,
        );
        expect(taken.errors.code?.[0]).toContain('sudah dipakai');
        expect(
            (
                await business.admin.delete(`${path}/${account.id}`, {
                    version: account.version,
                })
            ).status,
        ).toBe(204);
        expect(
            await create({
                code: 'BCA-OPS',
                name: 'Operasional',
                bank_name: 'BCA',
                account_number: '1234567890',
            }),
        ).toMatchObject({ code: 'BCA-OPS' });
    });

    test('bank name, account number, and a configured currency are required to be valid', async () => {
        const invalid = await json<Errors>(
            await business.admin.post(path, {
                code: 'X',
                name: 'Salah',
                bank_name: ' ',
                account_number: '',
                currency_code: 'EUR',
            }),
            422,
        );
        expect(Object.keys(invalid.errors).sort()).toEqual([
            'account_number',
            'bank_name',
            'currency_code',
        ]);
        expect(
            await create({
                code: 'USD-1',
                name: 'Valas',
                bank_name: 'BCA',
                account_number: '777',
                currency_code: 'usd',
            }),
        ).toMatchObject({ currency_code: 'USD' });
    });

    test('the usable list leaves out blocked and foreign-currency accounts', async () => {
        const account = await create({
            code: 'MDR',
            name: 'Mandiri',
            bank_name: 'Mandiri',
            account_number: '555',
        });
        expect(await usable()).toContain('MDR');
        expect(await usable()).not.toContain('USD-1');
        const blocked = (
            await json<{ data: Account }>(
                await business.admin.patch(`${path}/${account.id}`, {
                    code: 'MDR',
                    name: 'Mandiri',
                    bank_name: 'Mandiri',
                    account_number: '555',
                    blocked: true,
                    version: account.version,
                }),
                200,
            )
        ).data;
        expect(blocked.blocked).toBe(true);
        expect(await usable()).not.toContain('MDR');
    });

    test('reading accounts is separate from changing them', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.bank-account.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const session = browser();
        await session.login(reader.email, reader.password);
        const listed = await json<{ can_manage: boolean }>(
            await session.get(path),
            200,
        );
        expect(listed.can_manage).toBe(false);
        expect(
            (
                await session.post(path, {
                    code: 'NO',
                    name: 'No',
                    bank_name: 'No',
                    account_number: '0',
                })
            ).status,
        ).toBe(403);
    });
});
