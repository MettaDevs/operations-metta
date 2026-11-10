import type { z } from 'zod';
import { coreWorkspace } from '../access/index.ts';
import {
    base,
    bodyInput,
    listParametersSchema,
    mutationInput,
    ok,
    typedQuery,
    type Context,
} from '../http/index.ts';
import { Occupations } from './occupation.service.ts';

const path = '/api/v1/occupations';

async function occupations(context: Context, body?: unknown) {
    return new Occupations(context.db, await coreWorkspace(context, body));
}

// Master pekerjaan per tenant: dibaca dengan izin buku alamat, diubah dengan izin ubah buku alamat.
export function occupationRoutes() {
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        occupationList: route('GET')
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await occupations(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        occupationCreate: route('POST')
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                (await occupations(context, input.body)).create(input.body),
            ),
        occupationUpdate: route('PATCH', '/{id}')
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await occupations(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        occupationDelete: route('DELETE', '/{id}')
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await occupations(context, input.body)).delete(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
