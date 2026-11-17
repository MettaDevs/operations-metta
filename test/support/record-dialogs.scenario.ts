// Dijalankan test/platform/shell/record-dialogs.test.ts dengan `--preload` DOM, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from '../../src/platform/shell/api.ts';
import { FormErrorHeader } from '../../src/platform/shell/form-error-header.tsx';
import type { RecordPages } from '../../src/platform/shell/page.ts';
import {
    RecordDialogs,
    RecordPagesProvider,
} from '../../src/platform/shell/record-dialogs.tsx';

// Penolakan yang gagal di dalam act tidak mengakhiri proses sendiri; tanpa ini test menunggu sampai batas waktunya.
process.on('unhandledRejection', (error) => {
    console.error(error);
    process.exit(1);
});

const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
window.HTMLElement.prototype.scrollIntoView = () => {};
Object.assign(globalThis, {
    CSS: { escape: (value: string) => value },
    matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
    }),
});

const refused = new ApiError(422, {
    message: 'Data ini sudah melakukan Pembayaran diKasir!',
    errors: { _form: ['Data ini sudah melakukan Pembayaran diKasir!'] },
    actions: [
        {
            kind: 'open',
            label: 'Buka pembayaran KSR-0001',
            page: 'core.payment',
            recordId: 'sale-1',
        },
    ],
});
assert.deepEqual(refused.actions, [
    {
        kind: 'open',
        label: 'Buka pembayaran KSR-0001',
        page: 'core.payment',
        recordId: 'sale-1',
    },
]);
assert.deepEqual(
    new ApiError(422, {
        errors: { _form: ['Ditolak.'] },
        actions: [
            { kind: 'open', label: 'Buka', page: 'x.unknown', recordId: '1' },
        ],
    }).actions,
    [],
    'an action this browser does not know is dropped, the message stays',
);

const submits: string[] = [];
const pages: RecordPages = {
    'core.payment': {
        title: 'Pembayaran',
        component: ({ id }) =>
            h(
                'form',
                {
                    onSubmit: (event: React.SyntheticEvent) => {
                        event.preventDefault();
                        submits.push(`payment ${id}`);
                    },
                },
                h('p', null, `Pembayaran untuk ${id}`),
                h('button', { type: 'submit' }, 'Batal Pembayaran'),
            ),
    },
    'core.inventory-location': {
        title: 'Petugas lokasi',
        component: ({ id }) => h('p', null, `Petugas lokasi ${id}`),
    },
    'core.purchase-order': {
        title: 'Purchase order',
        component: ({ id }) => h('p', null, `Purchase order ${id}`),
    },
    'core.purchase-receipt': {
        title: 'Penerimaan barang',
        component: ({ id }) => h('p', null, `Penerimaan ${id}`),
    },
};

function ReturnForm(): React.ReactNode {
    const [reason, setReason] = React.useState('');
    return h(
        'form',
        {
            onSubmit: (event: React.SyntheticEvent) => {
                event.preventDefault();
                submits.push('return');
            },
        },
        h(FormErrorHeader, {
            errors: refused.errors,
            errorActions: refused.actions,
            operation: 'Retur belum disimpan',
        }),
        h('input', {
            'aria-label': 'Alasan retur',
            value: reason,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                setReason(event.target.value),
        }),
    );
}

const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (item) => item.textContent.trim() === name,
    );
const press = (element: HTMLElement | undefined) =>
    React.act(async () => {
        assert.ok(element);
        element.click();
        await tick();
    });

const root = createRoot(document.getElementById('root')!);
await React.act(async () => {
    root.render(h(ReturnForm));
    await tick();
});
assert.equal(
    button('Buka pembayaran KSR-0001'),
    undefined,
    'no button outside the app layout, where nothing can open the record',
);

await React.act(async () => {
    root.render(
        h(RecordPagesProvider, {
            pages,
            children: h(RecordDialogs, { children: h(ReturnForm) }),
        }),
    );
    await tick();
});
const reason = document.querySelector<HTMLInputElement>(
    'input[aria-label="Alasan retur"]',
)!;
await React.act(async () => {
    Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )!.set!.call(reason, 'Pembeli salah beli');
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
});

await press(button('Buka pembayaran KSR-0001'));
assert.match(document.body.textContent, /Pembayaran untuk sale-1/);
await press(button('Batal Pembayaran'));
assert.deepEqual(
    submits,
    ['payment sale-1'],
    'saving inside the opened record never submits the refused form',
);

await press(
    [...document.querySelectorAll('button')].find(
        (item) => item.getAttribute('aria-label') === 'Tutup halaman',
    ),
);
assert.doesNotMatch(document.body.textContent, /Pembayaran untuk sale-1/);
assert.equal(
    document.querySelector<HTMLInputElement>('input[aria-label="Alasan retur"]')
        ?.value,
    'Pembeli salah beli',
    'closing the record keeps what was typed',
);
assert.deepEqual(submits, ['payment sale-1'], 'closing does not save');

await React.act(async () => {
    root.unmount();
    await tick();
});
process.exit(0);
