import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Rute pemberian obat baris resep. Bawaannya rute WHO ATC/DDD yang dipakai SATUSEHAT.

const route = getRouteApi('/_app/healthcare/clinical/medication-routes');

function MedicationRoutesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="medication-routes"
            title="Rute pemberian obat"
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
    path: '/healthcare/clinical/medication-routes',
    layout: 'app',
    title: 'Rute pemberian obat',
    validateSearch: referenceSearchSchema,
    component: MedicationRoutesPage,
});
