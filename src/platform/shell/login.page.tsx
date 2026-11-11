import { Button } from '@operations-metta/ui/button';
import { Input } from '@operations-metta/ui/input';
import { Spinner } from '@operations-metta/ui/spinner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { ApiError, errorText, orpc } from './api.ts';
import { AuthCard } from './auth-layout.tsx';
import { FormErrorHeader } from './form-error-header.tsx';
import { definePage } from './page.ts';
import { PasswordInput } from './password-input.tsx';

// Id route = id layout + path, seperti layout tanpa path di TanStack Router: `/_auth/login`.
const route = getRouteApi('/_auth/login');

// Hanya alamat di aplikasi ini, supaya tautan login tidak bisa dipakai untuk membawa pengguna ke situs lain.
function destination(redirect: string | undefined): string {
    return redirect?.startsWith('/') &&
        !redirect.startsWith('//') &&
        !redirect.startsWith('/\\')
        ? redirect
        : '/';
}

// Layar login CoreERP di atas POST /login yang sudah ada. Yang belum dipindah di server, dan karena itu tidak
// ditampilkan: lupa kata sandi, daftar, tetap masuk, SSO, passkey, dan verifikasi dua langkah.
function LoginPage(): ReactNode {
    const { redirect } = route.useSearch();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const login = useMutation(
        orpc.login.mutationOptions({
            onMutate: () => {
                setErrors({});
                setMessage(null);
            },
            onSuccess: async (response) => {
                if (response.body.two_factor) {
                    setMessage(
                        'Akun ini memakai verifikasi dua langkah, yang belum tersedia di aplikasi ini. Hubungi pengelola aplikasi.',
                    );
                    return;
                }
                queryClient.clear();
                await navigate({ href: destination(redirect) });
            },
            onError: (caught) => {
                if (caught instanceof ApiError && caught.status === 422)
                    setErrors(caught.errors);
                else setMessage(errorText(caught, 'Belum berhasil masuk.'));
            },
        }),
    );

    return (
        <AuthCard
            title="Masuk ke akun Anda"
            description="Gunakan email dan kata sandi akun Anda."
        >
            <form
                noValidate
                className="flex flex-col gap-6"
                onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const field = (name: string) => {
                        const value = form.get(name);
                        return typeof value === 'string' ? value : '';
                    };
                    login.mutate({
                        body: {
                            email: field('email'),
                            password: field('password'),
                        },
                    });
                }}
            >
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Belum berhasil masuk"
                />
                {/* Pesan per field ditempel ringkasan di atas ke field asalnya, jadi tidak ditulis kedua kalinya. */}
                <div className="grid gap-6">
                    <div className="grid gap-2" data-error-field="email">
                        <Input
                            id="email"
                            label="Email"
                            type="email"
                            name="email"
                            required
                            autoFocus
                            autoComplete="email"
                        />
                    </div>
                    <div className="grid gap-2" data-error-field="password">
                        <PasswordInput
                            id="password"
                            label="Kata sandi"
                            name="password"
                            required
                            autoComplete="current-password"
                        />
                    </div>
                    <Button
                        type="submit"
                        className="mt-4 w-full"
                        disabled={login.isPending}
                        data-test="login-button"
                    >
                        {login.isPending && <Spinner />}
                        Masuk
                    </Button>
                </div>
            </form>
        </AuthCard>
    );
}

export const page = definePage({
    path: '/login',
    layout: 'auth',
    title: 'Masuk',
    validateSearch: z.object({ redirect: z.string().optional() }),
    component: LoginPage,
});
