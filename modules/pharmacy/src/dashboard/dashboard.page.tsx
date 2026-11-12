import { AreaDashboard, definePage } from '@core/platform/shell/index.ts';
import type { ReactNode } from 'react';

// Dashboard area farmasi, halaman pertama di sidebar-nya. Isinya belum diputuskan pemilik produk.
function PharmacyDashboardPage(): ReactNode {
    return <AreaDashboard />;
}

export const page = definePage({
    path: '/pharmacy/dashboard',
    layout: 'app',
    title: 'Dashboard',
    component: PharmacyDashboardPage,
});
