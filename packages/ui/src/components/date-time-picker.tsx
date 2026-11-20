import { CalendarIcon, ClockIcon } from 'lucide-react';
import * as React from 'react';
import { id as indonesian } from 'react-day-picker/locale';

import { Button } from './button';
import { Calendar } from './calendar';
import {
    dateValue,
    displayDate,
    parseDate,
    PickerTrigger,
    useOverlayContainer,
} from './date-picker';
import type { PortalContainer } from './date-picker';
import { InputGroup, InputGroupAddon, InputGroupInput } from './input-group';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Separator } from './separator';

/** Jam 24 jam `HH:mm`; `''` untuk isian kosong dan `undefined` untuk ketikan yang belum sah. */
export function parseTimeInput(text: string): string | undefined {
    const trimmed = text.trim();

    if (!trimmed) {
        return '';
    }

    const [, hour = '', minute = ''] =
        /^(\d{1,2}):?(\d{2})$/.exec(trimmed) ?? [];

    return hour && Number(hour) <= 23 && Number(minute) <= 59
        ? `${hour.padStart(2, '0')}:${minute}`
        : undefined;
}

/** Titik dua dipasang setelah dua digit jam, sama seperti garis miring pada isian tanggal. */
export function formatTimeInput(text: string): string {
    const kept = text.replace(/[^\d:]/g, '');

    return /^\d{3,4}$/.test(kept)
        ? `${kept.slice(0, 2)}:${kept.slice(2)}`
        : kept.slice(0, 5);
}

function clockValue(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function daysFrom(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);

    return next;
}

const presets: {
    label: string;
    value: (now: Date, time: string) => string;
}[] = [
    {
        label: 'Sekarang',
        value: (now) => `${dateValue(now)}T${clockValue(now)}`,
    },
    {
        label: 'Hari ini',
        value: (now, time) => `${dateValue(now)}T${time || '00:00'}`,
    },
    {
        label: 'Kemarin',
        value: (now, time) =>
            `${dateValue(daysFrom(now, -1))}T${time || '00:00'}`,
    },
];

/** Nilai `YYYY-MM-DDTHH:mm` waktu lokal tanpa konversi UTC, dipilih dari satu popover berisi kalender, jam, dan pilihan cepat. */
export function DateTimePicker({
    value,
    onValueChange,
    label,
    required,
    disabled,
    readOnly,
    min,
    max,
    portalContainer,
    className,
}: {
    value: string;
    onValueChange: (value: string) => void;
    label?: string;
    required?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    min?: string;
    max?: string;
    portalContainer?: PortalContainer;
    className?: string;
}) {
    const separator = value.indexOf('T');
    const date = separator < 0 ? value : value.slice(0, separator);
    const time = separator < 0 ? '' : value.slice(separator + 1);
    const [open, setOpen] = React.useState(false);
    const [draft, setDraft] = React.useState({
        source: time,
        text: time,
        left: false,
    });
    const { setHost, container } = useOverlayContainer(portalContainer);
    const timeText = draft.source === time ? draft.text : time;
    const parsedTime = parseTimeInput(timeText);
    const selected = parseDate(date);
    const earliest = parseDate(min ?? '');
    const latest = parseDate(max ?? '');
    const now = new Date();
    const inRange = (next: string) =>
        (!min || next.slice(0, 10) >= min) &&
        (!max || next.slice(0, 10) <= max);
    const active = presets.find(
        (preset) => value && preset.value(now, time) === value,
    );
    const timeError =
        parsedTime === undefined && draft.left
            ? 'Masukkan jam dalam format 24 jam, misalnya 13:45.'
            : undefined;

    function commit(nextDate: string, nextTime: string) {
        setDraft({ source: nextTime, text: nextTime, left: false });
        onValueChange(nextDate ? `${nextDate}T${nextTime || '00:00'}` : '');
    }

    return (
        <div
            ref={setHost}
            className="w-full min-w-0"
            data-slot="date-time-picker"
        >
            <Popover
                open={open && !disabled && !readOnly}
                onOpenChange={setOpen}
            >
                <PopoverTrigger asChild>
                    <PickerTrigger
                        label={label}
                        required={required}
                        empty={!date}
                        disabled={disabled || readOnly}
                        aria-invalid={timeError ? true : undefined}
                        className={className}
                    >
                        <CalendarIcon
                            aria-hidden="true"
                            className="text-muted-foreground"
                        />
                        {date && (
                            <>
                                <span>{displayDate(date)}</span>
                                <span
                                    aria-hidden="true"
                                    className="text-muted-foreground"
                                >
                                    |
                                </span>
                                <ClockIcon
                                    aria-hidden="true"
                                    className="text-muted-foreground"
                                />
                                <span>{time || '--:--'}</span>
                            </>
                        )}
                    </PickerTrigger>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="flex w-auto flex-col p-0 sm:flex-row"
                    portalContainer={container}
                >
                    <Calendar
                        mode="single"
                        locale={indonesian}
                        className="p-2.5"
                        selected={selected}
                        defaultMonth={selected}
                        autoFocus
                        startMonth={earliest}
                        endMonth={latest}
                        disabled={[
                            ...(earliest ? [{ before: earliest }] : []),
                            ...(latest ? [{ after: latest }] : []),
                        ]}
                        onSelect={(day) => {
                            if (day) {
                                commit(dateValue(day), parsedTime || time);
                            }
                        }}
                    />
                    <Separator className="sm:hidden" />
                    <Separator
                        orientation="vertical"
                        className="hidden self-stretch data-[orientation=vertical]:h-auto sm:block"
                    />
                    <div className="flex flex-col gap-4 p-4 sm:max-w-70">
                        <div className="flex flex-col gap-2">
                            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                Jam
                            </p>
                            <InputGroup>
                                <InputGroupAddon>
                                    <ClockIcon aria-hidden="true" />
                                </InputGroupAddon>
                                <InputGroupInput
                                    aria-label="Jam"
                                    inputMode="numeric"
                                    placeholder="hh:mm"
                                    autoComplete="off"
                                    value={timeText}
                                    aria-invalid={timeError ? true : undefined}
                                    onBlur={() =>
                                        setDraft({ ...draft, left: true })
                                    }
                                    onChange={(event) => {
                                        const text = formatTimeInput(
                                            event.target.value,
                                        );
                                        const next = parseTimeInput(text);
                                        setDraft({
                                            source: time,
                                            text,
                                            left: false,
                                        });

                                        if (next && date) {
                                            commit(date, next);
                                        }
                                    }}
                                />
                            </InputGroup>
                            {timeError && (
                                <p
                                    role="alert"
                                    className="text-xs text-destructive"
                                >
                                    {timeError}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                Pilihan cepat
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                {presets.map((preset) => {
                                    const next = preset.value(
                                        now,
                                        parsedTime || time,
                                    );

                                    return (
                                        <Button
                                            key={preset.label}
                                            type="button"
                                            size="sm"
                                            variant={
                                                active === preset
                                                    ? 'default'
                                                    : 'outline'
                                            }
                                            aria-pressed={active === preset}
                                            disabled={!inRange(next)}
                                            onClick={() =>
                                                commit(
                                                    next.slice(0, 10),
                                                    next.slice(11),
                                                )
                                            }
                                        >
                                            {preset.label}
                                        </Button>
                                    );
                                })}
                                {!required && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={!value}
                                        onClick={() => commit('', '')}
                                    >
                                        Kosongkan
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
