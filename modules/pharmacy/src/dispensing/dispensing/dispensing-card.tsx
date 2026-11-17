import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { Textarea } from '@operations-metta/ui/textarea';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Ban,
    BadgePercent,
    HandHeart,
    Megaphone,
    PackageCheck,
    RotateCcw,
    Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    PrintAction,
    type ErrorAction,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import { FeeLines } from '../dispensing-fee/fee-lines.tsx';
import { dateTimeText, Fact } from '../prescription/prescription-display.tsx';
import { PrescriptionFacts } from '../prescription/prescription-facts.tsx';
import {
    LocationLookup,
    locationLabel,
} from '../service-location/pharmacy-lookups.tsx';
import {
    ReturnCard,
    ReturnsSection,
    useCanReturn,
} from '../dispensing-return/dispensing-returns.tsx';
import { DispensingPriceCard } from './dispensing-price-card.tsx';
import { PrescriptionCancelDialog } from './prescription-cancel-dialog.tsx';
import {
    DispensingLines,
    type ItemOption,
    type LineDraft,
} from './dispensing-lines.tsx';

type View = ApiBody<'pharmacyDispensingShow'>;
type Dispensing = NonNullable<View['data']['dispensing']>;
type Person = { id: string; name: string };
export type DispensingStatus = Dispensing['status'];

export const statusLabels = {
    draf: 'Draf',
    disiapkan: 'Disiapkan',
    dipanggil: 'Dipanggil',
    diserahkan: 'Diserahkan',
    dibatalkan: 'Dibatalkan',
} as const satisfies Record<DispensingStatus, string>;

// Resep yang dibatalkan farmasi tampil Dibatalkan, apa pun status drafnya.
export function StatusBadge({
    status,
    cancelled = false,
}: {
    status: DispensingStatus | null;
    cancelled?: boolean;
}): ReactNode {
    return (
        <Badge variant={status === 'diserahkan' ? 'secondary' : 'outline'}>
            {cancelled
                ? 'Dibatalkan'
                : status === null
                  ? 'Menunggu'
                  : statusLabels[status]}
        </Badge>
    );
}

type Draft = {
    location: Reference | null;
    notes: string;
    pharmacist: Person | null;
    assistant: Person | null;
    lines: LineDraft[];
};

const draftOf = (view: View['data']): Draft => ({
    location: view.dispensing?.location ?? view.prescription.location,
    notes: view.dispensing?.notes ?? '',
    pharmacist: view.dispensing?.pharmacist ?? null,
    assistant: view.dispensing?.assistant ?? null,
    lines: view.lines.map((line) => ({
        prescriptionLineId: line.prescription_line_id,
        item: line.item,
        units: line.units,
        substitution: line.substitution,
        quantity: displayNumber(line.quantity),
        unit: { ...line.unit, quantity_per_unit: line.quantity_per_unit },
        batch: line.batch,
        reason: line.reason ?? '',
        taken: line.taken,
        price: line.price,
    })),
});

const receivers = [
    { value: 'patient', label: 'Pasien sendiri' },
    { value: 'other', label: 'Orang lain' },
];

const receiverText = (dispensing: Dispensing) =>
    dispensing.received_by_patient === null
        ? null
        : dispensing.received_by_patient
          ? 'Pasien sendiri'
          : dispensing.receiver_name;

type Action = 'save' | 'prepare' | 'call' | 'hand-over' | 'cancel';
const failedOperations: Record<Action, string> = {
    save: 'Penyerahan belum disimpan',
    prepare: 'Resep belum disiapkan',
    call: 'Pasien belum dipanggil',
    'hand-over': 'Obat belum diserahkan',
    cancel: 'Penyiapan belum dibatalkan',
};

const numberFormat =
    'Tulis angka seperti 10 atau 2,5. Titik untuk ribuan, koma untuk desimal.';

const loadStaff = async ({ query, signal }: LookupRequest) => {
    const { body } = await api.pharmacyStaffLookup(
        { query: { q: query } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

function StaffLookup({
    label,
    field,
    value,
    onChange,
    disabled,
    error,
    hint,
    portalContainer,
}: {
    label: string;
    field: string;
    value: Person | null;
    onChange: (person: Person) => void;
    disabled: boolean;
    error: string | undefined;
    hint: string;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    return (
        <MasterLookup
            label={label}
            field={field}
            value={value ? { ...value, code: '' } : null}
            onChange={(person) =>
                onChange({ id: person.id, name: person.name })
            }
            disabled={disabled}
            error={error}
            hint={hint}
            portalContainer={portalContainer}
            noun="Petugas"
            placeholder="Cari nama petugas…"
            load={loadStaff}
            columns={[nameColumn(260)]}
        />
    );
}

// Kartu penyerahan obat satu resep, dibuka dari antrean resep. Selama belum disiapkan, petugas mengubah jumlah, batch,
// alasan, lokasi, dan petugas; Siapkan menyimpan isian itu dan memposting stok keluar sekaligus.
export function DispensingCard({
    prescriptionId,
    portalContainer,
    onChanged,
    onBusyChange,
    onDirtyChange,
}: {
    prescriptionId: string;
    portalContainer: RefObject<HTMLElement | null>;
    onChanged: () => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const key = ['pharmacy-dispensing', prescriptionId];
    const stored = useQuery({
        queryKey: key,
        queryFn: async () =>
            (
                await api.pharmacyDispensingShow({
                    params: { id: prescriptionId },
                })
            ).body,
        refetchOnWindowFocus: false,
    });
    if (!stored.data)
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
                        ? errorText(stored.error, 'Resep belum dapat dimuat.')
                        : 'Memuat resep…'}
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
    const view = stored.data;
    return (
        <DispensingForm
            key={`${view.data.dispensing?.id ?? 'baru'}:${view.data.dispensing?.version ?? view.data.cancelled.length}`}
            view={view}
            portalContainer={portalContainer}
            onSaved={(next) => {
                queryClient.setQueryData(key, next);
                onChanged();
            }}
            onBusyChange={onBusyChange}
            onDirtyChange={onDirtyChange}
        />
    );
}

function DispensingForm({
    view,
    portalContainer,
    onSaved,
    onBusyChange,
    onDirtyChange,
}: {
    view: View;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (view: View) => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const { prescription, dispensing } = view.data;
    const { permissions } = view;
    const status = dispensing?.status ?? null;
    const cancelled = prescription.queue_status === 'dibatalkan';
    const editing =
        (status === null || status === 'draf') &&
        permissions.prepare &&
        !cancelled;
    const prepared = status !== null && status !== 'draf';
    const [draft, setDraft] = useState<Draft>(() => draftOf(view.data));
    const [receiver, setReceiver] = useState({ byPatient: true, name: '' });
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const [action, setAction] = useState<Action>('save');
    const [returning, setReturning] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [repricing, setRepricing] = useState(false);
    const returnContent = useRef<HTMLDivElement>(null);
    const { confirm, confirmation } = useConfirmation();
    const canReturn = useCanReturn(
        { kind: 'prescription', id: prescription.id },
        dispensing?.status === 'diserahkan',
    );
    const dirty =
        editing && JSON.stringify(draft) !== JSON.stringify(draftOf(view.data));
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
        recordTitle: (
            <span className="inline-flex flex-wrap items-center gap-2">
                {`${prescription.prescription_number} · ${prescription.patient_name}`}
                <StatusBadge status={status} cancelled={cancelled} />
            </span>
        ),
        editing,
        dirty,
        recordUrl: `/pharmacy/dispensing/prescriptions?prescription=${prescription.id}`,
    });
    const stock = new Map(
        view.data.stock.map((row) => [row.item_id, row.quantity]),
    );
    const itemOptions = new Map<string, ItemOption[]>(
        view.data.lines.map((line) => [
            line.prescription_line_id,
            line.item_options,
        ]),
    );

    const run = async (next: Action, request: () => Promise<View>) => {
        setAction(next);
        setBusy(true);
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        try {
            onSaved(await request());
            return true;
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422) {
                setErrors(caught.errors);
                setErrorActions(caught.actions);
            } else setMessage(errorText(caught, `${failedOperations[next]}.`));
            return false;
        } finally {
            setBusy(false);
        }
    };

    // Isian untuk API; angka yang tidak bisa dibaca pasti ditahan di layar dengan kesalahan per sel.
    const body = () => {
        const invalid: Record<string, string[]> = {};
        const lines = draft.lines.map((line, index) => {
            const quantity = parseDisplayNumber(line.quantity);
            if (quantity === null)
                invalid[`lines.${index}.quantity`] = [numberFormat];
            return {
                prescription_line_id: line.prescriptionLineId,
                item_id: line.item.id,
                substitution_consent: line.substitution?.consent ?? null,
                substitution_reason: line.substitution?.reason ?? null,
                quantity: quantity ?? line.quantity,
                unit_id: line.unit.id,
                batch_id: line.batch?.id ?? null,
                reason: line.reason.trim() || null,
            };
        });
        const location =
            draft.location?.id === prescription.location?.id
                ? {}
                : { location_id: draft.location?.id ?? null };
        return {
            invalid,
            payload: {
                ...location,
                notes: draft.notes.trim() || null,
                pharmacist_id: draft.pharmacist?.id ?? null,
                assistant_id: draft.assistant?.id ?? null,
                lines,
                ...(dispensing ? { version: dispensing.version } : {}),
            },
        };
    };

    const submit = async (next: 'save' | 'prepare') => {
        const { invalid, payload } = body();
        if (Object.keys(invalid).length) {
            setAction(next);
            setMessage(null);
            setErrors(invalid);
            return;
        }
        const done = await run(next, async () =>
            next === 'save'
                ? (
                      await api.pharmacyDispensingSave({
                          params: { id: prescription.id },
                          body: payload,
                      })
                  ).body
                : (
                      await api.pharmacyDispensingPrepare({
                          params: { id: prescription.id },
                          body: payload,
                      })
                  ).body,
        );
        if (done)
            toast.success(
                next === 'save'
                    ? 'Penyerahan disimpan.'
                    : `Resep ${prescription.prescription_number} disiapkan. Stok sudah tercatat keluar.`,
            );
    };

    const call = async () => {
        if (
            await run(
                'call',
                async () =>
                    (
                        await api.pharmacyDispensingCall({
                            params: { id: prescription.id },
                            body: {},
                        })
                    ).body,
            )
        )
            toast.success(`${prescription.patient_name} dipanggil.`);
    };

    const handOver = async () => {
        if (!dispensing) return;
        if (
            await run(
                'hand-over',
                async () =>
                    (
                        await api.pharmacyDispensingHandOver({
                            params: { id: prescription.id },
                            body: {
                                pharmacist_id: draft.pharmacist?.id ?? null,
                                received_by_patient: receiver.byPatient,
                                receiver_name: receiver.byPatient
                                    ? null
                                    : receiver.name.trim() || null,
                                version: dispensing.version,
                            },
                        })
                    ).body,
            )
        )
            toast.success(
                `Obat ${prescription.patient_name} sudah diserahkan.`,
            );
    };

    const cancelPreparation = async () => {
        if (!dispensing) return;
        if (
            !(await confirm({
                title: `Batal siapkan ${dispensing.number}?`,
                description:
                    'Obat yang sudah tercatat keluar kembali ke stok lokasinya. Penyerahan ini ditutup sebagai dibatalkan, dan resep kembali ke antrean untuk disiapkan lagi dengan isian yang sama.',
                confirmLabel: 'Batal siapkan',
                destructive: true,
            }))
        )
            return;
        if (
            await run(
                'cancel',
                async () =>
                    (
                        await api.pharmacyDispensingCancelPreparation({
                            params: { id: prescription.id },
                            body: { version: dispensing.version },
                        })
                    ).body,
            )
        )
            toast.success(`Penyiapan ${dispensing.number} dibatalkan.`);
    };

    const changeLocation = (location: Reference) =>
        setDraft((current) =>
            current.location?.id === location.id
                ? current
                : {
                      ...current,
                      location,
                      lines: current.lines.map((line) => ({
                          ...line,
                          batch: null,
                      })),
                  },
        );

    const awaitingHandover = status === 'disiapkan' || status === 'dipanggil';
    const summary = [
        draft.location ? locationLabel(draft.location) : 'Belum ada lokasi',
        dispensing?.number,
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
                    void submit('save');
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
                                onClick={() => {
                                    setDraft(draftOf(view.data));
                                    setErrors({});
                                    setErrorActions([]);
                                    setMessage(null);
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={busy}
                                title="Simpan isian ini dan catat obatnya keluar dari stok lokasi farmasi."
                                onClick={() => void submit('prepare')}
                            >
                                <PackageCheck aria-hidden="true" />
                                Siapkan
                            </Button>
                        </>
                    )}
                    {awaitingHandover && permissions.prepare && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void call()}
                        >
                            <Megaphone aria-hidden="true" />
                            {status === 'dipanggil'
                                ? 'Panggil ulang'
                                : 'Panggil'}
                        </Button>
                    )}
                    {awaitingHandover && permissions.hand_over && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void handOver()}
                        >
                            <HandHeart aria-hidden="true" />
                            Serahkan
                        </Button>
                    )}
                    {prepared && !cancelled && (
                        <PrintAction
                            report="pharmacy.drug-label"
                            recordId={view.data.prescription.id}
                            label="Etiket"
                        />
                    )}
                    {status === 'diserahkan' && canReturn && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            title="Catat obat yang dikembalikan pasien; stoknya masuk lagi ke lokasi farmasi."
                            onClick={() => setReturning(true)}
                        >
                            <RotateCcw aria-hidden="true" />
                            Retur
                        </Button>
                    )}
                    {prepared &&
                        !cancelled &&
                        status !== 'dibatalkan' &&
                        permissions.override_price && (
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={busy}
                                title="Ubah harga satuan, diskon, atau biaya racik dan resep per baris. Kunjungan yang sudah dibayar perlu dibatalkan pembayarannya dulu."
                                onClick={() => setRepricing(true)}
                            >
                                <BadgePercent aria-hidden="true" />
                                Ubah harga
                            </Button>
                        )}
                    {awaitingHandover && permissions.reverse && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void cancelPreparation()}
                        >
                            <Undo2 aria-hidden="true" />
                            Batal siapkan
                        </Button>
                    )}
                    {!cancelled &&
                        status !== 'diserahkan' &&
                        permissions.cancel && (
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={busy || dirty}
                                title={
                                    dirty
                                        ? 'Perubahan yang belum disimpan perlu disimpan atau dibatalkan dulu.'
                                        : 'Keluarkan resep yang tidak diambil pasien dari antrean.'
                                }
                                onClick={() => setCancelling(true)}
                            >
                                <Ban aria-hidden="true" />
                                Batalkan resep
                            </Button>
                        )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    errorActions={errorActions}
                    message={message}
                    operation={failedOperations[action]}
                />
                <PageDialogBody className="py-3">
                    <CollapsibleSectionGroup
                        defaultValue={[
                            'prescription',
                            'dispensing',
                            'lines',
                            'returns',
                        ]}
                    >
                        <CollapsibleSection
                            value="prescription"
                            title="Resep"
                            summary={`${prescription.patient_name} · ${prescription.medical_record_number}`}
                        >
                            <PrescriptionFacts prescription={prescription} />
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="dispensing"
                            title="Penyerahan"
                            summary={summary}
                        >
                            <FormGrid>
                                <LocationLookup
                                    accessible
                                    label="Lokasi farmasi"
                                    required
                                    field="location_id"
                                    value={draft.location}
                                    onChange={changeLocation}
                                    disabled={!editing}
                                    error={errors.location_id?.[0]}
                                    hint="Bawaannya dari Lokasi layanan resep untuk unit dan section asal resep. Ganti bila resep ini dilayani lokasi lain; batch yang sudah dipilih ikut dikosongkan."
                                    portalContainer={portalContainer}
                                />
                                <StaffLookup
                                    label="Asisten apoteker"
                                    field="assistant_id"
                                    value={draft.assistant}
                                    onChange={(assistant) =>
                                        setDraft((current) => ({
                                            ...current,
                                            assistant,
                                        }))
                                    }
                                    disabled={!editing}
                                    error={errors.assistant_id?.[0]}
                                    hint="Kosongkan bila yang menyiapkan adalah Anda sendiri; namanya diisi saat Siapkan."
                                    portalContainer={portalContainer}
                                />
                                <StaffLookup
                                    label="Apoteker"
                                    field="pharmacist_id"
                                    value={draft.pharmacist}
                                    onChange={(pharmacist) =>
                                        setDraft((current) => ({
                                            ...current,
                                            pharmacist,
                                        }))
                                    }
                                    disabled={
                                        !(
                                            editing ||
                                            (awaitingHandover &&
                                                permissions.hand_over)
                                        )
                                    }
                                    error={errors.pharmacist_id?.[0]}
                                    hint="Kosongkan bila yang menyerahkan adalah Anda sendiri; namanya diisi saat Serahkan."
                                    portalContainer={portalContainer}
                                />
                                {awaitingHandover && permissions.hand_over && (
                                    <>
                                        <FormControl
                                            error={
                                                errors.received_by_patient?.[0]
                                            }
                                            data-error-field="received_by_patient"
                                        >
                                            <Select
                                                label="Diterima oleh"
                                                required
                                                portalContainer={
                                                    portalContainer
                                                }
                                                items={receivers}
                                                value={
                                                    receiver.byPatient
                                                        ? 'patient'
                                                        : 'other'
                                                }
                                                onValueChange={(value) => {
                                                    if (value)
                                                        setReceiver(
                                                            (current) => ({
                                                                ...current,
                                                                byPatient:
                                                                    value ===
                                                                    'patient',
                                                            }),
                                                        );
                                                }}
                                            />
                                        </FormControl>
                                        {!receiver.byPatient && (
                                            <FormControl
                                                error={
                                                    errors.receiver_name?.[0]
                                                }
                                            >
                                                <Input
                                                    label="Nama penerima"
                                                    required
                                                    maxLength={150}
                                                    data-error-field="receiver_name"
                                                    value={receiver.name}
                                                    onChange={(event) =>
                                                        setReceiver(
                                                            (current) => ({
                                                                ...current,
                                                                name: event
                                                                    .target
                                                                    .value,
                                                            }),
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                        )}
                                    </>
                                )}
                                <FormControl error={errors.notes?.[0]}>
                                    <Textarea
                                        label="Catatan farmasi"
                                        maxLength={500}
                                        rows={2}
                                        data-error-field="notes"
                                        value={draft.notes}
                                        readOnly={!editing}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                notes: event.target.value,
                                            }))
                                        }
                                    />
                                </FormControl>
                            </FormGrid>
                            {dispensing && prepared && (
                                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                                    <Fact label="No penyerahan">
                                        {dispensing.number}
                                    </Fact>
                                    <Fact label="Disiapkan">
                                        {dispensing.prepared_at
                                            ? `${dateTimeText(dispensing.prepared_at)} · ${dispensing.prepared_by?.name ?? ''}`
                                            : null}
                                    </Fact>
                                    <Fact label="Dipanggil">
                                        {dispensing.called_at
                                            ? dateTimeText(dispensing.called_at)
                                            : null}
                                    </Fact>
                                    <Fact label="Diserahkan">
                                        {dispensing.handed_over_at
                                            ? `${dateTimeText(dispensing.handed_over_at)} · ${dispensing.handed_over_by?.name ?? ''}`
                                            : null}
                                    </Fact>
                                    {status === 'diserahkan' && (
                                        <Fact label="Diterima oleh">
                                            {receiverText(dispensing)}
                                        </Fact>
                                    )}
                                </dl>
                            )}
                            {view.data.cancelled.length > 0 && (
                                <p className="mt-3 text-sm text-muted-foreground">
                                    Penyiapan sebelumnya dibatalkan:{' '}
                                    {view.data.cancelled
                                        .map(
                                            (row) =>
                                                `${row.number} (${dateTimeText(row.cancelled_at)})`,
                                        )
                                        .join(', ')}
                                    .
                                </p>
                            )}
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="lines"
                            title="Obat"
                            summary={[
                                `${prescription.item_count} obat`,
                                dispensing?.total_amount
                                    ? `Rp${displayNumber(dispensing.total_amount)}`
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        >
                            <div data-error-field="lines">
                                <DispensingLines
                                    prescription={prescription}
                                    lines={draft.lines}
                                    onChange={(lines) =>
                                        setDraft((current) => ({
                                            ...current,
                                            lines,
                                        }))
                                    }
                                    editing={editing}
                                    prepared={prepared}
                                    errors={errors}
                                    stock={stock}
                                    options={itemOptions}
                                    canSubstitute={permissions.substitute}
                                    locationId={draft.location?.id ?? null}
                                    portalContainer={portalContainer}
                                />
                            </div>
                            {prepared && (
                                <div className="mt-3">
                                    <FeeLines fees={view.data.fees} />
                                </div>
                            )}
                            {prepared && dispensing?.total_amount ? (
                                <p className="mt-3 text-sm">
                                    Total{' '}
                                    <span className="font-semibold tabular-nums">
                                        Rp
                                        {displayNumber(dispensing.total_amount)}
                                    </span>
                                </p>
                            ) : (
                                !prepared && (
                                    <p className="mt-3 text-sm text-muted-foreground">
                                        Harga obat dihitung dan dikunci saat
                                        resep disiapkan, menurut kelompok harga
                                        pasien dan grading harga obat.
                                    </p>
                                )
                            )}
                        </CollapsibleSection>
                        {status === 'diserahkan' && (
                            <CollapsibleSection value="returns" title="Retur">
                                <ReturnsSection
                                    target={{
                                        kind: 'prescription',
                                        id: prescription.id,
                                    }}
                                />
                            </CollapsibleSection>
                        )}
                    </CollapsibleSectionGroup>
                </PageDialogBody>
                {confirmation}
                {cancelling && (
                    <PrescriptionCancelDialog
                        prescription={prescription}
                        dispensingVersion={dispensing?.version ?? null}
                        prepared={prepared}
                        onClose={() => setCancelling(false)}
                        onCancelled={(next) => {
                            setCancelling(false);
                            onSaved(next);
                        }}
                    />
                )}
            </form>
            {repricing && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setRepricing(false);
                    }}
                >
                    <PageDialogContent title="Ubah harga">
                        <DispensingPriceCard
                            view={view}
                            onDone={(next) => {
                                setRepricing(false);
                                if (next) onSaved(next);
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {returning && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setReturning(false);
                    }}
                >
                    <PageDialogContent ref={returnContent} title="Retur obat">
                        <ReturnCard
                            target={{
                                kind: 'prescription',
                                id: prescription.id,
                            }}
                            onDone={() => setReturning(false)}
                            portalContainer={returnContent}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
