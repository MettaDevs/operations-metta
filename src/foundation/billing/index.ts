import { merchantRoutes } from './merchant/merchant.routes.ts';
import { paymentMethodRoutes } from './payment-method/payment-method.routes.ts';

// Kasir Core: jenis bayar (mJenisBayar sistem lama) dengan perilaku dari katalog di kode, dan merchan (SIMmMerchan).
// Layarnya membentuk aplikasi Kasir di katalog aplikasi, terpisah dari Sys Admin (src/platform/access/navigation.ts).
export function billingRoutes() {
    return { ...paymentMethodRoutes(), ...merchantRoutes() };
}
