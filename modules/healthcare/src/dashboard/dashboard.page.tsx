import { AreaDashboard, definePage } from '@core/platform/shell/index.ts';
import type { ReactNode } from 'react';

// Dashboard area module ini, halaman pertama di sidebar-nya. Isinya belum diputuskan pemilik produk; isi kelak ditulis
// di folder ini.
function HealthcareDashboardPage(): ReactNode {
    return <AreaDashboard />;
}

export const page = definePage({
    path: '/healthcare/dashboard',
    layout: 'app',
    title: 'Dashboard',
    component: HealthcareDashboardPage,
});
