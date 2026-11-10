import { z } from 'zod';
import { coreWorkspace } from '../../platform/access/index.ts';
import type { listParametersSchema } from '../../platform/http/index.ts';
import {
    base,
    mutationInput,
    ok,
    recordInput,
    typedBody,
    typedQuery,
    validation,
    type Context,
} from '../../platform/http/index.ts';
import type {
    createSchema,
    sequenceStatuses,
    updateSchema,
} from './number-sequence.schema.ts';
import {
    NumberSequenceDirectory,
    NumberSequences,
} from './number-sequence.service.ts';

const path = '/api/v1/number-sequences';
const nextNumberSchema = z.object({
    next_number: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
type ListQuery = z.input<typeof listParametersSchema> & {
    reference_id?: string;
    area_id?: string;
    scope_type?: string;
    status?: (typeof sequenceStatuses)[number];
};
type ScopeValueQuery = z.input<typeof listParametersSchema> & {
    kind: 'legal_entity' | 'operating_unit' | 'fiscal_period';
    legal_entity_id?: string;
};
type CreateBody = z.input<typeof createSchema>;
type UpdateBody = z.input<typeof updateSchema>;

async function open(
    context: Context,
    action: 'read' | 'update',
    body?: unknown,
) {
    const workspace = await coreWorkspace(context, body);
    workspace.guard('number-sequence', action);
    return {
        workspace,
        directory: new NumberSequenceDirectory(context.db, workspace.tenantId),
        sequences: new NumberSequences(
            context.db,
            workspace.tenantId,
            workspace.userId,
        ),
    };
}

// Nomor dokumen (Number sequences di F&O): daftar per reference dan scope, kartu pengaturan, Next, Status list, dan
// Manual cleanup. Dibaca dengan core.number-sequence.read, diubah dengan core.number-sequence.update.
export function numberSequenceRoutes() {
    const route = (method: 'GET' | 'POST' | 'PATCH', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        numberSequenceList: route('GET')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await open(context, 'read')
                    ).directory.list(new URL(context.request.url).searchParams),
                ),
            ),
        numberSequenceMetadata: route('GET', '/metadata').handler(
            async ({ context }) => {
                const { workspace, directory } = await open(context, 'read');
                return ok({
                    data: await directory.metadata(
                        workspace.permissions.has(
                            'core.number-sequence.update',
                        ),
                    ),
                });
            },
        ),
        numberSequenceScopeValues: route('GET', '/scope-values')
            .input(typedQuery<ScopeValueQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await open(context, 'read')
                    ).directory.scopeValues(
                        new URL(context.request.url).searchParams,
                    ),
                ),
            ),
        numberSequenceShow: route('GET', '/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok({
                    data: await (
                        await open(context, 'read')
                    ).directory.show(input.params.id),
                }),
            ),
        numberSequenceCreate: route('POST')
            .input(typedBody<CreateBody>())
            .handler(async ({ context, input }) => {
                const { directory, sequences } = await open(
                    context,
                    'update',
                    input.body,
                );
                const created = await sequences.create(input.body);
                return {
                    status: 201 as const,
                    headers: {},
                    body: { data: await directory.show(created.id) },
                };
            }),
        numberSequenceUpdate: route('PATCH', '/{id}')
            .input(mutationInput.extend({ body: z.custom<UpdateBody>() }))
            .handler(async ({ context, input }) => {
                const { directory, sequences } = await open(
                    context,
                    'update',
                    input.body,
                );
                await sequences.update(input.params.id, input.body);
                return ok({ data: await directory.show(input.params.id) });
            }),
        numberSequenceNextNumber: route('POST', '/{id}/next-number')
            .input(
                mutationInput.extend({
                    body: z.custom<z.input<typeof nextNumberSchema>>(),
                }),
            )
            .handler(async ({ context, input }) => {
                const { directory, sequences } = await open(
                    context,
                    'update',
                    input.body,
                );
                const parsed = nextNumberSchema.safeParse(input.body);
                if (!parsed.success)
                    validation({
                        next_number: 'Isi nomor berikutnya dengan angka bulat.',
                    });
                await sequences.advance(
                    input.params.id,
                    parsed.data.next_number,
                );
                return ok({ data: await directory.show(input.params.id) });
            }),
        numberSequenceStatusList: route('GET', '/{id}/status-list')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok({
                    data: await (
                        await open(context, 'read')
                    ).sequences.statusList(input.params.id),
                }),
            ),
        numberSequenceCleanup: route('POST', '/{id}/cleanup')
            .input(mutationInput)
            .handler(async ({ context, input }) => {
                const { sequences } = await open(context, 'update', input.body);
                return ok({
                    data: {
                        released: await sequences.cleanup(input.params.id),
                    },
                });
            }),
    };
}
