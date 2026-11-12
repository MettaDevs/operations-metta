import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage } from '../../../platform/shell/index.ts';
import { PostedTransferList } from './posted-transfer-list.tsx';

// Penerimaan mutasi terposting (Posted Transfer Receipts di BC): satu dokumen per posting terima amprah.

const route = getRouteApi('/_app/sysadmin/inventory/transfer-receipts');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function TransferReceiptsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <PostedTransferList
            kind="receipt"
            query={search.q ?? ''}
            onQueryChange={(q) =>
                void navigate({ search: q ? { q } : {}, replace: true })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/transfer-receipts',
    layout: 'app',
    title: 'Penerimaan mutasi',
    validateSearch: searchSchema,
    component: TransferReceiptsPage,
});
