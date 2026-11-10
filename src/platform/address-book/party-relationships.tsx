import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../shell/index.ts';

type Party = ApiBody<'partyShow'>['data'];
type Relationship = Party['relationships'][number];
type RelationshipType =
    ApiBody<'partyMetadata'>['data']['relationshipTypes'][number];
type PartyOption = ApiBody<'partyOptions'>['data'][number];
type Errors = Record<string, string[]>;

// Party ini sebagai pihak pertama (`from`) atau pihak kedua (`to`) pada jenis hubungannya.
type Direction = 'from' | 'to';
const choiceKey = (code: string, direction: Direction) =>
    `${code}:${direction}`;

function RelationshipDialog({
    party,
    types,
    editing,
    onClose,
    onSaved,
}: {
    party: Party;
    types: RelationshipType[];
    editing: Relationship | 'new';
    onClose: () => void;
    onSaved: () => void;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    // Pilihan hubungan dibaca dari sisi party ini: "Anggota KK dari" bila ia pihak pertama, "Kepala keluarga dari"
    // bila ia pihak kedua. Hanya jenis yang cocok dengan jenis party ini yang ditawarkan.
    const choices = types.flatMap((type) => [
        ...(type.from_type === party.type
            ? [
                  {
                      key: choiceKey(type.code, 'from'),
                      label: type.name,
                      other: type.to_type,
                  },
              ]
            : []),
        ...(type.to_type === party.type && type.inverse_name !== type.name
            ? [
                  {
                      key: choiceKey(type.code, 'to'),
                      label: type.inverse_name,
                      other: type.from_type,
                  },
              ]
            : []),
    ]);
    const [choice, setChoice] = useState(
        editing === 'new'
            ? ''
            : choiceKey(
                  editing.relationship_type_code,
                  editing.from_party_id === party.id ? 'from' : 'to',
              ),
    );
    const [other, setOther] = useState<PartyOption | null>(
        editing === 'new'
            ? null
            : editing.from_party_id === party.id
              ? { id: editing.to_party_id, name: editing.to_name, type: '' }
              : {
                    id: editing.from_party_id,
                    name: editing.from_name,
                    type: '',
                },
    );
    const [validFrom, setValidFrom] = useState(
        editing === 'new' ? '' : editing.valid_from,
    );
    const [validTo, setValidTo] = useState(
        editing === 'new' ? '' : (editing.valid_to ?? ''),
    );
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const selected = choices.find((item) => item.key === choice);
    const [typeCode = '', side] = choice.split(':');
    const direction: Direction = side === 'to' ? 'to' : 'from';
    const loadParties = useCallback<LookupLoader<PartyOption>>(
        async ({ query, signal }) => {
            const { body } = await api.partyOptions(
                { query: { q: query } },
                { signal },
            );
            return {
                items: body.data.filter(
                    (item) =>
                        item.id !== party.id &&
                        (!selected || item.type === selected.other),
                ),
                nextCursor: null,
            };
        },
        [party.id, selected],
    );
    const otherField = direction === 'to' ? 'from_party_id' : 'to_party_id';

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const body = {
                from_party_id: direction === 'to' ? other?.id : party.id,
                to_party_id: direction === 'to' ? party.id : other?.id,
                relationship_type_code: typeCode || null,
                valid_from: validFrom || null,
                valid_to: validTo || null,
            };
            if (editing === 'new')
                await api.partyRelationshipCreate({
                    params: { id: party.id },
                    body,
                });
            else
                await api.partyRelationshipUpdate({
                    params: { id: party.id, child: editing.id },
                    body: { ...body, version: editing.version },
                });
            toast.success(
                editing === 'new'
                    ? 'Hubungan ditambahkan.'
                    : 'Hubungan disimpan.',
            );
            onSaved();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Hubungan belum disimpan.'));
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
                title="Hubungan"
                recordTitle={
                    [selected?.label, other?.name].filter(Boolean).join(' ') ||
                    'Hubungan baru'
                }
                editing
                busy={busy}
                onEscapeKeyDown={(event) => {
                    if (
                        busy ||
                        contentRef.current?.querySelector(
                            '[role="combobox"][aria-expanded="true"]',
                        )
                    )
                        event.preventDefault();
                }}
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
                        operation="Hubungan belum disimpan"
                    />
                    <PageDialogBody className="py-3">
                        <FormGrid>
                            <FormControl
                                error={errors.relationship_type_code?.[0]}
                                data-error-field="relationship_type_code"
                            >
                                <Select
                                    label={`${party.name} adalah`}
                                    required
                                    items={choices.map((item) => ({
                                        value: item.key,
                                        label: item.label,
                                    }))}
                                    value={choice || null}
                                    onValueChange={(value) =>
                                        setChoice(value ?? '')
                                    }
                                    searchPlaceholder="Cari hubungan"
                                    emptyMessage="Hubungan tidak ditemukan."
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                            <FormControl error={errors[otherField]?.[0]}>
                                <InlineLookup
                                    label="Pihak terkait"
                                    required
                                    loadItems={loadParties}
                                    value={other}
                                    onValueChange={setOther}
                                    getItemValue={(item) => item.id}
                                    getItemLabel={(item) => item.name}
                                    placeholder="Cari nama…"
                                    emptyMessage="Pihak tidak ditemukan."
                                    columns={[
                                        {
                                            id: 'name',
                                            header: 'Nama',
                                            cell: (item) => item.name,
                                        },
                                    ]}
                                    portalContainer={contentRef}
                                    showDetails={false}
                                    showFullList={false}
                                />
                            </FormControl>
                            <FormControl error={errors.valid_from?.[0]}>
                                <DatePicker
                                    label="Berlaku sejak"
                                    required
                                    data-error-field="valid_from"
                                    value={validFrom}
                                    onValueChange={setValidFrom}
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                            <FormControl
                                error={errors.valid_to?.[0]}
                                hint="Kosongkan bila hubungan masih berlaku."
                            >
                                <DatePicker
                                    label="Berlaku sampai"
                                    data-error-field="valid_to"
                                    value={validTo}
                                    onValueChange={setValidTo}
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                        </FormGrid>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

/** Hubungan bertanggal antar pihak, misalnya anggota KK, orang tua, pasangan, dan tempat bekerja. */
export function PartyRelationships({
    party,
    types,
    canManage,
    onChanged,
}: {
    party: Party;
    types: RelationshipType[];
    canManage: boolean;
    onChanged: () => void;
}): ReactNode {
    const [editing, setEditing] = useState<Relationship | 'new' | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const label = (row: Relationship) => {
        const type = types.find(
            (item) => item.code === row.relationship_type_code,
        );
        return row.from_party_id === party.id
            ? (type?.name ?? row.relationship_type_code)
            : (type?.inverse_name ?? row.relationship_type_code);
    };

    const remove = async (row: Relationship) => {
        const confirmed = await confirm({
            title: 'Delete hubungan?',
            description:
                'Hubungan tidak lagi tercatat. Identitas kedua pihak tetap tersimpan.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        setFailed(null);
        try {
            await api.partyRelationshipDelete({
                params: { id: party.id, child: row.id },
                body: { version: row.version },
            });
            toast.success('Hubungan dihapus.');
            onChanged();
        } catch (caught) {
            setFailed(errorText(caught, 'Hubungan belum dihapus.'));
        }
    };

    return (
        <div className="space-y-3">
            {canManage && (
                <RecordActionBar>
                    <ActionButton
                        action="create"
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
            {party.relationships.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {canManage
                        ? 'Belum ada hubungan. Pilih Baru untuk mencatat hubungan dengan pihak lain.'
                        : 'Belum ada hubungan.'}
                </p>
            ) : (
                <DataTable
                    scrollMode="inline"
                    data={party.relationships}
                    getRowKey={(row) => row.id}
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
                    onRowAction={(action, row) =>
                        action === 'edit' ? setEditing(row) : void remove(row)
                    }
                    columns={[
                        {
                            id: 'type',
                            header: 'Hubungan',
                            width: 180,
                            cell: (row) => (
                                <DataTableText>{label(row)}</DataTableText>
                            ),
                        },
                        {
                            id: 'other',
                            header: 'Pihak terkait',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.from_party_id === party.id
                                        ? row.to_name
                                        : row.from_name}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'from',
                            header: 'Berlaku sejak',
                            width: 130,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.valid_from)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'to',
                            header: 'Berlaku sampai',
                            width: 130,
                            cell: (row) => (
                                <DataTableText>
                                    {row.valid_to
                                        ? displayDate(row.valid_to)
                                        : 'Tidak dibatasi'}
                                </DataTableText>
                            ),
                        },
                    ]}
                />
            )}
            {editing !== null && (
                <RelationshipDialog
                    party={party}
                    types={types}
                    editing={editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        onChanged();
                    }}
                />
            )}
            {confirmation}
        </div>
    );
}
