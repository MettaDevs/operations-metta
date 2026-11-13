import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Alat penunjang (SIMmAlatPenunjang, Admin → Setup Jasa → Devices sistem lama) yang dipilih di Menggunakan Alat kartu
// Jasa. Dimulai kosong.

const route = getRouteApi('/_app/healthcare/clinical/supporting-devices');

function SupportingDevicesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="supporting-devices"
            title="Alat penunjang"
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
    path: '/healthcare/clinical/supporting-devices',
    layout: 'app',
    title: 'Alat penunjang',
    validateSearch: referenceSearchSchema,
    component: SupportingDevicesPage,
});
