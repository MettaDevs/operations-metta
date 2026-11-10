import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { nowSql, sqlErrorCode } from '../../platform/database/index.ts';
import { coded } from '../../platform/http/index.ts';
import { type Sequence, sequenceSchema } from './number-sequence.schema.ts';

// Lama sebuah pesanan nomor continuous ditahan sebelum boleh dilepas, sama dengan CoreERP.
export const reservationMinutes = 15;
const maximumOutstandingReservations = 500;
const releaseBatch = 100;

type Scope = {
    key: string;
    period: string;
    code: string | null;
    values: Record<string, string>;
    year: string;
    fiscalYear: string | null;
    fiscalPeriod: number | null;
};

// Pemilik nomor: tenant dan module yang meminta. Tidak ada organisasi di sini: organisasi milik dokumen, bukan
// milik workspace pengguna yang kebetulan sedang aktif.
export type NumberOwner = { tenantId: string; moduleId: string };

export type NumberRequest = {
    reference: string;
    // Kunci idempotensi yang stabil dari dokumen. Kunci yang sama selalu mendapat nomor yang sama.
    key: string;
    // Tanggal dokumen (YYYY-MM-DD). Periode fiskal dan sequence per periode fiskal dipilih dari tanggal ini.
    documentDate: string;
    // Legal entity dan operating unit milik dokumen. Sequence dipilih dari nilai ini.
    legalEntityId?: string | null;
    operatingUnitId?: string | null;
    values?: Record<string, string>;
    // Nomor yang diketik pengguna: nomor manual, atau nomor otomatis yang diubah ke lebih kecil atau lebih besar.
    number?: string;
};

export type Reservation = {
    id: string;
    number: string;
    status: string;
    expiresAt: string | null;
};

const counterSchema = z.object({
    id: z.string(),
    next_number: z.coerce.bigint(),
});
const allocationSchema = counterSchema.extend({
    last_number: z.coerce.bigint(),
});
const reservationSchema = z.object({
    id: z.string(),
    sequence_id: z.string(),
    app_id: z.string(),
    scope_key: z.string(),
    period_key: z.string(),
    numeric_value: z.coerce.bigint(),
    formatted_value: z.string(),
    idempotency_key: z.string(),
    status: z.string(),
    expires_at: z.string().nullable(),
    is_continuous: z.boolean(),
    preallocation_enabled: z.boolean(),
});
type ReservationRow = z.infer<typeof reservationSchema>;
const reservationColumns =
    'r.id,r.sequence_id,r.app_id,r.scope_key,r.period_key,r.numeric_value,r.formatted_value,r.idempotency_key,r.status,to_char(r.expires_at,\'YYYY-MM-DD"T"HH24:MI:SS"Z"\') as expires_at,s.is_continuous,s.preallocation_enabled';

export function failSequence(message: string): never {
    return coded(422, 'number_sequence_failed', message);
}

function stamp(minutes: number): string {
    return new Date(Date.now() + minutes * 60_000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

export function audit(
    db: Database,
    sequenceId: string,
    appId: string | null,
    event: string,
    formattedValue: string | null,
    details: object,
    userId: string | null = null,
): Promise<void> {
    const now = nowSql();
    return db.insert('number_sequence_audit_events', {
        id: Bun.randomUUIDv7(),
        sequence_id: sequenceId,
        app_id: appId,
        user_id: userId,
        event_type: event,
        formatted_value: formattedValue,
        details: JSON.stringify(details),
        occurred_at: now,
        created_at: now,
        updated_at: now,
    });
}

// Melepas pesanan nomor: nomornya kembali ke pool (continuous berpreallocation) atau ke daftar nomor yang dipakai
// lagi. Pemanggil sudah mengunci baris pesanan.
export async function releaseReservation(
    db: Database,
    reservation: ReservationRow,
    event: 'cancelled' | 'recovered',
    userId: string | null = null,
): Promise<void> {
    const now = nowSql();
    await db.execute(
        "update number_sequence_reservations set status='cancelled',cancelled_at=$1,updated_at=$1 where id=$2",
        [now, reservation.id],
    );
    const released = await db.execute(
        "update number_sequence_continuous_pool set status='available',reservation_id=null,updated_at=$1 where sequence_id=$2 and scope_key=$3 and period_key=$4 and numeric_value=$5 and reservation_id=$6",
        [
            now,
            reservation.sequence_id,
            reservation.scope_key,
            reservation.period_key,
            String(reservation.numeric_value),
            reservation.id,
        ],
    );
    if (released === 0)
        await db.execute(
            'insert into number_sequence_reusable_numbers (sequence_id,scope_key,period_key,numeric_value) values ($1,$2,$3,$4) on conflict do nothing',
            [
                reservation.sequence_id,
                reservation.scope_key,
                reservation.period_key,
                String(reservation.numeric_value),
            ],
        );
    await audit(
        db,
        reservation.sequence_id,
        reservation.app_id,
        event,
        reservation.formatted_value,
        { reservation_id: reservation.id },
        userId,
    );
}

// Melepas pesanan yang melewati tenggatnya, seperti cleanup number sequence continuous di F&O. Pesanan yang
// barisnya sedang dikunci transaksi dokumen (misalnya sedang di-confirm) dilewati, jadi nomor yang sedang dipakai
// tidak pernah dilepas. Di runtime ini confirm dan dokumen berada dalam satu transaksi, jadi pesanan yang lewat
// tenggat tanpa confirm berarti dokumennya tidak tersimpan.
export async function releaseExpired(
    db: Database,
    tenantId: string,
    sequenceId: string | null,
    userId: string | null = null,
): Promise<number> {
    const expired = await db.rows(
        reservationSchema,
        `select ${reservationColumns} from number_sequence_reservations r join tenant_number_sequences s on s.id=r.sequence_id where s.tenant_id=$1 and ($2::uuid is null or r.sequence_id=$2) and r.status in ('reserved','reconciliation_pending') and r.expires_at<=$3 order by r.expires_at limit ${releaseBatch} for update of r skip locked`,
        [tenantId, sequenceId, nowSql()],
    );
    for (const reservation of expired)
        await releaseReservation(db, reservation, 'recovered', userId);
    return expired.length;
}

export class NumberIssuer {
    constructor(
        private readonly db: Database,
        private readonly owner: NumberOwner,
    ) {}

    private async reference(code: string) {
        const reference = await this.db.one(
            z.object({ id: z.string(), name: z.string() }),
            'select id,name from app_number_sequence_references where code=$1 and app_id=$2 limit 1',
            [code, this.owner.moduleId],
        );
        if (!reference)
            failSequence('Jenis nomor ini belum terdaftar untuk aplikasi ini.');
        return reference;
    }

    // Sequence aktif untuk nilai scope milik dokumen. Tidak ada perpindahan ke scope lain bila tidak ditemukan.
    private async sequence(
        reference: { id: string; name: string },
        request: Omit<NumberRequest, 'key'>,
    ): Promise<Sequence> {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(request.documentDate))
            throw new Error('documentDate must be YYYY-MM-DD.');
        const found = await this.db.rows(
            sequenceSchema,
            `select s.* from tenant_number_sequences s where s.tenant_id=$1 and s.reference_id=$2 and s.status='active' and exists(select 1 from app_number_sequence_references r where r.id=s.reference_id and r.app_id=$6) and (s.scope_type='tenant' or (s.scope_type='legal_entity' and s.legal_entity_id=$3) or (s.scope_type='operating_unit' and s.operating_unit_id=$4) or (s.scope_type='legal_entity_fiscal_period' and s.legal_entity_id=$3 and exists(select 1 from fiscal_periods p where p.id=s.fiscal_period_id and $5::date between p.starts_on and p.ends_on))) order by s.id for share`,
            [
                this.owner.tenantId,
                reference.id,
                request.legalEntityId ?? null,
                request.operatingUnitId ?? null,
                request.documentDate,
                this.owner.moduleId,
            ],
        );
        const [sequence] = found;
        if (sequence && found.length === 1) return sequence;
        if (found.length > 1)
            failSequence(
                `Ada lebih dari satu pengaturan nomor "${reference.name}" yang cocok untuk dokumen ini. Hentikan salah satunya.`,
            );
        return this.missing(reference, request);
    }

    private async missing(
        reference: { id: string; name: string },
        request: Omit<NumberRequest, 'key'>,
    ): Promise<never> {
        const active = await this.db.one(
            z.object({ scope_type: z.string() }),
            "select scope_type from tenant_number_sequences where tenant_id=$1 and reference_id=$2 and status='active' limit 1",
            [this.owner.tenantId, reference.id],
        );
        const organizationId =
            active?.scope_type === 'operating_unit'
                ? request.operatingUnitId
                : request.legalEntityId;
        const organization = organizationId
            ? await this.db.one(
                  z.object({ name: z.string() }),
                  'select name from organizations where id=$1 and tenant_id=$2 limit 1',
                  [organizationId, this.owner.tenantId],
              )
            : undefined;
        const name = `"${reference.name}"`;
        switch (active?.scope_type) {
            case undefined:
                return failSequence(
                    `Nomor ${name} belum diatur. Minta admin membuat pengaturan nomornya.`,
                );
            case 'operating_unit':
                return failSequence(
                    organization
                        ? `Nomor ${name} belum diatur untuk unit ${organization.name}. Minta admin membuat pengaturan nomor untuk unit itu.`
                        : `Nomor ${name} diatur per unit, tetapi dokumen ini belum menyebut unitnya.`,
                );
            case 'legal_entity_fiscal_period':
                return failSequence(
                    organization
                        ? `Nomor ${name} belum diatur untuk ${organization.name} pada periode fiskal tanggal ${request.documentDate}. Minta admin membuat pengaturan nomor untuk periode itu.`
                        : `Nomor ${name} diatur per perusahaan dan periode fiskal, tetapi dokumen ini belum menyebut perusahaannya.`,
                );
            default:
                return failSequence(
                    organization
                        ? `Nomor ${name} belum diatur untuk ${organization.name}. Minta admin membuat pengaturan nomor untuk perusahaan itu.`
                        : `Nomor ${name} diatur per perusahaan, tetapi dokumen ini belum menyebut perusahaannya.`,
                );
        }
    }

    private async fiscal(
        legalEntityId: string,
        date: string,
    ): Promise<{ yearId: string; yearName: string; ordinal: number }> {
        const fiscal = await this.db.one(
            z.object({
                year_id: z.string(),
                year_name: z.string(),
                period_ordinal: z.number(),
            }),
            'select y.id as year_id,y.name as year_name,p.ordinal as period_ordinal from legal_entities l join fiscal_years y on y.fiscal_calendar_id=l.fiscal_calendar_id join fiscal_periods p on p.fiscal_year_id=y.id where l.organization_id=$1 and l.tenant_id=$2 and $3::date between p.starts_on and p.ends_on limit 1',
            [legalEntityId, this.owner.tenantId, date],
        );
        if (!fiscal)
            failSequence(
                `Kalender fiskal belum tersedia untuk tanggal dokumen ${date}.`,
            );
        return {
            yearId: fiscal.year_id,
            yearName: fiscal.year_name,
            ordinal: fiscal.period_ordinal,
        };
    }

    private async scope(
        sequence: Sequence,
        request: Omit<NumberRequest, 'key'>,
    ): Promise<Scope> {
        let key = 'tenant:' + this.owner.tenantId;
        let code: string | null = null;
        const organizationId =
            sequence.operating_unit_id ?? sequence.legal_entity_id;
        if (organizationId !== null) {
            const organization = await this.db.one(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    company_code: z.string().nullable(),
                    unit_number: z.string().nullable(),
                }),
                "select o.id,o.name,l.company_code,u.number as unit_number from organizations o left join legal_entities l on l.organization_id=o.id left join operating_units u on u.organization_id=o.id where o.id=$1 and o.tenant_id=$2 and o.status='active' limit 1",
                [organizationId, this.owner.tenantId],
            );
            if (!organization)
                failSequence(
                    'Organisasi untuk pengaturan nomor ini sudah tidak aktif.',
                );
            const unit = sequence.scope_type === 'operating_unit';
            // Segmen organisasi mencetak kode yang dikenal orang: kode perusahaan, atau nomor operating unit. Id
            // internal tidak pernah dicetak; unit tanpa nomor ditolak bila formatnya memuat segmen ini.
            code = unit ? organization.unit_number : organization.company_code;
            if (
                code === null &&
                sequence.segments.some((segment) => segment.type === 'scope')
            )
                failSequence(
                    `Operating unit ${organization.name} belum punya nomor unit, padahal format nomornya mencetak nomor unit. Isi nomor unitnya lebih dulu.`,
                );
            key =
                (unit ? 'operating_unit:' : 'legal_entity:') + organization.id;
        }
        const context: Record<string, string> = {};
        for (const segment of sequence.segments) {
            if (segment.type !== 'context') continue;
            const value = request.values?.[segment.value];
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
        // Segmen tahun tetap tahun penerbitan, sama dengan CoreERP; tahun dokumen dikirim lewat segmen context.
        const year = String(new Date().getUTCFullYear());
        let period = sequence.reset_period === 'calendar_year' ? year : 'all';
        let fiscalYear: string | null = null;
        let fiscalPeriod: number | null = null;
        if (sequence.fiscal_period_id !== null) {
            const fiscal = await this.db.one(
                z.object({ year_name: z.string(), ordinal: z.number() }),
                'select y.name as year_name,p.ordinal from fiscal_periods p join fiscal_years y on y.id=p.fiscal_year_id where p.id=$1 limit 1',
                [sequence.fiscal_period_id],
            );
            if (!fiscal)
                throw new Error('Fiscal period of sequence is missing.');
            fiscalYear = fiscal.year_name;
            fiscalPeriod = fiscal.ordinal;
        } else if (sequence.reset_period.startsWith('fiscal')) {
            const legalEntityId =
                sequence.legal_entity_id ??
                (sequence.scope_type === 'operating_unit'
                    ? (request.legalEntityId ?? null)
                    : null);
            if (!legalEntityId)
                failSequence(
                    'Nomor ini direset per periode fiskal, jadi dokumen harus menyebut perusahaannya.',
                );
            const fiscal = await this.fiscal(
                legalEntityId,
                request.documentDate,
            );
            fiscalYear = fiscal.yearName;
            fiscalPeriod = fiscal.ordinal;
            period =
                sequence.reset_period === 'fiscal_year'
                    ? 'FY:' + fiscal.yearId
                    : `FP:${fiscal.yearId}:${fiscal.ordinal}`;
            if (sequence.scope_type === 'operating_unit')
                key += '|legal_entity:' + legalEntityId;
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
            const now = nowSql();
            await this.db.execute(
                'insert into number_sequence_counters(id,sequence_id,scope_key,period_key,next_number,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$6) on conflict do nothing',
                [
                    Bun.randomUUIDv7(),
                    ...bindings,
                    String(sequence.minimum_number),
                    now,
                ],
            );
            counter = await this.db.one(
                counterSchema,
                'select id,next_number from number_sequence_counters where sequence_id=$1 and scope_key=$2 and period_key=$3 limit 1 for update',
                bindings,
            );
        }
        if (!counter) throw new Error('Number counter was not created.');
        // Smallest yang dinaikkan sesudah counter lahir berlaku untuk nomor berikutnya.
        if (counter.next_number < sequence.minimum_number)
            counter.next_number = sequence.minimum_number;
        return counter;
    }

    private async directNumber(
        sequence: Sequence,
        scope: Scope,
    ): Promise<bigint> {
        const bindings = [sequence.id, scope.key, scope.period];
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

    private allocationEnd(sequence: Sequence, first: bigint): bigint {
        const proposed = first + BigInt(sequence.preallocation_quantity) - 1n;
        return sequence.maximum_number !== null &&
            proposed > sequence.maximum_number
            ? sequence.maximum_number
            : proposed;
    }

    private async numeric(sequence: Sequence, scope: Scope): Promise<bigint> {
        if (!sequence.preallocation_enabled)
            return this.directNumber(sequence, scope);
        const bindings = [sequence.id, scope.key, scope.period];
        // Urutan kunci: counter, lalu blok, untuk setiap penerbit (lihat CoreERP docs/dev/14-number-sequences.md).
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
            const last = this.allocationEnd(sequence, first);
            const id = Bun.randomUUIDv7();
            const now = nowSql();
            await this.db.insert('number_sequence_allocations', {
                id,
                sequence_id: sequence.id,
                scope_key: scope.key,
                period_key: scope.period,
                first_number: String(first),
                last_number: String(last),
                next_number: String(first),
                created_at: now,
                updated_at: now,
            });
            await this.db.execute(
                'update number_sequence_counters set next_number=$1,updated_at=$2 where id=$3',
                [String(last + 1n), now, counter.id],
            );
            await audit(this.db, sequence.id, null, 'preallocated', null, {
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

    private async availableContinuous(
        sequence: Sequence,
        scope: Scope,
    ): Promise<bigint | null> {
        const row = await this.db.one(
            z.object({ numeric_value: z.coerce.bigint() }),
            "select numeric_value from number_sequence_continuous_pool where sequence_id=$1 and scope_key=$2 and period_key=$3 and status='available' order by numeric_value limit 1 for update skip locked",
            [sequence.id, scope.key, scope.period],
        );
        return row ? row.numeric_value : null;
    }

    // Nomor continuous diambil dari pool yang setiap nomornya satu baris berstatus, jadi nomor yang tidak jadi dipakai
    // kembali tersedia dan tidak ada yang hilang.
    private async continuousNumber(
        sequence: Sequence,
        scope: Scope,
        reservationId: string,
    ): Promise<bigint> {
        if (!sequence.preallocation_enabled)
            return this.directNumber(sequence, scope);
        let available = await this.availableContinuous(sequence, scope);
        if (available === null) {
            const counter = await this.counter(sequence, scope);
            available = await this.availableContinuous(sequence, scope);
            if (available === null) {
                const first = this.maximum(sequence, counter.next_number);
                const last = this.allocationEnd(sequence, first);
                const now = nowSql();
                await this.db.execute(
                    "insert into number_sequence_continuous_pool (sequence_id,scope_key,period_key,numeric_value,status,created_at,updated_at) select $1,$2,$3,n,'available',$6,$6 from generate_series($4::bigint,$5::bigint) n",
                    [
                        sequence.id,
                        scope.key,
                        scope.period,
                        String(first),
                        String(last),
                        now,
                    ],
                );
                await this.db.execute(
                    'update number_sequence_counters set next_number=$1,updated_at=$2 where id=$3',
                    [String(last + 1n), now, counter.id],
                );
                await audit(this.db, sequence.id, null, 'preallocated', null, {
                    scope: scope.key,
                    first: Number(first),
                    last: Number(last),
                    mode: 'continuous',
                });
                available = await this.availableContinuous(sequence, scope);
            }
        }
        if (available === null) failSequence('Nomor sequence belum tersedia.');
        const numeric = this.maximum(sequence, available);
        await this.db.execute(
            "update number_sequence_continuous_pool set status='reserved',reservation_id=$1,updated_at=$2 where sequence_id=$3 and scope_key=$4 and period_key=$5 and numeric_value=$6 and status='available'",
            [
                reservationId,
                nowSql(),
                sequence.id,
                scope.key,
                scope.period,
                String(numeric),
            ],
        );
        return numeric;
    }

    // Bagian format selain segmen nomor, sudah diisi; null menandai tempat segmen nomor.
    private parts(sequence: Sequence, scope: Scope): (string | null)[] {
        return sequence.segments.map((segment) => {
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
                case 'number':
                    return null;
                default: {
                    const exhaustive: never = segment;
                    return exhaustive;
                }
            }
        });
    }

    private numberLength(sequence: Sequence): number {
        for (const segment of sequence.segments)
            if (segment.type === 'number') return segment.length;
        throw new Error('Sequence has no number segment.');
    }

    private format(sequence: Sequence, scope: Scope, number: bigint): string {
        const length = this.numberLength(sequence);
        const text = String(number);
        if (text.length > length)
            failSequence(
                'Nomor sudah melampaui panjang segmen yang dikonfigurasi.',
            );
        return this.parts(sequence, scope)
            .map((part) => part ?? text.padStart(length, '0'))
            .join('');
    }

    // Angka di dalam nomor yang diketik pengguna, bila nomor itu persis mengikuti format sequence.
    private parse(sequence: Sequence, scope: Scope, value: string): bigint {
        const length = this.numberLength(sequence);
        const pattern = new RegExp(
            '^' +
                this.parts(sequence, scope)
                    .map((part) =>
                        part === null ? `(\\d{${length}})` : escapeRegex(part),
                    )
                    .join('') +
                '$',
        );
        const digits = pattern.exec(value)?.[1];
        if (digits === undefined)
            failSequence(
                `Nomor ${value} tidak mengikuti format ${this.format(sequence, scope, 0n).replace(/0+$/, (zeros) => '#'.repeat(zeros.length))}.`,
            );
        return BigInt(digits);
    }

    // Nomor yang akan diterima penerbitan otomatis berikutnya, tanpa mengambilnya. Dipakai untuk membandingkan nomor
    // yang diubah pengguna dan untuk pratinjau.
    private async peek(sequence: Sequence, scope: Scope): Promise<bigint> {
        const bindings = [sequence.id, scope.key, scope.period];
        const counter = await this.db.one(
            z.object({ next_number: z.coerce.bigint() }),
            'select next_number from number_sequence_counters where sequence_id=$1 and scope_key=$2 and period_key=$3 limit 1',
            bindings,
        );
        const fromCounter =
            counter && counter.next_number > sequence.minimum_number
                ? counter.next_number
                : sequence.minimum_number;
        const candidate = await this.db.one(
            z.object({ next_number: z.coerce.bigint() }),
            sequence.is_continuous && sequence.preallocation_enabled
                ? "select numeric_value as next_number from number_sequence_continuous_pool where sequence_id=$1 and scope_key=$2 and period_key=$3 and status='available' order by numeric_value limit 1"
                : sequence.preallocation_enabled
                  ? 'select next_number from number_sequence_allocations where sequence_id=$1 and scope_key=$2 and period_key=$3 and next_number<=last_number order by created_at limit 1'
                  : 'select numeric_value as next_number from number_sequence_reusable_numbers where sequence_id=$1 and scope_key=$2 and period_key=$3 order by numeric_value limit 1',
            bindings,
        );
        return candidate?.next_number ?? fromCounter;
    }

    private formattedExists(
        sequence: Sequence,
        scope: Scope,
        formatted: string,
    ): Promise<boolean> {
        return this.db
            .one(
                z.object({ found: z.boolean() }),
                'select true as found from number_sequence_issues where sequence_id=$1 and scope_key=$2 and formatted_value=$3 limit 1',
                [sequence.id, scope.key, formatted],
            )
            .then(Boolean);
    }

    private replay(
        referenceId: string,
        key: string,
    ): Promise<{ formatted_value: string } | undefined> {
        return this.db.one(
            z.object({ formatted_value: z.string() }),
            'select i.formatted_value from number_sequence_issues i join tenant_number_sequences s on s.id=i.sequence_id where s.tenant_id=$1 and s.reference_id=$2 and i.app_id=$3 and i.idempotency_key=$4 limit 1',
            [this.owner.tenantId, referenceId, this.owner.moduleId, key],
        );
    }

    private async record(
        sequence: Sequence,
        scope: Scope,
        key: string,
        numeric: bigint | null,
        formatted: string,
        manual: boolean,
    ): Promise<void> {
        const now = nowSql();
        await this.db.insert('number_sequence_issues', {
            id: Bun.randomUUIDv7(),
            sequence_id: sequence.id,
            app_id: this.owner.moduleId,
            scope_key: scope.key,
            period_key: scope.period,
            numeric_value: numeric === null ? null : String(numeric),
            formatted_value: formatted,
            idempotency_key: key,
            is_manual: manual,
            issued_at: now,
            created_at: now,
            updated_at: now,
        });
        await audit(
            this.db,
            sequence.id,
            this.owner.moduleId,
            manual ? 'manual_issued' : 'issued',
            formatted,
            { scope: scope.key },
        );
    }

    // Nomor yang diketik pengguna. Manual menerima teks apa pun yang unik. Allow user changes F&O ("To a lower
    // number", "To a higher number") menerima nomor otomatis yang diubah ke angka lebih kecil atau lebih besar dari
    // Next, selama tetap mengikuti format, rentang Smallest–Largest, dan belum pernah terbit.
    private async typed(
        sequence: Sequence,
        scope: Scope,
        key: string,
        value: string,
    ): Promise<string> {
        if (sequence.allow_manual) {
            if (
                value.trim() === '' ||
                value.length > 255 ||
                /[\x00-\x1F\x7F]/.test(value)
            )
                failSequence(
                    'Nomor manual harus diisi, maksimal 255 karakter, dan tidak boleh memuat karakter kontrol.',
                );
            if (await this.formattedExists(sequence, scope, value))
                failSequence('Nomor tersebut sudah digunakan.');
            await this.record(sequence, scope, key, null, value, true);
            return value;
        }
        if (!sequence.allow_lower_number && !sequence.allow_higher_number)
            failSequence(
                'Nomor ini dibuat otomatis dan pengaturannya tidak mengizinkan nomor diubah.',
            );
        const numeric = this.parse(sequence, scope, value);
        if (
            numeric < sequence.minimum_number ||
            (sequence.maximum_number !== null &&
                numeric > sequence.maximum_number)
        )
            failSequence(
                `Nomor harus berada di antara ${sequence.minimum_number} dan ${sequence.maximum_number ?? 'tanpa batas'}.`,
            );
        const next = await this.peek(sequence, scope);
        if (numeric < next && !sequence.allow_lower_number)
            failSequence(
                'Pengaturan nomor ini tidak mengizinkan perubahan ke nomor yang lebih kecil.',
            );
        if (numeric > next && !sequence.allow_higher_number)
            failSequence(
                'Pengaturan nomor ini tidak mengizinkan perubahan ke nomor yang lebih besar.',
            );
        if (await this.formattedExists(sequence, scope, value))
            failSequence('Nomor tersebut sudah digunakan.');
        await this.record(sequence, scope, key, numeric, value, true);
        return value;
    }

    private async retry<T>(
        referenceCode: string,
        work: () => Promise<T>,
        replay: () => Promise<T | undefined>,
    ): Promise<T> {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.db.transaction(work);
            } catch (error) {
                // Transaksi dokumen sudah dikembalikan ke savepoint, jadi query berikutnya boleh berjalan.
                if (sqlErrorCode(error)) {
                    const found = await replay();
                    if (found !== undefined) return found;
                }
                if (sqlErrorCode(error) !== '23505' || attempt === 2)
                    throw error;
            }
        }
        throw new Error('Number issuance for ' + referenceCode + ' failed.');
    }

    // Menerbitkan nomor di dalam transaksi dokumen. Dokumen gagal tersimpan, nomornya ikut batal: penghitung, blok,
    // pool, dan catatan terbitnya kembali seperti semula.
    async issue(request: NumberRequest): Promise<string> {
        if (!this.db.inTransaction)
            throw new Error(
                'NumberIssuer.issue must run inside the document transaction.',
            );
        const reference = await this.reference(request.reference);
        return this.retry(
            request.reference,
            async () => {
                const replay = await this.replay(reference.id, request.key);
                if (replay) return replay.formatted_value;
                const sequence = await this.sequence(reference, request);
                const scope = await this.scope(sequence, request);
                if (request.number !== undefined)
                    return this.typed(
                        sequence,
                        scope,
                        request.key,
                        request.number,
                    );
                if (!sequence.allow_automatic)
                    failSequence(
                        'Isi kode secara manual. Pembuatan nomor otomatis tidak diizinkan.',
                    );
                if (sequence.is_continuous) {
                    const reservation = await this.take(
                        sequence,
                        scope,
                        request.key,
                        'confirmed',
                    );
                    await this.record(
                        sequence,
                        scope,
                        request.key,
                        reservation.numeric,
                        reservation.formatted,
                        false,
                    );
                    return reservation.formatted;
                }
                let number: bigint;
                let formatted: string;
                do {
                    number = await this.numeric(sequence, scope);
                    formatted = this.format(sequence, scope, number);
                } while (
                    await this.formattedExists(sequence, scope, formatted)
                );
                await this.record(
                    sequence,
                    scope,
                    request.key,
                    number,
                    formatted,
                    false,
                );
                return formatted;
            },
            async () =>
                (await this.replay(reference.id, request.key))?.formatted_value,
        );
    }

    // Satu nomor continuous dari pool, dicatat sebagai pesanan. Nomor yang sudah tercatat terbit dilewati dan
    // ditandai terpakai, supaya pool tidak terus menawarkan nomor yang tidak bisa dipakai.
    private async take(
        sequence: Sequence,
        scope: Scope,
        key: string,
        status: 'reserved' | 'confirmed',
    ): Promise<{
        id: string;
        numeric: bigint;
        formatted: string;
        expiresAt: string | null;
    }> {
        const id = Bun.randomUUIDv7();
        let numeric: bigint;
        let formatted: string;
        for (;;) {
            numeric = await this.continuousNumber(sequence, scope, id);
            formatted = this.format(sequence, scope, numeric);
            if (!(await this.formattedExists(sequence, scope, formatted)))
                break;
            await this.db.execute(
                "update number_sequence_continuous_pool set status='confirmed',updated_at=$1 where sequence_id=$2 and scope_key=$3 and period_key=$4 and numeric_value=$5 and reservation_id=$6",
                [
                    nowSql(),
                    sequence.id,
                    scope.key,
                    scope.period,
                    String(numeric),
                    id,
                ],
            );
        }
        const now = nowSql();
        const expiresAt =
            status === 'reserved' ? stamp(reservationMinutes) : null;
        await this.db.insert('number_sequence_reservations', {
            id,
            sequence_id: sequence.id,
            app_id: this.owner.moduleId,
            scope_key: scope.key,
            period_key: scope.period,
            numeric_value: String(numeric),
            formatted_value: formatted,
            idempotency_key: key,
            status,
            expires_at: expiresAt,
            confirmed_at: status === 'confirmed' ? now : null,
            created_at: now,
            updated_at: now,
        });
        if (status === 'confirmed')
            await this.db.execute(
                "update number_sequence_continuous_pool set status='confirmed',updated_at=$1 where reservation_id=$2",
                [now, id],
            );
        await audit(
            this.db,
            sequence.id,
            this.owner.moduleId,
            status,
            formatted,
            {
                scope: scope.key,
                reservation_id: id,
            },
        );
        return {
            id,
            numeric,
            formatted,
            expiresAt:
                expiresAt === null ? null : expiresAt.replace(' ', 'T') + 'Z',
        };
    }

    private async findReservation(
        reservationId: string,
    ): Promise<ReservationRow> {
        const reservation = await this.db.one(
            reservationSchema,
            `select ${reservationColumns} from number_sequence_reservations r join tenant_number_sequences s on s.id=r.sequence_id where r.id=$1 and r.app_id=$2 and s.tenant_id=$3 limit 1 for update of r`,
            [reservationId, this.owner.moduleId, this.owner.tenantId],
        );
        if (!reservation) failSequence('Pesanan nomor tidak ditemukan.');
        return reservation;
    }

    private reservationResult(row: {
        id: string;
        formatted_value: string;
        status: string;
        expires_at: string | null;
    }): Reservation {
        return {
            id: row.id,
            number: row.formatted_value,
            status: row.status,
            expiresAt: row.expires_at,
        };
    }

    // Memesan nomor continuous sebelum dokumen disimpan, misalnya saat formulir dibuka. Pesanan bertenggat
    // reservationMinutes; sesudahnya pesanan yang belum di-confirm boleh dilepas cleanup.
    async reserve(request: NumberRequest): Promise<Reservation> {
        const reference = await this.reference(request.reference);
        const existing = async () => {
            const row = await this.db.one(
                z.object({
                    id: z.string(),
                    formatted_value: z.string(),
                    status: z.string(),
                    expires_at: z.string().nullable(),
                }),
                'select r.id,r.formatted_value,r.status,to_char(r.expires_at,\'YYYY-MM-DD"T"HH24:MI:SS"Z"\') as expires_at from number_sequence_reservations r join tenant_number_sequences s on s.id=r.sequence_id where s.tenant_id=$1 and s.reference_id=$2 and r.app_id=$3 and r.idempotency_key=$4 limit 1',
                [
                    this.owner.tenantId,
                    reference.id,
                    this.owner.moduleId,
                    request.key,
                ],
            );
            if (!row) return undefined;
            // Nomor pesanan yang sudah dibatalkan mungkin sudah milik dokumen lain.
            if (row.status === 'cancelled')
                failSequence(
                    'Pesanan nomor untuk kunci ini sudah dibatalkan. Gunakan kunci baru.',
                );
            return this.reservationResult(row);
        };
        return this.retry(
            request.reference,
            async () => {
                const replay = await existing();
                if (replay) return replay;
                const sequence = await this.sequence(reference, request);
                if (!sequence.allow_automatic)
                    failSequence('Pembuatan nomor otomatis tidak diizinkan.');
                if (!sequence.is_continuous)
                    failSequence('Sequence ini tidak memakai pesanan nomor.');
                const scope = await this.scope(sequence, request);
                await releaseExpired(this.db, this.owner.tenantId, sequence.id);
                const outstanding = await this.db.one(
                    z.object({ count: z.number() }),
                    "select count(*)::int as count from number_sequence_reservations where sequence_id=$1 and status in ('reserved','reconciliation_pending')",
                    [sequence.id],
                );
                if ((outstanding?.count ?? 0) >= maximumOutstandingReservations)
                    failSequence(
                        `Terlalu banyak pesanan nomor yang belum diselesaikan (${outstanding?.count}). Selesaikan atau batalkan pesanan lama lebih dulu.`,
                    );
                const taken = await this.take(
                    sequence,
                    scope,
                    request.key,
                    'reserved',
                );
                return {
                    id: taken.id,
                    number: taken.formatted,
                    status: 'reserved',
                    expiresAt: taken.expiresAt,
                };
            },
            existing,
        );
    }

    // Menetapkan pesanan bersama dokumennya, di dalam transaksi dokumen.
    async confirm(reservationId: string): Promise<string> {
        if (!this.db.inTransaction)
            throw new Error(
                'NumberIssuer.confirm must run inside the document transaction.',
            );
        return this.db.transaction(async () => {
            const reservation = await this.findReservation(reservationId);
            if (reservation.status === 'confirmed')
                return reservation.formatted_value;
            if (
                reservation.status !== 'reserved' &&
                reservation.status !== 'reconciliation_pending'
            )
                failSequence(
                    'Pesanan nomor ini sudah dibatalkan atau dilepas. Simpan ulang dokumen untuk mendapat nomor baru.',
                );
            const now = nowSql();
            await this.db.execute(
                "update number_sequence_reservations set status='confirmed',confirmed_at=$1,updated_at=$1 where id=$2",
                [now, reservation.id],
            );
            await this.db.execute(
                "update number_sequence_continuous_pool set status='confirmed',updated_at=$1 where sequence_id=$2 and scope_key=$3 and period_key=$4 and numeric_value=$5 and reservation_id=$6",
                [
                    now,
                    reservation.sequence_id,
                    reservation.scope_key,
                    reservation.period_key,
                    String(reservation.numeric_value),
                    reservation.id,
                ],
            );
            await this.db.insert('number_sequence_issues', {
                id: Bun.randomUUIDv7(),
                sequence_id: reservation.sequence_id,
                app_id: reservation.app_id,
                scope_key: reservation.scope_key,
                period_key: reservation.period_key,
                numeric_value: String(reservation.numeric_value),
                formatted_value: reservation.formatted_value,
                idempotency_key: reservation.idempotency_key,
                is_manual: false,
                issued_at: now,
                created_at: now,
                updated_at: now,
            });
            await audit(
                this.db,
                reservation.sequence_id,
                reservation.app_id,
                'confirmed',
                reservation.formatted_value,
                { reservation_id: reservation.id },
            );
            return reservation.formatted_value;
        });
    }

    // Mengembalikan pesanan yang tidak jadi dipakai.
    async cancel(reservationId: string): Promise<void> {
        await this.db.transaction(async () => {
            const reservation = await this.findReservation(reservationId);
            if (reservation.status === 'cancelled') return;
            if (
                reservation.status !== 'reserved' &&
                reservation.status !== 'reconciliation_pending'
            )
                failSequence(
                    'Pesanan nomor yang sudah dipakai dokumen tidak dapat dibatalkan.',
                );
            await releaseReservation(this.db, reservation, 'cancelled');
        });
    }

    // Pratinjau nomor otomatis berikutnya untuk dokumen ini, tanpa mengambilnya. Nomor yang benar-benar diterima
    // bisa berbeda bila dokumen lain lebih dulu tersimpan.
    async next(request: Omit<NumberRequest, 'key'>): Promise<string> {
        const reference = await this.reference(request.reference);
        const sequence = await this.sequence(reference, request);
        const scope = await this.scope(sequence, request);
        return this.format(sequence, scope, await this.peek(sequence, scope));
    }

    async contextFields(
        request: Omit<NumberRequest, 'key'>,
    ): Promise<string[]> {
        const reference = await this.reference(request.reference);
        const sequence = await this.sequence(reference, request);
        return sequence.segments.flatMap((segment) =>
            segment.type === 'context' ? [segment.value] : [],
        );
    }
}
