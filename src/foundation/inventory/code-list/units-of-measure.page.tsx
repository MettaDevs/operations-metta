import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage } from '../../../platform/shell/index.ts';
import { CodeListScreen } from './code-list-screen.tsx';
import { unitsOfMeasure } from './code-list-sources.ts';

// Satuan dasar barang (Units of Measure di BC), misalnya TAB atau BOX. Stok selalu dicatat dalam satuan dasar.

const route = getRouteApi('/_app/sysadmin/inventory/units-of-measure');

function UnitsOfMeasurePage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <CodeListScreen
            source={unitsOfMeasure}
            query={search.q ?? ''}
            onQueryChange={(q) =>
                void navigate({ search: q ? { q } : {}, replace: true })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/units-of-measure',
    layout: 'app',
    title: 'Satuan',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: UnitsOfMeasurePage,
});
