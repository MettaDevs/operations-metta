// Proses worker lingkungan. Menarik operasi lingkungan dari control-plane-metta, menjalankannya di database host ini,
// lalu menutupnya. Satu operasi pada satu waktu; SIGTERM ditunggu sampai operasi yang sedang berjalan selesai.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerHealthcareEventHandlers } from '../modules/healthcare/src/index.ts';
import { registerPharmacyEventHandlers } from '../modules/pharmacy/src/index.ts';
import { registerOrganizationDefaults } from './foundation/number-sequence/index.ts';
import { loadConfig } from './platform/config/index.ts';
import { controlPlaneClient } from './platform/control-plane/index.ts';
import {
    gatherHostReport,
    readModuleCatalog,
    runOperation,
} from './platform/environment/index.ts';
import {
    flushErrorReporting,
    reportError,
    startErrorReporting,
} from './platform/error-reporting/index.ts';
import { readMigrationSource } from './platform/migration/index.ts';

const config = loadConfig();
// Data bawaan per organisasi milik module yang dipasang sync_entitlements.
registerOrganizationDefaults();
// Event yang diterbitkan operasi worker diantar ke module penerimanya, sama dengan proses HTTP.
registerPharmacyEventHandlers();
registerHealthcareEventHandlers();
startErrorReporting(config, 'worker');
if (
    !config.CONTROL_PLANE_URL ||
    !config.WORKER_HOST_ID ||
    !config.WORKER_PRIVATE_KEY_PATH
) {
    process.stderr.write(
        'Isi CONTROL_PLANE_URL, WORKER_HOST_ID, dan WORKER_PRIVATE_KEY_PATH untuk menjalankan worker.\n',
    );
    process.exit(1);
}
const client = controlPlaneClient({
    url: config.CONTROL_PLANE_URL,
    hostId: config.WORKER_HOST_ID,
    privateKey: readFileSync(config.WORKER_PRIVATE_KEY_PATH, 'utf8'),
});
// src/worker.ts di laptop dan dist/worker.js di image sama-sama satu folder di bawah akar yang memuat migration.
const root = resolve(import.meta.dir, '..');
const source = readMigrationSource(root);
const modules = readModuleCatalog(root, source);
const log = (event: Record<string, unknown>) =>
    process.stderr.write(JSON.stringify(event) + '\n');

let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.on(signal, () => {
        stopping = true;
        wake?.();
    });

log({
    event: 'worker-started',
    host_id: config.WORKER_HOST_ID,
    release: config.OPERATIONS_RELEASE,
});

// Laporan host dikirim saat mulai lalu setiap WORKER_REPORT_SECONDS, di sela operasi. Kegagalannya hanya dicatat:
// laporan berikutnya akan membawa keadaan terbaru.
let nextReportAt = 0;
async function reportHost(): Promise<void> {
    if (Date.now() < nextReportAt) return;
    nextReportAt = Date.now() + config.WORKER_REPORT_SECONDS * 1000;
    try {
        const result = await client.reportHost(
            await gatherHostReport(config, config.OPERATIONS_RELEASE, modules),
        );
        log({ event: 'host-reported', ...result });
    } catch (error) {
        log({
            event: 'host-report-error',
            message: error instanceof Error ? error.message : String(error),
        });
        reportError(error);
    }
}
// Handler sinyal di atas yang mengubah stopping; TypeScript tidak melihat penulisan itu.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
while (!stopping) {
    await reportHost();
    try {
        const claimed = await client.claim();
        if (claimed) {
            log({
                event: 'operation-claimed',
                operation_id: claimed.id,
                operation: claimed.operation,
                environment_id: claimed.environment_id,
            });
            const outcome = await runOperation(config, source, client, claimed);
            log({
                event: 'operation-closed',
                operation_id: claimed.id,
                outcome,
            });
            continue;
        }
    } catch (error) {
        log({
            event: 'worker-error',
            message: error instanceof Error ? error.message : String(error),
        });
        reportError(error);
    }
    await new Promise<void>((done) => {
        wake = done;
        setTimeout(done, config.WORKER_POLL_SECONDS * 1000);
    });
}
log({ event: 'worker-stopped' });
await flushErrorReporting();
