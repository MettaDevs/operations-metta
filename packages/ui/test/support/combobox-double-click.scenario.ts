// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '../../src/components/select.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
window.HTMLElement.prototype.scrollIntoView = () => {};

const picked: (string | null)[] = [];
const pressedBelow: string[] = [];
// Satu klik di titik yang sama dengan pilihan; `detail` adalah hitungan klik dari peramban.
const press = (element: Element, detail: number) =>
    React.act(async () => {
        for (const type of ['mousedown', 'mouseup', 'click'])
            element.dispatchEvent(
                new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    detail,
                }),
            );
        if (detail === 2)
            element.dispatchEvent(
                new MouseEvent('dblclick', {
                    bubbles: true,
                    cancelable: true,
                    detail,
                }),
            );
        await tick();
    });

try {
    await React.act(async () => {
        root.render(
            h(
                'div',
                null,
                h(Select, {
                    items: ['FEFO', 'FIFO', 'Pilih batch manual'],
                    ariaLabel: 'Cara pengambilan',
                    onValueChange: (value) => picked.push(value),
                }),
                // Kontrol di bawah daftar, misalnya dropdown field berikutnya.
                h(
                    'button',
                    {
                        type: 'button',
                        id: 'below',
                        onMouseDown: () => pressedBelow.push('mousedown'),
                        onClick: () => pressedBelow.push('click'),
                    },
                    'Cara mutasi',
                ),
            ),
        );
        await tick();
    });
    await press(
        document.querySelector('[data-slot="select-control"] button')!,
        1,
    );
    const manual = [...document.querySelectorAll('[role="option"]')].find(
        (option) => option.textContent === 'Pilih batch manual',
    );
    assert.ok(manual, 'the list is open');
    await press(manual, 1);
    assert.deepEqual(picked, ['Pilih batch manual'], 'the first click picks');

    const below = document.getElementById('below')!;
    await press(below, 2);
    assert.deepEqual(
        pressedBelow,
        [],
        'the second click of the double-click does not reach the control under the list',
    );

    await press(below, 1);
    assert.deepEqual(
        pressedBelow,
        ['mousedown', 'click'],
        'a new click on that control works',
    );
    console.log('Double-clicking an option does not open the control below.');
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
