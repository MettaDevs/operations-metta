import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    sharingPolicyInputSchema,
    sharingPolicyListQuerySchema,
} from './sharing-policy.schema.ts';
import { SharingPolicies } from './sharing-policy.service.ts';

type Input = z.input<typeof sharingPolicyInputSchema>;
const recordBody = z.object({
    params: z.object({ id: z.string() }),
    body: z.custom<Input>(),
});

async function policies(context: Context, body?: unknown) {
    return new SharingPolicies(
        context.db,
        await moduleWorkspace(context, body),
    );
}

// Kebijakan berbagi pasien antar legal entity: dibaca dengan izin lihat, diubah dengan izin ubah kebijakan berbagi.
export function sharingPolicyRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/sharing-policies`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareSharingPolicyList: route('GET')
            .input(typedQuery<z.input<typeof sharingPolicyListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await policies(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareSharingPolicyLegalEntities: route(
            'GET',
            '/legal-entities',
        ).handler(async ({ context }) =>
            ok(await (await policies(context)).legalEntities()),
        ),
        healthcareSharingPolicyCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await policies(context, input.body)).create(input.body),
            ),
        healthcareSharingPolicyUpdate: route('PATCH', '/{id}')
            .input(recordBody)
            .handler(async ({ context, input }) =>
                (await policies(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareSharingPolicyDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await policies(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
