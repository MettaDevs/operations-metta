import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import {
    DatePicker,
    dateValue,
    displayDate,
} from '@operations-metta/ui/date-picker';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookCheck, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';
import { CodeEntryCard } from '../code-list/code-list-screen.tsx';
import { reasonCodes } from '../code-list/code-list-sources.ts';
import { ReasonCodeLookup } from '../code-list/code-list-lookup.tsx';
import { ItemCard } from '../item/item-card.tsx';
import { LocationCard } from '../location/location-card.tsx';
import { LocationLookup } from '../location/location-lookup.tsx';
import type { Reference } from '../master-lookup.tsx';
import { AdjustmentEntries } from './adjustment-entries.tsx';
import {
    directionLabels,
    isDirection,
    StatusBadge,
    type Adjustment,
    type AdjustmentPermissions,
    type Direction,
} from './adjustment-labels.tsx';
import {
    AdjustmentLines,
    linesBody,
    linesOf,
    withItem,
    withoutDirectionValues,
    type LineDraft,
} from './adjustment-lines.tsx';

// Kartu penyesuaian stok (Item Journal BC dengan Positive dan Negative Adjmt., satu arah per dokumen). Draf disimpan
// utuh sekali Simpan; Posting menulis kartu gudang dan mengunci dokumen; Batal posting menulis baris pembalik dan
// menutup dokumen sebagai dibatalkan.

type Draft = {
    direction: Direction;
    postingDate: string;
    location: Reference | null;
    reason: Reference | null;
    lines: LineDraft[];
};

// Dokumen baru dimulai sebagai stok masuk bertanggal hari ini.
const draftOf = (document: Adjustment | null): Draft => ({
    direction: document?.direction ?? 'masuk',
    postingDate: document?.posting_date ?? dateValue(new Date()),
    location: document?.location ?? null,
    reason: document?.reason ?? null,
    lines: linesOf(document?.lines ?? []),
});

type Action = 'save' | 'delete' | 'post' | 'reverse';
const failedOperations: Record<Action, string> = {
    save: 'Penyesuaian stok belum disimpan',
    delete: 'Penyesuaian stok belum dihapus',
    post: 'Penyesuaian stok belum diposting',
    reverse: 'Posting belum dibatalkan',
};

type Creating =
    | { kind: 'location' }
    | { kind: 'reason' }
    | { kind: 'item'; lineKey: string };

const reference = (row: Reference): Reference => ({
    id: row.id,
    code: row.code,
    name: row.name,
});

export function AdjustmentCard({
    documentId,
    permissions,
    portalContainer,
    onSaved,
    onCancelNew,
    onDeleted,
    onBusyChange,
    onDirtyChange,
}: {
    documentId: string | null;
    // Izin dari daftar, dipakai untuk dokumen baru; dokumen tersimpan memakai izin dari jawaban dokumennya.
    permissions: AdjustmentPermissions;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (document: Adjustment) => void;
    onCancelNew: () => void;
    onDeleted: () => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const stored = useQuery({
        queryKey: ['inventory-adjustment', documentId],
        queryFn: async () => {
            if (documentId === null)
                throw new Error('Dokumen belum tersimpan.');
            return (
                await api.inventoryAdjustmentShow({
                    params: { id: documentId },
                })
            ).body;
        },
        enabled: documentId !== null,
        // Versi baru dari server memasang ulang form; memuat ulang saat jendela kembali aktif bisa membuang draf.
        refetchOnWindowFocus: false,
    });
    if (documentId !== null && !stored.data)
        return (
            <div className="space-y-3 p-6">
                <p
                    role={stored.isError ? 'alert' : 'status'}
                    className={
                        stored.isError
                            ? 'text-sm text-destructive'
                            : 'text-sm text-muted-foreground'
                    }
                >
                    {stored.isError
                        ? errorText(
                              stored.error,
                              'Penyesuaian stok belum dapat dimuat.',
                          )
                        : 'Memuat penyesuaian stok…'}
                </p>
                {stored.isError && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void stored.refetch()}
                    >
                        Coba lagi
                    </Button>
                )}
            </div>
        );
    const document = stored.data?.data ?? null;
    const allowed = stored.data?.permissions ?? permissions;
    return (
        <AdjustmentForm
            key={document ? `${document.id}:${document.version}` : 'new'}
            document={document}
            permissions={allowed}
            portalContainer={portalContainer}
            onSaved={(saved) => {
                queryClient.setQueryData(['inventory-adjustment', saved.id], {
                    data: saved,
                    permissions: allowed,
                });
                onSaved(saved);
            }}
            onCancelNew={onCancelNew}
            onDeleted={onDeleted}
            onBusyChange={onBusyChange}
            onDirtyChange={onDirtyChange}
        />
    );
}

function AdjustmentForm({
    document,
    permissions,
    portalContainer,
    onSaved,
    onCancelNew,
    onDeleted,
    onBusyChange,
    onDirtyChange,
}: {
    document: Adjustment | null;
    permissions: AdjustmentPermissions;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (document: Adjustment) => void;
    onCancelNew: () => void;
    onDeleted: () => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const status = document?.status ?? 'draf';
    // Hanya draf yang bisa diubah; dokumen yang sudah diposting atau dibatalkan selalu baca saja.
    const editing =
        document === null || (status === 'draf' && permissions.update);
    const [draft, setDraft] = useState<Draft>(() => draftOf(document));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [action, setAction] = useState<Action>('save');
    const [creating, setCreating] = useState<Creating | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty =
        editing && JSON.stringify(draft) !== JSON.stringify(draftOf(document));
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => {
        onBusyChange(busy);
    }, [busy, onBusyChange]);
    useEffect(
        () => () => {
            onDirtyChange(false);
            onBusyChange(false);
        },
        [onDirtyChange, onBusyChange],
    );
    usePageDialogRecord({
        recordTitle: document ? (
            <span className="inline-flex flex-wrap items-center gap-2">
                {document.number}
                <StatusBadge status={document.status} />
            </span>
        ) : (
            'Penyesuaian stok baru'
        ),
        editing,
        recordUrl: document
            ? `/sysadmin/inventory/adjustments?document=${document.id}`
            : undefined,
    });

    const run = async (next: Action, request: () => Promise<void>) => {
        setAction(next);
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await request();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, `${failedOperations[next]}.`));
        } finally {
            setBusy(false);
        }
    };

    const save = async () => {
        const lines = linesBody(draft.direction, draft.lines);
        if (Object.keys(lines.errors).length) {
            setAction('save');
            setMessage(null);
            setErrors(lines.errors);
            return;
        }
        await run('save', async () => {
            const body = {
                direction: draft.direction,
                location_id: draft.location?.id ?? '',
                posting_date: draft.postingDate,
                reason_id: draft.reason?.id ?? '',
                lines: lines.lines,
            };
            const { body: saved } = document
                ? await api.inventoryAdjustmentUpdate({
                      params: { id: document.id },
                      body: { ...body, version: document.version },
                  })
                : await api.inventoryAdjustmentCreate({ body });
            toast.success(
                document
                    ? 'Penyesuaian stok diperbarui.'
                    : `Penyesuaian stok ${saved.data.number} dibuat.`,
            );
            onSaved(saved.data);
        });
    };

    const remove = async () => {
        if (!document) return;
        if (
            !(await confirm({
                title: `Delete penyesuaian ${document.number}?`,
                description:
                    'Draf ini dihapus beserta barisnya. Stok tidak berubah, karena dokumen ini belum diposting.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run('delete', async () => {
            await api.inventoryAdjustmentDelete({
                params: { id: document.id },
                body: { version: document.version },
            });
            toast.success('Penyesuaian stok dihapus.');
            onDeleted();
        });
    };

    const post = async () => {
        if (!document) return;
        const change =
            document.direction === 'masuk' ? 'bertambah' : 'berkurang';
        if (
            !(await confirm({
                title: `Posting penyesuaian ${document.number}?`,
                description: `Stok barang di ${document.location.name} ${change} sesuai baris dokumen ini dan tercatat di kartu stok. Setelah diposting, dokumen tidak bisa diubah atau dihapus lagi; kesalahan diperbaiki lewat Batal posting.`,
                confirmLabel: 'Posting',
            }))
        )
            return;
        await run('post', async () => {
            const { body } = await api.inventoryAdjustmentPost({
                params: { id: document.id },
                body: { version: document.version },
            });
            toast.success(`Penyesuaian stok ${document.number} diposting.`);
            onSaved(body.data);
        });
    };

    const reverse = async () => {
        if (!document) return;
        if (
            !(await confirm({
                title: `Batal posting ${document.number}?`,
                description:
                    'Kartu stok mendapat baris pembalik yang mengembalikan stok seperti sebelum dokumen ini diposting. Dokumen ditutup sebagai dibatalkan dan tidak bisa diposting lagi; buat penyesuaian baru bila stok masih perlu disesuaikan.',
                confirmLabel: 'Batal posting',
                destructive: true,
            }))
        )
            return;
        await run('reverse', async () => {
            const { body } = await api.inventoryAdjustmentReverse({
                params: { id: document.id },
                body: { version: document.version },
            });
            toast.success(`Posting ${document.number} dibatalkan.`);
            onSaved(body.data);
        });
    };

    const cancel = () => {
        if (!document) {
            onCancelNew();
            return;
        }
        setDraft(draftOf(document));
        setErrors({});
        setMessage(null);
    };

    // Batch yang diambil milik lokasi lama, jadi ikut kosong saat lokasi diganti, sama seperti saat arah diganti.
    const changeLocation = (location: Reference) =>
        setDraft((current) =>
            current.location?.id === location.id
                ? current
                : {
                      ...current,
                      location: reference(location),
                      lines: current.lines.map((line) => ({
                          ...line,
                          batch: null,
                      })),
                  },
        );

    const changeDirection = (direction: Direction) =>
        setDraft((current) =>
            current.direction === direction
                ? current
                : {
                      ...current,
                      direction,
                      lines: current.lines.map(withoutDirectionValues),
                  },
        );

    // Kartu master yang dibuka lewat Baru pada pilihannya; record yang tersimpan langsung dipilih di dokumen.
    const masterCard = (): { title: string; card: ReactNode } | null => {
        if (!creating) return null;
        const close = () => setCreating(null);
        switch (creating.kind) {
            case 'location':
                return {
                    title: 'Lokasi',
                    card: (
                        <LocationCard
                            record={null}
                            canManage
                            onSaved={(location) => {
                                close();
                                changeLocation(location);
                            }}
                            onClose={close}
                        />
                    ),
                };
            case 'reason':
                return {
                    title: reasonCodes.title,
                    card: (
                        <CodeEntryCard
                            source={reasonCodes}
                            entry={null}
                            canManage
                            onSaved={(reason) => {
                                close();
                                setDraft((current) => ({
                                    ...current,
                                    reason: reference(reason),
                                }));
                            }}
                            onClose={close}
                        />
                    ),
                };
            case 'item':
                return {
                    title: 'Barang',
                    card: (
                        <ItemCard
                            record={null}
                            canManage
                            onSaved={(item) => {
                                close();
                                setDraft((current) => ({
                                    ...current,
                                    lines: current.lines.map((line) =>
                                        line.key === creating.lineKey
                                            ? withItem(line, item)
                                            : line,
                                    ),
                                }));
                            }}
                            onClose={close}
                        />
                    ),
                };
            default: {
                const unknown: never = creating;
                throw new Error(
                    `Unknown master to create: ${JSON.stringify(unknown)}`,
                );
            }
        }
    };
    const master = masterCard();

    const general = [
        directionLabels[draft.direction],
        draft.location?.name,
        draft.postingDate ? displayDate(draft.postingDate) : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="flex min-h-0 flex-1 flex-col">
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
                    {editing && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy && action === 'save'}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={cancel}
                            />
                        </>
                    )}
                    {document && status === 'draf' && permissions.update && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                    {document && status === 'draf' && permissions.post && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy || dirty}
                            title={
                                dirty
                                    ? 'Ada perubahan yang belum disimpan. Simpan atau batalkan dulu, karena posting memakai isi dokumen yang sudah tersimpan.'
                                    : 'Catat stok ke kartu stok dan kunci dokumen ini.'
                            }
                            onClick={() => void post()}
                        >
                            <BookCheck aria-hidden="true" />
                            Posting
                        </Button>
                    )}
                    {document &&
                        status === 'diposting' &&
                        permissions.reverse && (
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void reverse()}
                            >
                                <Undo2 aria-hidden="true" />
                                Batal posting
                            </Button>
                        )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={failedOperations[action]}
                />
                <PageDialogBody className="py-3">
                    <CollapsibleSectionGroup
                        defaultValue={['general', 'lines', 'entries']}
                    >
                        <CollapsibleSection
                            value="general"
                            title="Umum"
                            summary={general}
                        >
                            <FormGrid>
                                <FormControl
                                    hint={
                                        document
                                            ? undefined
                                            : 'Nomor diisi otomatis saat dokumen pertama kali disimpan, dari pengaturan nomor penyesuaian stok.'
                                    }
                                >
                                    <Input
                                        label="Nomor"
                                        value={document?.number ?? ''}
                                        placeholder={
                                            document
                                                ? undefined
                                                : 'Diisi otomatis saat disimpan'
                                        }
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl
                                    error={errors.direction?.[0]}
                                    data-error-field="direction"
                                >
                                    {editing ? (
                                        <Select
                                            label="Arah"
                                            required
                                            items={Object.entries(
                                                directionLabels,
                                            ).map(([value, label]) => ({
                                                value,
                                                label,
                                            }))}
                                            value={draft.direction}
                                            onValueChange={(value) => {
                                                if (isDirection(value))
                                                    changeDirection(value);
                                            }}
                                            searchPlaceholder="Cari arah"
                                            emptyMessage="Pilihan tidak ditemukan."
                                            portalContainer={portalContainer}
                                        />
                                    ) : (
                                        <Input
                                            label="Arah"
                                            value={
                                                directionLabels[draft.direction]
                                            }
                                            readOnly
                                        />
                                    )}
                                </FormControl>
                                <FormControl error={errors.posting_date?.[0]}>
                                    <DatePicker
                                        label="Tanggal"
                                        required
                                        data-error-field="posting_date"
                                        value={draft.postingDate}
                                        readOnly={!editing}
                                        onValueChange={(postingDate) =>
                                            setDraft((current) => ({
                                                ...current,
                                                postingDate,
                                            }))
                                        }
                                        portalContainer={portalContainer}
                                    />
                                </FormControl>
                                <LocationLookup
                                    label="Lokasi"
                                    required
                                    transit={false}
                                    field="location_id"
                                    value={draft.location}
                                    onChange={changeLocation}
                                    disabled={!editing}
                                    error={errors.location_id?.[0]}
                                    portalContainer={portalContainer}
                                    onCreate={
                                        editing
                                            ? () =>
                                                  setCreating({
                                                      kind: 'location',
                                                  })
                                            : undefined
                                    }
                                />
                                <ReasonCodeLookup
                                    label="Alasan"
                                    required
                                    field="reason_id"
                                    value={draft.reason}
                                    onChange={(reason) =>
                                        setDraft((current) => ({
                                            ...current,
                                            reason: reference(reason),
                                        }))
                                    }
                                    disabled={!editing}
                                    error={errors.reason_id?.[0]}
                                    portalContainer={portalContainer}
                                    onCreate={
                                        editing
                                            ? () =>
                                                  setCreating({
                                                      kind: 'reason',
                                                  })
                                            : undefined
                                    }
                                />
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="lines"
                            title="Baris"
                            summary={`${draft.lines.length} baris`}
                        >
                            <div data-error-field="lines">
                                <AdjustmentLines
                                    direction={draft.direction}
                                    lines={draft.lines}
                                    onChange={(lines) =>
                                        setDraft((current) => ({
                                            ...current,
                                            lines,
                                        }))
                                    }
                                    editing={editing}
                                    errors={errors}
                                    locationId={draft.location?.id ?? null}
                                    portalContainer={portalContainer}
                                    onCreateItem={
                                        editing
                                            ? (lineKey) =>
                                                  setCreating({
                                                      kind: 'item',
                                                      lineKey,
                                                  })
                                            : undefined
                                    }
                                />
                            </div>
                        </CollapsibleSection>
                        {document && document.status !== 'draf' && (
                            <AdjustmentEntries document={document} />
                        )}
                    </CollapsibleSectionGroup>
                </PageDialogBody>
                {confirmation}
            </form>
            {master && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreating(null);
                    }}
                >
                    <PageDialogContent title={master.title}>
                        {master.card}
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
