import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Pilihan Status Pasien halaman pemeriksaan. Bawaannya lima status sistem lama; Rawat Inap nonaktif karena
// tersembunyi di view sistem lama. Isian tambahan setiap status bawaan datang dari perilakunya, bukan dari layar ini.

const route = getRouteApi('/_app/healthcare/clinical/discharge-statuses');

function DischargeStatusesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="discharge-statuses"
            title="Status pasien"
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
    path: '/healthcare/clinical/discharge-statuses',
    layout: 'app',
    title: 'Status pasien',
    validateSearch: referenceSearchSchema,
    component: DischargeStatusesPage,
});
