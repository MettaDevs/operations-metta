import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { base } from '../../../platform/http/index.ts';
import type { paymentInputSchema } from './payment.schema.ts';
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
    };
}
