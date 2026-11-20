import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    shellQuery,
} from '../shell/index.ts';

// Setelan pribadi pengguna yang sedang masuk, dibuka dari menu profil. Setiap setelan tersimpan begitu dipilih dan
// langsung berlaku: nilai barunya ditulis ke data Shell, yang memasangnya sebagai atribut pada <html>.
function PreferencesPage(): ReactNode {
    const queryClient = useQueryClient();
    const { data: definitions } = useSuspenseQuery(
        orpc.preferences.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const { data: shell } = useSuspenseQuery(shellQuery);
    const values: Record<string, string> = shell.auth.user.preferences;
    const [message, setMessage] = useState<string | null>(null);

    const save = async (key: string, value: string) => {
        setMessage(null);
        try {
            const { body } = await api.preferenceUpdate({
                params: { key },
                body: { value },
            });
            queryClient.setQueryData(
                shellQuery.queryKey,
                (current) =>
                    current && {
                        ...current,
                        body: {
                            ...current.body,
                            auth: {
                                ...current.body.auth,
                                user: {
                                    ...current.body.auth.user,
                                    preferences: body.data,
                                },
                            },
                        },
                    },
            );
            toast.success('Setelan disimpan.');
        } catch (caught) {
            setMessage(errorText(caught, 'Setelan belum disimpan.'));
        }
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Setelan" />
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <FormErrorHeader
                    message={message}
                    operation="Setelan belum disimpan"
                />
                <FormGrid>
                    {definitions.map((definition) => (
                        <FormControl
                            key={definition.key}
                            hint={definition.help}
                        >
                            <Select
                                label={definition.label}
                                items={definition.options}
                                value={values[definition.key] ?? null}
                                onValueChange={(value) => {
                                    if (
                                        value &&
                                        value !== values[definition.key]
                                    )
                                        void save(definition.key, value);
                                }}
                            />
                        </FormControl>
                    ))}
                </FormGrid>
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/preferences',
    layout: 'app',
    title: 'Setelan',
    component: PreferencesPage,
});
