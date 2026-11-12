// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FactBox } from '../../src/components/fact-box.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 35));
const click = async (element: Element | null) =>
    React.act(async () => {
        assert.ok(element, 'expected control to exist');
        (element as HTMLElement).click();
        await tick();
    });
const render = async (node: React.ReactNode) =>
    React.act(async () => {
        root.render(node);
        await tick();
    });
const panel = () => document.querySelector('aside');

try {
    await render(
        h(FactBox, {
            details: h('p', { id: 'stock' }, 'Stok per lokasi'),
            children: 'Form barang',
        }),
    );
    assert.equal(panel()!.getAttribute('aria-label'), 'Detail');
    assert.match(panel()!.textContent, /Stok per lokasi/);
    assert.equal(
        document.querySelector('[role="tablist"]'),
        null,
        'details-only panel renders no tabs',
    );
    assert.doesNotMatch(document.body.textContent, /Lampiran/);
    assert.ok(
        document.querySelector('[aria-label="Ubah lebar panel detail"]'),
        'resize handle names only the details panel',
    );
    await click(document.querySelector('[aria-label="Sembunyikan detail"]'));
    assert.equal(document.getElementById('stock'), null);
    await click(document.querySelector('[aria-label="Tampilkan detail"]'));
    assert.ok(document.getElementById('stock'), 'details return when shown');

    await render(
        h(FactBox, {
            details: 'Detail aset',
            attachments: 'Daftar lampiran',
            children: 'Form aset',
        }),
    );
    assert.equal(panel()!.getAttribute('aria-label'), 'Detail dan lampiran');
    assert.deepEqual(
        [...document.querySelectorAll('[role="tab"]')].map(
            (tab) => tab.textContent,
        ),
        ['Detail', 'Lampiran'],
    );
    assert.ok(
        document.querySelector(
            '[aria-label="Sembunyikan detail dan lampiran"]',
        ),
    );
    console.log(
        'PASS: FactBox without attachments shows details only and names its controls after details; with attachments it keeps both tabs.',
    );
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
