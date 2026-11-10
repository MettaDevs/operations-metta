import { createApplication } from '../../src/main.ts';
import { loadConfig } from '../../src/platform/config/index.ts';
import { createPool } from '../../src/platform/database/index.ts';

// Aplikasi lengkap dari src/main.ts di atas database test yang namanya diambil dari env DB_*, dipanggil seperti
// browser memanggilnya: lewat Request sungguhan, dengan cookie, token XSRF, dan alamat IP. Setiap pemanggilan
// memakai alamat IP sendiri, supaya pembatas percobaan login tidak terbawa antar-berkas test. Sesi di tabel
// sessions, kecuali pemanggil meminta SESSION_BACKEND lain.
export function operationsTestApp(environment: Record<string, string> = {}) {
    const config = loadConfig({
        ...process.env,
        SESSION_BACKEND: 'database',
        // .env laptop mengisi BASE_DOMAIN=localhost untuk dev:setup; test yang tidak memintanya memakai alamat polos.
        BASE_DOMAIN: '',
        ...environment,
        APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
        SESSION_LOTTERY_HITS: '0',
    });
    const application = createApplication(config);
    const pool = createPool(config);
    const address = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

    // Satu browser: cookie dari Set-Cookie disimpan dan dikirim lagi, dan request yang mengubah data membawa
    // header X-XSRF-TOKEN dari cookie XSRF-TOKEN, sama dengan klien axios di layar CoreERP.
    // host memilih lingkungan bila BASE_DOMAIN diisi, misalnya `klinik.uji.test`.
    function browser(host = 'localhost') {
        const cookies = new Map<string, string>();
        async function request(
            method: string,
            path: string,
            options: {
                body?: unknown;
                headers?: Record<string, string>;
                // Mengirim cookie peramban ini ke alamat lain, seperti penyerang yang memutar ulang cookie curian.
                host?: string;
            } = {},
        ): Promise<Response> {
            const xsrf = cookies.get('XSRF-TOKEN');
            const response = await application.handle(
                new Request(`http://${options.host ?? host}${path}`, {
                    method,
                    headers: {
                        accept: 'application/json',
                        ...(options.body === undefined
                            ? {}
                            : { 'content-type': 'application/json' }),
                        ...(cookies.size
                            ? {
                                  cookie: [...cookies]
                                      .map(
                                          ([name, value]) => `${name}=${value}`,
                                      )
                                      .join('; '),
                              }
                            : {}),
                        ...(xsrf && method !== 'GET'
                            ? { 'x-xsrf-token': decodeURIComponent(xsrf) }
                            : {}),
                        ...options.headers,
                    },
                    body:
                        options.body === undefined
                            ? undefined
                            : JSON.stringify(options.body),
                }),
                address,
            );
            for (const cookie of response.headers.getSetCookie()) {
                const [pair = ''] = cookie.split(';');
                const position = pair.indexOf('=');
                cookies.set(pair.slice(0, position), pair.slice(position + 1));
            }
            return response;
        }
        return {
            request,
            cookies,
            get: (path: string) => request('GET', path),
            post: (path: string, body: unknown = {}) =>
                request('POST', path, { body }),
            patch: (path: string, body: unknown) =>
                request('PATCH', path, { body }),
            delete: (path: string, body: unknown = {}) =>
                request('DELETE', path, { body }),
            put: (path: string, body: unknown) =>
                request('PUT', path, { body }),
            // Layar login tidak memuat data apa pun sebelum POST /login, jadi belum ada cookie XSRF-TOKEN. Peramban
            // mengirim Sec-Fetch-Site same-origin, dan pemeriksaan CSRF di identity menerimanya.
            async login(email: string, password: string) {
                const response = await request('POST', '/login', {
                    body: { email, password },
                    headers: { 'sec-fetch-site': 'same-origin' },
                });
                if (response.status !== 200)
                    throw new Error(
                        `Login failed with ${response.status}: ${await response.text()}`,
                    );
            },
        };
    }

    return {
        config,
        pool,
        browser,
        close: async () => {
            await application.close();
            await pool.end();
        },
    };
}

export type Browser = ReturnType<
    ReturnType<typeof operationsTestApp>['browser']
>;
