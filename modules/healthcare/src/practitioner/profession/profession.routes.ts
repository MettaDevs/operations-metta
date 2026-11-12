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
    professionInputSchema,
    professionListQuerySchema,
} from './profession.schema.ts';
import { Professions } from './profession.service.ts';

type Input = z.input<typeof professionInputSchema>;

async function professions(context: Context, body?: unknown) {
    return new Professions(context.db, await moduleWorkspace(context, body));
}

// Profesi: dibaca pemegang izin lihat profesi; tambah, ubah, dan hapus masing-masing dengan izinnya sendiri.
export function professionRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/professions`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareProfessionMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok((await professions(context)).metadata()),
        ),
        healthcareProfessionList: route('GET')
            .input(typedQuery<z.input<typeof professionListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await professions(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareProfessionCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await professions(context, input.body)).create(input.body),
            ),
        healthcareProfessionUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await professions(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareProfessionDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await professions(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
