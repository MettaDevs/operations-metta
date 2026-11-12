import { Alert, AlertDescription } from '@operations-metta/ui/alert';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { displayDate } from '@operations-metta/ui/date-picker';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import {
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { CheckCircle2, ListOrdered } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    definePage,
    errorText,
    orpc,
} from '@core/platform/shell/index.ts';
import { ageText, DestinationStatusText, timeText } from './queue-display.tsx';

// Pemeriksaan satu tujuan kunjungan: pasien dan kunjungannya, dengan aksi Selesai periksa.

const route = getRouteApi('/_app/healthcare/examination/queue/$destinationId');

function Fact({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}): ReactNode {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{children || '—'}</dd>
        </div>
    );
}

function ExaminationPage(): ReactNode {
    const { destinationId } = route.useParams();
    const navigate = route.useNavigate();
    const queryClient = useQueryClient();
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareExaminationMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const patientMetadata = useQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const showOptions = orpc.healthcareExaminationShow.queryOptions({
        input: { params: { id: destinationId } },
        select: (response) => response.body.data,
    });
    const entry = useQuery(showOptions);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const toQueue = () =>
        void navigate({
            to: '/healthcare/examination/queue',
            search: entry.data ? { section: entry.data.section_id } : {},
        });

    if (!entry.data)
        return (
            <div className="space-y-3 p-6">
                <p
                    role={entry.isError ? 'alert' : 'status'}
                    className={
                        entry.isError
                            ? 'text-sm text-destructive'
                            : 'text-sm text-muted-foreground'
                    }
                >
                    {entry.isError
                        ? entry.error instanceof ApiError &&
                          entry.error.status === 404
                            ? 'Kunjungan tidak ditemukan di legal entity dan unit kerja aktif.'
                            : errorText(
                                  entry.error,
                                  'Kunjungan belum dapat dimuat.',
                              )
                        : 'Memuat kunjungan…'}
                </p>
                {entry.isError && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void entry.refetch()}
                    >
                        Coba lagi
                    </Button>
                )}
            </div>
        );
    const current = entry.data;
    const gender = current.gender
        ? (patientMetadata.data?.reference_values.gender?.find(
              (value) => value.code === current.gender,
          )?.name ?? current.gender)
        : null;
    const finish = async () => {
        setBusy(true);
        try {
            const { body } = await api.healthcareExaminationFinish({
                params: { id: current.id },
                body: {},
            });
            queryClient.setQueryData(showOptions.queryKey, {
                status: 200,
                headers: {},
                body,
            });
            void queryClient.invalidateQueries({
                queryKey: orpc.healthcareExaminationQueue.key(),
            });
            setMessage(null);
            toast.success(`Pemeriksaan ${body.data.queue_code} selesai.`);
        } catch (caught) {
            setMessage(errorText(caught, 'Pemeriksaan belum diselesaikan.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <RecordActionBar title={`Pemeriksaan ${current.queue_code}`}>
                <Button
                    type="button"
                    variant="ghost"
                    size="command"
                    onClick={toQueue}
                >
                    <ListOrdered aria-hidden="true" />
                    Antrean poli
                </Button>
                {metadata.permissions.manage &&
                    current.status === 'diperiksa' && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void finish()}
                        >
                            <CheckCircle2 aria-hidden="true" />
                            Selesai periksa
                        </Button>
                    )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-4 p-3 lg:p-4">
                    {message && (
                        <Alert variant="destructive">
                            <AlertDescription>{message}</AlertDescription>
                        </Alert>
                    )}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex flex-wrap items-baseline gap-3">
                                <span className="text-2xl font-bold tabular-nums">
                                    {current.queue_code}
                                </span>
                                <span className="text-base">
                                    {current.patient_name}
                                </span>
                                <DestinationStatusText
                                    status={current.status}
                                />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                                <Fact label="NRM">{current.patient_nrm}</Fact>
                                <Fact label="Jenis kelamin">{gender}</Fact>
                                <Fact label="Tanggal lahir">
                                    {current.birth_date &&
                                        displayDate(current.birth_date)}
                                </Fact>
                                <Fact label="Umur">{ageText(current)}</Fact>
                                <Fact label="Tipe pasien">
                                    {current.guarantor_name
                                        ? `${current.patient_type_name} · ${current.guarantor_name}`
                                        : current.patient_type_name}
                                </Fact>
                                <Fact label="Klaster / siklus hidup">
                                    {current.cluster_code &&
                                        `${current.cluster_code} ${current.cluster_name ?? ''} · ${current.life_cycle_name ?? ''}`}
                                </Fact>
                                <Fact label="Kunjungan">
                                    {current.visit_kind === 'lama'
                                        ? 'Lama'
                                        : 'Baru'}
                                </Fact>
                                <Fact label="Skrining">
                                    {current.screening_category_name}
                                </Fact>
                                <Fact label="Poli">{current.section_name}</Fact>
                                <Fact label="Ruangan">{current.room_name}</Fact>
                                <Fact label="Nakes">
                                    {current.practitioner_name}
                                </Fact>
                                <Fact label="Tanggal kunjungan">
                                    {displayDate(current.date)}{' '}
                                    {timeText(current.registered_at)}
                                </Fact>
                                <Fact label="NoReg">
                                    {current.registration_number}
                                </Fact>
                                <Fact label="NoBukti">
                                    {current.examination_number}
                                </Fact>
                            </dl>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/examination/queue/$destinationId',
    layout: 'app',
    title: 'Pemeriksaan',
    component: ExaminationPage,
});
