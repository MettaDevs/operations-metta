import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Kategori operasi (SIMmKategoriOperasi) yang kelak membedakan tarif tindakan. Sistem lama tidak punya layarnya. Dimulai
// kosong; kategori 'ALL' sistem lama tidak dibuat, karena tarif tanpa kategori operasi berlaku untuk semua kategori.

const route = getRouteApi('/_app/healthcare/clinical/operation-categories');

function OperationCategoriesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="operation-categories"
            title="Kategori operasi"
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
    path: '/healthcare/clinical/operation-categories',
    layout: 'app',
    title: 'Kategori operasi',
    validateSearch: referenceSearchSchema,
    component: OperationCategoriesPage,
});
