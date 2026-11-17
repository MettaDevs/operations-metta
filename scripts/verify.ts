import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
    alertClip,
    ariaSnapshot,
    click,
    connectPage,
    fill,
    find,
    isKeyName,
    keyNames,
    navigate,
    pageText,
    press,
    roles,
    screenshot,
    waitFor,
    waitGone,
    type Locator,
    type Page,
} from './verify/browser.ts';
import { runOutpatientJourney } from './verify/outpatient.ts';
import { runPrintJourney } from './verify/print.ts';
import {
    cdpAnswers,
    containerRunning,
    currentRun,
    down,
    environmentDatabase,
    evidenceDir,
    isAlive,
    passwordFor,
    psql,
    root,
    sampleTenant,
    shellAnswers,
    up,
    type Run,
} from './verify/stack.ts';

// `bun scripts/verify.ts <perintah>`: menyalakan, memeriksa, menggerakkan, dan mematikan satu run verifikasi.
// Cara pakainya di .agents/skills/verify-operations-metta/SKILL.md.

const usage = `bun scripts/verify.ts <perintah>
  up                                  nyalakan DB, server, dan peramban milik run baru
  doctor                              periksa run saat ini layak digerakkan
  login [email]                       masuk lewat layar login (bawaan: admin tenant contoh)
  go <path>                           buka URL layar tanpa / di depan, mis. healthcare/registration/visits/new
  click <role> <nama> [--within T] [--nth N] [--exact|--prefix]
  fill <role> <nama> <nilai> [--within T] [--nth N] [--exact|--prefix]
  fill-password <role> <nama> [email] isi kata sandi dari dev/tenants.json tanpa mencetaknya (bawaan: admin)
  press <${keyNames.join('|')}>
  wait <role> <nama> [--gone] [--timeout ms] [--within T]
  find <role> <nama> [--within T]     cetak elemen yang cocok tanpa mengkliknya
  text                                cetak teks halaman
  snapshot <nama>                     simpan pohon aksesibilitas ke evidence/<nama>.aria.txt
  shot <nama> [--alert]               simpan screenshot ke evidence/<nama>.png; --alert hanya ringkasan error
  sql <query> [--save nama]           jalankan SQL di database lingkungan tenant contoh
  journey outpatient [--prepare-cashier]
                                      perjalanan rawat jalan penuh, daftar sampai bayar; --prepare-cashier membuat
                                      jenis bayar tunai dan Clerk Start lewat layar Kasir bila belum ada
  journey print                       sesudah journey outpatient: cetak kuitansi dan etiket, unggah layout kuitansi
                                      lalu cetak lagi, kembali ke bawaan; PDF disimpan di evidence/
  down                                matikan semua yang dinyalakan run ini, bukti tetap ada
role: ${roles.join(', ')}`;

const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
        within: { type: 'string' },
        nth: { type: 'string' },
        exact: { type: 'boolean' },
        prefix: { type: 'boolean' },
        gone: { type: 'boolean' },
        alert: { type: 'boolean' },
        timeout: { type: 'string' },
        save: { type: 'string' },
        'prepare-cashier': { type: 'boolean' },
    },
});
const [command = '', ...rest] = positionals;

function locator(role: string | undefined, name: string | undefined): Locator {
    const known = roles.find((item) => item === role);
    if (!known || name === undefined) throw new Error(usage);
    return {
        role: known,
        name,
        within: values.within,
        nth: values.nth ? Number(values.nth) : undefined,
        exact: values.exact,
        prefix: values.prefix,
    };
}

async function withPage<T>(
    run: Run,
    action: (page: Page) => Promise<T>,
): Promise<T> {
    const page = await connectPage(run.cdpPort);
    try {
        return await action(page);
    } finally {
        page.close();
    }
}

export async function login(
    page: Page,
    run: Run,
    email: string,
): Promise<void> {
    await navigate(page, `${run.url}/login`);
    await fill(page, { role: 'textbox', name: 'Email' }, email);
    await fill(
        page,
        { role: 'textbox', name: 'Kata sandi' },
        passwordFor(email),
    );
    await click(page, { role: 'button', name: 'Masuk', exact: true });
    await waitGone(page, { role: 'button', name: 'Masuk', exact: true });
}

async function doctor(run: Run): Promise<boolean> {
    const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root })
        .stdout.toString()
        .trim();
    const checks: [string, boolean][] = [
        [`run ${run.runId} belum dimatikan`, !run.stoppedAt],
        [
            `worktree run sama dengan worktree ini (${run.worktree})`,
            run.worktree === root,
        ],
        [
            `commit sama dengan HEAD (${run.commit.slice(0, 8)})`,
            run.commit === head,
        ],
        [`container ${run.container} berjalan`, containerRunning(run)],
        [`server PID ${run.serverPid ?? '-'} hidup`, isAlive(run.serverPid)],
        [
            `${run.url}/api/v1/shell menjawab 401 untuk alamat tenant`,
            await shellAnswers(run),
        ],
        [
            `peramban PID ${run.browserPid ?? '-'} menjawab CDP di port ${run.cdpPort}`,
            await cdpAnswers(run),
        ],
    ];
    for (const [label, ok] of checks)
        console.log(`${ok ? 'OK  ' : 'GAGAL'} ${label}`);
    console.log(`evidence: ${evidenceDir(run)}`);
    return checks.every(([, ok]) => ok);
}

try {
    switch (command) {
        case 'up': {
            const run = await up();
            console.log(`[verify] run ${run.runId}`);
            console.log(`[verify] evidence: ${evidenceDir(run)}`);
            console.log(`READY ${run.url}`);
            break;
        }
        case 'doctor': {
            if (!(await doctor(currentRun()))) process.exitCode = 1;
            break;
        }
        case 'login': {
            const run = currentRun();
            const email = rest[0] ?? sampleTenant().admin.email;
            await withPage(run, (page) => login(page, run, email));
            console.log(`masuk sebagai ${email}`);
            break;
        }
        case 'go': {
            const run = currentRun();
            // Git Bash mengubah argumen berawalan / menjadi path Windows, jadi path layar ditulis tanpa / di depan.
            const path = (rest[0] ?? '').replace(/^\/+/, '');
            await withPage(run, (page) => navigate(page, `${run.url}/${path}`));
            break;
        }
        case 'click': {
            const hit = await withPage(currentRun(), (page) =>
                click(page, locator(rest[0], rest[1])),
            );
            console.log(`klik ${hit.name}`);
            break;
        }
        case 'fill': {
            await withPage(currentRun(), (page) =>
                fill(page, locator(rest[0], rest[1]), rest[2] ?? ''),
            );
            break;
        }
        case 'fill-password': {
            const email = rest[2] ?? sampleTenant().admin.email;
            await withPage(currentRun(), (page) =>
                fill(page, locator(rest[0], rest[1]), passwordFor(email)),
            );
            break;
        }
        case 'press': {
            const key = rest[0] ?? '';
            if (!isKeyName(key)) throw new Error(usage);
            await withPage(currentRun(), (page) => press(page, key));
            break;
        }
        case 'wait': {
            const target = locator(rest[0], rest[1]);
            const timeout = values.timeout ? Number(values.timeout) : undefined;
            await withPage(currentRun(), (page) =>
                values.gone
                    ? waitGone(page, target, timeout)
                    : waitFor(page, target, timeout).then(() => undefined),
            );
            break;
        }
        case 'find': {
            const hit = await withPage(currentRun(), (page) =>
                find(page, locator(rest[0], rest[1])),
            );
            console.log(hit ? JSON.stringify(hit) : 'tidak ada');
            break;
        }
        case 'text': {
            console.log(await withPage(currentRun(), pageText));
            break;
        }
        case 'snapshot': {
            const run = currentRun();
            const file = join(
                evidenceDir(run),
                `${rest[0] ?? 'snapshot'}.aria.txt`,
            );
            writeFileSync(file, await withPage(run, ariaSnapshot));
            console.log(file);
            break;
        }
        case 'shot': {
            const run = currentRun();
            const file = join(evidenceDir(run), `${rest[0] ?? 'screen'}.png`);
            const image = await withPage(run, async (page) => {
                if (!values.alert) return screenshot(page);
                const clip = await alertClip(page);
                if (!clip)
                    throw new Error(
                        'Tidak ada ringkasan error (role=alert) di layar.',
                    );
                return screenshot(page, clip);
            });
            writeFileSync(file, image);
            console.log(file);
            break;
        }
        case 'sql': {
            const run = currentRun();
            const output = psql(run, environmentDatabase(run), rest[0] ?? '');
            if (values.save)
                writeFileSync(
                    join(evidenceDir(run), `${values.save}.sql.txt`),
                    `${rest[0] ?? ''}\n\n${output}`,
                );
            console.log(output);
            break;
        }
        case 'journey': {
            if (rest[0] === 'print') {
                const run = currentRun();
                await withPage(run, (page) =>
                    runPrintJourney(
                        page,
                        run,
                        login,
                        sampleTenant().admin.email,
                    ),
                );
                break;
            }
            if (rest[0] !== 'outpatient') throw new Error(usage);
            const run = currentRun();
            await withPage(run, (page) =>
                runOutpatientJourney(page, run, login, {
                    prepareCashier: values['prepare-cashier'] ?? false,
                }),
            );
            break;
        }
        case 'down': {
            const run = currentRun();
            down(run);
            console.log(
                `run ${run.runId} dimatikan, evidence tetap di ${evidenceDir(run)}`,
            );
            break;
        }
        default:
            console.log(usage);
            process.exitCode = command === '' ? 0 : 1;
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
