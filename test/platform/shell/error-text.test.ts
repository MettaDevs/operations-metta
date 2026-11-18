import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { ApiError, errorText } from '../../../src/platform/shell/api.ts';

const consoleError = spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => consoleError.mockClear());
afterAll(() => consoleError.mockRestore());

test('an error that did not come from the API shows the fallback and is logged to the console', () => {
    const caught = new TypeError('Failed to fetch');

    expect(errorText(caught, 'Faktur belum dibatalkan.')).toBe(
        'Faktur belum dibatalkan.',
    );
    expect(consoleError).toHaveBeenCalledWith(
        '[errorText] Faktur belum dibatalkan.',
        caught,
    );
});

test('an API refusal shows its message and is not logged', () => {
    const caught = new ApiError(409, {
        error: { code: 'stale', message: 'Faktur sudah diubah orang lain.' },
    });

    expect(errorText(caught, 'Faktur belum dibatalkan.')).toBe(
        'Faktur sudah diubah orang lain.',
    );
    expect(consoleError).not.toHaveBeenCalled();
});
