import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Switch } from '@operations-metta/ui/switch';
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
} from '../../../platform/shell/index.ts';

// Setelan kasir per legal entity. Clerk wajib bawaannya nyala; klinik yang tidak memakai clerk mematikannya.

type Setup = ApiBody<'billingSetupShow'>;

function SetupForm({
    setup,
    onSaved,
}: {
    setup: Setup;
    onSaved: () => Promise<void>;
}): ReactNode {
    const editing = setup.can_manage;
    const saved = setup.data;
    const [clerkRequired, setClerkRequired] = useState(saved.clerk_required);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const reset = () => {
        setClerkRequired(saved.clerk_required);
        setErrors({});
        setMessage(null);
    };
    const leaveGuard = useUnsavedChangesGuard(
        clerkRequired !== saved.clerk_required,
        reset,
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await api.billingSetupUpdate({
                body: { clerk_required: clerkRequired, version: saved.version },
            });
            toast.success('Setelan kasir disimpan.');
            await onSaved();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Setelan kasir belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Setelan kasir">
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            form="billing-setup"
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
                    id="billing-setup"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Setelan kasir belum disimpan"
                    />
                    <CollapsibleSectionGroup defaultValue={['clerk']}>
                        <CollapsibleSection
                            value="clerk"
                            title="Clerk"
                            summary={
                                clerkRequired
                                    ? 'Wajib Clerk Start'
                                    : 'Tanpa Clerk Start'
                            }
                        >
                            <FormGrid>
                                <FormControl
                                    error={errors.clerk_required?.[0]}
                                    hint="Bila mati, kasir bisa menerima pembayaran tanpa Clerk Start. Pembayaran itu tidak dihitung di Clerk End mana pun dan bisa dibatalkan kapan saja. Kasir yang sedang Clerk Start tetap mencatat pembayarannya di clerk itu."
                                    data-error-field="clerk_required"
                                >
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id="billing-clerk-required"
                                            checked={clerkRequired}
                                            disabled={!editing}
                                            onCheckedChange={setClerkRequired}
                                        />
                                        <FieldLabel
                                            htmlFor="billing-clerk-required"
                                            className="font-normal"
                                        >
                                            Wajib Clerk Start sebelum menerima
                                            pembayaran
                                        </FieldLabel>
                                    </Field>
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

function BillingSetupPage(): ReactNode {
    // Data baru memasang ulang form, jadi tidak dimuat ulang saat jendela kembali aktif; perubahan orang lain ditolak
    // sebagai versi basi saat Simpan.
    const setup = useSuspenseQuery(
        orpc.billingSetupShow.queryOptions({
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
    path: '/billing/setup',
    layout: 'app',
    title: 'Setelan kasir',
    component: BillingSetupPage,
});
