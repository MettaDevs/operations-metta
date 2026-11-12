import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { ok, typedQuery } from '../../../platform/http/index.ts';
import { route, searchParams } from '../inventory.routes.ts';
import type { lplpoQuerySchema } from './lplpo.schema.ts';
import { Lplpo } from './lplpo.service.ts';

export function lplpoRoutes() {
    return {
        inventoryLplpo: route('GET', '/api/v1/inventory/reports/lplpo')
            .input(typedQuery<z.input<typeof lplpoQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new Lplpo(
                        context.db,
                        await coreWorkspace(context),
                    ).report(searchParams(context)),
                ),
            ),
    };
}
