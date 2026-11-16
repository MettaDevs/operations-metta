import type { ErrorAction } from '../error-action/index.ts';

export class HttpFailure extends Error {
    constructor(
        readonly status: number,
        readonly body: object,
        readonly headers: Record<string, string> = {},
    ) {
        super(`HTTP ${status}`);
    }
}

export function abort(status: number, message: string): never {
    throw new HttpFailure(status, { message });
}

// `actions` hanya dibuat `refuse` (src/platform/access/), yang lebih dulu memeriksa pengguna boleh membuka tujuannya.
export function validation(
    errors: Record<string, string | string[]>,
    actions: readonly ErrorAction[] = [],
): never {
    const normalized = Object.fromEntries(
        Object.entries(errors).map(([field, messages]) => [
            field,
            Array.isArray(messages) ? messages : [messages],
        ]),
    );
    const messages = Object.values(normalized).flat();
    const first = messages[0] ?? 'The given data was invalid.';
    const remaining = messages.length - 1;
    const message =
        remaining > 0
            ? `${first} (and ${remaining} more ${remaining === 1 ? 'error' : 'errors'})`
            : first;
    throw new HttpFailure(422, {
        message,
        errors: normalized,
        ...(actions.length ? { actions } : {}),
    });
}

export const staleMessage =
    'Perubahanmu belum disimpan karena data ini sudah diubah sejak kamu membukanya. Muat ulang untuk melihat data terbaru, lalu ulangi perubahanmu.';

export function coded(status: number, code: string, message: string): never {
    throw new HttpFailure(status, { error: { code, message } });
}
