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
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';
import type { PaymentTermsRow } from './payment-terms-lookup.tsx';

// Termin pembayaran (Payment Terms di BC): berapa hari sesudah tanggal faktur vendor sebuah tagihan jatuh tempo.

const route = getRouteApi('/_app/sysadmin/purchasing/payment-terms');
type Errors = Record<string, string[]>;

function PaymentTermsCard({
    terms,
    canManage,
    onSaved,
    onDeleted,
    onClose,
}: {
    terms: PaymentTermsRow | null;
    canManage: boolean;
    onSaved: (terms: PaymentTermsRow) => void;
    onDeleted: () => void;
    onClose: () => void;
}): ReactNode {
    const editing = terms === null || canManage;
    const blank = {
        code: terms?.code ?? '',
        name: terms?.name ?? '',
        due_days: terms ? String(terms.due_days) : '30',
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: terms ? `${terms.code} ${terms.name}` : 'Termin baru',
        editing,
        dirty: JSON.stringify(form) !== JSON.stringify(blank),
    });

    const failed = (caught: unknown, operation: string) => {
        if (caught instanceof ApiError && caught.status === 422)
            setErrors(caught.errors);
        else setMessage(errorText(caught, operation));
    };

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = terms
                ? await api.purchasingPaymentTermsUpdate({
                      params: { id: terms.id },
                      body: { ...form, version: terms.version },
                  })
                : await api.purchasingPaymentTermsCreate({ body: form });
            toast.success(terms ? 'Termin diperbarui.' : 'Termin dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            failed(caught, 'Termin belum disimpan.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!terms) return;
        if (
            !(await confirm({
                title: `Delete termin ${terms.code}?`,
                description:
                    'Termin yang dihapus tidak bisa dipilih lagi di vendor dan dokumen baru.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setMessage(null);
        try {
            await api.purchasingPaymentTermsDelete({
                params: { id: terms.id },
                body: { version: terms.version },
            });
            toast.success('Termin dihapus.');
            onDeleted();
        } catch (caught) {
            failed(caught, 'Termin belum dihapus.');
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
                                if (!terms) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {terms && canManage && (
                    <ActionButton
                        action="archive"
                        type="button"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Termin belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl
                        error={errors.code?.[0]}
                        hint="Kode pendek yang dipilih di vendor dan dokumen, misalnya 30H atau TUNAI."
                    >
                        <Input
                            label="Kode"
                            required
                            maxLength={10}
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
                            label="Keterangan"
                            required
                            maxLength={100}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.due_days?.[0]}
                        hint="Jatuh tempo faktur = tanggal faktur vendor ditambah jumlah hari ini. Isi 0 untuk bayar tunai."
                    >
                        <Input
                            label="Jumlah hari sampai jatuh tempo"
                            required
                            inputMode="numeric"
                            data-error-field="due_days"
                            value={form.due_days}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    due_days: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function PaymentTermsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<PaymentTermsRow | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<PaymentTermsRow>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingPaymentTermsList(
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
        getKey: (terms) => terms.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Termin pembayaran"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari termin',
                            placeholder: 'Cari kode atau keterangan...',
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
                        {list.items.length} termin dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(terms) => terms.id}
                    getRowLabel={(terms) => terms.code}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, terms) => setOpen(terms)}
                    onRowClick={(terms) => setOpen(terms)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada termin pembayaran. Pilih Baru untuk menambahkan.'
                            : 'Belum ada termin pembayaran.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 120,
                            cell: (terms) => (
                                <DataTableText>{terms.code}</DataTableText>
                            ),
                            sortValue: (terms) => terms.code,
                        },
                        {
                            id: 'name',
                            header: 'Keterangan',
                            width: 280,
                            cell: (terms) => (
                                <DataTableText>{terms.name}</DataTableText>
                            ),
                            sortValue: (terms) => terms.name,
                        },
                        {
                            id: 'due_days',
                            header: 'Hari',
                            width: 100,
                            align: 'right',
                            cell: (terms) => (
                                <DataTableText>{terms.due_days}</DataTableText>
                            ),
                            sortValue: (terms) => terms.due_days,
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
                    <PageDialogContent title="Termin pembayaran">
                        <PaymentTermsCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            terms={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(terms) => {
                                setOpen(terms);
                                list.reload();
                            }}
                            onDeleted={() => {
                                setOpen(null);
                                list.reload();
                            }}
                            onClose={() => setOpen(null)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/purchasing/payment-terms',
    layout: 'app',
    title: 'Termin pembayaran',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: PaymentTermsPage,
});
