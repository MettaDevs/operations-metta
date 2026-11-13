import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    isoSql,
    nowSql,
    sqlErrorCode,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import {
    amountInput,
    Currency,
    decimalsHint,
    localCurrencyCode,
    missingRateMessage,
    roundAmount,
} from '../../currency/index.ts';
import { Decimal } from '../../../platform/money/index.ts';
import { closeClerk, countedMethods } from './clerk.close.ts';
import { clerkOpenings, clerkSales } from './clerk.sales.ts';
import {
    clerkEndInputSchema,
    clerkLineSchema,
    type clerkOpeningMethodSchema,
    clerkRowSchema,
    clerkStartInputSchema,
} from './clerk.schema.ts';

// Pesan sistem lama (KC General_payment::cekPasienStatus), tanpa <br> HTML-nya.
export const clerkNotStartedMessage =
    'Tidak dapat melanjutkan proses, Karena User belum melakukan Start Clerk!';
// Pesan sistem lama (KK clerk_lang.php).
const wrongPasswordMessage =
    'Password Anda Salah... Proses tidak dapat dilanjutkan.';
const startedMessage = 'Proses Clerk Start sudah dilakukan';

// Kata sandi pengguna yang sedang masuk. Pengguna yang hanya masuk lewat SSO tidak punya kata sandi untuk diketik ulang.
export type PasswordCheck = {
    exists: boolean;
    confirm: (password: string) => Promise<boolean>;
};

type Scope = { tenantId: string; legalEntityId: string; userId: string };

const rowSql = `select * from (
                    select c.id, c.kode as code, c.status, c.user_id, u.name as user_name,
                           ${isoSql('c.waktu_mulai')} as started_at, ${isoSql('c.waktu_akhir')} as ended_at,
                           c.jumlah_transaksi as transactions,
                           trim_scale(c.jumlah_uang_awal)::text as opening_total,
                           trim_scale(c.jumlah_total_system)::text as system_total,
                           trim_scale(c.jumlah_total_clerk)::text as clerk_total,
                           trim_scale(c.jumlah_total_selisih)::text as difference_total, c.version
                    from clerk c join users u on u.id = c.user_id
                    where c.tenant_id = $1 and c.legal_entity_id = $2) clerks
                where true`;

// Jenis bayar yang dihitung saat Clerk End, aktif maupun tidak, berurut seperti di layar kasir. Jenis bayar tunai yang
// aktif juga diisi uang awalnya saat Clerk Start.
const countedMethodsSql = `select id, kode as code, coalesce(label_kasir, nama) as name, aktif as active,
                                  perilaku = 'tunai' as cash, coalesce(mata_uang, $3) as currency_code
                           from jenis_bayar
                           where tenant_id = $1 and legal_entity_id = $2 and dihitung_tutup_kas and deleted_at is null
                           order by urutan, kode`;
const countedMethodSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
    cash: z.boolean(),
    currency_code: z.string(),
});

const codeCharacters = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// KodeClerk sistem lama: C-ddmmYYYY- lalu lima huruf atau angka acak (gen_code('C', date('dmY'), 5)).
function clerkCode(localDate: string): string {
    const suffix = Array.from(
        { length: 5 },
        () => codeCharacters[randomInt(codeCharacters.length)],
    ).join('');
    return `C-${localDate}-${suffix}`;
}

async function checkedPassword(
    password: string | undefined,
    check: PasswordCheck,
): Promise<void> {
    if (!check.exists) return;
    if (!password) validation({ password: 'Isi kata sandi.' });
    if (!(await check.confirm(password)))
        validation({ password: wrongPasswordMessage });
}

const violates = (error: unknown, constraint: string) =>
    sqlErrorCode(error) === '23505' &&
    error instanceof Error &&
    error.message.includes(constraint);

// Clerk yang sedang berjalan milik kasir itu di legal entity itu. Pembayaran memanggilnya di dalam transaksi Simpan,
// sebelum mengunci kunjungannya, dan ditolak dengan pesan sistem lama bila kasir belum Clerk Start. Baris clerk dikunci
// bersama sampai pembayaran selesai, jadi Clerk End menunggu pembayaran yang sedang disimpan, dan pembayaran yang datang
// sesudah Clerk End mengunci clerk menunggu lalu ditolak.
export async function openClerk(
    db: Database,
    scope: Scope,
): Promise<{ id: string; code: string }> {
    if (!db.inTransaction)
        throw new Error('openClerk wajib di dalam transaksi pembayaran.');
    const found = await db.one(
        z.object({ id: z.string(), code: z.string() }),
        `select id, kode as code from clerk
         where tenant_id = $1 and legal_entity_id = $2 and user_id = $3 and status = 'start'
         for share`,
        [scope.tenantId, scope.legalEntityId, scope.userId],
    );
    if (!found) validation({ _form: clerkNotStartedMessage });
    return found;
}

export class Clerks {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dibaca sesudah izin diperiksa, supaya anggota tanpa izin mendapat 403, bukan permintaan memilih legal entity.
    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
            userId: this.workspace.userId,
        };
    }

    // Daftar Clerk sistem lama: semua sesi di legal entity aktif, terbaru dulu.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('clerk', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: {
                started_at: 'started_at',
                code: 'code',
                user_name: 'user_name',
            },
            searchColumns: ['code', 'user_name'],
            numericColumns: [],
            defaultSort: 'started_at',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => clerkRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  clerkRowSchema,
                  `${rowSql} and clerks.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async methods() {
        return this.db.rows(countedMethodSchema, countedMethodsSql, [
            this.scope.tenantId,
            this.scope.legalEntityId,
            localCurrencyCode,
        ]);
    }

    // Clerk dengan baris jenis bayarnya. Selama berjalan, barisnya jenis bayar yang akan diisi kasir tanpa angka; sesudah
    // Clerk End, baris yang tersimpan beserta jumlah sistem dan selisihnya.
    private async detail(clerk: z.infer<typeof clerkRowSchema>) {
        const currency = new Currency(this.db, this.scope.tenantId);
        const session = { tenantId: this.scope.tenantId, id: clerk.id };
        const openings = await clerkOpenings(this.db, session);
        const lines =
            clerk.status === 'start'
                ? await Promise.all(
                      countedMethods(
                          await this.methods(),
                          await clerkSales(this.db, session),
                          openings,
                      ).map(async (method) => ({
                          payment_method_id: method.id,
                          code: method.code,
                          name: method.name,
                          currency_code: method.currency_code,
                          amount_decimals: (
                              await currency.precision(method.currency_code)
                          ).amount_decimals,
                          opening_amount: openings.get(method.id) ?? '0',
                          system_amount: null,
                          counted_amount: null,
                          difference: null,
                          rate: null,
                          difference_local: null,
                      })),
                  )
                : await this.db.rows(
                      clerkLineSchema,
                      `select d.jenis_bayar_id as payment_method_id, j.kode as code,
                              coalesce(j.label_kasir, j.nama) as name, d.mata_uang as currency_code,
                              p.amount_decimals, trim_scale(d.uang_awal)::text as opening_amount,
                              trim_scale(d.jumlah_sistem)::text as system_amount,
                              trim_scale(d.jumlah_total)::text as counted_amount,
                              trim_scale(d.jumlah_selisih)::text as difference, trim_scale(d.kurs)::text as rate,
                              trim_scale(d.selisih_lokal)::text as difference_local
                       from clerk_detail d
                       join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
                       join currency_precisions p on p.tenant_id = d.tenant_id and p.currency_code = d.mata_uang
                       where d.tenant_id = $1 and d.clerk_id = $2
                       order by j.urutan, j.kode`,
                      [this.scope.tenantId, clerk.id],
                  );
        return {
            ...clerk,
            lines,
            local_currency: localCurrencyCode,
            mine: clerk.user_id === this.workspace.userId,
        };
    }

    async show(id: string) {
        this.workspace.guard('clerk', 'read');
        return { data: await this.detail(await this.row(id)) };
    }

    // Clerk yang sedang berjalan milik pengguna ini, atau null bila ia belum Clerk Start.
    async current(password: PasswordCheck) {
        this.workspace.guard('clerk', 'read');
        const found = await this.db.one(
            z.object({ id: z.string() }),
            `select id from clerk
             where tenant_id = $1 and legal_entity_id = $2 and user_id = $3 and status = 'start'`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                this.workspace.userId,
            ],
        );
        return {
            data: found ? await this.detail(await this.row(found.id)) : null,
            opening_methods: found ? [] : await this.openingMethods(),
            local_currency: localCurrencyCode,
            can_operate: this.workspace.permissions.has('core.clerk.update'),
            password_required: password.exists,
        };
    }

    // Jenis bayar tunai aktif yang dihitung saat Clerk End, dengan presisi jumlah mata uangnya.
    private async openingMethods(): Promise<
        z.infer<typeof clerkOpeningMethodSchema>[]
    > {
        const currency = new Currency(this.db, this.scope.tenantId);
        return Promise.all(
            (await this.methods())
                .filter((method) => method.active && method.cash)
                .map(async (method) => ({
                    payment_method_id: method.id,
                    code: method.code,
                    name: method.name,
                    currency_code: method.currency_code,
                    amount_decimals: (
                        await currency.precision(method.currency_code)
                    ).amount_decimals,
                })),
        );
    }

    // Uang awal yang diketik kasir, diperiksa dengan presisi jumlah mata uang jenis bayarnya. Hanya yang bukan nol
    // dikembalikan.
    private async openings(
        typed: Record<string, string | number> | undefined,
    ): Promise<{ methodId: string; currency: string; amount: string }[]> {
        const methods = new Map(
            (await this.openingMethods()).map((method) => [
                method.payment_method_id,
                method,
            ]),
        );
        const errors: Record<string, string> = {};
        const openings = [];
        for (const [methodId, raw] of Object.entries(typed ?? {})) {
            const method = methods.get(methodId);
            if (!method) {
                errors.opening =
                    'Uang awal hanya untuk jenis bayar tunai yang dihitung saat Clerk End. Muat ulang, lalu isi lagi.';
                continue;
            }
            const amount =
                String(raw).trim() === ''
                    ? '0'
                    : amountInput(raw, method.amount_decimals);
            if (amount === null)
                errors[`opening.${methodId}`] =
                    `Isi uang awal 0 atau lebih, ${decimalsHint(method.amount_decimals)}.`;
            else if (Decimal.of(amount).compare(Decimal.of('0')) !== 0)
                openings.push({
                    methodId,
                    currency: method.currency_code,
                    amount,
                });
        }
        if (Object.keys(errors).length) validation(errors);
        return openings;
    }

    async start(body: unknown, password: PasswordCheck) {
        this.workspace.guard('clerk', 'update');
        const input = clerkStartInputSchema.safeParse(body);
        if (!input.success)
            validation({ opening: 'Isi uang awal per jenis bayar tunai.' });
        await checkedPassword(input.data.password, password);
        const openings = await this.openings(input.data.opening);
        const scope = this.scope;
        const today = await this.db.one(
            z.object({ date: z.string() }),
            `select to_char(now() at time zone l.timezone, 'DDMMYYYY') as date
             from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
            [scope.tenantId, scope.legalEntityId],
        );
        if (!today) abort(404, 'Not Found');
        const id = Bun.randomUUIDv7();
        // Kode acak bisa sama walau sangat jarang; kode lain dicoba sebelum menyerah. Transaksinya diulang utuh, karena
        // PostgreSQL membatalkan seluruh transaksi yang menabrak constraint.
        for (let attempt = 0; ; attempt++) {
            const stamp = nowSql();
            try {
                await this.db.transaction(async () => {
                    await this.db.insert('clerk', {
                        id,
                        tenant_id: scope.tenantId,
                        legal_entity_id: scope.legalEntityId,
                        kode: clerkCode(today.date),
                        user_id: scope.userId,
                        status: 'start',
                        waktu_mulai: stamp,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                    for (const opening of openings)
                        await this.db.insert('clerk_uang_awal', {
                            id: Bun.randomUUIDv7(),
                            tenant_id: scope.tenantId,
                            clerk_id: id,
                            jenis_bayar_id: opening.methodId,
                            mata_uang: opening.currency,
                            jumlah: opening.amount,
                            created_at: stamp,
                            updated_at: stamp,
                        });
                });
                break;
            } catch (error) {
                if (violates(error, 'clerk_berjalan_unique'))
                    coded(409, 'clerk_already_started', startedMessage);
                if (!violates(error, 'clerk_kode_unique') || attempt === 4)
                    throw error;
            }
        }
        return {
            status: 201,
            headers: {},
            body: {
                data: await this.detail(await this.row(id)),
                message: startedMessage,
            },
        };
    }

    async end(
        request: Request,
        id: string,
        body: unknown,
        password: PasswordCheck,
    ) {
        this.workspace.guard('clerk', 'update');
        const clerk = await this.row(id);
        if (clerk.user_id !== this.workspace.userId)
            abort(403, 'Clerk ini milik kasir lain.');
        if (clerk.status !== 'start')
            coded(409, 'clerk_ended', 'Proses Clerk End sudah dilakukan');
        const parsed = clerkEndInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ counts: 'Isi jumlah fisik per jenis bayar.' });
        await checkedPassword(parsed.data.password, password);
        const scope = this.scope;
        const currency = new Currency(this.db, scope.tenantId);
        const precision = await currency.precision(localCurrencyCode);
        // Baris clerk dikunci lebih dulu, lalu penjualannya dihitung di transaksi yang sama. Simpan dan Batal pembayaran
        // mengunci baris yang sama sebelum kunjungannya, jadi pembayaran yang sedang disimpan atau dibatalkan selesai
        // dulu dan terhitung apa adanya, dan pembayaran yang datang sesudahnya mendapati clerk ini sudah Clerk End.
        await this.db.transaction(async () => {
            const locked = await this.db.one(
                z.object({ status: z.string(), version: z.number() }),
                `select status, version from clerk where tenant_id = $1 and id = $2 for update`,
                [scope.tenantId, clerk.id],
            );
            if (locked?.status !== 'start')
                coded(409, 'clerk_ended', 'Proses Clerk End sudah dilakukan');
            const session = { tenantId: scope.tenantId, id: clerk.id };
            const sales = await clerkSales(this.db, session);
            const openings = await clerkOpenings(this.db, session);
            const methods = countedMethods(
                await this.methods(),
                sales,
                openings,
            );
            const byId = new Map(methods.map((method) => [method.id, method]));
            const counts = new Map<string, string>();
            const errors: Record<string, string> = {};
            for (const [methodId, raw] of Object.entries(
                parsed.data.counts ?? {},
            )) {
                const method = byId.get(methodId);
                if (!method) {
                    errors.counts =
                        'Ada jenis bayar yang tidak dihitung saat Clerk End. Muat ulang, lalu isi lagi.';
                    continue;
                }
                // Jumlah fisik dalam mata uang jenis bayar itu, dengan presisi jumlahnya.
                const decimals = (
                    await currency.precision(method.currency_code)
                ).amount_decimals;
                const amount =
                    String(raw).trim() === ''
                        ? '0'
                        : amountInput(raw, decimals);
                if (amount === null)
                    errors[`counts.${methodId}`] =
                        `Isi jumlah 0 atau lebih, ${decimalsHint(decimals)}.`;
                else counts.set(methodId, amount);
            }
            // Kurs hari Clerk End untuk menilai selisih mata uang asing; kurs yang belum diisi ditolak di isiannya.
            const today = await this.db.one(
                z.object({ date: z.string() }),
                `select (now() at time zone l.timezone)::date::text as date
                 from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
                [scope.tenantId, scope.legalEntityId],
            );
            const date = today?.date ?? nowSql().slice(0, 10);
            const rates = new Map<string, Decimal>();
            for (const method of methods) {
                const rate = await currency.findRate(
                    method.currency_code,
                    date,
                );
                if (rate) rates.set(method.id, rate);
                else
                    errors[`counts.${method.id}`] = missingRateMessage(
                        method.currency_code,
                        date,
                    );
            }
            if (Object.keys(errors).length) validation(errors);
            if (locked.version !== expectedVersion(request, body))
                coded(409, 'stale_version', staleMessage);
            const closed = closeClerk(
                methods,
                sales,
                openings,
                counts,
                rates,
                (value) => roundAmount(value, precision),
            );
            const stamp = nowSql();
            await this.db.execute(
                `update clerk set status = 'end', waktu_akhir = $1, jumlah_transaksi = $2, jumlah_uang_awal = $3,
                                  jumlah_total_system = $4, jumlah_total_clerk = $5, jumlah_total_selisih = $6,
                                  updated_at = $1
                 where tenant_id = $7 and id = $8`,
                [
                    stamp,
                    closed.transactions,
                    closed.openingTotal,
                    closed.systemTotal,
                    closed.clerkTotal,
                    closed.differenceTotal,
                    scope.tenantId,
                    clerk.id,
                ],
            );
            for (const line of closed.lines)
                await this.db.insert('clerk_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: scope.tenantId,
                    clerk_id: clerk.id,
                    jenis_bayar_id: line.paymentMethodId,
                    mata_uang:
                        byId.get(line.paymentMethodId)?.currency_code ??
                        localCurrencyCode,
                    uang_awal: line.opening,
                    jumlah_sistem: line.system,
                    jumlah_sistem_lokal: line.systemLocal,
                    jumlah_total: line.counted,
                    kurs: line.rate,
                    selisih_lokal: line.differenceLocal,
                    created_at: stamp,
                    updated_at: stamp,
                });
        });
        return {
            data: await this.detail(await this.row(id)),
            message: 'Proses Clerk End sudah dilakukan',
        };
    }
}
