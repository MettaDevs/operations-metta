import { z } from 'zod';
import { coreWorkspace } from '../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    type Context,
} from '../../platform/http/index.ts';
import type { currencyInputSchema } from './currency.schema.ts';
import { Currencies } from './currency.service.ts';

type Input = z.input<typeof currencyInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/currencies${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function currencies(context: Context, body?: unknown) {
    return new Currencies(context.db, await coreWorkspace(context, body));
}

export function currencyRoutes() {
    return {
        currencyList: route('GET').handler(async ({ context }) =>
            ok(await (await currencies(context)).list()),
        ),
        currencyCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await currencies(context, input.body)).create(input.body),
            ),
        currencyUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await currencies(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
