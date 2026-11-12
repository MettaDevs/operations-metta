// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
    createSaveFeedback,
    FormErrorSummary,
} from '../../src/components/form-feedback.tsx';

let reducedMotion = false;
window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
})) as unknown as typeof window.matchMedia;
const h = React.createElement;
const root = createRoot(document.getElementById('root')!);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const act = (run: () => void) =>
    React.act(async () => {
        run();
        await tick();
    });
const summary = () =>
    document.querySelector<HTMLElement>('[data-slot="form-error-summary"]');
const save = () =>
    act(() =>
        document.querySelector<HTMLElement>('[data-action="save"]')!.click(),
    );

function RegistrationForm() {
    const [values, setValues] = React.useState({ patient: '', section: '' });
    const [errors, setErrors] = React.useState<Record<string, string[]>>({});
    const feedback = React.useMemo(
        () =>
            Object.keys(errors).length
                ? createSaveFeedback({
                      operation: 'Registrasi belum disimpan',
                      message: '',
                      errors,
                  })
                : null,
        [errors],
    );

    return h(
        'div',
        null,
        h('button', {
            type: 'button',
            'data-action': 'save',
            onClick: () =>
                setErrors({
                    ...(values.patient ? {} : { patient: ['Pilih pasien.'] }),
                    ...(values.section ? {} : { section: ['Pilih poli.'] }),
                }),
        }),
        h(FormErrorSummary, { feedback }),
        h('input', {
            name: 'patient',
            value: values.patient,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                setValues({ ...values, patient: event.target.value });
                setErrors(({ patient: _, ...rest }) => rest);
            },
        }),
    );
}

const type = (value: string) =>
    act(() => {
        const input = document.querySelector('input[name="patient"]')!;
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
const settle = () =>
    act(() =>
        summary()!.dispatchEvent(new Event('animationend', { bubbles: true })),
    );

try {
    await act(() => root.render(h(RegistrationForm)));
    await save();
    assert.match(summary()!.textContent, /Periksa 2 isian/);
    assert.equal(
        summary()!.getAttribute('data-attention'),
        null,
        'the first failing save shows the summary without shaking it',
    );

    await type('Budi');
    assert.match(summary()!.textContent, /Periksa 1 isian/);
    assert.equal(
        summary()!.getAttribute('data-attention'),
        null,
        'fixing a field changes the summary without shaking it',
    );

    await save();
    assert.equal(
        summary()!.getAttribute('data-attention'),
        'shake',
        'saving again while an error remains shakes the summary',
    );

    await settle();
    assert.equal(summary()!.getAttribute('data-attention'), null);
    await act(() =>
        document
            .querySelector<HTMLElement>('[aria-label="Ringkas pesan"]')!
            .click(),
    );
    assert.equal(
        document
            .querySelector('[aria-label="Tampilkan rincian pesan"]')
            ?.getAttribute('aria-expanded'),
        'false',
    );
    await save();
    assert.equal(
        summary()!.getAttribute('data-attention'),
        'shake',
        'every repeated failing save replays the shake',
    );
    assert.ok(
        document.querySelector('[aria-label="Ringkas pesan"]'),
        'a repeated failing save re-expands a collapsed summary',
    );

    await settle();
    reducedMotion = true;
    await save();
    assert.equal(
        summary()!.getAttribute('data-attention'),
        'highlight',
        'reduced motion highlights instead of shaking',
    );
} finally {
    await React.act(() => {
        root.unmount();
        return Promise.resolve();
    });
    window.close();
}
