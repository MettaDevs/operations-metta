import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { paragraph, wordDocument } from '../../src/platform/reporting/index.ts';
import {
    ariaSnapshot,
    chooseFile,
    click,
    evaluate,
    fill,
    navigate,
    screenshot,
    waitFor,
    waitForText,
    type Page,
} from './browser.ts';
import { environmentDatabase, evidenceDir, psql, type Run } from './stack.ts';

// Mesin cetak lewat layar, sesudah `journey outpatient --prepare-cashier`: cetak kuitansi dari layar Pembayaran, cetak
// etiket dari kartu penyerahan farmasi, unggah layout kuitansi baru di Sys Admin › Layout cetak lalu cetak lagi, dan
// kembali ke layout bawaan. PDF yang dibuka tombol cetak disimpan ke evidence/ dan dibaca ulang: ukuran kertas dan
// teksnya diperiksa, bukan hanya toast-nya.

type Step = { name: string; ok: boolean; ms: number; note?: string };

const customTitle = 'KUITANSI LAYOUT UNGGAHAN';

// Layout uji, A5, ditulis dengan penulis layout yang sama dengan layout bawaan.
function customReceipt(): Uint8Array {
    return wordDocument({
        paper: { widthMm: 148, heightMm: 210 },
        marginMm: 12,
        font: 'Arial',
        fontSize: 11,
        body: [
            paragraph('{letterhead.name}', { bold: true, align: 'center' }),
            paragraph(customTitle, { bold: true, align: 'center', size: 14 }),
            paragraph('Nomor {number}, {paid_at}'),
            paragraph('Diterima dari {received_from}'),
            paragraph('Sejumlah {total} ({total_words} Rupiah)'),
            paragraph('Kasir {cashier}'),
        ],
    });
}

// Tombol cetak membuka PDF lewat URL blob di tab baru. Sebelum tombol diklik, URL.createObjectURL dibungkus supaya URL
// itu tercatat; sesudahnya berkasnya diambil dari halaman yang sama dan disimpan.
const hookBlobs = `(() => {
  window.__verifyBlobs = [];
  if (!window.__verifyHooked) {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = original(blob); window.__verifyBlobs.push(url); return url; };
    window.__verifyHooked = true;
  }
})()`;

const readLastBlob = `(async () => {
  const response = await fetch(window.__verifyBlobs.at(-1));
  const bytes = new Uint8Array(await response.arrayBuffer());
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
})()`;

async function closeExtraTabs(run: Run) {
    const targets = z
        .array(z.object({ id: z.string(), type: z.string(), url: z.string() }))
        .parse(
            await (
                await fetch(`http://127.0.0.1:${run.cdpPort}/json/list`)
            ).json(),
        );
    for (const target of targets)
        if (target.type === 'page' && target.url.startsWith('blob:'))
            await fetch(
                `http://127.0.0.1:${run.cdpPort}/json/close/${target.id}`,
            );
}

async function printedPdf(
    page: Page,
    run: Run,
    button: string,
    file: string,
): Promise<{ text: string; widthPt: number; heightPt: number }> {
    await evaluate(page, hookBlobs);
    await click(page, { role: 'button', name: button, exact: true });
    const started = Date.now();
    while (!(await evaluate(page, 'window.__verifyBlobs.length > 0'))) {
        if (Date.now() - started > 60_000)
            throw new Error(`PDF ${button} tidak terbuka dalam 60 detik.`);
        await Bun.sleep(250);
    }
    const encoded = z.string().parse(await evaluate(page, readLastBlob));
    const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
    writeFileSync(file, bytes);
    await closeExtraTabs(run);
    const pdf = await getDocumentProxy(bytes);
    const [, , width = 0, height = 0] = (await pdf.getPage(1)).view;
    const { text } = await extractText(pdf, { mergePages: true });
    return { text, widthPt: Math.round(width), heightPt: Math.round(height) };
}

const literal = (text: string) =>
    new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

// Baris daftar dibuka lewat menu tindakannya, seperti pengguna membuka record dari daftar.
async function openReceiptLayouts(page: Page) {
    await click(page, {
        role: 'button',
        name: 'Tindakan untuk Kuitansi pembayaran',
    });
    await click(page, { role: 'menuitem', name: 'Buka', exact: true });
}

const mm = (points: number) => Math.round((points / 72) * 25.4);

export async function runPrintJourney(
    page: Page,
    run: Run,
    login: (page: Page, run: Run, email: string) => Promise<void>,
    email: string,
): Promise<void> {
    const out = join(
        evidenceDir(run),
        `print-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}`,
    );
    mkdirSync(out, { recursive: true });
    const steps: Step[] = [];
    const facts: Record<string, string> = {};
    const sql = (query: string) =>
        psql(run, environmentDatabase(run), query, ['-tA']).trim();
    const step = async (
        name: string,
        action: () => Promise<string> | string,
    ) => {
        const started = performance.now();
        const label = `${String(steps.length + 1).padStart(2, '0')}-${name}`;
        try {
            const note = await action();
            steps.push({
                name,
                ok: true,
                ms: Math.round(performance.now() - started),
                note,
            });
            writeFileSync(join(out, `${label}.png`), await screenshot(page));
            writeFileSync(
                join(out, `${label}.aria.txt`),
                await ariaSnapshot(page),
            );
            console.log(`OK    ${name}: ${note}`);
        } catch (error) {
            const note = error instanceof Error ? error.message : String(error);
            steps.push({
                name,
                ok: false,
                ms: Math.round(performance.now() - started),
                note,
            });
            writeFileSync(
                join(out, `${label}-gagal.png`),
                await screenshot(page),
            );
            console.log(`GAGAL ${name}: ${note}`);
            throw error;
        } finally {
            writeFileSync(
                join(out, 'journey.json'),
                JSON.stringify(
                    { runId: run.runId, commit: run.commit, facts, steps },
                    null,
                    4,
                ),
            );
        }
    };
    const payment = () => {
        const [id = '', number = '', document = ''] = sql(
            `select id, no_bukti, sumber_dokumen_id from kasir where status = 'diposting' order by created_at desc limit 1`,
        ).split('|');
        if (!id)
            throw new Error(
                'Belum ada pembayaran. Jalankan `journey outpatient --prepare-cashier` lebih dulu.',
            );
        return { id, number, document };
    };

    try {
        await step('masuk', async () => {
            await login(page, run, email);
            return email;
        });

        await step('kuitansi-bawaan', async () => {
            const { number, document } = payment();
            facts.payment = number;
            await navigate(page, `${run.url}/billing/payments/${document}`);
            await waitForText(page, literal(number));
            const pdf = await printedPdf(
                page,
                run,
                'Kuitansi',
                join(out, 'kuitansi-bawaan.pdf'),
            );
            if (!pdf.text.includes(number) || !pdf.text.includes('Rupiah'))
                throw new Error(
                    `PDF kuitansi tidak memuat ${number} dan terbilang.`,
                );
            if (pdf.widthPt !== 595 || pdf.heightPt !== 842)
                throw new Error(
                    `Kuitansi bawaan bukan A4: ${pdf.widthPt}x${pdf.heightPt} pt.`,
                );
            facts.receiptTotal = sql(
                `select trim_scale(nilai - nilai_discount + biaya_tambahan) from kasir where no_bukti = '${number}'`,
            );
            return `kuitansi-bawaan.pdf, A4, memuat ${number}`;
        });

        await step('etiket', async () => {
            const [prescription = '', number = ''] = sql(
                `select r.id, r.nomor_resep from bill_farmasi b join far_tr_resep r on r.id = b.resep_id
                 where b.status in ('disiapkan', 'dipanggil', 'diserahkan') and b.deleted_at is null
                 order by b.disiapkan_pada desc limit 1`,
            ).split('|');
            if (!prescription)
                throw new Error('Belum ada resep yang disiapkan farmasi.');
            facts.prescription = number;
            await navigate(
                page,
                `${run.url}/pharmacy/dispensing/prescriptions?prescription=${prescription}`,
            );
            await waitFor(page, {
                role: 'button',
                name: 'Etiket',
                exact: true,
            });
            const pdf = await printedPdf(
                page,
                run,
                'Etiket',
                join(out, 'etiket.pdf'),
            );
            if (!pdf.text.includes(number))
                throw new Error(`PDF etiket tidak memuat ${number}.`);
            return `etiket.pdf, ${mm(pdf.widthPt)} x ${mm(pdf.heightPt)} mm, memuat ${number}`;
        });

        await step('layout-unggah', async () => {
            const file = join(out, 'kuitansi-a5.docx');
            writeFileSync(file, customReceipt());
            await navigate(
                page,
                `${run.url}/sysadmin/reporting/report-layouts`,
            );
            await openReceiptLayouts(page);
            await waitFor(page, { role: 'textbox', name: 'Nama layout' });
            await chooseFile(page, 'input[type=file]', file);
            await fill(
                page,
                { role: 'textbox', name: 'Nama layout' },
                'Kuitansi A5 verifikasi',
            );
            await click(page, {
                role: 'button',
                name: 'Unggah layout',
                exact: true,
                nth: 1,
            });
            await waitFor(page, {
                role: 'row',
                name: 'Kuitansi A5 verifikasi',
            });
            await click(page, {
                role: 'button',
                name: 'Pakai layout ini',
                within: 'Kuitansi A5 verifikasi',
            });
            await waitForText(
                page,
                literal('Layout bawaan untuk legal entity ini sudah diganti'),
            );
            return 'kuitansi-a5.docx diunggah dan dipakai';
        });

        await step('kuitansi-layout-baru', async () => {
            const { number, document } = payment();
            await navigate(page, `${run.url}/billing/payments/${document}`);
            await waitForText(page, literal(number));
            const pdf = await printedPdf(
                page,
                run,
                'Kuitansi',
                join(out, 'kuitansi-layout-baru.pdf'),
            );
            if (!pdf.text.includes(customTitle) || !pdf.text.includes(number))
                throw new Error('PDF kuitansi tidak memakai layout unggahan.');
            if (mm(pdf.widthPt) !== 148 || mm(pdf.heightPt) !== 210)
                throw new Error(
                    `Kuitansi unggahan bukan A5: ${pdf.widthPt}x${pdf.heightPt} pt.`,
                );
            return `kuitansi-layout-baru.pdf, A5, ${customTitle}`;
        });

        await step('kembali-ke-bawaan', async () => {
            await navigate(
                page,
                `${run.url}/sysadmin/reporting/report-layouts`,
            );
            await openReceiptLayouts(page);
            await click(page, {
                role: 'button',
                name: 'Kembali ke bawaan',
                exact: true,
            });
            await waitForText(
                page,
                literal('Layout bawaan untuk legal entity ini sudah diganti'),
            );
            const { document, number } = payment();
            await navigate(page, `${run.url}/billing/payments/${document}`);
            await waitForText(page, literal(number));
            const pdf = await printedPdf(
                page,
                run,
                'Kuitansi',
                join(out, 'kuitansi-kembali.pdf'),
            );
            if (pdf.text.includes(customTitle) || pdf.widthPt !== 595)
                throw new Error('Kuitansi belum kembali ke layout bawaan.');
            return 'kuitansi-kembali.pdf, A4 bawaan';
        });

        await step('bukti-database', () => {
            const proof = [
                `-- layout unggahan\n${psql(run, environmentDatabase(run), 'select report_code, name, bahasa, kertas_lebar_mm, kertas_tinggi_mm, length(isi) as bytes, deleted_at from report_layouts order by created_at')}`,
                `-- pilihan layout per legal entity\n${psql(run, environmentDatabase(run), 'select report_code, scope_key, layout_ref from report_layout_defaults order by report_code')}`,
            ].join('\n');
            writeFileSync(join(out, 'database.txt'), proof);
            return 'database.txt';
        });
    } finally {
        console.log(`evidence: ${out}`);
    }
}
