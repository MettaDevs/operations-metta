import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Field,
    FieldDescription,
    FieldLabel,
} from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import {
    RecordEditBoundary,
    RecordEditControl,
} from '@operations-metta/ui/record-edit-boundary';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../platform/shell/index.ts';

// Kartu satu number sequence, mengikuti kartu Number sequences F&O: scope dan nilainya (hanya diisi saat membuat),
// segmen format, General, Allow user changes, Performance (preallocation), dan Status list dengan Manual cleanup.

export type Metadata = ApiBody<'numberSequenceMetadata'>['data'];
type Reference = Metadata['references'][number];
type Stored = ApiBody<'numberSequenceShow'>['data'];
type ScopeType = Stored['scope_type'];
type Segment = Stored['segments'][number];
type SegmentType = Segment['type'];
type ScopeValue = ApiBody<'numberSequenceScopeValues'>['data'][number];
type Errors = Record<string, string[]>;

export const scopeLabels: Record<ScopeType, string> = {
    tenant: 'Seluruh tenant (Shared)',
    legal_entity: 'Perusahaan',
    operating_unit: 'Unit',
    legal_entity_fiscal_period: 'Perusahaan dan periode fiskal',
};
export const statusLabels: Record<Stored['status'], string> = {
    draft: 'Draft',
    active: 'Dipakai',
    stopped: 'Dihentikan',
};
const resetLabels: Record<Stored['reset_period'], string> = {
    never: 'Tidak pernah',
    calendar_year: 'Setiap tahun kalender',
    fiscal_year: 'Setiap tahun fiskal',
    fiscal_period: 'Setiap periode fiskal',
};
const segmentLabels: Record<SegmentType, string> = {
    constant: 'Teks tetap',
    number: 'Nomor',
    year: 'Tahun',
    scope: 'Kode organisasi',
    fiscal_year: 'Tahun fiskal',
    fiscal_period: 'Periode fiskal',
    context: 'Bagian dari data',
};
const scopeTypes: ScopeType[] = [
    'tenant',
    'legal_entity',
    'operating_unit',
    'legal_entity_fiscal_period',
];
const statuses: Stored['status'][] = ['draft', 'active', 'stopped'];
const resetPeriods: Stored['reset_period'][] = [
    'never',
    'calendar_year',
    'fiscal_year',
    'fiscal_period',
];
const segmentTypes: SegmentType[] = [
    'constant',
    'number',
    'year',
    'scope',
    'fiscal_year',
    'fiscal_period',
    'context',
];
const scopeValueColumns = [
    {
        id: 'code',
        header: 'Kode',
        cell: (item: ScopeValue) => item.code ?? '-',
    },
    { id: 'name', header: 'Nama', cell: (item: ScopeValue) => item.name },
];

type Draft = {
    reference_id: string;
    scope_type: ScopeType;
    legal_entity: ScopeValue | null;
    operating_unit: ScopeValue | null;
    fiscal_period: ScopeValue | null;
    status: Stored['status'];
    is_continuous: boolean;
    allow_automatic: boolean;
    allow_manual: boolean;
    allow_lower_number: boolean;
    allow_higher_number: boolean;
    reset_period: Stored['reset_period'];
    preallocation_enabled: boolean;
    preallocation_quantity: string;
    minimum_number: string;
    maximum_number: string;
    next_number: string;
    segments: Segment[];
};

function emptyDraft(reference: Reference | undefined): Draft {
    const scope = reference?.allowed_scopes[0];
    return {
        reference_id: reference?.id ?? '',
        scope_type:
            scope === 'legal_entity' || scope === 'operating_unit'
                ? scope
                : 'tenant',
        legal_entity: null,
        operating_unit: null,
        fiscal_period: null,
        status: 'active',
        is_continuous: false,
        allow_automatic: true,
        allow_manual: false,
        allow_lower_number: false,
        allow_higher_number: false,
        reset_period: 'never',
        preallocation_enabled: true,
        preallocation_quantity: '20',
        minimum_number: '1',
        maximum_number: '19999',
        next_number: '1',
        segments: [
            ...(reference?.default_prefix
                ? [
                      {
                          type: 'constant' as const,
                          value: reference.default_prefix,
                      },
                  ]
                : []),
            { type: 'number', length: 5 },
        ],
    };
}

function storedDraft(stored: Stored): Draft {
    const value = (id: string | null) =>
        id === null
            ? null
            : { id, name: stored.scope_value_name ?? id, code: null };
    return {
        reference_id: stored.reference_id,
        scope_type: stored.scope_type,
        legal_entity: value(stored.legal_entity_id),
        operating_unit: value(stored.operating_unit_id),
        fiscal_period:
            stored.fiscal_period_id === null
                ? null
                : {
                      id: stored.fiscal_period_id,
                      name: stored.fiscal_period_name ?? '',
                      code: null,
                  },
        status: stored.status,
        is_continuous: stored.is_continuous,
        allow_automatic: stored.allow_automatic,
        allow_manual: stored.allow_manual,
        allow_lower_number: stored.allow_lower_number,
        allow_higher_number: stored.allow_higher_number,
        reset_period: stored.reset_period,
        preallocation_enabled: stored.preallocation_enabled,
        preallocation_quantity: String(stored.preallocation_quantity),
        minimum_number: String(stored.minimum_number),
        maximum_number:
            stored.maximum_number === null ? '' : String(stored.maximum_number),
        next_number: String(stored.next_number),
        segments: stored.segments,
    };
}

// Pratinjau nomor pertama dan terakhir, seperti preview CoreERP: bagian yang baru diketahui saat terbit ditulis
// sebagai nama bagiannya.
function preview(segments: Segment[], number: number): string {
    return segments
        .map((segment) => {
            switch (segment.type) {
                case 'constant':
                    return segment.value;
                case 'number':
                    return String(number).padStart(segment.length, '0');
                case 'year':
                    return String(new Date().getFullYear());
                case 'scope':
                    return '[kode organisasi]';
                case 'fiscal_year':
                    return '[tahun fiskal]';
                case 'fiscal_period':
                    return '[periode]';
                case 'context':
                    return `[${segment.name ?? segment.value}]`;
                default: {
                    const exhaustive: never = segment;
                    return exhaustive;
                }
            }
        })
        .join('');
}

function newSegment(type: SegmentType, reference?: Reference): Segment {
    switch (type) {
        case 'constant':
            return { type, value: '' };
        case 'number':
            return { type, length: 5 };
        case 'fiscal_period':
            return { type, length: 2 };
        case 'context': {
            const field = reference?.context_fields[0];
            return {
                type,
                value: field?.value ?? '',
                length: field?.length ?? 10,
                ...(field?.name ? { name: field.name } : {}),
            };
        }
        case 'year':
        case 'scope':
        case 'fiscal_year':
            return { type };
        default: {
            const exhaustive: never = type;
            return exhaustive;
        }
    }
}

const numberOrNull = (text: string) =>
    text.trim() === '' ? null : Number(text);

function ScopeValueLookup({
    label,
    kind,
    legalEntityId,
    value,
    onChange,
    portalContainer,
}: {
    label: string;
    kind: 'legal_entity' | 'operating_unit' | 'fiscal_period';
    legalEntityId?: string;
    value: ScopeValue | null;
    onChange: (value: ScopeValue) => void;
    portalContainer: React.RefObject<HTMLDivElement | null>;
}) {
    const loader = useCallback<LookupLoader<ScopeValue>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.numberSequenceScopeValues(
                {
                    query: {
                        kind,
                        q: query,
                        ...(legalEntityId
                            ? { legal_entity_id: legalEntityId }
                            : {}),
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [kind, legalEntityId],
    );
    return (
        <InlineLookup
            label={label}
            required
            value={value}
            onValueChange={onChange}
            loadItems={loader}
            getItemValue={(item) => item.id}
            getItemLabel={(item) => item.name}
            columns={scopeValueColumns}
            portalContainer={portalContainer}
            showDetails={false}
        />
    );
}

function SegmentEditor({
    segments,
    onChange,
    reference,
    editable,
}: {
    segments: Segment[];
    onChange: (segments: Segment[]) => void;
    reference: Reference | undefined;
    editable: boolean;
}) {
    const update = (index: number, segment: Segment) =>
        onChange(
            segments.map((current, position) =>
                position === index ? segment : current,
            ),
        );
    const move = (index: number, offset: number) => {
        const next = [...segments];
        const [segment] = next.splice(index, 1);
        if (segment) next.splice(index + offset, 0, segment);
        onChange(next);
    };
    const types = segmentTypes.filter(
        (type) =>
            type !== 'context' || Boolean(reference?.context_fields.length),
    );
    return (
        <div className="flex flex-col gap-3">
            {segments.map((segment, index) => (
                <div
                    key={index}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                    <RecordEditControl label={`Jenis bagian ${index + 1}`}>
                        <Select
                            label={`Bagian ${index + 1}`}
                            items={types.map((type) => ({
                                value: type,
                                label: segmentLabels[type],
                            }))}
                            value={segment.type}
                            onValueChange={(value) => {
                                const type = types.find(
                                    (item) => item === value,
                                );
                                if (editable && type)
                                    update(index, newSegment(type, reference));
                            }}
                        />
                    </RecordEditControl>
                    {segment.type === 'constant' && (
                        <Input
                            label="Teks"
                            value={segment.value}
                            readOnly={!editable}
                            maxLength={20}
                            onChange={(event) =>
                                update(index, {
                                    ...segment,
                                    value: event.target.value,
                                })
                            }
                        />
                    )}
                    {(segment.type === 'number' ||
                        segment.type === 'fiscal_period') && (
                        <Input
                            label="Jumlah digit"
                            inputMode="numeric"
                            value={String(segment.length ?? '')}
                            readOnly={!editable}
                            onChange={(event) =>
                                update(index, {
                                    ...segment,
                                    length: Number(event.target.value) || 0,
                                })
                            }
                        />
                    )}
                    {segment.type === 'context' && (
                        <RecordEditControl label="Data">
                            <Select
                                label="Data"
                                items={(reference?.context_fields ?? []).map(
                                    (field) => ({
                                        value: field.value,
                                        label: field.name ?? field.value,
                                    }),
                                )}
                                value={segment.value}
                                onValueChange={(value) => {
                                    const field =
                                        reference?.context_fields.find(
                                            (item) => item.value === value,
                                        );
                                    if (editable && field)
                                        update(index, {
                                            type: 'context',
                                            value: field.value,
                                            length: field.length,
                                            ...(field.name
                                                ? { name: field.name }
                                                : {}),
                                        });
                                }}
                            />
                        </RecordEditControl>
                    )}
                    {(segment.type === 'year' ||
                        segment.type === 'scope' ||
                        segment.type === 'fiscal_year') && <span />}
                    {editable && (
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Naikkan bagian ${index + 1}`}
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                            >
                                <ArrowUp />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Turunkan bagian ${index + 1}`}
                                disabled={index === segments.length - 1}
                                onClick={() => move(index, 1)}
                            >
                                <ArrowDown />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus bagian ${index + 1}`}
                                disabled={segments.length === 1}
                                onClick={() =>
                                    onChange(
                                        segments.filter(
                                            (_, position) => position !== index,
                                        ),
                                    )
                                }
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    )}
                </div>
            ))}
            {editable && segments.length < 10 && (
                <div>
                    <ActionButton
                        action="add"
                        type="button"
                        onClick={() =>
                            onChange([...segments, newSegment('constant')])
                        }
                    />
                </div>
            )}
        </div>
    );
}

function StatusList({
    sequenceId,
    canManage,
}: {
    sequenceId: string;
    canManage: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const list = useQuery({
        queryKey: ['number-sequence-status-list', sequenceId],
        queryFn: async () =>
            (
                await api.numberSequenceStatusList({
                    params: { id: sequenceId },
                })
            ).body.data,
    });
    const rows = list.data ?? [];
    const expired = rows.filter((row) => row.expired).length;
    const cleanup = async () => {
        const confirmed = await confirm({
            title: 'Kembalikan nomor yang tertahan?',
            description:
                'Nomor yang dipesan lebih dari 15 menit lalu dan tidak pernah dipakai dokumen dikembalikan, lalu dipakai lagi oleh dokumen berikutnya. Pesanan yang masih berlaku tidak disentuh.',
            confirmLabel: 'Kembalikan',
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            const { body } = await api.numberSequenceCleanup({
                params: { id: sequenceId },
                body: {},
            });
            toast.success(
                body.data.released
                    ? `${body.data.released} nomor dikembalikan.`
                    : 'Tidak ada nomor tertahan yang perlu dikembalikan.',
            );
            await list.refetch();
        } catch (caught) {
            toast.error(errorText(caught, 'Nomor belum dikembalikan.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex flex-col gap-3">
            {canManage && (
                <div>
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={busy || expired === 0}
                        onClick={() => void cleanup()}
                    >
                        Bersihkan manual
                    </Button>
                </div>
            )}
            {list.isError ? (
                <p className="text-sm text-destructive">
                    {errorText(list.error, 'Status nomor belum bisa dimuat.')}{' '}
                    <Button
                        type="button"
                        variant="link"
                        onClick={() => void list.refetch()}
                    >
                        Coba lagi
                    </Button>
                </p>
            ) : (
                <DataTable
                    data={rows}
                    getRowKey={(row) => row.id}
                    scrollMode="inline"
                    emptyMessage={
                        list.isPending
                            ? 'Memuat nomor yang sedang dipesan...'
                            : 'Tidak ada nomor yang sedang dipesan.'
                    }
                    columns={[
                        {
                            id: 'number',
                            header: 'Nomor',
                            cell: (row) => (
                                <DataTableText>{row.number}</DataTableText>
                            ),
                        },
                        {
                            id: 'reserved_at',
                            header: 'Dipesan',
                            cell: (row) => (
                                <DataTableText>
                                    {row.reserved_at
                                        ? new Date(
                                              row.reserved_at,
                                          ).toLocaleString('id-ID')
                                        : '-'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'expires_at',
                            header: 'Berlaku sampai',
                            cell: (row) => (
                                <DataTableText>
                                    {row.expires_at
                                        ? new Date(
                                              row.expires_at,
                                          ).toLocaleString('id-ID')
                                        : '-'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'state',
                            header: 'Keadaan',
                            cell: (row) =>
                                row.expired ? (
                                    <Badge variant="destructive">
                                        Tertahan
                                    </Badge>
                                ) : (
                                    <Badge variant="secondary">Dipesan</Badge>
                                ),
                        },
                    ]}
                />
            )}
            {confirmation}
        </div>
    );
}

export function NumberSequenceCard({
    sequenceId,
    metadata,
    onClose,
    onSaved,
}: {
    sequenceId: string | null;
    metadata: Metadata;
    onClose: () => void;
    onSaved: (stored: Stored) => void;
}): ReactNode {
    const creating = sequenceId === null;
    const contentRef = useRef<HTMLDivElement>(null);
    const queryClient = useQueryClient();
    const stored = useQuery({
        queryKey: ['number-sequence', sequenceId],
        queryFn: async () => {
            if (sequenceId === null)
                throw new Error('Pengaturan nomor belum tersimpan.');
            return (
                await api.numberSequenceShow({ params: { id: sequenceId } })
            ).body.data;
        },
        enabled: !creating,
    });
    const [draft, setDraft] = useState<Draft | null>(() =>
        creating ? emptyDraft(metadata.references[0]) : null,
    );
    const [editing, setEditing] = useState(creating);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const record = stored.data ?? null;
    const form = draft ?? (record ? storedDraft(record) : null);
    const reference = metadata.references.find(
        (item) => item.id === form?.reference_id,
    );
    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        if (!editing || !form) return;
        setDraft({ ...form, [key]: value });
    };
    const cancel = () => {
        if (creating) {
            onClose();
            return;
        }
        setDraft(null);
        setErrors({});
        setMessage(null);
        setEditing(false);
    };

    const save = async () => {
        if (!form) return;
        setBusy(true);
        setErrors({});
        setMessage(null);
        const settings = {
            status: form.status,
            is_continuous: form.is_continuous,
            allow_automatic: form.allow_automatic,
            allow_manual: form.allow_manual,
            allow_lower_number: form.allow_lower_number,
            allow_higher_number: form.allow_higher_number,
            reset_period: form.reset_period,
            preallocation_enabled: form.preallocation_enabled,
            preallocation_quantity: Number(form.preallocation_quantity),
            minimum_number: Number(form.minimum_number),
            maximum_number: numberOrNull(form.maximum_number),
            segments: form.segments,
        };
        try {
            let saved: Stored;
            if (record === null) {
                saved = (
                    await api.numberSequenceCreate({
                        body: {
                            ...settings,
                            reference_id: form.reference_id,
                            scope_type: form.scope_type,
                            legal_entity_id: form.legal_entity?.id ?? null,
                            operating_unit_id: form.operating_unit?.id ?? null,
                            fiscal_period_id: form.fiscal_period?.id ?? null,
                        },
                    })
                ).body.data;
            } else {
                saved = (
                    await api.numberSequenceUpdate({
                        params: { id: record.id },
                        body: { ...settings, version: record.version },
                    })
                ).body.data;
                const next = Number(form.next_number);
                if (next !== record.next_number)
                    saved = (
                        await api.numberSequenceNextNumber({
                            params: { id: record.id },
                            body: { next_number: next },
                        })
                    ).body.data;
            }
            toast.success('Pengaturan nomor disimpan.');
            // Halaman memasang ulang kartu dalam mode baca dengan data ini, jadi tidak ada state edit yang tersisa.
            queryClient.setQueryData(['number-sequence', saved.id], saved);
            onSaved(saved);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            setMessage(
                caught instanceof ApiError && caught.status === 422
                    ? null
                    : errorText(caught, 'Pengaturan nomor belum disimpan.'),
            );
        } finally {
            setBusy(false);
        }
    };

    const error = (field: string) => errors[field]?.[0];
    const editable = editing && metadata.canManage;
    const formatLocked = !creating && (record?.used ?? false);
    const maximum = numberOrNull(form?.maximum_number ?? '');

    return (
        <PageDialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title="Nomor dokumen"
                recordTitle={
                    reference
                        ? `${reference.name}${record?.scope_value_name ? ` · ${record.scope_value_name}` : ''}`
                        : 'Pengaturan nomor baru'
                }
                editing={editing}
                busy={busy}
                onEdit={
                    !creating && metadata.canManage && !editing
                        ? () => setEditing(true)
                        : undefined
                }
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
                {!form ? (
                    <PageDialogBody className="py-3">
                        <p className="text-sm text-muted-foreground">
                            {stored.isError
                                ? errorText(
                                      stored.error,
                                      'Pengaturan nomor belum bisa dimuat.',
                                  )
                                : 'Memuat pengaturan nomor...'}
                        </p>
                    </PageDialogBody>
                ) : (
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
                                    disabled={busy}
                                    onClick={cancel}
                                />
                            </PageDialogToolbar>
                        )}
                        <FormErrorHeader
                            errors={errors}
                            message={message}
                            operation="Pengaturan nomor belum disimpan"
                        />
                        <PageDialogBody className="py-3">
                            <RecordEditBoundary
                                editing={editing}
                                canEdit={metadata.canManage}
                                disabled={busy}
                                onEdit={() => setEditing(true)}
                            >
                                <CollapsibleSectionGroup
                                    defaultValue={[
                                        'scope',
                                        'segments',
                                        'general',
                                        'user-changes',
                                        'performance',
                                        'status-list',
                                    ]}
                                >
                                    <CollapsibleSection
                                        value="scope"
                                        title="Scope"
                                        summary={`${scopeLabels[form.scope_type]}${record?.scope_value_name ? ` · ${record.scope_value_name}` : ''}`}
                                    >
                                        <FormGrid>
                                            {creating ? (
                                                <>
                                                    <FormControl
                                                        error={error(
                                                            'reference_id',
                                                        )}
                                                    >
                                                        <Select
                                                            label="Jenis nomor"
                                                            required
                                                            portalContainer={
                                                                contentRef
                                                            }
                                                            items={metadata.references.map(
                                                                (item) => ({
                                                                    value: item.id,
                                                                    label: `${item.name} (${item.area_name})`,
                                                                }),
                                                            )}
                                                            value={
                                                                form.reference_id
                                                            }
                                                            onValueChange={(
                                                                value,
                                                            ) => {
                                                                const next =
                                                                    metadata.references.find(
                                                                        (
                                                                            item,
                                                                        ) =>
                                                                            item.id ===
                                                                            value,
                                                                    );
                                                                if (next)
                                                                    setDraft(
                                                                        emptyDraft(
                                                                            next,
                                                                        ),
                                                                    );
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormControl
                                                        error={error(
                                                            'scope_type',
                                                        )}
                                                        hint="Organisasi yang memakai pengaturan ini. Satu jenis nomor boleh punya pengaturan sendiri untuk setiap perusahaan, unit, atau periode fiskal."
                                                    >
                                                        <Select
                                                            label="Scope"
                                                            required
                                                            portalContainer={
                                                                contentRef
                                                            }
                                                            items={scopeTypes
                                                                .filter(
                                                                    (type) =>
                                                                        reference?.allowed_scopes.includes(
                                                                            type ===
                                                                                'legal_entity_fiscal_period'
                                                                                ? 'legal_entity'
                                                                                : type,
                                                                        ),
                                                                )
                                                                .map(
                                                                    (type) => ({
                                                                        value: type,
                                                                        label: scopeLabels[
                                                                            type
                                                                        ],
                                                                    }),
                                                                )}
                                                            value={
                                                                form.scope_type
                                                            }
                                                            onValueChange={(
                                                                value,
                                                            ) => {
                                                                const type =
                                                                    scopeTypes.find(
                                                                        (
                                                                            item,
                                                                        ) =>
                                                                            item ===
                                                                            value,
                                                                    );
                                                                if (type)
                                                                    setDraft({
                                                                        ...form,
                                                                        scope_type:
                                                                            type,
                                                                        legal_entity:
                                                                            null,
                                                                        operating_unit:
                                                                            null,
                                                                        fiscal_period:
                                                                            null,
                                                                        reset_period:
                                                                            type ===
                                                                            'legal_entity_fiscal_period'
                                                                                ? 'never'
                                                                                : form.reset_period,
                                                                    });
                                                            }}
                                                        />
                                                    </FormControl>
                                                    {(form.scope_type ===
                                                        'legal_entity' ||
                                                        form.scope_type ===
                                                            'legal_entity_fiscal_period') && (
                                                        <FormControl
                                                            error={error(
                                                                'legal_entity_id',
                                                            )}
                                                        >
                                                            <ScopeValueLookup
                                                                label="Perusahaan"
                                                                kind="legal_entity"
                                                                value={
                                                                    form.legal_entity
                                                                }
                                                                onChange={(
                                                                    value,
                                                                ) =>
                                                                    setDraft({
                                                                        ...form,
                                                                        legal_entity:
                                                                            value,
                                                                        fiscal_period:
                                                                            null,
                                                                    })
                                                                }
                                                                portalContainer={
                                                                    contentRef
                                                                }
                                                            />
                                                        </FormControl>
                                                    )}
                                                    {form.scope_type ===
                                                        'operating_unit' && (
                                                        <FormControl
                                                            error={error(
                                                                'operating_unit_id',
                                                            )}
                                                        >
                                                            <ScopeValueLookup
                                                                label="Unit"
                                                                kind="operating_unit"
                                                                value={
                                                                    form.operating_unit
                                                                }
                                                                onChange={(
                                                                    value,
                                                                ) =>
                                                                    set(
                                                                        'operating_unit',
                                                                        value,
                                                                    )
                                                                }
                                                                portalContainer={
                                                                    contentRef
                                                                }
                                                            />
                                                        </FormControl>
                                                    )}
                                                    {form.scope_type ===
                                                        'legal_entity_fiscal_period' &&
                                                        form.legal_entity && (
                                                            <FormControl
                                                                error={error(
                                                                    'fiscal_period_id',
                                                                )}
                                                            >
                                                                <ScopeValueLookup
                                                                    key={
                                                                        form
                                                                            .legal_entity
                                                                            .id
                                                                    }
                                                                    label="Periode fiskal"
                                                                    kind="fiscal_period"
                                                                    legalEntityId={
                                                                        form
                                                                            .legal_entity
                                                                            .id
                                                                    }
                                                                    value={
                                                                        form.fiscal_period
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        set(
                                                                            'fiscal_period',
                                                                            value,
                                                                        )
                                                                    }
                                                                    portalContainer={
                                                                        contentRef
                                                                    }
                                                                />
                                                            </FormControl>
                                                        )}
                                                </>
                                            ) : (
                                                <>
                                                    <FormControl>
                                                        <Input
                                                            label="Jenis nomor"
                                                            readOnly
                                                            value={`${record?.reference_name ?? ''} (${record?.area_name ?? ''})`}
                                                        />
                                                    </FormControl>
                                                    <FormControl>
                                                        <Input
                                                            label="Scope"
                                                            readOnly
                                                            value={`${scopeLabels[form.scope_type]}${record?.scope_value_name ? ` · ${record.scope_value_name}` : ''}${record?.fiscal_period_name ? ` · ${record.fiscal_period_name}` : ''}`}
                                                        />
                                                    </FormControl>
                                                </>
                                            )}
                                        </FormGrid>
                                        {!creating && (
                                            <FieldDescription className="mt-2">
                                                Scope dan nilainya tidak bisa
                                                diubah. Untuk kebijakan baru,
                                                buat pengaturan baru lalu
                                                hentikan yang ini; nomor yang
                                                sudah terbit tetap utuh.
                                            </FieldDescription>
                                        )}
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="segments"
                                        title="Format"
                                        summary={`${preview(form.segments, Number(form.minimum_number) || 0)} – ${preview(form.segments, maximum ?? 0)}`}
                                    >
                                        <p
                                            className="mb-3 text-sm"
                                            aria-live="polite"
                                        >
                                            Nomor pertama dan terakhir:{' '}
                                            <strong>
                                                {preview(
                                                    form.segments,
                                                    Number(
                                                        form.minimum_number,
                                                    ) || 0,
                                                )}
                                            </strong>{' '}
                                            sampai{' '}
                                            <strong>
                                                {maximum === null
                                                    ? 'tanpa batas'
                                                    : preview(
                                                          form.segments,
                                                          maximum,
                                                      )}
                                            </strong>
                                        </p>
                                        {formatLocked && (
                                            <FieldDescription className="mb-3">
                                                Format terkunci karena nomor
                                                sudah diterbitkan.
                                            </FieldDescription>
                                        )}
                                        {error('segments') && (
                                            <p
                                                className="mb-3 text-sm text-destructive"
                                                data-error-field="segments"
                                            >
                                                {error('segments')}
                                            </p>
                                        )}
                                        <SegmentEditor
                                            segments={form.segments}
                                            onChange={(segments) =>
                                                set('segments', segments)
                                            }
                                            reference={reference}
                                            editable={editable && !formatLocked}
                                        />
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="general"
                                        title="Umum"
                                        summary={`${statusLabels[form.status]} · ${form.is_continuous ? 'Berkelanjutan' : 'Tidak berkelanjutan'}`}
                                    >
                                        <FormGrid>
                                            <FormControl
                                                error={error('status')}
                                                hint="Dipakai: dokumen baru mengambil nomor dari pengaturan ini. Dihentikan: tidak lagi menerbitkan nomor; nomor yang sudah terbit tetap utuh."
                                            >
                                                <RecordEditControl label="Status">
                                                    <Select
                                                        label="Status"
                                                        required
                                                        portalContainer={
                                                            contentRef
                                                        }
                                                        items={statuses.map(
                                                            (status) => ({
                                                                value: status,
                                                                label: statusLabels[
                                                                    status
                                                                ],
                                                            }),
                                                        )}
                                                        value={form.status}
                                                        onValueChange={(
                                                            value,
                                                        ) => {
                                                            const status =
                                                                statuses.find(
                                                                    (item) =>
                                                                        item ===
                                                                        value,
                                                                );
                                                            if (status)
                                                                set(
                                                                    'status',
                                                                    status,
                                                                );
                                                        }}
                                                    />
                                                </RecordEditControl>
                                            </FormControl>
                                            <FormControl
                                                error={error('reset_period')}
                                            >
                                                <RecordEditControl label="Reset">
                                                    <Select
                                                        label="Mulai dari awal"
                                                        required
                                                        portalContainer={
                                                            contentRef
                                                        }
                                                        items={resetPeriods.map(
                                                            (period) => ({
                                                                value: period,
                                                                label: resetLabels[
                                                                    period
                                                                ],
                                                            }),
                                                        )}
                                                        value={
                                                            form.reset_period
                                                        }
                                                        onValueChange={(
                                                            value,
                                                        ) => {
                                                            const period =
                                                                resetPeriods.find(
                                                                    (item) =>
                                                                        item ===
                                                                        value,
                                                                );
                                                            if (period)
                                                                set(
                                                                    'reset_period',
                                                                    period,
                                                                );
                                                        }}
                                                    />
                                                </RecordEditControl>
                                            </FormControl>
                                            <FormControl
                                                error={error('minimum_number')}
                                            >
                                                <Input
                                                    label="Nomor terkecil"
                                                    required
                                                    inputMode="numeric"
                                                    readOnly={!editable}
                                                    value={form.minimum_number}
                                                    onChange={(event) =>
                                                        set(
                                                            'minimum_number',
                                                            event.target.value,
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                            <FormControl
                                                error={error('maximum_number')}
                                            >
                                                <Input
                                                    label="Nomor terbesar"
                                                    inputMode="numeric"
                                                    readOnly={!editable}
                                                    value={form.maximum_number}
                                                    onChange={(event) =>
                                                        set(
                                                            'maximum_number',
                                                            event.target.value,
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                            {!creating && (
                                                <FormControl
                                                    error={error('next_number')}
                                                    hint="Nomor berikutnya hanya boleh dinaikkan. Nomor berkelanjutan tidak bisa dilompati."
                                                >
                                                    <Input
                                                        label="Nomor berikutnya"
                                                        inputMode="numeric"
                                                        readOnly={
                                                            !editable ||
                                                            form.is_continuous
                                                        }
                                                        value={form.next_number}
                                                        onChange={(event) =>
                                                            set(
                                                                'next_number',
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                            )}
                                            <SwitchField
                                                id="sequence-continuous"
                                                label="Berkelanjutan (tanpa nomor yang terlewat)"
                                                checked={form.is_continuous}
                                                onChange={(value) =>
                                                    set('is_continuous', value)
                                                }
                                                error={error('is_continuous')}
                                                hint="Nomor dokumen yang batal disimpan dipakai lagi, jadi tidak ada nomor yang terlewat. Hanya untuk dokumen yang memang diaudit, karena lebih lambat. Mengubah pengaturan yang sudah dipakai menjadi berkelanjutan tidak membuat nomor lamanya tanpa celah."
                                            />
                                            <SwitchField
                                                id="sequence-automatic"
                                                label="Nomor dibuat otomatis"
                                                checked={form.allow_automatic}
                                                onChange={(value) =>
                                                    set(
                                                        'allow_automatic',
                                                        value,
                                                    )
                                                }
                                                error={error('allow_automatic')}
                                            />
                                            <SwitchField
                                                id="sequence-manual"
                                                label="Nomor boleh diketik sendiri (manual)"
                                                checked={form.allow_manual}
                                                onChange={(value) =>
                                                    set('allow_manual', value)
                                                }
                                                error={error('allow_manual')}
                                            />
                                        </FormGrid>
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="user-changes"
                                        title="Izinkan pengguna mengubah nomor"
                                        summary={
                                            [
                                                form.allow_lower_number
                                                    ? 'Ke nomor lebih kecil'
                                                    : null,
                                                form.allow_higher_number
                                                    ? 'Ke nomor lebih besar'
                                                    : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ') || 'Tidak'
                                        }
                                    >
                                        <FormGrid>
                                            <SwitchField
                                                id="sequence-lower"
                                                label="Ke nomor yang lebih kecil"
                                                checked={
                                                    form.allow_lower_number
                                                }
                                                onChange={(value) =>
                                                    set(
                                                        'allow_lower_number',
                                                        value,
                                                    )
                                                }
                                                error={error(
                                                    'allow_lower_number',
                                                )}
                                                hint="Pengguna boleh mengganti nomor otomatis dengan nomor yang lebih kecil dari nomor berikutnya, selama formatnya sama dan nomor itu belum pernah dipakai."
                                            />
                                            <SwitchField
                                                id="sequence-higher"
                                                label="Ke nomor yang lebih besar"
                                                checked={
                                                    form.allow_higher_number
                                                }
                                                onChange={(value) =>
                                                    set(
                                                        'allow_higher_number',
                                                        value,
                                                    )
                                                }
                                                error={error(
                                                    'allow_higher_number',
                                                )}
                                                hint="Pengguna boleh mengganti nomor otomatis dengan nomor yang lebih besar dari nomor berikutnya. Nomor otomatis berikutnya melewati nomor itu."
                                            />
                                        </FormGrid>
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="performance"
                                        title="Performa"
                                        summary={
                                            form.preallocation_enabled
                                                ? `Ambil ${form.preallocation_quantity} nomor sekaligus`
                                                : 'Satu per satu'
                                        }
                                    >
                                        <FormGrid>
                                            <SwitchField
                                                id="sequence-preallocation"
                                                label="Siapkan nomor sekaligus (preallocation)"
                                                checked={
                                                    form.preallocation_enabled
                                                }
                                                onChange={(value) =>
                                                    set(
                                                        'preallocation_enabled',
                                                        value,
                                                    )
                                                }
                                                error={error(
                                                    'preallocation_enabled',
                                                )}
                                                hint="Nomor disiapkan dalam satu blok agar dokumen yang disimpan bersamaan tidak saling menunggu. Nomor blok yang tidak terpakai bisa terlewat pada pengaturan yang tidak berkelanjutan."
                                            />
                                            <FormControl
                                                error={error(
                                                    'preallocation_quantity',
                                                )}
                                            >
                                                <Input
                                                    label="Jumlah nomor per blok"
                                                    inputMode="numeric"
                                                    readOnly={
                                                        !editable ||
                                                        !form.preallocation_enabled
                                                    }
                                                    value={
                                                        form.preallocation_quantity
                                                    }
                                                    onChange={(event) =>
                                                        set(
                                                            'preallocation_quantity',
                                                            event.target.value,
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                        </FormGrid>
                                    </CollapsibleSection>
                                    {record && (
                                        <CollapsibleSection
                                            value="status-list"
                                            title="Nomor yang sedang dipesan"
                                        >
                                            <StatusList
                                                sequenceId={record.id}
                                                canManage={metadata.canManage}
                                            />
                                        </CollapsibleSection>
                                    )}
                                </CollapsibleSectionGroup>
                            </RecordEditBoundary>
                        </PageDialogBody>
                    </form>
                )}
            </PageDialogContent>
        </PageDialog>
    );
}

function SwitchField({
    id,
    label,
    checked,
    onChange,
    error,
    hint,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    error?: string | undefined;
    hint?: string;
}) {
    return (
        <FormControl error={error} hint={hint}>
            <RecordEditControl label={label}>
                <Field orientation="horizontal" className="w-auto">
                    <Switch
                        id={id}
                        checked={checked}
                        onCheckedChange={onChange}
                    />
                    <FieldLabel htmlFor={id} className="font-normal">
                        {label}
                    </FieldLabel>
                </Field>
            </RecordEditControl>
        </FormControl>
    );
}
