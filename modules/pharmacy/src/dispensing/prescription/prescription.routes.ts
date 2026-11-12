import { z } from 'zod';
import {
    base,
    ok,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { prescriptionListQuerySchema } from './prescription.schema.ts';
import { Prescriptions } from './prescription.service.ts';

async function prescriptions(context: Context) {
    return new Prescriptions(context.db, await moduleWorkspace(context));
}

export function prescriptionRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/prescriptions`;
    const route = (method: 'GET', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyPrescriptionMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await prescriptions(context)).metadata()),
        ),
        pharmacyPrescriptionList: route('GET')
            .input(typedQuery<z.input<typeof prescriptionListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await prescriptions(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyPrescriptionShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await prescriptions(context)).show(input.params.id)),
            ),
    };
}
