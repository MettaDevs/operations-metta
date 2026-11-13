import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Pilihan Keadaan pulang panel Status Pasien. Bawaannya pilihan Keadaan Pulang form KIA sistem lama yang belum dicatat
// status pasien.

const route = getRouteApi('/_app/healthcare/clinical/discharge-conditions');

function DischargeConditionsPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="discharge-conditions"
            title="Keadaan pulang"
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
    path: '/healthcare/clinical/discharge-conditions',
    layout: 'app',
    title: 'Keadaan pulang',
    validateSearch: referenceSearchSchema,
    component: DischargeConditionsPage,
});
