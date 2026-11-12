import { masterRoutes } from '../inventory.routes.ts';
import { itemCategoryInputSchema } from './item-category.schema.ts';
import { ItemCategories } from './item-category.service.ts';

export function itemCategoryRoutes() {
    const routes = masterRoutes(
        '/api/v1/inventory/item-categories',
        itemCategoryInputSchema,
        (db, workspace) => new ItemCategories(db, workspace),
    );
    return {
        inventoryItemCategoryList: routes.list,
        inventoryItemCategoryCreate: routes.create,
        inventoryItemCategoryUpdate: routes.update,
        inventoryItemCategoryDelete: routes.delete,
    };
}
