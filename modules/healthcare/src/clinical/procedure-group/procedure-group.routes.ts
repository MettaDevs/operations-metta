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
    procedureGroupInputSchema,
    procedureGroupListQuerySchema,
} from './procedure-group.schema.ts';
import { ProcedureGroups } from './procedure-group.service.ts';

type Input = z.input<typeof procedureGroupInputSchema>;

async function procedureGroups(context: Context, body?: unknown) {
    return new ProcedureGroups(
        context.db,
        await moduleWorkspace(context, body),
    );
}

// Kelompok tindakan: dibaca pemegang izin lihat tindakan, ditambah dan diubah pemegang izin ubah tindakan, dihapus
// pemegang izin hapus tindakan.
export function procedureGroupRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/procedure-groups`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareProcedureGroupList: route('GET')
            .input(typedQuery<z.input<typeof procedureGroupListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await procedureGroups(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareProcedureGroupCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await procedureGroups(context, input.body)).create(input.body),
            ),
        healthcareProcedureGroupUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await procedureGroups(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareProcedureGroupDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await procedureGroups(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
