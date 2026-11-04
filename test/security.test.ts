import { expect, test } from 'bun:test';
import { CookieCipher, randomToken } from '../src/platform/security.ts';

test('encrypted cookies validate both the envelope MAC and the cookie-name prefix', () => {
    const cipher = new CookieCipher(Buffer.alloc(32, 19));
    const session = randomToken();
    const encrypted = cipher.encrypt('laravel-session', session);
    expect(cipher.decrypt('laravel-session', encrypted)).toBe(session);
    expect(cipher.decrypt('XSRF-TOKEN', encrypted)).toBeNull();
    const data = JSON.parse(Buffer.from(encrypted, 'base64').toString());
    data.value = data.value.slice(0, -2) + 'AA';
    expect(
        cipher.decrypt(
            'laravel-session',
            Buffer.from(JSON.stringify(data)).toString('base64'),
        ),
    ).toBeNull();
    expect(cipher.decrypt('laravel-session', 'broken')).toBeNull();
});
