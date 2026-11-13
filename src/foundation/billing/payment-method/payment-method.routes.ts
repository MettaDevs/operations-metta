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
    paymentMethodInputSchema,
    paymentMethodListQuerySchema,
} from './payment-method.schema.ts';
import { PaymentMethods } from './payment-method.service.ts';

type Input = z.input<typeof paymentMethodInputSchema>;

const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/billing/payment-methods${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function paymentMethods(context: Context, body?: unknown) {
    return new PaymentMethods(context.db, await coreWorkspace(context, body));
}

export function paymentMethodRoutes() {
    return {
        billingPaymentMethodList: route('GET')
            .input(typedQuery<z.input<typeof paymentMethodListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await paymentMethods(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        billingPaymentMethodCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await paymentMethods(context, input.body)).create(input.body),
            ),
        billingPaymentMethodLegacyImport: route('POST', '/legacy-import')
            .input(typedBody<{ rows: unknown }>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await paymentMethods(context, input.body)
                    ).importLegacy(input.body),
                ),
            ),
        billingPaymentMethodUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await paymentMethods(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        billingPaymentMethodDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await paymentMethods(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
