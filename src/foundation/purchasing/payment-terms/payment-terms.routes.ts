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
import type { paymentTermsInputSchema } from './payment-terms.schema.ts';
import { PaymentTerms } from './payment-terms.service.ts';

type Input = z.input<typeof paymentTermsInputSchema>;

async function paymentTerms(context: Context, body?: unknown) {
    return new PaymentTerms(context.db, await coreWorkspace(context, body));
}

const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

export function paymentTermsRoutes() {
    const path = '/api/v1/purchasing/payment-terms';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingPaymentTermsList: route('GET')
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await paymentTerms(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        purchasingPaymentTermsCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await paymentTerms(context, input.body)).create(input.body),
            ),
        purchasingPaymentTermsUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await paymentTerms(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingPaymentTermsDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await paymentTerms(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
