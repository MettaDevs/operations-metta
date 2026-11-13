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
import { Select } from '@operations-metta/ui/select';
import {
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import {
    CheckCircle2,
    ListOrdered,
    Save,
    Stethoscope,
    Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
import {
    ageText,
    DestinationStatusText,
    examinationNotFound,
    Loading,
    timeText,
} from './queue-display.tsx';
import { placeRoom, readPlace, rememberPlace } from './queue-place.ts';
import { isDestinationStatus, nextStatus } from './queue.statuses.ts';

// Pemeriksaan satu tujuan kunjungan, di alamat NoReg lalu kode section seperti poly/outpatient/form/{NoReg}/{SectionID}
// sistem lama, supaya nakes bisa mengirim tautannya. Isinya pasien dan kunjungannya, Panggil dan Mulai periksa seperti
// panel Status Pasien sistem lama, isi tab Rekam Medis dengan satu Simpan untuk seluruh tab, dan Selesai periksa. Isinya
// hanya bisa diubah sesudah Mulai periksa dan sebelum Selesai periksa.

const route = getRouteApi(
    '/_app/healthcare/examination/queue/$registrationNumber/$sectionCode',
);

type Entry = ApiBody<'healthcareExaminationFind'>['data'];
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

function ExaminationPage(): ReactNode {
    const { registrationNumber, sectionCode } = route.useParams();
    const entry = useQuery(
        orpc.healthcareExaminationFind.queryOptions({
            input: { params: { registrationNumber, sectionCode } },
            select: (response) => response.body.data,
        }),
    );
    if (!entry.data)
        return (
            <Loading
                query={entry}
                notFound={examinationNotFound}
                failed="Kunjungan belum dapat dimuat."
                loading="Memuat kunjungan…"
            />
        );
    return <Examination entry={entry.data} />;
}

function Examination({ entry }: { entry: Entry }): ReactNode {
    const destinationId = entry.id;
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareExaminationMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const recordMetadata = useQuery(
        orpc.healthcareMedicalRecordMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    // Isian yang belum disimpan, dibawa melewati pemasangan ulang form sesudah Kirim ke farmasi menaikkan versi
    // pemeriksaan tanpa menyimpannya.
    const [carried, setCarried] = useState<MedicalRecordDraft | null>(null);
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
    if (!record.data || !recordMetadata.data)
        return (
            <Loading
                query={record.isError ? record : recordMetadata}
                notFound={examinationNotFound}
                failed="Rekam medis belum dapat dimuat."
                loading="Memuat rekam medis…"
            />
        );
    return (
        <ExaminationRecord
            key={`${record.data.data.version ?? 'new'}-${record.data.context.status}`}
            entry={entry}
            shown={record.data}
            recordMetadata={recordMetadata.data}
            rooms={
                metadata.sections.find(
                    (section) => section.id === entry.section_id,
                )?.rooms ?? []
            }
            canManage={metadata.permissions.manage}
            errors={errors}
            setErrors={setErrors}
            message={message}
            setMessage={setMessage}
            carried={carried}
            setCarried={setCarried}
        />
    );
}

function ExaminationRecord({
    entry,
    shown,
    recordMetadata,
    rooms,
    canManage,
    errors,
    setErrors,
    message,
    setMessage,
    carried,
    setCarried,
}: {
    entry: Entry;
    shown: MedicalRecordShown;
    recordMetadata: MedicalRecordMetadata;
    rooms: readonly { id: string; name: string }[];
    canManage: boolean;
    errors: Errors;
    setErrors: (errors: Errors) => void;
    message: string | null;
    setMessage: (message: string | null) => void;
    carried: MedicalRecordDraft | null;
    setCarried: (draft: MedicalRecordDraft | null) => void;
}): ReactNode {
    const navigate = route.useNavigate();
    const queryClient = useQueryClient();
    const patientMetadata = useQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [draft, setDraft] = useState<MedicalRecordDraft>(
        carried ?? shown.data,
    );
    useEffect(() => {
        if (carried) setCarried(null);
    }, [carried, setCarried]);
    const [busy, setBusy] = useState(false);
    const editable = shown.context.editable;
    const dirty =
        editable && JSON.stringify(draft) !== JSON.stringify(shown.data);
    const leaveGuard = useUnsavedChangesGuard(dirty, () =>
        setDraft(shown.data),
    );
    const { registrationNumber, sectionCode } = route.useParams();
    const entryOptions = orpc.healthcareExaminationFind.queryOptions({
        input: { params: { registrationNumber, sectionCode } },
    });
    const recordOptions = orpc.healthcareMedicalRecordShow.queryOptions({
        input: { params: { id: entry.id } },
    });
    const toQueue = () =>
        void navigate({
            to: '/healthcare/examination/queue',
            search: { section: entry.section_id },
        });

    const [place, setPlace] = useState(readPlace);
    const roomId = placeRoom(place, entry.section_id, rooms);
    const status = isDestinationStatus(entry.status) ? entry.status : null;
    // Pasien yang belum terikat ruangan dipanggil atau diperiksa di ruangan pemanggil; yang lain memakai ruangannya.
    const unplaced = status !== null && nextStatus('panggil', status) !== null;
    const canCall =
        canManage &&
        status !== null &&
        (unplaced || nextStatus('panggil_ulang', status) !== null);
    const canStart =
        canManage &&
        status !== null &&
        nextStatus('mulai_periksa', status) !== null;
    const [refusal, setRefusal] = useState<string | null>(null);
    const showEntry = (body: { data: Entry }) => {
        queryClient.setQueryData(entryOptions.queryKey, {
            status: 200,
            headers: {},
            body,
        });
        void queryClient.invalidateQueries({
            queryKey: orpc.healthcareExaminationQueue.key(),
        });
    };

    // Panggil dan Mulai periksa, seperti tombol di panel Status Pasien sistem lama. Penolakan tetap terlihat sampai
    // tindakan berikutnya.
    const perform = async (
        request: () => Promise<{ body: { data: Entry } }>,
        success: (row: Entry) => string,
        fallback: string,
    ): Promise<boolean> => {
        setBusy(true);
        try {
            const { body } = await request();
            setRefusal(null);
            showEntry(body);
            toast.success(success(body.data));
            return true;
        } catch (caught) {
            setRefusal(errorText(caught, fallback));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const call = () => {
        if (unplaced && !roomId) {
            setRefusal('Pilih ruangan tempat memanggil lebih dulu.');
            return;
        }
        void perform(
            () =>
                unplaced && roomId
                    ? api.healthcareExaminationCall({
                          params: { id: entry.id },
                          body: { room_id: roomId },
                      })
                    : api.healthcareExaminationRecall({
                          params: { id: entry.id },
                          body: {},
                      }),
            (row) =>
                `${row.queue_code} ${row.patient_name} dipanggil ke ${row.room_name ?? 'ruangan'}.`,
            'Pasien belum dipanggil.',
        );
    };
    // Pesan berhasil sistem lama untuk Mulai dan Selesai (statuspasien_helper::update_statuspasien).
    const start = async () => {
        const room = roomId ?? entry.room_id;
        if (unplaced && !room) {
            setRefusal('Pilih ruangan pemeriksaan lebih dulu.');
            return;
        }
        if (
            await perform(
                () =>
                    api.healthcareExaminationStart({
                        params: { id: entry.id },
                        body: unplaced ? { room_id: room } : {},
                    }),
                () => 'Data berhasil diperbarui.',
                'Pemeriksaan belum dimulai.',
            )
        )
            await queryClient.invalidateQueries({
                queryKey: recordOptions.queryKey,
            });
    };
    const pickRoom = (value: string | null) => {
        if (!value) return;
        const next = {
            ...place,
            rooms: { ...place.rooms, [entry.section_id]: value },
        };
        setPlace(next);
        rememberPlace(next);
    };

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

    // Kirim ke farmasi menyimpan dan mengirim draf resep saja, seperti E-Resep sistem lama: isian lain tidak ikut
    // disimpan atau diperiksa. Isian lain tetap seperti di layar walau versi pemeriksaan naik, termasuk nilai awal
    // pemeriksaan baru yang hanya diberikan server selama rekam medis belum pernah disimpan.
    const send = async () => {
        setBusy(true);
        try {
            const { body } = await api.healthcarePrescriptionSend({
                params: { id: entry.id },
                body: {
                    version: draft.version,
                    doctor_id: draft.anamnesis?.doctor_id ?? null,
                    nurse_id: draft.anamnesis?.nurse_id ?? null,
                    prescriptions: draft.prescriptions,
                },
            });
            setErrors({});
            setMessage(null);
            const before = new Set(
                shown.data.prescriptions
                    ?.filter((row) => row.status !== 'draf')
                    .map((row) => row.id),
            );
            const sent = body.data.prescriptions?.find(
                (row) => row.status !== 'draf' && !before.has(row.id),
            );
            toast.success(`Resep ${sent?.number ?? ''} dikirim ke farmasi.`);
            setCarried({
                ...draft,
                id: body.data.id,
                version: body.data.version,
                prescriptions: body.data.prescriptions,
            });
            showRecord(body);
        } catch (caught) {
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
            showEntry(body);
            await queryClient.invalidateQueries({
                queryKey: recordOptions.queryKey,
            });
            toast.success('Data berhasil diperbarui.');
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
                {canCall && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        onClick={call}
                    >
                        <Volume2 aria-hidden="true" />
                        Panggil
                    </Button>
                )}
                {canStart && (
                    <Button
                        type="button"
                        size="command"
                        disabled={busy}
                        onClick={() => void start()}
                    >
                        <Stethoscope aria-hidden="true" />
                        Mulai periksa
                    </Button>
                )}
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
                    {refusal && (
                        <Alert variant="destructive">
                            <AlertDescription>{refusal}</AlertDescription>
                        </Alert>
                    )}
                    {notice && (
                        <Alert>
                            <AlertDescription>{notice}</AlertDescription>
                        </Alert>
                    )}
                    {canManage && unplaced && (
                        <div className="w-56">
                            <Select
                                label="Ruangan saya"
                                className="w-full"
                                items={rooms.map((room) => ({
                                    value: room.id,
                                    label: room.name,
                                }))}
                                value={roomId ?? null}
                                onValueChange={pickRoom}
                                searchPlaceholder="Cari ruangan"
                                emptyMessage="Poli ini belum punya ruangan."
                            />
                        </div>
                    )}
                    <div className="grid items-start gap-4 lg:grid-cols-12">
                        <div className="min-w-0 space-y-4 lg:col-span-4">
                            {shown.data.discharge && (
                                <DischargePanel
                                    destinationId={entry.id}
                                    visitDate={entry.date}
                                    startedAt={entry.started_at}
                                    finishedAt={entry.finished_at}
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
                                    destinationId={entry.id}
                                    sectionId={entry.section_id}
                                    errors={errors}
                                    disabled={!editable || busy}
                                    onSend={() => void send()}
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
    path: '/healthcare/examination/queue/$registrationNumber/$sectionCode',
    layout: 'app',
    title: 'Pemeriksaan',
    component: ExaminationPage,
});
