import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { ok, typedQuery } from '../../../platform/http/index.ts';
import { route, searchParams } from '../inventory.routes.ts';
import type { stockByLocationQuerySchema } from './stock-by-location.schema.ts';
import { StockByLocation } from './stock-by-location.service.ts';

export function stockByLocationRoutes() {
    return {
        inventoryStockByLocation: route(
            'GET',
            '/api/v1/inventory/reports/stock-by-location',
        )
            .input(typedQuery<z.input<typeof stockByLocationQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new StockByLocation(
                        context.db,
                        await coreWorkspace(context),
                    ).report(searchParams(context)),
                ),
            ),
    };
}
