import { z } from 'zod';
import { coreWorkspace } from '../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    type Context,
} from '../../platform/http/index.ts';
import type { exchangeRateInputSchema } from './exchange-rate.schema.ts';
import { ExchangeRates } from './exchange-rate.service.ts';

type Input = z.input<typeof exchangeRateInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/exchange-rates${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function exchangeRates(context: Context, body?: unknown) {
    return new ExchangeRates(context.db, await coreWorkspace(context, body));
}

export function exchangeRateRoutes() {
    return {
        exchangeRateList: route('GET').handler(async ({ context }) =>
            ok(await (await exchangeRates(context)).list()),
        ),
        exchangeRateCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await exchangeRates(context, input.body)).create(input.body),
            ),
        exchangeRateUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await exchangeRates(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        exchangeRateDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await exchangeRates(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
