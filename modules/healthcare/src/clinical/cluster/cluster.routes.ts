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
    clusterInputSchema,
    clusterListQuerySchema,
} from './cluster.schema.ts';
import { Clusters } from './cluster.service.ts';

type Input = z.input<typeof clusterInputSchema>;

async function clusters(context: Context, body?: unknown) {
    return new Clusters(context.db, await moduleWorkspace(context, body));
}

// Klaster: dibaca pemegang izin lihat klaster; tambah, ubah, dan hapus masing-masing dengan izinnya sendiri.
export function clusterRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/clusters`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareClusterMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok((await clusters(context)).metadata()),
        ),
        healthcareClusterList: route('GET')
            .input(typedQuery<z.input<typeof clusterListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await clusters(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareClusterCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await clusters(context, input.body)).create(input.body),
            ),
        healthcareClusterUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await clusters(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareClusterDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await clusters(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
