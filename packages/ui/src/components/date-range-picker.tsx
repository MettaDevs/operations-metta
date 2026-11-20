import { CalendarIcon } from 'lucide-react';
import * as React from 'react';
import { id as indonesian } from 'react-day-picker/locale';

import { cn } from '../utils';
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
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { ScrollArea } from './scroll-area';

/** Tanggal ISO `YYYY-MM-DD`; `''` berarti batas itu belum diisi. */
export type DateRangeValue = { from: string; to: string };

function daysFrom(today: Date, days: number): string {
    return dateValue(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + days),
    );
}

function monthDay(today: Date, months: number, date: number): string {
    return dateValue(
        new Date(today.getFullYear(), today.getMonth() + months, date),
    );
}

const presetGroups: {
    label: string;
    presets: { label: string; range: (today: Date) => DateRangeValue }[];
}[] = [
    {
        label: 'Hari',
        presets: [
            {
                label: 'Hari ini',
                range: (t) => ({ from: daysFrom(t, 0), to: daysFrom(t, 0) }),
            },
            {
                label: 'Kemarin',
                range: (t) => ({ from: daysFrom(t, -1), to: daysFrom(t, -1) }),
            },
            {
                label: 'Besok',
                range: (t) => ({ from: daysFrom(t, 1), to: daysFrom(t, 1) }),
            },
        ],
    },
    {
        label: 'Minggu',
        presets: [
            {
                label: '7 hari terakhir',
                range: (t) => ({ from: daysFrom(t, -6), to: daysFrom(t, 0) }),
            },
            {
                label: '7 hari ke depan',
                range: (t) => ({ from: daysFrom(t, 1), to: daysFrom(t, 7) }),
            },
        ],
    },
    {
        label: 'Bulan',
        presets: [
            {
                label: '30 hari terakhir',
                range: (t) => ({ from: daysFrom(t, -29), to: daysFrom(t, 0) }),
            },
            {
                label: 'Bulan berjalan',
                range: (t) => ({ from: monthDay(t, 0, 1), to: daysFrom(t, 0) }),
            },
            {
                label: 'Bulan lalu',
                range: (t) => ({
                    from: monthDay(t, -1, 1),
                    to: monthDay(t, 0, 0),
                }),
            },
            {
                label: 'Bulan depan',
                range: (t) => ({
                    from: monthDay(t, 1, 1),
                    to: monthDay(t, 2, 0),
                }),
            },
        ],
    },
];

/** Rentang tanggal dipilih dari kalender atau pilihan cepat. Klik pertama memulai rentang, klik kedua menutupnya. */
export function DateRangePicker({
    value,
    onValueChange,
    label,
    disabled,
    portalContainer,
    className,
}: {
    value: DateRangeValue;
    onValueChange: (value: DateRangeValue) => void;
    label?: string;
    disabled?: boolean;
    portalContainer?: PortalContainer;
    className?: string;
}) {
    const from = parseDate(value.from);
    const to = parseDate(value.to);
    const [open, setOpen] = React.useState(false);
    const [anchor, setAnchor] = React.useState<string | null>(null);
    const [month, setMonth] = React.useState(to ?? from ?? new Date());
    const { setHost, container } = useOverlayContainer(portalContainer);
    const today = new Date();
    const reversed = Boolean(from && to && value.to < value.from);
    const isActive = (range: DateRangeValue) =>
        range.from === value.from && range.to === value.to;

    function choose(next: DateRangeValue, pending: string | null) {
        setAnchor(pending);
        onValueChange(next);
    }

    return (
        <div
            ref={setHost}
            className="w-full min-w-0"
            data-slot="date-range-picker"
        >
            <Popover
                open={open && !disabled}
                onOpenChange={(next) => {
                    setOpen(next);
                    setAnchor(null);
                    if (next) setMonth(to ?? from ?? new Date());
                }}
            >
                <PopoverTrigger asChild>
                    <PickerTrigger
                        label={label}
                        empty={!from && !to}
                        disabled={disabled}
                        aria-invalid={reversed || undefined}
                        className={className}
                    >
                        <CalendarIcon
                            aria-hidden="true"
                            className="text-muted-foreground"
                        />
                        {(from ?? to) && (
                            <span>
                                {displayDate(value.from) || '…'} –{' '}
                                {displayDate(value.to) || '…'}
                            </span>
                        )}
                    </PickerTrigger>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-75 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
                    portalContainer={container}
                >
                    <div className="px-4 pt-3 pb-3">
                        <Calendar
                            mode="range"
                            locale={indonesian}
                            className="w-full bg-transparent p-0"
                            selected={(from ?? to) ? { from, to } : undefined}
                            month={month}
                            onMonthChange={setMonth}
                            onSelect={(_, clicked) => {
                                const clickedValue = dateValue(clicked);

                                if (anchor === null) {
                                    choose(
                                        {
                                            from: clickedValue,
                                            to: clickedValue,
                                        },
                                        clickedValue,
                                    );
                                    return;
                                }

                                choose(
                                    clickedValue < anchor
                                        ? { from: clickedValue, to: anchor }
                                        : { from: anchor, to: clickedValue },
                                    null,
                                );
                            }}
                        />
                        {reversed && (
                            <p
                                role="alert"
                                className="px-1 pt-2 text-xs text-destructive"
                            >
                                Tanggal akhir tidak boleh sebelum tanggal awal.
                            </p>
                        )}
                    </div>
                    <div className="border-t bg-background">
                        <ScrollArea className="h-44 w-full">
                            <div className="flex flex-col gap-3 px-4 py-3">
                                {presetGroups.map((group) => (
                                    <div key={group.label}>
                                        <p className="mb-1.5 px-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                                            {group.label}
                                        </p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {group.presets.map((preset) => {
                                                const range =
                                                    preset.range(today);
                                                const active = isActive(range);

                                                return (
                                                    <Button
                                                        key={preset.label}
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        aria-pressed={active}
                                                        className={cn(
                                                            'h-7 justify-center border border-border text-xs font-normal',
                                                            active &&
                                                                'bg-primary/10 text-primary not-disabled:hover:bg-primary/15 not-disabled:hover:text-primary',
                                                        )}
                                                        onClick={() => {
                                                            choose(range, null);
                                                            setMonth(
                                                                parseDate(
                                                                    range.to,
                                                                ) ?? today,
                                                            );
                                                        }}
                                                    >
                                                        {active && (
                                                            <span
                                                                aria-hidden="true"
                                                                className="size-1.5 shrink-0 rounded-full bg-primary"
                                                            />
                                                        )}
                                                        {preset.label}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
