import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Kasus diagnosa yang dipilih di baris diagnosa pemeriksaan. Bawaannya Baru dan Lama dari sistem lama.

const route = getRouteApi('/_app/healthcare/clinical/diagnosis-cases');

function DiagnosisCasesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="diagnosis-cases"
            title="Kasus diagnosa"
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
    path: '/healthcare/clinical/diagnosis-cases',
    layout: 'app',
    title: 'Kasus diagnosa',
    validateSearch: referenceSearchSchema,
    component: DiagnosisCasesPage,
});
