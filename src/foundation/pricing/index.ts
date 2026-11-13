import { chargeComponentRoutes } from './charge-component/charge-component.routes.ts';
import { priceGroupRoutes } from './price-group/price-group.routes.ts';

// Setelan harga Core yang dipakai bersama module: kelompok harga (Customer Price Group di BC) dan komponen biaya
// (SIMmKomponenBiaya sistem lama). Tarif tindakan dan harga obat tinggal di module pemilik produknya dan hanya merujuk
// master ini.
export function pricingRoutes() {
    return { ...priceGroupRoutes(), ...chargeComponentRoutes() };
}
