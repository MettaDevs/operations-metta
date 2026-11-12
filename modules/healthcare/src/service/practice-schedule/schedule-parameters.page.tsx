import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
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
} from '@core/platform/shell/index.ts';

// Parameter jadwal praktik per tenant: generate jadwal dari template berjalan sendiri atau tidak, dan sejauh apa ke
// depan. Bentuk layarnya mengikuti setelan Cek data ganda di Sys Admin.

function ScheduleParametersPage(): ReactNode {
    const { data: parameters, refetch } = useSuspenseQuery(
        orpc.healthcareScheduleParameters.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const editing = parameters.can_update;
    const [autoGenerate, setAutoGenerate] = useState(parameters.auto_generate);
    const [horizon, setHorizon] = useState(String(parameters.horizon_days));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const reset = () => {
        setAutoGenerate(parameters.auto_generate);
        setHorizon(String(parameters.horizon_days));
        setErrors({});
        setMessage(null);
    };

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.healthcareScheduleParametersUpdate({
                body: {
                    auto_generate: autoGenerate,
                    horizon_days: horizon,
                    ...(parameters.version === null
                        ? {}
                        : { version: parameters.version }),
                },
            });
            toast.success('Parameter jadwal disimpan.');
            setAutoGenerate(body.data.auto_generate);
            setHorizon(String(body.data.horizon_days));
            await refetch();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Parameter jadwal belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Parameter jadwal">
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            form="schedule-parameters"
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
                    id="schedule-parameters"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Parameter jadwal belum disimpan"
                    />
                    <FormGrid>
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id="schedule-auto-generate"
                                checked={autoGenerate}
                                disabled={!editing}
                                onCheckedChange={setAutoGenerate}
                            />
                            <FieldLabel htmlFor="schedule-auto-generate">
                                Generate jadwal otomatis
                            </FieldLabel>
                        </Field>
                        <FormControl
                            error={errors.horizon_days?.[0]}
                            hint="Banyaknya hari, mulai hari ini, yang jadwal praktiknya disusun otomatis dari template (1 sampai 92). Penyusunan berjalan saat layar Jadwal praktik atau form pendaftaran kunjungan dibuka. Jadwal yang sudah diubah di layar atau sudah punya pasien tidak ditimpa. Tombol Generate jadwal tetap bisa dipakai untuk rentang lain."
                        >
                            <Input
                                label="Jumlah hari ke depan"
                                required
                                inputMode="numeric"
                                maxLength={2}
                                data-error-field="horizon_days"
                                value={horizon}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setHorizon(event.target.value)
                                }
                            />
                        </FormControl>
                    </FormGrid>
                </form>
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/service/schedule-parameters',
    layout: 'app',
    title: 'Parameter jadwal',
    component: ScheduleParametersPage,
});
