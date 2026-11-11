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
    sectionInputSchema,
    sectionListQuerySchema,
} from './section.schema.ts';
import { Sections } from './section.service.ts';

type Input = z.input<typeof sectionInputSchema>;

async function sections(context: Context, body?: unknown) {
    return new Sections(context.db, await moduleWorkspace(context, body));
}

// Section: dibaca pemegang izin lihat section; tambah, ubah, dan hapus masing-masing dengan izinnya sendiri.
export function sectionRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/sections`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareSectionMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await sections(context)).metadata()),
        ),
        healthcareSectionList: route('GET')
            .input(typedQuery<z.input<typeof sectionListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await sections(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareSectionCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await sections(context, input.body)).create(input.body),
            ),
        healthcareSectionUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await sections(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareSectionDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await sections(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
