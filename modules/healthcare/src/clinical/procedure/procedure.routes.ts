import { z } from 'zod';
import {
    base,
    ok,
    recordInput,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { procedurePriceInputSchema } from './procedure-price.schema.ts';
import type {
    procedureInputSchema,
    procedureListQuerySchema,
} from './procedure.schema.ts';
import { Procedures } from './procedure.service.ts';

type Input = Omit<z.input<typeof procedureInputSchema>, 'prices'> & {
    prices?: z.input<typeof procedurePriceInputSchema>[];
};

async function procedures(context: Context, body?: unknown) {
    return new Procedures(context.db, await moduleWorkspace(context, body));
}

// Tindakan: dibaca pemegang izin lihat tindakan, termasuk pemeriksa; tambah, ubah, dan hapus masing-masing dengan izinnya.
export function procedureRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/procedures`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareProcedureMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await procedures(context)).metadata()),
        ),
        healthcareProcedureList: route('GET')
            .input(typedQuery<z.input<typeof procedureListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await procedures(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareProcedureShow: route('GET', '/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await procedures(context)).show(input.params.id)),
            ),
        healthcareProcedureCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await procedures(context, input.body)).create(input.body),
            ),
        healthcareProcedureUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await procedures(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareProcedureDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await procedures(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
