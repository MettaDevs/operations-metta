import { assetRoutes } from './fixed-asset/asset/asset.routes.ts';
import { assetReceiptRoutes } from './fixed-asset/asset-receipt/asset-receipt.routes.ts';

export function assetManagementRoutes() {
    return { ...assetReceiptRoutes(), ...assetRoutes() };
}
