import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
    type listParametersSchema,
} from '../../../platform/http/index.ts';
import type { bankAccountInputSchema } from './bank-account.schema.ts';
import { BankAccounts } from './bank-account.service.ts';

type Input = z.input<typeof bankAccountInputSchema>;

async function bankAccounts(context: Context, body?: unknown) {
    return new BankAccounts(context.db, await coreWorkspace(context, body));
}

const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

export function bankAccountRoutes() {
    const path = '/api/v1/bank/accounts';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        bankAccountList: route('GET')
            .input(
                typedQuery<
                    z.input<typeof listParametersSchema> & { usable?: '1' }
                >(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await bankAccounts(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        bankAccountCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await bankAccounts(context, input.body)).create(input.body),
            ),
        bankAccountUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await bankAccounts(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        bankAccountDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await bankAccounts(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
