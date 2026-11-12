import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    codeColumn,
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
import { Switch } from '@operations-metta/ui/switch';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import { DrugClassCard } from '../drug-class/drug-class-card.tsx';

export type Drug = ApiBody<'pharmacyDrugList'>['data'][number];

const formOf = (drug: Drug) => ({
    drugClass: drug.drug_class,
    isGeneric: drug.is_generic,
    isFormulary: drug.is_formulary,
});

const loadDrugClasses = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyDrugClassList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data,
        nextCursor: body.next_cursor,
        canCreate: body.can_manage,
    };
};

// Data farmasi satu barang persediaan (table extension BC atas Item). Kode, nama, dan satuan dasar milik kartu barang
// Core, jadi hanya dibaca di sini.
export function DrugCard({
    drug,
    canManage,
    onSaved,
}: {
    drug: Drug;
    canManage: boolean;
    onSaved: (drug: Drug) => void;
}): ReactNode {
    const [form, setForm] = useState(() => formOf(drug));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [creatingClass, setCreatingClass] = useState(false);
    const portalContainer = useRef<HTMLDivElement>(null);
    usePageDialogRecord({
        recordTitle: `${drug.code} ${drug.name}`,
        editing: canManage,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.pharmacyDrugUpdate({
                params: { id: drug.id },
                body: {
                    drug_class_id: form.drugClass?.id ?? null,
                    is_generic: form.isGeneric,
                    is_formulary: form.isFormulary,
                    version: drug.version,
                },
            });
            toast.success('Data obat farmasi disimpan.');
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Data obat farmasi belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };

    const toggle = (
        id: string,
        label: string,
        checked: boolean,
        change: (value: boolean) => void,
    ) => (
        <FormControl>
            <Field orientation="horizontal" className="w-auto">
                <Switch
                    id={id}
                    checked={checked}
                    disabled={!canManage}
                    onCheckedChange={change}
                />
                <FieldLabel htmlFor={id} className="font-normal">
                    {label}
                </FieldLabel>
            </Field>
        </FormControl>
    );

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
                    {canManage && (
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
                                    setForm(formOf(drug));
                                    setErrors({});
                                    setMessage(null);
                                }}
                            />
                        </>
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Data obat farmasi belum disimpan"
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <FormControl>
                            <Input label="Kode" value={drug.code} readOnly />
                        </FormControl>
                        <FormControl>
                            <Input label="Nama" value={drug.name} readOnly />
                        </FormControl>
                        <FormControl>
                            <Input
                                label="Satuan dasar"
                                value={drug.base_unit_name}
                                readOnly
                            />
                        </FormControl>
                        <MasterLookup<Reference>
                            label="Golongan obat"
                            field="drug_class_id"
                            value={form.drugClass}
                            onChange={(drugClass) =>
                                setForm((current) => ({
                                    ...current,
                                    drugClass: {
                                        id: drugClass.id,
                                        code: drugClass.code,
                                        name: drugClass.name,
                                    },
                                }))
                            }
                            disabled={!canManage}
                            error={errors.drug_class_id?.[0]}
                            hint="Golongan menentukan obat ini masuk laporan narkotika dan psikotropika."
                            portalContainer={portalContainer}
                            onCreate={
                                canManage
                                    ? () => setCreatingClass(true)
                                    : undefined
                            }
                            noun="Golongan obat"
                            load={loadDrugClasses}
                            columns={[codeColumn(160), nameColumn(220)]}
                        />
                        {toggle(
                            'drug-generic',
                            'Obat generik',
                            form.isGeneric,
                            (isGeneric) =>
                                setForm((current) => ({
                                    ...current,
                                    isGeneric,
                                })),
                        )}
                        {toggle(
                            'drug-formulary',
                            'Masuk formularium',
                            form.isFormulary,
                            (isFormulary) =>
                                setForm((current) => ({
                                    ...current,
                                    isFormulary,
                                })),
                        )}
                    </FormGrid>
                </PageDialogBody>
            </form>
            {creatingClass && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreatingClass(false);
                    }}
                >
                    <PageDialogContent title="Golongan obat">
                        <DrugClassCard
                            record={null}
                            canManage
                            onSaved={(drugClass) => {
                                setCreatingClass(false);
                                setForm((current) => ({
                                    ...current,
                                    drugClass: {
                                        id: drugClass.id,
                                        code: drugClass.code,
                                        name: drugClass.name,
                                    },
                                }));
                            }}
                            onClose={() => setCreatingClass(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
