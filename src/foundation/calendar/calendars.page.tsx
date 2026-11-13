import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { CalendarCog, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
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
} from '../../platform/shell/index.ts';
import {
    intervalText,
    linesOf,
    weekdayNames,
    WorkingTimeLines,
    type LineDraft,
} from './working-time-lines.tsx';

// Kalender, pola "Calendars" F&O: jam kerja per tanggal, disusun dari template jam kerja lalu diubah per tanggal bila
// perlu, misalnya hari libur. Kalender boleh mengikuti kalender dasar, sehingga libur yang dipelihara sekali di kalender
// dasar ikut menutup kalender ini pada tanggal yang diatur "Ikuti kalender dasar".

const route = getRouteApi('/_app/sysadmin/calendar/calendars');
const ALL = 'all';
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    base: z.enum(['with', 'without']).optional(),
});
type Search = z.infer<typeof searchSchema>;
type Calendar = ApiBody<'calendarList'>['data'][number];
type Day = ApiBody<'calendarDays'>['data'][number];
type Reference = { id: string; code: string; name: string };
type Errors = Record<string, string[]>;
type Control = 'open' | 'closed' | 'base';

const controlLabels: Record<Control, string> = {
    open: 'Buka',
    closed: 'Tutup',
    base: 'Ikuti kalender dasar',
};

const referenceColumns = [
    {
        id: 'code',
        header: 'Kode',
        width: 120,
        cell: (item: Reference) => <DataTableText>{item.code}</DataTableText>,
    },
    {
        id: 'name',
        header: 'Nama',
        width: 220,
        cell: (item: Reference) => <DataTableText>{item.name}</DataTableText>,
    },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthOf = (date: string) => date.slice(0, 7);
const monthRange = (month: string) => {
    const [year = 0, number = 1] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(last).padStart(2, '0')}`,
    };
};
const shiftMonth = (month: string, offset: number) => {
    const [year = 0, number = 1] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 1 + offset, 1))
        .toISOString()
        .slice(0, 7);
};
const monthLabel = (month: string) =>
    new Intl.DateTimeFormat('id-ID', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${month}-01T00:00:00Z`));

function ReferenceLookup({
    label,
    value,
    onChange,
    loadItems,
    disabled,
    error,
    hint,
    field,
    portalContainer,
}: {
    label: string;
    value: Reference | null;
    onChange: (value: Reference) => void;
    loadItems: LookupLoader<Reference>;
    disabled: boolean;
    error: string | undefined;
    hint?: string;
    field: string;
    portalContainer: RefObject<HTMLDivElement | null>;
}): ReactNode {
    return (
        <FormControl error={error} hint={hint}>
            <div data-error-field={field}>
                <InlineLookup
                    label={label}
                    required
                    value={value}
                    onValueChange={onChange}
                    loadItems={loadItems}
                    getItemValue={(item) => item.id}
                    getItemLabel={(item) => `${item.code} · ${item.name}`}
                    columns={referenceColumns}
                    disabled={disabled}
                    portalContainer={portalContainer}
                    showDetails={false}
                />
            </div>
        </FormControl>
    );
}

// Pilihan kalender dasar: kalender tenant ini selain kalender yang sedang dibuka.
function useCalendarLoader(excludeId: string | null) {
    return useCallback<LookupLoader<Reference>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.calendarList(
                {
                    query: {
                        q: query,
                        ...(excludeId ? { exclude: excludeId } : {}),
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return {
                items: body.data.map(({ id, code, name }) => ({
                    id,
                    code,
                    name,
                })),
                nextCursor: body.next_cursor,
            };
        },
        [excludeId],
    );
}

const loadTemplates: LookupLoader<Reference> = async ({
    query,
    cursor,
    signal,
}) => {
    const { body } = await api.workingTimeTemplateList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map(({ id, code, name }) => ({ id, code, name })),
        nextCursor: body.next_cursor,
    };
};

// Susun jam kerja: setiap tanggal dalam rentang mendapat jam kerja hari yang sama dari template, atau mengikuti kalender
// dasar. Hari yang sudah diubah sendiri tidak ditimpa.
function ComposeCard({
    calendar,
    month,
    portalContainer,
    onDone,
    onClose,
}: {
    calendar: Calendar;
    month: string;
    portalContainer: RefObject<HTMLDivElement | null>;
    onDone: () => void;
    onClose: () => void;
}): ReactNode {
    const range = monthRange(month);
    const blank: {
        from: string;
        to: string;
        followBase: boolean;
        template: Reference | null;
    } = {
        from: range.from,
        to: `${month.slice(0, 4)}-12-31`,
        followBase: false,
        template: null,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    usePageDialogRecord({
        recordTitle: `${calendar.code} · ${calendar.name}`,
        editing: true,
        dirty: JSON.stringify(form) !== JSON.stringify(blank),
    });
    const compose = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        if (!form.followBase && !form.template) {
            setErrors({ template_id: ['Pilih template jam kerja.'] });
            setBusy(false);
            return;
        }
        try {
            const { body } = await api.calendarCompose({
                params: { id: calendar.id },
                body: {
                    from: form.from,
                    to: form.to,
                    template_id: form.followBase
                        ? null
                        : (form.template?.id ?? null),
                },
            });
            const { created, updated, unchanged, kept } = body.data;
            toast.success(
                `Jam kerja disusun: ${created + updated} tanggal ditulis, ${unchanged} sudah sama` +
                    (kept
                        ? `, ${kept} tanggal yang diubah sendiri tidak disentuh.`
                        : '.'),
            );
            onDone();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jam kerja belum disusun.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                // Kartu ini dirender di dalam kartu kalender; submit-nya tidak boleh ikut menyimpan kalender.
                event.preventDefault();
                event.stopPropagation();
                void compose();
            }}
        >
            <PageDialogToolbar>
                <Button type="submit" variant="ghost" disabled={busy}>
                    <CalendarCog aria-hidden="true" />
                    Susun
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
                operation="Jam kerja belum disusun"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.from?.[0]}>
                        <DatePicker
                            label="Dari tanggal"
                            required
                            data-error-field="from"
                            value={form.from}
                            onValueChange={(from) => setForm({ ...form, from })}
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl error={errors.to?.[0]}>
                        <DatePicker
                            label="Sampai tanggal"
                            required
                            data-error-field="to"
                            value={form.to}
                            onValueChange={(to) => setForm({ ...form, to })}
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    {calendar.base_calendar && (
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id="compose-follow-base"
                                checked={form.followBase}
                                onCheckedChange={(followBase) =>
                                    setForm({ ...form, followBase })
                                }
                            />
                            <FieldLabel htmlFor="compose-follow-base">
                                Ikuti kalender dasar{' '}
                                {calendar.base_calendar.code}
                            </FieldLabel>
                        </Field>
                    )}
                    {!form.followBase && (
                        <ReferenceLookup
                            label="Template jam kerja"
                            value={form.template}
                            onChange={(template) =>
                                setForm({ ...form, template })
                            }
                            loadItems={loadTemplates}
                            disabled={busy}
                            error={errors.template_id?.[0]}
                            field="template_id"
                            portalContainer={portalContainer}
                        />
                    )}
                </FormGrid>
                <p className="mt-4 text-sm text-muted-foreground">
                    Tanggal yang sudah diubah sendiri, misalnya hari libur,
                    tidak ditimpa. Hapus tanggal itu lebih dulu bila ingin
                    menyusunnya lagi.
                </p>
            </PageDialogBody>
        </form>
    );
}

// Satu tanggal: buka dengan jam kerjanya, tutup, atau ikuti kalender dasar, beserta catatannya. Jam kerja tetap
// tersimpan saat harinya ditutup, jadi membukanya lagi memulihkan jamnya.
function DayCard({
    calendar,
    day,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    calendar: Calendar;
    day: Day;
    canManage: boolean;
    portalContainer: RefObject<HTMLDivElement | null>;
    onSaved: () => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const stored = day.stored;
    const blank = (): {
        control: Control;
        lines: LineDraft[];
        note: string;
    } => ({
        control: stored?.control ?? 'closed',
        lines: linesOf(stored?.lines ?? []),
        note: stored?.note ?? '',
    });
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank());
    usePageDialogRecord({
        recordTitle: `${weekdayNames[day.day_of_week] ?? ''}, ${displayDate(day.date)}`,
        editing,
        dirty,
    });
    const controls: Control[] = calendar.base_calendar
        ? ['open', 'closed', 'base']
        : ['open', 'closed'];
    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await api.calendarDaySet({
                params: { id: calendar.id, date: day.date },
                body: {
                    control: form.control,
                    lines: form.lines.map(({ from, to, ends_next_day }) => ({
                        from,
                        to,
                        ends_next_day,
                    })),
                    note: form.note || null,
                    version: stored?.version ?? null,
                },
            });
            toast.success('Tanggal diperbarui.');
            onSaved();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Tanggal belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!stored) return;
        if (
            !(await confirm({
                title: `Delete pengaturan ${displayDate(day.date)}?`,
                description:
                    'Tanggal ini kembali belum disusun dan dihitung tutup sampai Susun jam kerja mengisinya lagi.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.calendarDayDelete({
                params: { id: calendar.id, date: day.date },
                body: { version: stored.version },
            });
            toast.success('Pengaturan tanggal dihapus.');
            onSaved();
        } catch (caught) {
            setMessage(errorText(caught, 'Pengaturan tanggal belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                // Kartu ini dirender di dalam kartu kalender; submit-nya tidak boleh ikut menyimpan kalender.
                event.preventDefault();
                event.stopPropagation();
                void save();
            }}
        >
            <PageDialogToolbar>
                {editing && (
                    <>
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
                                if (!stored) {
                                    onClose();
                                    return;
                                }
                                setForm(blank());
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {stored && editing && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Tanggal belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl
                        error={errors.control?.[0]}
                        hint={
                            calendar.base_calendar
                                ? `Ikuti kalender dasar memakai jam kerja ${calendar.base_calendar.code} pada tanggal ini, termasuk liburnya.`
                                : undefined
                        }
                    >
                        {editing ? (
                            <div data-error-field="control">
                                <Select
                                    label="Pengaturan"
                                    required
                                    items={controls.map((control) => ({
                                        value: control,
                                        label: controlLabels[control],
                                    }))}
                                    value={form.control}
                                    onValueChange={(value) => {
                                        const control = controls.find(
                                            (item) => item === value,
                                        );
                                        if (control)
                                            setForm({ ...form, control });
                                    }}
                                    searchPlaceholder="Cari pengaturan"
                                    emptyMessage="Pengaturan tidak ditemukan."
                                    portalContainer={portalContainer}
                                />
                            </div>
                        ) : (
                            <Input
                                label="Pengaturan"
                                value={controlLabels[form.control]}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.note?.[0]}>
                        <Input
                            label="Catatan"
                            maxLength={255}
                            data-error-field="note"
                            placeholder="Misalnya Idul Fitri"
                            value={form.note}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, note: event.target.value })
                            }
                        />
                    </FormControl>
                </FormGrid>
                <div className="mt-4" data-error-field="lines">
                    <WorkingTimeLines
                        lines={form.lines}
                        onChange={(lines) => setForm({ ...form, lines })}
                        withWeekday={false}
                        editable={editing && !busy}
                        errors={errors}
                        portalContainer={portalContainer}
                    />
                    {form.control !== 'open' && form.lines.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                            Jam kerja ini disimpan tetapi tidak dipakai selama
                            tanggal ini tidak buka.
                        </p>
                    )}
                    {errors.lines?.map((text) => (
                        <p
                            key={text}
                            role="alert"
                            className="mt-2 text-sm text-destructive"
                        >
                            {text}
                        </p>
                    ))}
                </div>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

const resultText = (day: Day) =>
    !day.resolved.composed
        ? 'Belum disusun'
        : day.resolved.open
          ? 'Buka'
          : 'Tutup';

// Jam kerja satu bulan, satu baris per tanggal: pengaturan tersimpan kalender ini dan hasilnya setelah kalender dasar
// dibaca.
function CalendarDays({
    calendar,
    canManage,
}: {
    calendar: Calendar;
    canManage: boolean;
}): ReactNode {
    const [month, setMonth] = useState(() => monthOf(today()));
    const [openDay, setOpenDay] = useState<Day | null>(null);
    const [composing, setComposing] = useState(false);
    const dayRef = useRef<HTMLDivElement>(null);
    const composeRef = useRef<HTMLDivElement>(null);
    const range = monthRange(month);
    const days = useQuery(
        orpc.calendarDays.queryOptions({
            input: { params: { id: calendar.id }, query: range },
            select: (response) => response.body.data,
        }),
    );
    const refresh = () => void days.refetch();
    return (
        <>
            <div className="mb-2 flex flex-wrap items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    aria-label="Bulan sebelumnya"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                >
                    <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="min-w-36 text-center text-sm font-medium">
                    {monthLabel(month)}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label="Bulan berikutnya"
                    onClick={() => setMonth(shiftMonth(month, 1))}
                >
                    <ChevronRight aria-hidden="true" />
                </Button>
                {canManage && (
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setComposing(true)}
                    >
                        <CalendarCog aria-hidden="true" />
                        Susun jam kerja
                    </Button>
                )}
            </div>
            {days.isError ? (
                <p role="alert" className="text-sm text-destructive">
                    {errorText(days.error, 'Jam kerja belum bisa dimuat.')}{' '}
                    <Button type="button" variant="ghost" onClick={refresh}>
                        Coba lagi
                    </Button>
                </p>
            ) : (
                <DataTable
                    data={days.data ?? []}
                    getRowKey={(day) => day.date}
                    getRowLabel={(day) => displayDate(day.date)}
                    scrollMode="inline"
                    actionsPlacement="inline"
                    actions={[
                        { id: 'open', label: canManage ? 'Ubah' : 'Buka' },
                    ]}
                    onRowAction={(_, day) => setOpenDay(day)}
                    onRowClick={(day) => setOpenDay(day)}
                    emptyMessage={
                        days.isPending
                            ? 'Memuat jam kerja...'
                            : 'Tidak ada tanggal.'
                    }
                    columns={[
                        {
                            id: 'date',
                            header: 'Tanggal',
                            width: 120,
                            cell: (day) => (
                                <DataTableText>
                                    {displayDate(day.date)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'weekday',
                            header: 'Hari',
                            width: 90,
                            cell: (day) => (
                                <DataTableText>
                                    {weekdayNames[day.day_of_week]}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'control',
                            header: 'Pengaturan',
                            width: 170,
                            cell: (day) => (
                                <DataTableText>
                                    {day.stored
                                        ? `${controlLabels[day.stored.control]}${day.stored.composed ? '' : ' (diubah)'}`
                                        : 'Belum disusun'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'result',
                            header: 'Hasil',
                            width: 120,
                            cell: (day) => (
                                <Badge
                                    variant={
                                        day.resolved.open
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {resultText(day)}
                                </Badge>
                            ),
                        },
                        {
                            id: 'hours',
                            header: 'Jam kerja',
                            width: 200,
                            cell: (day) => (
                                <DataTableText>
                                    {day.resolved.intervals
                                        .map(intervalText)
                                        .join(', ') || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'note',
                            header: 'Catatan',
                            width: 200,
                            cell: (day) => (
                                <DataTableText>
                                    {day.resolved.note ?? ''}
                                </DataTableText>
                            ),
                        },
                    ]}
                />
            )}
            {openDay && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpenDay(null);
                    }}
                >
                    <PageDialogContent ref={dayRef} title="Jam kerja tanggal">
                        <DayCard
                            key={`${openDay.date}:${openDay.stored?.version ?? 0}`}
                            calendar={calendar}
                            day={openDay}
                            canManage={canManage}
                            portalContainer={dayRef}
                            onSaved={() => {
                                setOpenDay(null);
                                refresh();
                            }}
                            onClose={() => setOpenDay(null)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {composing && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setComposing(false);
                    }}
                >
                    <PageDialogContent ref={composeRef} title="Susun jam kerja">
                        <ComposeCard
                            calendar={calendar}
                            month={month}
                            portalContainer={composeRef}
                            onDone={() => {
                                setComposing(false);
                                refresh();
                            }}
                            onClose={() => setComposing(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

function CalendarCard({
    calendar,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    calendar: Calendar | null;
    canManage: boolean;
    portalContainer: RefObject<HTMLDivElement | null>;
    onSaved: (calendar: Calendar) => void;
    onClose: () => void;
}): ReactNode {
    // Kalender tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = calendar === null || canManage;
    const blank = () => ({
        code: calendar?.code ?? '',
        name: calendar?.name ?? '',
        base: calendar?.base_calendar ?? null,
        useBase: Boolean(calendar?.base_calendar),
    });
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const loadCalendars = useCalendarLoader(calendar?.id ?? null);
    const dirty = JSON.stringify(form) !== JSON.stringify(blank());
    usePageDialogRecord({
        recordTitle: calendar
            ? `${calendar.code} · ${calendar.name}`
            : 'Kalender baru',
        editing,
        dirty,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        if (form.useBase && !form.base) {
            setErrors({ base_calendar_id: ['Pilih kalender dasar.'] });
            setBusy(false);
            return;
        }
        const body = {
            code: form.code,
            name: form.name,
            base_calendar_id: form.useBase ? (form.base?.id ?? null) : null,
        };
        try {
            const { body: saved } = calendar
                ? await api.calendarUpdate({
                      params: { id: calendar.id },
                      body: { ...body, version: calendar.version },
                  })
                : await api.calendarCreate({ body });
            toast.success(
                calendar ? 'Kalender diperbarui.' : 'Kalender dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Kalender belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!calendar) return;
        if (
            !(await confirm({
                title: `Delete kalender ${calendar.code}?`,
                description:
                    'Jadwal yang memakai kalender ini tidak lagi mendapat jam kerja darinya.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.calendarDelete({
                params: { id: calendar.id },
                body: { version: calendar.version },
            });
            toast.success('Kalender dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Kalender belum dihapus.'));
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
                {editing && (
                    <>
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
                                if (!calendar) {
                                    onClose();
                                    return;
                                }
                                setForm(blank());
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {calendar && canManage && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Kalender belum disimpan"
            />
            <PageDialogBody className="py-3">
                <CollapsibleSectionGroup defaultValue={['general', 'days']}>
                    <CollapsibleSection
                        value="general"
                        title="Umum"
                        summary={
                            form.useBase && form.base
                                ? `Mengikuti ${form.base.code}`
                                : 'Tanpa kalender dasar'
                        }
                    >
                        <FormGrid>
                            <FormControl error={errors.code?.[0]}>
                                <Input
                                    label="Kode"
                                    required
                                    maxLength={50}
                                    data-error-field="code"
                                    value={form.code}
                                    readOnly={!editing}
                                    onChange={(event) =>
                                        setForm({
                                            ...form,
                                            code: event.target.value,
                                        })
                                    }
                                />
                            </FormControl>
                            <FormControl error={errors.name?.[0]}>
                                <Input
                                    label="Nama"
                                    required
                                    maxLength={150}
                                    data-error-field="name"
                                    value={form.name}
                                    readOnly={!editing}
                                    onChange={(event) =>
                                        setForm({
                                            ...form,
                                            name: event.target.value,
                                        })
                                    }
                                />
                            </FormControl>
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id="calendar-use-base"
                                    checked={form.useBase}
                                    disabled={!editing}
                                    onCheckedChange={(useBase) =>
                                        setForm({ ...form, useBase })
                                    }
                                />
                                <FieldLabel htmlFor="calendar-use-base">
                                    Pakai kalender dasar
                                </FieldLabel>
                            </Field>
                            {form.useBase && (
                                <ReferenceLookup
                                    label="Kalender dasar"
                                    value={form.base}
                                    onChange={(base) =>
                                        setForm({ ...form, base })
                                    }
                                    loadItems={loadCalendars}
                                    disabled={!editing || busy}
                                    error={errors.base_calendar_id?.[0]}
                                    hint="Tanggal yang diatur Ikuti kalender dasar memakai jam kerja kalender ini, misalnya libur nasional yang cukup diisi sekali."
                                    field="base_calendar_id"
                                    portalContainer={portalContainer}
                                />
                            )}
                        </FormGrid>
                    </CollapsibleSection>
                    <CollapsibleSection
                        value="days"
                        title="Jam kerja"
                        summary={calendar ? '' : 'Tersedia setelah disimpan'}
                    >
                        {calendar ? (
                            <CalendarDays
                                calendar={calendar}
                                canManage={canManage}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Jam kerja disusun dari template setelah kalender
                                disimpan, lewat Susun jam kerja.
                            </p>
                        )}
                    </CollapsibleSection>
                </CollapsibleSectionGroup>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function CalendarsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Calendar | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { base } = search;
    const loader = useCallback<ListLoader<Calendar>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.calendarList(
                {
                    query: {
                        q: query,
                        ...(base ? { base } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [base],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (calendar) => calendar.id,
    });
    const setSearch = (next: Partial<Search>) =>
        void navigate({
            search: (current) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...current,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace: true,
        });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Kalender"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari kalender',
                            placeholder: 'Cari kode atau nama...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(base),
                            controls: filterPanelId,
                        }}
                    >
                        {canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                filterPanel={
                    filtersOpen ? (
                        <FilterPane
                            id={filterPanelId}
                            title="Filter"
                            description="Hasil diperbarui otomatis saat filter diubah."
                            onClose={() => setFiltersOpen(false)}
                        >
                            <div className="p-4">
                                <FormGrid columns={1}>
                                    <FormControl>
                                        <Select
                                            label="Kalender dasar"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua kalender',
                                                },
                                                {
                                                    value: 'with',
                                                    label: 'Mengikuti kalender dasar',
                                                },
                                                {
                                                    value: 'without',
                                                    label: 'Tanpa kalender dasar',
                                                },
                                            ]}
                                            value={base ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    base:
                                                        value === 'with' ||
                                                        value === 'without'
                                                            ? value
                                                            : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari pilihan"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} kalender dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(calendar) => calendar.id}
                    getRowLabel={(calendar) => calendar.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, calendar) => setOpen(calendar)}
                    onRowClick={(calendar) => setOpen(calendar)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kalender. Pilih Baru, lalu susun jam kerjanya dari template jam kerja.'
                            : 'Belum ada kalender.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (calendar) => (
                                <DataTableText>{calendar.code}</DataTableText>
                            ),
                            sortValue: (calendar) => calendar.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 260,
                            cell: (calendar) => (
                                <DataTableText>{calendar.name}</DataTableText>
                            ),
                            sortValue: (calendar) => calendar.name,
                        },
                        {
                            id: 'base_calendar',
                            header: 'Kalender dasar',
                            width: 240,
                            cell: (calendar) => (
                                <DataTableText>
                                    {calendar.base_calendar
                                        ? `${calendar.base_calendar.code} · ${calendar.base_calendar.name}`
                                        : '—'}
                                </DataTableText>
                            ),
                            sortValue: (calendar) =>
                                calendar.base_calendar?.code ?? '',
                        },
                    ]}
                />
            </ListPageLayout>
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent ref={contentRef} title="Kalender">
                        <CalendarCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            calendar={open === 'new' ? null : open}
                            canManage={canManage}
                            portalContainer={contentRef}
                            onSaved={(calendar) => {
                                setOpen(calendar);
                                list.reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                list.reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/calendar/calendars',
    layout: 'app',
    title: 'Kalender',
    validateSearch: searchSchema,
    component: CalendarsPage,
});
