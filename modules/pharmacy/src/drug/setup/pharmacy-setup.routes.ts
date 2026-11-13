import type { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { pharmacySetupInputSchema } from './pharmacy-setup.schema.ts';
import { PharmacySetup } from './pharmacy-setup.service.ts';

async function setup(context: Context, body?: unknown) {
    return new PharmacySetup(context.db, await moduleWorkspace(context, body));
}

export function pharmacySetupRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/setup`;
    const route = (method: 'GET' | 'PUT') =>
        base.route({
            method,
            path,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacySetupShow: route('GET').handler(async ({ context }) =>
            ok(await (await setup(context)).show()),
        ),
        pharmacySetupUpdate: route('PUT')
            .input(typedBody<z.input<typeof pharmacySetupInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(await (await setup(context, input.body)).update(input.body)),
            ),
    };
}
