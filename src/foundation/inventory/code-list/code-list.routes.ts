import { masterRoutes } from '../inventory.routes.ts';
import { codeListInputSchema } from './code-list.schema.ts';
import {
    CodeLists,
    fundingSources,
    procurementPrograms,
    reasonCodes,
    unitsOfMeasure,
} from './code-list.service.ts';

export function codeListRoutes() {
    const units = masterRoutes(
        '/api/v1/inventory/units-of-measure',
        codeListInputSchema,
        (db, workspace) => new CodeLists(db, workspace, unitsOfMeasure),
    );
    const reasons = masterRoutes(
        '/api/v1/inventory/reason-codes',
        codeListInputSchema,
        (db, workspace) => new CodeLists(db, workspace, reasonCodes),
    );
    const funding = masterRoutes(
        '/api/v1/inventory/funding-sources',
        codeListInputSchema,
        (db, workspace) => new CodeLists(db, workspace, fundingSources),
    );
    const programs = masterRoutes(
        '/api/v1/inventory/procurement-programs',
        codeListInputSchema,
        (db, workspace) => new CodeLists(db, workspace, procurementPrograms),
    );
    return {
        inventoryUnitOfMeasureList: units.list,
        inventoryUnitOfMeasureCreate: units.create,
        inventoryUnitOfMeasureUpdate: units.update,
        inventoryUnitOfMeasureDelete: units.delete,
        inventoryReasonCodeList: reasons.list,
        inventoryReasonCodeCreate: reasons.create,
        inventoryReasonCodeUpdate: reasons.update,
        inventoryReasonCodeDelete: reasons.delete,
        inventoryFundingSourceList: funding.list,
        inventoryFundingSourceCreate: funding.create,
        inventoryFundingSourceUpdate: funding.update,
        inventoryFundingSourceDelete: funding.delete,
        inventoryProcurementProgramList: programs.list,
        inventoryProcurementProgramCreate: programs.create,
        inventoryProcurementProgramUpdate: programs.update,
        inventoryProcurementProgramDelete: programs.delete,
    };
}
