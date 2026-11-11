import { statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type postgres from 'postgres';
import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import type { MigrationSource } from '../migration/index.ts';
import { reservedLabels } from './address.ts';
import { migrateEnvironment } from './migrate.service.ts';
import {
    assertEnvironmentDatabase,
    connect,
    createDatabase,
} from './provision.service.ts';
import { recordRoute } from './route.service.ts';

const databaseName = z
    .string()
    .regex(
        /^[a-z][a-z0-9_]{0,62}$/,
        'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
    );

export const copyRequestSchema = z
    .strictObject({
        tenant_id: z.uuid(),
        tenant_slug: z
            .string()
            .regex(
                /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
                'Slug harus label DNS.',
            )
            .refine(
                (slug) => !reservedLabels.has(slug),
                'Slug ini dipakai layanan lain.',
            ),
        name: z.string().trim().min(1).max(100),
        source_database: databaseName,
        database: databaseName,
    })
    .refine((request) => request.source_database !== request.database, {
        message: 'Database salinan tidak boleh sama dengan database produksi.',
        path: ['database'],
    });
export type CopyRequest = z.infer<typeof copyRequestSchema>;

export type CopyStep =
    | 'create-database'
    | 'copy'
    | 'disarm'
    | 'migrate'
    | 'check-health'
    | 'record-route';

// Dump berformat custom terkompresi biasanya jauh lebih kecil dari databasenya; batas ini menutup data yang tidak dapat
// dimampatkan beserta sedikit sisa, karena disk yang penuh di tengah dump menghasilkan berkas terpotong.
const diskMargin = 1.2;
// Selama pg_dump dan pg_restore berjalan, langkah `copy` dilaporkan ulang sesering ini supaya tenggat operasi tidak habis
// pada database besar, dan supaya penyalinan berhenti bila operasinya tidak lagi dipegang worker ini.
const leaseRenewalMs = 60_000;
const pendingReservations = ['reserved', 'reconciliation_pending'];

// Menjalankan pg_dump atau pg_restore sebagai klien lewat jaringan. Kata sandi lewat lingkungan proses, bukan argumen.
// Bila onTick melempar (operasinya hilang), prosesnya dihentikan dan galatnya diteruskan.
async function runClient(
    settings: DatabaseSettings,
    command: string[],
    onTick: () => Promise<void>,
): Promise<void> {
    const process = Bun.spawn(command, {
        env: { ...Bun.env, PGPASSWORD: settings.DB_PASSWORD },
        stdout: 'ignore',
        stderr: 'pipe',
    });
    const stderr = new Response(process.stderr).text();
    try {
        for (;;) {
            const finished = await Promise.race([
                process.exited.then(() => true),
                Bun.sleep(leaseRenewalMs).then(() => false),
            ]);
            if (finished) break;
            await onTick();
        }
    } catch (error) {
        process.kill();
        throw error;
    }
    if (process.exitCode !== 0)
        throw new Error(
            `${command[0] ?? 'client'} exited with ${String(process.exitCode)}: ${(await stderr).trim().slice(0, 2000)}`,
        );
}

const connection = (settings: DatabaseSettings) => [
    `--host=${settings.DB_HOST}`,
    `--port=${String(settings.DB_PORT)}`,
    `--username=${settings.DB_USERNAME}`,
    '--no-password',
    '--no-owner',
    '--no-privileges',
];

// Database salinan yang sudah berisi berarti penyalinan sebelumnya selesai sebelum prosesnya mati, jadi tidak disalin
// lagi; pg_restore --single-transaction menjamin isinya utuh atau kosong sama sekali.
async function alreadyCopied(target: postgres.Sql): Promise<boolean> {
    const [row] = z
        .array(z.object({ present: z.boolean() }))
        .parse(
            await target.unsafe(
                "select to_regclass('public.schema_migrations') is not null as present",
            ),
        );
    return row?.present ?? false;
}

async function assertDiskRoom(
    runtime: postgres.Sql,
    sourceDatabase: string,
    directory: string,
): Promise<void> {
    const [size] = z
        .array(z.object({ bytes: z.coerce.number() }))
        .parse(
            await runtime.unsafe('select pg_database_size($1) as bytes', [
                sourceDatabase,
            ]),
        );
    const free = await statfs(directory);
    const available = free.bavail * free.bsize;
    if (size && size.bytes * diskMargin > available)
        throw new Error(
            `Not enough disk in ${directory} for the dump: database ${sourceDatabase} is ${String(size.bytes)} bytes, ${String(available)} bytes free.`,
        );
}

// Efek keluar yang ikut tersalin dari produksi dibuang atau dimatikan dalam satu transaksi, persis seperti CoreERP:
// event yang belum terbit ditandai terbit tanpa dikirim, ekspor laporan yang antre digagalkan, reservasi nomor yang
// menggantung dilepas, job dan kredensial layanan dibuang, sesi login dan cache produksi dibuang, dan registri lama
// di dalam salinan diturunkan menjadi sandbox tanpa sambungan keluar. Tabel-tabel ini datang dari skema CoreERP;
// sebagian belum punya penulis di repo ini, tetapi database yang diadopsi dari CoreERP bisa membawa isinya.
async function disarm(target: postgres.Sql): Promise<void> {
    await target.begin(async (transaction) => {
        await transaction.unsafe(
            "update outbox_events set published_at = now() at time zone 'utc', updated_at = now() at time zone 'utc' where published_at is null",
        );
        await transaction.unsafe(
            "update report_exports set status = 'failed', failure_message = 'Dibatalkan karena lingkungan ini salinan produksi.', finished_at = now() at time zone 'utc', updated_at = now() at time zone 'utc' where status in ('queued', 'running')",
        );
        await transaction.unsafe(
            "update number_sequence_continuous_pool set status = 'available', reservation_id = null, updated_at = now() at time zone 'utc' where reservation_id in (select id from number_sequence_reservations where status = any($1))",
            [pendingReservations],
        );
        await transaction.unsafe(
            "update number_sequence_reservations set status = 'cancelled', cancelled_at = now() at time zone 'utc', updated_at = now() at time zone 'utc' where status = any($1)",
            [pendingReservations],
        );
        await transaction.unsafe('delete from jobs');
        await transaction.unsafe('delete from app_service_credentials');
        await transaction.unsafe('delete from sessions');
        await transaction.unsafe('delete from cache');
        await transaction.unsafe(
            'drop index if exists environments_satu_per_jenis',
        );
        await transaction.unsafe(
            'alter table environments drop constraint if exists environments_server_klien_hanya_produksi',
        );
        await transaction.unsafe(
            "update environments set kind = 'sandbox', outbound_allowed = false, updated_at = now() at time zone 'utc' where kind <> 'sandbox' or outbound_allowed",
        );
    });
}

// Sesudah migration, bukan sesudah pelucutan, karena migration di sela keduanya boleh menyisipkan baris baru.
async function checkHealth(
    target: postgres.Sql,
    expectedModules: number,
): Promise<void> {
    const [remaining] = z.array(z.record(z.string(), z.coerce.number())).parse(
        await target.unsafe(
            `select
                    (select count(*) from outbox_events where published_at is null) as "event yang belum terbit",
                    (select count(*) from report_exports where status in ('queued', 'running')) as "ekspor laporan yang antre",
                    (select count(*) from number_sequence_reservations where status = any($1)) as "reservasi nomor yang menggantung",
                    (select count(*) from jobs) as "job antrean",
                    (select count(*) from app_service_credentials) as "kredensial layanan",
                    (select count(*) from sessions) as "sesi login",
                    (select count(*) from environments where outbound_allowed) as "registri yang masih boleh menghubungi luar"`,
            [pendingReservations],
        ),
    );
    for (const [what, count] of Object.entries(remaining ?? {}))
        if (count > 0)
            throw new Error(
                `The copy still holds ${String(count)} ${what} after disarming; the sandbox is not activated.`,
            );
    const [installed] = z
        .array(z.object({ count: z.coerce.number() }))
        .parse(
            await target.unsafe(
                'select count(*) as count from core_module_installations',
            ),
        );
    if (installed?.count !== expectedModules)
        throw new Error(
            `The restored snapshot had ${String(expectedModules)} module installations, the copy now has ${String(installed?.count)}.`,
        );
}

// Menyalin produksi menjadi sandbox: buat database, salin satu snapshot produksi tanpa menghentikannya, lucuti efek
// keluar, migrasi ke skema kode ini, periksa, lalu catat alamatnya terakhir supaya alamat tidak pernah menunjuk salinan
// yang belum dilucuti. Setiap langkah aman diulang. Dump ditulis ke berkas, bukan dialirkan lewat pipe yang
// menyembunyikan exit code pg_dump, dan berkasnya selalu dihapus karena isinya data produksi.
export async function copyEnvironment(
    settings: DatabaseSettings,
    source: MigrationSource,
    request: CopyRequest,
    onStep: (step: CopyStep) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
    assertEnvironmentDatabase(settings, request.source_database);
    assertEnvironmentDatabase(settings, request.database);
    await onStep('create-database');
    await createDatabase(settings, request.database);

    const runtime = connect(settings, settings.DB_DATABASE);
    const target = connect(settings, request.database);
    try {
        if (!(await alreadyCopied(target))) {
            await onStep('copy');
            const directory = tmpdir();
            await assertDiskRoom(runtime, request.source_database, directory);
            const file = join(
                directory,
                `copy-${request.database}-${Bun.randomUUIDv7()}.dump`,
            );
            const tick = () => onStep('copy');
            try {
                await runClient(
                    settings,
                    [
                        'pg_dump',
                        ...connection(settings),
                        '--format=custom',
                        `--file=${file}`,
                        `--dbname=${request.source_database}`,
                    ],
                    tick,
                );
                await runClient(
                    settings,
                    [
                        'pg_restore',
                        ...connection(settings),
                        '--single-transaction',
                        `--dbname=${request.database}`,
                        file,
                    ],
                    tick,
                );
            } finally {
                await Bun.file(file)
                    .delete()
                    .catch(() => undefined);
            }
        }
        const [modules] = z
            .array(z.object({ count: z.coerce.number() }))
            .parse(
                await target.unsafe(
                    'select count(*) as count from core_module_installations',
                ),
            );
        await onStep('disarm');
        await disarm(target);
        await migrateEnvironment(
            settings,
            source,
            { database: request.database },
            () => onStep('migrate'),
        );
        await onStep('check-health');
        await checkHealth(target, modules?.count ?? 0);
        await onStep('record-route');
        await recordRoute(runtime, {
            tenant_slug: request.tenant_slug,
            kind: 'sandbox',
            tenant_id: request.tenant_id,
            name: request.name,
            database_name: request.database,
        });
    } finally {
        await target.end();
        await runtime.end();
    }
}
