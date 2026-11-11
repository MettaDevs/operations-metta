import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
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
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
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
    type ApiBody,
} from '../../platform/shell/index.ts';
import {
    intervalText,
    linesOf,
    weekdayNames,
    WorkingTimeLines,
} from './working-time-lines.tsx';

// Template jam kerja, pola "Working time templates" F&O: jam kerja untuk setiap hari dalam seminggu. Kalender memakainya
// lewat Susun jam kerja; hari tanpa jam kerja menjadi tutup.

const route = getRouteApi('/_app/sysadmin/calendar/working-time-templates');
const searchSchema = z.object({ q: z.string().max(200).optional() });
type Template = ApiBody<'workingTimeTemplateList'>['data'][number];
type Errors = Record<string, string[]>;

// Ringkasan seminggu untuk daftar: hari kerja beserta jamnya, misalnya "Senin 08:00–16:00".
const weekSummary = (template: Template) =>
    weekdayNames
        .flatMap((name, day) => {
            const lines = template.lines.filter(
                (line) => line.day_of_week === day,
            );
            return lines.length
                ? [`${name} ${lines.map(intervalText).join(', ')}`]
                : [];
        })
        .join(' · ') || 'Setiap hari tutup';

function TemplateCard({
    template,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    template: Template | null;
    canManage: boolean;
    portalContainer: RefObject<HTMLDivElement | null>;
    onSaved: (template: Template) => void;
    onClose: () => void;
}): ReactNode {
    // Template tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = template === null || canManage;
    const blank = () => ({
        code: template?.code ?? '',
        name: template?.name ?? '',
        lines: linesOf(template?.lines ?? []),
    });
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: template
            ? `${template.code} · ${template.name}`
            : 'Template jam kerja baru',
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            code: form.code,
            name: form.name,
            lines: form.lines.map(({ key: _key, ...line }) => line),
        };
        try {
            const { body: saved } = template
                ? await api.workingTimeTemplateUpdate({
                      params: { id: template.id },
                      body: { ...body, version: template.version },
                  })
                : await api.workingTimeTemplateCreate({ body });
            toast.success(
                template
                    ? 'Template jam kerja diperbarui.'
                    : 'Template jam kerja dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Template jam kerja belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!template) return;
        if (
            !(await confirm({
                title: `Delete template ${template.code}?`,
                description:
                    'Jam kerja yang sudah disusun ke kalender dari template ini tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.workingTimeTemplateDelete({
                params: { id: template.id },
                body: { version: template.version },
            });
            toast.success('Template jam kerja dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Template jam kerja belum dihapus.'));
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
                                setForm(blank());
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {template && canManage && (
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
                operation="Template jam kerja belum disimpan"
            />
            <PageDialogBody className="py-3">
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
                                setForm({ ...form, code: event.target.value })
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
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                </FormGrid>
                <div className="mt-4" data-error-field="lines">
                    <WorkingTimeLines
                        lines={form.lines}
                        onChange={(lines) => setForm({ ...form, lines })}
                        withWeekday
                        editable={editing && !busy}
                        errors={errors}
                        portalContainer={portalContainer}
                    />
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

function WorkingTimeTemplatesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Template | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<Template>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.workingTimeTemplateList(
                {
                    query: {
                        q: query,
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
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (template) => template.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Template jam kerja"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari template jam kerja',
                            placeholder: 'Cari kode atau nama...',
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
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} template dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(template) => template.id}
                    getRowLabel={(template) => template.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, template) => setOpen(template)}
                    onRowClick={(template) => setOpen(template)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada template jam kerja. Pilih Baru untuk mengisi jam kerja seminggu.'
                            : 'Belum ada template jam kerja.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (template) => (
                                <DataTableText>{template.code}</DataTableText>
                            ),
                            sortValue: (template) => template.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 220,
                            cell: (template) => (
                                <DataTableText>{template.name}</DataTableText>
                            ),
                            sortValue: (template) => template.name,
                        },
                        {
                            id: 'week',
                            header: 'Jam kerja',
                            width: 420,
                            cell: (template) => (
                                <DataTableText>
                                    {weekSummary(template)}
                                </DataTableText>
                            ),
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
                    <PageDialogContent
                        ref={contentRef}
                        title="Template jam kerja"
                    >
                        <TemplateCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            template={open === 'new' ? null : open}
                            canManage={canManage}
                            portalContainer={contentRef}
                            onSaved={(template) => {
                                setOpen(template);
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
    path: '/sysadmin/calendar/working-time-templates',
    layout: 'app',
    title: 'Template jam kerja',
    validateSearch: searchSchema,
    component: WorkingTimeTemplatesPage,
});
