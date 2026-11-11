import { Button } from '@operations-metta/ui/button';
import { Sidebar, useSidebar } from '@operations-metta/ui/sidebar';
import { cn } from '@operations-metta/ui/utils';
import { useLocation } from '@tanstack/react-router';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ShellData } from './api.ts';
import { areaOf } from './home.ts';
import { navigationIcon } from './navigation-icons.ts';
import { ProductLauncher } from './product-launcher.tsx';
import { ShellLink } from './shell-link.tsx';

type NavigationGroup = ShellData['navigation'][number]['groups'][number];
type NavigationItem = NavigationGroup['items'][number];

// Rail kiri dan submenu, dipindah dari app-sidebar CoreERP. Paling atas katalog aplikasi; di bawahnya grup menu
// aplikasi yang sedang dibuka, satu grup per folder fitur; submenu berisi halaman grup itu. Semuanya datang dari
// `/api/v1/shell`, sudah disaring izin anggota ini.
export function AppSidebar({
    navigation,
    uninstalledApps,
    style,
}: {
    navigation: ShellData['navigation'];
    uninstalledApps: ShellData['uninstalled_apps'];
    // Lebar rail dan submenu. Di layar sempit Sidebar dirender sebagai Sheet di luar SidebarProvider, jadi variabel
    // lebarnya harus ikut sampai ke sana; tanpa itu rail melebar mengikuti labelnya dan submenu terpotong.
    style: CSSProperties;
}) {
    const { open, setOpen, isMobile, setOpenMobile } = useSidebar();
    const location = useLocation();
    const url = location.href;
    const path = location.pathname;
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [pinnedId, setPinnedId] = useState<string | null>(null);
    const [previousUrl, setPreviousUrl] = useState(url);

    if (previousUrl !== url) {
        setPreviousUrl(url);
        setPreviewId(null);
        setPinnedId(null);
    }

    const activeProduct = areaOf(navigation, path) ?? navigation[0];
    const groups = activeProduct?.groups ?? [];
    const selectedGroup =
        groups.find((group) =>
            group.items.some((item) => path === item.href.split('?')[0]),
        ) ?? groups[0];
    const isItemActive = (item: NavigationItem) =>
        url === item.href || (!item.href.includes('?') && path === item.href);
    const displayedGroup =
        groups.find((group) => group.id === previewId) ??
        (open ? groups.find((group) => group.id === pinnedId) : undefined) ??
        selectedGroup;
    const showItems = isMobile || open || previewId !== null;
    const closeMobile = () => {
        if (isMobile) setOpenMobile(false);
    };

    return (
        <Sidebar
            style={style}
            collapsible="icon"
            className="z-30 border-r border-sidebar-border bg-sidebar"
            onMouseLeave={() => setPreviewId(null)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                    setPreviewId(null);
            }}
            onKeyDown={(event) => {
                if (
                    event.key === 'Escape' &&
                    event.target instanceof Node &&
                    event.currentTarget.contains(event.target)
                ) {
                    setPreviewId(null);
                    if (isMobile) setOpenMobile(false);
                    else setOpen(false);
                }
            }}
        >
            <div className="relative flex h-full w-full">
                <aside className="flex h-full w-(--sidebar-width-icon) shrink-0 flex-col items-center border-r border-sidebar-border">
                    <div className="flex h-12 w-full shrink-0 items-center justify-center border-b border-sidebar-border">
                        <ProductLauncher
                            navigation={navigation}
                            uninstalledApps={uninstalledApps}
                            activeId={activeProduct?.id}
                            onLaunch={closeMobile}
                        />
                    </div>
                    <nav
                        aria-label={
                            activeProduct
                                ? `Menu ${activeProduct.label}`
                                : 'Menu utama'
                        }
                        className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-2 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-sidebar-foreground/40 [&::-webkit-scrollbar-thumb]:bg-clip-content"
                    >
                        {groups.map((group) => {
                            const Icon = navigationIcon(group.icon);
                            const selected = selectedGroup?.id === group.id;
                            const previewed =
                                previewId === group.id && !selected;
                            return (
                                <ShellLink
                                    key={group.id}
                                    href={group.items[0]?.href ?? '/'}
                                    onMouseEnter={() => setPreviewId(group.id)}
                                    onFocus={() => setPreviewId(group.id)}
                                    onClick={closeMobile}
                                    aria-current={selected ? 'page' : undefined}
                                    className={cn(
                                        'flex min-h-11 min-w-0 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1 text-center text-[10px] font-normal text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&_svg]:size-4',
                                        selected && 'text-sidebar-foreground',
                                        previewed &&
                                            'bg-sidebar-accent text-sidebar-accent-foreground',
                                    )}
                                >
                                    <Icon
                                        className={cn(
                                            'box-content rounded-md border border-transparent p-1',
                                            selected &&
                                                'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground',
                                            previewed &&
                                                'border-sidebar-accent-foreground/30',
                                        )}
                                    />
                                    <span className="w-full min-w-0 leading-tight break-words whitespace-normal">
                                        {group.label}
                                    </span>
                                </ShellLink>
                            );
                        })}
                    </nav>
                </aside>

                {displayedGroup && showItems && (
                    <nav
                        className={cn(
                            'flex min-h-0 w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))] shrink-0 flex-col bg-sidebar',
                            !isMobile &&
                                !open &&
                                'absolute inset-y-0 left-(--sidebar-width-icon) border-r border-sidebar-border shadow-lg',
                        )}
                        aria-label={`Menu ${displayedGroup.label}`}
                    >
                        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2">
                            <h2 className="min-w-0 text-[13px] font-semibold break-words">
                                {displayedGroup.label}
                            </h2>
                            <Button
                                variant={isMobile || open ? 'ghost' : 'default'}
                                size="icon-xs"
                                aria-label={
                                    isMobile
                                        ? 'Tutup menu'
                                        : open
                                          ? 'Ciutkan menu'
                                          : 'Sematkan menu'
                                }
                                aria-expanded={isMobile || open}
                                onClick={() => {
                                    setPreviewId(
                                        open ? displayedGroup.id : null,
                                    );
                                    if (isMobile) {
                                        setOpenMobile(false);
                                    } else {
                                        if (!open)
                                            setPinnedId(displayedGroup.id);
                                        setOpen(!open);
                                    }
                                }}
                            >
                                {isMobile || open ? (
                                    <ChevronsLeft />
                                ) : (
                                    <ChevronsRight />
                                )}
                            </Button>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
                            {displayedGroup.items.map((item) => (
                                <ShellLink
                                    key={item.id}
                                    href={item.href}
                                    onClick={() => {
                                        // Desktop mempertahankan menu hover selama URL tujuan belum terpasang.
                                        if (isMobile) {
                                            setPreviewId(null);
                                            setOpenMobile(false);
                                        }
                                    }}
                                    aria-current={
                                        isItemActive(item) ? 'page' : undefined
                                    }
                                    className={cn(
                                        'flex min-h-8 shrink-0 items-center gap-2 rounded-md px-2 py-1 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring',
                                        isItemActive(item) &&
                                            'bg-sidebar-primary/15 text-sidebar-primary ring-1 ring-sidebar-primary/30 ring-inset hover:bg-sidebar-primary/20 hover:text-sidebar-primary',
                                    )}
                                >
                                    <span className="min-w-0 break-words whitespace-normal">
                                        {item.label}
                                    </span>
                                </ShellLink>
                            ))}
                        </div>
                    </nav>
                )}
            </div>
        </Sidebar>
    );
}
