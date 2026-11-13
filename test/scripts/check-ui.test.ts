import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(import.meta.dir, '..', '..', 'scripts', 'check-ui.ts');
let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'check-ui-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}

function check() {
    const result = Bun.spawnSync([process.execPath, script, root], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: result.exitCode, output: result.stderr.toString() };
}

const page = 'src/platform/feature/feature.page.tsx';

// Setiap aturan: berkas yang melanggar ditolak dengan pesannya, lalu bentuk yang benar diterima.
const rules: { name: string; bad: string; good: string; message: string }[] = [
    {
        name: 'list search belongs in the toolbar',
        bad: `<ListPageLayout header={<RecordActionBar title="Daftar" />}><Input type="search" /></ListPageLayout>;`,
        good: `<ListPageLayout header={<RecordActionBar title="Daftar" search={{ value: q, onValueChange: setQ }} />} />;`,
        message: 'Pencarian daftar halaman ada di toolbar',
    },
    {
        name: 'list filters live in the left filter pane',
        bad: `<ListPageLayout filters={<div><Select items={[]} /></div>} />;`,
        good: `<ListPageLayout filterPanel={<FilterPane id="f" title="Filter" onClose={close}><Select items={[]} /></FilterPane>} filters={<p role="alert">Gagal</p>} />;`,
        message: 'Isian filter masuk FilterPane kiri',
    },
    {
        name: 'the filter pane is on the left',
        bad: `<ListPageLayout filterSide="right" />;`,
        good: `<ListPageLayout filterSide="left" />;`,
        message: 'Panel filter daftar ada di kiri',
    },
    {
        name: 'a stored record opens in edit mode for users who may update it',
        bad: `const [editing, setEditing] = useState(record === null);`,
        good: `const editing = record === null || canUpdate; const [editing, setEditing] = useState<Line | 'new' | null>(null);`,
        message: 'dari izin, bukan dari useState',
    },
    {
        name: 'the form error summary stays pinned under the toolbar',
        bad: `import { FormErrorHeader } from '@core/platform/shell'; <form noValidate><div className="pt-4"><FormErrorHeader errors={errors} /></div><FormGrid /></form>;`,
        good: `import { FormErrorHeader } from '@core/platform/shell'; <form noValidate>{show && <FormErrorHeader className="pt-4" errors={errors} />}<FormGrid /></form>;`,
        message: 'FormErrorHeader ditaruh langsung di antara isi form',
    },
    {
        name: 'screens show form errors only through FormErrorHeader',
        bad: `import { FormErrorSummary } from '@operations-metta/ui/form-feedback'; <FormErrorSummary feedback={null} />;`,
        good: `import { FormErrorHeader } from '@core/platform/shell'; <><RecordActionBar title="A" /><FormErrorHeader errors={errors} /></>;`,
        message: 'jangan memasang FormErrorSummary sendiri',
    },
    {
        name: 'a save button is recognisable as a save attempt',
        bad: `<Button type="button" onClick={save}>{busy ? 'Menyimpan…' : 'Simpan registrasi'}</Button>;`,
        good: `<><Button type="button" data-action="save" onClick={save}>Simpan registrasi</Button><Button type="submit">Simpan</Button><Button onClick={copy}>Salin</Button></>;`,
        message: 'Tombol Simpan memakai ActionButton',
    },
    {
        name: 'an editable card reports unsaved changes',
        bad: `usePageDialogRecord({ recordTitle: 'Lokasi baru', editing });`,
        good: `usePageDialogRecord({ recordTitle: 'Lokasi baru', editing, dirty }); usePageDialogRecord({ recordTitle: 'Mutasi', editing: false }); usePageDialogRecord({ recordTitle: 'Clerk' });`,
        message: 'melaporkan isian yang belum disimpan lewat `dirty`',
    },
    {
        name: 'a caller that holds the form reports unsaved changes on PageDialog',
        bad: `<PageDialog open onOpenChange={close}><PageDialogContent title="Pekerjaan" editing><Input label="Nama" /></PageDialogContent></PageDialog>;`,
        good: `<><PageDialog open dirty={name !== ''} onOpenChange={close}><PageDialogContent title="Pekerjaan" editing /></PageDialog><PageDialog open onOpenChange={close}><PageDialogContent title="Mutasi" editing={false} /></PageDialog><PageDialog open onOpenChange={close}><PageDialogContent title="Lokasi"><LocationCard /></PageDialogContent></PageDialog></>;`,
        message: 'melaporkan isian yang belum disimpan lewat `dirty`',
    },
    {
        name: 'no HTML table',
        bad: `<table><tbody /></table>;`,
        good: `import { DataTable } from '@operations-metta/ui/data-table'; <DataTable data={[]} columns={[]} />;`,
        message: 'bukan tabel HTML',
    },
    {
        name: 'no raw Table frame',
        bad: `import { Table } from '@operations-metta/ui/table';`,
        good: `import { TableRow } from '@operations-metta/ui/table';`,
        message: 'bukan frame Table terpisah',
    },
    {
        name: 'DataTable comes from the SDK',
        bad: `import { DataTable } from './my-table'; <DataTable />;`,
        good: `import { DataTable } from '@operations-metta/ui/data-table'; <DataTable />;`,
        message: 'Impor DataTable dari @operations-metta/ui/data-table',
    },
    {
        name: 'the SDK owns DataTable styling',
        bad: `import { DataTable } from '@operations-metta/ui/data-table'; <DataTable className="text-xs" />;`,
        good: `import { DataTable } from '@operations-metta/ui/data-table'; <DataTable className="min-h-0 flex-1" />;`,
        message: 'Gaya tabel milik SDK',
    },
    {
        name: 'the main list keeps viewport scroll, row numbers, and inline actions',
        bad: `import { DataTable } from '@operations-metta/ui/data-table'; <ListPageLayout><DataTable showRowNumbers={false} /></ListPageLayout>;`,
        good: `import { DataTable } from '@operations-metta/ui/data-table'; <ListPageLayout><DataTable /></ListPageLayout>; <DataTable scrollMode="inline" showRowNumbers={false} />;`,
        message: 'Daftar utama memakai scroll viewport',
    },
    {
        name: 'form controls come from the SDK',
        bad: `<FieldGroup><NativeSelect /><select /></FieldGroup>;`,
        good: `<FormGrid><FormControl><Select items={[]} /></FormControl></FormGrid>;`,
        message: 'Gunakan kontrol SDK di FormControl dan FormGrid',
    },
    {
        name: 'form inputs stay left-aligned, numbers too',
        bad: `<Input label="Nadi" inputMode="decimal" className={numeric ? 'text-right' : undefined} />;`,
        good: `<Input label="Nadi" inputMode="decimal" />;`,
        message: 'Isian form rata kiri',
    },
    {
        name: 'dates use the SDK picker',
        bad: `<Input type="date" />;`,
        good: `<DatePicker label="Tanggal" />;`,
        message: 'Gunakan DatePicker atau DateTimePicker SDK',
    },
    {
        name: 'no browser alert, confirm, or prompt',
        bad: `window.confirm('Buang?'); alert('Gagal'); globalThis['prompt']('Alasan?'); const { confirm: ask } = window;`,
        good: `const { confirm } = useConfirmation(); await confirm({ title: 'Delete?' });`,
        message: 'jangan memakai dialog bawaan browser',
    },
    {
        name: 'no reportValidity',
        bad: `input.reportValidity();`,
        good: `input.focus();`,
        message: 'bukan reportValidity() browser',
    },
    {
        name: 'forms use noValidate',
        bad: `<form><input required /></form>;`,
        good: `<form noValidate><input required /></form>;`,
        message: 'Form harus memakai noValidate',
    },
    {
        name: 'a disabled button still shows the title that explains it',
        bad: `const buttonVariants = cva('inline-flex disabled:pointer-events-none disabled:opacity-50'); <Button disabled title="Simpan dulu" className="disabled:pointer-events-none">Posting</Button>;`,
        good: `const buttonVariants = cva('inline-flex disabled:opacity-50'); <Button disabled title="Simpan dulu">Posting</Button>;`,
        message: 'jangan pakai disabled:pointer-events-none',
    },
    {
        name: 'no browser leave-page popup',
        bad: `event.returnValue = '';`,
        good: `event.preventDefault();`,
        message: 'popup keluar halaman bawaan browser',
    },
];

for (const rule of rules)
    test(`check:ui rejects then accepts: ${rule.name}`, () => {
        write(page, rule.bad);
        const rejected = check();
        expect(rejected.exitCode).toBe(1);
        expect(rejected.output).toContain(rule.message);
        expect(rejected.output).toContain(`${page}:1:`);

        write(page, rule.good);
        expect(check()).toEqual({ exitCode: 0, output: '' });
    });

test('check:ui reads module screens and package code, not only src/', () => {
    write('modules/clinic/src/visit/visit.page.tsx', `<table />;`);
    write('packages/ui/src/components/thing.tsx', `alert('x');`);
    const { exitCode, output } = check();
    expect(exitCode).toBe(1);
    expect(output).toContain('modules/clinic/src/visit/visit.page.tsx:1:');
    expect(output).toContain('packages/ui/src/components/thing.tsx:1:');
});

test('check:ui keeps sector names of health offices out of Core', () => {
    write('src/platform/organization/policy.ts', `const kind = 'dinkes';`);
    write('database/migrations/0009_policy.sql', `-- DINKES-DEFAULT`);
    const rejected = check();
    expect(rejected.exitCode).toBe(1);
    expect(rejected.output).toContain('src/platform/organization/policy.ts:1:');
    expect(rejected.output).toContain('database/migrations/0009_policy.sql:1:');

    write('src/platform/organization/policy.ts', `const kind = 'facility';`);
    write('database/migrations/0009_policy.sql', `-- service group`);
    // Module layanan kesehatan memang boleh memakai istilahnya sendiri.
    write(
        'modules/clinic/src/office/office.service.ts',
        `const kind = 'dinkes';`,
    );
    expect(check()).toEqual({ exitCode: 0, output: '' });
});
