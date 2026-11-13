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
import { decimalText } from '../billing.service.ts';
import { closeClerk, countedMethods } from './clerk.close.ts';
import { clerkSales } from './clerk.sales.ts';
import {
    clerkEndInputSchema,
    clerkLineSchema,
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
                           c.jumlah_transaksi as transactions, trim_scale(c.jumlah_total_system)::text as system_total,
                           trim_scale(c.jumlah_total_clerk)::text as clerk_total,
                           trim_scale(c.jumlah_total_selisih)::text as difference_total, c.version
                    from clerk c join users u on u.id = c.user_id
                    where c.tenant_id = $1 and c.legal_entity_id = $2) clerks
                where true`;

// Jenis bayar yang dihitung saat Clerk End, aktif maupun tidak, berurut seperti di layar kasir.
const countedMethodsSql = `select id, kode as code, coalesce(label_kasir, nama) as name, aktif as active
                           from jenis_bayar
                           where tenant_id = $1 and legal_entity_id = $2 and dihitung_tutup_kas and deleted_at is null
                           order by urutan, kode`;
const countedMethodSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
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

// Clerk yang sedang berjalan milik kasir itu di legal entity itu. Pembayaran memanggilnya sebelum menyimpan, dan
// ditolak dengan pesan sistem lama bila kasir belum Clerk Start.
export async function openClerk(
    db: Database,
    scope: Scope,
): Promise<{ id: string; code: string }> {
    const found = await db.one(
        z.object({ id: z.string(), code: z.string() }),
        `select id, kode as code from clerk
         where tenant_id = $1 and legal_entity_id = $2 and user_id = $3 and status = 'start'`,
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
        ]);
    }

    // Clerk dengan baris jenis bayarnya. Selama berjalan, barisnya jenis bayar yang akan diisi kasir tanpa angka; sesudah
    // Clerk End, baris yang tersimpan beserta jumlah sistem dan selisihnya.
    private async detail(clerk: z.infer<typeof clerkRowSchema>) {
        const lines =
            clerk.status === 'start'
                ? countedMethods(await this.methods(), clerkSales()).map(
                      (method) => ({
                          payment_method_id: method.id,
                          code: method.code,
                          name: method.name,
                          system_amount: null,
                          counted_amount: null,
                          difference: null,
                      }),
                  )
                : await this.db.rows(
                      clerkLineSchema,
                      `select d.jenis_bayar_id as payment_method_id, j.kode as code,
                              coalesce(j.label_kasir, j.nama) as name,
                              trim_scale(d.jumlah_sistem)::text as system_amount,
                              trim_scale(d.jumlah_total)::text as counted_amount,
                              trim_scale(d.jumlah_selisih)::text as difference
                       from clerk_detail d join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
                       where d.tenant_id = $1 and d.clerk_id = $2
                       order by j.urutan, j.kode`,
                      [this.scope.tenantId, clerk.id],
                  );
        return {
            ...clerk,
            lines,
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
            can_operate: this.workspace.permissions.has('core.clerk.update'),
            password_required: password.exists,
        };
    }

    async start(body: unknown, password: PasswordCheck) {
        this.workspace.guard('clerk', 'update');
        const input = clerkStartInputSchema.safeParse(body);
        await checkedPassword(input.data?.password, password);
        const scope = this.scope;
        const today = await this.db.one(
            z.object({ date: z.string() }),
            `select to_char(now() at time zone l.timezone, 'DDMMYYYY') as date
             from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
            [scope.tenantId, scope.legalEntityId],
        );
        if (!today) abort(404, 'Not Found');
        const id = Bun.randomUUIDv7();
        // Kode acak bisa sama walau sangat jarang; kode lain dicoba sebelum menyerah.
        for (let attempt = 0; ; attempt++) {
            const stamp = nowSql();
            try {
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
        const sales = clerkSales();
        const methods = countedMethods(await this.methods(), sales);
        const allowed = new Set(methods.map((method) => method.id));
        const counts = new Map<string, string>();
        const errors: Record<string, string> = {};
        for (const [methodId, raw] of Object.entries(
            parsed.data.counts ?? {},
        )) {
            if (!allowed.has(methodId)) {
                errors.counts =
                    'Ada jenis bayar yang tidak dihitung saat Clerk End. Muat ulang, lalu isi lagi.';
                continue;
            }
            const amount =
                String(raw).trim() === ''
                    ? '0.00'
                    : decimalText(raw, 2, '0', '9999999999999999');
            if (amount === null)
                errors[`counts.${methodId}`] =
                    'Isi jumlah 0 atau lebih, paling banyak dua angka di belakang koma.';
            else counts.set(methodId, amount);
        }
        if (Object.keys(errors).length) validation(errors);
        const closed = closeClerk(methods, sales, counts);
        await this.db.transaction(async () => {
            const stamp = nowSql();
            const updated = await this.db.execute(
                `update clerk set status = 'end', waktu_akhir = $1, jumlah_transaksi = $2, jumlah_total_system = $3,
                                  jumlah_total_clerk = $4, jumlah_total_selisih = $5, updated_at = $1
                 where tenant_id = $6 and id = $7 and status = 'start' and version = $8`,
                [
                    stamp,
                    closed.transactions,
                    closed.systemTotal,
                    closed.clerkTotal,
                    closed.differenceTotal,
                    this.scope.tenantId,
                    clerk.id,
                    expectedVersion(request, body),
                ],
            );
            if (!updated) coded(409, 'stale_version', staleMessage);
            for (const line of closed.lines)
                await this.db.insert('clerk_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    clerk_id: clerk.id,
                    jenis_bayar_id: line.paymentMethodId,
                    jumlah_sistem: line.system,
                    jumlah_total: line.counted,
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
