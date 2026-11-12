import { expect, test } from 'bun:test';
import { areaOf, homePath } from '../../../src/platform/shell/home.ts';

const area = (id: string, ...hrefs: string[]) => ({
    id,
    href: hrefs[0] ?? '/',
    groups: [{ items: hrefs.map((href) => ({ href })) }],
});
const sysAdmin = area(
    'sysadmin',
    '/sysadmin/organization/legal-entities',
    '/sysadmin/access/staff',
);
const clinic = area('clinic', '/clinic/patient/patients');

test('the home page is the last area the user opened while the menu still has it, else the first area', () => {
    expect(homePath([sysAdmin, clinic], 'clinic')).toBe(
        '/clinic/patient/patients',
    );
    expect(homePath([sysAdmin, clinic], null)).toBe(
        '/sysadmin/organization/legal-entities',
    );
    // Akses ke area terakhir sudah dicabut: area pertama yang tersisa.
    expect(homePath([clinic], 'sysadmin')).toBe('/clinic/patient/patients');
    // Tidak ada halaman yang boleh dibuka.
    expect(homePath([], 'sysadmin')).toBeNull();
});

test('the open area is found from the page address, ignoring search params in the menu', () => {
    const withQuery = area('query', '/query/page?section=a');
    expect(areaOf([sysAdmin, clinic], '/sysadmin/access/staff')?.id).toBe(
        'sysadmin',
    );
    expect(areaOf([withQuery], '/query/page')?.id).toBe('query');
    expect(areaOf([sysAdmin, clinic], '/')).toBeUndefined();
    // Halaman di bawah sebuah menu, misalnya halaman satu record, tetap di area menu itu.
    expect(areaOf([sysAdmin, clinic], '/clinic/patient/patients/new')?.id).toBe(
        'clinic',
    );
    expect(
        areaOf([sysAdmin, clinic], '/clinic/patient/patientsx'),
    ).toBeUndefined();
});
