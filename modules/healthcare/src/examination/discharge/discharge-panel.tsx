import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { Checkbox } from '@operations-metta/ui/checkbox';
import { DatePicker } from '@operations-metta/ui/date-picker';
import { DateTimePicker } from '@operations-metta/ui/date-time-picker';
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@operations-metta/ui/dialog';
import { FieldLegend, FieldSet } from '@operations-metta/ui/field';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Label } from '@operations-metta/ui/label';
import { RadioGroup, RadioGroupItem } from '@operations-metta/ui/radio-group';
import { Select } from '@operations-metta/ui/select';
import { Textarea } from '@operations-metta/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorText, orpc, type ApiBody } from '@core/platform/shell/index.ts';
import type {
    MedicalRecordDraft,
    MedicalRecordMetadata,
} from '../medical-record/medical-record-panels.tsx';
import { PractitionerField } from '../medical-record/medical-record-panels.tsx';
import { DestinationStatusText } from '../queue/queue-display.tsx';

// Panel Status Pasien sistem lama (form/statuspasien/index.php) di kolom kiri halaman pemeriksaan: pilihan status dari
// data acuan tenant, lalu isian yang dibuka perilaku status itu. Status ikut Simpan rekam medis. Tambah Rujuk Internal
// membuat tujuan baru saat itu juga, seperti form RujukInternalForm.php.

type Discharge = NonNullable<MedicalRecordDraft['discharge']>;
type ReferralInput = ApiBody<'healthcareInternalReferralOptions'>['data'];
export type ReferralRequest = {
    section_id: string | null;
    practice_schedule_id: string | null;
    note: string | null;
};

const textOf = (value: string | null) => value ?? '';
const valueOf = (value: string) => (value.trim() === '' ? null : value);

function ReferralDialog({
    destinationId,
    onRefer,
    onClose,
}: {
    destinationId: string;
    onRefer: (
        request: ReferralRequest,
    ) => Promise<Record<string, string[]> | null>;
    onClose: () => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const options = useQuery(
        orpc.healthcareInternalReferralOptions.queryOptions({
            input: { params: { id: destinationId } },
            select: (response) => response.body.data,
        }),
    );
    const [request, setRequest] = useState<ReferralRequest>({
        section_id: null,
        practice_schedule_id: null,
        note: null,
    });
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [busy, setBusy] = useState(false);
    const sections: ReferralInput = options.data ?? [];
    const section = sections.find((row) => row.id === request.section_id);
    const submit = async () => {
        setBusy(true);
        try {
            const refused = await onRefer(request);
            if (refused) setErrors(refused);
            else onClose();
        } finally {
            setBusy(false);
        }
    };
    const message = Object.entries(errors)
        .filter(
            ([field]) =>
                !['section_id', 'practice_schedule_id', 'note'].includes(field),
        )
        .flatMap(([, messages]) => messages)
        .join(' ');
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <DialogContent size="compact" ref={contentRef}>
                <form
                    noValidate
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Tambah rujuk internal</DialogTitle>
                        <DialogDescription>
                            Pasien masuk antrean poli tujuan pada kunjungan yang
                            sama, dan baru dapat diperiksa di sana setelah
                            pemeriksaan di poli ini selesai.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody className="space-y-3">
                        {(message || options.isError) && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {message ||
                                    errorText(
                                        options.error,
                                        'Pilihan poli belum dapat dimuat.',
                                    )}
                            </p>
                        )}
                        <FormControl error={errors.section_id?.join(' ')}>
                            <Select
                                label="Poli / Ruangan"
                                required
                                items={sections.map((row) => ({
                                    value: row.id,
                                    label: row.name,
                                }))}
                                value={request.section_id}
                                onValueChange={(value) =>
                                    setRequest({
                                        ...request,
                                        section_id: value,
                                        practice_schedule_id: null,
                                    })
                                }
                                emptyMessage={
                                    options.isPending
                                        ? 'Memuat poli…'
                                        : 'Tidak ada poli lain di unit ini.'
                                }
                                portalContainer={contentRef}
                            />
                        </FormControl>
                        {section && !section.schedules.length && (
                            <p className="text-sm text-muted-foreground">
                                Tidak Terdapat Jadwal Pada {section.name}.
                                Pasien dirujuk tanpa dokter.
                            </p>
                        )}
                        {section && section.schedules.length > 0 && (
                            <FormControl
                                error={errors.practice_schedule_id?.join(' ')}
                            >
                                <Select
                                    label="Dokter / Tenaga Medis"
                                    required
                                    items={section.schedules.map((row) => ({
                                        value: row.id,
                                        label: `${row.practitioner_name} · ${row.session_name} ${row.start_time}–${row.end_time}${row.full ? ' (penuh)' : ''}`,
                                    }))}
                                    value={request.practice_schedule_id}
                                    onValueChange={(value) =>
                                        setRequest({
                                            ...request,
                                            practice_schedule_id: value,
                                        })
                                    }
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                        )}
                        <FormControl error={errors.note?.join(' ')}>
                            <Textarea
                                label="Catatan"
                                rows={3}
                                maxLength={1000}
                                value={textOf(request.note)}
                                onChange={(event) =>
                                    setRequest({
                                        ...request,
                                        note: valueOf(event.target.value),
                                    })
                                }
                            />
                        </FormControl>
                    </DialogBody>
                    <DialogFooter>
                        <Button type="submit" disabled={busy}>
                            <Send aria-hidden="true" />
                            {busy ? 'Merujuk…' : 'Rujuk'}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={onClose}
                        >
                            Tutup
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function DischargePanel({
    destinationId,
    visitDate,
    discharge,
    setDischarge,
    metadata,
    errors,
    disabled,
    onRefer,
}: {
    destinationId: string;
    visitDate: string;
    discharge: Discharge;
    setDischarge: (discharge: Discharge) => void;
    metadata: MedicalRecordMetadata;
    errors: Record<string, string[]>;
    disabled: boolean;
    onRefer: (
        request: ReferralRequest,
    ) => Promise<Record<string, string[]> | null>;
}): ReactNode {
    const [referring, setReferring] = useState(false);
    const error = (field: string) =>
        errors[`discharge.${field}`]?.join(' ') ?? undefined;
    const statuses = metadata.discharge_statuses.filter(
        (row) => row.active || row.id === discharge.status_id,
    );
    const behavior =
        statuses.find((row) => row.id === discharge.status_id)?.behavior ??
        null;
    const deathTimes = metadata.options.waktu_meninggal ?? [];
    const deathAt = discharge.death_date
        ? `${discharge.death_date}T${discharge.death_time ?? ''}`
        : '';
    return (
        <Card>
            <CardHeader>
                <CardTitle>Status Pasien</CardTitle>
                {behavior === 'rujuk_internal' && !disabled && (
                    <CardAction>
                        <ActionButton
                            action="add"
                            type="button"
                            onClick={() => setReferring(true)}
                        />
                    </CardAction>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                <FormControl
                    error={error('status_id')}
                    data-error-field="discharge.status_id"
                >
                    <FieldSet className="gap-1.5">
                        <FieldLegend className="sr-only">
                            Status pasien
                        </FieldLegend>
                        <RadioGroup
                            aria-label="Status pasien"
                            disabled={disabled}
                            value={discharge.status_id ?? ''}
                            onValueChange={(value) =>
                                setDischarge({
                                    ...discharge,
                                    status_id: value,
                                })
                            }
                        >
                            {statuses.map((row) => (
                                <div
                                    key={row.id}
                                    className="flex items-center gap-2"
                                >
                                    <RadioGroupItem
                                        id={`discharge-${row.id}`}
                                        value={row.id}
                                    />
                                    <Label
                                        htmlFor={`discharge-${row.id}`}
                                        className="font-normal"
                                    >
                                        {row.name}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </FieldSet>
                </FormControl>

                {behavior === 'rawat_jalan' && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="discharge-follow-up"
                                disabled={disabled}
                                checked={discharge.follow_up === true}
                                onCheckedChange={(checked) =>
                                    setDischarge({
                                        ...discharge,
                                        follow_up: checked === true,
                                        follow_up_date:
                                            checked === true
                                                ? (discharge.follow_up_date ??
                                                  visitDate)
                                                : null,
                                    })
                                }
                            />
                            <Label
                                htmlFor="discharge-follow-up"
                                className="font-normal"
                            >
                                Check Up
                            </Label>
                        </div>
                        {discharge.follow_up === true && (
                            <FormControl
                                error={error('follow_up_date')}
                                data-error-field="discharge.follow_up_date"
                            >
                                <DatePicker
                                    label="Tanggal check up kembali"
                                    required
                                    disabled={disabled}
                                    value={textOf(discharge.follow_up_date)}
                                    onValueChange={(value) =>
                                        setDischarge({
                                            ...discharge,
                                            follow_up_date: valueOf(value),
                                        })
                                    }
                                />
                            </FormControl>
                        )}
                    </div>
                )}

                {behavior === 'rawat_inap' && (
                    <PractitionerField
                        field="discharge.consultant_id"
                        label="Dokter konsul rawat inap"
                        practitioners={metadata.practitioners}
                        fills={(row) => row.fills_medical_staff}
                        value={discharge.consultant_id}
                        error={error('consultant_id')}
                        disabled={disabled}
                        onChange={(value) =>
                            setDischarge({
                                ...discharge,
                                consultant_id: value,
                            })
                        }
                    />
                )}

                {behavior === 'rujuk_internal' &&
                    (discharge.internal_referrals.length ? (
                        <ul className="space-y-2">
                            {discharge.internal_referrals.map((row) => (
                                <li
                                    key={row.id}
                                    className="rounded-lg border p-3 text-sm"
                                >
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="font-semibold">
                                            {row.section_name} ({row.queue_code}
                                            )
                                        </span>
                                        <DestinationStatusText
                                            status={row.status}
                                        />
                                    </div>
                                    <p>
                                        {row.practitioner_name ??
                                            'Tanpa dokter'}
                                    </p>
                                    {row.session_name && (
                                        <p className="text-muted-foreground">
                                            {row.session_name}
                                        </p>
                                    )}
                                    {row.note && (
                                        <p className="text-muted-foreground">
                                            {row.note}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Belum ada rujuk internal.
                            {disabled
                                ? ''
                                : ' Pilih Tambah untuk merujuk ke poli lain.'}
                        </p>
                    ))}

                {behavior === 'rujuk_eksternal' && (
                    <div className="space-y-3">
                        <FormControl error={error('referral_destination')}>
                            <Input
                                label="Rumah sakit / faskes tujuan"
                                disabled={disabled}
                                maxLength={200}
                                value={textOf(discharge.referral_destination)}
                                onChange={(event) =>
                                    setDischarge({
                                        ...discharge,
                                        referral_destination: valueOf(
                                            event.target.value,
                                        ),
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl error={error('referral_specialty')}>
                            <Input
                                label="Poli / spesialis"
                                disabled={disabled}
                                maxLength={150}
                                value={textOf(discharge.referral_specialty)}
                                onChange={(event) =>
                                    setDischarge({
                                        ...discharge,
                                        referral_specialty: valueOf(
                                            event.target.value,
                                        ),
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl error={error('referral_reason')}>
                            <Textarea
                                label="Alasan rujukan"
                                rows={2}
                                disabled={disabled}
                                maxLength={1000}
                                value={textOf(discharge.referral_reason)}
                                onChange={(event) =>
                                    setDischarge({
                                        ...discharge,
                                        referral_reason: valueOf(
                                            event.target.value,
                                        ),
                                    })
                                }
                            />
                        </FormControl>
                    </div>
                )}

                {behavior === 'meninggal' && (
                    <div className="space-y-3">
                        <FormControl
                            error={error('death_time_category')}
                            data-error-field="discharge.death_time_category"
                        >
                            <RadioGroup
                                aria-label="Waktu meninggal"
                                className="flex flex-wrap gap-x-6 gap-y-1.5"
                                disabled={disabled}
                                value={discharge.death_time_category ?? ''}
                                onValueChange={(value) =>
                                    setDischarge({
                                        ...discharge,
                                        death_time_category: value,
                                    })
                                }
                            >
                                {deathTimes.map((option) => (
                                    <div
                                        key={option.code}
                                        className="flex items-center gap-2"
                                    >
                                        <RadioGroupItem
                                            id={`death-${option.code}`}
                                            value={option.code}
                                        />
                                        <Label
                                            htmlFor={`death-${option.code}`}
                                            className="font-normal"
                                        >
                                            {option.name}
                                        </Label>
                                    </div>
                                ))}
                            </RadioGroup>
                        </FormControl>
                        <FormControl
                            error={[error('death_date'), error('death_time')]
                                .filter(Boolean)
                                .join(' ')}
                            data-error-field="discharge.death_date"
                        >
                            <DateTimePicker
                                label="Tanggal dan jam meninggal"
                                disabled={disabled}
                                value={deathAt}
                                onValueChange={(value) => {
                                    const [date = '', time = ''] =
                                        value.split('T');
                                    setDischarge({
                                        ...discharge,
                                        death_date: valueOf(date),
                                        death_time: valueOf(time),
                                    });
                                }}
                            />
                        </FormControl>
                    </div>
                )}
            </CardContent>
            {referring && (
                <ReferralDialog
                    destinationId={destinationId}
                    onRefer={onRefer}
                    onClose={() => setReferring(false)}
                />
            )}
        </Card>
    );
}
