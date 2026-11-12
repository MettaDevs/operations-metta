import { Button } from '@operations-metta/ui/button';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Spinner } from '@operations-metta/ui/spinner';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    PasswordInput,
    ssoErrorMessage,
} from '../shell/index.ts';

const route = getRouteApi('/_app/profile');

// Profil pengguna yang sedang masuk. Bagian akun SSO hanya tampil bila SSO disetel: menautkan akun dimulai dengan
// kata sandi yang diketik ulang, lalu peramban dibawa ke halaman masuk SSO dan kembali ke sini.
function ProfilePage(): ReactNode {
    const { sso, sso_error: ssoError } = route.useSearch();
    const { data: profile, refetch } = useSuspenseQuery(
        orpc.profile.queryOptions({ select: (response) => response.body }),
    );
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(() =>
        ssoErrorMessage(
            ssoError,
            'Belum berhasil menautkan akun SSO. Silakan ulangi.',
        ),
    );
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (sso === 'linked') toast.success('Akun SSO berhasil ditautkan.');
    }, [sso]);

    const link = async (password: string) => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.profileSsoLink({ body: { password } });
            window.location.assign(body.authorization_url);
        } catch (caught) {
            setBusy(false);
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Belum berhasil menautkan akun SSO.'),
                );
        }
    };

    const unlink = async (id: string) => {
        setBusy(true);
        setMessage(null);
        try {
            await api.profileSsoUnlink({ params: { id }, body: {} });
            toast.success('Tautan akun SSO dilepas.');
            await refetch();
        } catch (caught) {
            setMessage(errorText(caught, 'Tautan akun SSO belum dilepas.'));
        } finally {
            setBusy(false);
        }
    };

    const linked = profile.identities[0];

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Profil" />
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <FormGrid>
                    <FormControl>
                        <Input label="Nama" value={profile.name} readOnly />
                    </FormControl>
                    <FormControl>
                        <Input label="Email" value={profile.email} readOnly />
                    </FormControl>
                </FormGrid>
                {(profile.sso_enabled || linked) && (
                    <section className="mt-8 grid max-w-xl gap-4">
                        <h2 className="text-base font-semibold">Akun SSO</h2>
                        <FormErrorHeader
                            errors={errors}
                            message={message}
                            operation="Akun SSO belum ditautkan"
                        />
                        {linked ? (
                            <>
                                <p className="text-sm">
                                    Akun ini sudah tertaut ke akun SSO
                                    {linked.email_at_link
                                        ? ` ${linked.email_at_link}`
                                        : ''}
                                    . Anda bisa masuk dengan tombol &quot;Masuk
                                    dengan SSO&quot; di halaman masuk.
                                </p>
                                {profile.has_password ? (
                                    <div>
                                        <Button
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() =>
                                                void unlink(linked.id)
                                            }
                                            data-test="sso-unlink-button"
                                        >
                                            {busy && <Spinner />}
                                            Lepas tautan
                                        </Button>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        Akun ini hanya bisa masuk lewat SSO,
                                        jadi tautannya tidak bisa dilepas.
                                    </p>
                                )}
                            </>
                        ) : !profile.has_password ? (
                            <p className="text-sm text-muted-foreground">
                                Akun ini belum punya kata sandi, jadi belum bisa
                                ditautkan ke akun SSO dari sini.
                            </p>
                        ) : (
                            <form
                                noValidate
                                className="grid gap-4"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    const value = new FormData(
                                        event.currentTarget,
                                    ).get('password');
                                    void link(
                                        typeof value === 'string' ? value : '',
                                    );
                                }}
                            >
                                <p className="text-sm">
                                    Tautkan akun SSO perusahaan supaya Anda bisa
                                    masuk tanpa mengetik kata sandi. Ketik kata
                                    sandi akun ini dulu untuk memastikan ini
                                    memang Anda.
                                </p>
                                <div data-error-field="password">
                                    <PasswordInput
                                        id="password"
                                        label="Kata sandi"
                                        name="password"
                                        required
                                        autoComplete="current-password"
                                    />
                                </div>
                                <div>
                                    <Button
                                        type="submit"
                                        disabled={busy}
                                        data-test="sso-link-button"
                                    >
                                        {busy && <Spinner />}
                                        Tautkan akun SSO
                                    </Button>
                                </div>
                            </form>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/profile',
    layout: 'app',
    title: 'Profil',
    validateSearch: z.object({
        sso: z.enum(['linked']).optional(),
        sso_error: z.string().optional(),
    }),
    component: ProfilePage,
});
