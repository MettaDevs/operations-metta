import { createORPCClient, ORPCError } from '@orpc/client';
import type { AnyContractRouter } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { Router } from '../../main.ts';
import contract from './api-contract.generated.json';

type ErrorBody = {
    message?: unknown;
    errors?: Record<string, string[]>;
    error?: { code?: unknown; message?: unknown; field?: unknown };
};

function errorBody(value: unknown): ErrorBody {
    return value !== null && typeof value === 'object' ? value : {};
}

/**
 * Kegagalan dari API, padanan `CoreApiError` CoreERP: pesan pertama dari validasi (422), atau pesan
 * `{ error: { code, message } }`, beserta status, error per field, dan kodenya.
 */
export class ApiError extends ORPCError<'API_ERROR', ErrorBody> {
    readonly errors: Record<string, string[]>;
    readonly errorCode: string | null;

    constructor(status: number, body: unknown) {
        const data = errorBody(body);
        const firstError = data.errors
            ? Object.values(data.errors)[0]?.[0]
            : undefined;
        super('API_ERROR', {
            status,
            data,
            message:
                typeof firstError === 'string'
                    ? firstError
                    : typeof data.error?.message === 'string'
                      ? data.error.message
                      : typeof data.message === 'string' && data.message
                        ? data.message
                        : 'Permintaan belum berhasil.',
        });
        this.errors = data.errors ?? {};
        this.errorCode =
            typeof data.error?.code === 'string' ? data.error.code : null;
    }
}

function cookie(name: string): string | null {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(
        document.cookie,
    );
    return match?.[1] ? decodeURIComponent(match[1]) : null;
}

// Sesi dan CSRF memakai mekanisme yang sudah ada di src/platform/identity/: cookie sesi ikut terkirim, dan permintaan
// yang mengubah data membawa header X-XSRF-TOKEN dari cookie XSRF-TOKEN, seperti axios di layar CoreERP.
const link = new OpenAPILink(contract as AnyContractRouter, {
    url: () => window.location.origin,
    headers: () => {
        const token = cookie('XSRF-TOKEN');
        return {
            accept: 'application/json',
            ...(token ? { 'x-xsrf-token': token } : {}),
        };
    },
    fetch: (request, init) =>
        globalThis.fetch(request, { ...init, credentials: 'same-origin' }),
    customErrorResponseBodyDecoder: (body, response) =>
        new ApiError(response.status, body),
});

// Klien bertipe dari router oRPC di src/main.ts: input dan output setiap procedure datang dari sana, tidak ditulis
// ulang di layar.
export const api: JsonifiedClient<RouterClient<Router>> =
    createORPCClient(link);
export const orpc = createTanstackQueryUtils(api);

// Body jawaban sebuah procedure, untuk tipe data di layar.
export type ApiBody<K extends keyof typeof api> = Awaited<
    ReturnType<(typeof api)[K]>
>['body'];

export type ShellData = ApiBody<'shell'>;

export const shellQuery = orpc.shell.queryOptions({
    select: (response) => response.body,
    staleTime: 60_000,
});

export function isSessionExpired(caught: unknown): boolean {
    return (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 419)
    );
}

export function errorText(caught: unknown, fallback: string): string {
    if (isSessionExpired(caught))
        return 'Sesi login sudah berakhir. Masuk lagi untuk melanjutkan; isian di layar ini belum hilang.';
    if (caught instanceof ApiError)
        return caught.status >= 500
            ? `${fallback} Terjadi gangguan sistem. Hubungi pengelola aplikasi.`
            : caught.message || fallback;
    return fallback;
}
