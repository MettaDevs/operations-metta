import { z } from 'zod';
import { coreWorkspace } from '../access/index.ts';
import {
    base,
    bodyInput,
    ok,
    recordInput,
    typedQuery,
    type Context,
} from '../http/index.ts';
import { PartyDuplicates } from './party-duplicate.service.ts';
import { PartyIdentifications } from './party-identification.service.ts';
import { PartyRelationships } from './party-relationship.service.ts';
import type {
    partyListQuerySchema,
    partyOptionsQuerySchema,
} from './party.schema.ts';
import { Parties } from './party.service.ts';

const path = '/api/v1/parties';
const partyInput = z.object({
    params: z.object({ id: z.string() }),
    body: z.unknown(),
});
const childInput = z.object({
    params: z.object({ id: z.string(), child: z.string() }),
    body: z.unknown(),
});
const query = (context: Context) => new URL(context.request.url).searchParams;

async function open(context: Context, body?: unknown) {
    const workspace = await coreWorkspace(context, body);
    return { workspace, parties: new Parties(context.db, workspace) };
}

const route = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    suffix: string,
) =>
    base.route({
        method,
        path: `${path}${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

// Direktori party, nomor identitas, hubungan, dan cek data ganda. Membaca butuh izin buku alamat
// (core.organization.read), mengubah butuh core.organization.update, dan party yang tidak terlihat dijawab 404.
export function partyRoutes() {
    return {
        partyList: route('GET', '')
            .input(typedQuery<z.input<typeof partyListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await open(context)).parties.list(query(context))),
            ),
        partyMetadata: route('GET', '/metadata').handler(async ({ context }) =>
            ok(await (await open(context)).parties.metadata()),
        ),
        partyOptions: route('GET', '/options')
            .input(typedQuery<z.input<typeof partyOptionsQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await open(context)).parties.options(query(context))),
            ),
        partyCreate: route('POST', '')
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                (await open(context, input.body)).parties.create(
                    context.request,
                    input.body,
                ),
            ),
        partyDuplicateCheck: route('POST', '/duplicate-check')
            .input(bodyInput)
            .handler(async ({ context, input }) => {
                const { workspace } = await open(context, input.body);
                return ok(
                    await new PartyDuplicates(context.db, workspace).check(
                        input.body,
                    ),
                );
            }),
        partyDuplicateSettings: route('GET', '/duplicate-settings').handler(
            async ({ context }) => {
                const { workspace } = await open(context);
                return ok(
                    await new PartyDuplicates(context.db, workspace).settings(),
                );
            },
        ),
        partyDuplicateSettingsUpdate: route('PUT', '/duplicate-settings')
            .input(bodyInput)
            .handler(async ({ context, input }) => {
                const { workspace } = await open(context, input.body);
                return ok(
                    await new PartyDuplicates(
                        context.db,
                        workspace,
                    ).updateSettings(context.request, input.body),
                );
            }),
        partyShow: route('GET', '/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await open(context)).parties.show(input.params.id)),
            ),
        partyUpdate: route('PATCH', '/{id}')
            .input(partyInput)
            .handler(async ({ context, input }) =>
                (await open(context, input.body)).parties.update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        partyDelete: route('DELETE', '/{id}')
            .input(partyInput)
            .handler(async ({ context, input }) =>
                (await open(context, input.body)).parties.destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        partyRestore: route('POST', '/{id}/restore')
            .input(partyInput)
            .handler(async ({ context, input }) =>
                (await open(context, input.body)).parties.restore(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        partyDuplicates: route('GET', '/{id}/duplicates')
            .input(recordInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context);
                const party = await parties.require(input.params.id);
                return ok(
                    await new PartyDuplicates(context.db, workspace).forParty(
                        party.id,
                    ),
                );
            }),
        partySeparate: route('POST', '/{id}/separations')
            .input(partyInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyDuplicates(context.db, workspace).separate(
                    party.id,
                    input.body,
                );
            }),
        partyUnseparate: route('DELETE', '/{id}/separations/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyDuplicates(context.db, workspace).unseparate(
                    party.id,
                    input.params.child,
                );
            }),
        partyIdentificationCreate: route('POST', '/{id}/identifications')
            .input(partyInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyIdentifications(context.db, workspace).create(
                    party.id,
                    input.body,
                );
            }),
        partyIdentificationUpdate: route(
            'PATCH',
            '/{id}/identifications/{child}',
        )
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyIdentifications(context.db, workspace).update(
                    context.request,
                    party.id,
                    input.params.child,
                    input.body,
                );
            }),
        partyIdentificationDelete: route(
            'DELETE',
            '/{id}/identifications/{child}',
        )
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyIdentifications(context.db, workspace).delete(
                    context.request,
                    party.id,
                    input.params.child,
                    input.body,
                );
            }),
        partyRelationshipCreate: route('POST', '/{id}/relationships')
            .input(partyInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyRelationships(context.db, workspace).save(
                    context.request,
                    party.id,
                    input.body,
                    null,
                );
            }),
        partyRelationshipUpdate: route('PUT', '/{id}/relationships/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyRelationships(context.db, workspace).save(
                    context.request,
                    party.id,
                    input.body,
                    input.params.child,
                );
            }),
        partyRelationshipDelete: route('DELETE', '/{id}/relationships/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { workspace, parties } = await open(context, input.body);
                const party = await parties.require(input.params.id);
                return new PartyRelationships(context.db, workspace).delete(
                    context.request,
                    party.id,
                    input.params.child,
                    input.body,
                );
            }),
    };
}
