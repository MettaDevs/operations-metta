import { z } from 'zod';
import { coreWorkspace, type Workspace } from '../../platform/access/index.ts';
import type { Database } from '../../platform/database/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
    type listParametersSchema,
} from '../../platform/http/index.ts';

export const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: `/${string}`,
) =>
    base.route({
        method,
        path,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

export const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

export const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

type MasterService<L, C, U, D> = {
    list(parameters: URLSearchParams): Promise<L>;
    create(body: unknown): Promise<C>;
    update(request: Request, id: string, body: unknown): Promise<U>;
    destroy(request: Request, id: string, body: unknown): Promise<D>;
};

// Schema isian dan saringan daftar hanya memberi tipe kepada pemanggil di layar; isian, saringan, dan izinnya diperiksa
// service.
export function masterRoutes<
    Input extends z.ZodType,
    L extends object,
    C extends object,
    U extends object,
    D extends object,
    Query extends z.ZodType = typeof listParametersSchema,
>(
    path: `/${string}`,
    _input: Input,
    open: (db: Database, workspace: Workspace) => MasterService<L, C, U, D>,
    _query?: Query,
) {
    const service = async (context: Context, body?: unknown) =>
        open(context.db, await coreWorkspace(context, body));
    return {
        list: route('GET', path)
            .input(typedQuery<z.input<Query>>())
            .handler(async ({ context }) =>
                ok(await (await service(context)).list(searchParams(context))),
            ),
        create: route('POST', path)
            .input(typedBody<z.input<Input>>())
            .handler(async ({ context, input }) =>
                (await service(context, input.body)).create(input.body),
            ),
        update: route('PATCH', `${path}/{id}`)
            .input(record<z.input<Input>>())
            .handler(async ({ context, input }) =>
                (await service(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        delete: route('DELETE', `${path}/{id}`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await service(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
