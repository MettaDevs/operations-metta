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
import { OrderPanels } from '../medical-record/order-panels.tsx';
import { CpptPanel } from '../cppt/cppt-panel.tsx';
import {
    DischargePanel,
    type ReferralRequest,
} from '../discharge/discharge-panel.tsx';
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
    // Kesalahan hidup di luar form yang dipasang ulang setiap versi, supaya kegagalan sesudah Simpan berhasil (Kirim ke
    // farmasi, Selesai periksa) tetap terlihat.
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
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
            errors={errors}
            setErrors={setErrors}
            message={message}
            setMessage={setMessage}
        />
    );
}

function ExaminationRecord({
    entry,
    shown,
    recordMetadata,
    canManage,
    errors,
    setErrors,
    message,
    setMessage,
}: {
    entry: Entry;
    shown: MedicalRecordShown;
    recordMetadata: MedicalRecordMetadata;
    canManage: boolean;
    errors: Errors;
    setErrors: (errors: Errors) => void;
    message: string | null;
    setMessage: (message: string | null) => void;
}): ReactNode {
    const navigate = route.useNavigate();
    const queryClient = useQueryClient();
    const patientMetadata = useQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [draft, setDraft] = useState<MedicalRecordDraft>(shown.data);
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
    const showRecord = (body: MedicalRecordShown) =>
        queryClient.setQueryData(recordOptions.queryKey, {
            status: 200,
            headers: {},
            body,
        });
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
            showRecord(body);
            void queryClient.invalidateQueries({
                queryKey: orpc.healthcareCppt.key(),
            });
            return true;
        } catch (caught) {
            fail(caught, 'Terjadi kesalahan saat menyimpan data.');
            return false;
        } finally {
            setBusy(false);
        }
    };

    // Kirim ke farmasi menyimpan perubahan yang belum disimpan lebih dulu, termasuk draf resep yang belum punya id,
    // lalu mengirim draf itu dengan versi pemeriksaan hasil simpan.
    const send = async (position: number) => {
        setBusy(true);
        let saved: MedicalRecordShown | null = null;
        try {
            let current = shown;
            if (dirty || !draft.prescriptions?.[position]?.id) {
                ({ body: current } = await api.healthcareMedicalRecordSave({
                    params: { id: entry.id },
                    body: draft,
                }));
                saved = current;
            }
            const prescription = current.data.prescriptions?.find(
                (row) => row.status === 'draf',
            );
            if (!prescription?.id) {
                if (saved) showRecord(saved);
                setErrors({ prescription: ['Resep belum berisi obat.'] });
                setMessage(null);
                return;
            }
            const { body } = await api.healthcarePrescriptionSend({
                params: { id: entry.id, prescriptionId: prescription.id },
                body: { version: current.data.version },
            });
            setErrors({});
            setMessage(null);
            const sent = body.data.prescriptions?.find(
                (row) => row.id === prescription.id,
            );
            toast.success(`Resep ${sent?.number ?? ''} dikirim ke farmasi.`);
            showRecord(body);
        } catch (caught) {
            if (saved) showRecord(saved);
            fail(caught, 'Resep belum dikirim ke farmasi.');
        } finally {
            setBusy(false);
        }
    };

    // Tambah Rujuk Internal menyimpan perubahan yang belum disimpan lebih dulu, lalu membuat tujuan baru dengan status
    // rujuk internal yang dipilih. Kesalahan isian dialog dikembalikan ke dialog.
    const refer = async (request: ReferralRequest): Promise<Errors | null> => {
        if (dirty && !(await save()))
            return {
                referral: [
                    'Rekam medis belum disimpan. Periksa isian yang perlu diperbaiki.',
                ],
            };
        try {
            const { body } = await api.healthcareInternalReferralCreate({
                params: { id: entry.id },
                body: {
                    ...request,
                    status_id: draft.discharge?.status_id ?? null,
                },
            });
            setErrors({});
            setMessage(null);
            showRecord(body);
            setDraft(body.data);
            const referral = body.data.discharge?.internal_referrals.at(-1);
            if (referral)
                toast.success(
                    `Pasien dirujuk ke ${referral.section_name} dengan antrean ${referral.queue_code}.`,
                );
            void queryClient.invalidateQueries({
                queryKey: orpc.healthcareExaminationQueue.key(),
            });
            return null;
        } catch (caught) {
            if (caught instanceof ApiError && Object.keys(caught.errors).length)
                return caught.errors;
            return { referral: [errorText(caught, 'Pasien belum dirujuk.')] };
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
                    <div className="grid items-start gap-4 lg:grid-cols-12">
                        <div className="min-w-0 space-y-4 lg:col-span-4">
                            {shown.data.discharge && (
                                <DischargePanel
                                    destinationId={entry.id}
                                    visitDate={entry.date}
                                    discharge={
                                        draft.discharge ?? shown.data.discharge
                                    }
                                    setDischarge={(discharge) =>
                                        setDraft((current) => ({
                                            ...current,
                                            discharge,
                                        }))
                                    }
                                    metadata={recordMetadata}
                                    errors={errors}
                                    disabled={!editable || busy}
                                    onRefer={refer}
                                />
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
                                        <DestinationStatusText
                                            status={entry.status}
                                        />
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-2">
                                        <Fact label="NRM">
                                            {entry.patient_nrm}
                                        </Fact>
                                        <Fact label="Jenis kelamin">
                                            {gender}
                                        </Fact>
                                        <Fact label="Tanggal lahir">
                                            {entry.birth_date &&
                                                displayDate(entry.birth_date)}
                                        </Fact>
                                        <Fact label="Umur">
                                            {ageText(entry)}
                                        </Fact>
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
                                        <Fact label="Poli">
                                            {entry.section_name}
                                        </Fact>
                                        <Fact label="Ruangan">
                                            {entry.room_name}
                                        </Fact>
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
                                        {entry.referrer_section_name && (
                                            <Fact label="Rujukan dari">
                                                {entry.referrer_section_name}
                                            </Fact>
                                        )}
                                    </dl>
                                </CardContent>
                            </Card>
                            {shown.context.panels.includes('cppt') && (
                                <CpptPanel destinationId={entry.id} />
                            )}
                        </div>
                        <div className="min-w-0 space-y-4 lg:col-span-8">
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
                                <OrderPanels
                                    draft={draft}
                                    setDraft={setDraft}
                                    metadata={recordMetadata}
                                    errors={errors}
                                    disabled={!editable || busy}
                                    onSend={(position) => void send(position)}
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
