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

export function validation(errors: Record<string, string | string[]>): never {
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
    throw new HttpFailure(422, { message, errors: normalized });
}

export function coded(status: number, code: string, message: string): never {
    throw new HttpFailure(status, { error: { code, message } });
}
