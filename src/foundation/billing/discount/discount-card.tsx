import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
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
    const components = [
        ...(metadata?.charge_components ?? [])
            .filter(
                (component) =>
                    component.active ||
                    component.id === record?.charge_component_id,
            )
            .map((component) => ({
                value: component.id,
                label: `${component.code} · ${component.name}`,
            })),
    ];
    const groups = [
        ...(metadata?.service_groups ?? []).map((group) => ({
            value: group.id,
            label: group.name,
        })),
        ...(record?.service_group_id &&
        !metadata?.service_groups.some(
            (group) => group.id === record.service_group_id,
        )
            ? [
                  {
                      value: record.service_group_id,
                      label: record.service_group_name ?? '',
                  },
              ]
            : []),
    ];

    // Pilihan yang hanya bisa dibaca tampil sebagai teks, karena Select tidak punya mode baca-saja.
    const choice = (
        label: string,
        items: { value: string; label: string }[],
        value: string,
        onChange: (value: string) => void,
        search?: { placeholder: string; empty: string },
    ) =>
        editing ? (
            <Select
                label={label}
                required
                items={items}
                value={value}
                onValueChange={(next) => onChange(next ?? '')}
                {...(search
                    ? {
                          searchPlaceholder: search.placeholder,
                          emptyMessage: search.empty,
                      }
                    : {})}
                portalContainer={portalContainer}
            />
        ) : (
            <Input
                label={label}
                value={items.find((item) => item.value === value)?.label ?? ''}
                readOnly
            />
        );

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
                        {choice('Jenis', kindItems, form.kind, (value) =>
                            setForm({ ...form, kind: value || 'total' }),
                        )}
                    </FormControl>
                    {form.kind === 'komponen' && (
                        <FormControl
                            error={errors.charge_component_id?.[0]}
                            data-error-field="charge_component_id"
                        >
                            {choice(
                                'Komponen biaya',
                                components,
                                form.charge_component_id ?? '',
                                (value) =>
                                    setForm({
                                        ...form,
                                        charge_component_id: value || null,
                                    }),
                                {
                                    placeholder: 'Cari komponen biaya',
                                    empty: 'Belum ada komponen biaya.',
                                },
                            )}
                        </FormControl>
                    )}
                    {form.kind === 'kelompok_jasa' && (
                        <FormControl
                            error={errors.service_group_id?.[0]}
                            data-error-field="service_group_id"
                            hint="Kelompok jasa dari biaya yang sudah dikirim layanan kesehatan ke kasir."
                        >
                            {choice(
                                'Kelompok jasa',
                                groups,
                                form.service_group_id ?? '',
                                (value) =>
                                    setForm({
                                        ...form,
                                        service_group_id: value || null,
                                    }),
                                {
                                    placeholder: 'Cari kelompok jasa',
                                    empty: 'Belum ada biaya berkelompok jasa yang masuk kasir.',
                                },
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
