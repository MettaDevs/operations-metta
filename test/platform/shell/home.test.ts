import { expect, test } from 'bun:test';
import {
    activeMenuHref,
    areaOf,
    homePath,
} from '../../../src/platform/shell/home.ts';

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

test('the lit menu entry is the exact address, else the deepest entry holding the page', () => {
    const list = '/healthcare/registration/visits';
    const create = '/healthcare/registration/visits/new';
    const menu = [list, create];
    expect(activeMenuHref(menu, list, list)).toBe(list);
    expect(activeMenuHref(menu, create, create)).toBe(create);
    expect(activeMenuHref(menu, `${create}?patient=p1`, create)).toBe(create);
    // Halaman satu kunjungan dibuka dari daftar.
    expect(activeMenuHref(menu, `${list}/0193`, `${list}/0193`)).toBe(list);
    expect(
        activeMenuHref(menu, '/healthcare/dashboard', '/healthcare/dashboard'),
    ).toBeUndefined();
    // Entri bersearch params hanya menyala pada alamat persisnya.
    const sections = ['/page?section=a', '/page?section=b'];
    expect(activeMenuHref(sections, '/page?section=b', '/page')).toBe(
        '/page?section=b',
    );
    expect(activeMenuHref(sections, '/page', '/page')).toBeUndefined();
});
