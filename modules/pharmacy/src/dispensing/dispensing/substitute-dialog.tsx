import {
    Dialog,
    DialogAction,
    DialogBody,
    DialogCancel,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@operations-metta/ui/dialog';
import { displayNumber } from '@operations-metta/ui/display-number';
import { FieldLegend, FieldSet } from '@operations-metta/ui/field';
import { FormControl } from '@operations-metta/ui/form-control';
import { Label } from '@operations-metta/ui/label';
import { RadioGroup, RadioGroupItem } from '@operations-metta/ui/radio-group';
import { Textarea } from '@operations-metta/ui/textarea';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
    consentLabels,
    substitutionConsents,
    type ItemOption,
    type SubstitutionConsent,
} from './dispensing-lines.tsx';

type SubstituteErrors = { consent?: string; reason?: string };

export type SubstituteChoice = {
    option: ItemOption;
    consent: SubstitutionConsent | null;
    reason: string;
};

// Pilih obat yang diserahkan untuk satu baris resep: obat resep atau salah satu obat penggantinya, dengan stok di lokasi
// penyiapan. Obat pengganti mencatat siapa yang menyetujui dan alasannya. Pilihan baru disimpan saat Simpan atau
// Siapkan.
export function SubstituteDialog({
    prescribedName,
    options,
    current,
    stock,
    onApply,
    onClose,
}: {
    prescribedName: string;
    options: ItemOption[];
    current: {
        itemId: string;
        consent: SubstitutionConsent | null;
        reason: string;
    };
    stock: Map<string, string>;
    onApply: (choice: SubstituteChoice) => void;
    onClose: () => void;
}): ReactNode {
    const id = useId();
    const [itemId, setItemId] = useState(current.itemId);
    const [consent, setConsent] = useState(current.consent);
    const [reason, setReason] = useState(current.reason);
    const [errors, setErrors] = useState<SubstituteErrors>({});
    const chosen = options.find((option) => option.item.id === itemId);
    const substituting = chosen !== undefined && !chosen.is_prescribed;

    const chooseConsent = (next: SubstitutionConsent | null) => {
        setConsent(next);
        setErrors(({ reason }) => (reason ? { reason } : {}));
    };
    const changeReason = (next: string) => {
        setReason(next);
        setErrors(({ consent }) => (consent ? { consent } : {}));
    };

    const apply = () => {
        if (!chosen) return;
        const missing: SubstituteErrors = {};
        if (substituting && !consent)
            missing.consent = 'Pilih siapa yang menyetujui obat ini diganti.';
        if (substituting && !reason.trim())
            missing.reason =
                'Tulis alasan obat resep diganti, misalnya stok habis.';
        setErrors(missing);
        if (Object.keys(missing).length) return;
        onApply({
            option: chosen,
            consent: substituting ? consent : null,
            reason: substituting ? reason.trim() : '',
        });
    };

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Ganti obat</DialogTitle>
                    <DialogDescription>
                        {`Resep menulis ${prescribedName}. Obat yang dipilih dipakai untuk stok keluar, harga, tagihan kasir, dan etiket. Resep dokter tidak berubah.`}
                    </DialogDescription>
                </DialogHeader>
                <DialogBody className="space-y-4">
                    <FieldSet className="gap-1.5">
                        <FieldLegend className="text-sm">
                            Obat yang diserahkan
                        </FieldLegend>
                        <RadioGroup
                            aria-label="Obat yang diserahkan"
                            value={itemId}
                            onValueChange={(value) => {
                                setItemId(value);
                                setErrors({});
                            }}
                        >
                            {options.map((option) => (
                                <div
                                    key={option.item.id}
                                    className="flex items-start gap-2"
                                >
                                    <RadioGroupItem
                                        id={`${id}-${option.item.id}`}
                                        value={option.item.id}
                                        className="mt-0.5"
                                    />
                                    <Label
                                        htmlFor={`${id}-${option.item.id}`}
                                        className="flex flex-col items-start gap-0.5 font-normal"
                                    >
                                        <span>
                                            {`${option.item.code} · ${option.item.name}${option.is_prescribed ? ' (obat resep)' : ''}`}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {[
                                                `Stok ${displayNumber(stock.get(option.item.id) ?? '0')} ${option.units[0]?.code ?? ''}`.trim(),
                                                option.notes,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </FieldSet>
                    {substituting && (
                        <>
                            <FormControl error={errors.consent}>
                                <FieldSet className="gap-1.5">
                                    <FieldLegend className="text-sm">
                                        Disetujui oleh
                                    </FieldLegend>
                                    <RadioGroup
                                        aria-label="Disetujui oleh"
                                        value={consent ?? ''}
                                        onValueChange={(value) =>
                                            chooseConsent(
                                                substitutionConsents.find(
                                                    (option) =>
                                                        option === value,
                                                ) ?? null,
                                            )
                                        }
                                    >
                                        {substitutionConsents.map((option) => (
                                            <div
                                                key={option}
                                                className="flex items-center gap-2"
                                            >
                                                <RadioGroupItem
                                                    id={`${id}-${option}`}
                                                    value={option}
                                                />
                                                <Label
                                                    htmlFor={`${id}-${option}`}
                                                    className="font-normal"
                                                >
                                                    {consentLabels[option]}
                                                </Label>
                                            </div>
                                        ))}
                                    </RadioGroup>
                                </FieldSet>
                            </FormControl>
                            <FormControl error={errors.reason}>
                                <Textarea
                                    label="Alasan diganti"
                                    required
                                    rows={2}
                                    maxLength={200}
                                    value={reason}
                                    onChange={(event) =>
                                        changeReason(event.target.value)
                                    }
                                />
                            </FormControl>
                        </>
                    )}
                </DialogBody>
                <DialogFooter>
                    <DialogAction type="button" onClick={apply}>
                        {substituting
                            ? 'Pakai obat pengganti'
                            : 'Pakai obat resep'}
                    </DialogAction>
                    <DialogCancel>Tutup</DialogCancel>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
