import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '@core/platform/shell/index.ts';

export type Specialty = ApiBody<'healthcareSpecialtyList'>['data'][number];
type Permissions = ApiBody<'healthcareSpecialtyMetadata'>['permissions'];
type Errors = Record<string, string[]>;
type LineDraft = { key: string; id: string | null; name: string };

export function SpecialtyCard({
    specialty,
    permissions,
    portalContainer,
    onSaved,
    onClose,
}: {
    specialty: Specialty | null;
    permissions: Permissions;
    portalContainer: RefObject<HTMLDivElement | null>;
    onSaved: (specialty: Specialty) => void;
    onClose: () => void;
}): ReactNode {
    const editing =
        specialty === null ? permissions.create : permissions.update;
    const blank = () => ({
        name: specialty?.name ?? '',
        lines: (specialty?.subspecialties ?? []).map((line): LineDraft => ({
            key: line.id,
            id: line.id,
            name: line.name,
        })),
    });
    const [form, setForm] = useState(blank);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank());
    usePageDialogRecord({
        recordTitle: specialty?.name ?? 'Spesialis baru',
        editing,
        dirty,
    });
    const setLine = (key: string, name: string) =>
        setForm({
            ...form,
            lines: form.lines.map((line) =>
                line.key === key ? { ...line, name } : line,
            ),
        });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            name: form.name,
            subspecialties: form.lines.map(({ id, name }) => ({ id, name })),
        };
        try {
            const { body: saved } = specialty
                ? await api.healthcareSpecialtyUpdate({
                      params: { id: specialty.id },
                      body: { ...body, version: specialty.version },
                  })
                : await api.healthcareSpecialtyCreate({ body });
            toast.success(
                specialty ? 'Spesialis diperbarui.' : 'Spesialis dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Spesialis belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!specialty) return;
        if (
            !(await confirm({
                title: `Delete spesialis ${specialty.name}?`,
                description:
                    'Spesialis dan sub spesialisnya tidak bisa dipilih lagi di kartu nakes.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareSpecialtyDelete({
                params: { id: specialty.id },
                body: { version: specialty.version },
            });
            toast.success('Spesialis dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Spesialis belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
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
                                if (!specialty) {
                                    onClose();
                                    return;
                                }
                                setForm(blank());
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {specialty && permissions.delete && (
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
                operation="Spesialis belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={200}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                </FormGrid>
                <CollapsibleSectionGroup
                    className="mt-4"
                    defaultValue={['subspecialties']}
                >
                    <CollapsibleSection
                        value="subspecialties"
                        title="Sub Spesialis"
                        summary={`${String(form.lines.length)} sub spesialis`}
                    >
                        <div data-error-field="subspecialties">
                            <DocumentLines
                                title="Sub Spesialis"
                                data={form.lines}
                                getRowKey={(line) => line.key}
                                getRowLabel={(line) => line.name}
                                readOnly={!editing || busy}
                                portalContainer={portalContainer}
                                selection={
                                    editing
                                        ? {
                                              selectedKeys: selected,
                                              onSelectedKeysChange: (keys) =>
                                                  setSelected(keys.map(String)),
                                          }
                                        : undefined
                                }
                                onAddRow={
                                    editing
                                        ? () =>
                                              setForm({
                                                  ...form,
                                                  lines: [
                                                      ...form.lines,
                                                      {
                                                          key: crypto.randomUUID(),
                                                          id: null,
                                                          name: '',
                                                      },
                                                  ],
                                              })
                                        : undefined
                                }
                                onDeleteRows={
                                    editing
                                        ? (removed) =>
                                              setForm({
                                                  ...form,
                                                  lines: form.lines.filter(
                                                      (line) =>
                                                          !removed.includes(
                                                              line,
                                                          ),
                                                  ),
                                              })
                                        : undefined
                                }
                                emptyMessage={
                                    editing
                                        ? 'Belum ada sub spesialis. Pilih Tambah untuk menambahkan.'
                                        : 'Tidak ada sub spesialis.'
                                }
                                columns={[
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        content: 'control',
                                        minWidth: 260,
                                        cell: (line) => {
                                            const field = `subspecialties.${form.lines.indexOf(line)}.name`;
                                            return editing ? (
                                                <FormControl
                                                    error={errors[field]?.[0]}
                                                >
                                                    <Input
                                                        label="Nama"
                                                        required
                                                        maxLength={200}
                                                        data-error-field={field}
                                                        value={line.name}
                                                        onChange={(event) =>
                                                            setLine(
                                                                line.key,
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                            ) : (
                                                <DataTableText>
                                                    {line.name}
                                                </DataTableText>
                                            );
                                        },
                                    },
                                ]}
                            />
                            {errors.subspecialties?.map((text) => (
                                <p
                                    key={text}
                                    role="alert"
                                    className="mt-2 text-sm text-destructive"
                                >
                                    {text}
                                </p>
                            ))}
                        </div>
                    </CollapsibleSection>
                </CollapsibleSectionGroup>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
