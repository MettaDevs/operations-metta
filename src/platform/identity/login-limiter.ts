import { z } from 'zod';
import type { Database } from '../database/index.ts';

const maxAttempts = 5;
const decaySeconds = 60;
const flexiblePrefix = 'illuminate:cache:flexible:created:';
const cacheSchema = z.object({
    value: z.string(),
    expiration: z.coerce.number(),
});

const now = () => Math.floor(Date.now() / 1000);
const serialize = (value: number) => `i:${value};`;
const unserialize = (value: string) => Number(/^i:(-?\d+);$/.exec(value)?.[1]);

export class RateLimiter {
    constructor(
        private readonly db: Database,
        private readonly prefix: string,
    ) {}

    async attempts(key: string): Promise<number> {
        return (await this.get(key)) ?? 0;
    }

    async remaining(key: string): Promise<number> {
        return Math.max(0, maxAttempts - (await this.attempts(key)));
    }

    async tooManyAttempts(key: string): Promise<boolean> {
        if ((await this.attempts(key)) >= maxAttempts) {
            if ((await this.get(key + ':timer')) !== undefined) return true;
            await this.forget(key);
        }
        return false;
    }

    async availableIn(key: string): Promise<number> {
        return Math.max(0, ((await this.get(key + ':timer')) ?? 0) - now());
    }

    async hit(key: string): Promise<number> {
        await this.add(key + ':timer', now() + decaySeconds);
        const added = await this.add(key, 0);
        const hits = await this.increment(key);
        if (!added && hits === 1) await this.put(key, 1);
        return hits;
    }

    async clear(key: string): Promise<void> {
        await this.forget(key);
        await this.forget(key + ':timer');
    }

    private async get(key: string): Promise<number | undefined> {
        const row = await this.db.one(
            cacheSchema,
            'select * from cache where key in ($1)',
            [this.prefix + key],
        );
        if (!row) return undefined;
        const time = now();
        if (row.expiration <= time) {
            await this.db.execute(
                'delete from cache where key in ($1,$2) and expiration<=$3',
                [this.prefix + key, this.prefix + flexiblePrefix + key, time],
            );
            return undefined;
        }
        return unserialize(row.value);
    }

    private async add(key: string, value: number): Promise<boolean> {
        if ((await this.get(key)) !== undefined) return false;
        const inserted = await this.db.execute(
            'insert into cache (key,value,expiration) values ($1,$2,$3) on conflict do nothing',
            [this.prefix + key, serialize(value), now() + decaySeconds],
        );
        return inserted > 0;
    }

    private increment(key: string): Promise<number> {
        return this.db.transaction(async () => {
            const row = await this.db.one(
                cacheSchema,
                'select * from cache where key=$1 limit 1 for update',
                [this.prefix + key],
            );
            const current = row ? unserialize(row.value) : NaN;
            if (!Number.isInteger(current)) return 0;
            await this.db.execute('update cache set value=$1 where key=$2', [
                serialize(current + 1),
                this.prefix + key,
            ]);
            return current + 1;
        });
    }

    private async put(key: string, value: number): Promise<void> {
        await this.db.execute(
            'insert into cache (key,value,expiration) values ($1,$2,$3) on conflict (key) do update set value=excluded.value,expiration=excluded.expiration',
            [this.prefix + key, serialize(value), now() + decaySeconds],
        );
    }

    private async forget(key: string): Promise<void> {
        await this.db.execute('delete from cache where key in ($1,$2)', [
            this.prefix + key,
            this.prefix + flexiblePrefix + key,
        ]);
    }
}
