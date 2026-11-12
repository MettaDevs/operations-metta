import { ActionButton } from '@operations-metta/ui/action-button';
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
import { CheckCircle2, ListOrdered, Save } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    useUnsavedChangesGuard,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    MedicalRecordPanels,
    type MedicalRecordDraft,
    type MedicalRecordMetadata,
    type MedicalRecordShown,
} from '../medical-record/medical-record-panels.tsx';
import { DiagnosisPanels } from '../medical-record/diagnosis-panels.tsx';
import { ageText, DestinationStatusText, timeText } from './queue-display.tsx';

// Pemeriksaan satu tujuan kunjungan: pasien dan kunjungannya, isi tab Rekam Medis poli sistem lama dengan satu Simpan
// untuk seluruh tab, dan Selesai periksa. Isinya hanya bisa diubah sesudah Mulai periksa dan sebelum Selesai periksa.

const route = getRouteApi('/_app/healthcare/examination/queue/$destinationId');

type Entry = ApiBody<'healthcareExaminationShow'>['data'];
type Errors = Record<string, string[]>;

const notStartedMessage =
    'Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !';

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

function Loading({
    query,
    notFound,
    failed,
    loading,
}: {
    query: { isError: boolean; error: unknown; refetch: () => unknown };
    notFound: string;
    failed: string;
    loading: string;
}): ReactNode {
    return (
        <div className="space-y-3 p-6">
            <p
                role={query.isError ? 'alert' : 'status'}
                className={
                    query.isError
                        ? 'text-sm text-destructive'
                        : 'text-sm text-muted-foreground'
                }
            >
                {query.isError
                    ? query.error instanceof ApiError &&
                      query.error.status === 404
                        ? notFound
                        : errorText(query.error, failed)
                    : loading}
            </p>
            {query.isError && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void query.refetch()}
                >
                    Coba lagi
                </Button>
            )}
        </div>
    );
}

function ExaminationPage(): ReactNode {
    const { destinationId } = route.useParams();
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareExaminationMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const entry = useQuery(
        orpc.healthcareExaminationShow.queryOptions({
            input: { params: { id: destinationId } },
            select: (response) => response.body.data,
        }),
    );
    const recordMetadata = useQuery(
        orpc.healthcareMedicalRecordMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const record = useQuery(
        orpc.healthcareMedicalRecordShow.queryOptions({
            input: { params: { id: destinationId } },
            select: (response) => response.body,
        }),
    );
    const notFound =
        'Kunjungan tidak ditemukan di legal entity dan unit kerja aktif.';
    if (!entry.data)
        return (
            <Loading
                query={entry}
                notFound={notFound}
                failed="Kunjungan belum dapat dimuat."
                loading="Memuat kunjungan…"
            />
        );
    if (!record.data || !recordMetadata.data)
        return (
            <Loading
                query={record.isError ? record : recordMetadata}
                notFound={notFound}
                failed="Rekam medis belum dapat dimuat."
                loading="Memuat rekam medis…"
            />
        );
    return (
        <ExaminationRecord
            key={`${record.data.data.version ?? 'new'}-${record.data.context.status}`}
            entry={entry.data}
            shown={record.data}
            recordMetadata={recordMetadata.data}
            canManage={metadata.permissions.manage}
        />
    );
}

function ExaminationRecord({
    entry,
    shown,
    recordMetadata,
    canManage,
}: {
    entry: Entry;
    shown: MedicalRecordShown;
    recordMetadata: MedicalRecordMetadata;
    canManage: boolean;
}): ReactNode {
    const navigate = route.useNavigate();
    const queryClient = useQueryClient();
    const patientMetadata = useQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [draft, setDraft] = useState<MedicalRecordDraft>(shown.data);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const editable = shown.context.editable;
    const dirty =
        editable && JSON.stringify(draft) !== JSON.stringify(shown.data);
    const leaveGuard = useUnsavedChangesGuard(dirty, () =>
        setDraft(shown.data),
    );
    const showOptions = orpc.healthcareExaminationShow.queryOptions({
        input: { params: { id: entry.id } },
    });
    const recordOptions = orpc.healthcareMedicalRecordShow.queryOptions({
        input: { params: { id: entry.id } },
    });
    const toQueue = () =>
        void navigate({
            to: '/healthcare/examination/queue',
            search: { section: entry.section_id },
        });

    const fail = (caught: unknown, fallback: string) => {
        if (caught instanceof ApiError && Object.keys(caught.errors).length) {
            setErrors(caught.errors);
            setMessage(null);
        } else {
            setErrors({});
            setMessage(errorText(caught, fallback));
        }
    };

    // Simpan seluruh tab. Berhasil memasang ulang form dari respons, sehingga Simpan berikutnya memakai versi terbaru.
    const save = async (): Promise<boolean> => {
        setBusy(true);
        try {
            const { body } = await api.healthcareMedicalRecordSave({
                params: { id: entry.id },
                body: draft,
            });
            setErrors({});
            setMessage(null);
            toast.success('Data berhasil disimpan.');
            queryClient.setQueryData(recordOptions.queryKey, {
                status: 200,
                headers: {},
                body,
            });
            return true;
        } catch (caught) {
            fail(caught, 'Terjadi kesalahan saat menyimpan data.');
            return false;
        } finally {
            setBusy(false);
        }
    };

    // Selesai periksa menyimpan perubahan yang belum disimpan lebih dulu; server menolak pemeriksaan yang isian wajib
    // periksa fisiknya belum terisi.
    const finish = async () => {
        if (dirty && !(await save())) return;
        setBusy(true);
        try {
            const { body } = await api.healthcareExaminationFinish({
                params: { id: entry.id },
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
            await queryClient.invalidateQueries({
                queryKey: recordOptions.queryKey,
            });
            toast.success(`Pemeriksaan ${body.data.queue_code} selesai.`);
        } catch (caught) {
            fail(caught, 'Pemeriksaan belum diselesaikan.');
        } finally {
            setBusy(false);
        }
    };

    const gender = entry.gender
        ? (patientMetadata.data?.reference_values.gender?.find(
              (value) => value.code === entry.gender,
          )?.name ?? entry.gender)
        : null;
    const notice =
        shown.context.status === 'selesai'
            ? 'Pemeriksaan ini sudah selesai, jadi isinya tidak dapat diubah lagi.'
            : shown.context.status === 'diperiksa'
              ? canManage
                  ? null
                  : 'Anda dapat melihat pemeriksaan ini, tetapi belum diberi izin mengisinya.'
              : notStartedMessage;

    return (
        <div className="flex h-full min-h-0 flex-col">
            {leaveGuard}
            <RecordActionBar title={`Pemeriksaan ${entry.queue_code}`}>
                <Button
                    type="button"
                    variant="ghost"
                    size="command"
                    onClick={toQueue}
                >
                    <ListOrdered aria-hidden="true" />
                    Antrean poli
                </Button>
                {editable && (
                    <ActionButton
                        action="save"
                        type="button"
                        pending={busy}
                        disabled={busy}
                        onClick={() => void save()}
                    />
                )}
                {editable && (
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
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Rekam medis belum disimpan"
                    />
                    {notice && (
                        <Alert>
                            <AlertDescription>{notice}</AlertDescription>
                        </Alert>
                    )}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex flex-wrap items-baseline gap-3">
                                <span className="text-2xl font-bold tabular-nums">
                                    {entry.queue_code}
                                </span>
                                <span className="text-base">
                                    {entry.patient_name}
                                </span>
                                <DestinationStatusText status={entry.status} />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                                <Fact label="NRM">{entry.patient_nrm}</Fact>
                                <Fact label="Jenis kelamin">{gender}</Fact>
                                <Fact label="Tanggal lahir">
                                    {entry.birth_date &&
                                        displayDate(entry.birth_date)}
                                </Fact>
                                <Fact label="Umur">{ageText(entry)}</Fact>
                                <Fact label="Tipe pasien">
                                    {entry.guarantor_name
                                        ? `${entry.patient_type_name} · ${entry.guarantor_name}`
                                        : entry.patient_type_name}
                                </Fact>
                                <Fact label="Klaster / siklus hidup">
                                    {entry.cluster_code &&
                                        `${entry.cluster_code} ${entry.cluster_name ?? ''} · ${entry.life_cycle_name ?? ''}`}
                                </Fact>
                                <Fact label="Kunjungan">
                                    {entry.visit_kind === 'lama'
                                        ? 'Lama'
                                        : 'Baru'}
                                </Fact>
                                <Fact label="Skrining">
                                    {entry.screening_category_name}
                                </Fact>
                                <Fact label="Poli">{entry.section_name}</Fact>
                                <Fact label="Ruangan">{entry.room_name}</Fact>
                                <Fact label="Nakes">
                                    {entry.practitioner_name}
                                </Fact>
                                <Fact label="Tanggal kunjungan">
                                    {displayDate(entry.date)}{' '}
                                    {timeText(entry.registered_at)}
                                </Fact>
                                <Fact label="NoReg">
                                    {entry.registration_number}
                                </Fact>
                                <Fact label="NoBukti">
                                    {entry.examination_number}
                                </Fact>
                            </dl>
                        </CardContent>
                    </Card>
                    <fieldset
                        disabled={!editable || busy}
                        className="min-w-0 rounded-lg border bg-card disabled:opacity-90"
                    >
                        <MedicalRecordPanels
                            draft={draft}
                            setDraft={setDraft}
                            metadata={recordMetadata}
                            context={shown.context}
                            errors={errors}
                            disabled={!editable || busy}
                        />
                        <DiagnosisPanels
                            destinationId={entry.id}
                            draft={draft}
                            setDraft={setDraft}
                            metadata={recordMetadata}
                            errors={errors}
                            disabled={!editable || busy}
                        />
                    </fieldset>
                    {editable && (
                        <Button
                            type="button"
                            size="lg"
                            className="w-full"
                            data-action="save"
                            disabled={busy}
                            onClick={() => void save()}
                        >
                            <Save aria-hidden="true" />
                            {busy ? 'Menyimpan…' : 'Simpan'}
                        </Button>
                    )}
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
