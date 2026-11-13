import { clerkRoutes } from './clerk/clerk.routes.ts';
import { merchantRoutes } from './merchant/merchant.routes.ts';
import { paymentMethodRoutes } from './payment-method/payment-method.routes.ts';

// Kasir Core: jenis bayar (mJenisBayar sistem lama) dengan perilaku dari katalog di kode, merchan (SIMmMerchan), dan
// clerk (SIMtrClerk), sesi kas kasir dari Clerk Start sampai Clerk End. Layarnya membentuk aplikasi Kasir di katalog
// aplikasi, terpisah dari Sys Admin (src/platform/access/navigation.ts). Pembayaran memanggil openClerk sebelum
// menyimpan, sehingga kasir yang belum Clerk Start ditolak dengan pesan sistem lama.
export { clerkNotStartedMessage, openClerk } from './clerk/clerk.service.ts';

export function billingRoutes() {
    return { ...paymentMethodRoutes(), ...merchantRoutes(), ...clerkRoutes() };
}
