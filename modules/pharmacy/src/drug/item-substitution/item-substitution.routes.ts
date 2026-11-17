import { z } from 'zod';
import { base, ok, type Context } from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { itemSubstitutionInputSchema } from './item-substitution.schema.ts';
import { ItemSubstitutions } from './item-substitution.service.ts';

async function itemSubstitutions(context: Context, body?: unknown) {
    return new ItemSubstitutions(
        context.db,
        await moduleWorkspace(context, body),
    );
}

// Obat pengganti dibaca dan diubah dari kartu data obat farmasi, jadi alamatnya di bawah obat itu.
export function itemSubstitutionRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/drugs/{id}/substitutions`;
    const route = (method: 'GET' | 'POST' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyItemSubstitutionList: route('GET')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await itemSubstitutions(context)
                    ).list(input.params.id),
                ),
            ),
        pharmacyItemSubstitutionCreate: route('POST')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<
                        z.input<typeof itemSubstitutionInputSchema>
                    >(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await itemSubstitutions(context, input.body)
                    ).create(input.params.id, input.body),
                ),
            ),
        pharmacyItemSubstitutionDelete: route('DELETE', '/{substitutionId}')
            .input(
                z.object({
                    params: z.object({
                        id: z.string(),
                        substitutionId: z.string(),
                    }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await itemSubstitutions(context, input.body)
                    ).destroy(
                        context.request,
                        input.params.id,
                        input.params.substitutionId,
                        input.body,
                    ),
                ),
            ),
    };
}
