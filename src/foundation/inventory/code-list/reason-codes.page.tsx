import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api, definePage } from '../../../platform/shell/index.ts';
import { reasonCodes } from './code-list-card.tsx';
import { CodeListPage, codeListSearchSchema } from './code-list-page.tsx';

// Alasan dokumen penyesuaian stok (Reason Codes di BC), misalnya saldo awal, pemakaian unit, atau pemusnahan. Empat
// alasan bawaan lahir bersama legal entity; setelah itu daftarnya milik klinik sepenuhnya.

const route = getRouteApi('/_app/sysadmin/inventory/reason-codes');

function ReasonCodesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <CodeListPage
            kind={reasonCodes}
            load={async (query, signal) =>
                (await api.inventoryReasonCodeList({ query }, { signal })).body
            }
            search={route.useSearch()}
            onSearchChange={(next) =>
                void navigate({
                    search: (current) => ({ ...current, ...next }),
                    replace: true,
                })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/reason-codes',
    layout: 'app',
    title: 'Alasan penyesuaian',
    validateSearch: codeListSearchSchema,
    component: ReasonCodesPage,
});
