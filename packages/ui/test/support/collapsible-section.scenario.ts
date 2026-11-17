import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '../../src/components/collapsible-section.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === name,
    )!;
const click = (element: HTMLButtonElement) =>
    React.act(async () => {
        element.click();
        await tick();
    });

try {
    await React.act(async () => {
        root.render(
            h(CollapsibleSectionGroup, {
                defaultValue: ['address'],
                children: [
                    h(CollapsibleSection, {
                        key: 'address',
                        value: 'address',
                        title: 'Alamat',
                        children: h('p', null, 'Isi alamat'),
                    }),
                    h(CollapsibleSection, {
                        key: 'contact',
                        value: 'contact',
                        title: 'Kontak',
                        keepMounted: true,
                        children: h('input', {
                            defaultValue: 'Draft',
                            'aria-label': 'Nomor',
                        }),
                    }),
                ],
            }),
        );
        await tick();
    });
    await click(button('Kontak'));
    assert.equal(button('Kontak').getAttribute('aria-expanded'), 'true');
    assert.equal(button('Alamat').getAttribute('aria-expanded'), 'true');
    const addressContent = button('Alamat')
        .closest('[data-slot="collapsible-section"]')!
        .querySelector<HTMLElement>('[data-slot="accordion-content"]')!;
    await click(button('Alamat'));
    assert.equal(button('Alamat').getAttribute('aria-expanded'), 'false');
    assert.equal(addressContent.hidden, true);
    assert.equal(button('Kontak').getAttribute('aria-expanded'), 'true');
    const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Nomor"]',
    )!;
    input.value = 'Draft tersimpan';
    await click(button('Kontak'));
    assert.equal(
        input.closest<HTMLElement>('[data-slot="accordion-content"]')!.hidden,
        true,
    );
    await click(button('Kontak'));
    assert.equal(
        document.querySelector<HTMLInputElement>('input[aria-label="Nomor"]')!
            .value,
        'Draft tersimpan',
    );
} finally {
    React.act(() => {
        root.unmount();
    });
}
