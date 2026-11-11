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
    practitionerInputSchema,
    practitionerListQuerySchema,
    practitionerUserQuerySchema,
} from './practitioner.schema.ts';
import { Practitioners } from './practitioner.service.ts';

type Input = z.input<typeof practitionerInputSchema>;
const recordBody = z.object({
    params: z.object({ id: z.string() }),
    body: z.custom<Input>(),
});

async function practitioners(context: Context, body?: unknown) {
    return new Practitioners(context.db, await moduleWorkspace(context, body));
}

// Tenaga kesehatan: dibaca pemegang izin lihat nakes, diubah pemegang izin ubah nakes.
export function practitionerRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/practitioners`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const query = (context: Context) =>
        new URL(context.request.url).searchParams;
    return {
        healthcarePractitionerList: route('GET')
            .input(typedQuery<z.input<typeof practitionerListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await practitioners(context)).list(query(context))),
            ),
        healthcarePractitionerMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await practitioners(context)).metadata()),
        ),
        healthcarePractitionerUsers: route('GET', '/users')
            .input(typedQuery<z.input<typeof practitionerUserQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await practitioners(context)).users(query(context))),
            ),
        healthcarePractitionerCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await practitioners(context, input.body)).create(input.body),
            ),
        healthcarePractitionerUpdate: route('PATCH', '/{id}')
            .input(recordBody)
            .handler(async ({ context, input }) =>
                (await practitioners(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcarePractitionerDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await practitioners(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
