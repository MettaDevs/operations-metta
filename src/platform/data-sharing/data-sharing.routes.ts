import { z } from 'zod';
import { coreWorkspace } from '../access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../http/index.ts';
import type {
    dataSharingPolicyInputSchema,
    dataSharingPolicyListQuerySchema,
} from './data-sharing.schema.ts';
import { DataSharingPolicies } from './data-sharing.service.ts';

type Input = z.input<typeof dataSharingPolicyInputSchema>;
const recordBody = z.object({
    params: z.object({ id: z.string() }),
    body: z.custom<Input>(),
});

async function policies(context: Context, body?: unknown) {
    return new DataSharingPolicies(
        context.db,
        await coreWorkspace(context, body),
    );
}

// Kebijakan data sharing antar perusahaan (Sys Admin → Data sharing): dibaca dengan core.data-sharing.read, diubah
// dengan core.data-sharing.update.
export function dataSharingRoutes() {
    const path = '/api/v1/data-sharing-policies';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        dataSharingPolicyList: route('GET')
            .input(
                typedQuery<z.input<typeof dataSharingPolicyListQuerySchema>>(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await policies(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        dataSharingTypes: route('GET', '/data-types').handler(
            async ({ context }) => ok(await (await policies(context)).types()),
        ),
        dataSharingLegalEntities: route('GET', '/legal-entities')
            .input(typedQuery<{ data_type?: string }>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await policies(context)
                    ).legalEntities(
                        new URL(context.request.url).searchParams.get(
                            'data_type',
                        ),
                    ),
                ),
            ),
        dataSharingPolicyCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await policies(context, input.body)).create(input.body),
            ),
        dataSharingPolicyUpdate: route('PATCH', '/{id}')
            .input(recordBody)
            .handler(async ({ context, input }) =>
                (await policies(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        dataSharingPolicyDelete: route('DELETE', '/{id}')
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
