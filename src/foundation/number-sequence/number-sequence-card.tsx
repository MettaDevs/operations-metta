import { ActionButton } from '@operations-metta/ui/action-button';
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
    FieldLegend,
    FieldSet,
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
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser, ListChecks } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../platform/shell/index.ts';
import {
    formatOf,
    rowsOf,
    scopeSegmentLabel,
    SegmentGrid,
    type ScopeType,
    type SegmentRow,
} from './number-sequence-segments.tsx';

// Kartu satu number sequence, dengan bagian dan urutan kartu Number sequences F&O: Identifikasi, Scope, Segmen
// (dengan Format terhitung), Pengaturan lain untuk jenis nomor yang sama (pengganti References), Umum, dan Performa.
// Status list dan Bersihkan manual ada di grup Administrasi di atas kartu, seperti toolbar F&O.

export type Metadata = ApiBody<'numberSequenceMetadata'>['data'];
type Reference = Metadata['references'][number];
type Stored = ApiBody<'numberSequenceShow'>['data'];
type ScopeValue = ApiBody<'numberSequenceScopeValues'>['data'][number];
type Errors = Record<string, string[]>;

export const scopeLabels: Record<ScopeType, string> = {
    tenant: 'Shared (semua legal entity)',
    legal_entity: 'Legal entity',
    operating_unit: 'Operating unit',
    legal_entity_fiscal_period: 'Legal entity dan periode fiskal',
};
export const statusLabels: Record<Stored['status'], string> = {
    draft: 'Belum dipakai',
    active: 'Dipakai',
    stopped: 'Dihentikan',
};
const resetLabels: Record<Stored['reset_period'], string> = {
    never: 'Tidak pernah',
    calendar_year: 'Setiap tahun kalender',
    fiscal_year: 'Setiap tahun fiskal',
    fiscal_period: 'Setiap periode fiskal',
};
const scopeTypes: ScopeType[] = [
    'tenant',
    'legal_entity',
    'operating_unit',
    'legal_entity_fiscal_period',
];
const resetPeriods: Stored['reset_period'][] = [
    'never',
    'calendar_year',
    'fiscal_year',
    'fiscal_period',
];
const scopeValueColumns = [
    {
        id: 'code',
        header: 'Kode',
        cell: (item: ScopeValue) => item.code ?? '-',
    },
    { id: 'name', header: 'Nama', cell: (item: ScopeValue) => item.name },
];

// Kolom "Berlaku untuk" di daftar dan di tabel pengaturan lain.
export function appliesTo(row: {
    scope_value_name: string | null;
    fiscal_period_name: string | null;
}): string {
    return (
        [row.scope_value_name, row.fiscal_period_name]
            .filter(Boolean)
            .join(' · ') || 'Semua legal entity'
    );
}

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
    segments: SegmentRow[];
};

// Segmen organisasi ada di depan format bila scope memilih organisasi, seperti F&O yang menambahkan segmen Legal
// entity begitu scope Legal entity dipilih. Shared tidak punya organisasi untuk dicetak, jadi segmennya dibuang.
function segmentsForScope(rows: SegmentRow[], scope: ScopeType): SegmentRow[] {
    const hasScope = rows.some((row) => row.segment.type === 'scope');
    if (scope === 'tenant') {
        const index = rows.findIndex((row) => row.segment.type === 'scope');
        const following = rows[index + 1]?.segment;
        return rows.filter(
            (row, position) =>
                row.segment.type !== 'scope' &&
                !(
                    position === index + 1 &&
                    following?.type === 'constant' &&
                    following.value === '-'
                ),
        );
    }
    if (hasScope) return rows;
    return [
        ...rowsOf([{ type: 'scope' }, { type: 'constant', value: '-' }]),
        ...rows,
    ];
}

function emptyDraft(reference: Reference | undefined): Draft {
    const allowed = reference?.allowed_scopes[0];
    const scope: ScopeType =
        allowed === 'legal_entity' || allowed === 'operating_unit'
            ? allowed
            : 'tenant';
    return {
        reference_id: reference?.id ?? '',
        scope_type: scope,
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
        segments: segmentsForScope(
            rowsOf([
                ...(reference?.default_prefix
                    ? [
                          {
                              type: 'constant' as const,
                              value: reference.default_prefix,
                          },
                      ]
                    : []),
                { type: 'number', length: 5 },
            ]),
            scope,
        ),
    };
}

function storedDraft(stored: Stored): Draft {
    const value = (id: string | null) =>
        id === null
            ? null
            : {
                  id,
                  name: stored.scope_value_name ?? id,
                  code: stored.scope_code,
              };
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
        segments: rowsOf(stored.segments),
    };
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
    portalContainer: RefObject<HTMLDivElement | null>;
}): ReactNode {
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
            getItemLabel={(item) =>
                item.code ? `${item.code} · ${item.name}` : item.name
            }
            columns={scopeValueColumns}
            portalContainer={portalContainer}
            showDetails={false}
        />
    );
}

// References F&O menampilkan jenis nomor yang memakai sequence ini. Di sini satu sequence milik satu jenis nomor,
// jadi yang berguna adalah kebalikannya: pengaturan lain untuk jenis nomor yang sama, satu per nilai scope.
function SiblingSequences({
    referenceId,
    currentId,
    onOpen,
}: {
    referenceId: string;
    currentId: string | null;
    onOpen: ((id: string) => void) | undefined;
}): ReactNode {
    const list = useQuery({
        queryKey: ['number-sequence-siblings', referenceId],
        queryFn: async () =>
            (
                await api.numberSequenceList({
                    query: { reference_id: referenceId, per_page: 100 },
                })
            ).body.data,
        enabled: referenceId !== '',
    });
    const rows = (list.data ?? []).filter((row) => row.id !== currentId);
    if (list.isError)
        return (
            <p className="text-sm text-destructive">
                {errorText(list.error, 'Pengaturan lain belum bisa dimuat.')}
            </p>
        );
    return (
        <DataTable
            data={rows}
            getRowKey={(row) => row.id}
            getRowLabel={(row) => appliesTo(row)}
            scrollMode="inline"
            showRowNumbers={false}
            onRowClick={onOpen ? (row) => onOpen(row.id) : undefined}
            emptyMessage={
                list.isPending
                    ? 'Memuat pengaturan lain...'
                    : 'Belum ada pengaturan lain untuk jenis nomor ini.'
            }
            columns={[
                {
                    id: 'scope',
                    header: 'Scope',
                    cell: (row) => (
                        <DataTableText>
                            {scopeLabels[row.scope_type]}
                        </DataTableText>
                    ),
                },
                {
                    id: 'applies',
                    header: 'Berlaku untuk',
                    cell: (row) => (
                        <DataTableText>{appliesTo(row)}</DataTableText>
                    ),
                },
                {
                    id: 'format',
                    header: 'Format',
                    cell: (row) => <DataTableText>{row.format}</DataTableText>,
                },
                {
                    id: 'status',
                    header: 'Status',
                    cell: (row) => (
                        <DataTableText>
                            {statusLabels[row.status]}
                        </DataTableText>
                    ),
                },
            ]}
        />
    );
}

export function NumberSequenceCard({
    sequenceId,
    metadata,
    onClose,
    onSaved,
    onOpenSequence,
    onStatusList,
    onCleanup,
}: {
    sequenceId: string | null;
    metadata: Metadata;
    onClose: () => void;
    onSaved: (stored: Stored) => void;
    onOpenSequence: (id: string) => void;
    onStatusList: (stored: Stored) => void;
    onCleanup: (stored: Stored) => void;
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
    // Pengaturan tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya. Field cakupan tetap
    // terkunci setelah dibuat.
    const editing = creating || metadata.canManage;
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
            segments: form.segments.map((row) => row.segment),
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
            // Halaman memasang ulang kartu dengan data ini, jadi isian yang tersisa berasal dari hasil simpan.
            queryClient.setQueryData(['number-sequence', saved.id], saved);
            void queryClient.invalidateQueries({
                queryKey: ['number-sequence-siblings', saved.reference_id],
            });
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
    const scopeValue =
        form?.scope_type === 'operating_unit'
            ? form.operating_unit
            : (form?.legal_entity ?? null);
    const scopeCode = scopeValue?.code ?? null;
    const fiscal =
        form?.scope_type === 'legal_entity_fiscal_period' ||
        (form?.scope_type !== 'tenant' &&
            Boolean(form?.reset_period.startsWith('fiscal')));
    const segments = form?.segments.map((row) => row.segment) ?? [];
    const scopeSummary = form
        ? `${scopeLabels[form.scope_type]}${scopeValue ? ` · ${scopeValue.name}` : ''}${form.fiscal_period ? ` · ${form.fiscal_period.name}` : ''}`
        : '';
    const recordTitle = reference
        ? `${reference.name}${record ? ` · ${appliesTo(record)}` : ''}`
        : 'Pengaturan nomor baru';

    // Grup Administrasi F&O di atas kartu tersimpan: Status list dan Bersihkan manual.
    const administration = record ? (
        <>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onStatusList(record)}
            >
                <ListChecks aria-hidden="true" />
                Status list
            </Button>
            {metadata.canManage && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onCleanup(record)}
                >
                    <Eraser aria-hidden="true" />
                    Bersihkan manual
                </Button>
            )}
        </>
    ) : undefined;

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
                recordTitle={recordTitle}
                editing={editing}
                busy={busy}
                secondaryNavigation={administration}
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
                            <CollapsibleSectionGroup
                                defaultValue={[
                                    'identification',
                                    'scope',
                                    'segments',
                                    'references',
                                    'general',
                                    'performance',
                                ]}
                            >
                                <CollapsibleSection
                                    value="identification"
                                    title="Identifikasi"
                                    summary={
                                        reference
                                            ? `${reference.name} · ${reference.area_name}`
                                            : ''
                                    }
                                >
                                    <FormGrid>
                                        {creating ? (
                                            <FormControl
                                                error={error('reference_id')}
                                                hint="Dokumen atau master yang diberi nomor. Satu jenis nomor boleh punya pengaturan sendiri untuk setiap legal entity, operating unit, atau periode fiskal."
                                            >
                                                <Select
                                                    label="Jenis nomor"
                                                    searchPlaceholder="Cari jenis nomor"
                                                    emptyMessage="Jenis nomor tidak ditemukan."
                                                    required
                                                    portalContainer={contentRef}
                                                    items={metadata.references.map(
                                                        (item) => ({
                                                            value: item.id,
                                                            label: item.name,
                                                        }),
                                                    )}
                                                    value={form.reference_id}
                                                    onValueChange={(value) => {
                                                        const next =
                                                            metadata.references.find(
                                                                (item) =>
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
                                        ) : (
                                            <FormControl>
                                                <Input
                                                    label="Jenis nomor"
                                                    readOnly
                                                    value={
                                                        reference?.name ??
                                                        record?.reference_name ??
                                                        ''
                                                    }
                                                />
                                            </FormControl>
                                        )}
                                        <FormControl>
                                            <Input
                                                label="Area"
                                                readOnly
                                                value={
                                                    reference?.area_name ??
                                                    record?.area_name ??
                                                    ''
                                                }
                                            />
                                        </FormControl>
                                    </FormGrid>
                                </CollapsibleSection>
                                <CollapsibleSection
                                    value="scope"
                                    title="Scope"
                                    summary={scopeSummary}
                                >
                                    {creating ? (
                                        <FormGrid>
                                            <FormControl
                                                error={error('scope_type')}
                                                hint="Shared memakai satu urutan nomor untuk semua legal entity. Legal entity, operating unit, atau periode fiskal memberi urutan nomor sendiri untuk organisasi yang dipilih."
                                            >
                                                <Select
                                                    label="Scope"
                                                    searchPlaceholder="Cari scope"
                                                    required
                                                    portalContainer={contentRef}
                                                    items={scopeTypes
                                                        .filter((type) =>
                                                            reference?.allowed_scopes.includes(
                                                                type ===
                                                                    'legal_entity_fiscal_period'
                                                                    ? 'legal_entity'
                                                                    : type,
                                                            ),
                                                        )
                                                        .map((type) => ({
                                                            value: type,
                                                            label: scopeLabels[
                                                                type
                                                            ],
                                                        }))}
                                                    value={form.scope_type}
                                                    onValueChange={(value) => {
                                                        const type =
                                                            scopeTypes.find(
                                                                (item) =>
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
                                                                        'legal_entity_fiscal_period' ||
                                                                    type ===
                                                                        'tenant'
                                                                        ? form.reset_period.startsWith(
                                                                              'fiscal',
                                                                          )
                                                                            ? 'never'
                                                                            : form.reset_period
                                                                        : form.reset_period,
                                                                segments:
                                                                    segmentsForScope(
                                                                        form.segments,
                                                                        type,
                                                                    ),
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
                                                        label="Legal entity"
                                                        kind="legal_entity"
                                                        value={
                                                            form.legal_entity
                                                        }
                                                        onChange={(value) =>
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
                                                        label="Operating unit"
                                                        kind="operating_unit"
                                                        value={
                                                            form.operating_unit
                                                        }
                                                        onChange={(value) =>
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
                                                            onChange={(value) =>
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
                                        </FormGrid>
                                    ) : (
                                        <>
                                            <FormGrid>
                                                <FormControl>
                                                    <Input
                                                        label="Scope"
                                                        readOnly
                                                        value={
                                                            scopeLabels[
                                                                form.scope_type
                                                            ]
                                                        }
                                                    />
                                                </FormControl>
                                                {scopeValue && (
                                                    <FormControl>
                                                        <Input
                                                            label={scopeSegmentLabel(
                                                                form.scope_type,
                                                            )}
                                                            readOnly
                                                            value={
                                                                scopeCode
                                                                    ? `${scopeCode} · ${scopeValue.name}`
                                                                    : scopeValue.name
                                                            }
                                                        />
                                                    </FormControl>
                                                )}
                                                {form.fiscal_period && (
                                                    <FormControl>
                                                        <Input
                                                            label="Periode fiskal"
                                                            readOnly
                                                            value={
                                                                form
                                                                    .fiscal_period
                                                                    .name
                                                            }
                                                        />
                                                    </FormControl>
                                                )}
                                            </FormGrid>
                                            <FieldDescription className="mt-2">
                                                Scope dan organisasinya tidak
                                                bisa diubah setelah disimpan.
                                                Untuk aturan baru, buat
                                                pengaturan baru lalu hentikan
                                                yang ini; nomor yang sudah
                                                terbit tetap utuh.
                                            </FieldDescription>
                                        </>
                                    )}
                                </CollapsibleSection>
                                <CollapsibleSection
                                    value="segments"
                                    title="Segmen"
                                    summary={formatOf(
                                        segments,
                                        form.scope_type,
                                        scopeCode,
                                    )}
                                >
                                    <div className="flex flex-col gap-3">
                                        {formatLocked && (
                                            <FieldDescription>
                                                Segmen terkunci karena nomor
                                                sudah diterbitkan.
                                            </FieldDescription>
                                        )}
                                        {error('segments') && (
                                            <p
                                                className="text-sm text-destructive"
                                                data-error-field="segments"
                                            >
                                                {error('segments')}
                                            </p>
                                        )}
                                        <SegmentGrid
                                            rows={form.segments}
                                            onChange={(rows) =>
                                                set('segments', rows)
                                            }
                                            scope={form.scope_type}
                                            scopeCode={scopeCode}
                                            fiscal={fiscal}
                                            reference={reference}
                                            editable={editable && !formatLocked}
                                            portalContainer={contentRef}
                                        />
                                        <FormGrid>
                                            <FormControl>
                                                <Input
                                                    label="Format"
                                                    readOnly
                                                    value={formatOf(
                                                        segments,
                                                        form.scope_type,
                                                        scopeCode,
                                                    )}
                                                />
                                            </FormControl>
                                        </FormGrid>
                                        <p
                                            className="text-sm text-muted-foreground"
                                            aria-live="polite"
                                        >
                                            Nomor pertama{' '}
                                            <strong className="text-foreground">
                                                {formatOf(
                                                    segments,
                                                    form.scope_type,
                                                    scopeCode,
                                                    Number(
                                                        form.minimum_number,
                                                    ) || 0,
                                                )}
                                            </strong>
                                            , nomor terakhir{' '}
                                            <strong className="text-foreground">
                                                {maximum === null
                                                    ? 'tanpa batas'
                                                    : formatOf(
                                                          segments,
                                                          form.scope_type,
                                                          scopeCode,
                                                          maximum,
                                                      )}
                                            </strong>
                                            .
                                        </p>
                                    </div>
                                </CollapsibleSection>
                                <CollapsibleSection
                                    value="references"
                                    title="Pengaturan lain untuk jenis nomor ini"
                                >
                                    <SiblingSequences
                                        referenceId={form.reference_id}
                                        currentId={record?.id ?? null}
                                        // Pindah ke pengaturan lain membuang perubahan yang belum disimpan, jadi hanya
                                        // ditawarkan selama belum ada perubahan.
                                        onOpen={
                                            draft === null
                                                ? onOpenSequence
                                                : undefined
                                        }
                                    />
                                </CollapsibleSection>
                                <CollapsibleSection
                                    value="general"
                                    title="Umum"
                                    summary={`${statusLabels[form.status]} · ${form.is_continuous ? 'Berkelanjutan' : 'Boleh ada nomor terlewat'}`}
                                >
                                    <div className="flex flex-col gap-4">
                                        <FieldSet className="gap-0">
                                            <FieldLegend variant="label">
                                                Penyiapan
                                            </FieldLegend>
                                            <FormGrid>
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-in-use"
                                                    label="Dipakai"
                                                    checked={
                                                        form.status !== 'draft'
                                                    }
                                                    onChange={(value) =>
                                                        set(
                                                            'status',
                                                            value
                                                                ? 'active'
                                                                : 'draft',
                                                        )
                                                    }
                                                    error={error('status')}
                                                    hint="Dokumen baru mengambil nomor dari pengaturan yang dipakai dan tidak dihentikan."
                                                />
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-stopped"
                                                    label="Dihentikan"
                                                    checked={
                                                        form.status ===
                                                        'stopped'
                                                    }
                                                    onChange={(value) =>
                                                        set(
                                                            'status',
                                                            value
                                                                ? 'stopped'
                                                                : 'active',
                                                        )
                                                    }
                                                    hint="Pengaturan yang dihentikan tidak lagi menerbitkan nomor. Nomor yang sudah terbit tetap utuh."
                                                />
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-manual"
                                                    label="Manual"
                                                    checked={form.allow_manual}
                                                    onChange={(value) => {
                                                        if (!editing) return;
                                                        setDraft({
                                                            ...form,
                                                            allow_manual: value,
                                                            allow_automatic:
                                                                !value,
                                                        });
                                                    }}
                                                    error={
                                                        error('allow_manual') ??
                                                        error('allow_automatic')
                                                    }
                                                    hint="Pengguna mengetik nomornya sendiri saat membuat dokumen; tidak ada nomor otomatis."
                                                />
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-continuous"
                                                    label="Berkelanjutan"
                                                    checked={form.is_continuous}
                                                    onChange={(value) =>
                                                        set(
                                                            'is_continuous',
                                                            value,
                                                        )
                                                    }
                                                    error={error(
                                                        'is_continuous',
                                                    )}
                                                    hint="Tidak ada nomor yang terlewat: nomor dokumen yang batal disimpan dipakai lagi. Hanya untuk dokumen yang memang diaudit, karena lebih lambat."
                                                />
                                            </FormGrid>
                                        </FieldSet>
                                        <FieldSet className="gap-0">
                                            <FieldLegend variant="label">
                                                Izinkan pengguna mengubah nomor
                                            </FieldLegend>
                                            <FormGrid>
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-lower"
                                                    label="Ke nomor lebih kecil"
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
                                                    hint="Nomor otomatis boleh diganti dengan nomor yang lebih kecil dari nomor berikutnya, selama formatnya sama dan nomor itu belum pernah dipakai."
                                                />
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-higher"
                                                    label="Ke nomor lebih besar"
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
                                                    hint="Nomor otomatis boleh diganti dengan nomor yang lebih besar. Nomor otomatis berikutnya melewati nomor itu."
                                                />
                                            </FormGrid>
                                        </FieldSet>
                                        <FieldSet className="gap-0">
                                            <FieldLegend variant="label">
                                                Alokasi nomor
                                            </FieldLegend>
                                            <FormGrid>
                                                <FormControl
                                                    error={error(
                                                        'minimum_number',
                                                    )}
                                                >
                                                    <Input
                                                        label="Terkecil"
                                                        required
                                                        inputMode="numeric"
                                                        readOnly={!editable}
                                                        value={
                                                            form.minimum_number
                                                        }
                                                        onChange={(event) =>
                                                            set(
                                                                'minimum_number',
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormControl
                                                    error={error(
                                                        'maximum_number',
                                                    )}
                                                >
                                                    <Input
                                                        label="Terbesar"
                                                        inputMode="numeric"
                                                        readOnly={!editable}
                                                        value={
                                                            form.maximum_number
                                                        }
                                                        onChange={(event) =>
                                                            set(
                                                                'maximum_number',
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormControl
                                                    error={error('next_number')}
                                                    hint={
                                                        creating
                                                            ? 'Nomor berikutnya mulai dari nomor terkecil.'
                                                            : 'Nomor berikutnya hanya boleh dinaikkan. Nomor berkelanjutan tidak bisa dilompati.'
                                                    }
                                                >
                                                    <Input
                                                        label="Berikutnya"
                                                        inputMode="numeric"
                                                        readOnly={
                                                            creating ||
                                                            !editable ||
                                                            form.is_continuous
                                                        }
                                                        value={
                                                            creating
                                                                ? form.minimum_number
                                                                : form.next_number
                                                        }
                                                        onChange={(event) =>
                                                            set(
                                                                'next_number',
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormControl
                                                    error={error(
                                                        'reset_period',
                                                    )}
                                                >
                                                    <Select
                                                        label="Reset setiap"
                                                        searchPlaceholder="Cari"
                                                        required
                                                        portalContainer={
                                                            contentRef
                                                        }
                                                        items={resetPeriods
                                                            .filter(
                                                                (period) =>
                                                                    !period.startsWith(
                                                                        'fiscal',
                                                                    ) ||
                                                                    (form.scope_type !==
                                                                        'tenant' &&
                                                                        form.scope_type !==
                                                                            'legal_entity_fiscal_period'),
                                                            )
                                                            .map((period) => ({
                                                                value: period,
                                                                label: resetLabels[
                                                                    period
                                                                ],
                                                            }))}
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
                                                </FormControl>
                                            </FormGrid>
                                        </FieldSet>
                                    </div>
                                </CollapsibleSection>
                                <CollapsibleSection
                                    value="performance"
                                    title="Performa"
                                    summary={
                                        form.preallocation_enabled
                                            ? `Siapkan ${form.preallocation_quantity} nomor sekaligus`
                                            : 'Nomor diambil satu per satu'
                                    }
                                >
                                    <div className="flex flex-col gap-4">
                                        <FieldDescription>
                                            Nomor disiapkan per blok agar
                                            dokumen yang disimpan bersamaan
                                            tidak saling menunggu. Pada
                                            pengaturan yang tidak berkelanjutan,
                                            sisa blok yang tidak terpakai bisa
                                            membuat nomor terlewat.
                                        </FieldDescription>
                                        <FieldSet className="gap-0">
                                            <FieldLegend variant="label">
                                                Siapkan nomor sekaligus
                                            </FieldLegend>
                                            <FormGrid>
                                                <SwitchField
                                                    disabled={!editable}
                                                    id="sequence-preallocation"
                                                    label="Preallocation"
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
                                                />
                                                <FormControl
                                                    error={error(
                                                        'preallocation_quantity',
                                                    )}
                                                >
                                                    <Input
                                                        label="Jumlah nomor"
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
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                            </FormGrid>
                                        </FieldSet>
                                        <FieldSet className="gap-0">
                                            <FieldLegend variant="label">
                                                Nomor yang sudah disiapkan
                                            </FieldLegend>
                                            <FormGrid>
                                                <FormControl>
                                                    <Input
                                                        label="Berikutnya"
                                                        readOnly
                                                        value={
                                                            record?.allocated_next ===
                                                                null ||
                                                            record === null
                                                                ? ''
                                                                : String(
                                                                      record.allocated_next,
                                                                  )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormControl>
                                                    <Input
                                                        label="Terbesar"
                                                        readOnly
                                                        value={
                                                            record?.allocated_last ===
                                                                null ||
                                                            record === null
                                                                ? ''
                                                                : String(
                                                                      record.allocated_last,
                                                                  )
                                                        }
                                                    />
                                                </FormControl>
                                            </FormGrid>
                                        </FieldSet>
                                    </div>
                                </CollapsibleSection>
                            </CollapsibleSectionGroup>
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
    disabled,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    error?: string | undefined;
    hint?: string;
    disabled: boolean;
}): ReactNode {
    return (
        <FormControl error={error} hint={hint}>
            <Field orientation="horizontal" className="w-auto">
                <Switch
                    id={id}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={onChange}
                />
                <FieldLabel htmlFor={id} className="font-normal">
                    {label}
                </FieldLabel>
            </Field>
        </FormControl>
    );
}
