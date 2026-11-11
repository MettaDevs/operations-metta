import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { roomInputSchema, roomListQuerySchema } from './room.schema.ts';
import { Rooms } from './room.service.ts';

type Input = z.input<typeof roomInputSchema>;

async function rooms(context: Context, body?: unknown) {
    return new Rooms(context.db, await moduleWorkspace(context, body));
}

// Ruangan: dibaca pemegang izin lihat ruangan; tambah, ubah, dan hapus masing-masing dengan izinnya sendiri.
export function roomRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/rooms`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareRoomMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok(await (await rooms(context)).metadata()),
        ),
        healthcareRoomList: route('GET')
            .input(typedQuery<z.input<typeof roomListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await rooms(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareRoomCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await rooms(context, input.body)).create(input.body),
            ),
        healthcareRoomUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await rooms(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareRoomDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await rooms(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
