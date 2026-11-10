import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Workspace } from '../../platform/access/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { nowSql, sqlErrorCode } from '../../platform/database/index.ts';
import { coded } from '../../platform/http/index.ts';

const segmentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('constant'), value: z.string() }),
    z.object({ type: z.literal('number'), length: z.number().int() }),
    z.object({
        type: z.literal('context'),
        value: z.string(),
        length: z.number().int(),
        name: z.string().optional(),
    }),
    z.object({ type: z.literal('year') }),
    z.object({ type: z.literal('scope') }),
    z.object({ type: z.literal('fiscal_year') }),
    z.object({
        type: z.literal('fiscal_period'),
        length: z.number().int().optional(),
    }),
]);
const sequenceSchema = z.object({
    id: z.string(),
    scope_type: z.enum(['tenant', 'legal_entity', 'operating_unit']),
    is_continuous: z.boolean(),
    allow_automatic: z.boolean(),
    preallocation_enabled: z.boolean(),
    preallocation_quantity: z.number(),
    minimum_number: z.coerce.bigint(),
    maximum_number: z.coerce.bigint().nullable(),
    segments: z.array(segmentSchema),
    reset_period: z.string(),
});
type Sequence = z.infer<typeof sequenceSchema>;
type Scope = {
    key: string;
    period: string;
    code: string | null;
    values: Record<string, string>;
    year: string;
    fiscalYear: string | null;
    fiscalPeriod: number | null;
};
const counterSchema = z.object({
    id: z.string(),
    next_number: z.coerce.bigint(),
});
const allocationSchema = counterSchema.extend({
    last_number: z.coerce.bigint(),
});

export function failSequence(message: string): never {
    return coded(422, 'number_sequence_failed', message);
}

export class NumberIssuer {
    constructor(
        private readonly db: Database,
        private readonly scope: Workspace,
    ) {}

    private sequence(reference: string) {
        return this.db.one(
            sequenceSchema,
            "select s.* from tenant_number_sequences s where s.tenant_id=$1 and s.status='active' and exists(select 1 from app_number_sequence_references r where r.id=s.reference_id and r.code=$2 and r.app_id=$3) limit 1 for share",
            [this.scope.tenantId, reference, this.scope.moduleId],
        );
    }

    private async context(
        sequence: Sequence,
        values: Record<string, string>,
    ): Promise<Scope> {
        let key = 'tenant:' + this.scope.tenantId;
        let code: string | null = null;
        const organizationId =
            sequence.scope_type === 'legal_entity'
                ? this.scope.legalEntityId
                : sequence.scope_type === 'operating_unit'
                  ? this.scope.orgUnitId
                  : null;
        if (sequence.scope_type !== 'tenant') {
            if (!organizationId)
                failSequence(
                    'Context organisasi untuk sequence ini belum tersedia.',
                );
            const organization = await this.db.one(
                z.object({
                    id: z.string(),
                    company_code: z.string().nullable(),
                    fiscal_calendar_id: z.string().nullable(),
                }),
                "select o.id,l.company_code,l.fiscal_calendar_id from organizations o left join legal_entities l on l.organization_id=o.id where o.id=$1 and o.tenant_id=$2 and o.classification=$3 and o.status='active' limit 1",
                [organizationId, this.scope.tenantId, sequence.scope_type],
            );
            if (!organization)
                failSequence(
                    'Context organisasi tidak sah untuk sequence ini.',
                );
            code =
                sequence.scope_type === 'legal_entity'
                    ? organization.company_code
                    : organization.id;
            key = sequence.scope_type + ':' + organization.id;
        }
        const context: Record<string, string> = {};
        for (const segment of sequence.segments) {
            if (segment.type !== 'context') continue;
            const value = values[segment.value];
            if (
                !value ||
                !/^[A-Za-z0-9_-]+$/.test(value) ||
                value.length > segment.length
            )
                failSequence(
                    'Lengkapi kode untuk ' +
                        (segment.name ?? segment.value) +
                        ' sebelum menerbitkan nomor.',
                );
            context[segment.value] = value;
        }
        const sorted = Object.fromEntries(
            Object.entries(context).sort(([first], [second]) =>
                first.localeCompare(second),
            ),
        );
        if (Object.keys(sorted).length)
            key +=
                '|values:' +
                createHash('sha256')
                    .update(JSON.stringify(sorted))
                    .digest('hex');
        const year = String(new Date().getUTCFullYear());
        let period = sequence.reset_period === 'calendar_year' ? year : 'all';
        let fiscalYear: string | null = null;
        let fiscalPeriod: number | null = null;
        if (sequence.reset_period.startsWith('fiscal')) {
            const fiscal = await this.db.one(
                z.object({
                    year_id: z.string(),
                    year_name: z.string(),
                    period_ordinal: z.number(),
                }),
                'select y.id as year_id,y.name as year_name,p.ordinal as period_ordinal from legal_entities l join fiscal_years y on y.fiscal_calendar_id=l.fiscal_calendar_id join fiscal_periods p on p.fiscal_year_id=y.id where l.organization_id=$1 and l.tenant_id=$2 and current_date between p.starts_on and p.ends_on limit 1',
                [this.scope.legalEntityId, this.scope.tenantId],
            );
            if (!fiscal)
                failSequence(
                    'Kalender fiskal belum tersedia untuk tanggal ini.',
                );
            fiscalYear = fiscal.year_name;
            fiscalPeriod = fiscal.period_ordinal;
            period =
                sequence.reset_period === 'fiscal_year'
                    ? 'FY:' + fiscal.year_id
                    : `FP:${fiscal.year_id}:${fiscal.period_ordinal}`;
            if (sequence.scope_type === 'operating_unit')
                key += '|legal_entity:' + this.scope.legalEntityId;
        }
        return {
            key,
            period,
            code,
            values: sorted,
            year,
            fiscalYear,
            fiscalPeriod,
        };
    }

    private maximum(sequence: Sequence, numeric: bigint): bigint {
        if (
            sequence.maximum_number !== null &&
            numeric > sequence.maximum_number
        )
            failSequence('Nomor sequence sudah mencapai batas maksimum.');
        return numeric;
    }

    private async counter(sequence: Sequence, scope: Scope) {
        const bindings = [sequence.id, scope.key, scope.period];
        let counter = await this.db.one(
            counterSchema,
            'select id,next_number from number_sequence_counters where sequence_id=$1 and scope_key=$2 and period_key=$3 limit 1 for update',
            bindings,
        );
        if (!counter) {
            const stamp = nowSql();
            await this.db.execute(
                'insert into number_sequence_counters(id,sequence_id,scope_key,period_key,next_number,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$6) on conflict do nothing',
                [
                    Bun.randomUUIDv7(),
                    ...bindings,
                    String(sequence.minimum_number),
                    stamp,
                ],
            );
            counter = await this.db.one(
                counterSchema,
                'select id,next_number from number_sequence_counters where sequence_id=$1 and scope_key=$2 and period_key=$3 limit 1 for update',
                bindings,
            );
        }
        if (!counter) throw new Error('Number counter was not created.');
        return counter;
    }

    private async numeric(sequence: Sequence, scope: Scope): Promise<bigint> {
        const bindings = [sequence.id, scope.key, scope.period];
        if (!sequence.preallocation_enabled) {
            const reusable = await this.db.one(
                z.object({ numeric_value: z.coerce.bigint() }),
                'select numeric_value from number_sequence_reusable_numbers where sequence_id=$1 and scope_key=$2 and period_key=$3 order by numeric_value limit 1 for update',
                bindings,
            );
            if (reusable) {
                await this.db.execute(
                    'delete from number_sequence_reusable_numbers where sequence_id=$1 and scope_key=$2 and period_key=$3 and numeric_value=$4',
                    [...bindings, String(reusable.numeric_value)],
                );
                return reusable.numeric_value;
            }
            const counter = await this.counter(sequence, scope);
            const number = this.maximum(sequence, counter.next_number);
            await this.db.execute(
                'update number_sequence_counters set next_number=$1,updated_at=$2 where id=$3',
                [String(number + 1n), nowSql(), counter.id],
            );
            return number;
        }
        const counter = await this.counter(sequence, scope);
        let allocation = await this.db.one(
            allocationSchema,
            'select id,next_number,last_number from number_sequence_allocations where sequence_id=$1 and scope_key=$2 and period_key=$3 and next_number<=last_number order by created_at limit 1 for update',
            bindings,
        );
        if (!allocation) {
            await this.db.execute(
                'delete from number_sequence_allocations where sequence_id=$1 and scope_key=$2 and period_key=$3 and next_number>last_number',
                bindings,
            );
            const first = this.maximum(sequence, counter.next_number);
            const proposed =
                first + BigInt(sequence.preallocation_quantity) - 1n;
            const last =
                sequence.maximum_number !== null &&
                proposed > sequence.maximum_number
                    ? sequence.maximum_number
                    : proposed;
            const id = Bun.randomUUIDv7();
            const stamp = nowSql();
            await this.db.insert('number_sequence_allocations', {
                id,
                sequence_id: sequence.id,
                scope_key: scope.key,
                period_key: scope.period,
                first_number: String(first),
                last_number: String(last),
                next_number: String(first),
                created_at: stamp,
                updated_at: stamp,
            });
            await this.db.execute(
                'update number_sequence_counters set next_number=$1,updated_at=$2 where id=$3',
                [String(last + 1n), stamp, counter.id],
            );
            await this.audit(sequence.id, null, 'preallocated', null, {
                scope: scope.key,
                first: Number(first),
                last: Number(last),
            });
            allocation = { id, next_number: first, last_number: last };
        }
        const number = this.maximum(sequence, allocation.next_number);
        await this.db.execute(
            'update number_sequence_allocations set next_number=$1,updated_at=$2 where id=$3',
            [String(number + 1n), nowSql(), allocation.id],
        );
        return number;
    }

    private format(sequence: Sequence, scope: Scope, number: bigint): string {
        return sequence.segments
            .map((segment) => {
                switch (segment.type) {
                    case 'constant':
                        return segment.value;
                    case 'context':
                        return (
                            scope.values[segment.value] ??
                            failSequence('Kode context belum tersedia.')
                        );
                    case 'year':
                        return scope.year;
                    case 'scope':
                        return scope.code ?? '';
                    case 'fiscal_year':
                        return scope.fiscalYear ?? '';
                    case 'fiscal_period':
                        return String(scope.fiscalPeriod ?? '').padStart(
                            segment.length ?? 2,
                            '0',
                        );
                    case 'number': {
                        const text = String(number);
                        if (text.length > segment.length)
                            failSequence(
                                'Nomor sudah melampaui panjang segmen yang dikonfigurasi.',
                            );
                        return text.padStart(segment.length, '0');
                    }
                    default: {
                        const exhaustive: never = segment;
                        return exhaustive;
                    }
                }
            })
            .join('');
    }

    private audit(
        sequenceId: string,
        appId: string | null,
        event: string,
        formattedValue: string | null,
        details: object,
    ): Promise<void> {
        const stamp = nowSql();
        return this.db.insert('number_sequence_audit_events', {
            id: Bun.randomUUIDv7(),
            sequence_id: sequenceId,
            app_id: appId,
            user_id: null,
            event_type: event,
            formatted_value: formattedValue,
            details: JSON.stringify(details),
            occurred_at: stamp,
            created_at: stamp,
            updated_at: stamp,
        });
    }

    async issue(
        reference: string,
        key: string,
        values: Record<string, string> = {},
    ): Promise<string> {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.db.transaction(async () => {
                    const sequence = await this.sequence(reference);
                    if (!sequence)
                        failSequence(
                            'Sequence aktif tidak ditemukan untuk aplikasi dan tenant ini.',
                        );
                    const scope = await this.context(sequence, values);
                    if (sequence.is_continuous)
                        failSequence(
                            'Sequence berkelanjutan harus memakai reserve lalu confirm.',
                        );
                    const replay = await this.db.one(
                        z.object({ formatted_value: z.string() }),
                        'select formatted_value from number_sequence_issues where sequence_id=$1 and app_id=$2 and idempotency_key=$3 limit 1',
                        [sequence.id, this.scope.moduleId, key],
                    );
                    if (replay) return replay.formatted_value;
                    if (!sequence.allow_automatic)
                        failSequence(
                            'Isi kode secara manual. Pembuatan nomor otomatis tidak diizinkan.',
                        );
                    let number: bigint;
                    let formatted: string;
                    do {
                        number = await this.numeric(sequence, scope);
                        formatted = this.format(sequence, scope, number);
                    } while (
                        await this.db.one(
                            z.object({ found: z.boolean() }),
                            'select true as found from number_sequence_issues where sequence_id=$1 and scope_key=$2 and formatted_value=$3 limit 1',
                            [sequence.id, scope.key, formatted],
                        )
                    );
                    const stamp = nowSql();
                    await this.db.insert('number_sequence_issues', {
                        id: Bun.randomUUIDv7(),
                        sequence_id: sequence.id,
                        app_id: this.scope.moduleId,
                        scope_key: scope.key,
                        period_key: scope.period,
                        numeric_value: String(number),
                        formatted_value: formatted,
                        idempotency_key: key,
                        is_manual: false,
                        issued_at: stamp,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                    await this.audit(
                        sequence.id,
                        this.scope.moduleId,
                        'issued',
                        formatted,
                        { scope: scope.key },
                    );
                    return formatted;
                });
            } catch (error) {
                if (sqlErrorCode(error)) {
                    const replay = await this.db.one(
                        z.object({ formatted_value: z.string() }),
                        'select i.formatted_value from number_sequence_issues i join tenant_number_sequences s on s.id=i.sequence_id join app_number_sequence_references r on r.id=s.reference_id where i.app_id=$1 and i.idempotency_key=$2 and s.tenant_id=$3 and r.code=$4 and r.app_id=$1 limit 1',
                        [
                            this.scope.moduleId,
                            key,
                            this.scope.tenantId,
                            reference,
                        ],
                    );
                    if (replay) return replay.formatted_value;
                }
                if (sqlErrorCode(error) !== '23505' || attempt === 2)
                    throw error;
            }
        }
        throw new Error('Number issuance exhausted retries.');
    }

    async contextFields(reference: string): Promise<string[]> {
        const sequence = await this.sequence(reference);
        if (!sequence)
            failSequence(
                'Sequence aktif tidak ditemukan untuk aplikasi dan tenant ini.',
            );
        return sequence.segments.flatMap((segment) =>
            segment.type === 'context' ? [segment.value] : [],
        );
    }
}
