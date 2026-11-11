import type { ReactNode } from 'react';
import type { z } from 'zod';

declare module '@tanstack/react-router' {
    // Menambah field ke tipe milik pustaka hanya bisa lewat `interface`; `type` akan menimpanya.
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface StaticDataRouteOption {
        // Judul halaman di tab peramban.
        title?: string;
    }
}

/**
 * Satu layar. Berkasnya bernama `<fitur>.page.tsx` di folder fiturnya dan meng-export `page`:
 *
 * ```tsx
 * export const page = definePage({
 *     path: '/sysadmin/organization/legal-entities',
 *     previousPaths: ['/settings/legal-entities'],
 *     layout: 'app',
 *     title: 'Legal entity',
 *     validateSearch: z.object({ q: z.string().optional() }),
 *     component: LegalEntitiesPage,
 * });
 * ```
 *
 * `path` adalah URL layar dan ditulis sebagai teks literal, karena scripts/generate-client.ts membacanya tanpa
 * menjalankan halaman. Nama dan folder berkas tidak menentukan URL. `previousPaths` (opsional, juga teks literal) adalah
 * URL lama halaman itu: membukanya dialihkan ke `path` beserta search params-nya, supaya tautan dan bookmark lama tetap
 * jalan. `layout: 'app'` memasang halaman di dalam Shell dan
 * mewajibkan login; `'auth'` untuk halaman sebelum login. `validateSearch` (schema zod) memeriksa search params
 * halaman; di dalam komponen, `getRouteApi(path).useSearch()` memberi nilainya dengan tipe dari schema itu.
 */
export function definePage<
    // Tipe kembalian disimpulkan dari `page`, jadi path literal dan schema search sampai ke route tree lewat dua parameter ini.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    const TPath extends `/${string}`,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- alasan yang sama
    TSearch extends z.ZodType | undefined = undefined,
>(page: {
    path: TPath;
    previousPaths?: readonly `/${string}`[];
    layout: 'app' | 'auth';
    title: string;
    validateSearch?: TSearch;
    component: () => ReactNode;
}) {
    return page;
}
