import { SidebarInset, SidebarProvider } from '@operations-metta/ui/sidebar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Outlet, useLocation } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { shellQuery } from './api.ts';
import { AppSidebar } from './app-sidebar.tsx';
import { AppSidebarHeader } from './app-sidebar-header.tsx';
import { areaOf, rememberArea } from './home.ts';
import { useDocumentTitle } from './use-document-title.ts';
import { RecordDialogs } from './record-dialogs.tsx';

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
 * header (dengan label lingkungan di sebelah pencarian), lalu isi halaman. Halaman hanya merender isinya sendiri. Datanya dari `/api/v1/shell`,
 * yang sudah dimuat route sebelum bingkai ini dirender.
 */
export function AppLayout(): ReactNode {
    const { data: shell } = useSuspenseQuery(shellQuery);
    const [isScrolled, setIsScrolled] = useState(false);
    const [defaultOpen] = useState(sidebarOpen);
    useDocumentTitle(shell.auth.membership?.tenant_name ?? null);
    const pathname = useLocation({ select: (location) => location.pathname });
    const areaId = areaOf(shell.navigation, pathname)?.id;
    const userId = shell.auth.user.id;
    // Area yang sedang dibuka menjadi halaman awal berikutnya (home.ts).
    useEffect(() => {
        if (areaId) rememberArea(userId, areaId);
    }, [userId, areaId]);
    // Setelan pribadi menjadi atribut data-<kunci> pada <html>, dan CSS pemakainya membaca atribut itu.
    const preferences = shell.auth.user.preferences;
    useEffect(() => {
        const root = document.documentElement;
        const entries = Object.entries(preferences);
        const attribute = (key: string) => `data-${key.replaceAll('_', '-')}`;
        for (const [key, value] of entries)
            root.setAttribute(attribute(key), value);
        return () => {
            for (const [key] of entries) root.removeAttribute(attribute(key));
        };
    }, [preferences]);
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
            <AppSidebar
                navigation={shell.navigation}
                uninstalledApps={shell.uninstalled_apps}
                style={sidebarStyle}
            />
            <SidebarInset className="h-svh min-w-0 overflow-hidden bg-muted/30 p-2">
                <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
                    <AppSidebarHeader shell={shell} isScrolled={isScrolled} />
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
                                <RecordDialogs>
                                    <Outlet />
                                </RecordDialogs>
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
