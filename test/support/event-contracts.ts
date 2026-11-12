import { join } from 'node:path';
import type postgres from 'postgres';
import { z } from 'zod';

// Kontrak event ditulis tangan di contracts/events/<type>.yaml (AsyncAPI). Test penerbit memvalidasi envelope yang
// benar-benar tertulis di outbox_events terhadap berkas itu, bukan terhadap schema di kode penerbit.

const contractSchema = z.object({
    components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
});

export async function eventContract(type: string): Promise<z.ZodType> {
    const path = join(
        import.meta.dir,
        '../../contracts/events',
        `${type}.yaml`,
    );
    const document = contractSchema.parse(
        Bun.YAML.parse(await Bun.file(path).text()),
    );
    const schemas = document.components.schemas;
    // $ref AsyncAPI menunjuk components/schemas; JSON Schema yang berdiri sendiri memakai $defs.
    const standalone = JSON.parse(
        JSON.stringify({
            ...(schemas.envelope as object),
            $defs: schemas,
        }).replaceAll('#/components/schemas/', '#/$defs/'),
    ) as Parameters<typeof z.fromJSONSchema>[0];
    return z.fromJSONSchema(standalone);
}

export type OutboxEnvelope = {
    id: string;
    type: string;
    occurred_at: string;
    tenant_id: string;
    legal_entity_id: string | null;
    org_unit_id: string | null;
    correlation_id: string | null;
    data: Record<string, unknown>;
};

// Envelope seperti yang diterima handler dan kelak dikirim ke luar runtime, dibaca langsung dari baris outbox.
export async function outboxEnvelopes(
    pool: postgres.Sql,
    tenantId: string,
    type: string,
): Promise<OutboxEnvelope[]> {
    return pool.unsafe<OutboxEnvelope[]>(
        `select id, type, to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as occurred_at, tenant_id,
                legal_entity_id, org_unit_id, correlation_id, payload as data
         from outbox_events where tenant_id = $1 and type = $2 order by occurred_at, id`,
        [tenantId, type],
    );
}
