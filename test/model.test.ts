import { expect, test } from 'bun:test';
import { idSchema, lookupId } from '../src/platform/model.ts';

// ULID 01JC9X0V2B3C4D5E6F7G8H9JKM dengan 128 bit yang sama: bit versi dan varian RFC 9562 tidak terisi.
const convertedUlid = '019313d0-6c4b-1b08-d2b8-cf3c1114ca74';

test('ids are uuid text as PostgreSQL prints it, whatever the version bits', () => {
    expect(idSchema.safeParse(Bun.randomUUIDv7()).success).toBe(true);
    expect(idSchema.safeParse(convertedUlid).success).toBe(true);
    for (const rejected of [
        '01JC9X0V2B3C4D5E6F7G8H9JKM',
        convertedUlid.toUpperCase(),
        convertedUlid.replaceAll('-', ''),
        `{${convertedUlid}}`,
    ])
        expect(idSchema.safeParse(rejected).success).toBe(false);
});

test('lookups keep ids and turn any other text into null', () => {
    expect(lookupId(convertedUlid)).toBe(convertedUlid);
    expect(lookupId('01JC9X0V2B3C4D5E6F7G8H9JKM')).toBeNull();
    expect(lookupId(convertedUlid.toUpperCase())).toBeNull();
});
