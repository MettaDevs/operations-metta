import type { z } from 'zod';
import { coreWorkspace } from '../access/index.ts';
import {
    base,
    bodyInput,
    mutationInput,
    ok,
    typedQuery,
    type Context,
} from '../http/index.ts';
import type { groupOfHousesQuerySchema } from './group-of-houses.schema.ts';
import { GroupsOfHouses } from './group-of-houses.service.ts';

const path = '/api/v1/settings/address-setup/group-of-houses';

async function groupsOfHouses(context: Context, body?: unknown) {
    return new GroupsOfHouses(context.db, await coreWorkspace(context, body));
}

// Master dusun/banjar per desa milik tenant. Membaca cukup anggota tenant; membuat, mengubah, dan menghapus butuh
// duty Kelola data referensi.
export function groupOfHousesRoutes() {
    return {
        groupOfHousesList: base
            .route({
                method: 'GET',
                path,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(typedQuery<z.input<typeof groupOfHousesQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await groupsOfHouses(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        groupOfHousesCreate: base
            .route({
                method: 'POST',
                path,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                (await groupsOfHouses(context, input.body)).create(input.body),
            ),
        groupOfHousesUpdate: base
            .route({
                method: 'PATCH',
                path: `${path}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await groupsOfHouses(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        groupOfHousesDelete: base
            .route({
                method: 'DELETE',
                path: `${path}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await groupsOfHouses(context, input.body)).delete(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
