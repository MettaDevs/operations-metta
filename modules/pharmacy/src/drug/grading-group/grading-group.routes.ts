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
    gradingGroupInputSchema,
    gradingGroupListQuerySchema,
} from './grading-group.schema.ts';
import { GradingGroups } from './grading-group.service.ts';

type Input = z.input<typeof gradingGroupInputSchema>;

async function gradingGroups(context: Context, body?: unknown) {
    return new GradingGroups(context.db, await moduleWorkspace(context, body));
}

export function gradingGroupRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/grading-groups`;
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
        pharmacyGradingGroupList: route('GET')
            .input(typedQuery<z.input<typeof gradingGroupListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await gradingGroups(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyGradingGroupCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await gradingGroups(context, input.body)).create(input.body),
            ),
        pharmacyGradingGroupUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await gradingGroups(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyGradingGroupDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await gradingGroups(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
