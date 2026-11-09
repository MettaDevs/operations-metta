import { RedisClient } from 'bun';
import { HttpFailure } from '../http/index.ts';

// Sesi di Valkey (SESSION_BACKEND=valkey): nilainya string payload yang sama dengan kolom sessions.payload.
// TTL kunci menggantikan pemeriksaan last_activity dan GC tabel sessions.
export class ValkeySessions {
    constructor(
        private readonly client: RedisClient,
        private readonly prefix: string,
        private readonly lifetimeSeconds: number,
    ) {}

    read(id: string): Promise<string | null> {
        return this.guard(() => this.client.get(this.prefix + id));
    }

    async write(id: string, payload: string): Promise<void> {
        await this.guard(() =>
            this.client.set(
                this.prefix + id,
                payload,
                'EX',
                this.lifetimeSeconds,
            ),
        );
    }

    async forget(id: string): Promise<void> {
        await this.guard(() => this.client.del(this.prefix + id));
    }

    close(): void {
        this.client.close();
    }

    // Valkey yang gagal membuat request itu gagal 503, bukan jatuh diam-diam ke tabel sessions.
    private async guard<T>(command: () => Promise<T>): Promise<T> {
        try {
            return await command();
        } catch (error) {
            process.stderr.write(
                JSON.stringify({
                    event: 'native-valkey-failed',
                    error: error instanceof Error ? error.name : typeof error,
                    message: error instanceof Error ? error.message : undefined,
                }) + '\n',
            );
            throw new HttpFailure(503, { message: 'Service Unavailable' });
        }
    }
}
