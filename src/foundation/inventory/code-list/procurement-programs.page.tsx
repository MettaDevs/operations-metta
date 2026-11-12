import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import { CodeListScreen, type CodeListSource } from './code-list-screen.tsx';

// Program pengadaan (mProgramPengadaan sistem lama), misalnya program malaria atau imunisasi: dicatat per baris
// penerimaan dan melekat pada stok yang masuk.

const route = getRouteApi('/_app/sysadmin/inventory/procurement-programs');

const procurementPrograms: CodeListSource = {
    title: 'Program pengadaan',
    label: 'program pengadaan',
    list: async (query, signal) =>
        (await api.inventoryProcurementProgramList({ query }, { signal })).body,
    create: async (body) =>
        (await api.inventoryProcurementProgramCreate({ body })).body.data,
    update: async (id, body) =>
        (await api.inventoryProcurementProgramUpdate({ params: { id }, body }))
            .body.data,
    remove: (id, version) =>
        api.inventoryProcurementProgramDelete({
            params: { id },
            body: { version },
        }),
};

function ProcurementProgramsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <CodeListScreen
            source={procurementPrograms}
            query={search.q ?? ''}
            onQueryChange={(q) =>
                void navigate({ search: q ? { q } : {}, replace: true })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/procurement-programs',
    layout: 'app',
    title: 'Program pengadaan',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: ProcurementProgramsPage,
});
