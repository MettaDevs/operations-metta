import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';

export type Procedure = ApiBody<'healthcareProcedureList'>['data'][number];
export type ProcedurePermissions =
    ApiBody<'healthcareProcedureMetadata'>['permissions'];
type Group = ApiBody<'healthcareProcedureMetadata'>['groups'][number];

// Kartu satu tindakan, dipakai daftar tindakan di Setup dan tombol Baru pada pilihan tindakan baris Biaya Tindakan
// pemeriksaan. Kartu memuat pilihan kelompoknya sendiri supaya bisa dibuka dari mana saja.
export function ProcedureCard({
    procedure,
    permissions,
    onSaved,
    onClose,
}: {
    procedure: Procedure | null;
    permissions: ProcedurePermissions;
    onSaved: (procedure: Procedure) => void;
    onClose: () => void;
}): ReactNode {
    const editing =
        procedure === null ? permissions.create : permissions.update;
    const blank = {
        code: procedure?.code ?? '',
        name: procedure?.name ?? '',
        group_id: procedure?.group_id ?? null,
        is_active: procedure?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    // Popup pilihan kelompok dipasang di dalam kartu, karena pemanggil tidak selalu memberi ref isi dialognya.
    const portalContainer = useRef<HTMLDivElement>(null);
    const { data: metadata } = useQuery(
        orpc.healthcareProcedureMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: procedure
            ? `${procedure.code} ${procedure.name}`
            : 'Tindakan baru',
        editing,
        dirty,
    });
    const groups = (metadata?.groups ?? []).filter(
        (group) => group.active || group.id === procedure?.group_id,
    );
    const group: Group | null =
        groups.find((item) => item.id === form.group_id) ??
        (form.group_id !== null && form.group_id === procedure?.group_id
            ? {
                  id: form.group_id,
                  code: '',
                  name: procedure.group_name ?? '',
                  active: false,
              }
            : null);

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = procedure
                ? await api.healthcareProcedureUpdate({
                      params: { id: procedure.id },
                      body: { ...form, version: procedure.version },
                  })
                : await api.healthcareProcedureCreate({ body: form });
            toast.success(
                procedure ? 'Tindakan diperbarui.' : 'Tindakan dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Tindakan belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!procedure) return;
        if (
            !(await confirm({
                title: `Delete tindakan ${procedure.code}?`,
                description:
                    'Tindakan ini tidak bisa dipilih lagi di pemeriksaan.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareProcedureDelete({
                params: { id: procedure.id },
                body: { version: procedure.version },
            });
            toast.success('Tindakan dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Tindakan belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
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
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    if (!procedure) {
                                        onClose();
                                        return;
                                    }
                                    setForm(blank);
                                    setErrors({});
                                }}
                            />
                        </>
                    )}
                    {procedure && permissions.delete && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Tindakan belum disimpan"
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <FormControl error={errors.code?.[0]}>
                            <Input
                                label="Kode"
                                required
                                maxLength={20}
                                data-error-field="code"
                                value={form.code}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        code: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl error={errors.name?.[0]}>
                            <Input
                                label="Nama"
                                required
                                maxLength={200}
                                data-error-field="name"
                                value={form.name}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        name: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={errors.group_id?.[0]}
                            data-error-field="group_id"
                        >
                            <InlineLookup
                                label="Kelompok"
                                disabled={!editing}
                                items={groups}
                                value={group}
                                displayValue={group?.name ?? ''}
                                onValueChange={(item) =>
                                    setForm({ ...form, group_id: item.id })
                                }
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                getSearchText={(item) =>
                                    `${item.code} ${item.name}`
                                }
                                placeholder="Cari kelompok…"
                                emptyMessage="Kelompok tidak ditemukan."
                                showDetails={false}
                                showFullList={false}
                                portalContainer={portalContainer}
                                columns={[
                                    {
                                        id: 'code',
                                        header: 'Kode',
                                        width: 120,
                                        cell: (item) => item.code,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 220,
                                        cell: (item) => item.name,
                                    },
                                ]}
                            />
                        </FormControl>
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id="procedure-active"
                                checked={form.is_active}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, is_active: checked })
                                }
                            />
                            <FieldLabel htmlFor="procedure-active">
                                Aktif
                            </FieldLabel>
                        </Field>
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
