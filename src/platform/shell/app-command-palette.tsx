import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@operations-metta/ui/command';
import { useNavigate } from '@tanstack/react-router';
import type { ShellData } from './api.ts';
import { navigationIcon } from './navigation-icons.ts';

// Pencarian halaman (Ctrl+K), dipindah dari app-command-palette CoreERP. Isinya menu yang sama dengan rail, jadi
// halaman yang tidak boleh dibuka anggota ini juga tidak muncul di sini.
export function AppCommandPalette({
    navigation,
    open,
    onOpenChange,
}: {
    navigation: ShellData['navigation'];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const navigate = useNavigate();
    const seen = new Set<string>();
    const items = navigation
        .flatMap((group) =>
            group.items.map((item) => ({
                ...item,
                section: group.label,
                icon: navigationIcon(group.id),
            })),
        )
        .filter((item) => {
            if (seen.has(item.href)) return false;
            seen.add(item.href);
            return true;
        });

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Cari halaman"
            description="Temukan halaman yang dapat Anda buka."
            showCloseButton={false}
        >
            <CommandInput
                aria-label="Cari halaman"
                placeholder="Cari halaman…"
            />
            <CommandList>
                <CommandEmpty>Tidak ada halaman yang cocok.</CommandEmpty>
                {items.length > 0 && (
                    <CommandGroup heading="Halaman umum">
                        {items.map((item) => (
                            <CommandItem
                                key={item.href}
                                value={item.href}
                                keywords={[item.label, item.section]}
                                onSelect={() => {
                                    onOpenChange(false);
                                    void navigate({ href: item.href });
                                }}
                            >
                                <item.icon />
                                <span className="min-w-0 flex-1 truncate">
                                    {item.label}
                                </span>
                                <span className="max-w-40 truncate text-xs text-muted-foreground">
                                    {item.section}
                                </span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                )}
            </CommandList>
        </CommandDialog>
    );
}
