// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InlineLookup } from '../../src/components/inline-lookup.tsx';
import { Select } from '../../src/components/select.tsx';

type Row = { id: string; name: string };

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
window.HTMLElement.prototype.scrollIntoView = () => {};

const rows: Row[] = [
    { id: '1', name: 'Ani' },
    { id: '2', name: 'Budi' },
    { id: '3', name: 'Bunga' },
];
const chosen: string[] = [];
const submitted: string[] = [];
const input = () =>
    document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const type = (value: string) =>
    React.act(async () => {
        input().focus();
        if (input().getAttribute('aria-expanded') !== 'true')
            input().dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true, button: 0 }),
            );
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!.call(input(), value);
        input().dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
    });
// Mengembalikan apakah peramban masih boleh menjalankan aksi bawaan Enter, yaitu mengirim form induk.
const press = (key: string) =>
    React.act(async () => {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        input().dispatchEvent(event);
        await tick();
        return !event.defaultPrevented;
    });
const inForm = (child: React.ReactNode) =>
    h(
        'form',
        {
            noValidate: true,
            onSubmit: (event: React.SyntheticEvent) => {
                event.preventDefault();
                submitted.push('submit');
            },
        },
        child,
    );

try {
    await React.act(async () => {
        root.render(
            inForm(
                h(InlineLookup<Row>, {
                    label: 'Pasien',
                    loadItems: ({ query }) =>
                        Promise.resolve({
                            items: rows.filter((row) =>
                                row.name
                                    .toLowerCase()
                                    .startsWith(query.toLowerCase()),
                            ),
                            nextCursor: null,
                        }),
                    value: null,
                    onValueChange: (row) => chosen.push(row.id),
                    getItemValue: (row) => row.id,
                    getItemLabel: (row) => row.name,
                    columns: [
                        { id: 'name', header: 'Nama', cell: (row) => row.name },
                    ],
                    showDetails: false,
                }),
            ),
        );
        await tick();
    });

    await type('zz');
    assert.equal(
        await press('Enter'),
        false,
        'Enter in a lookup with no match never submits the form',
    );
    assert.deepEqual(chosen, [], 'Enter with no match picks nothing');
    assert.equal(
        input().value,
        'zz',
        'Enter with no match keeps the typed text',
    );
    assert.equal(
        input().getAttribute('aria-expanded'),
        'true',
        'Enter with no match keeps the list open',
    );

    await type('bu');
    assert.equal(
        input().hasAttribute('aria-activedescendant'),
        false,
        'results that arrived after typing are not highlighted',
    );
    assert.equal(
        await press('Enter'),
        false,
        'Enter on loaded results never submits the form',
    );
    assert.deepEqual(chosen, ['2'], 'Enter picks the first loaded result');

    await type('bu');
    await press('ArrowDown');
    await press('ArrowDown');
    assert.equal(
        await press('Enter'),
        false,
        'Enter on a highlighted row never submits the form',
    );
    assert.deepEqual(
        chosen,
        ['2', '3'],
        'Enter picks the highlighted row, not the first one',
    );

    await React.act(async () => {
        root.render(
            inForm(
                h(Select, {
                    key: 'select',
                    items: ['Stok masuk', 'Stok keluar'],
                    ariaLabel: 'Arah',
                }),
            ),
        );
        await tick();
    });
    await React.act(async () => {
        const trigger = document.querySelector(
            '[data-slot="select-control"] button',
        )!;
        trigger.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, button: 0 }),
        );
        (trigger as HTMLElement).click();
        await tick();
    });
    await type('zzz');
    assert.equal(
        await press('Enter'),
        false,
        'Enter in the Select search never submits the form',
    );
    assert.equal(
        input().value,
        'zzz',
        'Enter in the Select search with no match keeps the typed text',
    );
    assert.deepEqual(submitted, [], 'no form submission happened');
    console.log('Enter in a picker picks or does nothing, never submits.');
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
