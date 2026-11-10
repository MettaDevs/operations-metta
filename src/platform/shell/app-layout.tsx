import { SidebarInset, SidebarProvider } from '@operations-metta/ui/sidebar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { Fragment, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { shellQuery } from './api.ts';
import { AppSidebar } from './app-sidebar.tsx';
import { AppSidebarHeader } from './app-sidebar-header.tsx';
import { EnvironmentBanner } from './environment-banner.tsx';
import { useDocumentTitle } from './use-document-title.ts';

const sidebarStyle: CSSProperties & Record<`--${string}`, string> = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '5.5rem',
};

function sidebarOpen(): boolean {
    // Cookie yang ditulis SidebarProvider @operations-metta/ui; bawaannya terbuka.
    return !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);
}

/**
 * Bingkai halaman setelah login, dipindah dari app-layout dan app-sidebar-layout CoreERP: rail dan submenu di kiri,
 * header, spanduk lingkungan, lalu isi halaman. Halaman hanya merender isinya sendiri. Datanya dari `/api/v1/shell`,
 * yang sudah dimuat route sebelum bingkai ini dirender.
 */
export function AppLayout(): ReactNode {
    const { data: shell } = useSuspenseQuery(shellQuery);
    const [isScrolled, setIsScrolled] = useState(false);
    const [defaultOpen] = useState(sidebarOpen);
    useDocumentTitle(shell.auth.membership?.tenant_name ?? null);
    // Data dan draft konteks lama tidak boleh tertinggal ketika workspace berganti.
    const scope = JSON.stringify([
        shell.auth.user.id,
        shell.auth.membership?.id,
        shell.workspace.active_legal_entity?.id,
        shell.workspace.active_org_unit?.id,
    ]);

    return (
        <SidebarProvider
            defaultOpen={defaultOpen}
            className="h-svh min-h-0 min-w-[320px] overflow-hidden"
            style={sidebarStyle}
        >
            <AppSidebar navigation={shell.navigation} />
            <SidebarInset className="h-svh min-w-0 overflow-hidden bg-muted/30 py-2 pr-2 pl-0">
                <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
                    <AppSidebarHeader shell={shell} isScrolled={isScrolled} />
                    {/* Di bawah header, di atas isi halaman, dan tidak dapat ditutup. */}
                    <EnvironmentBanner environment={shell.environment} />
                    <div
                        data-shell-content=""
                        className="@container/shell-content relative isolate min-h-0 min-w-0 flex-1 overflow-hidden"
                    >
                        <div
                            data-shell-page-content=""
                            scroll-region=""
                            className="relative isolate z-0 h-full min-h-0 min-w-0 overflow-auto bg-muted/30 has-[[data-layout=full-height]]:overflow-hidden"
                            onScroll={(event) =>
                                setIsScrolled(event.currentTarget.scrollTop > 8)
                            }
                        >
                            <Fragment key={scope}>
                                <Outlet />
                            </Fragment>
                        </div>
                        <div
                            data-shell-overlay-host=""
                            className="pointer-events-none absolute inset-0 z-10"
                        />
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
