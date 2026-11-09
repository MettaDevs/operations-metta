import { Avatar, AvatarFallback } from '@operations-metta/ui/avatar';
import { Button } from '@operations-metta/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@operations-metta/ui/dropdown-menu';
import { Kbd } from '@operations-metta/ui/kbd';
import { SidebarTrigger } from '@operations-metta/ui/sidebar';
import { cn } from '@operations-metta/ui/utils';
import { Link } from '@tanstack/react-router';
import { Command, House, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ShellData } from './api.ts';
import { AppCommandPalette } from './app-command-palette.tsx';
import { useAppearance } from './use-appearance.ts';
import { initials, UserMenuContent } from './user-menu.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

// Header Shell, dipindah dari app-sidebar-header CoreERP. Yang belum dipindah karena fiturnya belum ada di server:
// tanggal kerja, ekspor, notifikasi, dan dialog cetak. Tautan beranda memakai ikon umum, bukan logo merek.
export function AppSidebarHeader({
    shell,
    isScrolled = false,
}: {
    shell: ShellData;
    isScrolled?: boolean;
}) {
    const [commandOpen, setCommandOpen] = useState(false);
    const { resolvedAppearance, updateAppearance } = useAppearance();
    const { auth, workspace, navigation } = shell;

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                setCommandOpen((open) => !open);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <header
            className={cn(
                'sticky top-0 z-20 min-h-12 shrink-0 border-b bg-background transition-[border-radius,box-shadow] duration-200',
                isScrolled ? 'rounded-none shadow-sm' : 'rounded-t-2xl',
            )}
        >
            <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="lg:hidden"
                    aria-label="Cari halaman"
                    onClick={() => setCommandOpen(true)}
                >
                    <Search />
                </Button>
                <Button variant="ghost" size="icon" asChild>
                    <Link to="/dashboard" aria-label="Beranda" title="Beranda">
                        <House />
                    </Link>
                </Button>
                <div className="hidden h-6 w-px bg-border lg:block" />
                <Button
                    variant="outline"
                    size="sm"
                    aria-label="Cari halaman"
                    aria-keyshortcuts="Control+K Meta+K"
                    className="hidden max-w-sm min-w-32 flex-1 justify-start font-normal text-muted-foreground lg:flex"
                    onClick={() => setCommandOpen(true)}
                >
                    <Search data-icon="inline-start" />
                    <span>Cari halaman…</span>
                    <span className="ml-auto hidden sm:block">
                        <Kbd>
                            <Command />K
                        </Kbd>
                    </span>
                </Button>

                <div className="ml-auto flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                            resolvedAppearance === 'dark'
                                ? 'Gunakan tema terang'
                                : 'Gunakan tema gelap'
                        }
                        title={
                            resolvedAppearance === 'dark'
                                ? 'Gunakan tema terang'
                                : 'Gunakan tema gelap'
                        }
                        onClick={() =>
                            updateAppearance(
                                resolvedAppearance === 'dark'
                                    ? 'light'
                                    : 'dark',
                            )
                        }
                    >
                        {resolvedAppearance === 'dark' ? <Sun /> : <Moon />}
                    </Button>
                    {auth.membership && (
                        <WorkspaceSwitcher
                            membership={auth.membership}
                            workspace={workspace}
                        />
                    )}
                    <div className="mx-2 hidden h-6 w-px bg-border sm:block" />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-full"
                                aria-label="Buka menu profil"
                                data-test="header-profile-menu"
                            >
                                <Avatar>
                                    <AvatarFallback>
                                        {initials(auth.user.name)}
                                    </AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="min-w-56 rounded-lg"
                            align="end"
                        >
                            <UserMenuContent user={auth.user} />
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            <AppCommandPalette
                navigation={navigation}
                open={commandOpen}
                onOpenChange={setCommandOpen}
            />
        </header>
    );
}
