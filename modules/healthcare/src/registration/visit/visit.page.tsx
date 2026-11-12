import { Button } from '@operations-metta/ui/button';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage, errorText, orpc } from '@core/platform/shell/index.ts';
import { notFound, VisitRegistration } from './visit-registration.tsx';

// Satu kunjungan tersimpan di halaman penuh pendaftaran: isian terkunci, dengan aksi batal. `?saved=true` menandai
// halaman yang dibuka tepat sesudah registrasi disimpan.

const route = getRouteApi('/_app/healthcare/registration/visits/$visitId');
const searchSchema = z.object({
    saved: z.boolean().optional(),
});

function VisitPage(): ReactNode {
    const { visitId } = route.useParams();
    const search = route.useSearch();
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareVisitMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const visit = useQuery(
        orpc.healthcareVisitShow.queryOptions({
            input: { params: { id: visitId } },
            select: (response) => response.body.data,
        }),
    );
    if (!visit.data)
        return (
            <div className="space-y-3 p-6">
                <p
                    role={visit.isError ? 'alert' : 'status'}
                    className={
                        visit.isError
                            ? 'text-sm text-destructive'
                            : 'text-sm text-muted-foreground'
                    }
                >
                    {visit.isError
                        ? notFound(visit.error)
                            ? 'Registrasi tidak ditemukan di legal entity dan unit kerja aktif.'
                            : errorText(
                                  visit.error,
                                  'Registrasi belum dapat dimuat.',
                              )
                        : 'Memuat registrasi…'}
                </p>
                {visit.isError && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void visit.refetch()}
                    >
                        Coba lagi
                    </Button>
                )}
            </div>
        );
    return (
        <VisitRegistration
            key={visit.data.id}
            metadata={metadata}
            visit={visit.data}
            patientId={visit.data.patient_id}
            justSaved={search.saved === true}
            onPatientChange={() => undefined}
        />
    );
}

export const page = definePage({
    path: '/healthcare/registration/visits/$visitId',
    layout: 'app',
    title: 'Registrasi kunjungan',
    validateSearch: searchSchema,
    component: VisitPage,
});
