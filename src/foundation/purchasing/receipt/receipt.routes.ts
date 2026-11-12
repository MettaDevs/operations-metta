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
    receiptInputSchema,
    receiptListQuerySchema,
} from './receipt.schema.ts';
import { Receipts } from './receipt.service.ts';

type Input = z.input<typeof receiptInputSchema>;
const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

async function receipts(context: Context, body?: unknown) {
    return new Receipts(context.db, await coreWorkspace(context, body));
}

export function receiptRoutes() {
    const path = '/api/v1/purchasing/receipts';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingReceiptList: route('GET')
            .input(typedQuery<z.input<typeof receiptListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await receipts(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        purchasingReceiptShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await receipts(context)).show(input.params.id)),
            ),
        purchasingReceiptCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await receipts(context, input.body)).create(input.body),
            ),
        purchasingReceiptUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await receipts(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingReceiptDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await receipts(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingReceiptPost: route('POST', '/{id}/post')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await receipts(context, input.body)).post(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingReceiptReverse: route('POST', '/{id}/reverse')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await receipts(context, input.body)).reverse(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
