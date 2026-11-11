import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { shellQuery } from './api.ts';
import { homePath, readLastArea } from './home.ts';
import { definePage } from './page.ts';

// Alamat awal setelah login. Tidak punya isi sendiri: pengguna langsung dibawa ke halaman awalnya (home.ts). Hanya
// pengguna yang belum boleh membuka halaman apa pun yang tinggal di sini.
function HomePage(): ReactNode {
    const { data: shell } = useSuspenseQuery(shellQuery);
    const navigate = useNavigate();
    const home = homePath(shell.navigation, readLastArea(shell.auth.user.id));
    useEffect(() => {
        if (home) void navigate({ href: home, replace: true });
    }, [home, navigate]);
    if (home) return null;
    return (
        <Empty>
            <EmptyHeader>
                <EmptyTitle>Belum ada halaman yang dapat Anda buka</EmptyTitle>
                <EmptyDescription>
                    Minta pengelola aplikasi di klinik Anda memberi akses ke
                    halaman yang Anda perlukan.
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

export const page = definePage({
    path: '/',
    previousPaths: ['/dashboard'],
    layout: 'app',
    title: 'Beranda',
    component: HomePage,
});
