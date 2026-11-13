import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Kategori plafon (SIMmKategoriPlafon) yang dipilih di kartu Jasa. Sistem lama tidak punya layarnya. Dimulai kosong.

const route = getRouteApi('/_app/healthcare/clinical/benefit-limit-categories');

function BenefitLimitCategoriesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="benefit-limit-categories"
            title="Kategori plafon"
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
    path: '/healthcare/clinical/benefit-limit-categories',
    layout: 'app',
    title: 'Kategori plafon',
    validateSearch: referenceSearchSchema,
    component: BenefitLimitCategoriesPage,
});
