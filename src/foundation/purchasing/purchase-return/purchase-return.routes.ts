import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { base, ok, type Context } from '../../../platform/http/index.ts';
import type {
    purchaseReturnInputSchema,
    purchaseReturnReverseInputSchema,
} from './purchase-return.schema.ts';
import { PurchaseReturns } from './purchase-return.service.ts';

async function returns(context: Context, receiptId: string, body?: unknown) {
    return new PurchaseReturns(
        context.db,
        await coreWorkspace(context, body),
        receiptId,
    );
}

// Retur ke vendor dibuka dari penerimaannya, seperti retur obat dibuka dari penyerahannya.
export function purchaseReturnRoutes() {
    const path = '/api/v1/purchasing/receipts/{id}/returns';
    const route = (method: 'GET' | 'POST', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingReturnList: route('GET')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await returns(context, input.params.id)).show()),
            ),
        purchasingReturnCreate: route('POST')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof purchaseReturnInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await returns(context, input.params.id, input.body)
                    ).create(input.body),
                ),
            ),
        purchasingReturnReverse: route('POST', '/{returnId}/reverse')
            .input(
                z.object({
                    params: z.object({ id: z.string(), returnId: z.string() }),
                    body: z.custom<
                        z.input<typeof purchaseReturnReverseInputSchema>
                    >(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await returns(context, input.params.id, input.body)
                    ).reverse(input.params.returnId, input.body),
                ),
            ),
    };
}
