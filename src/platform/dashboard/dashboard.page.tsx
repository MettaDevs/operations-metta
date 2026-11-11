import type { ReactNode } from 'react';
import { AreaDashboard, definePage } from '../shell/index.ts';

// Dashboard area Sys Admin. Isinya belum diputuskan pemilik produk; isi kelak ditulis di folder ini.
function SysAdminDashboardPage(): ReactNode {
    return <AreaDashboard />;
}

export const page = definePage({
    path: '/sysadmin/dashboard',
    layout: 'app',
    title: 'Dashboard',
    component: SysAdminDashboardPage,
});
