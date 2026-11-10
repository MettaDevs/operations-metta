import type { DatabaseSettings } from '../config/index.ts';
import {
    type ClaimedOperation,
    type ControlPlaneClient,
    OperationLost,
} from '../control-plane/index.ts';
import type { MigrationSource } from '../migration/index.ts';
import { convertEnvironment, convertRequestSchema } from './convert.service.ts';
import { expireEnvironment, expireRequestSchema } from './expire.service.ts';
import { migrateEnvironment, migrateRequestSchema } from './migrate.service.ts';
import { provisionRequestSchema } from './provision.schema.ts';
import { provisionEnvironment } from './provision.service.ts';

const knownOperations = ['provision', 'migrate', 'convert', 'expire'] as const;
type KnownOperation = (typeof knownOperations)[number];

function isKnownOperation(value: string): value is KnownOperation {
    return knownOperations.some((known) => known === value);
}

// Menjalankan satu operasi yang sudah diambil worker sampai ditutup. Setiap langkah dilaporkan lebih dulu, sehingga
// tenggatnya diperpanjang dan worker berhenti di antara langkah bila operasinya tidak lagi dipegang. Kegagalan
// ditutup sebagai failed dengan pesannya; operasi yang hilang tidak ditutup oleh worker ini.
export async function runOperation(
    settings: DatabaseSettings,
    source: MigrationSource,
    client: ControlPlaneClient,
    claimed: ClaimedOperation,
): Promise<'succeeded' | 'failed' | 'lost'> {
    const step = (name: string) =>
        client.report(claimed.id, { status: 'running', step: name });
    try {
        const operation = claimed.operation;
        if (!isKnownOperation(operation))
            throw new Error(`Worker ini tidak mengenal operasi ${operation}.`);
        switch (operation) {
            case 'provision': {
                const request = provisionRequestSchema.safeParse(
                    claimed.parameters,
                );
                if (!request.success)
                    throw new Error(
                        `Parameter penyiapan tidak sah: ${request.error.issues.map((issue) => issue.path.join('.')).join(', ')}.`,
                    );
                await provisionEnvironment(
                    settings,
                    source,
                    request.data,
                    step,
                );
                await client.report(claimed.id, {
                    status: 'succeeded',
                    step: 'done',
                });
                return 'succeeded';
            }
            case 'migrate': {
                const request = migrateRequestSchema.safeParse(
                    claimed.parameters,
                );
                if (!request.success)
                    throw new Error(
                        `Parameter migrate tidak sah: ${request.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}.`,
                    );
                await migrateEnvironment(settings, source, request.data, step);
                await client.report(claimed.id, {
                    status: 'succeeded',
                    step: 'done',
                });
                return 'succeeded';
            }
            case 'convert': {
                const request = convertRequestSchema.safeParse(
                    claimed.parameters,
                );
                if (!request.success)
                    throw new Error(
                        `Parameter convert tidak sah: ${request.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}.`,
                    );
                await convertEnvironment(settings, request.data, step);
                await client.report(claimed.id, {
                    status: 'succeeded',
                    step: 'done',
                });
                return 'succeeded';
            }
            case 'expire': {
                const request = expireRequestSchema.safeParse(
                    claimed.parameters,
                );
                if (!request.success)
                    throw new Error(
                        `Parameter expire tidak sah: ${request.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}.`,
                    );
                await expireEnvironment(settings, request.data, step);
                await client.report(claimed.id, {
                    status: 'succeeded',
                    step: 'done',
                });
                return 'succeeded';
            }
            default: {
                const unknown: never = operation;
                throw new Error(`Operasi tidak dikenal: ${String(unknown)}`);
            }
        }
    } catch (error) {
        if (error instanceof OperationLost) return 'lost';
        const message = error instanceof Error ? error.message : String(error);
        try {
            await client.report(claimed.id, {
                status: 'failed',
                step: 'failed',
                failure_message: message.slice(0, 4000),
            });
        } catch (reportError) {
            if (reportError instanceof OperationLost) return 'lost';
            throw reportError;
        }
        return 'failed';
    }
}
