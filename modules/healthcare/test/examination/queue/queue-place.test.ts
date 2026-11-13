import { describe, expect, test } from 'bun:test';
import {
    defaultPractitioner,
    defaultSection,
} from '../../../src/examination/queue/queue-place.ts';

// Poli dan nakes bawaan Antrean poli: dari nakes milik pengguna yang berjadwal hari itu, seperti dokter dan poli bawaan
// daftar poli sistem lama, dengan poli terakhir di perangkat ini sebagai cadangan.
describe('queue default filters', () => {
    const umum = { id: 'umum', practitioners: [{ id: 'dokter-a' }] };
    const gigi = {
        id: 'gigi',
        practitioners: [{ id: 'dokter-b' }, { id: 'dokter-c' }],
    };
    const kia = { id: 'kia', practitioners: [{ id: 'dokter-b' }] };
    const sections = [umum, gigi, kia];

    test('a user with a scheduled nakes opens that nakes and its section', () => {
        expect(defaultSection(sections, { rooms: {} }, ['dokter-b'])).toBe(
            gigi,
        );
        expect(defaultPractitioner(gigi, ['dokter-b'])).toBe('dokter-b');
    });

    test('the last section on this device wins only among the sections of the nakes', () => {
        const ids = ['dokter-b'];
        expect(
            defaultSection(sections, { section: 'kia', rooms: {} }, ids),
        ).toBe(kia);
        expect(
            defaultSection(sections, { section: 'umum', rooms: {} }, ids),
        ).toBe(gigi);
        expect(defaultPractitioner(umum, ids)).toBeUndefined();
    });

    test('a user without a scheduled nakes keeps the last section on this device, then the first', () => {
        expect(
            defaultSection(sections, { section: 'kia', rooms: {} }, []),
        ).toBe(kia);
        expect(
            defaultSection(sections, { section: 'hilang', rooms: {} }, [
                'dokter-z',
            ]),
        ).toBe(umum);
        const none: typeof sections = [];
        expect(
            defaultSection(none, { rooms: {} }, ['dokter-b']),
        ).toBeUndefined();
        expect(defaultPractitioner(undefined, ['dokter-b'])).toBeUndefined();
    });
});
