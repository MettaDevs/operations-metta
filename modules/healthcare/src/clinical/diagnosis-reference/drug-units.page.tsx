import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Satuan obat yang dipilih di master Obat dan tampil di baris resep. Bawaannya mSatuan sistem lama.

const route = getRouteApi('/_app/healthcare/clinical/drug-units');

function DrugUnitsPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="drug-units"
            title="Satuan obat"
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
    path: '/healthcare/clinical/drug-units',
    layout: 'app',
    title: 'Satuan obat',
    validateSearch: referenceSearchSchema,
    component: DrugUnitsPage,
});
