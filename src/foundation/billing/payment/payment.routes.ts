import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { base, ok } from '../../../platform/http/index.ts';
import type {
    paymentCancelInputSchema,
    paymentInputSchema,
} from './payment.schema.ts';
import { Payments } from './payment.service.ts';

export function paymentRoutes() {
    return {
        billingPaymentCreate: base
            .route({
                method: 'POST',
                path: '/api/v1/billing/visits/{id}/payments',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof paymentInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                new Payments(
                    context.db,
                    await coreWorkspace(context, input.body),
                ).create(input.params.id, input.body),
            ),
        billingPaymentCancel: base
            .route({
                method: 'POST',
                path: '/api/v1/billing/payments/{id}/cancel',
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
                ok(
                    await new Payments(
                        context.db,
                        await coreWorkspace(context, input.body),
                    ).cancel(context.request, input.params.id, input.body, {
                        verify: (email, password) =>
                            context.session.verifyApprover(email, password),
                    }),
                ),
            ),
    };
}
