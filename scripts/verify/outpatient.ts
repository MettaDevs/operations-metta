import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
    ariaSnapshot,
    click,
    currentUrl,
    fill,
    find,
    navigate,
    pageText,
    screenshot,
    waitFor,
    waitForText,
    type Page,
} from './browser.ts';
import {
    environmentDatabase,
    evidenceDir,
    psql,
    root,
    sampleTenant,
    type Run,
} from './stack.ts';

// Satu pasien rawat jalan dari pendaftaran sampai bayar di kasir, lewat layar yang sama dengan pengguna:
// daftar → mulai periksa dengan tindakan dan resep → kirim resep → selesai periksa → farmasi Siapkan → kasir Bayar.
// Data pasien, poli, dokter, tindakan, dan obat diambil dari kunjungan contoh pertama di dev/tenants.json.
// Setiap langkah meninggalkan screenshot dan snapshot aksesibilitas di evidence/, dan langkah terakhir membaca
// baris database yang membuktikan efeknya.

const sampleSchema = z.object({
    sample: z.object({
        workspace: z.object({ legal_entity: z.string(), unit: z.string() }),
        legal_entities: z.array(
            z.object({
                company_code: z.string(),
                name: z.string(),
                units: z.array(
                    z.object({ name: z.string(), number: z.string() }),
                ),
            }),
        ),
        clinic: z.object({
            patients: z.array(z.object({ name: z.string(), nik: z.string() })),
            procedures: z.array(
                z.object({ name: z.string(), sections: z.array(z.string()) }),
            ),
            visits: z.array(
                z.object({
                    patient: z.string(),
                    section: z.string(),
                    doctor: z.string(),
                    physical: z.object({
                        consciousness: z.string(),
                        systolic: z.number(),
                        diastolic: z.number(),
                        height: z.number(),
                        weight: z.number(),
                        waist_circumference: z.number(),
                        pulse_rate: z.number(),
                        respiratory_rate: z.number(),
                    }),
                    prescription: z.array(
                        z.object({
                            drug: z.string(),
                            quantity: z.number(),
                            signa: z.string(),
                            usage_instruction: z.string(),
                            frequency_per_day: z.number(),
                            dose: z.number(),
                            route: z.string(),
                            duration_days: z.number(),
                        }),
                    ),
                }),
            ),
        }),
        inventory: z.object({
            drugs: z.array(z.object({ code: z.string(), name: z.string() })),
        }),
    }),
});

function journeyData() {
    const [tenant] = z
        .array(sampleSchema)
        .parse(
            JSON.parse(readFileSync(join(root, 'dev', 'tenants.json'), 'utf8')),
        );
    if (!tenant) throw new Error('dev/tenants.json kosong.');
    const { sample } = tenant;
    const visit = sample.clinic.visits[0];
    const line = visit?.prescription[0];
    const patient = sample.clinic.patients.find(
        (item) => item.nik === visit?.patient,
    );
    const procedure = sample.clinic.procedures.find(
        (item) => visit && item.sections.includes(visit.section),
    );
    const drug = sample.inventory.drugs.find(
        (item) => item.code === line?.drug,
    );
    const legalEntity = sample.legal_entities.find(
        (item) => item.company_code === sample.workspace.legal_entity,
    );
    const unit = legalEntity?.units.find(
        (item) => item.number === sample.workspace.unit,
    );
    if (
        !visit ||
        !line ||
        !patient ||
        !procedure ||
        !drug ||
        !legalEntity ||
        !unit
    )
        throw new Error(
            'Data contoh di dev/tenants.json tidak memenuhi prasyarat perjalanan: butuh kunjungan contoh dengan resep, pasien, tindakan di poli itu, obat, dan tempat kerja.',
        );
    return { visit, line, patient, procedure, drug, legalEntity, unit };
}

type Step = { name: string; ok: boolean; ms: number; note?: string };

export type JourneyOptions = { prepareCashier: boolean };

export async function runOutpatientJourney(
    page: Page,
    run: Run,
    login: (page: Page, run: Run, email: string) => Promise<void>,
    options: JourneyOptions,
): Promise<void> {
    const data = journeyData();
    const out = join(
        evidenceDir(run),
        `outpatient-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}`,
    );
    mkdirSync(out, { recursive: true });
    const steps: Step[] = [];
    const facts: Record<string, string> = {};
    const capture = async (label: string) => {
        writeFileSync(join(out, `${label}.png`), await screenshot(page));
        writeFileSync(join(out, `${label}.aria.txt`), await ariaSnapshot(page));
    };
    const step = async (
        name: string,
        action: () => Promise<string | undefined> | string | undefined,
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
            await capture(label);
            console.log(`OK    ${name}${note ? `: ${note}` : ''}`);
        } catch (error) {
            const note = error instanceof Error ? error.message : String(error);
            steps.push({
                name,
                ok: false,
                ms: Math.round(performance.now() - started),
                note,
            });
            await capture(`${label}-gagal`);
            console.log(`GAGAL ${name}: ${note}`);
            throw error;
        } finally {
            writeFileSync(
                join(out, 'journey.json'),
                JSON.stringify(
                    {
                        runId: run.runId,
                        commit: run.commit,
                        options,
                        facts,
                        steps,
                    },
                    null,
                    4,
                ),
            );
        }
    };
    const fixErrors = /Periksa \d+ isian yang perlu diperbaiki/;
    const sql = (query: string) => psql(run, environmentDatabase(run), query);

    try {
        await step('masuk', async () => {
            const { admin } = sampleTenant();
            await login(page, run, admin.email);
            return admin.email;
        });

        await step('tempat-kerja', async () => {
            await navigate(
                page,
                `${run.url}/healthcare/registration/visits/new`,
            );
            const target = `${data.legalEntity.name} · ${data.unit.name}`;
            const current = await waitFor(page, {
                role: 'button',
                name: 'Pilih tempat kerja',
            });
            if (current.name.endsWith(target)) return target;
            await click(page, { role: 'button', name: 'Pilih tempat kerja' });
            await click(page, {
                role: 'combobox',
                name: 'Legal entity',
                within: 'Tempat kerja',
            });
            await click(page, {
                role: 'option',
                name: data.legalEntity.name,
                exact: true,
            });
            await click(page, {
                role: 'combobox',
                name: 'Unit kerja',
                within: 'Tempat kerja',
            });
            await click(page, {
                role: 'option',
                name: data.unit.name,
                exact: true,
            });
            await click(page, {
                role: 'button',
                name: 'Terapkan',
                within: 'Tempat kerja',
            });
            const applied = await waitFor(page, {
                role: 'button',
                name: 'Pilih tempat kerja',
            });
            if (!applied.name.endsWith(target))
                throw new Error(`Tempat kerja tidak berubah: ${applied.name}`);
            return target;
        });

        await step('daftar', async () => {
            await navigate(
                page,
                `${run.url}/healthcare/registration/visits/new`,
            );
            await fill(
                page,
                { role: 'combobox', name: 'Pasien', exact: true },
                data.patient.name,
            );
            await click(page, { role: 'option', name: data.patient.nik });
            await click(page, {
                role: 'button',
                name: data.visit.section,
                within: 'Poli atau ruangan',
                exact: true,
            });
            await click(page, { role: 'button', name: 'Simpan registrasi' });
            const saved = await waitForText(
                page,
                /NoReg (\S+) · NoBukti (\S+)/,
                { failOn: fixErrors },
            );
            const queue = await waitForText(page, /Nomor antrean\s+(\S+)/);
            facts.noReg = saved[1] ?? '';
            facts.queueCode = queue[1] ?? '';
            return `${facts.noReg}, antrean ${facts.queueCode}`;
        });

        await step('mulai-periksa', async () => {
            await navigate(page, `${run.url}/healthcare/examination/queue`);
            await click(page, {
                role: 'button',
                name: `Tindakan untuk ${facts.queueCode} ${data.patient.name}`,
                exact: true,
            });
            await click(page, {
                role: 'menuitem',
                name: 'Mulai periksa',
                exact: true,
            });
            await waitFor(page, {
                role: 'button',
                name: 'Selesai periksa',
                exact: true,
            });
            const url = await currentUrl(page);
            if (!url.includes(`/healthcare/examination/queue/${facts.noReg}/`))
                throw new Error(
                    `Halaman pemeriksaan tidak terbuka untuk ${facts.noReg}: ${url}`,
                );
            facts.examinationUrl = url.replace(run.url, '');
            return facts.examinationUrl;
        });

        await step('isi-pemeriksaan', async () => {
            const vitals = data.visit.physical;
            const fisik = 'Periksa fisik';
            await fill(
                page,
                {
                    role: 'combobox',
                    name: 'Dokter / Tenaga medis',
                    exact: true,
                },
                data.visit.doctor,
            );
            await click(page, { role: 'option', name: data.visit.doctor });
            await fill(
                page,
                { role: 'textbox', name: 'Keluhan utama', exact: true },
                'Demam tiga hari',
            );
            await click(page, {
                role: 'combobox',
                name: 'Kesadaran',
                within: fisik,
            });
            await click(page, {
                role: 'option',
                name: vitals.consciousness,
                exact: true,
            });
            const numbers: [string, number][] = [
                ['Sistole', vitals.systolic],
                ['Diastole', vitals.diastolic],
                ['Tinggi badan (cm)', vitals.height],
                ['Berat badan (kg)', vitals.weight],
                ['Lingkar perut', vitals.waist_circumference],
                ['Detak nadi', vitals.pulse_rate],
                ['Nafas', vitals.respiratory_rate],
            ];
            for (const [name, value] of numbers)
                await fill(
                    page,
                    { role: 'textbox', name, within: fisik },
                    String(value),
                );
            await click(page, {
                role: 'button',
                name: 'Tambah',
                within: 'Biaya Tindakan',
                exact: true,
            });
            await fill(
                page,
                { role: 'combobox', name: 'Nama Tindakan, baris 1' },
                data.procedure.name,
            );
            await click(page, { role: 'option', name: data.procedure.name });
            const resep = 'E-Resep';
            const line = data.line;
            await click(page, {
                role: 'button',
                name: 'Tambah',
                within: resep,
                exact: true,
            });
            await fill(
                page,
                { role: 'combobox', name: 'Nama Obat, baris 1', within: resep },
                data.drug.name,
            );
            await click(page, { role: 'option', name: data.drug.name });
            await fill(
                page,
                { role: 'textbox', name: 'Signa, baris 1', within: resep },
                line.signa,
            );
            await fill(
                page,
                {
                    role: 'combobox',
                    name: 'Aturan Pakai, baris 1',
                    within: resep,
                },
                line.usage_instruction,
            );
            await click(page, { role: 'option', name: line.usage_instruction });
            await fill(
                page,
                {
                    role: 'textbox',
                    name: 'Kali sehari, baris 1',
                    within: resep,
                },
                String(line.frequency_per_day),
            );
            await fill(
                page,
                { role: 'textbox', name: 'Dosis, baris 1', within: resep },
                String(line.dose),
            );
            await fill(
                page,
                { role: 'combobox', name: 'Rute, baris 1', within: resep },
                line.route,
            );
            await click(page, {
                role: 'option',
                name: `${line.route} `,
                prefix: true,
            });
            await fill(
                page,
                {
                    role: 'textbox',
                    name: 'Lama (hari), baris 1',
                    within: resep,
                },
                String(line.duration_days),
            );
            await fill(
                page,
                { role: 'textbox', name: 'Qty, baris 1', within: resep },
                String(line.quantity),
            );
            await click(page, { role: 'button', name: 'Simpan', exact: true });
            await waitForText(page, /Total\s+[1-9]/, { failOn: fixErrors });
            const deadline = Date.now() + 15_000;
            while ((await pageText(page)).includes('Belum disimpan')) {
                const text = await pageText(page);
                const failure = fixErrors.exec(text);
                if (failure) throw new Error(`Simpan ditolak: ${failure[0]}`);
                if (Date.now() > deadline)
                    throw new Error(
                        'Baris tindakan masih "Belum disimpan" 15 detik setelah Simpan.',
                    );
                await Bun.sleep(250);
            }
            return `${data.procedure.name}, ${data.drug.name} x ${line.quantity}`;
        });

        await step('kirim-resep', async () => {
            await click(page, {
                role: 'button',
                name: 'Kirim ke farmasi',
                within: 'E-Resep',
            });
            const sent = await waitForText(
                page,
                /(\S+-RSP-\d+) · Dikirim ke farmasi/,
                { failOn: fixErrors },
            );
            facts.prescription = sent[1] ?? '';
            return facts.prescription;
        });

        await step('selesai-periksa', async () => {
            await click(page, {
                role: 'button',
                name: 'Selesai periksa',
                exact: true,
            });
            const deadline = Date.now() + 15_000;
            while (
                await find(page, {
                    role: 'button',
                    name: 'Selesai periksa',
                    exact: true,
                })
            ) {
                const failure = fixErrors.exec(await pageText(page));
                if (failure)
                    throw new Error(`Selesai periksa ditolak: ${failure[0]}`);
                if (Date.now() > deadline)
                    throw new Error(
                        'Tombol Selesai periksa masih ada 15 detik setelah diklik.',
                    );
                await Bun.sleep(250);
            }
            return undefined;
        });

        await step('farmasi-siapkan', async () => {
            await navigate(
                page,
                `${run.url}/pharmacy/dispensing/prescriptions`,
            );
            await click(page, {
                role: 'button',
                name: `Tindakan untuk ${facts.prescription} `,
                prefix: true,
            });
            await click(page, {
                role: 'menuitem',
                name: 'Siapkan',
                exact: true,
            });
            await waitForText(
                page,
                new RegExp(`Resep ${facts.prescription} disiapkan`),
            );
            return facts.prescription;
        });

        if (options.prepareCashier)
            await step('siapkan-kasir', async () => {
                const notes: string[] = [];
                const cash = sql(
                    "select count(*) from jenis_bayar where perilaku = 'tunai' and aktif and tampil_di_kasir and deleted_at is null",
                );
                if (/^\s*0\s*$/m.test(cash)) {
                    await navigate(page, `${run.url}/billing/payment-methods`);
                    await click(page, {
                        role: 'button',
                        name: 'Baru',
                        exact: true,
                    });
                    await fill(
                        page,
                        { role: 'textbox', name: 'Kode', exact: true },
                        'TUNAI',
                    );
                    await fill(
                        page,
                        { role: 'textbox', name: 'Nama', exact: true },
                        'Tunai',
                    );
                    await fill(
                        page,
                        {
                            role: 'textbox',
                            name: 'Label di kasir',
                            exact: true,
                        },
                        'Tunai',
                    );
                    await click(page, {
                        role: 'combobox',
                        name: 'Perilaku',
                        exact: true,
                    });
                    await click(page, {
                        role: 'option',
                        name: 'Tunai',
                        exact: true,
                    });
                    await click(page, {
                        role: 'button',
                        name: 'Simpan',
                        exact: true,
                        within: 'Jenis bayar',
                    });
                    await waitFor(page, {
                        role: 'text',
                        name: 'TUNAI',
                        exact: true,
                    });
                    notes.push(
                        'jenis bayar TUNAI dibuat lewat Kasir › Jenis bayar',
                    );
                }
                await navigate(page, `${run.url}/billing/clerk`);
                const deadline = Date.now() + 15_000;
                let started = false;
                for (;;) {
                    started = (await pageText(page)).includes(
                        'Proses Clerk Start sudah dilakukan',
                    );
                    if (
                        started ||
                        (await find(page, {
                            role: 'button',
                            name: 'Clerk Start',
                            exact: true,
                        }))
                    )
                        break;
                    if (Date.now() > deadline)
                        throw new Error(
                            'Halaman Clerk tidak menampilkan Clerk Start maupun Clerk End.',
                        );
                    await Bun.sleep(250);
                }
                if (!started) {
                    await click(page, {
                        role: 'button',
                        name: 'Clerk Start',
                        exact: true,
                    });
                    await waitForText(
                        page,
                        /Proses Clerk Start sudah dilakukan/,
                    );
                    notes.push('Clerk Start lewat Kasir › Clerk');
                }
                return notes.length
                    ? notes.join('; ')
                    : 'jenis bayar tunai dan clerk sudah ada';
            });

        await step('kasir-bayar', async () => {
            await navigate(page, `${run.url}/billing/payments`);
            await click(page, {
                role: 'button',
                name: `Tindakan untuk ${facts.noReg} `,
                prefix: true,
            });
            await click(page, { role: 'menuitem', name: 'Bayar', exact: true });
            const total = await waitFor(page, {
                role: 'textbox',
                name: 'Grand Total',
                exact: true,
            });
            const due = Number(
                (total.value ?? '').replace(/\./g, '').replace(',', '.'),
            );
            if (!(due > 0))
                throw new Error(
                    `Grand Total kosong atau nol (${total.value ?? '-'}).`,
                );
            if (
                !(await find(page, {
                    role: 'heading',
                    name: 'Data Jumlah Bayar',
                }))
            )
                throw new Error(
                    'Form bayar tidak punya isian jumlah bayar: legal entity ini belum punya jenis bayar tunai yang tampil di kasir. Data contoh dev/tenants.json tidak membuatnya; ulangi dengan --prepare-cashier.',
                );
            const paid = Math.ceil(due / 10_000) * 10_000;
            const cashLabel = cashInputLabel(run);
            await fill(
                page,
                { role: 'textbox', name: cashLabel, exact: true },
                String(paid),
            );
            await click(page, {
                role: 'button',
                name: 'Simpan',
                exact: true,
                within: 'Detail Pembayaran',
            });
            await click(page, {
                role: 'button',
                name: 'Simpan',
                exact: true,
                within: 'Apakah Anda yakin',
            });
            await waitFor(page, {
                role: 'button',
                name: 'Batal Pembayaran',
                exact: true,
            }).catch(async (error: unknown) => {
                const text = await pageText(page);
                const reason = /[^\n]*(?:Start Clerk|Clerk Start)[^\n]*/.exec(
                    text,
                )?.[0];
                throw reason
                    ? new Error(`Pembayaran ditolak: ${reason}`)
                    : error;
            });
            facts.grandTotal = String(due);
            facts.cashPaid = String(paid);
            return `Grand Total ${due}, tunai ${paid}`;
        });

        await step('bukti-database', () => {
            const reg = facts.noReg ?? '';
            const proof = [
                `-- registrasi dan tujuan\n${sql(`select r.no_reg, r.status registrasi, t.kode_antrean, t.status tujuan, t.selesai_periksa_pada is not null selesai from sim_tr_registrasi r join sim_tr_registrasi_tujuan t on t.registrasi_id = r.id where r.no_reg = '${reg}' order by t.urutan`)}`,
                `-- resep di layanan kesehatan dan di farmasi\n${sql(`select r.nomor, r.status resep, f.no_reg, b.nomor bill_farmasi, b.status bill_status from sim_tr_resep r join far_tr_resep f on f.nomor_resep = r.nomor left join bill_farmasi b on b.resep_id = f.id where f.no_reg = '${reg}'`)}`,
                `-- tagihan kasir\n${sql(`select jenis, sumber_module, sumber_nomor, status from tagihan_kasir where sumber_nomor = '${reg}'`)}`,
                `-- rincian tagihan beserta pembayarannya\n${sql(`select d.sumber_module, d.jenis_biaya_nama, d.qty, d.nilai, d.status, k.no_bukti from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id left join kasir k on k.id = d.kasir_id where t.sumber_nomor = '${reg}' order by d.sumber_module`)}`,
                `-- pembayaran\n${sql(`select k.no_bukti, k.nilai, k.jumlah_bayar, k.nilai_kembalian, k.status from kasir k where k.id in (select d.kasir_id from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id where t.sumber_nomor = '${reg}')`)}`,
            ].join('\n');
            writeFileSync(join(out, 'database.txt'), proof);
            const unpaid = sql(
                `select count(*) from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id where t.sumber_nomor = '${reg}' and (d.status <> 'ditagih' or d.kasir_id is null)`,
            );
            if (!/^\s*0\s*$/m.test(unpaid))
                throw new Error(
                    `Masih ada rincian tagihan ${reg} yang belum dibayar.`,
                );
            const modules = sql(
                `select string_agg(distinct d.sumber_module, ',' order by d.sumber_module) from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id where t.sumber_nomor = '${reg}'`,
            );
            if (!modules.includes('healthcare,pharmacy'))
                throw new Error(
                    `Tagihan ${reg} tidak memuat tindakan dan obat: ${modules.trim()}`,
                );
            return 'database.txt';
        });
    } finally {
        console.log(`evidence: ${out}`);
    }
}

function cashInputLabel(run: Run): string {
    const label = psql(
        run,
        environmentDatabase(run),
        "select coalesce(nullif(label_kasir, ''), nama) from jenis_bayar where perilaku = 'tunai' and aktif and tampil_di_kasir and deleted_at is null order by urutan limit 1",
        ['-tA'],
    ).trim();
    if (!label)
        throw new Error('Tidak ada jenis bayar tunai yang tampil di kasir.');
    return label;
}
