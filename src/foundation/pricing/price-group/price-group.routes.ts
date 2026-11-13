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
    priceGroupInputSchema,
    priceGroupListQuerySchema,
} from './price-group.schema.ts';
import { PriceGroups } from './price-group.service.ts';

type Input = z.input<typeof priceGroupInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/pricing/price-groups${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function priceGroups(context: Context, body?: unknown) {
    return new PriceGroups(context.db, await coreWorkspace(context, body));
}

export function priceGroupRoutes() {
    return {
        pricingPriceGroupList: route('GET')
            .input(typedQuery<z.input<typeof priceGroupListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await priceGroups(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pricingPriceGroupCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await priceGroups(context, input.body)).create(input.body),
            ),
        pricingPriceGroupUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await priceGroups(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pricingPriceGroupDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await priceGroups(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
