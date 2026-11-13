import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// Penjaga layar yang dipindah dari CoreERP: `scripts/check-asset-list-pages.mjs`,
// `scripts/check-asset-form-controls.mjs`, `scripts/check-browser-dialogs.mjs`,
// `scripts/check-healthcare-domain-neutrality.mjs`, dan aturan `<table>`/`Table` di `eslint.config.js`. Di CoreERP
// sebagian hanya menjaga module aset; di sini semuanya berlaku untuk setiap layar di `src/` dan `modules/*/src/`.
// Argumen pertama mengganti akar repo, dipakai test.

const root = resolve(process.argv[2] ?? join(import.meta.dir, '..'));
const violations: string[] = [];
const shown = (path: string) => relative(root, path).replaceAll(sep, '/');

function files(directory: string, pattern: RegExp): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.name === 'node_modules') return [];
        if (entry.isDirectory()) return files(path, pattern);
        return pattern.test(entry.name) ? [path] : [];
    });
}

function sourceFolders(parent: string): string[] {
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(parent, entry.name, 'src'));
}

const screenFolders = [
    join(root, 'src'),
    ...sourceFolders(join(root, 'modules')),
];
const screens = screenFolders.flatMap((folder) => files(folder, /\.tsx$/));
const browserCode = [
    ...screenFolders,
    ...sourceFolders(join(root, 'packages')),
].flatMap((folder) => files(folder, /\.(ts|tsx)$/));

function parse(file: string) {
    return ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

function reporter(file: string, source: ts.SourceFile) {
    return (node: ts.Node, message: string) =>
        violations.push(
            `${shown(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
        );
}

type Element = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
const isElement = (node: ts.Node): node is Element =>
    ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);

function attribute(element: Element, name: string) {
    return element.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) && property.name.getText() === name,
    );
}

function literal(property: ts.JsxAttribute | undefined): string | null {
    const value = property?.initializer;
    if (!value) return null;
    if (ts.isStringLiteral(value)) return value.text;
    if (ts.isJsxExpression(value) && value.expression)
        return value.expression.getText();
    return null;
}

function elementsUnder(node: ts.Node): Element[] {
    const found: Element[] = [];
    const visit = (child: ts.Node) => {
        if (isElement(child)) found.push(child);
        ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
    return found;
}

function elementText(node: ts.Node): string[] {
    const found: string[] = [];
    const visit = (child: ts.Node) => {
        if (ts.isJsxText(child) && child.text.trim())
            found.push(child.text.trim());
        if (ts.isStringLiteral(child) && !ts.isJsxAttribute(child.parent))
            found.push(child.text);
        ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
    return found;
}

// Isian yang bila ditaruh di slot `filters` berarti filter keluar dari panel kiri.
const filterControls = new Set([
    'Input',
    'Select',
    'NativeSelect',
    'InlineLookup',
    'DatePicker',
    'DateTimePicker',
    'MultiSelect',
    'Combobox',
    'Switch',
    'Checkbox',
    'Textarea',
    'input',
    'select',
    'textarea',
]);
const tableStyle =
    /\[&|(?:^|\s|["'`])(?:text|font|bg|border|rounded|p[xy]?|h)-/;
const unsavedHint =
    'Kartu yang bisa diubah melaporkan isian yang belum disimpan lewat `dirty` (usePageDialogRecord, atau PageDialog bila pemanggil memegang isiannya), supaya Escape, Kembali, dan Tutup bertanya sebelum membuangnya.';

// Layar: daftar, tabel, dan susunan form.
for (const file of screens) {
    const source = parse(file);
    const report = reporter(file, source);
    const imports = new Map<string, { imported: string; module: string }>();
    const elements: Element[] = [];
    const visit = (node: ts.Node) => {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings))
                for (const specifier of bindings.elements) {
                    const imported = (specifier.propertyName ?? specifier.name)
                        .text;
                    imports.set(specifier.name.text, {
                        imported,
                        module: node.moduleSpecifier.text,
                    });
                    if (
                        imported === 'Table' &&
                        node.moduleSpecifier.text ===
                            '@operations-metta/ui/table'
                    )
                        report(
                            node,
                            'Gunakan DataTable dari @operations-metta/ui/data-table. Baris khusus memakai renderRows, bukan frame Table terpisah.',
                        );
                }
        }
        if (isElement(node)) elements.push(node);
        // Record tersimpan terbuka langsung dalam mode Ubah bagi pengguna yang berhak, jadi mode edit diturunkan
        // dari izin (`const editing = record === null || canUpdate`), bukan saklar baca/ubah di state. State
        // `editing` bertipe union (baris rincian yang sedang dibuka di popup) tidak ditolak.
        if (
            ts.isVariableDeclaration(node) &&
            ts.isArrayBindingPattern(node.name) &&
            node.name.elements[0]?.getText() === 'editing' &&
            node.initializer &&
            ts.isCallExpression(node.initializer) &&
            node.initializer.expression.getText() === 'useState' &&
            (!node.initializer.typeArguments ||
                node.initializer.typeArguments[0]?.getText() === 'boolean')
        )
            report(
                node,
                'Record tersimpan langsung terbuka dalam mode Ubah bila pengguna berhak mengubahnya; turunkan `editing` dari izin, bukan dari useState.',
            );
        // Escape, Kembali, dan Tutup hanya bertanya sebelum membuang isian kartu yang melaporkan `dirty`. Kartu baca
        // saja menulis `editing: false`.
        if (
            ts.isCallExpression(node) &&
            node.expression.getText() === 'usePageDialogRecord' &&
            node.arguments[0] &&
            ts.isObjectLiteralExpression(node.arguments[0])
        ) {
            const properties = node.arguments[0].properties;
            const editing = properties.find(
                (property) => property.name?.getText() === 'editing',
            );
            if (
                editing &&
                !(
                    ts.isPropertyAssignment(editing) &&
                    editing.initializer.kind === ts.SyntaxKind.FalseKeyword
                ) &&
                !properties.some(
                    (property) => property.name?.getText() === 'dirty',
                )
            )
                report(node, unsavedHint);
        }
        if (
            ts.isJsxElement(node) &&
            node.openingElement.tagName.getText() === 'PageDialog' &&
            !attribute(node.openingElement, 'dirty') &&
            elementsUnder(node).some(
                (element) =>
                    element.tagName.getText() === 'PageDialogContent' &&
                    attribute(element, 'editing') &&
                    literal(attribute(element, 'editing')) !== 'false',
            )
        )
            report(node, unsavedHint);
        ts.forEachChild(node, visit);
    };
    visit(source);

    const lists = elements.filter(
        (element) => element.tagName.getText() === 'ListPageLayout',
    );
    for (const element of elements) {
        const name = element.tagName.getText();
        if (name === 'table')
            report(
                element,
                'Gunakan DataTable SDK agar header, kolom, dan scroll tetap konsisten, bukan tabel HTML.',
            );
        if (['select', 'NativeSelect', 'FieldGroup'].includes(name))
            report(
                element,
                'Gunakan kontrol SDK di FormControl dan FormGrid, bukan susunan form lama.',
            );
        // Isian form rata kiri, angka juga (keputusan pemilik produk, 13 November 2026). Rata kanan hanya untuk sel
        // angka di tabel, yang diatur DataTable sendiri.
        if (
            name === 'Input' &&
            /\btext-(right|end)\b/.test(
                attribute(element, 'className')?.initializer?.getText() ?? '',
            )
        )
            report(
                element,
                'Isian form rata kiri, termasuk angka; jangan beri Input text-right.',
            );
        const type = literal(attribute(element, 'type'));
        if (type === 'date' || type === 'datetime-local')
            report(element, 'Gunakan DatePicker atau DateTimePicker SDK.');
        if (type === 'search' && lists.length)
            report(
                element,
                'Pencarian daftar halaman ada di toolbar lewat `search` pada RecordActionBar, bukan kotak pencarian sendiri.',
            );
        const binding = imports.get(name);
        if (binding?.imported === 'DataTable') {
            if (binding.module !== '@operations-metta/ui/data-table')
                report(
                    element,
                    'Impor DataTable dari @operations-metta/ui/data-table.',
                );
            const className = literal(attribute(element, 'className')) ?? '';
            if (tableStyle.test(className))
                report(
                    element,
                    'Gaya tabel milik SDK; className DataTable hanya untuk layout.',
                );
        }
    }

    for (const element of elements) {
        const imported = imports.get(element.tagName.getText())?.imported;
        if (
            imported === 'FormErrorSummary' &&
            !file.endsWith('form-error-header.tsx')
        )
            report(
                element,
                'Ringkasan kesalahan form ditampilkan lewat FormErrorHeader, yang melekat di bawah toolbar; jangan memasang FormErrorSummary sendiri.',
            );
        // Ringkasan kesalahan mengenali percobaan Simpan dari `submit` atau tombol bertanda `data-action="save"`;
        // tombol Simpan tanpa tanda itu membuat Simpan yang masih gagal tampak tidak bekerja.
        if (
            ['Button', 'button'].includes(element.tagName.getText()) &&
            ts.isJsxOpeningElement(element) &&
            literal(attribute(element, 'type')) !== 'submit' &&
            !attribute(element, 'data-action') &&
            elementText(element.parent).some((text) =>
                text.startsWith('Simpan'),
            )
        )
            report(
                element,
                'Tombol Simpan memakai ActionButton action="save", type="submit", atau data-action="save" supaya ringkasan kesalahan mengenali percobaan simpan.',
            );
        if (imported !== 'FormErrorHeader') continue;
        // `sticky` hanya menahan elemen selama induknya masih terlihat. Pembungkus yang isinya hanya ringkasan
        // ikut tergulir keluar bersama ringkasannya, jadi ringkasan harus bersaudara langsung dengan isi form.
        let container: ts.Node = ts.isJsxOpeningElement(element)
            ? element.parent
            : element;
        while (
            !ts.isJsxElement(container.parent) &&
            !ts.isJsxFragment(container.parent) &&
            !ts.isSourceFile(container.parent)
        )
            container = container.parent;
        const wrapper = container.parent;
        if (
            ts.isJsxElement(wrapper) &&
            /^[a-z]/.test(wrapper.openingElement.tagName.getText()) &&
            wrapper.children.filter(
                (child) => !ts.isJsxText(child) || child.text.trim(),
            ).length === 1
        )
            report(
                element,
                'FormErrorHeader ditaruh langsung di antara isi form sesudah toolbar, bukan di pembungkus yang hanya berisi dirinya; pembungkus itu membuatnya ikut tergulir keluar. Pakai className untuk jarak.',
            );
    }

    for (const list of lists) {
        if (literal(attribute(list, 'filterSide')) === 'right')
            report(list, 'Panel filter daftar ada di kiri datatable.');
        const filters = attribute(list, 'filters');
        for (const control of filters ? elementsUnder(filters) : [])
            if (filterControls.has(control.tagName.getText()))
                report(
                    control,
                    'Isian filter masuk FilterPane kiri lewat filterPanel dan tombol filter toolbar; slot filters hanya untuk pesan.',
                );
        // Daftar utama: tabel di dalam ListPageLayout, bukan tabel di kartu atau dialog yang dirender di sampingnya.
        const element = ts.isJsxOpeningElement(list) ? list.parent : list;
        for (const table of elementsUnder(element)) {
            if (imports.get(table.tagName.getText())?.imported !== 'DataTable')
                continue;
            if (
                literal(attribute(table, 'scrollMode')) === 'inline' ||
                literal(attribute(table, 'showRowNumbers')) === 'false' ||
                literal(attribute(table, 'actionsPlacement')) === 'trailing'
            )
                report(
                    table,
                    'Daftar utama memakai scroll viewport, nomor baris, dan menu aksi inline SDK.',
                );
        }
    }
}

// Dialog bawaan browser: CoreERP menjaganya dengan ESLint (`no-alert`, `no-restricted-properties`,
// `no-restricted-syntax`). Di sini dibaca langsung dari AST.
const browserDialogs = new Set(['alert', 'confirm', 'prompt']);
const browserGlobals = new Set(['window', 'globalThis', 'self']);
const dialogHint =
    'Gunakan @operations-metta/ui/use-confirmation atau Dialog SDK; jangan memakai dialog bawaan browser.';
for (const file of browserCode) {
    const source = parse(file);
    const report = reporter(file, source);
    const declared = new Set<string>();
    const collect = (node: ts.Node) => {
        if (
            (ts.isVariableDeclaration(node) ||
                ts.isParameter(node) ||
                ts.isFunctionDeclaration(node) ||
                ts.isBindingElement(node)) &&
            node.name &&
            ts.isIdentifier(node.name)
        )
            declared.add(node.name.text);
        if (ts.isImportSpecifier(node)) declared.add(node.name.text);
        ts.forEachChild(node, collect);
    };
    collect(source);
    const member = (node: ts.Expression): string | null => {
        if (
            ts.isPropertyAccessExpression(node) &&
            browserGlobals.has(node.expression.getText())
        )
            return node.name.text;
        if (
            ts.isElementAccessExpression(node) &&
            browserGlobals.has(node.expression.getText()) &&
            ts.isStringLiteralLike(node.argumentExpression)
        )
            return node.argumentExpression.text;
        return null;
    };
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (
                ts.isIdentifier(callee) &&
                browserDialogs.has(callee.text) &&
                !declared.has(callee.text)
            )
                report(node, dialogHint);
            if (
                ts.isPropertyAccessExpression(callee) &&
                callee.name.text === 'reportValidity'
            )
                report(
                    node,
                    'Tampilkan validasi melalui header dan field SDK, bukan reportValidity() browser.',
                );
        }
        if (
            (ts.isPropertyAccessExpression(node) ||
                ts.isElementAccessExpression(node)) &&
            browserDialogs.has(member(node) ?? '')
        )
            report(node, dialogHint);
        if (
            ts.isVariableDeclaration(node) &&
            ts.isObjectBindingPattern(node.name) &&
            node.initializer &&
            browserGlobals.has(node.initializer.getText())
        )
            for (const element of node.name.elements) {
                const name = (element.propertyName ?? element.name).getText();
                if (browserDialogs.has(name)) report(element, dialogHint);
            }
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) &&
            node.left.name.text === 'returnValue'
        )
            report(
                node,
                'Jangan memicu popup keluar halaman bawaan browser; gunakan konfirmasi SDK untuk navigasi aplikasi.',
            );
        if (
            isElement(node) &&
            ['form', 'Form'].includes(node.tagName.getText()) &&
            !attribute(node, 'noValidate')
        )
            report(
                node,
                'Form harus memakai noValidate dan menampilkan validasi di header serta field SDK.',
            );
        // Tombol nonaktif menjelaskan alasannya lewat title, misalnya Posting yang menunggu Simpan. Tanpa pointer,
        // title itu tidak pernah tampil saat tombol disorot.
        if (
            (isElement(node) &&
                ['Button', 'ActionButton'].includes(node.tagName.getText()) &&
                attribute(node, 'className')
                    ?.getText()
                    .includes('disabled:pointer-events-none')) ||
            (ts.isVariableDeclaration(node) &&
                node.name.getText() === 'buttonVariants' &&
                node.initializer
                    ?.getText()
                    .includes('disabled:pointer-events-none'))
        )
            report(
                node,
                'Tombol nonaktif tetap menerima pointer supaya title berisi alasannya tampil saat disorot; jangan pakai disabled:pointer-events-none.',
            );
        ts.forEachChild(node, visit);
    };
    visit(source);
}

// Core netral sektor: istilah dinas kesehatan milik module layanan kesehatan, bukan Core (src/ dan migration Core).
const sectorName =
    /\bdinkes\b|\bdinas[ _-]+kesehatan\b|\b(?:dinkes|dinas)_[a-z0-9_]+\b|\b(?:Dinkes|DinasKesehatan)(?:Id|ID|Organization|Tenant|Unit|Policy)\b/i;
const oldLabels = /DINKES-DEFAULT|\bDK-\d+/i;
const coreFiles = [
    ...files(join(root, 'src'), /\.(ts|tsx|css|json)$/),
    ...files(join(root, 'database'), /\.sql$/),
];
for (const file of coreFiles)
    for (const [index, line] of readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .entries())
        if (sectorName.test(line) || oldLabels.test(line))
            violations.push(
                `${shown(file)}:${index + 1}: Core memakai istilah netral (organization, facility, service group, catalog, policy); istilah dinas kesehatan milik module layanan kesehatan.`,
            );

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`${violations.length} UI rule violation(s).`);
    process.exit(1);
}
console.log(
    `UI rules hold across ${screens.length} screen files, ${browserCode.length} browser files, and ${coreFiles.length} Core files.`,
);
