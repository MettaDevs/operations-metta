import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    ok,
    typedQuery,
    type listParametersSchema,
} from '../../../platform/http/index.ts';
import { masterRoutes, route, searchParams } from '../inventory.routes.ts';
import {
    warehouseEmployeeInputSchema,
    warehouseEmployeeListQuerySchema,
} from './warehouse-employee.schema.ts';
import { WarehouseEmployees } from './warehouse-employee.service.ts';

export function warehouseEmployeeRoutes() {
    const path = '/api/v1/inventory/warehouse-employees';
    const routes = masterRoutes(
        path,
        warehouseEmployeeInputSchema,
        (db, workspace) => new WarehouseEmployees(db, workspace),
        warehouseEmployeeListQuerySchema,
    );
    return {
        inventoryWarehouseEmployeeList: routes.list,
        inventoryWarehouseEmployeeCreate: routes.create,
        inventoryWarehouseEmployeeUpdate: routes.update,
        inventoryWarehouseEmployeeDelete: routes.delete,
        inventoryWarehouseEmployeeUsers: route('GET', `${path}/users`)
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new WarehouseEmployees(
                        context.db,
                        await coreWorkspace(context),
                    ).users(searchParams(context)),
                ),
            ),
    };
}
