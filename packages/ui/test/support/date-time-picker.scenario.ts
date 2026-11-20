// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { dateValue } from '../../src/components/date-picker.tsx';
import { DateTimePicker } from '../../src/components/date-time-picker.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 35));
const values: string[] = [];
const act = (run: () => void) =>
    React.act(async () => {
        run();
        await tick();
    });
const buttonNamed = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === name,
    )!;
const calendarDay = (day: string) =>
    [
        ...document.querySelectorAll<HTMLButtonElement>(
            '[data-slot="calendar"] td:not([data-outside="true"]) button',
        ),
    ].find((element) => element.textContent.trim() === day)!;
const timeInput = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Jam"]')!;
const typeTime = (text: string) =>
    act(() => {
        timeInput().focus();
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!.call(timeInput(), text);
        timeInput().dispatchEvent(new Event('input', { bubbles: true }));
    });

function Harness() {
    const [value, setValue] = React.useState('2026-10-19T08:00');

    return h(DateTimePicker, {
        label: 'Tanggal dan jam meninggal',
        value,
        onValueChange: (next: string) => {
            values.push(next);
            setValue(next);
        },
    });
}

try {
    await act(() => root.render(h(Harness)));
    const trigger = document.querySelector<HTMLButtonElement>(
        '[data-slot="date-time-picker"] button',
    )!;
    assert.match(trigger.textContent, /19\/10\/2026/);
    assert.match(trigger.textContent, /08:00/);

    await act(() => trigger.click());
    await act(() => calendarDay('21').click());
    assert.equal(
        values.at(-1),
        '2026-10-21T08:00',
        'picking a day keeps the time',
    );

    await typeTime('1345');
    assert.equal(timeInput().value, '13:45', 'the colon is added while typing');
    assert.equal(
        values.at(-1),
        '2026-10-21T13:45',
        'a valid 24-hour time commits',
    );

    await typeTime('2500');
    assert.equal(
        values.at(-1),
        '2026-10-21T13:45',
        'an invalid time never commits',
    );
    assert.equal(
        document.querySelector('[role="alert"]'),
        null,
        'no error while still typing',
    );
    await act(() => timeInput().blur());
    assert.match(
        document.querySelector('[role="alert"]')?.textContent ?? '',
        /format 24 jam/,
    );

    await act(() => buttonNamed('Sekarang').click());
    const now = values.at(-1) ?? '';
    assert.ok(now.startsWith(`${dateValue(new Date())}T`), now);
    assert.match(now, /T\d{2}:\d{2}$/);
    assert.equal(
        document.querySelector('[role="alert"]'),
        null,
        'a preset clears the time error',
    );
    assert.equal(buttonNamed('Sekarang').getAttribute('aria-pressed'), 'true');

    await act(() => buttonNamed('Kemarin').click());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    assert.equal(values.at(-1), `${dateValue(yesterday)}T${now.slice(11)}`);
    assert.equal(buttonNamed('Kemarin').getAttribute('aria-pressed'), 'true');

    await act(() => buttonNamed('Kosongkan').click());
    assert.equal(values.at(-1), '', 'an optional field can be cleared');
} finally {
    React.act(() => {
        root.unmount();
    });
}
