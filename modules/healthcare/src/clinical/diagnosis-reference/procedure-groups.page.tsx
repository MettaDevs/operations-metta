import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Kelompok tindakan yang dipilih di master Tindakan. Dimulai kosong; SIMmGroupJasa sistem lama berisi data klinik itu sendiri.

const route = getRouteApi('/_app/healthcare/clinical/procedure-groups');

function ProcedureGroupsPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="procedure-groups"
            title="Kelompok tindakan"
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
    path: '/healthcare/clinical/procedure-groups',
    layout: 'app',
    title: 'Kelompok tindakan',
    validateSearch: referenceSearchSchema,
    component: ProcedureGroupsPage,
});
