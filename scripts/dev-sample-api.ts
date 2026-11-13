import { z } from 'zod';
import type { createApplication } from '../src/main.ts';

export const idRow = z.object({ id: z.string() });
export const keyRow = z.object({
    id: z.string(),
    code: z.string().optional(),
    name: z.string().optional(),
});

export function required<T>(map: Map<string, T>, key: string, what: string): T {
    const value = map.get(key);
    if (value === undefined)
        throw new Error(`${what} contoh ${key} tidak ada di dev/tenants.json.`);
    return value;
}

// Admin pertama yang memanggil API lewat application.handle, seperti peramban: cookie sesi dan token CSRF dibawa di
// setiap permintaan. `created` menghitung data yang lahir (jawaban 201), untuk laporan dev-setup.
export function sampleApi(
    application: ReturnType<typeof createApplication>,
    host: string,
) {
    const cookies = new Map<string, string>();
    let created = 0;
    async function call(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<unknown> {
        const xsrf = cookies.get('XSRF-TOKEN');
        const response = await application.handle(
            new Request(`http://${host}${path}`, {
                method,
                headers: {
                    accept: 'application/json',
                    'sec-fetch-site': 'same-origin',
                    ...(body === undefined
                        ? {}
                        : { 'content-type': 'application/json' }),
                    ...(cookies.size
                        ? {
                              cookie: [...cookies]
                                  .map(([name, value]) => `${name}=${value}`)
                                  .join('; '),
                          }
                        : {}),
                    ...(xsrf
                        ? { 'x-xsrf-token': decodeURIComponent(xsrf) }
                        : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            }),
            '127.0.0.1',
        );
        for (const cookie of response.headers.getSetCookie()) {
            const [pair = ''] = cookie.split(';');
            const position = pair.indexOf('=');
            cookies.set(pair.slice(0, position), pair.slice(position + 1));
        }
        const text = await response.text();
        if (!response.ok)
            throw new Error(
                `${method} ${path} gagal (${response.status}): ${text}`,
            );
        if (response.status === 201) created += 1;
        return text ? JSON.parse(text) : null;
    }
    async function data<T extends z.ZodType>(
        schema: T,
        method: string,
        path: string,
        body?: unknown,
    ): Promise<z.output<T>> {
        const envelope = z
            .object({ data: z.unknown() })
            .parse(await call(method, path, body));
        return schema.parse(envelope.data);
    }
    // Baris daftar yang cocok persis. Pencarian `q` mencocokkan awal kata, jadi hasilnya disaring lagi di sini.
    async function find<T extends z.ZodType>(
        schema: T,
        path: string,
        q: string,
        matches: (row: z.output<T>) => boolean,
    ): Promise<z.output<T> | undefined> {
        const rows = await data(
            z.array(schema),
            'GET',
            `${path}${path.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}&per_page=100`,
        );
        return rows.find(matches);
    }
    // Master yang sudah ada dikenali dari kode atau namanya, jadi data contoh yang diulang tidak menggandakannya. `list`
    // menyaring daftar yang dicari, misalnya per unit, bila nama yang sama boleh ada di unit lain.
    async function ensure(
        path: string,
        key: 'code' | 'name',
        value: string,
        body: object,
        q = value,
        list = path,
    ): Promise<string> {
        const found = await find(keyRow, list, q, (row) => row[key] === value);
        return found?.id ?? (await data(idRow, 'POST', path, body)).id;
    }
    async function ensureEach<T extends { code: string }>(
        path: string,
        rows: T[],
        body: (row: T) => Promise<object> = (row) => Promise.resolve(row),
    ): Promise<Map<string, string>> {
        const ids = new Map<string, string>();
        for (const row of rows)
            ids.set(
                row.code,
                await ensure(path, 'code', row.code, await body(row)),
            );
        return ids;
    }
    // Id pilihan yang sudah ada dari kodenya, misalnya golongan obat bawaan module atau obat yang bisa diresepkan.
    async function codeId(path: string, code: string): Promise<string> {
        const found = await find(
            keyRow,
            path,
            code,
            (row) => row.code === code,
        );
        if (!found)
            throw new Error(`Kode contoh ${code} tidak ada di ${path}.`);
        return found.id;
    }
    // Legal entity dari kode legal entity-nya, operating unit dari nomornya.
    async function findOrganization(code: string): Promise<string | undefined> {
        const found = await find(
            z.object({
                id: z.string(),
                legal_entity: z.object({ company_code: z.string() }).nullable(),
                operating_unit: z
                    .object({ number: z.string().nullable() })
                    .nullable(),
            }),
            '/api/v1/organizations?incremental=1',
            code,
            (row) =>
                row.legal_entity?.company_code === code ||
                row.operating_unit?.number === code,
        );
        return found?.id;
    }
    async function organization(code: string): Promise<string> {
        const id = await findOrganization(code);
        if (!id) throw new Error(`Organisasi contoh ${code} tidak ada.`);
        return id;
    }
    return {
        call,
        data,
        find,
        ensure,
        ensureEach,
        codeId,
        findOrganization,
        organization,
        created: () => created,
    };
}
export type SampleApi = ReturnType<typeof sampleApi>;
