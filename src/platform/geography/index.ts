import { addressSetupRoutes } from './address-setup.routes.ts';
import { groupOfHousesRoutes } from './group-of-houses.routes.ts';

export {
    resolvePostalRegions,
    type PostalRegionIds,
} from './postal-region.service.ts';

// Master wilayah: negara, wilayah administratif Indonesia beserta kode posnya (dipakai bersama semua tenant), dan
// dusun/banjar milik tenant. Route pengguna tenant di bawah `/api/v1/settings/address-setup`.
export function geographyRoutes() {
    return { ...addressSetupRoutes(), ...groupOfHousesRoutes() };
}
