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
    COREERP_BASE_DOMAIN: z.literal('').default(''),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(8000),
    SESSION_COOKIE: z.string().default('laravel-session'),
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
});

export function loadConfig() {
    const values = environmentSchema.parse(process.env);
    const key = values.APP_KEY.startsWith('base64:')
        ? Buffer.from(values.APP_KEY.slice(7), 'base64')
        : Buffer.from(values.APP_KEY);
    if (key.length !== 32) {
        throw new Error('APP_KEY must contain a 32-byte AES-256 key.');
    }
    return { ...values, key };
}

export type Config = ReturnType<typeof loadConfig>;
