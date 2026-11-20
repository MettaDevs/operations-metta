import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CopyButton } from '../../src/components/copy-button.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const button = () => document.querySelector('button')!;
const click = () =>
    React.act(async () => {
        button().click();
        await tick();
    });

let clipboard = '';
let refuse = false;
Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
        writeText: (text: string) => {
            if (refuse) return Promise.reject(new Error('denied'));
            clipboard = text;
            return Promise.resolve();
        },
    },
});

let failures = 0;
try {
    await React.act(async () => {
        root.render(
            h(CopyButton, {
                text: () => 'detail bantuan',
                onError: () => failures++,
                children: 'Salin detail bantuan',
            }),
        );
        await tick();
    });
    assert.equal(button().textContent, 'Salin detail bantuan');

    await click();
    assert.equal(clipboard, 'detail bantuan');
    assert.equal(button().textContent, 'Disalin');

    await React.act(async () => {
        await tick(1600);
    });
    assert.equal(button().textContent, 'Salin detail bantuan');

    refuse = true;
    await click();
    assert.equal(failures, 1);
    assert.equal(button().textContent, 'Salin detail bantuan');
} finally {
    React.act(() => {
        root.unmount();
    });
}
