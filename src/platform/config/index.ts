import { z } from 'zod';

const environmentSchema = z.object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive(),
    DB_DATABASE: z.string().min(1),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    APP_KEY: z.string().min(1),
    APP_PREVIOUS_KEYS: z.literal('').default(''),
    SESSION_DRIVER: z.literal('database').default('database'),
    SESSION_ENCRYPT: z.literal('false').default('false'),
    CACHE_STORE: z.literal('database').default('database'),
    CACHE_PREFIX: z.string().default('laravel-cache-'),
    COREERP_LICENSE_REQUIRED: z.literal('false').default('false'),
    // Domain dasar alamat lingkungan: `<tenant>.<BASE_DOMAIN>` dan `<tenant>.<kind>.<BASE_DOMAIN>`. Kosong berarti
    // alamat tidak dipakai dan semua request memakai database runtime, seperti di test dan server satu lingkungan.
    BASE_DOMAIN: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^([a-z0-9-]+(\.[a-z0-9-]+)*)?$/)
        .default(''),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(8000),
    // Folder hasil build peramban (manifest.json dan berkas ber-hash), relatif ke folder kerja proses.
    CLIENT_DIR: z.string().min(1).default('dist/client'),
    // Awalan __Host- membuat peramban menolak cookie ini bila dikirim tanpa Secure, dengan Domain, atau dari subdomain
    // lain, sehingga lingkungan di subdomain sebelah tidak bisa menimpa sesi (USENIX Security 2021, "Can I Take Your
    // Subdomain?"). localhost dan *.localhost dianggap aman oleh peramban, jadi Secure tetap berlaku di laptop.
    SESSION_COOKIE: z.string().default('__Host-session'),
    SESSION_LIFETIME: z.coerce.number().int().positive().default(120),
    SESSION_SECURE_COOKIE: z.enum(['true', 'false']).default('false'),
    SESSION_LOTTERY_HITS: z.coerce.number().int().min(0).default(2),
    SESSION_LOTTERY_OUT_OF: z.coerce.number().int().positive().default(100),
    DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    TRACE_FILE: z.string().optional(),
    SESSION_BACKEND: z.enum(['database', 'valkey']).default('database'),
    VALKEY_HOST: z.string().min(1).default('valkey'),
    VALKEY_PORT: z.coerce.number().int().positive().default(6379),
    SESSION_KEY_PREFIX: z.string().default('coreerp-session:'),
    // Worker lingkungan (src/worker.ts): alamat proses agen control plane, id host runtime yang dicetak
    // `add-runtime-host`, berkas kunci privat RSA (PEM) pasangan kunci publik yang didaftarkan, dan jeda antar-claim
    // saat antrean kosong. Proses http tidak membacanya.
    CONTROL_PLANE_URL: z.url().optional(),
    WORKER_HOST_ID: z.uuid().optional(),
    WORKER_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(3600).default(10),
    // Seberapa sering worker melaporkan rilis dan keadaan lingkungan host ini ke control plane.
    WORKER_REPORT_SECONDS: z.coerce
        .number()
        .int()
        .min(30)
        .max(86400)
        .default(300),
    // Rilis yang dijalankan image ini; diisi saat image dibangun (build arg RELEASE).
    OPERATIONS_RELEASE: z.string().min(1).max(80).default('unreleased'),
    // Pelaporan kesalahan ke Sentry. Kosong berarti mati, dan itu bawaannya.
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),
});

// Cukup untuk membuka koneksi database, tanpa APP_KEY dan setelan server: dipakai migrate dan dev:setup.
export const databaseSettingsSchema = environmentSchema.pick({
    DB_HOST: true,
    DB_PORT: true,
    DB_DATABASE: true,
    DB_USERNAME: true,
    DB_PASSWORD: true,
});
export type DatabaseSettings = z.infer<typeof databaseSettingsSchema>;

export function loadConfig(
    environment: Record<string, string | undefined> = process.env,
) {
    const values = environmentSchema.parse(environment);
    const key = values.APP_KEY.startsWith('base64:')
        ? Buffer.from(values.APP_KEY.slice(7), 'base64')
        : Buffer.from(values.APP_KEY);
    if (key.length !== 32) {
        throw new Error('APP_KEY must contain a 32-byte AES-256 key.');
    }
    return { ...values, key };
}

export type Config = ReturnType<typeof loadConfig>;
