import { z } from 'zod';
import type { Database, JsonObject } from '../database/index.ts';
import { nowSql } from '../database/index.ts';

// Event antar module di dalam runtime. Module tidak membaca tabel module lain, jadi fakta yang perlu diketahui module
// lain diterbitkan sebagai event: baris outbox_events ditulis di transaksi yang mencatat faktanya, lalu handler module
// penerima dijalankan di transaksi yang sama, seperti CoreERP. Aturannya di AGENTS.md, bagian Event antar module.

export type EventType = `${string}.${string}.${string}.v${number}`;

// Sama dengan body yang dikirim CoreERP ke luar runtime, supaya penerima di dalam proses dan penerima kelak di luar
// proses membaca isi yang sama. legal_entity_id dan org_unit_id tidak ada bila tidak diisi.
export type EventEnvelope = {
    id: string;
    type: EventType;
    occurred_at: string;
    tenant_id: string;
    legal_entity_id?: string;
    org_unit_id?: string;
    correlation_id: string;
    data: JsonObject;
};

export type EventHandler = (
    db: Database,
    envelope: EventEnvelope,
) => Promise<void>;

const eventTypePattern =
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[1-9][0-9]*$/;
const handlers = new Map<
    string,
    { moduleId: string; handler: EventHandler }[]
>();

function assertEventType(type: string): void {
    if (!eventTypePattern.test(type))
        throw new Error(
            `Nama event harus module.aggregate.action.vN, bukan "${type}".`,
        );
}

// Dipanggil fungsi pendaftaran yang di-export index.ts module, yang dipanggil berkas proses (src/main.ts, src/worker.ts).
export function onEvent(
    type: EventType,
    moduleId: string,
    handler: EventHandler,
): void {
    assertEventType(type);
    handlers.set(type, [...(handlers.get(type) ?? []), { moduleId, handler }]);
}

// Wajib di dalam transaksi yang mencatat faktanya: handler yang melempar membatalkan fakta itu beserta barisnya di
// outbox. correlation_id bawaannya milik database request (db.correlationId); fakta yang terjadi jauh setelah request
// asalnya mengisinya dari agregatnya.
export async function publishEvent(
    db: Database,
    event: {
        type: EventType;
        tenantId: string;
        legalEntityId?: string;
        orgUnitId?: string;
        correlationId?: string;
        data: JsonObject;
    },
): Promise<EventEnvelope> {
    assertEventType(event.type);
    if (!db.inTransaction)
        throw new Error(
            `Event ${event.type} wajib diterbitkan di dalam transaksi yang mencatat faktanya.`,
        );
    const occurredAt = nowSql();
    const envelope: EventEnvelope = {
        id: Bun.randomUUIDv7(),
        type: event.type,
        occurred_at: `${occurredAt.replace(' ', 'T')}Z`,
        tenant_id: event.tenantId,
        ...(event.legalEntityId === undefined
            ? {}
            : { legal_entity_id: event.legalEntityId }),
        ...(event.orgUnitId === undefined
            ? {}
            : { org_unit_id: event.orgUnitId }),
        correlation_id: event.correlationId ?? db.correlationId,
        data: event.data,
    };
    await db.insert('outbox_events', {
        id: envelope.id,
        tenant_id: envelope.tenant_id,
        type: envelope.type,
        payload: JSON.stringify(envelope.data),
        occurred_at: occurredAt,
        correlation_id: envelope.correlation_id,
        legal_entity_id: envelope.legal_entity_id ?? null,
        org_unit_id: envelope.org_unit_id ?? null,
        created_at: occurredAt,
        updated_at: occurredAt,
    });
    const subscribed = handlers.get(envelope.type) ?? [];
    if (!subscribed.length) return envelope;
    // Handler menulis tabel module pemiliknya, dan tabel itu hanya ada setelah module terpasang di lingkungan ini.
    const installed = new Set(
        (
            await db.rows(
                z.object({ module_id: z.string() }),
                "select module_id from core_module_installations where tenant_id = $1 and status = 'installed'",
                [envelope.tenant_id],
            )
        ).map((row) => row.module_id),
    );
    for (const { moduleId, handler } of subscribed)
        if (installed.has(moduleId)) await handler(db, envelope);
    return envelope;
}

// Penerima idempoten. table milik module penerima, berkolom id, tenant_id, event_id, dan processed_at, dengan unik
// (tenant_id, event_id). Mencatat id event di sana dan menjawab true bila sudah pernah tercatat. Dipanggil di transaksi
// handler tepat sebelum efeknya ditulis, sesudah handler memastikan event itu urusannya: catatan yang ditulis lebih
// awal menghitung event yang dilewati sebagai sudah diproses.
export async function alreadyProcessed(
    db: Database,
    table: string,
    envelope: EventEnvelope,
): Promise<boolean> {
    if (!/^[a-z_][a-z0-9_]*$/.test(table))
        throw new Error('Invalid internal SQL identifier.');
    if (!db.inTransaction)
        throw new Error(
            `Catatan event ${envelope.type} wajib ditulis di dalam transaksi handler-nya.`,
        );
    const recorded = await db.execute(
        `insert into ${table} (id, tenant_id, event_id, processed_at) values ($1, $2, $3, $4)
         on conflict (tenant_id, event_id) do nothing`,
        [Bun.randomUUIDv7(), envelope.tenant_id, envelope.id, nowSql()],
    );
    return recorded === 0;
}
