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
    chargeComponentInputSchema,
    chargeComponentListQuerySchema,
} from './charge-component.schema.ts';
import { ChargeComponents } from './charge-component.service.ts';

type Input = z.input<typeof chargeComponentInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/pricing/charge-components${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function chargeComponents(context: Context, body?: unknown) {
    return new ChargeComponents(context.db, await coreWorkspace(context, body));
}

export function chargeComponentRoutes() {
    return {
        pricingChargeComponentList: route('GET')
            .input(typedQuery<z.input<typeof chargeComponentListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await chargeComponents(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pricingChargeComponentCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await chargeComponents(context, input.body)).create(
                    input.body,
                ),
            ),
        pricingChargeComponentUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await chargeComponents(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pricingChargeComponentDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await chargeComponents(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
