import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { shellQuery } from './api.ts';
import { areaOf } from './home.ts';

/**
 * Kerangka dashboard sebuah area: halaman pertama di sidebar area itu dan halaman awal pengguna. Isinya belum
 * diputuskan pemilik produk, jadi yang tampil hanya nama area dan keadaan kosong, tanpa angka atau kartu. Setiap area
 * memasang halamannya sendiri di foldernya: Sys Admin di src/platform/dashboard/, module di src/dashboard/ module itu.
 */
export function AreaDashboard(): ReactNode {
    const { data: shell } = useSuspenseQuery(shellQuery);
    const pathname = useLocation({ select: (location) => location.pathname });
    const area = areaOf(shell.navigation, pathname);
    return (
        <div className="flex flex-col gap-4 p-4">
            <h1 className="text-sm font-semibold">
                {area ? `Dashboard ${area.label}` : 'Dashboard'}
            </h1>
            <Empty className="border">
                <EmptyHeader>
                    <EmptyTitle>Dashboard ini belum berisi</EmptyTitle>
                    <EmptyDescription>
                        Ringkasan untuk area ini belum disiapkan. Buka halaman
                        yang Anda perlukan dari menu di kiri.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        </div>
    );
}
