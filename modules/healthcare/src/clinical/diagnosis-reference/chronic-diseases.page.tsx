import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Penyakit kronis yang bisa ditandai di panel Diagnosa pemeriksaan. Bawaannya sebelas penyakit dari sistem lama.

const route = getRouteApi('/_app/healthcare/clinical/chronic-diseases');

function ChronicDiseasesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="chronic-diseases"
            title="Penyakit kronis"
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
    path: '/healthcare/clinical/chronic-diseases',
    layout: 'app',
    title: 'Penyakit kronis',
    validateSearch: referenceSearchSchema,
    component: ChronicDiseasesPage,
});
