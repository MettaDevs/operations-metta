import { z } from 'zod';
import { coreWorkspace, type Workspace } from '../access/index.ts';
import type { listParametersSchema } from '../http/index.ts';
import {
    base,
    expectedVersion,
    laravelBody,
    ok,
    recordInput,
    typedQuery,
    type Context,
} from '../http/index.ts';
import { checkContact, checkLocation } from './party-address.schema.ts';
import { PartyAddresses } from './party-address.service.ts';
import { Parties } from './party.service.ts';

type Owner = 'party' | 'organization';
const ownerInput = z.object({
    params: z.object({ id: z.string() }),
    body: z.unknown(),
});
const childInput = z.object({
    params: z.object({ id: z.string(), child: z.string() }),
    body: z.unknown(),
});

// Party pemilik alamat. Party di buku alamat harus terlihat dan dibaca dengan izin buku alamat. Organisasi
// (OrganizationLocationController dan OrganizationContactController CoreERP) dibaca setiap anggota tenant karena
// dipakai pemilih di layar lain; organisasi tenant lain dijawab 404.
async function owner(
    context: Context,
    kind: Owner,
    id: string,
    manage: boolean,
    body?: unknown,
): Promise<{
    workspace: Workspace;
    addresses: PartyAddresses;
    partyId: string;
}> {
    const workspace = await coreWorkspace(context, body);
    const addresses = new PartyAddresses(context.db, workspace);
    if (manage) workspace.guard('organization', 'update');
    if (kind === 'party') {
        if (!manage) workspace.guard('organization', 'read');
        const party = await new Parties(context.db, workspace).require(id);
        return { workspace, addresses, partyId: party.id };
    }
    return {
        workspace,
        addresses,
        partyId: await addresses.organizationParty(id),
    };
}

async function location(addresses: PartyAddresses, body: unknown) {
    const { data, problems } = checkLocation(
        laravelBody.parse(body),
        await addresses.references(),
    );
    problems.fail();
    return data;
}

function contact(body: unknown) {
    const { data, problems } = checkContact(laravelBody.parse(body));
    problems.fail();
    return data;
}

const meta = async (context: Context) => ({
    purposes: await context.db.rows(
        z.object({ code: z.string(), name: z.string() }),
        'select code, name from location_purposes order by sort_order',
    ),
    countries: await context.db.rows(
        z.object({ code: z.string(), name: z.string() }),
        'select code, name from country_regions order by name',
    ),
});

function routes(
    kind: Owner,
    path: '/api/v1/parties' | '/api/v1/organizations',
) {
    const route = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', suffix: string) =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const created = (body: object) => ({ status: 201, headers: {}, body });
    const none = { status: 204, headers: {}, body: undefined };
    return {
        locations: route('GET', '/{id}/locations')
            .input(recordInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    false,
                );
                return ok({
                    data: await addresses.locations(partyId),
                    meta: await meta(context),
                });
            }),
        sharableLocations: route('GET', '/{id}/sharable-locations')
            .input(
                recordInput.extend(
                    typedQuery<z.input<typeof listParametersSchema>>().shape,
                ),
            )
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                );
                return ok(
                    await addresses.sharableLocations(
                        partyId,
                        new URL(context.request.url).searchParams,
                    ),
                );
            }),
        locationCreate: route('POST', '/{id}/locations')
            .input(ownerInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                    input.body,
                );
                return created({
                    data: await addresses.saveLocation(
                        partyId,
                        await location(addresses, input.body),
                    ),
                });
            }),
        locationUpdate: route('PUT', '/{id}/locations/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                    input.body,
                );
                const data = await location(addresses, input.body);
                const version = expectedVersion(context.request, input.body);
                return ok({
                    data: await addresses.saveLocation(
                        partyId,
                        data,
                        input.params.child,
                        version,
                    ),
                });
            }),
        locationDelete: route('DELETE', '/{id}/locations/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                    input.body,
                );
                await addresses.deleteLocation(
                    partyId,
                    input.params.child,
                    expectedVersion(context.request, input.body),
                );
                return none;
            }),
        contacts: route('GET', '/{id}/contacts')
            .input(recordInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    false,
                );
                return ok({
                    data: await addresses.contacts(partyId),
                    meta: {
                        types: ['email', 'phone', 'whatsapp', 'fax', 'url'],
                    },
                });
            }),
        contactCreate: route('POST', '/{id}/contacts')
            .input(ownerInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                    input.body,
                );
                return created({
                    data: await addresses.saveContact(
                        partyId,
                        contact(input.body),
                    ),
                });
            }),
        contactUpdate: route('PUT', '/{id}/contacts/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                    input.body,
                );
                const data = contact(input.body);
                const version = expectedVersion(context.request, input.body);
                return ok({
                    data: await addresses.saveContact(
                        partyId,
                        data,
                        input.params.child,
                        version,
                    ),
                });
            }),
        contactDelete: route('DELETE', '/{id}/contacts/{child}')
            .input(childInput)
            .handler(async ({ context, input }) => {
                const { addresses, partyId } = await owner(
                    context,
                    kind,
                    input.params.id,
                    true,
                    input.body,
                );
                await addresses.deleteContact(
                    partyId,
                    input.params.child,
                    expectedVersion(context.request, input.body),
                );
                return none;
            }),
    };
}

// Alamat dan kontak party di buku alamat dan alamat organisasi, di bawah `/api/v1/parties/{id}` dan
// `/api/v1/organizations/{id}` seperti CoreERP.
export function partyAddressRoutes() {
    const party = routes('party', '/api/v1/parties');
    const organization = routes('organization', '/api/v1/organizations');
    return {
        partyLocations: party.locations,
        partySharableLocations: party.sharableLocations,
        partyLocationCreate: party.locationCreate,
        partyLocationUpdate: party.locationUpdate,
        partyLocationDelete: party.locationDelete,
        partyContacts: party.contacts,
        partyContactCreate: party.contactCreate,
        partyContactUpdate: party.contactUpdate,
        partyContactDelete: party.contactDelete,
        organizationLocations: organization.locations,
        organizationSharableLocations: organization.sharableLocations,
        organizationLocationCreate: organization.locationCreate,
        organizationLocationUpdate: organization.locationUpdate,
        organizationLocationDelete: organization.locationDelete,
        organizationContacts: organization.contacts,
        organizationContactCreate: organization.contactCreate,
        organizationContactUpdate: organization.contactUpdate,
        organizationContactDelete: organization.contactDelete,
    };
}
