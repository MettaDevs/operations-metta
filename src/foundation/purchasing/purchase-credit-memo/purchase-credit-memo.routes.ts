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
    creditSourceQuerySchema,
    purchaseCreditMemoInputSchema,
    purchaseCreditMemoListQuerySchema,
} from './purchase-credit-memo.schema.ts';
import { PurchaseCreditMemos } from './purchase-credit-memo.service.ts';

type Input = z.input<typeof purchaseCreditMemoInputSchema>;
type SourceQuery = z.input<typeof creditSourceQuerySchema>;
const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

async function memos(context: Context, body?: unknown) {
    return new PurchaseCreditMemos(
        context.db,
        await coreWorkspace(context, body),
    );
}

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

const lookup = (path: string) =>
    base.route({
        method: 'GET',
        path: `/api/v1/purchasing/${path}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

export function purchaseCreditMemoRoutes() {
    const path = '/api/v1/purchasing/credit-memos';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingCreditMemoList: route('GET')
            .input(
                typedQuery<z.input<typeof purchaseCreditMemoListQuerySchema>>(),
            )
            .handler(async ({ context }) =>
                ok(await (await memos(context)).list(searchParams(context))),
            ),
        purchasingCreditMemoReturnLines: lookup('credit-memo-return-lines')
            .input(typedQuery<SourceQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await memos(context)
                    ).returnLines(searchParams(context)),
                ),
            ),
        purchasingCreditMemoInvoiceLines: lookup('credit-memo-invoice-lines')
            .input(typedQuery<SourceQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await memos(context)
                    ).invoiceLines(searchParams(context)),
                ),
            ),
        purchasingCreditMemoInvoiceEntries: lookup(
            'credit-memo-invoice-entries',
        )
            .input(typedQuery<SourceQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await memos(context)
                    ).openInvoiceEntries(searchParams(context)),
                ),
            ),
        purchasingCreditMemoShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await memos(context)).show(input.params.id)),
            ),
        purchasingCreditMemoCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await memos(context, input.body)).create(input.body),
            ),
        purchasingCreditMemoUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await memos(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingCreditMemoDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await memos(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingCreditMemoPost: route('POST', '/{id}/post')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await memos(context, input.body)).post(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingCreditMemoReverse: route('POST', '/{id}/reverse')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await memos(context, input.body)).reverse(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
