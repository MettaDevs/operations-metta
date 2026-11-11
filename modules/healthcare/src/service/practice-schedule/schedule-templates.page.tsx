import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { Field, FieldLabel } from '@operations-metta/ui/field';
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
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
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
import { dayNames, holidayDay } from './practice-schedule.days.ts';

// Template jadwal mingguan satu section: kolom Senin sampai Minggu ditambah Hari libur, setiap kolom berisi nakes dan
// sesinya. "Generate jadwal" di layar Jadwal praktik menyusun jadwal bertanggal dari template ini.

const route = getRouteApi('/_app/healthcare/service/schedule-templates');
const NONE = 'none';
type Template = ApiBody<'healthcareScheduleTemplateList'>['data'][number];
type Metadata = ApiBody<'healthcarePracticeScheduleMetadata'>;
type Practitioner =
    ApiBody<'healthcarePracticeSchedulePractitioners'>['data'][number];
type Errors = Record<string, string[]>;
const searchSchema = z.object({
    section: z.string().max(100).optional(),
});
const days = [1, 2, 3, 4, 5, 6, 7, holidayDay];

const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const capacityText = (capacity: number | null) =>
    capacity === null ? 'Tanpa batas' : `Kapasitas ${capacity}`;

function TemplateCard({
    template,
    sectionId,
    day,
    metadata,
    portalContainer,
    onSaved,
    onClose,
}: {
    template: Template | null;
    sectionId: string;
    day: number;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (template: Template) => void;
    onClose: () => void;
}): ReactNode {
    const { permissions } = metadata;
    const editing = template === null ? permissions.create : permissions.update;
    const blank = {
        practitioner: template
            ? {
                  id: template.practitioner_id,
                  name: template.practitioner_name,
                  profession: '',
              }
            : null,
        day: String(template?.day ?? day),
        session_id: template?.session_id ?? null,
        capacity:
            template?.capacity === null || template === null
                ? ''
                : String(template.capacity),
        calendar_id: template?.calendar_id ?? NONE,
        valid_from: template?.valid_from ?? today(),
        valid_to: template?.valid_to ?? '',
        // Template baru langsung aktif.
        is_active: template?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: template
            ? `${template.practitioner_name} · ${dayNames[template.day] ?? ''}`
            : 'Template baru',
        editing,
    });
    const loader = useCallback<LookupLoader<Practitioner>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePracticeSchedulePractitioners(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    // Sesi nonaktif tetap terbaca bila sudah dipakai template ini.
    const sessions = metadata.sessions.filter(
        (session) => session.is_active || session.id === template?.session_id,
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const capacity = form.capacity.trim();
        const body = {
            practitioner_id: form.practitioner?.id ?? '',
            section_id: sectionId,
            day: Number(form.day),
            session_id: form.session_id ?? '',
            capacity: capacity === '' ? null : Number(capacity),
            calendar_id: form.calendar_id === NONE ? null : form.calendar_id,
            valid_from: form.valid_from,
            valid_to: form.valid_to || null,
            is_active: form.is_active,
        };
        try {
            const { body: saved } = template
                ? await api.healthcareScheduleTemplateUpdate({
                      params: { id: template.id },
                      body: { ...body, version: template.version },
                  })
                : await api.healthcareScheduleTemplateCreate({ body });
            toast.success(
                template ? 'Template diperbarui.' : 'Template dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Template belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!template) return;
        if (
            !(await confirm({
                title: 'Delete template ini?',
                description:
                    'Generate jadwal berikutnya tidak lagi membuat jadwal dari template ini. Jadwal yang belum diubah dan belum ada pasien ikut dihapus saat generate; yang lain tetap.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareScheduleTemplateDelete({
                params: { id: template.id },
                body: { version: template.version },
            });
            toast.success('Template dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Template belum dihapus.'));
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
                                if (!template) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {template && permissions.delete && (
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
                operation="Template belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.practitioner_id?.[0]}>
                        {editing ? (
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
                                columns={[
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        cell: (item) => item.name,
                                    },
                                ]}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        ) : (
                            <Input
                                label="Nakes"
                                value={form.practitioner?.name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.day?.[0]}>
                        {editing ? (
                            <Select
                                label="Hari"
                                required
                                items={days.map((value) => ({
                                    value: String(value),
                                    label: dayNames[value] ?? '',
                                }))}
                                value={form.day}
                                onValueChange={(value) =>
                                    setForm({ ...form, day: value ?? form.day })
                                }
                                searchPlaceholder="Cari hari"
                                emptyMessage="Hari tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Hari"
                                value={dayNames[Number(form.day)] ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.session_id?.[0]}>
                        {editing ? (
                            <Select
                                label="Sesi"
                                required
                                items={sessions.map((session) => ({
                                    value: session.id,
                                    label: `${session.name} (${session.start_time}–${session.end_time})`,
                                }))}
                                value={form.session_id}
                                onValueChange={(value) =>
                                    setForm({ ...form, session_id: value })
                                }
                                placeholder="Pilih sesi"
                                searchPlaceholder="Cari sesi"
                                emptyMessage="Belum ada sesi. Tambahkan di layar Sesi praktik."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Sesi"
                                value={
                                    sessions.find(
                                        (session) =>
                                            session.id === form.session_id,
                                    )?.name ?? ''
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.capacity?.[0]}
                        hint="Jumlah pasien paling banyak di sesi ini. Kosongkan bila tanpa batas."
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
                    <FormControl
                        error={errors.calendar_id?.[0]}
                        hint="Pada tanggal yang ditutup kalender ini, jadwal hari itu dibatalkan karena libur. Template Hari libur hanya dipakai pada tanggal itu."
                    >
                        {editing ? (
                            <Select
                                label="Kalender libur"
                                required={Number(form.day) === holidayDay}
                                items={[
                                    { value: NONE, label: 'Tanpa kalender' },
                                    ...metadata.calendars.map((calendar) => ({
                                        value: calendar.id,
                                        label: `${calendar.code} ${calendar.name}`,
                                    })),
                                ]}
                                value={form.calendar_id}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        calendar_id: value ?? NONE,
                                    })
                                }
                                searchPlaceholder="Cari kalender"
                                emptyMessage="Kalender tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Kalender libur"
                                value={
                                    metadata.calendars.find(
                                        (calendar) =>
                                            calendar.id === form.calendar_id,
                                    )?.name ?? 'Tanpa kalender'
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.valid_from?.[0]}>
                        <DatePicker
                            label="Berlaku mulai"
                            required
                            data-error-field="valid_from"
                            value={form.valid_from}
                            readOnly={!editing}
                            onValueChange={(valid_from) =>
                                setForm({ ...form, valid_from })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl
                        error={errors.valid_to?.[0]}
                        hint="Kosongkan bila template berlaku terus."
                    >
                        <DatePicker
                            label="Berlaku sampai"
                            data-error-field="valid_to"
                            value={form.valid_to}
                            readOnly={!editing}
                            onValueChange={(valid_to) =>
                                setForm({ ...form, valid_to })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="template-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="template-active">Aktif</FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function ScheduleTemplatesPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcarePracticeScheduleMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const sectionId =
        metadata.sections.find((section) => section.id === search.section)
            ?.id ?? null;
    const [open, setOpen] = useState<
        { template: Template } | { day: number } | null
    >(null);
    const templates = useQuery({
        ...orpc.healthcareScheduleTemplateList.queryOptions({
            input: { query: { section_id: sectionId ?? '' } },
            select: (response) => response.body.data,
        }),
        enabled: sectionId !== null,
    });
    const refresh = () => void templates.refetch();

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <RecordActionBar title="Template jadwal" />
            <div className="max-w-md px-1">
                <FormControl>
                    <Select
                        label="Section"
                        items={metadata.sections.map((section) => ({
                            value: section.id,
                            label: `${section.name} · ${section.operating_unit_name}`,
                        }))}
                        value={sectionId}
                        onValueChange={(value) =>
                            void navigate({
                                search: value ? { section: value } : {},
                                replace: true,
                            })
                        }
                        placeholder="Pilih section"
                        searchPlaceholder="Cari section"
                        emptyMessage="Belum ada section aktif."
                    />
                </FormControl>
            </div>
            {sectionId === null ? (
                <p className="px-1 text-sm text-muted-foreground">
                    Pilih section untuk melihat dan menyusun template
                    mingguannya.
                </p>
            ) : templates.isError ? (
                <p role="alert" className="px-1 text-sm text-destructive">
                    {errorText(templates.error, 'Template belum bisa dimuat.')}{' '}
                    <Button type="button" variant="ghost" onClick={refresh}>
                        Coba lagi
                    </Button>
                </p>
            ) : (
                <div className="grid min-h-0 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
                    {days.map((day) => {
                        const entries = (templates.data ?? []).filter(
                            (template) => template.day === day,
                        );
                        return (
                            <Card key={day}>
                                <CardHeader>
                                    <CardTitle>{dayNames[day]}</CardTitle>
                                    {metadata.permissions.create && (
                                        <CardAction>
                                            <ActionButton
                                                action="add"
                                                type="button"
                                                aria-label={`Tambah template ${dayNames[day] ?? ''}`}
                                                onClick={() => setOpen({ day })}
                                            />
                                        </CardAction>
                                    )}
                                </CardHeader>
                                <CardContent className="flex flex-col gap-1">
                                    {templates.isPending ? (
                                        <p className="text-sm text-muted-foreground">
                                            Memuat...
                                        </p>
                                    ) : entries.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            {day === holidayDay
                                                ? 'Tidak ada jadwal khusus hari libur.'
                                                : 'Belum ada jadwal.'}
                                        </p>
                                    ) : (
                                        entries.map((template) => (
                                            <Button
                                                key={template.id}
                                                type="button"
                                                variant="ghost"
                                                className="h-auto flex-col items-start gap-0.5 px-2 py-1.5 text-left whitespace-normal"
                                                onClick={() =>
                                                    setOpen({ template })
                                                }
                                            >
                                                <span className="text-sm font-medium">
                                                    {template.practitioner_name}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {template.session_name}{' '}
                                                    {template.start_time}–
                                                    {template.end_time} ·{' '}
                                                    {capacityText(
                                                        template.capacity,
                                                    )}
                                                </span>
                                                {(template.valid_to !== null ||
                                                    !template.is_active) && (
                                                    <span className="flex flex-wrap gap-1">
                                                        {!template.is_active && (
                                                            <Badge variant="outline">
                                                                Nonaktif
                                                            </Badge>
                                                        )}
                                                        {template.valid_to && (
                                                            <Badge variant="outline">
                                                                s.d.{' '}
                                                                {displayDate(
                                                                    template.valid_to,
                                                                )}
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
            {open && sectionId && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent ref={contentRef} title="Template jadwal">
                        <TemplateCard
                            key={
                                'template' in open
                                    ? `${open.template.id}:${open.template.version}`
                                    : `new:${open.day}`
                            }
                            template={'template' in open ? open.template : null}
                            sectionId={sectionId}
                            day={
                                'template' in open
                                    ? open.template.day
                                    : open.day
                            }
                            metadata={metadata}
                            portalContainer={contentRef}
                            onSaved={(template) => {
                                setOpen({ template });
                                refresh();
                            }}
                            onClose={() => {
                                setOpen(null);
                                refresh();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/service/schedule-templates',
    layout: 'app',
    title: 'Template jadwal',
    validateSearch: searchSchema,
    component: ScheduleTemplatesPage,
});
