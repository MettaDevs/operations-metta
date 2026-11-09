import { PlaceholderPattern } from '@operations-metta/ui/placeholder-pattern';
import type { ReactNode } from 'react';
import { definePage } from './page.ts';

// Beranda setelah login, sama dengan dashboard CoreERP: bingkai kosong sampai ada isi yang dipindah.
function DashboardPage(): ReactNode {
    return (
        <div className="flex h-full flex-1 flex-col gap-4 overflow-x-auto rounded-xl p-4">
            <div className="grid auto-rows-min gap-4 md:grid-cols-3">
                {[0, 1, 2].map((tile) => (
                    <div
                        key={tile}
                        className="relative aspect-video overflow-hidden rounded-xl border border-sidebar-border/70 dark:border-sidebar-border"
                    >
                        <PlaceholderPattern className="absolute inset-0 size-full stroke-neutral-900/20 dark:stroke-neutral-100/20" />
                    </div>
                ))}
            </div>
            <div className="relative min-h-[100vh] flex-1 overflow-hidden rounded-xl border border-sidebar-border/70 md:min-h-min dark:border-sidebar-border">
                <PlaceholderPattern className="absolute inset-0 size-full stroke-neutral-900/20 dark:stroke-neutral-100/20" />
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/dashboard',
    layout: 'app',
    title: 'Dashboard',
    component: DashboardPage,
});
