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
    lifeCycleInputSchema,
    lifeCycleListQuerySchema,
} from './life-cycle.schema.ts';
import { LifeCycles } from './life-cycle.service.ts';

type Input = z.input<typeof lifeCycleInputSchema>;

async function lifeCycles(context: Context, body?: unknown) {
    return new LifeCycles(context.db, await moduleWorkspace(context, body));
}

// Siklus hidup: dibaca pemegang izin lihat siklus hidup; tambah, ubah, dan hapus masing-masing dengan izinnya sendiri.
export function lifeCycleRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/life-cycles`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareLifeCycleMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await lifeCycles(context)).metadata()),
        ),
        healthcareLifeCycleList: route('GET')
            .input(typedQuery<z.input<typeof lifeCycleListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await lifeCycles(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareLifeCycleCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await lifeCycles(context, input.body)).create(input.body),
            ),
        healthcareLifeCycleUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await lifeCycles(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareLifeCycleDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await lifeCycles(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
