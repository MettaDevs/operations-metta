import { ActionButton } from '@operations-metta/ui/action-button';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { RecordEditBoundary } from '@operations-metta/ui/record-edit-boundary';
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
} from '../shell/index.ts';

// Setelan cek data ganda: Search Hit % pada Marketing Setup BC, per tenant. Baris search string (nama, tanggal lahir,
// dan telepon) dipasang migration dan belum punya layar. Bentuk layarnya mengikuti rincian setup Organization.

function DuplicateSettingsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.partyMetadata.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const { data: settings, refetch } = useSuspenseQuery(
        orpc.partyDuplicateSettings.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const [editing, setEditing] = useState(false);
    const [percent, setPercent] = useState(String(settings.search_hit_percent));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const reset = () => {
        setPercent(String(settings.search_hit_percent));
        setErrors({});
        setMessage(null);
        setEditing(false);
    };

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.partyDuplicateSettingsUpdate({
                body: {
                    search_hit_percent: percent,
                    ...(settings.version === null
                        ? {}
                        : { version: settings.version }),
                },
            });
            toast.success('Setelan cek data ganda disimpan.');
            setPercent(String(body.data.search_hit_percent));
            setEditing(false);
            await refetch();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Setelan belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <RecordEditBoundary
            editing={editing}
            canEdit={metadata.canManage}
            disabled={busy}
            onEdit={() => setEditing(true)}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
        >
            <RecordActionBar title="Cek data ganda">
                {metadata.canManage &&
                    (!editing ? (
                        <ActionButton
                            action="edit"
                            onClick={() => setEditing(true)}
                        />
                    ) : (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                form="duplicate-settings"
                                disabled={busy}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                disabled={busy}
                                onClick={reset}
                            />
                        </>
                    ))}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <form
                    noValidate
                    id="duplicate-settings"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Setelan belum disimpan"
                    />
                    <FormGrid>
                        <FormControl
                            error={errors.search_hit_percent?.[0]}
                            hint="Saat orang baru disimpan, nama, tanggal lahir, dan telepon utamanya dipecah menjadi beberapa bagian lalu dicocokkan dengan orang lain. Orang lain ditawarkan sebagai kemungkinan data ganda bila persentase bagian yang cocok mencapai angka ini. Angka lebih kecil menawarkan lebih banyak kandidat."
                        >
                            <Input
                                label="Batas kecocokan (%)"
                                required
                                inputMode="numeric"
                                maxLength={3}
                                data-error-field="search_hit_percent"
                                value={percent}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setPercent(event.target.value)
                                }
                            />
                        </FormControl>
                    </FormGrid>
                </form>
            </div>
        </RecordEditBoundary>
    );
}

export const page = definePage({
    path: '/sysadmin/address-book/duplicate-check',
    previousPaths: ['/settings/party-duplicate-check'],
    layout: 'app',
    title: 'Cek data ganda',
    component: DuplicateSettingsPage,
});
