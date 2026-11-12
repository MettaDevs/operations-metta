import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Bentuk sediaan yang dipilih di master Obat. Dimulai kosong; sistem lama tidak punya daftarnya.

const route = getRouteApi('/_app/healthcare/clinical/dosage-forms');

function DosageFormsPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="dosage-forms"
            title="Bentuk sediaan"
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
    path: '/healthcare/clinical/dosage-forms',
    layout: 'app',
    title: 'Bentuk sediaan',
    validateSearch: referenceSearchSchema,
    component: DosageFormsPage,
});
