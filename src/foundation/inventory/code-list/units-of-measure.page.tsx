import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api, definePage } from '../../../platform/shell/index.ts';
import { unitsOfMeasure } from './code-list-card.tsx';
import { CodeListPage, codeListSearchSchema } from './code-list-page.tsx';

// Satuan dasar barang (Units of Measure di BC), misalnya TAB atau BOX. Stok selalu dicatat dalam satuan dasar.

const route = getRouteApi('/_app/sysadmin/inventory/units-of-measure');

function UnitsOfMeasurePage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <CodeListPage
            kind={unitsOfMeasure}
            load={async (query, signal) =>
                (await api.inventoryUnitOfMeasureList({ query }, { signal }))
                    .body
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
    path: '/sysadmin/inventory/units-of-measure',
    layout: 'app',
    title: 'Satuan',
    validateSearch: codeListSearchSchema,
    component: UnitsOfMeasurePage,
});
