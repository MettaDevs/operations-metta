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
    specialtyInputSchema,
    specialtyListQuerySchema,
} from './specialty.schema.ts';
import { Specialties } from './specialty.service.ts';

type Input = z.input<typeof specialtyInputSchema>;

async function specialties(context: Context, body?: unknown) {
    return new Specialties(context.db, await moduleWorkspace(context, body));
}

// Spesialis: dibaca pemegang izin lihat spesialis; tambah, ubah, dan hapus masing-masing dengan izinnya sendiri.
export function specialtyRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/specialties`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareSpecialtyMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok((await specialties(context)).metadata()),
        ),
        healthcareSpecialtyList: route('GET')
            .input(typedQuery<z.input<typeof specialtyListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await specialties(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareSpecialtyCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await specialties(context, input.body)).create(input.body),
            ),
        healthcareSpecialtyUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await specialties(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareSpecialtyDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await specialties(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
