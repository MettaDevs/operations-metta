import { readFileSync, watch } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
    environmentHost,
    environmentKinds,
} from '../src/platform/environment/index.ts';
import { buildClient } from './build.ts';

// `bun run dev`: server dari src/main.ts dengan `bun --watch`, yang menyalakan ulang server bila kode server berubah,
// dan build peramban ke dist/client/ yang diulang setiap kali berkas di src/, modules/, atau packages/ui/src/ berubah.
// Server membaca manifest yang baru tanpa dinyalakan ulang; muat ulang halaman di peramban untuk melihat hasilnya.

const root = resolve(import.meta.dir, '..');
const outdir = join(root, 'dist', 'client');
const generated = new Set([
    join(root, 'src', 'client.tsx'),
    join(root, 'src', 'platform', 'shell', 'api-contract.generated.json'),
]);

let running = false;
let again = false;

async function rebuild(): Promise<void> {
    if (running) {
        again = true;
        return;
    }
    running = true;
    const started = performance.now();
    try {
        // Proses terpisah, karena modul router yang sudah di-import proses ini tidak ikut berubah.
        const generate = Bun.spawnSync(['bun', 'scripts/generate-client.ts'], {
            cwd: root,
            stdout: 'ignore',
            stderr: 'inherit',
        });
        if (generate.exitCode !== 0)
            throw new Error('scripts/generate-client.ts gagal.');
        await buildClient(outdir, { production: false });
        console.log(
            `[dev] build peramban selesai dalam ${Math.round(performance.now() - started)} ms`,
        );
    } catch (error) {
        console.error(
            `[dev] ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        running = false;
        if (again) {
            again = false;
            void rebuild();
        }
    }
}

await rebuild();

// Server mencari lingkungan dari nama host, jadi `localhost:<port>` saja dijawab "tidak terhubung ke ruang kerja".
// Cetak alamat yang benar untuk setiap lingkungan di dev/tenants.json supaya tidak ada yang menebak.
function printAddresses(): void {
    const baseDomain = process.env.BASE_DOMAIN ?? '';
    if (!baseDomain) return;
    const port = process.env.PORT ?? '8000';
    const tenants = z
        .array(
            z.object({
                slug: z.string(),
                name: z.string(),
                environments: z.array(
                    z.object({
                        kind: z.enum(environmentKinds),
                        name: z.string(),
                    }),
                ),
            }),
        )
        .parse(
            JSON.parse(readFileSync(join(root, 'dev', 'tenants.json'), 'utf8')),
        );
    console.log(
        '[dev] buka lingkungan di alamatnya sendiri, bukan localhost saja:',
    );
    for (const tenant of tenants)
        for (const environment of tenant.environments)
            console.log(
                `[dev]   http://${environmentHost(tenant.slug, environment.kind, baseDomain)}:${port}  (${tenant.name}, ${environment.name})`,
            );
}

let timer: Timer | undefined;
for (const folder of ['src', 'modules', join('packages', 'ui', 'src')])
    watch(join(root, folder), { recursive: true }, (_event, file) => {
        if (!file) return;
        const path = join(root, folder, file);
        if (generated.has(path) || path.split(sep).includes('node_modules'))
            return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            console.log(`[dev] ${relative(root, path)} berubah`);
            void rebuild();
        }, 150);
    });

printAddresses();

const server = Bun.spawn(['bun', '--watch', 'src/main.ts'], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
});
process.on('SIGINT', () => {
    server.kill();
    process.exit(0);
});
await server.exited;
