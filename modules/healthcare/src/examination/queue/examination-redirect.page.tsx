import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { definePage, orpc } from '@core/platform/shell/index.ts';
import { examinationNotFound, Loading } from './queue-display.tsx';

// Alamat lama halaman pemeriksaan memakai id tujuan. Tautan dan bookmark lama dialihkan ke alamat NoReg dan kode
// section; previousPaths tidak bisa dipakai karena satu id menjadi dua bagian alamat yang harus dicari di server.

const route = getRouteApi('/_app/healthcare/examination/queue/$destinationId');

function PreviousExaminationPage(): ReactNode {
    const { destinationId } = route.useParams();
    const navigate = route.useNavigate();
    const entry = useQuery(
        orpc.healthcareExaminationShow.queryOptions({
            input: { params: { id: destinationId } },
            select: (response) => response.body.data,
        }),
    );
    const target = entry.data;
    useEffect(() => {
        if (target)
            void navigate({
                to: '/healthcare/examination/queue/$registrationNumber/$sectionCode',
                params: {
                    registrationNumber: target.registration_number,
                    sectionCode: target.section_code,
                },
                replace: true,
            });
    }, [target, navigate]);
    return (
        <Loading
            query={entry}
            notFound={examinationNotFound}
            failed="Kunjungan belum dapat dimuat."
            loading="Membuka pemeriksaan…"
        />
    );
}

export const page = definePage({
    path: '/healthcare/examination/queue/$destinationId',
    layout: 'app',
    title: 'Pemeriksaan',
    component: PreviousExaminationPage,
});
