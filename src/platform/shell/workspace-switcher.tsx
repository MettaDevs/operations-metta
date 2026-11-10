import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
} from '@operations-metta/ui/field';
import { FormGrid } from '@operations-metta/ui/form-control';
import { Select } from '@operations-metta/ui/select';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@operations-metta/ui/sheet';
import { Building2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, ApiError, errorText } from './api.ts';
import type { ShellData } from './api.ts';
import { FormErrorHeader } from './form-error-header.tsx';

// Pemilih tempat kerja, dipindah dari workspace-switcher CoreERP: ruang kerja (tenant), perusahaan, dan unit kerja
// aktif. Server memeriksa pilihan terhadap yang terjangkau (PUT /api/v1/workspace-context) dan menyimpannya di sesi.
export function WorkspaceSwitcher({
    membership,
    workspace,
}: {
    membership: NonNullable<ShellData['auth']['membership']>;
    workspace: ShellData['workspace'];
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [membershipId, setMembershipId] = useState(membership.id);
    const [legalEntityId, setLegalEntityId] = useState(
        workspace.active_legal_entity?.id ?? null,
    );
    const [orgUnitId, setOrgUnitId] = useState(
        workspace.active_org_unit?.id ?? null,
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>(
        {},
    );

    const changingWorkspace = membershipId !== membership.id;
    const changed =
        changingWorkspace ||
        legalEntityId !== (workspace.active_legal_entity?.id ?? null) ||
        orgUnitId !== (workspace.active_org_unit?.id ?? null);
    const contextLabel = [
        membership.tenant_name,
        workspace.active_legal_entity?.name,
        workspace.active_org_unit?.name,
    ]
        .filter(Boolean)
        .join(' · ');

    const changeOpen = (nextOpen: boolean) => {
        if (saving) return;
        if (nextOpen) {
            setMembershipId(membership.id);
            setLegalEntityId(workspace.active_legal_entity?.id ?? null);
            setOrgUnitId(workspace.active_org_unit?.id ?? null);
            setError(null);
            setFieldErrors({});
        }
        setOpen(nextOpen);
    };

    const apply = async () => {
        setSaving(true);
        setError(null);
        setFieldErrors({});
        try {
            await api.workspace({
                body: {
                    membership_id: membershipId,
                    legal_entity_id: changingWorkspace ? null : legalEntityId,
                    org_unit_id: changingWorkspace ? null : orgUnitId,
                },
            });
            // Muat ulang penuh agar daftar dan isian tidak menyimpan konteks sebelumnya.
            window.location.reload();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status < 500)
                setFieldErrors(caught.errors);
            setError(
                errorText(caught, 'Tempat kerja belum berubah. Coba lagi.'),
            );
            setSaving(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={changeOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Pilih tempat kerja: ${contextLabel}`}
                    title={contextLabel}
                >
                    <Building2 aria-hidden="true" />
                </Button>
            </SheetTrigger>
            <SheetContent
                ref={contentRef}
                side="right"
                className="w-full gap-0 p-0 sm:max-w-lg"
                showCloseButton={!saving}
            >
                <SheetHeader className="border-b px-6 py-5 pr-12">
                    <SheetTitle>Tempat kerja</SheetTitle>
                    <SheetDescription>
                        Daftar transaksi mengikuti perusahaan aktif. Unit kerja
                        menjadi pilihan awal transaksi baru. Hak akses Anda
                        tetap berlaku.
                    </SheetDescription>
                </SheetHeader>
                {(error || Object.keys(fieldErrors).length > 0) && (
                    <div className="px-6 pt-4">
                        <FormErrorHeader
                            scopeRef={contentRef}
                            message={error}
                            errors={fieldErrors}
                            operation="Tempat kerja belum berubah"
                        />
                    </div>
                )}
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void apply();
                    }}
                >
                    <div className="flex-1 overflow-y-auto px-6 py-6">
                        <fieldset disabled={saving}>
                            <FormGrid columns={1}>
                                <Field
                                    data-error-field="membership_id"
                                    data-invalid={!!fieldErrors.membership_id}
                                >
                                    {workspace.memberships.length > 1 ? (
                                        <Select
                                            label="Ruang kerja"
                                            value={membershipId}
                                            onValueChange={(value) =>
                                                value && setMembershipId(value)
                                            }
                                            items={workspace.memberships.map(
                                                (item) => ({
                                                    value: item.id,
                                                    label: item.tenant_name,
                                                }),
                                            )}
                                            searchPlaceholder="Cari ruang kerja…"
                                            emptyMessage="Ruang kerja tidak ditemukan."
                                            portalContainer={contentRef}
                                        />
                                    ) : (
                                        <>
                                            <FieldLabel>Ruang kerja</FieldLabel>
                                            <p className="text-sm">
                                                {membership.tenant_name}
                                            </p>
                                        </>
                                    )}
                                    <FieldError>
                                        {fieldErrors.membership_id?.join(' ')}
                                    </FieldError>
                                </Field>
                                {changingWorkspace ? (
                                    <FieldDescription>
                                        Terapkan untuk membuka ruang kerja ini.
                                        Setelah itu, pilih perusahaan dan unit
                                        yang tersedia di dalamnya.
                                    </FieldDescription>
                                ) : (
                                    <>
                                        <Field
                                            data-error-field="legal_entity_id"
                                            data-invalid={
                                                !!fieldErrors.legal_entity_id
                                            }
                                        >
                                            {workspace.legal_entities.length >
                                            1 ? (
                                                <Select
                                                    label="Perusahaan"
                                                    value={legalEntityId}
                                                    onValueChange={(value) =>
                                                        value &&
                                                        setLegalEntityId(value)
                                                    }
                                                    items={workspace.legal_entities.map(
                                                        (item) => ({
                                                            value: item.id,
                                                            label: item.name,
                                                        }),
                                                    )}
                                                    searchPlaceholder="Cari perusahaan…"
                                                    emptyMessage="Perusahaan tidak ditemukan."
                                                    portalContainer={contentRef}
                                                />
                                            ) : (
                                                <>
                                                    <FieldLabel>
                                                        Perusahaan
                                                    </FieldLabel>
                                                    <p className="text-sm">
                                                        {workspace
                                                            .active_legal_entity
                                                            ?.name ??
                                                            'Belum ada perusahaan yang tersedia.'}
                                                    </p>
                                                </>
                                            )}
                                            <FieldError>
                                                {fieldErrors.legal_entity_id?.join(
                                                    ' ',
                                                )}
                                            </FieldError>
                                        </Field>
                                        <Field
                                            data-error-field="org_unit_id"
                                            data-invalid={
                                                !!fieldErrors.org_unit_id
                                            }
                                        >
                                            {workspace.org_units.length > 1 ? (
                                                <Select
                                                    label="Unit kerja"
                                                    value={orgUnitId}
                                                    onValueChange={(value) =>
                                                        value &&
                                                        setOrgUnitId(value)
                                                    }
                                                    items={workspace.org_units.map(
                                                        (item) => ({
                                                            value: item.id,
                                                            label: item.name,
                                                        }),
                                                    )}
                                                    searchPlaceholder="Cari unit kerja…"
                                                    emptyMessage="Unit kerja tidak ditemukan."
                                                    portalContainer={contentRef}
                                                />
                                            ) : (
                                                <>
                                                    <FieldLabel>
                                                        Unit kerja
                                                    </FieldLabel>
                                                    <p className="text-sm">
                                                        {workspace
                                                            .active_org_unit
                                                            ?.name ??
                                                            'Belum ada unit kerja yang tersedia.'}
                                                    </p>
                                                </>
                                            )}
                                            <FieldError>
                                                {fieldErrors.org_unit_id?.join(
                                                    ' ',
                                                )}
                                            </FieldError>
                                        </Field>
                                    </>
                                )}
                                <FieldDescription>
                                    Halaman akan dimuat ulang saat diterapkan.
                                    Selesaikan isian yang belum disimpan sebelum
                                    berpindah.
                                </FieldDescription>
                            </FormGrid>
                        </fieldset>
                    </div>
                    <SheetFooter className="border-t sm:flex-row sm:justify-end">
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={saving}
                            onClick={() => changeOpen(false)}
                        />
                        <Button
                            type="submit"
                            disabled={saving || !changed || !membershipId}
                        >
                            {saving ? 'Menerapkan…' : 'Terapkan'}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
