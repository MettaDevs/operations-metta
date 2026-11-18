import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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

export type Session = ApiBody<'healthcarePracticeSessionList'>['data'][number];
type Permissions = ApiBody<'healthcarePracticeScheduleMetadata'>['permissions'];
type Errors = Record<string, string[]>;

export function SessionCard({
    session,
    permissions,
    onSaved,
    onClose,
}: {
    session: Session | null;
    permissions: Permissions;
    onSaved: (session: Session) => void;
    onClose: () => void;
}): ReactNode {
    const editing = session === null ? permissions.create : permissions.update;
    const blank = {
        name: session?.name ?? '',
        start_time: session?.start_time ?? '08:00',
        end_time: session?.end_time ?? '12:00',
        is_active: session?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: session?.name ?? 'Sesi baru',
        editing,
        dirty,
    });
    const crossesMidnight = form.end_time <= form.start_time;

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = session
                ? await api.healthcarePracticeSessionUpdate({
                      params: { id: session.id },
                      body: { ...form, version: session.version },
                  })
                : await api.healthcarePracticeSessionCreate({ body: form });
            toast.success(session ? 'Sesi diperbarui.' : 'Sesi dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Sesi belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!session) return;
        if (
            !(await confirm({
                title: `Delete sesi ${session.name}?`,
                description:
                    'Sesi tidak bisa dipilih lagi di template dan jadwal baru. Jadwal yang sudah tersusun tetap memakai jamnya.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcarePracticeSessionDelete({
                params: { id: session.id },
                body: { version: session.version },
            });
            toast.success('Sesi dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Sesi belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };
    const time = (id: 'start_time' | 'end_time', label: string) => (
        <FormControl error={errors[id]?.[0]}>
            <Input
                label={label}
                type="time"
                required
                data-error-field={id}
                value={form[id]}
                readOnly={!editing}
                onChange={(event) =>
                    setForm({ ...form, [id]: event.target.value })
                }
            />
        </FormControl>
    );

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
                                if (!session) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {session && permissions.delete && (
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
                operation="Sesi belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={50}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="session-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="session-active">Aktif</FieldLabel>
                    </Field>
                    {time('start_time', 'Jam mulai')}
                    {time('end_time', 'Jam selesai')}
                </FormGrid>
                {crossesMidnight && (
                    <p className="mt-3 text-sm text-muted-foreground">
                        Sesi ini selesai keesokan harinya. Jadwalnya tetap
                        tercatat pada tanggal mulai.
                    </p>
                )}
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

export function NewSessionDialog({
    permissions,
    onCreated,
    onClose,
}: {
    permissions: Permissions;
    onCreated: (session: Session) => void;
    onClose: () => void;
}): ReactNode {
    const queryClient = useQueryClient();
    return (
        <PageDialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <PageDialogContent title="Sesi praktik">
                <SessionCard
                    session={null}
                    permissions={permissions}
                    onSaved={(session) => {
                        queryClient.setQueryData(
                            orpc.healthcarePracticeScheduleMetadata.queryKey(),
                            (current) =>
                                current && {
                                    ...current,
                                    body: {
                                        ...current.body,
                                        sessions: [
                                            ...current.body.sessions,
                                            {
                                                id: session.id,
                                                name: session.name,
                                                start_time: session.start_time,
                                                end_time: session.end_time,
                                                is_active: session.is_active,
                                            },
                                        ],
                                    },
                                },
                        );
                        onCreated(session);
                    }}
                    onClose={onClose}
                />
            </PageDialogContent>
        </PageDialog>
    );
}
