import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    newDraftKey,
    type ApiBody,
} from '../shell/index.ts';

export type Identification =
    ApiBody<'partyShow'>['data']['identifications'][number];
type IdentificationType = { code: string; name: string };
/** Nomor identitas party baru, dikirim bersama party dalam satu transaksi. */
export type DraftIdentification = {
    key: string;
    type_code: string;
    number: string;
};
type Errors = Record<string, string[]>;

function failure(caught: unknown, fallback: string) {
    return caught instanceof ApiError && caught.status === 422
        ? { errors: caught.errors, message: null }
        : { errors: {}, message: errorText(caught, fallback) };
}

function IdentificationDialog({
    types,
    taken,
    editing,
    draftMode,
    onClose,
    onSave,
}: {
    types: IdentificationType[];
    taken: string[];
    editing: { type_code: string; number: string; masked: boolean } | 'new';
    draftMode: boolean;
    onClose: () => void;
    onSave: (value: { type_code: string; number: string }) => Promise<void>;
}) {
    const available = types.filter(
        (type) =>
            !taken.includes(type.code) ||
            (editing !== 'new' && editing.type_code === type.code),
    );
    const contentRef = useRef<HTMLDivElement>(null);
    const [typeCode, setTypeCode] = useState(
        editing === 'new' ? (available[0]?.code ?? '') : editing.type_code,
    );
    // Nomor yang disamarkan tidak pernah dikirim balik: pengguna mengetik nomor lengkap untuk menggantinya.
    const [number, setNumber] = useState(
        editing === 'new' || editing.masked ? '' : editing.number,
    );
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const typeName =
        types.find((type) => type.code === typeCode)?.name ?? 'Nomor identitas';

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            if (!number.trim())
                throw new ApiError(422, { errors: { number: ['Isi nomor.'] } });
            await onSave({ type_code: typeCode, number });
        } catch (caught) {
            const failed = failure(caught, 'Nomor identitas belum disimpan.');
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <PageDialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title="Nomor identitas"
                recordTitle={typeName}
                editing
                busy={busy}
            >
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void submit();
                    }}
                >
                    <PageDialogToolbar>
                        {draftMode ? (
                            editing === 'new' ? (
                                <ActionButton action="add" type="submit" />
                            ) : (
                                <Button type="submit" variant="ghost">
                                    <Check aria-hidden="true" />
                                    Selesai
                                </Button>
                            )
                        ) : (
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                        )}
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
                        operation="Nomor identitas belum disimpan"
                    />
                    <PageDialogBody className="py-3">
                        <FormGrid>
                            <FormControl
                                error={errors.type_code?.[0]}
                                data-error-field="type_code"
                            >
                                {editing === 'new' ? (
                                    <Select
                                        label="Jenis"
                                        required
                                        items={available.map((type) => ({
                                            value: type.code,
                                            label: type.name,
                                        }))}
                                        value={typeCode || null}
                                        onValueChange={(value) =>
                                            value && setTypeCode(value)
                                        }
                                        searchPlaceholder="Cari jenis"
                                        emptyMessage="Jenis tidak ditemukan."
                                        portalContainer={contentRef}
                                    />
                                ) : (
                                    <Input
                                        label="Jenis"
                                        value={typeName}
                                        readOnly
                                    />
                                )}
                            </FormControl>
                            <FormControl
                                error={errors.number?.[0]}
                                hint={
                                    editing !== 'new' && editing.masked
                                        ? 'Nomor tersimpan disamarkan. Ketik nomor lengkap yang baru untuk menggantinya.'
                                        : undefined
                                }
                            >
                                <Input
                                    label="Nomor"
                                    required
                                    autoComplete="off"
                                    data-error-field="number"
                                    value={number}
                                    onChange={(event) =>
                                        setNumber(event.target.value)
                                    }
                                />
                            </FormControl>
                        </FormGrid>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

/**
 * Nomor identitas party: NIK, No. KK, paspor, dan jenis lain dari data. Party tersimpan diubah langsung lewat
 * endpoint nomor identitas; party baru menahan nomornya sebagai draft sampai Simpan.
 */
export function PartyIdentifications({
    partyId,
    items,
    types,
    canManage,
    draft,
    errors = {},
    onChanged,
}: {
    partyId: string | null;
    items: Identification[];
    types: IdentificationType[];
    canManage: boolean;
    draft?: {
        value: DraftIdentification[];
        onChange: (value: DraftIdentification[]) => void;
    };
    errors?: Errors;
    onChanged: () => void;
}): ReactNode {
    const [editing, setEditing] = useState<
        Identification | DraftIdentification | 'new' | null
    >(null);
    const [failed, setFailed] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const typeName = (code: string) =>
        types.find((type) => type.code === code)?.name ?? code;
    const rows = draft
        ? draft.value.map((row) => ({
              id: row.key,
              type_code: row.type_code,
              type_name: typeName(row.type_code),
              number: row.number,
              masked: false,
              version: 0,
          }))
        : items;
    const rowError = (index: number) =>
        Object.entries(errors)
            .filter(([field]) => field.startsWith(`identifications.${index}.`))
            .flatMap(([, messages]) => messages)
            .join(' ');

    const save = async (value: { type_code: string; number: string }) => {
        if (draft) {
            const key =
                editing && editing !== 'new' && 'key' in editing
                    ? editing.key
                    : newDraftKey();
            draft.onChange([
                ...draft.value.filter((row) => row.key !== key),
                { key, ...value },
            ]);
        } else if (partyId === null) {
            throw new Error('Pihak belum tersimpan.');
        } else if (editing === 'new') {
            await api.partyIdentificationCreate({
                params: { id: partyId },
                body: value,
            });
            toast.success('Nomor identitas ditambahkan.');
            onChanged();
        } else if (editing && 'id' in editing) {
            await api.partyIdentificationUpdate({
                params: { id: partyId, child: editing.id },
                body: { number: value.number, version: editing.version },
            });
            toast.success('Nomor identitas disimpan.');
            onChanged();
        }
        setEditing(null);
    };

    const remove = async (row: (typeof rows)[number]) => {
        const confirmed = await confirm({
            title: `Delete ${row.type_name}?`,
            description: 'Nomor ini tidak lagi tercatat untuk pihak ini.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        if (draft) {
            draft.onChange(draft.value.filter((item) => item.key !== row.id));
            return;
        }
        setFailed(null);
        try {
            if (partyId === null) throw new Error('Pihak belum tersimpan.');
            await api.partyIdentificationDelete({
                params: { id: partyId, child: row.id },
                body: { version: row.version },
            });
            toast.success('Nomor identitas dihapus.');
            onChanged();
        } catch (caught) {
            setFailed(errorText(caught, 'Nomor identitas belum dihapus.'));
        }
    };

    const current =
        editing === null || editing === 'new'
            ? editing
            : 'key' in editing
              ? { ...editing, masked: false }
              : editing;

    return (
        <div className="space-y-3">
            {canManage && rows.length < types.length && (
                <RecordActionBar>
                    <ActionButton
                        action={draft ? 'add' : 'create'}
                        type="button"
                        onClick={() => setEditing('new')}
                    />
                </RecordActionBar>
            )}
            {failed && (
                <p role="alert" className="text-sm text-destructive">
                    {failed}
                </p>
            )}
            {rows.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {canManage
                        ? `Belum ada nomor identitas. Pilih ${draft ? 'Tambah' : 'Baru'} untuk mengisi.`
                        : 'Belum ada nomor identitas.'}
                </p>
            ) : (
                <DataTable
                    scrollMode="inline"
                    data={rows}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.type_name}
                    actionsPlacement="inline"
                    actions={
                        canManage
                            ? [
                                  { id: 'edit', label: 'Ubah' },
                                  {
                                      id: 'delete',
                                      label: 'Delete',
                                      destructive: true,
                                      separatorBefore: true,
                                  },
                              ]
                            : []
                    }
                    onRowAction={(action, row) => {
                        if (action === 'delete') return void remove(row);
                        setEditing(
                            draft
                                ? (draft.value.find(
                                      (item) => item.key === row.id,
                                  ) ?? null)
                                : (items.find((item) => item.id === row.id) ??
                                      null),
                        );
                    }}
                    columns={[
                        {
                            id: 'type',
                            header: 'Jenis',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>{row.type_name}</DataTableText>
                            ),
                        },
                        {
                            id: 'number',
                            header: 'Nomor',
                            width: 220,
                            cell: (row) => (
                                <span className="flex items-center gap-2">
                                    <DataTableText>{row.number}</DataTableText>
                                    {row.masked && (
                                        <Badge variant="outline">
                                            Disamarkan
                                        </Badge>
                                    )}
                                </span>
                            ),
                        },
                        ...(draft
                            ? [
                                  {
                                      id: 'problem',
                                      header: 'Masalah',
                                      width: 260,
                                      cell: (row: (typeof rows)[number]) => {
                                          const message = rowError(
                                              rows.indexOf(row),
                                          );
                                          return message ? (
                                              <span className="text-sm text-destructive">
                                                  {message}
                                              </span>
                                          ) : (
                                              '—'
                                          );
                                      },
                                  },
                              ]
                            : []),
                    ]}
                />
            )}
            {rows.some((row) => row.masked) && (
                <p className="text-sm text-muted-foreground">
                    Sebagian nomor disamarkan. Nomor lengkapnya hanya terlihat
                    oleh pengguna yang diberi izin melihat nomor identitas utuh.
                </p>
            )}
            {current !== null && (
                <IdentificationDialog
                    types={types}
                    taken={rows.map((row) => row.type_code)}
                    editing={current}
                    draftMode={Boolean(draft)}
                    onClose={() => setEditing(null)}
                    onSave={save}
                />
            )}
            {confirmation}
        </div>
    );
}
