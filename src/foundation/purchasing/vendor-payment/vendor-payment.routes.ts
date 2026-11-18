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
    openEntriesQuerySchema,
    vendorPaymentInputSchema,
    vendorPaymentListQuerySchema,
    vendorPaymentSuggestionInputSchema,
} from './vendor-payment.schema.ts';
import { VendorPayments } from './vendor-payment.service.ts';

type Input = z.input<typeof vendorPaymentInputSchema>;
const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

async function payments(context: Context, body?: unknown) {
    return new VendorPayments(context.db, await coreWorkspace(context, body));
}

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

export function vendorPaymentRoutes() {
    const path = '/api/v1/purchasing/vendor-payments';
    const route = (
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        suffix = '',
        root: `/${string}` = path,
    ) =>
        base.route({
            method,
            path: `${root}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingVendorPaymentList: route('GET')
            .input(typedQuery<z.input<typeof vendorPaymentListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await payments(context)).list(searchParams(context))),
            ),
        purchasingVendorPaymentSuggest: route(
            'POST',
            '',
            '/api/v1/purchasing/vendor-payment-suggestions',
        )
            .input(
                typedBody<z.input<typeof vendorPaymentSuggestionInputSchema>>(),
            )
            .handler(async ({ context, input }) =>
                (await payments(context, input.body)).suggest(input.body),
            ),
        purchasingVendorPaymentMethods: route(
            'GET',
            '',
            '/api/v1/purchasing/vendor-payment-methods',
        ).handler(async ({ context }) =>
            ok(await (await payments(context)).paymentMethods()),
        ),
        purchasingVendorPaymentOpenEntries: route(
            'GET',
            '',
            '/api/v1/purchasing/vendor-payment-entries',
        )
            .input(typedQuery<z.input<typeof openEntriesQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await payments(context)
                    ).openEntries(searchParams(context)),
                ),
            ),
        purchasingVendorPaymentShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await payments(context)).show(input.params.id)),
            ),
        purchasingVendorPaymentCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await payments(context, input.body)).create(input.body),
            ),
        purchasingVendorPaymentUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await payments(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingVendorPaymentDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await payments(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingVendorPaymentPost: route('POST', '/{id}/post')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await payments(context, input.body)).post(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingVendorPaymentReverse: route('POST', '/{id}/reverse')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await payments(context, input.body)).reverse(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
