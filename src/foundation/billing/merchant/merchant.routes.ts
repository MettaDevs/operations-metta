import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import type {
    merchantInputSchema,
    merchantListQuerySchema,
} from './merchant.schema.ts';
import { Merchants } from './merchant.service.ts';

type Input = z.input<typeof merchantInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/billing/merchants${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function merchants(context: Context, body?: unknown) {
    return new Merchants(context.db, await coreWorkspace(context, body));
}

export function merchantRoutes() {
    return {
        billingMerchantList: route('GET')
            .input(typedQuery<z.input<typeof merchantListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await merchants(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        billingMerchantCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await merchants(context, input.body)).create(input.body),
            ),
        billingMerchantUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await merchants(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        billingMerchantDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await merchants(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
