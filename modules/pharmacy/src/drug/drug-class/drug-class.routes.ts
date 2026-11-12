import { z } from 'zod';
import {
    base,
    type listParametersSchema,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { drugClassInputSchema } from './drug-class.schema.ts';
import { DrugClasses } from './drug-class.service.ts';

type Input = z.input<typeof drugClassInputSchema>;

async function drugClasses(context: Context, body?: unknown) {
    return new DrugClasses(context.db, await moduleWorkspace(context, body));
}

export function drugClassRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/drug-classes`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const record = <T>() =>
        z.object({
            params: z.object({ id: z.string() }),
            body: z.custom<T>(),
        });
    return {
        pharmacyDrugClassList: route('GET')
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await drugClasses(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyDrugClassCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await drugClasses(context, input.body)).create(input.body),
            ),
        pharmacyDrugClassUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await drugClasses(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyDrugClassDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await drugClasses(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
