import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { nowSql, sqlErrorCode } from '../../platform/database/index.ts';
import {
    abort,
    coded,
    incrementalList,
    validation,
} from '../../platform/http/index.ts';
import { audit, releaseExpired } from './number-sequence.issuer.ts';
import {
    createSchema,
    type ScopeType,
    scopeTypes,
    type Segment,
    segmentSchema,
    type Sequence,
    sequenceSchema,
    sequenceStatuses,
    type Settings,
    updateSchema,
} from './number-sequence.schema.ts';

// Segmen yang membedakan periode reset, supaya nomor tidak berulang setelah penghitung direset.
const periodDiscriminators: Record<string, Segment['type'][]> = {
    calendar_year: ['year'],
    fiscal_year: ['fiscal_year'],
    fiscal_period: ['fiscal_year', 'fiscal_period'],
};
const scopeFields = [
    'reference_id',
    'scope_type',
    'legal_entity_id',
    'operating_unit_id',
    'fiscal_period_id',
] as const;
const referenceSchema = z.object({
    id: z.string(),
    name: z.string(),
    allowed_scopes: z.array(z.string()),
    default_settings: z
        .object({ segments: z.array(z.record(z.string(), z.unknown())) })
        .partial()
        .nullable(),
});

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    validation(
        Object.fromEntries(
            result.error.issues.map((issue) => [
                issue.path.join('.') || 'input',
                'Isian ini tidak sah.',
            ]),
        ),
    );
}

function canonical(segments: Segment[]): string {
    return JSON.stringify(
        segments.map((segment) =>
            Object.entries(segment).sort(([first], [second]) =>
                first.localeCompare(second),
            ),
        ),
    );
}

// Pengaturan number sequence milik tenant: membuat, mengubah, menaikkan Next, Status list, dan cleanup.
export class NumberSequences {
    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
        private readonly userId: string | null,
    ) {}

    async find(id: string): Promise<Sequence> {
        const sequence = await this.db.one(
            sequenceSchema,
            'select * from tenant_number_sequences where id=$1 and tenant_id=$2 limit 1',
            [id, this.tenantId],
        );
        if (!sequence) abort(404, 'Pengaturan nomor tidak ditemukan.');
        return sequence;
    }

    private async reference(id: string) {
        const reference = await this.db.one(
            referenceSchema,
            'select id,name,allowed_scopes,default_settings from app_number_sequence_references where id=$1 limit 1',
            [id],
        );
        if (!reference)
            validation({ reference_id: 'Pilih jenis nomor yang tersedia.' });
        return reference;
    }

    private async checkScopeValue(input: {
        scope_type: ScopeType;
        legal_entity_id: string | null;
        operating_unit_id: string | null;
        fiscal_period_id: string | null;
    }): Promise<void> {
        const needsCompany =
            input.scope_type === 'legal_entity' ||
            input.scope_type === 'legal_entity_fiscal_period';
        const needsUnit = input.scope_type === 'operating_unit';
        const needsPeriod = input.scope_type === 'legal_entity_fiscal_period';
        const errors: Record<string, string> = {};
        if (needsCompany !== (input.legal_entity_id !== null))
            errors.legal_entity_id = needsCompany
                ? 'Pilih perusahaan untuk pengaturan nomor ini.'
                : 'Perusahaan hanya diisi untuk scope perusahaan.';
        if (needsUnit !== (input.operating_unit_id !== null))
            errors.operating_unit_id = needsUnit
                ? 'Pilih unit untuk pengaturan nomor ini.'
                : 'Unit hanya diisi untuk scope unit.';
        if (needsPeriod !== (input.fiscal_period_id !== null))
            errors.fiscal_period_id = needsPeriod
                ? 'Pilih periode fiskal untuk pengaturan nomor ini.'
                : 'Periode fiskal hanya diisi untuk scope perusahaan dan periode fiskal.';
        if (Object.keys(errors).length) validation(errors);
        if (input.legal_entity_id !== null) {
            const company = await this.db.one(
                z.object({ fiscal_calendar_id: z.string().nullable() }),
                "select l.fiscal_calendar_id from organizations o join legal_entities l on l.organization_id=o.id where o.id=$1 and o.tenant_id=$2 and o.classification='legal_entity' limit 1",
                [input.legal_entity_id, this.tenantId],
            );
            if (!company)
                validation({
                    legal_entity_id: 'Pilih perusahaan milik tenant ini.',
                });
            if (input.fiscal_period_id !== null) {
                const period = await this.db.one(
                    z.object({ id: z.string() }),
                    'select p.id from fiscal_periods p join fiscal_years y on y.id=p.fiscal_year_id where p.id=$1 and y.fiscal_calendar_id=$2 limit 1',
                    [input.fiscal_period_id, company.fiscal_calendar_id],
                );
                if (!period)
                    validation({
                        fiscal_period_id:
                            'Pilih periode dari kalender fiskal perusahaan ini.',
                    });
            }
        }
        if (input.operating_unit_id !== null) {
            const unit = await this.db.one(
                z.object({ id: z.string() }),
                "select o.id from organizations o join operating_units u on u.organization_id=o.id where o.id=$1 and o.tenant_id=$2 and o.classification='operating_unit' limit 1",
                [input.operating_unit_id, this.tenantId],
            );
            if (!unit)
                validation({
                    operating_unit_id: 'Pilih unit milik tenant ini.',
                });
        }
    }

    private checkSettings(
        settings: Settings,
        scopeType: ScopeType,
        reference: z.infer<typeof referenceSchema>,
    ): void {
        const allowed =
            scopeType === 'legal_entity_fiscal_period'
                ? reference.allowed_scopes.includes('legal_entity')
                : reference.allowed_scopes.includes(scopeType);
        if (!allowed)
            validation({
                scope_type: 'Scope ini tidak tersedia untuk jenis nomor ini.',
            });
        if (
            !settings.allow_automatic &&
            (!settings.allow_manual || settings.is_continuous)
        )
            validation({
                allow_automatic:
                    'Jika nomor otomatis dimatikan, izinkan nomor manual dan matikan nomor berkelanjutan.',
            });
        if (settings.is_continuous && settings.allow_manual)
            validation({
                allow_manual:
                    'Nomor manual tidak dapat digabung dengan nomor berkelanjutan.',
            });
        if (
            settings.is_continuous &&
            (settings.allow_lower_number || settings.allow_higher_number)
        )
            validation({
                allow_lower_number:
                    'Nomor berkelanjutan tidak boleh diubah pengguna, karena nomor yang dilompati akan hilang dari urutan.',
            });
        if (
            settings.maximum_number !== null &&
            settings.maximum_number < settings.minimum_number
        )
            validation({
                maximum_number:
                    'Nomor terbesar tidak boleh lebih kecil dari nomor terkecil.',
            });
        const fiscalReset = settings.reset_period.startsWith('fiscal');
        if (fiscalReset && scopeType === 'tenant')
            validation({
                reset_period:
                    'Reset fiskal memerlukan scope perusahaan atau unit; scope tenant tidak memiliki kalender fiskal.',
            });
        if (
            scopeType === 'legal_entity_fiscal_period' &&
            settings.reset_period !== 'never'
        )
            validation({
                reset_period:
                    'Pengaturan per periode fiskal sudah terpisah per periode, jadi tidak perlu direset.',
            });
        this.checkSegments(settings, scopeType);
        const declared = (reference.default_settings?.segments ?? [])
            .filter((segment) => segment.type === 'context')
            .map((segment) => segment.value);
        for (const segment of settings.segments)
            if (segment.type === 'context' && !declared.includes(segment.value))
                validation({
                    segments:
                        'Pilihan bagian kode tidak tersedia untuk dokumen ini.',
                });
    }

    private checkSegments(settings: Settings, scopeType: ScopeType): void {
        const fail = (message: string): never =>
            validation({ segments: message });
        const numbers = settings.segments.filter(
            (segment) => segment.type === 'number',
        );
        const [number] = numbers;
        if (!number || numbers.length !== 1)
            fail('Format harus memiliki tepat satu segmen nomor.');
        const fiscalScope = scopeType === 'legal_entity_fiscal_period';
        let length = 0;
        for (const segment of settings.segments) {
            switch (segment.type) {
                case 'constant':
                    if (!/^[A-Za-z0-9._/-]*$/.test(segment.value))
                        fail(
                            'Segmen tetap hanya boleh berisi huruf, angka, titik, garis miring, atau strip.',
                        );
                    length += segment.value.length;
                    break;
                case 'number':
                    if (segment.length < 1 || segment.length > 18)
                        fail('Panjang segmen nomor harus 1 sampai 18.');
                    length += segment.length;
                    break;
                case 'context':
                    if (
                        !/^[a-z][a-z0-9_]*$/.test(segment.value) ||
                        segment.length < 1 ||
                        segment.length > 50
                    )
                        fail(
                            'Bagian dari data memerlukan nama field dan panjang 1 sampai 50 karakter.',
                        );
                    length += segment.length;
                    break;
                case 'year':
                    length += 4;
                    break;
                case 'scope':
                    if (scopeType === 'tenant')
                        fail(
                            'Segmen kode organisasi memerlukan scope perusahaan atau unit.',
                        );
                    length += 50;
                    break;
                case 'fiscal_year':
                case 'fiscal_period':
                    if (
                        segment.type === 'fiscal_period' &&
                        segment.length !== undefined &&
                        (segment.length < 1 || segment.length > 4)
                    )
                        fail('Panjang segmen periode fiskal harus 1 sampai 4.');
                    if (
                        !fiscalScope &&
                        !settings.reset_period.startsWith('fiscal')
                    )
                        fail(
                            'Segmen fiskal hanya dapat dipakai bila nomor direset per tahun atau periode fiskal, atau diatur per periode fiskal.',
                        );
                    length +=
                        segment.type === 'fiscal_year'
                            ? 40
                            : (segment.length ?? 2);
                    break;
                default: {
                    const exhaustive: never = segment;
                    return exhaustive;
                }
            }
        }
        const types = settings.segments.map((segment) => segment.type);
        for (const required of periodDiscriminators[settings.reset_period] ??
            [])
            if (!types.includes(required))
                fail(
                    `Format harus memuat segmen ${required} agar nomor tidak berulang setiap periode direset.`,
                );
        if (length > 200)
            fail('Format yang dihasilkan dapat melebihi batas panjang nomor.');
        // F&O: segmen nomor harus memuat sebanyak karakter nomor terbesar.
        if (
            number &&
            settings.maximum_number !== null &&
            String(settings.maximum_number).length > number.length
        )
            validation({
                maximum_number: `Nomor terbesar tidak muat di segmen nomor ${number.length} digit.`,
            });
    }

    // Dua pengaturan nomor untuk dokumen yang sama dapat menghasilkan nomor terformat yang sama. Indeks unik dokumen
    // hanya menjaga perusahaan (misalnya aset: tenant, legal entity, kode), jadi kembaran di dalam satu perusahaan
    // ditolak di sini: format yang sama, tanpa segmen pembeda, dengan rentang yang beririsan.
    private async checkOverlap(
        id: string | null,
        referenceId: string,
        scope: {
            scope_type: ScopeType;
            legal_entity_id: string | null;
        },
        settings: Settings,
    ): Promise<void> {
        const others = await this.db.rows(
            sequenceSchema,
            'select * from tenant_number_sequences where tenant_id=$1 and reference_id=$2 and ($3::uuid is null or id<>$3)',
            [this.tenantId, referenceId, id],
        );
        const types = settings.segments.map((segment) => segment.type);
        for (const other of others) {
            if (canonical(other.segments) !== canonical(settings.segments))
                continue;
            const companies =
                scope.legal_entity_id !== null &&
                other.legal_entity_id !== null;
            if (companies && scope.legal_entity_id !== other.legal_entity_id)
                continue;
            if (
                scope.scope_type === other.scope_type &&
                scope.scope_type !== 'tenant' &&
                types.includes('scope') &&
                scope.scope_type !== 'legal_entity_fiscal_period'
            )
                continue;
            if (
                scope.scope_type === 'legal_entity_fiscal_period' &&
                other.scope_type === 'legal_entity_fiscal_period' &&
                types.includes('fiscal_period')
            )
                continue;
            const otherMaximum = other.maximum_number;
            const below =
                settings.maximum_number !== null &&
                BigInt(settings.maximum_number) < other.minimum_number;
            const above =
                otherMaximum !== null &&
                otherMaximum < BigInt(settings.minimum_number);
            if (below || above) continue;
            validation({
                segments:
                    'Format dan rentang nomor ini sama dengan pengaturan nomor lain untuk dokumen yang sama, jadi nomornya bisa kembar. Ubah awalan, tambahkan kode organisasi, atau pakai rentang nomor yang tidak beririsan.',
            });
        }
    }

    // Semua sequence aktif satu reference memakai jenis scope yang sama, supaya satu dokumen tidak cocok dengan dua
    // sequence (misalnya satu per tenant dan satu per perusahaan) dan nomor tidak dipilih diam-diam.
    private async checkActiveScopeType(
        id: string | null,
        referenceId: string,
        scopeType: ScopeType,
    ): Promise<void> {
        const other = await this.db.one(
            z.object({ scope_type: z.string() }),
            "select scope_type from tenant_number_sequences where tenant_id=$1 and reference_id=$2 and status='active' and scope_type<>$3 and ($4::uuid is null or id<>$4) limit 1",
            [this.tenantId, referenceId, scopeType, id],
        );
        if (other)
            validation({
                status: 'Jenis nomor ini masih punya pengaturan aktif dengan scope lain. Hentikan pengaturan itu lebih dulu.',
            });
    }

    private async hasNumberingState(id: string): Promise<boolean> {
        const state = await this.db.one(
            z.object({ used: z.boolean() }),
            'select exists(select 1 from number_sequence_counters where sequence_id=$1) or exists(select 1 from number_sequence_issues where sequence_id=$1) or exists(select 1 from number_sequence_reservations where sequence_id=$1) as used',
            [id],
        );
        return state?.used ?? false;
    }

    private async save<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await this.db.transaction(work);
        } catch (error) {
            if (sqlErrorCode(error) === '23505')
                validation({
                    status: 'Sudah ada pengaturan nomor aktif untuk jenis nomor dan scope ini. Hentikan yang lama lebih dulu.',
                });
            throw error;
        }
    }

    async create(input: unknown): Promise<Sequence> {
        const data = parse(createSchema, input);
        const reference = await this.reference(data.reference_id);
        await this.checkScopeValue(data);
        this.checkSettings(data, data.scope_type, reference);
        const id = Bun.randomUUIDv7();
        return this.save(async () => {
            await this.checkOverlap(null, reference.id, data, data);
            if (data.status === 'active')
                await this.checkActiveScopeType(
                    null,
                    reference.id,
                    data.scope_type,
                );
            const now = nowSql();
            await this.db.execute(
                'insert into tenant_number_sequences (id,tenant_id,reference_id,scope_type,legal_entity_id,operating_unit_id,fiscal_period_id,status,is_continuous,allow_automatic,allow_manual,allow_lower_number,allow_higher_number,reset_period,preallocation_enabled,preallocation_quantity,minimum_number,maximum_number,segments,created_by_user_id,updated_by_user_id,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::text::json,$20,$20,$21,$21)',
                [
                    id,
                    this.tenantId,
                    reference.id,
                    data.scope_type,
                    data.legal_entity_id,
                    data.operating_unit_id,
                    data.fiscal_period_id,
                    data.status,
                    data.is_continuous,
                    data.allow_automatic,
                    data.allow_manual,
                    data.allow_lower_number,
                    data.allow_higher_number,
                    data.reset_period,
                    data.preallocation_enabled,
                    data.preallocation_quantity,
                    String(data.minimum_number),
                    data.maximum_number === null
                        ? null
                        : String(data.maximum_number),
                    JSON.stringify(data.segments),
                    this.userId,
                    now,
                ],
            );
            await audit(
                this.db,
                id,
                null,
                'created',
                null,
                { status: data.status, scope_type: data.scope_type },
                this.userId,
            );
            return this.find(id);
        });
    }

    // Scope dan nilainya tetap. Continuous, Manual, In use/Stopped, Smallest/Largest, Reset every, Allow user
    // changes, dan Preallocation boleh diubah kapan saja, seperti di F&O. Format terkunci begitu nomor pertama terbit.
    async update(id: string, input: unknown): Promise<Sequence> {
        const data = parse(updateSchema, input);
        return this.save(async () => {
            const current = await this.db.one(
                sequenceSchema,
                'select * from tenant_number_sequences where id=$1 and tenant_id=$2 limit 1 for update',
                [id, this.tenantId],
            );
            if (!current) abort(404, 'Pengaturan nomor tidak ditemukan.');
            for (const field of scopeFields)
                if (data[field] !== undefined && data[field] !== current[field])
                    validation({
                        [field]:
                            'Scope dan nilainya tidak dapat diubah setelah pengaturan nomor dibuat. Buat pengaturan baru, lalu hentikan yang lama.',
                    });
            if (data.version !== current.version)
                coded(
                    409,
                    'stale_version',
                    'Perubahanmu belum disimpan karena pengaturan ini sudah diubah sejak kamu membukanya. Muat ulang untuk melihat data terbaru, lalu ulangi perubahanmu.',
                );
            const reference = await this.reference(current.reference_id);
            this.checkSettings(data, current.scope_type, reference);
            if (
                canonical(data.segments) !== canonical(current.segments) &&
                (await this.hasNumberingState(id))
            )
                validation({
                    segments:
                        'Format tidak dapat diubah setelah nomor diterbitkan. Buat pengaturan baru, lalu hentikan yang lama.',
                });
            await this.checkOverlap(id, current.reference_id, current, data);
            if (data.status === 'active')
                await this.checkActiveScopeType(
                    id,
                    current.reference_id,
                    current.scope_type,
                );
            await this.db.execute(
                'update tenant_number_sequences set status=$1,is_continuous=$2,allow_automatic=$3,allow_manual=$4,allow_lower_number=$5,allow_higher_number=$6,reset_period=$7,preallocation_enabled=$8,preallocation_quantity=$9,minimum_number=$10,maximum_number=$11,segments=$12::text::json,updated_by_user_id=$13,updated_at=$14 where id=$15',
                [
                    data.status,
                    data.is_continuous,
                    data.allow_automatic,
                    data.allow_manual,
                    data.allow_lower_number,
                    data.allow_higher_number,
                    data.reset_period,
                    data.preallocation_enabled,
                    data.preallocation_quantity,
                    String(data.minimum_number),
                    data.maximum_number === null
                        ? null
                        : String(data.maximum_number),
                    JSON.stringify(data.segments),
                    this.userId,
                    nowSql(),
                    id,
                ],
            );
            const before = new Map<string, unknown>(Object.entries(current));
            const changed = Object.entries(data)
                .filter(([key, after]) => {
                    const value = before.get(key);
                    return (
                        key !== 'version' &&
                        JSON.stringify(
                            typeof value === 'bigint' ? Number(value) : value,
                        ) !== JSON.stringify(after)
                    );
                })
                .map(([key]) => key);
            await audit(
                this.db,
                id,
                null,
                'configured',
                null,
                { status: data.status, changed },
                this.userId,
            );
            return this.find(id);
        });
    }

    // Next di F&O. Hanya boleh naik, sama dengan CoreERP: menurunkannya dapat menerbitkan ulang nomor yang terpakai.
    async advance(id: string, nextNumber: number): Promise<void> {
        await this.db.transaction(async () => {
            const sequence = await this.db.one(
                sequenceSchema,
                'select * from tenant_number_sequences where id=$1 and tenant_id=$2 limit 1 for update',
                [id, this.tenantId],
            );
            if (!sequence) abort(404, 'Pengaturan nomor tidak ditemukan.');
            if (sequence.is_continuous)
                validation({
                    next_number: 'Nomor berkelanjutan tidak dapat dilompati.',
                });
            if (
                sequence.reset_period.startsWith('fiscal') ||
                sequence.segments.some((segment) => segment.type === 'context')
            )
                validation({
                    next_number:
                        'Nomor berikutnya pengaturan ini dihitung terpisah per periode fiskal atau per kode data, jadi tidak dapat diubah dari sini.',
                });
            const scopeKey =
                sequence.scope_type === 'operating_unit'
                    ? 'operating_unit:' + String(sequence.operating_unit_id)
                    : sequence.legal_entity_id !== null
                      ? 'legal_entity:' + sequence.legal_entity_id
                      : 'tenant:' + this.tenantId;
            const periodKey =
                sequence.reset_period === 'calendar_year'
                    ? String(new Date().getUTCFullYear())
                    : 'all';
            const next = BigInt(nextNumber);
            const length =
                sequence.segments.find((segment) => segment.type === 'number')
                    ?.length ?? 0;
            if (
                (sequence.maximum_number !== null &&
                    next > sequence.maximum_number) ||
                String(next).length > length
            )
                validation({
                    next_number:
                        'Nomor berikutnya melampaui nomor terbesar atau panjang segmen nomor.',
                });
            const now = nowSql();
            await this.db.execute(
                'insert into number_sequence_counters (id,sequence_id,scope_key,period_key,next_number,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$6) on conflict do nothing',
                [
                    Bun.randomUUIDv7(),
                    id,
                    scopeKey,
                    periodKey,
                    String(sequence.minimum_number),
                    now,
                ],
            );
            const counter = await this.db.one(
                z.object({ id: z.string(), next_number: z.coerce.bigint() }),
                'select id,next_number from number_sequence_counters where sequence_id=$1 and scope_key=$2 and period_key=$3 for update',
                [id, scopeKey, periodKey],
            );
            if (!counter) throw new Error('Number counter was not created.');
            if (next <= counter.next_number)
                validation({
                    next_number: 'Nomor berikutnya hanya boleh dinaikkan.',
                });
            await this.db.execute(
                'update number_sequence_allocations set next_number=last_number+1,updated_at=$1 where sequence_id=$2 and scope_key=$3 and period_key=$4 and next_number<=last_number',
                [now, id, scopeKey, periodKey],
            );
            await this.db.execute(
                'delete from number_sequence_reusable_numbers where sequence_id=$1 and scope_key=$2 and period_key=$3 and numeric_value<$4',
                [id, scopeKey, periodKey, String(next)],
            );
            await this.db.execute(
                'update number_sequence_counters set next_number=$1,updated_at=$2 where id=$3',
                [String(next), now, counter.id],
            );
            await audit(
                this.db,
                id,
                null,
                'counter_advanced',
                null,
                { scope: scopeKey, next_number: nextNumber },
                this.userId,
            );
        });
    }

    // Status list F&O: nomor yang sedang dipesan dan belum dipakai dokumen.
    async statusList(id: string) {
        await this.find(id);
        return this.db.rows(
            z.object({
                id: z.string(),
                number: z.string(),
                status: z.string(),
                app_id: z.string(),
                reserved_at: z.string().nullable(),
                expires_at: z.string().nullable(),
                expired: z.boolean(),
            }),
            'select id,formatted_value as number,status,app_id,to_char(created_at,\'YYYY-MM-DD"T"HH24:MI:SS"Z"\') as reserved_at,to_char(expires_at,\'YYYY-MM-DD"T"HH24:MI:SS"Z"\') as expires_at,coalesce(expires_at<=$2,false) as expired from number_sequence_reservations where sequence_id=$1 and status in (\'reserved\',\'reconciliation_pending\') order by numeric_value',
            [id, nowSql()],
        );
    }

    // Manual cleanup F&O: mengembalikan nomor yang dipesan tetapi tidak pernah dipakai, setelah tenggatnya lewat.
    async cleanup(id: string): Promise<number> {
        await this.find(id);
        return this.db.transaction(async () => {
            let released = 0;
            for (;;) {
                const count = await releaseExpired(
                    this.db,
                    this.tenantId,
                    id,
                    this.userId,
                );
                released += count;
                if (count === 0) return released;
            }
        });
    }
}

const listRowSchema = z.object({
    id: z.string(),
    reference_id: z.string(),
    reference_code: z.string(),
    reference_name: z.string(),
    area_id: z.string(),
    area_name: z.string(),
    scope_type: z.enum(scopeTypes),
    scope_value_name: z.string().nullable(),
    company_code: z.string().nullable(),
    fiscal_period_name: z.string().nullable(),
    status: z.enum(sequenceStatuses),
    is_continuous: z.boolean(),
    segments: z.string(),
    minimum_number: z.coerce.number(),
    maximum_number: z.coerce.number().nullable(),
    version: z.number(),
});
const listQuery = `select s.id,s.reference_id,r.code as reference_code,r.name as reference_name,r.app_id as area_id,
        a.name as area_name,s.scope_type,o.name as scope_value_name,l.company_code,
        case when p.id is null then null else y.name||' '||p.name end as fiscal_period_name,
        s.status,s.is_continuous,s.segments::text as segments,s.minimum_number,s.maximum_number,s.version
    from tenant_number_sequences s
    join app_number_sequence_references r on r.id=s.reference_id
    join apps a on a.id=r.app_id
    left join organizations o on o.id=coalesce(s.operating_unit_id,s.legal_entity_id)
    left join legal_entities l on l.organization_id=s.legal_entity_id
    left join fiscal_periods p on p.id=s.fiscal_period_id
    left join fiscal_years y on y.id=p.fiscal_year_id
    where s.tenant_id=$1`;
const scopeValueSchema = z.object({
    id: z.string(),
    name: z.string(),
    code: z.string().nullable(),
});

// Pola nomor untuk dibaca orang: # untuk digit nomor, dan nama bagian yang nilainya baru diketahui saat terbit.
function pattern(segments: Segment[], companyCode: string | null): string {
    return segments
        .map((segment) => {
            switch (segment.type) {
                case 'constant':
                    return segment.value;
                case 'number':
                    return '#'.repeat(segment.length);
                case 'year':
                    return '[tahun]';
                case 'scope':
                    return companyCode ?? '[kode unit]';
                case 'fiscal_year':
                    return '[tahun fiskal]';
                case 'fiscal_period':
                    return '[periode]';
                case 'context':
                    return `[${segment.name ?? segment.value}]`;
                default: {
                    const exhaustive: never = segment;
                    return exhaustive;
                }
            }
        })
        .join('');
}

function present(row: z.infer<typeof listRowSchema>) {
    const segments = z.array(segmentSchema).parse(JSON.parse(row.segments));
    return { ...row, segments, format: pattern(segments, row.company_code) };
}

// Bacaan layar Nomor dokumen: daftar, kartu, pilihan nilai scope, dan data pendukungnya.
export class NumberSequenceDirectory {
    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
    ) {}

    async list(parameters: URLSearchParams) {
        const bindings: string[] = [this.tenantId];
        let query = listQuery;
        const filter = (column: string, name: string) => {
            const value = parameters.get(name);
            if (!value) return;
            bindings.push(value);
            query += ` and ${column}=$${bindings.length}`;
        };
        filter('r.id::text', 'reference_id');
        filter('r.app_id', 'area_id');
        filter('s.scope_type', 'scope_type');
        filter('s.status', 'status');
        const batch = await incrementalList(this.db, {
            query,
            bindings,
            parameters,
            columns: {
                reference_name: 'reference_name',
                area_name: 'area_name',
                scope_value_name: 'scope_value_name',
                status: 'status',
            },
            searchColumns: [
                'reference_name',
                'reference_code',
                'area_name',
                'scope_value_name',
            ],
            numericColumns: [],
            defaultSort: 'reference_name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => present(listRowSchema.parse(row))),
            next_cursor: batch.next_cursor,
        };
    }

    async metadata(canManage: boolean) {
        const references = await this.db.rows(
            z.object({
                id: z.string(),
                code: z.string(),
                name: z.string(),
                area_id: z.string(),
                area_name: z.string(),
                allowed_scopes: z.array(z.string()),
                default_prefix: z.string().nullable(),
                context_fields: z.array(
                    z.object({
                        value: z.string(),
                        name: z.string().nullable(),
                        length: z.number(),
                    }),
                ),
            }),
            `select r.id,r.code,r.name,r.app_id as area_id,a.name as area_name,r.allowed_scopes,r.default_prefix,
                coalesce((select json_agg(json_build_object('value',x->>'value','name',x->>'name','length',(x->>'length')::int))
                    from jsonb_array_elements(coalesce(r.default_settings->'segments','[]'::jsonb)) x
                    where x->>'type'='context'),'[]'::json) as context_fields
             from app_number_sequence_references r join apps a on a.id=r.app_id order by a.name,r.name`,
        );
        return { canManage, references };
    }

    async show(id: string) {
        const row = await this.db.one(
            listRowSchema,
            listQuery + ' and s.id=$2 limit 1',
            [this.tenantId, id],
        );
        const sequence = await this.db.one(
            sequenceSchema,
            'select * from tenant_number_sequences where id=$1 and tenant_id=$2',
            [id, this.tenantId],
        );
        if (!row || !sequence) abort(404, 'Pengaturan nomor tidak ditemukan.');
        const state = await this.db.one(
            z.object({
                next_number: z.coerce.number().nullable(),
                used: z.boolean(),
            }),
            'select (select max(next_number) from number_sequence_counters where sequence_id=$1) as next_number, exists(select 1 from number_sequence_counters where sequence_id=$1) or exists(select 1 from number_sequence_issues where sequence_id=$1) or exists(select 1 from number_sequence_reservations where sequence_id=$1) as used',
            [id],
        );
        return {
            ...present(row),
            legal_entity_id: sequence.legal_entity_id,
            operating_unit_id: sequence.operating_unit_id,
            fiscal_period_id: sequence.fiscal_period_id,
            allow_automatic: sequence.allow_automatic,
            allow_manual: sequence.allow_manual,
            allow_lower_number: sequence.allow_lower_number,
            allow_higher_number: sequence.allow_higher_number,
            reset_period: sequence.reset_period,
            preallocation_enabled: sequence.preallocation_enabled,
            preallocation_quantity: sequence.preallocation_quantity,
            next_number: Math.max(
                state?.next_number ?? 0,
                Number(sequence.minimum_number),
            ),
            used: state?.used ?? false,
        };
    }

    // Pilihan nilai scope saat membuat: perusahaan, unit, atau periode fiskal milik perusahaan yang dipilih.
    async scopeValues(parameters: URLSearchParams) {
        const kind = parameters.get('kind');
        const periods = kind === 'fiscal_period';
        const batch = await incrementalList(this.db, {
            query: periods
                ? `select p.id,y.name||' '||p.name as name,to_char(p.starts_on,'YYYY-MM-DD') as code
                   from legal_entities l join organizations o on o.id=l.organization_id
                   join fiscal_years y on y.fiscal_calendar_id=l.fiscal_calendar_id
                   join fiscal_periods p on p.fiscal_year_id=y.id
                   where o.tenant_id=$1 and l.organization_id::text=$2`
                : `select o.id,o.name,coalesce(l.company_code,u.number) as code
                   from organizations o
                   left join legal_entities l on l.organization_id=o.id
                   left join operating_units u on u.organization_id=o.id
                   where o.tenant_id=$1 and o.status='active' and o.classification=$2`,
            bindings: [
                this.tenantId,
                periods
                    ? (parameters.get('legal_entity_id') ?? '')
                    : kind === 'operating_unit'
                      ? 'operating_unit'
                      : 'legal_entity',
            ],
            parameters,
            columns: { name: 'name', code: 'code' },
            searchColumns: ['name', 'code'],
            numericColumns: [],
            defaultSort: periods ? 'code' : 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => scopeValueSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }
}
