import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage, orpc } from '@core/platform/shell/index.ts';
import { VisitRegistration } from './visit-registration.tsx';

// Pendaftaran kunjungan baru di halaman penuh. Pasien yang dipilih disimpan di URL (`?patient=`), sehingga kartu pasien
// dapat membuka halaman ini langsung dengan pasiennya.

const route = getRouteApi('/_app/healthcare/registration/visits/new');
const searchSchema = z.object({
    patient: z.string().max(100).optional(),
});

function NewVisitPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareVisitMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    return (
        <VisitRegistration
            metadata={metadata}
            visit={null}
            patientId={search.patient ?? null}
            justSaved={false}
            onPatientChange={(patient) =>
                void navigate({
                    search: patient ? { patient } : {},
                    replace: true,
                })
            }
        />
    );
}

export const page = definePage({
    path: '/healthcare/registration/visits/new',
    layout: 'app',
    title: 'Registrasi kunjungan baru',
    validateSearch: searchSchema,
    component: NewVisitPage,
});
