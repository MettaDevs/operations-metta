import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    useUnsavedChangesGuard,
    type ApiBody,
} from '@core/platform/shell/index.ts';

// Setelan farmasi legal entity tempat kerja (pola Inventory Setup BC). Baru berisi pembulatan harga satuan obat.

type Setup = ApiBody<'pharmacySetupShow'>;
type Decimals = Setup['data']['unit_price_decimals'];

// Label ditulis per nilai, supaya nilai baru di API langsung gagal dikompilasi sampai labelnya ada.
const decimalLabels: Record<Decimals, string> = {
    0: 'Tanpa desimal, dibulatkan ke rupiah (Rp1.235)',
    1: '1 angka di belakang koma (Rp1.234,6)',
    2: '2 angka di belakang koma (Rp1.234,57)',
    3: '3 angka di belakang koma (Rp1.234,568)',
    4: '4 angka di belakang koma (Rp1.234,5678)',
};
const decimalItems = Object.entries<string>(decimalLabels).map(
    ([value, label]) => ({ value, label }),
);

const isDecimals = (value: number): value is Decimals =>
    Object.hasOwn(decimalLabels, value);

function SetupForm({
    setup,
    onSaved,
}: {
    setup: Setup;
    onSaved: () => Promise<void>;
}): ReactNode {
    const editing = setup.can_manage;
    const [saved, setSaved] = useState(setup.data);
    const [decimals, setDecimals] = useState(saved.unit_price_decimals);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const reset = () => {
        setDecimals(saved.unit_price_decimals);
        setErrors({});
        setMessage(null);
    };
    const leaveGuard = useUnsavedChangesGuard(
        decimals !== saved.unit_price_decimals,
        reset,
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.pharmacySetupUpdate({
                body: { unit_price_decimals: decimals, version: saved.version },
            });
            setSaved(body.data);
            toast.success('Setelan farmasi disimpan.');
            await onSaved();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Setelan farmasi belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Setelan farmasi">
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            form="pharmacy-setup"
                            disabled={busy}
                            pending={busy}
                        />
                        <ActionButton
                            action="cancel"
                            disabled={busy}
                            onClick={reset}
                        />
                    </>
                )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <form
                    noValidate
                    id="pharmacy-setup"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Setelan farmasi belum disimpan"
                    />
                    <CollapsibleSectionGroup defaultValue={['price']}>
                        <CollapsibleSection
                            value="price"
                            title="Harga obat"
                            summary={decimalLabels[decimals]}
                        >
                            <FormGrid>
                                <FormControl
                                    error={errors.unit_price_decimals?.[0]}
                                    hint="Harga satuan obat dihitung saat resep disiapkan, lalu dibulatkan ke banyak angka di belakang koma ini. 0 = dibulatkan ke rupiah. Mengubahnya hanya berlaku untuk resep yang disiapkan sesudahnya."
                                    data-error-field="unit_price_decimals"
                                >
                                    {editing ? (
                                        <Select
                                            label="Desimal harga satuan obat"
                                            required
                                            items={decimalItems}
                                            value={String(decimals)}
                                            onValueChange={(next) => {
                                                const chosen = Number(next);
                                                if (
                                                    next !== null &&
                                                    isDecimals(chosen)
                                                )
                                                    setDecimals(chosen);
                                            }}
                                            searchPlaceholder="Cari pilihan"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    ) : (
                                        <Input
                                            label="Desimal harga satuan obat"
                                            value={decimalLabels[decimals]}
                                            readOnly
                                        />
                                    )}
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </form>
            </div>
            {leaveGuard}
        </div>
    );
}

function PharmacySetupPage(): ReactNode {
    // Data baru memasang ulang form, jadi tidak dimuat ulang saat jendela kembali aktif; isian yang belum disimpan tetap
    // ada, dan perubahan orang lain ditolak sebagai versi basi saat Simpan.
    const setup = useSuspenseQuery(
        orpc.pharmacySetupShow.queryOptions({
            select: (response) => response.body,
            refetchOnWindowFocus: false,
        }),
    );
    return (
        <SetupForm
            key={setup.data.data.version}
            setup={setup.data}
            onSaved={async () => {
                await setup.refetch();
            }}
        />
    );
}

export const page = definePage({
    path: '/pharmacy/drug/setup',
    layout: 'app',
    title: 'Setelan farmasi',
    component: PharmacySetupPage,
});
