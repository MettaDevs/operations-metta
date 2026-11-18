import { ActionButton } from '@operations-metta/ui/action-button';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '../../../platform/shell/index.ts';

export type Discount = ApiBody<'billingDiscountList'>['data'][number];

// Kartu diskon, isian mDiscount sistem lama tanpa akun, yang menunggu finance. Jenis menggantikan tiga flag lama
// (DiskonTotal, DiskonKomponen, DiskonGroupJasa) yang hanya boleh menyala satu.

export const discountKindLabels: Record<string, string> = {
    total: 'Diskon total',
    komponen: 'Diskon komponen biaya',
    kelompok_jasa: 'Diskon kelompok jasa',
};
const kindItems = Object.entries(discountKindLabels).map(([value, label]) => ({
    value,
    label,
}));
const kindHints: Record<string, string> = {
    total: 'Persen dihitung dari Nilai tagihan.',
    komponen:
        'Persen dihitung dari nilai komponen biaya ini pada jasa dan dokter yang dipilih kasir.',
    kelompok_jasa:
        'Nilai diskon diketik kasir untuk jasa di kelompok ini; persennya tidak dihitung.',
};

type ServiceGroup = { id: string; name: string };
type ChargeComponent = { id: string; code: string; name: string };

const serviceGroupColumns: DataTableColumn<ServiceGroup>[] = [
    { id: 'name', header: 'Nama', width: 240, cell: (group) => group.name },
];
const componentColumns: DataTableColumn<ChargeComponent>[] = [
    {
        id: 'code',
        header: 'Kode',
        width: 120,
        cell: (component) => component.code,
    },
    {
        id: 'name',
        header: 'Nama',
        width: 240,
        cell: (component) => component.name,
    },
];

const formOf = (discount: Discount | null) => ({
    code: discount?.code ?? '',
    name: discount?.name ?? '',
    kind: discount?.kind ?? 'total',
    charge_component_id: discount?.charge_component_id ?? null,
    service_group_id: discount?.service_group_id ?? null,
    is_active: discount?.is_active ?? true,
});

export function DiscountCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: Discount | null;
    canManage: boolean;
    onSaved: (discount: Discount) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const activeId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    const { data: metadata } = useQuery(
        orpc.billingDiscountMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const dirty = JSON.stringify(form) !== JSON.stringify(formOf(record));
    usePageDialogRecord({
        recordTitle: record ? `${record.code} ${record.name}` : 'Diskon baru',
        editing,
        dirty,
    });
    const groups = [
        ...(metadata?.service_groups ?? []),
        ...(record?.service_group_id &&
        !metadata?.service_groups.some(
            (group) => group.id === record.service_group_id,
        )
            ? [
                  {
                      id: record.service_group_id,
                      name: record.service_group_name ?? '',
                  },
              ]
            : []),
    ];
    const group =
        groups.find((item) => item.id === form.service_group_id) ?? null;
    const components = (metadata?.charge_components ?? []).filter(
        (component) =>
            component.active || component.id === record?.charge_component_id,
    );
    const component =
        components.find((item) => item.id === form.charge_component_id) ?? null;

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = record
                ? await api.billingDiscountUpdate({
                      params: { id: record.id },
                      body: { ...form, version: record.version },
                  })
                : await api.billingDiscountCreate({ body: form });
            toast.success(record ? 'Diskon diperbarui.' : 'Diskon dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Diskon belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete diskon ${record.code}?`,
                description: 'Diskon ini tidak bisa dipilih lagi di kasir.',
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
            await api.billingDiscountDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Diskon dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Diskon belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            ref={portalContainer}
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
                                setForm(formOf(record));
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
                        ? 'Diskon belum dihapus'
                        : 'Diskon belum disimpan'
                }
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
                                setForm({ ...form, code: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={100}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.kind?.[0]}
                        data-error-field="kind"
                        hint={kindHints[form.kind]}
                    >
                        {editing ? (
                            <Select
                                label="Jenis"
                                required
                                items={kindItems}
                                value={form.kind}
                                onValueChange={(next) =>
                                    setForm({ ...form, kind: next || 'total' })
                                }
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Jenis"
                                value={discountKindLabels[form.kind] ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    {form.kind === 'komponen' && (
                        <FormControl
                            error={errors.charge_component_id?.[0]}
                            data-error-field="charge_component_id"
                        >
                            {editing ? (
                                <InlineLookup<ChargeComponent>
                                    label="Komponen biaya"
                                    required
                                    items={components}
                                    value={component}
                                    onValueChange={(next) =>
                                        setForm({
                                            ...form,
                                            charge_component_id: next.id,
                                        })
                                    }
                                    getItemValue={(item) => item.id}
                                    getItemLabel={(item) =>
                                        `${item.code} · ${item.name}`
                                    }
                                    placeholder="Cari kode atau nama…"
                                    emptyMessage="Belum ada komponen biaya."
                                    portalContainer={portalContainer}
                                    columns={componentColumns}
                                />
                            ) : (
                                <Input
                                    label="Komponen biaya"
                                    value={
                                        component
                                            ? `${component.code} · ${component.name}`
                                            : ''
                                    }
                                    readOnly
                                />
                            )}
                        </FormControl>
                    )}
                    {form.kind === 'kelompok_jasa' && (
                        <FormControl
                            error={errors.service_group_id?.[0]}
                            data-error-field="service_group_id"
                            hint="Kelompok jasa dari biaya yang sudah dikirim layanan kesehatan ke kasir."
                        >
                            {editing ? (
                                <InlineLookup<ServiceGroup>
                                    label="Kelompok jasa"
                                    required
                                    items={groups}
                                    value={group}
                                    onValueChange={(next) =>
                                        setForm({
                                            ...form,
                                            service_group_id: next.id,
                                        })
                                    }
                                    getItemValue={(item) => item.id}
                                    getItemLabel={(item) => item.name}
                                    placeholder="Cari kelompok jasa…"
                                    emptyMessage="Belum ada biaya berkelompok jasa yang masuk kasir."
                                    portalContainer={portalContainer}
                                    columns={serviceGroupColumns}
                                />
                            ) : (
                                <Input
                                    label="Kelompok jasa"
                                    value={group?.name ?? ''}
                                    readOnly
                                />
                            )}
                        </FormControl>
                    )}
                    <FormControl hint="Diskon nonaktif tidak bisa dipilih di kasir. Pembayaran yang sudah memakainya tetap tersimpan.">
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id={activeId}
                                checked={form.is_active}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, is_active: checked })
                                }
                            />
                            <FieldLabel
                                htmlFor={activeId}
                                className="font-normal"
                            >
                                Aktif
                            </FieldLabel>
                        </Field>
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
