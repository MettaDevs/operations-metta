// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { dateValue } from '../../src/components/date-picker.tsx';
import { DateRangePicker } from '../../src/components/date-range-picker.tsx';
import type { DateRangeValue } from '../../src/components/date-range-picker.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 35));
const values: DateRangeValue[] = [];
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
const trigger = () =>
    document.querySelector<HTMLButtonElement>(
        '[data-slot="date-range-picker"] button',
    )!;
const date = (year: number, month: number, day: number) =>
    dateValue(new Date(year, month, day));

function Harness({ initial }: { initial: DateRangeValue }) {
    const [value, setValue] = React.useState(initial);

    return h(DateRangePicker, {
        label: 'Periode',
        value,
        onValueChange: (next: DateRangeValue) => {
            values.push(next);
            setValue(next);
        },
    });
}

try {
    await act(() =>
        root.render(
            h(Harness, {
                key: 'october',
                initial: { from: '2026-10-05', to: '2026-10-09' },
            }),
        ),
    );
    assert.match(trigger().textContent, /05\/10\/2026 – 09\/10\/2026/);

    await act(() => trigger().click());
    await act(() => calendarDay('12').click());
    assert.deepEqual(
        values.at(-1),
        { from: '2026-10-12', to: '2026-10-12' },
        'the first click starts a new range',
    );
    await act(() => calendarDay('15').click());
    assert.deepEqual(
        values.at(-1),
        { from: '2026-10-12', to: '2026-10-15' },
        'the second click closes it',
    );
    await act(() => calendarDay('20').click());
    await act(() => calendarDay('18').click());
    assert.deepEqual(
        values.at(-1),
        { from: '2026-10-18', to: '2026-10-20' },
        'an earlier second click becomes the start',
    );

    const today = new Date();
    const [y, m, d] = [today.getFullYear(), today.getMonth(), today.getDate()];
    const presets: [string, DateRangeValue][] = [
        ['Hari ini', { from: date(y, m, d), to: date(y, m, d) }],
        ['Kemarin', { from: date(y, m, d - 1), to: date(y, m, d - 1) }],
        ['Besok', { from: date(y, m, d + 1), to: date(y, m, d + 1) }],
        ['7 hari terakhir', { from: date(y, m, d - 6), to: date(y, m, d) }],
        ['7 hari ke depan', { from: date(y, m, d + 1), to: date(y, m, d + 7) }],
        ['30 hari terakhir', { from: date(y, m, d - 29), to: date(y, m, d) }],
        ['Bulan berjalan', { from: date(y, m, 1), to: date(y, m, d) }],
        ['Bulan lalu', { from: date(y, m - 1, 1), to: date(y, m, 0) }],
        ['Bulan depan', { from: date(y, m + 1, 1), to: date(y, m + 2, 0) }],
    ];
    for (const [label, expected] of presets) {
        await act(() => buttonNamed(label).click());
        assert.deepEqual(values.at(-1), expected, label);
        assert.equal(
            buttonNamed(label).getAttribute('aria-pressed'),
            'true',
            `${label} is marked active`,
        );
    }

    await act(() =>
        root.render(
            h(Harness, {
                key: 'reversed',
                initial: { from: '2026-10-09', to: '2026-10-01' },
            }),
        ),
    );
    assert.equal(trigger().getAttribute('aria-invalid'), 'true');
    await act(() => trigger().click());
    assert.match(
        document.querySelector('[role="alert"]')?.textContent ?? '',
        /tidak boleh sebelum tanggal awal/,
        'a reversed range from the URL shows an error',
    );
} finally {
    React.act(() => {
        root.unmount();
    });
}
