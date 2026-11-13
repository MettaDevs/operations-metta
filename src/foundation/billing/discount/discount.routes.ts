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
    discountInputSchema,
    discountListQuerySchema,
} from './discount.schema.ts';
import { Discounts } from './discount.service.ts';

type Input = z.input<typeof discountInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/billing/discounts${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function discounts(context: Context, body?: unknown) {
    return new Discounts(context.db, await coreWorkspace(context, body));
}

export function discountRoutes() {
    return {
        billingDiscountList: route('GET')
            .input(typedQuery<z.input<typeof discountListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await discounts(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        billingDiscountMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await discounts(context)).metadata()),
        ),
        billingDiscountCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await discounts(context, input.body)).create(input.body),
            ),
        billingDiscountUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await discounts(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        billingDiscountDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await discounts(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
