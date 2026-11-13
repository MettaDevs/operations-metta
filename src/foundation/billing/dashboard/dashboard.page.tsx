import type { ReactNode } from 'react';
import { AreaDashboard, definePage } from '../../../platform/shell/index.ts';

// Dashboard aplikasi Kasir, halaman pertama di sidebar-nya. Isinya belum diputuskan pemilik produk.
function BillingDashboardPage(): ReactNode {
    return <AreaDashboard />;
}

export const page = definePage({
    path: '/billing/dashboard',
    layout: 'app',
    title: 'Dashboard',
    component: BillingDashboardPage,
});
