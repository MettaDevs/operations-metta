import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Prognosa yang dipilih di panel Diagnosa pemeriksaan. Bawaannya lima prognosa sistem lama (mPrognosa).

const route = getRouteApi('/_app/healthcare/clinical/prognoses');

function PrognosesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="prognoses"
            title="Prognosa"
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
    path: '/healthcare/clinical/prognoses',
    layout: 'app',
    title: 'Prognosa',
    validateSearch: referenceSearchSchema,
    component: PrognosesPage,
});
