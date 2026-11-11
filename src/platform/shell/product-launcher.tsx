import { Button } from '@operations-metta/ui/button';
import { Input } from '@operations-metta/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@operations-metta/ui/popover';
import { matchesRecordSearch } from '@operations-metta/ui/record-search';
import { ScrollArea } from '@operations-metta/ui/scroll-area';
import { cn } from '@operations-metta/ui/utils';
import { Grid3X3 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ShellData } from './api.ts';
import { productIcon } from './navigation-icons.ts';
import { ShellLink } from './shell-link.tsx';

/**
 * Katalog aplikasi di paling atas rail, dipindah dari product-launcher CoreERP. Isinya aplikasi yang boleh dibuka
 * pengguna ini, sudah disaring server (`/api/v1/shell`): Sys Admin bila ia boleh membuka salah satu halaman Core, dan
 * setiap module yang dihak tenant, terpasang, dan boleh ia buka. Memilih aplikasi membuka dashboard-nya.
 *
 * Yang belum dipindah dari CoreERP: produk yang sudah dibeli tetapi belum terpasang tidak tampil sebagai tombol mati,
 * dan tidak ada produk yang dibuka di alamat lain; semua module berjalan di runtime ini.
 */
export function ProductLauncher({
    navigation,
    activeId,
    onLaunch,
}: {
    navigation: ShellData['navigation'];
    activeId: string | undefined;
    onLaunch: () => void;
}): ReactNode {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const products = navigation.filter((product) =>
        matchesRecordSearch(search, product.label),
    );

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) setSearch('');
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Katalog aplikasi"
                >
                    <Grid3X3 />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-[min(30rem,calc(100vw-1rem))] p-3"
            >
                <PopoverHeader className="p-2">
                    <PopoverTitle>Katalog aplikasi</PopoverTitle>
                    <PopoverDescription>
                        Buka aplikasi yang tersedia untuk akun Anda.
                    </PopoverDescription>
                </PopoverHeader>
                <Input
                    aria-label="Cari aplikasi"
                    placeholder="Cari aplikasi…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                <ScrollArea className="max-h-96">
                    <div className="grid grid-cols-2 items-stretch gap-2 py-3 sm:grid-cols-3">
                        {products.map((product) => {
                            const Icon = productIcon(product.id);
                            return (
                                <Button
                                    key={product.id}
                                    variant="ghost"
                                    className="h-auto min-w-0 flex-col justify-start gap-2 px-2 py-3 text-center font-normal whitespace-normal"
                                    asChild
                                >
                                    <ShellLink
                                        href={product.href}
                                        aria-current={
                                            product.id === activeId
                                                ? 'page'
                                                : undefined
                                        }
                                        onClick={() => {
                                            setOpen(false);
                                            onLaunch();
                                        }}
                                    >
                                        <span
                                            className={cn(
                                                'flex size-10 items-center justify-center rounded-lg bg-muted text-foreground',
                                                product.id === activeId &&
                                                    'bg-sidebar-primary text-sidebar-primary-foreground',
                                            )}
                                        >
                                            <Icon />
                                        </span>
                                        <span className="w-full text-sm leading-snug break-words">
                                            {product.label}
                                        </span>
                                    </ShellLink>
                                </Button>
                            );
                        })}
                    </div>
                    {products.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            Tidak ada aplikasi yang cocok.
                        </p>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
