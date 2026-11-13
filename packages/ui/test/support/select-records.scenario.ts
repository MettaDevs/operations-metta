// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentLines } from '../../src/components/document-lines.tsx';
import { Input } from '../../src/components/input.tsx';
import {
    PageDialog,
    PageDialogContent,
} from '../../src/components/page-dialog.tsx';

type Item = { id: string; code: string; name: string };
type Line = { key: string; item: Item; quantity: string };

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => wait(45);
window.HTMLElement.prototype.scrollIntoView = () => {};
// jsdom tidak menyediakan CSS.escape; kunci baris di skenario ini tidak berisi karakter yang perlu di-escape.
Object.assign(globalThis, { CSS: { escape: (value: string) => value } });

const items: Item[] = [
    { id: 'a', code: 'B-001', name: 'Amoksisilin' },
    { id: 'b', code: 'B-002', name: 'Ibuprofen' },
    { id: 'c', code: 'B-003', name: 'Parasetamol' },
];
const queries: string[] = [];
const added: Item[][] = [];
const closes: boolean[] = [];

function Card(): React.ReactNode {
    const [lines, setLines] = React.useState<Line[]>([]);
    return h(DocumentLines<Line, Item>, {
        title: 'Baris amprah',
        data: lines,
        getRowKey: (line) => line.key,
        getRowLabel: (line) => line.item.name,
        onAddRow: () => undefined,
        selectRecords: {
            noun: 'barang',
            loadItems: ({ query }) => {
                queries.push(query);
                return Promise.resolve({
                    items: items.filter((item) =>
                        item.name.toLowerCase().includes(query.toLowerCase()),
                    ),
                    nextCursor: null,
                });
            },
            columns: [
                { id: 'code', header: 'Kode', cell: (item) => item.code },
                { id: 'name', header: 'Nama', cell: (item) => item.name },
            ],
            getItemValue: (item) => item.id,
            getItemLabel: (item) => item.name,
            focusColumnId: 'quantity',
            onAdd: (chosen) => {
                added.push(chosen);
                setLines((current) => [
                    ...current,
                    ...chosen.map((item) => ({
                        key: `${item.id}-${current.length}`,
                        item,
                        quantity: '',
                    })),
                ]);
            },
        },
        columns: [
            { id: 'item', header: 'Barang', cell: (line) => line.item.name },
            {
                id: 'quantity',
                header: 'Jumlah',
                content: 'control',
                cell: (line) =>
                    h(Input, {
                        'aria-label': `Jumlah ${line.item.name}`,
                        value: line.quantity,
                        onChange: () => undefined,
                    }),
            },
        ],
    });
}

const picker = () =>
    [...document.querySelectorAll('[data-slot="dialog-content"]')].find(
        (dialog) => dialog.textContent.includes('Pilih barang'),
    );
const button = (name: string, scope: ParentNode = document) =>
    [...scope.querySelectorAll('button')].find(
        (item) =>
            item.getAttribute('aria-label') === name ||
            item.textContent.trim() === name,
    );
const press = (element: Element | null | undefined) =>
    React.act(async () => {
        assert.ok(element, 'expected control exists');
        // Klik di peramban memfokuskan tombolnya; tumpukan kartu memakai elemen itu sebagai pembuka.
        (element as HTMLElement).focus();
        (element as HTMLElement).click();
        await tick();
    });
const key = (
    target: Element | null | undefined,
    name: string,
    init: KeyboardEventInit = {},
) =>
    React.act(async () => {
        assert.ok(target, `expected a target for ${name}`);
        target.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: name,
                bubbles: true,
                cancelable: true,
                ...init,
            }),
        );
        await tick();
    });
const search = () =>
    picker()?.querySelector<HTMLInputElement>('input[data-slot="input"]') ??
    null;
const typeSearch = (value: string) =>
    React.act(async () => {
        const field = search()!;
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(400);
    });
const pickerOpen = () => picker() !== undefined;
const rows = () => [
    ...(picker()?.querySelectorAll<HTMLElement>('tbody [data-row-key]') ?? []),
];

try {
    await React.act(async () => {
        root.render(
            h(
                PageDialog,
                { open: true, onOpenChange: (open) => closes.push(open) },
                h(PageDialogContent, { title: 'Amprah' }, h(Card)),
            ),
        );
        await tick();
    });

    await press(button('Tambah banyak'));
    assert.ok(pickerOpen(), 'Tambah banyak opens the picker');
    assert.equal(
        document.activeElement,
        search(),
        'the picker opens with the search field focused',
    );
    assert.equal(rows().length, 3, 'the first batch lists every item');

    await press(
        document.querySelector('button[aria-label="Pilih Parasetamol"]'),
    );
    await typeSearch('ibu');
    assert.equal(queries.at(-1), 'ibu', 'the search goes to the loader');
    assert.equal(rows().length, 1, 'the search narrows the list');
    await press(rows()[0]);
    assert.ok(
        document.body.textContent.includes('2 barang dipilih'),
        'a choice hidden by a later search stays chosen',
    );

    await press(button('Tambah 2 barang'));
    assert.equal(pickerOpen(), false, 'Tambah closes the picker');
    assert.deepEqual(
        added.at(-1)?.map((item) => item.name),
        ['Parasetamol', 'Ibuprofen'],
        'one line per chosen record, in the order they were chosen',
    );
    assert.equal(
        document.activeElement?.getAttribute('aria-label'),
        'Jumlah Parasetamol',
        'focus moves to the quantity of the first new line',
    );

    await press(button('Tambah banyak'));
    await key(search(), 'Escape');
    assert.equal(pickerOpen(), false, 'Escape closes the picker');
    assert.deepEqual(closes, [], 'Escape leaves the card open');
    assert.equal(
        document.activeElement,
        button('Tambah banyak'),
        'focus returns to Tambah banyak',
    );

    await press(button('Tambah banyak'));
    await key(search(), 'ArrowDown');
    assert.equal(
        document.activeElement,
        rows()[0],
        'ArrowDown moves from the search field to the first row',
    );
    await key(rows()[0], ' ');
    await key(rows()[0], 'ArrowDown');
    assert.equal(document.activeElement, rows()[1], 'ArrowDown moves rows');
    await key(rows()[1], 'ArrowUp');
    await key(rows()[0], 'ArrowUp');
    assert.equal(
        document.activeElement,
        search(),
        'ArrowUp on the first row returns to the search field',
    );
    await key(rows()[1], 'Enter');
    assert.deepEqual(
        added.at(-1)?.map((item) => item.name),
        ['Amoksisilin'],
        'Enter adds the checked records, not the focused row',
    );

    await press(button('Tambah banyak'));
    await key(rows()[2], 'Enter');
    assert.deepEqual(
        added.at(-1)?.map((item) => item.name),
        ['Parasetamol'],
        'Enter with nothing checked adds the focused row',
    );

    await press(button('Tambah banyak'));
    assert.equal(
        button('Tambah', picker())?.hasAttribute('disabled'),
        true,
        'Tambah in the picker waits for a choice',
    );
    await press(document.querySelector('button[aria-label="Pilih Ibuprofen"]'));
    await key(search(), 'Enter', { ctrlKey: true });
    assert.deepEqual(
        added.at(-1)?.map((item) => item.name),
        ['Ibuprofen'],
        'Ctrl+Enter adds from anywhere in the picker',
    );
    assert.deepEqual(closes, [], 'the card stayed open throughout');
    console.log('Tambah banyak adds one line per chosen record.');
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
