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
import type {
    receivablePaymentCancelInputSchema,
    receivablePaymentInputSchema,
} from './receivable-payment.schema.ts';
import { ReceivablePayments } from './receivable-payment.service.ts';

type ListQuery = z.input<typeof listParametersSchema>;

const route = (method: 'GET' | 'POST', path: string) =>
    base.route({
        method,
        path: `/api/v1/billing/${path}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function receivablePayments(context: Context, body?: unknown) {
    return new ReceivablePayments(
        context.db,
        await coreWorkspace(context, body),
    );
}

export function receivablePaymentRoutes() {
    return {
        billingReceivableList: route('GET', 'receivables')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await receivablePayments(context)
                    ).receivables(new URL(context.request.url).searchParams),
                ),
            ),
        billingReceivablePaymentList: route('GET', 'receivable-payments')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await receivablePayments(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        billingReceivablePaymentMetadata: route(
            'GET',
            'receivable-payments/metadata',
        ).handler(async ({ context }) =>
            ok(await (await receivablePayments(context)).metadata()),
        ),
        billingReceivablePaymentCreate: route('POST', 'receivable-payments')
            .input(typedBody<z.input<typeof receivablePaymentInputSchema>>())
            .handler(async ({ context, input }) =>
                (await receivablePayments(context, input.body)).create(
                    input.body,
                ),
            ),
        billingReceivablePaymentCancel: route(
            'POST',
            'receivable-payments/{id}/cancel',
        )
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<
                        z.input<typeof receivablePaymentCancelInputSchema>
                    >(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await receivablePayments(context, input.body)
                    ).cancel(context.request, input.params.id, input.body),
                ),
            ),
    };
}
