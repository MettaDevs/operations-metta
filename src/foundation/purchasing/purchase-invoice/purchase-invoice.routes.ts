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
    purchaseInvoiceInputSchema,
    purchaseInvoiceListQuerySchema,
    receiptLinesQuerySchema,
} from './purchase-invoice.schema.ts';
import { PurchaseInvoices } from './purchase-invoice.service.ts';

type Input = z.input<typeof purchaseInvoiceInputSchema>;
const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

async function invoices(context: Context, body?: unknown) {
    return new PurchaseInvoices(context.db, await coreWorkspace(context, body));
}

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

export function purchaseInvoiceRoutes() {
    const path = '/api/v1/purchasing/invoices';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingInvoiceList: route('GET')
            .input(typedQuery<z.input<typeof purchaseInvoiceListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await invoices(context)).list(searchParams(context))),
            ),
        purchasingInvoiceReceiptLines: base
            .route({
                method: 'GET',
                path: '/api/v1/purchasing/invoice-receipt-lines',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(typedQuery<z.input<typeof receiptLinesQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await invoices(context)
                    ).receiptLines(searchParams(context)),
                ),
            ),
        purchasingInvoiceShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await invoices(context)).show(input.params.id)),
            ),
        purchasingInvoiceCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await invoices(context, input.body)).create(input.body),
            ),
        purchasingInvoiceUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await invoices(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingInvoiceDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await invoices(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingInvoicePost: route('POST', '/{id}/post')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await invoices(context, input.body)).post(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingInvoiceReverse: route('POST', '/{id}/reverse')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await invoices(context, input.body)).reverse(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
