import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage } from '../../../platform/shell/index.ts';
import { CodeListScreen } from './code-list-screen.tsx';
import { reasonCodes } from './code-list-sources.ts';

// Alasan dokumen penyesuaian stok (Reason Codes di BC), misalnya saldo awal, pemakaian unit, atau pemusnahan. Empat
// alasan bawaan lahir bersama legal entity; setelah itu daftarnya milik klinik sepenuhnya.

const route = getRouteApi('/_app/sysadmin/inventory/reason-codes');

function ReasonCodesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <CodeListScreen
            source={reasonCodes}
            query={search.q ?? ''}
            onQueryChange={(q) =>
                void navigate({ search: q ? { q } : {}, replace: true })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/reason-codes',
    layout: 'app',
    title: 'Alasan penyesuaian',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: ReasonCodesPage,
});
