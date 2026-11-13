import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Kelas tarif (SIMmKelas, Admin → Setup Jasa → Kelas sistem lama). Nomor kelas sistem lama menjadi urutan. Dimulai kosong;
// kelas 'XX' sistem lama tidak dibuat, karena tarif tanpa kelas berlaku untuk semua kelas.

const route = getRouteApi('/_app/healthcare/clinical/care-classes');

function CareClassesPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="care-classes"
            title="Kelas"
            sortOrderLabel="Nomor"
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
    path: '/healthcare/clinical/care-classes',
    layout: 'app',
    title: 'Kelas',
    validateSearch: referenceSearchSchema,
    component: CareClassesPage,
});
