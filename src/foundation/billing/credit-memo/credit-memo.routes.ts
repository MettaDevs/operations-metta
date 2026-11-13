import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { base } from '../../../platform/http/index.ts';
import type { paymentCancelInputSchema } from '../payment/payment.schema.ts';
import { CreditMemos } from './credit-memo.service.ts';

export function creditMemoRoutes() {
    return {
        billingPaymentCreditMemo: base
            .route({
                method: 'POST',
                path: '/api/v1/billing/payments/{id}/credit-memo',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof paymentCancelInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                new CreditMemos(
                    context.db,
                    await coreWorkspace(context, input.body),
                ).post(context.request, input.params.id, input.body, {
                    verify: (email, password) =>
                        context.session.verifyApprover(email, password),
                }),
            ),
    };
}
