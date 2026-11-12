import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage } from '../../../platform/shell/index.ts';
import { PostedTransferList } from './posted-transfer-list.tsx';

// Mutasi terposting (Posted Transfer Shipments di BC): satu dokumen per posting kirim amprah.

const route = getRouteApi('/_app/sysadmin/inventory/transfer-shipments');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function TransferShipmentsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <PostedTransferList
            kind="shipment"
            query={search.q ?? ''}
            onQueryChange={(q) =>
                void navigate({ search: q ? { q } : {}, replace: true })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/transfer-shipments',
    layout: 'app',
    title: 'Mutasi',
    validateSearch: searchSchema,
    component: TransferShipmentsPage,
});
