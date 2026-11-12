// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InlineLookup } from '../../src/components/inline-lookup.tsx';

type Row = { id: string; name: string };

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
const click = async (element: Element | null | undefined) =>
    React.act(async () => {
        assert.ok(element, 'expected control exists');
        element.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                pointerType: 'mouse',
            }),
        );
        element.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, button: 0 }),
        );
        (element as HTMLElement).click();
        element.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                button: 0,
                pointerType: 'mouse',
            }),
        );
        await tick();
    });
const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (item) =>
            item.getAttribute('aria-label') === name ||
            item.textContent.trim() === name,
    );
window.HTMLElement.prototype.scrollIntoView = () => {};

const rows: Row[] = [
    { id: '1', name: 'Ani' },
    { id: '2', name: 'Budi' },
];
const chosen: Row[] = [];
const lookup = (showFullListButton: boolean) =>
    h(InlineLookup<Row>, {
        label: 'Pasien',
        loadItems: () => Promise.resolve({ items: rows, nextCursor: null }),
        value: null,
        onValueChange: (row) => chosen.push(row),
        getItemValue: (row) => row.id,
        getItemLabel: (row) => row.name,
        columns: [{ id: 'name', header: 'Nama', cell: (row) => row.name }],
        showDetails: false,
        showFullListButton,
    });

try {
    await React.act(async () => {
        root.render(lookup(false));
        await tick();
    });
    assert.equal(
        button('Daftar lengkap pasien'),
        undefined,
        'magnifier stays hidden unless requested',
    );

    await React.act(async () => {
        root.render(lookup(true));
        await tick();
    });
    await click(button('Daftar lengkap pasien'));
    await React.act(tick);
    assert.ok(
        document.body.textContent.includes('Daftar lengkap — Pasien'),
        'magnifier opens the full list dialog',
    );
    const budi = [...document.querySelectorAll('[role="dialog"] tr')].find(
        (row) => row.textContent.includes('Budi'),
    );
    await click(budi);
    await click(button('Pilih'));
    assert.deepEqual(
        chosen.map((row) => row.id),
        ['2'],
        'Pilih in the full list sets the field',
    );
    console.log('InlineLookup magnifier opens Daftar lengkap and chooses.');
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
