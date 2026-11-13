import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    drugPriceInputSchema,
    drugPriceListQuerySchema,
} from './drug-price.schema.ts';
import { DrugPrices } from './drug-price.service.ts';

type Input = z.input<typeof drugPriceInputSchema>;

async function drugPrices(context: Context, body?: unknown) {
    return new DrugPrices(context.db, await moduleWorkspace(context, body));
}

export function drugPriceRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/drug-prices`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const record = <T>() =>
        z.object({
            params: z.object({ id: z.string() }),
            body: z.custom<T>(),
        });
    return {
        pharmacyDrugPriceMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await drugPrices(context)).metadata()),
        ),
        pharmacyDrugPriceList: route('GET')
            .input(typedQuery<z.input<typeof drugPriceListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await drugPrices(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyDrugPriceCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await drugPrices(context, input.body)).create(input.body),
            ),
        pharmacyDrugPriceUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await drugPrices(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyDrugPriceDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await drugPrices(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
