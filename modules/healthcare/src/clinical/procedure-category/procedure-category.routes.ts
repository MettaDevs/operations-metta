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
    procedureCategoryInputSchema,
    procedureCategoryListQuerySchema,
} from './procedure-category.schema.ts';
import { ProcedureCategories } from './procedure-category.service.ts';

type Input = z.input<typeof procedureCategoryInputSchema>;

async function procedureCategories(context: Context, body?: unknown) {
    return new ProcedureCategories(
        context.db,
        await moduleWorkspace(context, body),
    );
}

// Kategori tindakan: dibaca pemegang izin lihat tindakan, diubah pemegang izin ubah tindakan, dihapus pemegang izin hapus
// tindakan.
export function procedureCategoryRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/procedure-categories`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareProcedureCategoryList: route('GET')
            .input(
                typedQuery<z.input<typeof procedureCategoryListQuerySchema>>(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await procedureCategories(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareProcedureCategoryCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await procedureCategories(context, input.body)).create(
                    input.body,
                ),
            ),
        healthcareProcedureCategoryUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await procedureCategories(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareProcedureCategoryDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await procedureCategories(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
