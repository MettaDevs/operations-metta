// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
    PageDialog,
    PageDialogContent,
    usePageDialogRecord,
} from '../../src/components/page-dialog.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
const closes: boolean[] = [];

// Kartu yang dibuka dari Baru di lookup: pembukanya hanya menutup, tanpa penjaga sendiri.
function Card(): React.ReactNode {
    const [name, setName] = React.useState('');
    usePageDialogRecord({ recordTitle: 'Lokasi baru', dirty: name !== '' });
    return h('input', {
        'aria-label': 'Nama',
        value: name,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            setName(event.target.value),
    });
}

// Pemanggil yang memegang isian dan merender PageDialog sendiri, tanpa komponen kartu di dalamnya.
function Owner(): React.ReactNode {
    const [name, setName] = React.useState('');
    return h(
        PageDialog,
        {
            open: true,
            dirty: name !== '',
            onOpenChange: (open: boolean) => closes.push(open),
        },
        h(
            PageDialogContent,
            { title: 'Pekerjaan' },
            h('input', {
                'aria-label': 'Nama',
                value: name,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                    setName(event.target.value),
            }),
        ),
    );
}

const field = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Nama"]')!;
const typeName = (value: string) =>
    React.act(async () => {
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!.call(field(), value);
        field().dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
    });
const escape = () =>
    React.act(async () => {
        field().dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
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
const press = (element: HTMLElement | undefined) =>
    React.act(async () => {
        assert.ok(element, 'expected button exists');
        element.click();
        await tick();
    });
const confirmation = () => document.querySelector('[role="alertdialog"]');

try {
    await React.act(async () => {
        root.render(
            h(
                PageDialog,
                {
                    open: true,
                    onOpenChange: (open: boolean) => closes.push(open),
                },
                h(PageDialogContent, { title: 'Lokasi' }, h(Card)),
            ),
        );
        await tick();
    });

    await escape();
    assert.deepEqual(closes, [false], 'an untouched card closes on Escape');
    closes.length = 0;

    await typeName('Gudang baru');
    await escape();
    assert.deepEqual(
        closes,
        [],
        'Escape on a card with typed data does not close it',
    );
    assert.ok(
        confirmation()?.textContent.includes(
            'Buang perubahan yang belum disimpan?',
        ),
        'Escape asks before discarding',
    );
    await press(button('Batal'));
    assert.deepEqual(closes, [], 'Batal keeps the card open');
    assert.equal(field().value, 'Gudang baru', 'the typed data stays');

    await press(button('Tutup halaman'));
    assert.deepEqual(closes, [], 'the close button asks too');
    await press(button('Buang perubahan'));
    assert.deepEqual(
        closes,
        [false],
        'the card closes after the user chooses to discard',
    );
    closes.length = 0;

    await React.act(async () => {
        root.render(h(Owner, { key: 'owner' }));
        await tick();
    });
    await escape();
    assert.deepEqual(
        closes,
        [false],
        'an untouched dialog owned by its caller closes on Escape',
    );
    closes.length = 0;

    await typeName('Petani');
    await escape();
    assert.deepEqual(
        closes,
        [],
        'Escape does not close a dialog whose caller reports dirty',
    );
    assert.ok(
        confirmation()?.textContent.includes(
            'Buang perubahan yang belum disimpan?',
        ),
        'the caller-owned dialog asks before discarding',
    );
    await press(button('Buang perubahan'));
    assert.deepEqual(
        closes,
        [false],
        'the caller-owned dialog closes after the user chooses to discard',
    );
    console.log(
        'A card with unsaved changes asks before Escape or close discards them.',
    );
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
