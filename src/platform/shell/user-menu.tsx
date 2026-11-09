import { Avatar, AvatarFallback } from '@operations-metta/ui/avatar';
import {
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@operations-metta/ui/dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText } from './api.ts';
import type { ShellData } from './api.ts';

type User = ShellData['auth']['user'];

export function initials(fullName: string): string {
    const names = fullName.trim().split(/\s+/u).filter(Boolean);
    const first = names[0];
    const last = names.at(-1);
    if (!first || !last) return '';
    const initial = (name: string) => Array.from(name)[0] ?? '';
    return (
        names.length === 1 ? initial(first) : initial(first) + initial(last)
    ).toUpperCase();
}

export function UserInfo({ user }: { user: User }) {
    return (
        <>
            <Avatar className="h-8 w-8 overflow-hidden rounded-full">
                <AvatarFallback className="rounded-lg bg-neutral-200 text-black dark:bg-neutral-700 dark:text-white">
                    {initials(user.name)}
                </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                </span>
            </div>
        </>
    );
}

// Isi menu profil di header. Halaman profil CoreERP belum dipindah, jadi tautannya belum ada.
export function UserMenuContent({ user }: { user: User }) {
    const queryClient = useQueryClient();

    const logout = async () => {
        try {
            await api.logout({ body: {} });
        } catch (caught) {
            toast.error(errorText(caught, 'Belum berhasil keluar.'));
            return;
        }
        queryClient.clear();
        // Muat ulang penuh supaya tidak ada data sesi sebelumnya yang tertinggal di layar.
        window.location.assign('/login');
    };

    return (
        <>
            <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <UserInfo user={user} />
                </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => void logout()}
                data-test="logout-button"
            >
                <LogOut className="mr-2" />
                Keluar
            </DropdownMenuItem>
        </>
    );
}
