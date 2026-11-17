import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import {
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { LocationLookup } from '../location/location-lookup.tsx';

// Kartu petugas lokasi (baris Warehouse Employees BC): pengguna, lokasi, dan tanda lokasi bawaan.

export type WarehouseEmployee =
    ApiBody<'inventoryWarehouseEmployeeList'>['data'][number];
type EmployeeUser = ApiBody<'inventoryWarehouseEmployeeUsers'>['data'][number];
type UserReference = EmployeeUser & { code: string };

const loadUsers = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryWarehouseEmployeeUsers(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((user): UserReference => ({
            ...user,
            code: user.email,
        })),
        nextCursor: body.next_cursor,
    };
};

function UserLookup(props: MasterLookupProps<UserReference>): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Pengguna"
            load={loadUsers}
            display={(user) => `${user.name} · ${user.code}`}
            columns={[
                nameColumn(200),
                {
                    id: 'email',
                    header: 'Email',
                    width: 220,
                    cell: (row) => row.email,
                },
            ]}
        />
    );
}

const formOf = (
    record: WarehouseEmployee | null,
    location: Reference | null,
) => ({
    location: record
        ? ({
              id: record.location.id,
              code: record.location.code,
              name: record.location.name,
          } satisfies Reference)
        : location,
    user: record
        ? ({
              id: record.user.id,
              code: record.user.email,
              name: record.user.name,
          } satisfies Reference)
        : null,
    isDefault: record?.is_default ?? false,
});

export function WarehouseEmployeeCard({
    record,
    location,
    canManage,
    onSaved,
    onClose,
}: {
    record: WarehouseEmployee | null;
    // Lokasi tetap bila kartu dibuka dari daftar petugas satu lokasi.
    location: Reference | null;
    canManage: boolean;
    onSaved: (employee: WarehouseEmployee) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record, location));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLDivElement>(null);
    const dirty =
        JSON.stringify(form) !== JSON.stringify(formOf(record, location));
    usePageDialogRecord({
        recordTitle: record
            ? `${record.user.name} · ${record.location.code}`
            : 'Petugas lokasi baru',
        editing,
        dirty,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            location_id: form.location?.id ?? '',
            user_id: form.user?.id ?? '',
            is_default: form.isDefault,
        };
        try {
            const { body: saved } = record
                ? await api.inventoryWarehouseEmployeeUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.inventoryWarehouseEmployeeCreate({ body });
            toast.success(
                record
                    ? 'Petugas lokasi diperbarui.'
                    : 'Petugas lokasi ditambahkan.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(errorText(caught, 'Petugas lokasi belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete ${record.user.name} dari lokasi ${record.location.code}?`,
                description: record.location.restricted_to_employees
                    ? 'Pengguna ini tidak lagi melihat resep dan dokumen stok lokasi ini.'
                    : 'Lokasi ini terbuka untuk semua pengguna, jadi akses pengguna ini belum berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setLastAction('delete');
        setErrors({});
        setMessage(null);
        try {
            await api.inventoryWarehouseEmployeeDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Petugas lokasi dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Petugas lokasi belum dihapus.'));
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
                                    if (!record) {
                                        onClose();
                                        return;
                                    }
                                    setForm(formOf(record, location));
                                    setErrors({});
                                    setMessage(null);
                                }}
                            />
                        </>
                    )}
                    {record && canManage && (
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
                    operation={
                        lastAction === 'delete'
                            ? 'Petugas lokasi belum dihapus'
                            : 'Petugas lokasi belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <UserLookup
                            label="Pengguna"
                            required
                            field="user_id"
                            value={form.user}
                            onChange={(user) => setForm({ ...form, user })}
                            disabled={!editing}
                            error={errors.user_id?.[0]}
                            portalContainer={portalContainer}
                        />
                        <LocationLookup
                            label="Lokasi"
                            required
                            field="location_id"
                            transit={false}
                            value={form.location}
                            onChange={({ id, code, name }) =>
                                setForm({
                                    ...form,
                                    location: { id, code, name },
                                })
                            }
                            disabled={!editing || location !== null}
                            error={errors.location_id?.[0]}
                            portalContainer={portalContainer}
                        />
                        <FormControl
                            error={errors.is_default?.[0]}
                            hint="Lokasi yang dipilih otomatis untuk pengguna ini, misalnya di antrean resep farmasi. Satu pengguna punya satu lokasi bawaan; menandai lokasi ini melepas tanda di lokasi lain."
                            data-error-field="is_default"
                        >
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id="warehouse-employee-default"
                                    checked={form.isDefault}
                                    disabled={!editing}
                                    onCheckedChange={(isDefault) =>
                                        setForm({ ...form, isDefault })
                                    }
                                />
                                <FieldLabel
                                    htmlFor="warehouse-employee-default"
                                    className="font-normal"
                                >
                                    Lokasi bawaan
                                </FieldLabel>
                            </Field>
                        </FormControl>
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
