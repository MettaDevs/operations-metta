import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { environmentHost } from '../../src/platform/environment/index.ts';
import { buildClient } from '../build.ts';
import { browserArguments, findBrowser } from './browser.ts';

// Satu run verifikasi: PostgreSQL sekali pakai di container sendiri, server dari worktree ini di port sendiri, dan
// Chrome headless dengan profil sendiri. Semua keadaannya ditulis di <VERIFY_HOME>/<run>/run.json, dan bukti di
// <VERIFY_HOME>/<run>/evidence/, di luar repo, supaya bertahan setelah teardown maupun worktree dihapus.

export const root = resolve(import.meta.dir, '..', '..');
export const verifyHome =
    process.env.VERIFY_HOME ?? join(tmpdir(), 'operations-metta-verify');

const tenantSchema = z.object({
    slug: z.string(),
    name: z.string(),
    admin: z.object({ email: z.string(), password: z.string() }),
    environments: z.array(
        z.object({ kind: z.enum(['production', 'sandbox', 'demo']) }),
    ),
    sample: z
        .object({
            staff: z.array(
                z.object({ email: z.string(), password: z.string() }),
            ),
        })
        .optional(),
});

// Lingkungan produksi tenant pertama di dev/tenants.json adalah sasaran verifikasi.
export function sampleTenant(): z.infer<typeof tenantSchema> {
    const [tenant] = z
        .array(tenantSchema)
        .parse(
            JSON.parse(readFileSync(join(root, 'dev', 'tenants.json'), 'utf8')),
        );
    if (!tenant) throw new Error('dev/tenants.json kosong.');
    return tenant;
}

// Kata sandi tidak pernah dicetak: dibaca dari seed project saat login saja.
export function passwordFor(email: string): string {
    const tenant = sampleTenant();
    if (tenant.admin.email === email) return tenant.admin.password;
    const staff = tenant.sample?.staff.find((person) => person.email === email);
    if (!staff) throw new Error(`${email} tidak ada di dev/tenants.json.`);
    return staff.password;
}

const runSchema = z.object({
    runId: z.string(),
    worktree: z.string(),
    commit: z.string(),
    dir: z.string(),
    container: z.string(),
    dbPort: z.number(),
    // Gotenberg milik run ini, pembuat PDF dokumen cetak. 0 pada run lama yang belum menyalakannya.
    rendererPort: z.number().default(0),
    appPort: z.number(),
    cdpPort: z.number(),
    appKey: z.string(),
    database: z.string(),
    host: z.string(),
    url: z.string(),
    serverPid: z.number().optional(),
    browserPid: z.number().optional(),
    startedAt: z.string(),
    stoppedAt: z.string().optional(),
});

export type Run = z.infer<typeof runSchema>;

const dbUser = 'verify';
const dbPassword = 'verify-only-not-a-secret';

function pointerFile(): string {
    const key = createHash('sha1')
        .update(root.toLowerCase())
        .digest('hex')
        .slice(0, 12);
    return join(verifyHome, `latest-${key}.txt`);
}

export function evidenceDir(run: Run): string {
    return join(run.dir, 'evidence');
}

export function saveRun(run: Run): void {
    writeFileSync(join(run.dir, 'run.json'), JSON.stringify(run, null, 4));
}

// Run yang dipakai perintah: VERIFY_RUN bila diisi, kalau tidak run terakhir yang dinyalakan dari worktree ini.
export function currentRun(): Run {
    const runId =
        process.env.VERIFY_RUN ??
        (existsSync(pointerFile())
            ? readFileSync(pointerFile(), 'utf8').trim()
            : '');
    if (!runId)
        throw new Error(
            'Belum ada run dari worktree ini. Jalankan `bun scripts/verify.ts up`.',
        );
    const file = join(verifyHome, runId, 'run.json');
    if (!existsSync(file))
        throw new Error(`Run ${runId} tidak ditemukan di ${verifyHome}.`);
    return runSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

function exec(
    command: string[],
    options: { env?: Record<string, string>; quiet?: boolean } = {},
): string {
    const result = Bun.spawnSync(command, {
        cwd: root,
        env: { ...process.env, ...options.env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const out = result.stdout.toString();
    if (result.exitCode !== 0)
        throw new Error(
            `${command.join(' ')} gagal (${result.exitCode}):\n${result.stderr.toString()}${out}`,
        );
    if (!options.quiet && out.trim()) console.log(out.trim());
    return out;
}

function freePort(): number {
    const server = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data: () => undefined },
    });
    const port = server.port;
    server.stop(true);
    return port;
}

export function runEnv(run: Run): Record<string, string> {
    return {
        DB_HOST: '127.0.0.1',
        DB_PORT: String(run.dbPort),
        DB_DATABASE: run.database,
        DB_USERNAME: dbUser,
        DB_PASSWORD: dbPassword,
        DB_POOL_SIZE: '3',
        APP_KEY: run.appKey,
        BASE_DOMAIN: 'localhost',
        HOST: '127.0.0.1',
        PORT: String(run.appPort),
        SESSION_BACKEND: 'database',
        CLIENT_DIR: join(run.dir, 'client'),
        ...(run.rendererPort
            ? { RENDERER_URL: `http://127.0.0.1:${run.rendererPort}` }
            : {}),
    };
}

export const rendererImage = 'gotenberg/gotenberg:9.10.0-libreoffice';
const rendererContainer = (run: Run) => `${run.container}-renderer`;

export function isAlive(pid: number | undefined): boolean {
    if (pid === undefined) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function killTree(pid: number | undefined): void {
    if (!isAlive(pid) || pid === undefined) return;
    if (process.platform === 'win32')
        Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(pid)], {
            stdout: 'ignore',
            stderr: 'ignore',
        });
    else
        try {
            process.kill(-pid, 'SIGTERM');
        } catch {
            process.kill(pid, 'SIGTERM');
        }
}

// GET /api/v1/shell tanpa sesi: 401 JSON berarti server ini melayani alamat tenant itu. Alamat yang tidak tercatat
// dijawab 404, dan port milik proses lain tidak menjawab dengan cara itu.
export async function shellAnswers(run: Run): Promise<boolean> {
    try {
        const response = await fetch(
            `http://127.0.0.1:${run.appPort}/api/v1/shell`,
            {
                headers: {
                    host: `${run.host}:${run.appPort}`,
                    accept: 'application/json',
                },
            },
        );
        return response.status === 401;
    } catch {
        return false;
    }
}

export async function cdpAnswers(run: Run): Promise<boolean> {
    try {
        return (await fetch(`http://127.0.0.1:${run.cdpPort}/json/version`)).ok;
    } catch {
        return false;
    }
}

export function containerRunning(run: Run): boolean {
    const result = Bun.spawnSync(
        ['docker', 'inspect', '-f', '{{.State.Running}}', run.container],
        {
            stdout: 'pipe',
            stderr: 'ignore',
        },
    );
    return result.stdout.toString().trim() === 'true';
}

export function environmentDatabase(run: Run): string {
    return psql(
        run,
        run.database,
        `select database_name from environment_routes where tenant_slug = '${sampleTenant().slug}' and kind = 'production'`,
        ['-tA'],
    ).trim();
}

export function psql(
    run: Run,
    database: string,
    query: string,
    flags: string[] = [],
): string {
    return exec(
        [
            'docker',
            'exec',
            '-i',
            run.container,
            'psql',
            '-U',
            dbUser,
            '-d',
            database,
            '-v',
            'ON_ERROR_STOP=1',
            ...flags,
            '-c',
            query,
        ],
        { quiet: true },
    );
}

export async function up(): Promise<Run> {
    const existing = existsSync(pointerFile())
        ? readFileSync(pointerFile(), 'utf8').trim()
        : '';
    if (existing) {
        const previous = join(verifyHome, existing, 'run.json');
        if (existsSync(previous)) {
            const old = runSchema.parse(
                JSON.parse(readFileSync(previous, 'utf8')),
            );
            if (!old.stoppedAt)
                throw new Error(
                    `Run ${old.runId} dari worktree ini masih menyala. Jalankan \`bun scripts/verify.ts down\` dulu.`,
                );
        }
    }
    const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = join(verifyHome, runId);
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    const tenant = sampleTenant();
    const host = environmentHost(tenant.slug, 'production', 'localhost');
    const appPort = freePort();
    const state: Run = {
        runId,
        worktree: root,
        commit: exec(['git', 'rev-parse', 'HEAD'], { quiet: true }).trim(),
        dir,
        container: `ops-verify-${runId}`,
        dbPort: 0,
        rendererPort: 0,
        appPort,
        cdpPort: freePort(),
        appKey: `base64:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`,
        database: 'operations_verify',
        host,
        url: `http://${host}:${appPort}`,
        startedAt: new Date().toISOString(),
    };
    saveRun(state);
    writeFileSync(pointerFile(), runId);
    try {
        exec(
            [
                'docker',
                'run',
                '-d',
                '--name',
                state.container,
                '--label',
                'operations-metta-verify=1',
                '-e',
                `POSTGRES_USER=${dbUser}`,
                '-e',
                `POSTGRES_PASSWORD=${dbPassword}`,
                '-e',
                'POSTGRES_DB=postgres',
                '-p',
                '127.0.0.1::5432',
                'postgres:17',
            ],
            { quiet: true },
        );
        // Gotenberg menyala bersamaan dengan PostgreSQL; start dingin LibreOffice terjadi saat container mulai
        // (--libreoffice-auto-start), bukan pada klik cetak pertama.
        exec(
            [
                'docker',
                'run',
                '-d',
                '--name',
                rendererContainer(state),
                '--label',
                'operations-metta-verify=1',
                '-p',
                '127.0.0.1::3000',
                rendererImage,
                'gotenberg',
                '--libreoffice-auto-start=true',
                '--libreoffice-max-queue-size=10',
                '--libreoffice-max-memory=768MB',
                '--pdf-disable-routes=true',
                '--webhook-disable=true',
                '--api-disable-download-from=true',
                '--api-timeout=35s',
            ],
            { quiet: true },
        );
        state.rendererPort = Number(
            /:(\d+)\s*$/m.exec(
                exec(['docker', 'port', rendererContainer(state), '3000/tcp'], {
                    quiet: true,
                }),
            )?.[1] ?? 0,
        );
        const mapping = exec(['docker', 'port', state.container, '5432/tcp'], {
            quiet: true,
        });
        state.dbPort = Number(/:(\d+)\s*$/m.exec(mapping)?.[1] ?? 0);
        saveRun(state);
        // Lewat TCP, bukan socket: server sementara milik skrip init image hanya mendengar socket, jadi pg_isready
        // lewat TCP baru lulus saat server yang sebenarnya sudah menerima koneksi.
        for (let attempt = 0; ; attempt += 1) {
            const ready = Bun.spawnSync([
                'docker',
                'exec',
                state.container,
                'pg_isready',
                '-q',
                '-h',
                '127.0.0.1',
                '-U',
                dbUser,
            ]);
            if (ready.exitCode === 0) break;
            if (attempt > 60)
                throw new Error('PostgreSQL tidak siap dalam 60 detik.');
            await Bun.sleep(1000);
        }
        console.log(
            `[verify] PostgreSQL ${state.container} di 127.0.0.1:${state.dbPort}`,
        );
        const env = runEnv(state);
        console.log(
            '[verify] bun run dev:setup (migration + data contoh, sekitar 2-3 menit)',
        );
        exec(['bun', '--no-env-file', 'scripts/dev-setup.ts'], {
            env,
            quiet: true,
        });
        exec(['bun', '--no-env-file', 'scripts/generate-client.ts'], {
            env,
            quiet: true,
        });
        await buildClient(env.CLIENT_DIR ?? join(dir, 'client'));
        console.log('[verify] build peramban selesai');
        const server = Bun.spawn(['bun', '--no-env-file', 'src/main.ts'], {
            cwd: root,
            env: { ...process.env, ...env },
            stdio: [
                'ignore',
                Bun.file(join(dir, 'evidence', 'server.log')),
                Bun.file(join(dir, 'evidence', 'server.err.log')),
            ],
            detached: true,
        });
        server.unref();
        state.serverPid = server.pid;
        const browser = Bun.spawn(
            [
                findBrowser(),
                ...browserArguments(
                    state.cdpPort,
                    join(dir, 'browser-profile'),
                ),
            ],
            {
                stdio: ['ignore', 'ignore', 'ignore'],
                detached: true,
            },
        );
        browser.unref();
        state.browserPid = browser.pid;
        saveRun(state);
        for (
            let attempt = 0;
            !(await shellAnswers(state)) || !(await cdpAnswers(state));
            attempt += 1
        ) {
            if (attempt > 60)
                throw new Error(
                    `Server atau peramban tidak siap dalam 30 detik. Lihat ${join(dir, 'evidence', 'server.err.log')}.`,
                );
            await Bun.sleep(500);
        }
        return state;
    } catch (error) {
        down(state);
        throw error;
    }
}

// Mematikan hanya yang dinyalakan run ini: proses server dan peramban dari PID-nya, container dari namanya.
// Bukti dan log di evidence/ tidak disentuh.
export function down(state: Run): void {
    killTree(state.serverPid);
    killTree(state.browserPid);
    Bun.spawnSync(
        ['docker', 'rm', '-f', '-v', state.container, rendererContainer(state)],
        {
            stdout: 'ignore',
            stderr: 'ignore',
        },
    );
    rmSync(join(state.dir, 'browser-profile'), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
    });
    rmSync(join(state.dir, 'client'), { recursive: true, force: true });
    state.stoppedAt = new Date().toISOString();
    saveRun(state);
}
