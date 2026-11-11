import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { CalendarCog, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    addDays,
    dayNames,
    isoDay,
    weekStart,
} from './practice-schedule.days.ts';

// Jadwal praktik bertanggal satu section per minggu, seperti layar jadwal mingguan sistem lama. Setiap jadwal bisa
// dibatalkan dengan alasan, diberi nakes pengganti, atau diubah kapasitasnya; jadwal yang diubah di sini tidak ditimpa
// Generate jadwal berikutnya.

const route = getRouteApi('/_app/healthcare/service/practice-schedules');
const ALL = 'all';
type Schedule = ApiBody<'healthcarePracticeScheduleList'>['data'][number];
type Metadata = ApiBody<'healthcarePracticeScheduleMetadata'>;
type Practitioner =
    ApiBody<'healthcarePracticeSchedulePractitioners'>['data'][number];
type Errors = Record<string, string[]>;
const dateText = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional();
const searchSchema = z.object({
    section: z.string().max(100).optional(),
    week: dateText,
});

const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function usePractitionerLoader(): LookupLoader<Practitioner> {
    return useCallback<LookupLoader<Practitioner>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePracticeSchedulePractitioners(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
}

const practitionerColumns = [
    {
        id: 'name',
        header: 'Nama',
        cell: (item: Practitioner) => item.name,
    },
];

const capacityText = (schedule: Schedule) =>
    schedule.capacity === null
        ? `${schedule.registered} terdaftar · tanpa batas`
        : `${schedule.registered} dari ${schedule.capacity} terdaftar`;

// Ubah satu jadwal bertanggal: status, alasan batal, nakes pengganti, dan kapasitas.
function ScheduleCard({
    schedule,
    metadata,
    portalContainer,
    onSaved,
}: {
    schedule: Schedule;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (schedule: Schedule) => void;
}): ReactNode {
    const editing = metadata.permissions.update;
    const blank = {
        status: schedule.status,
        cancel_reason: schedule.cancel_reason ?? '',
        substitute: schedule.substitute_practitioner_id
            ? {
                  id: schedule.substitute_practitioner_id,
                  name: schedule.substitute_practitioner_name ?? '',
                  profession: '',
              }
            : null,
        capacity: schedule.capacity === null ? '' : String(schedule.capacity),
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const loader = usePractitionerLoader();
    usePageDialogRecord({
        recordTitle: `${schedule.practitioner_name} · ${displayDate(schedule.date)}`,
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const capacity = form.capacity.trim();
        try {
            const { body } = await api.healthcarePracticeScheduleUpdate({
                params: { id: schedule.id },
                body: {
                    status: form.status === 'batal' ? 'batal' : 'terjadwal',
                    cancel_reason:
                        form.status === 'batal' ? form.cancel_reason : null,
                    substitute_practitioner_id: form.substitute?.id ?? null,
                    capacity: capacity === '' ? null : Number(capacity),
                    version: schedule.version,
                },
            });
            toast.success('Jadwal diperbarui.');
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jadwal belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            {editing && (
                <PageDialogToolbar>
                    <ActionButton
                        action="save"
                        type="submit"
                        disabled={busy}
                        pending={busy}
                    />
                    <ActionButton
                        action="cancel"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setForm(blank);
                            setErrors({});
                        }}
                    />
                </PageDialogToolbar>
            )}
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Jadwal belum disimpan"
            />
            <PageDialogBody className="py-3">
                <p className="mb-3 text-sm text-muted-foreground">
                    {dayNames[isoDay(schedule.date)]},{' '}
                    {displayDate(schedule.date)} · {schedule.session_name}{' '}
                    {schedule.start_time}–{schedule.end_time}
                    {schedule.ends_on !== schedule.date &&
                        ` (selesai ${displayDate(schedule.ends_on)})`}{' '}
                    · {capacityText(schedule)}
                </p>
                <FormGrid>
                    <FormControl error={errors.status?.[0]}>
                        {editing ? (
                            <Select
                                label="Status"
                                required
                                items={[
                                    { value: 'terjadwal', label: 'Terjadwal' },
                                    { value: 'batal', label: 'Batal' },
                                ]}
                                value={form.status}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        status: value ?? form.status,
                                    })
                                }
                                searchPlaceholder="Cari status"
                                emptyMessage="Status tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Status"
                                value={
                                    form.status === 'batal'
                                        ? 'Batal'
                                        : 'Terjadwal'
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                    {form.status === 'batal' && (
                        <FormControl error={errors.cancel_reason?.[0]}>
                            <Input
                                label="Alasan batal"
                                required
                                maxLength={200}
                                data-error-field="cancel_reason"
                                value={form.cancel_reason}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        cancel_reason: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                    )}
                    <FormControl
                        error={errors.substitute_practitioner_id?.[0]}
                        hint="Nakes yang menggantikan pada jadwal ini. Pendaftaran menawarkan nama pengganti."
                    >
                        {editing ? (
                            <InlineLookup
                                label="Nakes pengganti"
                                loadItems={loader}
                                value={form.substitute}
                                onValueChange={(substitute) =>
                                    setForm({ ...form, substitute })
                                }
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                placeholder="Tanpa pengganti"
                                emptyMessage="Nakes aktif tidak ditemukan."
                                columns={practitionerColumns}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        ) : (
                            <Input
                                label="Nakes pengganti"
                                value={form.substitute?.name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.capacity?.[0]}
                        hint="Kosongkan bila tanpa batas."
                    >
                        <Input
                            label="Kapasitas"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            data-error-field="capacity"
                            value={form.capacity}
                            readOnly={!editing}
                            placeholder="Tanpa batas"
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    capacity: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                </FormGrid>
                {editing && form.substitute && (
                    <Button
                        type="button"
                        variant="ghost"
                        className="mt-2"
                        onClick={() => setForm({ ...form, substitute: null })}
                    >
                        Hapus nakes pengganti
                    </Button>
                )}
            </PageDialogBody>
        </form>
    );
}

// Jadwal tambahan di luar template untuk section yang sedang dibuka.
function ManualScheduleCard({
    sectionId,
    date,
    metadata,
    portalContainer,
    onSaved,
    onClose,
}: {
    sectionId: string;
    date: string;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (schedule: Schedule) => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState<{
        date: string;
        practitioner: Practitioner | null;
        session_id: string | null;
        capacity: string;
    }>({ date, practitioner: null, session_id: null, capacity: '' });
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const loader = usePractitionerLoader();
    usePageDialogRecord({ recordTitle: 'Jadwal tambahan', editing: true });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const capacity = form.capacity.trim();
        try {
            const { body } = await api.healthcarePracticeScheduleCreate({
                body: {
                    section_id: sectionId,
                    date: form.date,
                    practitioner_id: form.practitioner?.id ?? '',
                    session_id: form.session_id ?? '',
                    capacity: capacity === '' ? null : Number(capacity),
                },
            });
            toast.success('Jadwal tambahan dibuat.');
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jadwal belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <PageDialogToolbar>
                <ActionButton
                    action="save"
                    type="submit"
                    disabled={busy}
                    pending={busy}
                />
                <ActionButton
                    action="cancel"
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                />
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Jadwal belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.date?.[0]}>
                        <DatePicker
                            label="Tanggal"
                            required
                            data-error-field="date"
                            value={form.date}
                            onValueChange={(value) =>
                                setForm({ ...form, date: value })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl error={errors.practitioner_id?.[0]}>
                        <InlineLookup
                            label="Nakes"
                            required
                            loadItems={loader}
                            value={form.practitioner}
                            onValueChange={(practitioner) =>
                                setForm({ ...form, practitioner })
                            }
                            getItemValue={(item) => item.id}
                            getItemLabel={(item) => item.name}
                            placeholder="Cari nakes…"
                            emptyMessage="Nakes aktif tidak ditemukan."
                            columns={practitionerColumns}
                            portalContainer={portalContainer}
                            showDetails={false}
                        />
                    </FormControl>
                    <FormControl error={errors.session_id?.[0]}>
                        <Select
                            label="Sesi"
                            required
                            items={metadata.sessions
                                .filter((session) => session.is_active)
                                .map((session) => ({
                                    value: session.id,
                                    label: `${session.name} (${session.start_time}–${session.end_time})`,
                                }))}
                            value={form.session_id}
                            onValueChange={(value) =>
                                setForm({ ...form, session_id: value })
                            }
                            placeholder="Pilih sesi"
                            searchPlaceholder="Cari sesi"
                            emptyMessage="Belum ada sesi aktif."
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl
                        error={errors.capacity?.[0]}
                        hint="Kosongkan bila tanpa batas."
                    >
                        <Input
                            label="Kapasitas"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            data-error-field="capacity"
                            value={form.capacity}
                            placeholder="Tanpa batas"
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    capacity: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
        </form>
    );
}

// Generate jadwal bertanggal dari template untuk rentang tanggal, satu section atau semua.
function GenerateCard({
    sectionId,
    from,
    metadata,
    portalContainer,
    onDone,
    onClose,
}: {
    sectionId: string | null;
    from: string;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onDone: () => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState({
        from,
        to: addDays(from, 6),
        section: sectionId ?? ALL,
    });
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    usePageDialogRecord({ recordTitle: 'Generate jadwal', editing: true });

    const run = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.healthcarePracticeScheduleGenerate({
                body: {
                    from: form.from,
                    to: form.to,
                    section_id: form.section === ALL ? null : form.section,
                },
            });
            const result = body.data;
            toast.success(
                `Jadwal disusun: ${result.created} baru, ${result.updated} diperbarui, ${result.removed} dihapus, ${result.kept} tidak disentuh karena sudah diubah atau ada pasien.`,
            );
            onDone();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jadwal belum disusun.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                void run();
            }}
        >
            <PageDialogToolbar>
                <Button type="submit" variant="ghost" disabled={busy}>
                    <CalendarCog aria-hidden="true" />
                    {busy ? 'Menyusun…' : 'Generate'}
                </Button>
                <ActionButton
                    action="cancel"
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                />
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Jadwal belum disusun"
            />
            <PageDialogBody className="py-3">
                <p className="mb-3 text-sm text-muted-foreground">
                    Jadwal disusun dari template yang aktif. Jadwal yang sudah
                    diubah di layar ini atau sudah ada pasiennya tidak disentuh.
                    Rentang paling panjang 92 hari.
                </p>
                <FormGrid>
                    <FormControl error={errors.from?.[0]}>
                        <DatePicker
                            label="Dari tanggal"
                            required
                            data-error-field="from"
                            value={form.from}
                            onValueChange={(value) =>
                                setForm({ ...form, from: value })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl error={errors.to?.[0]}>
                        <DatePicker
                            label="Sampai tanggal"
                            required
                            data-error-field="to"
                            value={form.to}
                            onValueChange={(value) =>
                                setForm({ ...form, to: value })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl error={errors.section_id?.[0]}>
                        <Select
                            label="Section"
                            items={[
                                { value: ALL, label: 'Semua section' },
                                ...metadata.sections.map((section) => ({
                                    value: section.id,
                                    label: `${section.name} · ${section.operating_unit_name}`,
                                })),
                            ]}
                            value={form.section}
                            onValueChange={(value) =>
                                setForm({ ...form, section: value ?? ALL })
                            }
                            searchPlaceholder="Cari section"
                            emptyMessage="Section tidak ditemukan."
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
        </form>
    );
}

type Open =
    | { kind: 'schedule'; schedule: Schedule }
    | { kind: 'manual'; date: string }
    | { kind: 'generate' };

const dialogTitles: Record<Open['kind'], string> = {
    schedule: 'Jadwal praktik',
    manual: 'Jadwal praktik',
    generate: 'Generate jadwal',
};

function PracticeSchedulesPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcarePracticeScheduleMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const sectionId =
        metadata.sections.find((section) => section.id === search.section)
            ?.id ?? null;
    const week = weekStart(search.week ?? today());
    const dates = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(week, offset));
    const [open, setOpen] = useState<Open | null>(null);
    const schedules = useQuery({
        ...orpc.healthcarePracticeScheduleList.queryOptions({
            input: {
                query: {
                    section_id: sectionId ?? '',
                    from: week,
                    to: addDays(week, 6),
                },
            },
            select: (response) => response.body.data,
        }),
        enabled: sectionId !== null,
    });
    const refresh = () => void schedules.refetch();
    const setSearch = (next: { section?: string; week?: string }) =>
        void navigate({
            search: (current) => ({ ...current, ...next }),
            replace: true,
        });

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <RecordActionBar title="Jadwal praktik">
                {permissions.create && sectionId && (
                    <ActionButton
                        action="create"
                        onClick={() =>
                            setOpen({
                                kind: 'manual',
                                date: dates.includes(today()) ? today() : week,
                            })
                        }
                    />
                )}
                {permissions.create && permissions.update && (
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setOpen({ kind: 'generate' })}
                    >
                        <CalendarCog aria-hidden="true" />
                        Generate jadwal
                    </Button>
                )}
            </RecordActionBar>
            <div className="flex flex-wrap items-center gap-2 px-1">
                <div className="w-full max-w-md">
                    <FormControl>
                        <Select
                            label="Section"
                            items={metadata.sections.map((section) => ({
                                value: section.id,
                                label: `${section.name} · ${section.operating_unit_name}`,
                            }))}
                            value={sectionId}
                            onValueChange={(value) =>
                                setSearch({ section: value ?? undefined })
                            }
                            placeholder="Pilih section"
                            searchPlaceholder="Cari section"
                            emptyMessage="Belum ada section aktif."
                        />
                    </FormControl>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label="Minggu sebelumnya"
                    onClick={() => setSearch({ week: addDays(week, -7) })}
                >
                    <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="min-w-44 text-center text-sm font-medium">
                    {displayDate(week)} – {displayDate(addDays(week, 6))}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label="Minggu berikutnya"
                    onClick={() => setSearch({ week: addDays(week, 7) })}
                >
                    <ChevronRight aria-hidden="true" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSearch({ week: undefined })}
                >
                    Minggu ini
                </Button>
            </div>
            {sectionId === null ? (
                <p className="px-1 text-sm text-muted-foreground">
                    Pilih section untuk melihat jadwal praktiknya.
                </p>
            ) : schedules.isError ? (
                <p role="alert" className="px-1 text-sm text-destructive">
                    {errorText(schedules.error, 'Jadwal belum bisa dimuat.')}{' '}
                    <Button type="button" variant="ghost" onClick={refresh}>
                        Coba lagi
                    </Button>
                </p>
            ) : (
                <div className="grid min-h-0 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
                    {dates.map((date) => {
                        const entries = (schedules.data ?? []).filter(
                            (schedule) => schedule.date === date,
                        );
                        return (
                            <Card key={date}>
                                <CardHeader>
                                    <CardTitle>
                                        {dayNames[isoDay(date)]},{' '}
                                        {displayDate(date)}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-1">
                                    {schedules.isPending ? (
                                        <p className="text-sm text-muted-foreground">
                                            Memuat...
                                        </p>
                                    ) : entries.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            Belum ada jadwal. Pilih Generate
                                            jadwal untuk menyusunnya dari
                                            template.
                                        </p>
                                    ) : (
                                        entries.map((schedule) => (
                                            <Button
                                                key={schedule.id}
                                                type="button"
                                                variant="ghost"
                                                className="h-auto flex-col items-start gap-0.5 px-2 py-1.5 text-left whitespace-normal"
                                                onClick={() =>
                                                    setOpen({
                                                        kind: 'schedule',
                                                        schedule,
                                                    })
                                                }
                                            >
                                                <span
                                                    className={
                                                        schedule.status ===
                                                        'batal'
                                                            ? 'text-sm font-medium text-muted-foreground line-through'
                                                            : 'text-sm font-medium'
                                                    }
                                                >
                                                    {schedule.substitute_practitioner_name ??
                                                        schedule.practitioner_name}
                                                </span>
                                                {schedule.substitute_practitioner_name && (
                                                    <span className="text-xs text-muted-foreground">
                                                        Menggantikan{' '}
                                                        {
                                                            schedule.practitioner_name
                                                        }
                                                    </span>
                                                )}
                                                <span className="text-xs text-muted-foreground">
                                                    {schedule.session_name}{' '}
                                                    {schedule.start_time}–
                                                    {schedule.end_time}
                                                    {schedule.ends_on !==
                                                        schedule.date &&
                                                        ' (besok)'}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {capacityText(schedule)}
                                                </span>
                                                {(schedule.status === 'batal' ||
                                                    schedule.source ===
                                                        'manual') && (
                                                    <span className="flex flex-wrap gap-1">
                                                        {schedule.status ===
                                                            'batal' && (
                                                            <Badge variant="destructive">
                                                                Batal
                                                                {schedule.cancel_reason
                                                                    ? `: ${schedule.cancel_reason}`
                                                                    : ''}
                                                            </Badge>
                                                        )}
                                                        {schedule.source ===
                                                            'manual' && (
                                                            <Badge variant="outline">
                                                                Tambahan
                                                            </Badge>
                                                        )}
                                                    </span>
                                                )}
                                            </Button>
                                        ))
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title={dialogTitles[open.kind]}
                    >
                        {open.kind === 'schedule' ? (
                            <ScheduleCard
                                key={`${open.schedule.id}:${open.schedule.version}`}
                                schedule={open.schedule}
                                metadata={metadata}
                                portalContainer={contentRef}
                                onSaved={(schedule) => {
                                    setOpen({ kind: 'schedule', schedule });
                                    refresh();
                                }}
                            />
                        ) : open.kind === 'manual' && sectionId ? (
                            <ManualScheduleCard
                                sectionId={sectionId}
                                date={open.date}
                                metadata={metadata}
                                portalContainer={contentRef}
                                onSaved={(schedule) => {
                                    setOpen({ kind: 'schedule', schedule });
                                    refresh();
                                }}
                                onClose={() => setOpen(null)}
                            />
                        ) : (
                            <GenerateCard
                                sectionId={sectionId}
                                from={week}
                                metadata={metadata}
                                portalContainer={contentRef}
                                onDone={() => {
                                    setOpen(null);
                                    refresh();
                                }}
                                onClose={() => setOpen(null)}
                            />
                        )}
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/service/practice-schedules',
    layout: 'app',
    title: 'Jadwal praktik',
    validateSearch: searchSchema,
    component: PracticeSchedulesPage,
});
