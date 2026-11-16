import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    type Context,
} from '../../../platform/http/index.ts';
import type { billingSetupInputSchema } from './billing-setup.schema.ts';
import { BillingSetup } from './billing-setup.service.ts';

const route = (method: 'GET' | 'PUT') =>
    base.route({
        method,
        path: '/api/v1/billing/setup',
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function setup(context: Context, body?: unknown) {
    return new BillingSetup(context.db, await coreWorkspace(context, body));
}

export function billingSetupRoutes() {
    return {
        billingSetupShow: route('GET').handler(async ({ context }) =>
            ok(await (await setup(context)).show()),
        ),
        billingSetupUpdate: route('PUT')
            .input(typedBody<z.input<typeof billingSetupInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(await (await setup(context, input.body)).update(input.body)),
            ),
    };
}
