import { expect, test } from 'bun:test';
import {
    environmentHost,
    parseAddress,
} from '../../../src/platform/environment/index.ts';

const base = 'erp.example.test';

test('satu label adalah produksi, dua label adalah demo atau sandbox', () => {
    expect(parseAddress('klinik.erp.example.test', base)).toEqual({
        kind: 'environment',
        tenantSlug: 'klinik',
        environment: 'production',
    });
    expect(parseAddress('Klinik.Demo.erp.example.test:8443', base)).toEqual({
        kind: 'environment',
        tenantSlug: 'klinik',
        environment: 'demo',
    });
    expect(parseAddress('klinik.sandbox.erp.example.test.', base)).toEqual({
        kind: 'environment',
        tenantSlug: 'klinik',
        environment: 'sandbox',
    });
});

test('label cadangan, jenis lain, dan label berlebih tidak dikenal', () => {
    for (const host of [
        'admin.erp.example.test',
        'www.erp.example.test',
        'klinik.production.erp.example.test',
        'klinik.staging.erp.example.test',
        'a.b.c.erp.example.test',
    ])
        expect(parseAddress(host, base)).toEqual({ kind: 'unknown' });
});

test('domain dasar tanpa nama tenant dikenali tersendiri', () => {
    expect(parseAddress('erp.example.test', base)).toEqual({ kind: 'base' });
    expect(parseAddress('ERP.example.test:8443', base)).toEqual({
        kind: 'base',
    });
});

test('alamat di luar domain dasar, atau domain dasar kosong, tidak dirutekan', () => {
    for (const host of [
        'klinikerp.example.test',
        'klinik.example.test',
        '127.0.0.1:8000',
    ])
        expect(parseAddress(host, base)).toEqual({ kind: 'unrouted' });
    expect(parseAddress('klinik.erp.example.test', '')).toEqual({
        kind: 'unrouted',
    });
});

test('alamat yang dibentuk dibaca kembali ke lingkungan yang sama', () => {
    for (const environment of ['production', 'sandbox', 'demo'] as const)
        expect(
            parseAddress(environmentHost('klinik', environment, base), base),
        ).toEqual({ kind: 'environment', tenantSlug: 'klinik', environment });
});
