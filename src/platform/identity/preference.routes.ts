import { z } from 'zod';
import { base, ok, typedBody } from '../http/index.ts';
import { preferenceDefinitions } from './preference.schema.ts';
import { updatePreference } from './preference.service.ts';

export function preferenceRoutes() {
    return {
        preferences: base
            .route({
                method: 'GET',
                path: '/api/v1/preferences',
                outputStructure: 'detailed',
            })
            .handler(({ context }) => {
                context.session.requireUser();
                return ok({ data: preferenceDefinitions() });
            }),
        preferenceUpdate: base
            .route({
                method: 'PUT',
                path: '/api/v1/preferences/{key}',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(
                typedBody<{ value: string }>().extend({
                    params: z.object({ key: z.string() }),
                }),
            )
            .handler(async ({ context, input }) =>
                ok({
                    data: await updatePreference(
                        context.db,
                        context.session,
                        input.params.key,
                        input.body,
                    ),
                }),
            ),
    };
}
