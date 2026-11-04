import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { z } from 'zod';
import type { Config } from './config.ts';

export type Bind = string | number | boolean | null;
export const jsonObject = z.record(z.string(), z.json());
export type JsonObject = z.infer<typeof jsonObject>;

export function createPool(config: Config) {
    return postgres({
        host: config.DB_HOST,
        port: config.DB_PORT,
        database: config.DB_DATABASE,
        username: config.DB_USERNAME,
        password: config.DB_PASSWORD,
        max: config.DB_POOL_SIZE,
        idle_timeout: 30,
        connect_timeout: 10,
        onnotice: () => {},
        types: {
            rawDate: {
                to: 1082,
                from: [1082, 1114, 1184],
                serialize: String,
                parse: String,
            },
        },
    });
}

export class Database {
    private depth = 0;
    private savepoint = 0;
    private queryNumber = 0;
    private readonly transactionListeners = new Set<() => void>();

    constructor(
        private readonly sql: postgres.ReservedSql,
        private readonly traceFile: string | undefined,
        private readonly requestId: string,
    ) {}

    async rows<S extends z.ZodType>(
        schema: S,
        query: string,
        parameters: Bind[] = [],
    ): Promise<z.output<S>[]> {
        return this.run(query, parameters, (rows) =>
            z.array(schema).parse(rows),
        );
    }

    private async run<T>(
        query: string,
        parameters: Bind[],
        read: (rows: postgres.RowList<postgres.Row[]>) => T,
    ): Promise<T> {
        const started = performance.now();
        let failed = false;
        try {
            // unsafe() tidak memakai prepared statement secara bawaan, sehingga setiap query di-parse dan di-plan ulang.
            return read(
                await this.sql.unsafe(query, parameters, { prepare: true }),
            );
        } catch (error) {
            failed = true;
            throw error;
        } finally {
            if (this.traceFile) {
                const template = query.replace(/\s+/g, ' ').trim();
                appendFileSync(
                    this.traceFile,
                    `${JSON.stringify({
                        request_id: this.requestId,
                        sequence: ++this.queryNumber,
                        connection_role: 'shared-central-business',
                        fingerprint: createHash('sha256')
                            .update(template)
                            .digest('hex'),
                        template,
                        duration_ms: performance.now() - started,
                        failed,
                    })}\n`,
                );
            }
        }
    }

    async one<S extends z.ZodType>(
        schema: S,
        query: string,
        parameters: Bind[] = [],
    ): Promise<z.output<S> | undefined> {
        return (await this.rows(schema, query, parameters))[0];
    }

    async execute(query: string, parameters: Bind[] = []): Promise<number> {
        return this.run(query, parameters, (rows) => rows.count);
    }

    async insert(table: string, data: Record<string, Bind>): Promise<void> {
        const fields = Object.keys(data);
        const identifiers = [table, ...fields];
        if (identifiers.some((value) => !/^[a-z_][a-z0-9_]*$/.test(value))) {
            throw new Error('Invalid internal SQL identifier.');
        }
        await this.execute(
            `insert into ${table} (${fields.join(',')}) values (${fields.map((field, index) => `$${index + 1}${['details', 'atribut', 'saldo_awal_buku', 'hold_reasons', 'payload', 'input', 'data'].includes(field) ? '::text::json' : ''}`).join(',')})`,
            Object.values(data),
        );
    }

    async transaction<T>(callback: () => Promise<T>): Promise<T> {
        const nested = this.depth > 0;
        const name = `native_${++this.savepoint}`;
        await this.execute(nested ? `savepoint ${name}` : 'begin');
        if (!nested)
            for (const listener of this.transactionListeners) listener();
        this.depth++;
        try {
            const value = await callback();
            await this.execute(nested ? `release savepoint ${name}` : 'commit');
            return value;
        } catch (error) {
            await this.execute(
                nested ? `rollback to savepoint ${name}` : 'rollback',
            );
            throw error;
        } finally {
            this.depth--;
            if (!nested)
                for (const listener of this.transactionListeners) listener();
        }
    }

    onTransactionBoundary(listener: () => void): void {
        this.transactionListeners.add(listener);
    }

    get inTransaction(): boolean {
        return this.depth > 0;
    }

    async actor(userId: number | null): Promise<void> {
        await this.execute("select set_config('coreerp.user_id', $1, false)", [
            userId === null ? '' : String(userId),
        ]);
    }
}

export function sqlErrorCode(error: unknown): string | undefined {
    return error instanceof postgres.PostgresError ? error.code : undefined;
}
