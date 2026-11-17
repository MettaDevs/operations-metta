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
import { Textarea } from '@operations-metta/ui/textarea';
import { useQuery } from '@tanstack/react-query';
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
    type ApiBody,
} from '../shell/index.ts';

type Letterhead = ApiBody<'letterheadList'>['data'][number];

// Sys Admin › Kop surat: identitas cetak per legal entity dan unit kerja. Dokumen memakai kop unit kerja yang
// menerbitkannya, kalau tidak ada kop legal entity-nya. Alamat dan telepon diambil dari buku alamat organisasi.

const formOf = (row: Letterhead) => ({
    display_name: row.display_name ?? '',
    parent_lines: row.parent_lines.join('\n'),
    tax_id: row.tax_id ?? '',
    registration_id: row.registration_id ?? '',
    footer_text: row.footer_text ?? '',
});

function LetterheadCard({
    row,
    canManage,
    onSaved,
}: {
    row: Letterhead;
    canManage: boolean;
    onSaved: () => void;
}): ReactNode {
    const [form, setForm] = useState(() => formOf(row));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(formOf(row));
    usePageDialogRecord({
        recordTitle: row.organization_name,
        editing: canManage,
        dirty,
    });
    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.letterheadSave({
                params: { id: row.organization_id },
                body: form,
            });
            toast.success(body.message);
            onSaved();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Kop surat belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const field = (
        key: 'display_name' | 'tax_id' | 'registration_id',
        label: string,
        maxLength: number,
        hint?: string,
    ) => (
        <FormControl error={errors[key]?.[0]} hint={hint}>
            <Input
                label={label}
                maxLength={maxLength}
                data-error-field={key}
                value={form[key]}
                readOnly={!canManage}
                onChange={(event) =>
                    setForm({ ...form, [key]: event.target.value })
                }
            />
        </FormControl>
    );
    const area = (
        key: 'parent_lines' | 'footer_text',
        label: string,
        hint: string,
    ) => (
        <FormControl error={errors[key]?.[0]} hint={hint}>
            <Textarea
                label={label}
                maxLength={1000}
                data-error-field={key}
                value={form[key]}
                readOnly={!canManage}
                onChange={(event) =>
                    setForm({ ...form, [key]: event.target.value })
                }
            />
        </FormControl>
    );
    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void save();
            }}
        >
            <PageDialogToolbar>
                {canManage && (
                    <ActionButton
                        action="save"
                        type="submit"
                        disabled={busy}
                        pending={busy}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Kop surat belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    {field(
                        'display_name',
                        'Nama di kop',
                        200,
                        `Kosong berarti nama organisasi: ${row.organization_name}.`,
                    )}
                    {area(
                        'parent_lines',
                        'Baris induk',
                        'Satu baris per tingkat di atas nama, misalnya yayasan atau dinas.',
                    )}
                    {field('tax_id', 'NPWP', 60)}
                    {field('registration_id', 'Nomor izin', 60)}
                    {area(
                        'footer_text',
                        'Catatan kaki',
                        'Dicetak di bagian bawah dokumen yang layout-nya memakainya.',
                    )}
                </FormGrid>
            </PageDialogBody>
        </form>
    );
}

function LetterheadsPage(): ReactNode {
    const listed = useQuery(
        orpc.letterheadList.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [open, setOpen] = useState<string | null>(null);
    const rows = listed.data?.data ?? [];
    const selected = rows.find((row) => row.organization_id === open);
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <>
            <ListPageLayout
                header={<RecordActionBar title="Kop surat" />}
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {rows.length} organisasi
                    </p>
                }
            >
                <DataTable
                    data={rows}
                    getRowKey={(row) => row.organization_id}
                    getRowLabel={(row) => row.organization_name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row.organization_id)}
                    onRowClick={(row) => setOpen(row.organization_id)}
                    emptyMessage="Belum ada legal entity atau unit kerja."
                    columns={[
                        {
                            id: 'organization',
                            header: 'Organisasi',
                            width: 240,
                            cell: (row) => text(row.organization_name),
                        },
                        {
                            id: 'classification',
                            header: 'Jenis',
                            width: 140,
                            cell: (row) =>
                                text(
                                    row.classification === 'legal_entity'
                                        ? 'Legal entity'
                                        : 'Unit kerja',
                                ),
                        },
                        {
                            id: 'display',
                            header: 'Nama di kop',
                            width: 240,
                            cell: (row) => text(row.display_name ?? ''),
                        },
                        {
                            id: 'registration',
                            header: 'Nomor izin',
                            width: 160,
                            cell: (row) => text(row.registration_id ?? ''),
                        },
                    ]}
                />
            </ListPageLayout>
            {selected && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Kop surat">
                        <LetterheadCard
                            key={selected.organization_id}
                            row={selected}
                            canManage={listed.data?.can_manage ?? false}
                            onSaved={() => void listed.refetch()}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/reporting/letterheads',
    layout: 'app',
    title: 'Kop surat',
    component: LetterheadsPage,
});
