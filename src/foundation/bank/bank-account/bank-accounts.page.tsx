import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
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
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';

// Rekening bank (Bank Account BC): rekening milik legal entity yang dipilih saat membayar vendor.

const route = getRouteApi('/_app/sysadmin/bank/bank-accounts');
type BankAccountRow = ApiBody<'bankAccountList'>['data'][number];
type Errors = Record<string, string[]>;
type Currencies = { local: string; foreign: string[] };

function formOf(account: BankAccountRow | null) {
    return {
        code: account?.code ?? '',
        name: account?.name ?? '',
        bank_name: account?.bank_name ?? '',
        account_number: account?.account_number ?? '',
        currency_code: account?.currency_code ?? '',
        blocked: account?.blocked ?? false,
    };
}

function BankAccountCard({
    account,
    canManage,
    currencies,
    onSaved,
    onDeleted,
    onClose,
}: {
    account: BankAccountRow | null;
    canManage: boolean;
    currencies: Currencies;
    onSaved: (account: BankAccountRow) => void;
    onDeleted: () => void;
    onClose: () => void;
}): ReactNode {
    const editing = account === null || canManage;
    const blank = formOf(account);
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLFormElement>(null);
    const blockedId = useId();
    const localLabel = `${currencies.local} (mata uang lokal)`;
    usePageDialogRecord({
        recordTitle: account
            ? `${account.code} ${account.name}`
            : 'Rekening baru',
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
        const body = { ...form, currency_code: form.currency_code || null };
        try {
            const { body: saved } = account
                ? await api.bankAccountUpdate({
                      params: { id: account.id },
                      body: { ...body, version: account.version },
                  })
                : await api.bankAccountCreate({ body });
            toast.success(
                account ? 'Rekening diperbarui.' : 'Rekening dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            failed(caught, 'Rekening belum disimpan.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!account) return;
        if (
            !(await confirm({
                title: `Delete rekening ${account.code}?`,
                description:
                    'Rekening yang dihapus tidak bisa dipilih lagi saat membayar vendor.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setMessage(null);
        try {
            await api.bankAccountDelete({
                params: { id: account.id },
                body: { version: account.version },
            });
            toast.success('Rekening dihapus.');
            onDeleted();
        } catch (caught) {
            failed(caught, 'Rekening belum dihapus.');
        } finally {
            setBusy(false);
        }
    };

    const text = (
        field: 'code' | 'name' | 'bank_name' | 'account_number',
        label: string,
        maxLength: number,
        hint?: string,
    ) => (
        <FormControl error={errors[field]?.[0]} hint={hint}>
            <Input
                label={label}
                required
                maxLength={maxLength}
                data-error-field={field}
                value={form[field]}
                readOnly={!editing}
                onChange={(event) =>
                    setForm({ ...form, [field]: event.target.value })
                }
            />
        </FormControl>
    );

    return (
        <form
            ref={portalContainer}
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
                                if (!account) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {account && canManage && (
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
                operation="Rekening belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    {text(
                        'code',
                        'Kode',
                        20,
                        'Kode pendek yang dipilih saat membayar, misalnya BCA-OPS.',
                    )}
                    {text('name', 'Nama', 100)}
                    {text('bank_name', 'Nama bank', 100)}
                    {text('account_number', 'Nomor rekening', 30)}
                    <FormControl
                        error={errors.currency_code?.[0]}
                        hint="Kosongkan untuk rekening dalam mata uang lokal. Pembayaran ke vendor hanya memakai rekening dalam mata uang lokal."
                        data-error-field="currency_code"
                    >
                        {editing ? (
                            <Select
                                label="Mata uang"
                                items={[
                                    { value: '', label: localLabel },
                                    ...currencies.foreign.map((code) => ({
                                        value: code,
                                        label: code,
                                    })),
                                ]}
                                value={form.currency_code}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        currency_code: value ?? '',
                                    })
                                }
                                searchPlaceholder="Cari mata uang"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Mata uang"
                                value={form.currency_code || localLabel}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl hint="Rekening yang diblokir tidak bisa dipilih atau diposting di pembayaran. Pembayaran yang sudah memakainya tetap tersimpan.">
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id={blockedId}
                                checked={form.blocked}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, blocked: checked })
                                }
                            />
                            <FieldLabel
                                htmlFor={blockedId}
                                className="font-normal"
                            >
                                Diblokir
                            </FieldLabel>
                        </Field>
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function BankAccountsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<BankAccountRow | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [currencies, setCurrencies] = useState<Currencies>({
        local: '',
        foreign: [],
    });
    const loader = useCallback<ListLoader<BankAccountRow>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.bankAccountList(
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
            setCurrencies({
                local: body.local_currency,
                foreign: body.currencies,
            });
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (account) => account.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Rekening bank"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari rekening',
                            placeholder: 'Cari kode, nama, bank, atau nomor...',
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
                        {list.items.length} rekening dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(account) => account.id}
                    getRowLabel={(account) => account.code}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, account) => setOpen(account)}
                    onRowClick={(account) => setOpen(account)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada rekening bank. Pilih Baru untuk menambahkan.'
                            : 'Belum ada rekening bank.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (account) => (
                                <DataTableText>{account.code}</DataTableText>
                            ),
                            sortValue: (account) => account.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 220,
                            cell: (account) => (
                                <DataTableText>{account.name}</DataTableText>
                            ),
                            sortValue: (account) => account.name,
                        },
                        {
                            id: 'bank_name',
                            header: 'Bank',
                            width: 160,
                            cell: (account) => (
                                <DataTableText>
                                    {account.bank_name}
                                </DataTableText>
                            ),
                            sortValue: (account) => account.bank_name,
                        },
                        {
                            id: 'account_number',
                            header: 'Nomor rekening',
                            width: 180,
                            cell: (account) => (
                                <DataTableText>
                                    {account.account_number}
                                </DataTableText>
                            ),
                            sortValue: (account) => account.account_number,
                        },
                        {
                            id: 'currency_code',
                            header: 'Mata uang',
                            width: 110,
                            cell: (account) => (
                                <DataTableText>
                                    {account.currency_code ?? currencies.local}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'blocked',
                            header: 'Status',
                            width: 110,
                            cell: (account) => (
                                <DataTableText>
                                    {account.blocked ? 'Diblokir' : 'Aktif'}
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
                    <PageDialogContent title="Rekening bank">
                        <BankAccountCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            account={open === 'new' ? null : open}
                            canManage={canManage}
                            currencies={currencies}
                            onSaved={(account) => {
                                setOpen(account);
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
    path: '/sysadmin/bank/bank-accounts',
    layout: 'app',
    title: 'Rekening bank',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: BankAccountsPage,
});
