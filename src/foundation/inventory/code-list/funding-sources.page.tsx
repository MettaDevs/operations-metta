import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import { CodeListScreen, type CodeListSource } from './code-list-screen.tsx';

// Sumber dana (mSumberDana sistem lama), misalnya APBD atau BLUD: dicatat per baris penerimaan dan melekat pada stok
// yang masuk.

const route = getRouteApi('/_app/sysadmin/inventory/funding-sources');

const fundingSources: CodeListSource = {
    title: 'Sumber dana',
    label: 'sumber dana',
    list: async (query, signal) =>
        (await api.inventoryFundingSourceList({ query }, { signal })).body,
    create: async (body) =>
        (await api.inventoryFundingSourceCreate({ body })).body.data,
    update: async (id, body) =>
        (await api.inventoryFundingSourceUpdate({ params: { id }, body })).body
            .data,
    remove: (id, version) =>
        api.inventoryFundingSourceDelete({
            params: { id },
            body: { version },
        }),
};

function FundingSourcesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <CodeListScreen
            source={fundingSources}
            query={search.q ?? ''}
            onQueryChange={(q) =>
                void navigate({ search: q ? { q } : {}, replace: true })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/funding-sources',
    layout: 'app',
    title: 'Sumber dana',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: FundingSourcesPage,
});
