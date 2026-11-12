import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Jenis diagnosa yang dipilih di baris diagnosa pemeriksaan. Bawaannya Primer, Sekunder, dan Komplikasi dari sistem lama.

const route = getRouteApi('/_app/healthcare/clinical/diagnosis-types');

function DiagnosisTypesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="diagnosis-types"
            title="Jenis diagnosa"
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
    path: '/healthcare/clinical/diagnosis-types',
    layout: 'app',
    title: 'Jenis diagnosa',
    validateSearch: referenceSearchSchema,
    component: DiagnosisTypesPage,
});
