import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { ReactNode, RefObject } from 'react';

type Session = {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
    is_active: boolean;
};
type Calendar = { id: string; code: string; name: string };

const sessionLabel = (session: Session) =>
    `${session.name} (${session.start_time}–${session.end_time})`;
const calendarLabel = (calendar: Calendar) =>
    calendar.code ? `${calendar.code} ${calendar.name}` : calendar.name;

export function SessionLookup({
    sessions,
    value,
    onChange,
    portalContainer,
    onCreate,
}: {
    sessions: Session[];
    value: string | null;
    onChange: (id: string) => void;
    portalContainer: RefObject<HTMLElement | null>;
    onCreate: (() => void) | undefined;
}): ReactNode {
    const selected = sessions.find((session) => session.id === value) ?? null;
    return (
        <InlineLookup
            label="Sesi"
            required
            items={sessions.filter(
                (session) => session.is_active || session.id === value,
            )}
            value={selected}
            displayValue={selected ? sessionLabel(selected) : ''}
            onValueChange={(session) => onChange(session.id)}
            getItemValue={(session) => session.id}
            getItemLabel={sessionLabel}
            placeholder="Cari sesi…"
            emptyMessage={
                onCreate
                    ? 'Belum ada sesi aktif. Pilih Baru untuk menambahkan.'
                    : 'Belum ada sesi aktif. Tambahkan di layar Sesi praktik.'
            }
            portalContainer={portalContainer}
            onCreate={onCreate}
            columns={[
                {
                    id: 'name',
                    header: 'Nama',
                    width: 200,
                    cell: (session) => session.name,
                    sortValue: (session) => session.name,
                },
                {
                    id: 'start_time',
                    header: 'Mulai',
                    width: 90,
                    cell: (session) => session.start_time,
                    sortValue: (session) => session.start_time,
                },
                {
                    id: 'end_time',
                    header: 'Selesai',
                    width: 90,
                    cell: (session) => session.end_time,
                    sortValue: (session) => session.end_time,
                },
            ]}
        />
    );
}

export function CalendarLookup({
    calendars,
    value,
    onChange,
    required,
    portalContainer,
}: {
    calendars: Calendar[];
    value: string | null;
    onChange: (id: string | null) => void;
    required: boolean;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const choices = required
        ? calendars
        : [{ id: '', code: '', name: 'Tanpa kalender' }, ...calendars];
    const selected =
        choices.find((calendar) => calendar.id === (value ?? '')) ?? null;
    return (
        <InlineLookup
            label="Kalender libur"
            required={required}
            items={choices}
            value={selected}
            displayValue={selected ? calendarLabel(selected) : ''}
            onValueChange={(calendar) =>
                onChange(calendar.id === '' ? null : calendar.id)
            }
            getItemValue={(calendar) => calendar.id}
            getItemLabel={calendarLabel}
            placeholder="Cari kode atau nama kalender…"
            emptyMessage="Kalender tidak ditemukan."
            portalContainer={portalContainer}
            columns={[
                {
                    id: 'code',
                    header: 'Kode',
                    width: 120,
                    cell: (calendar) => calendar.code,
                    sortValue: (calendar) => calendar.code,
                },
                {
                    id: 'name',
                    header: 'Nama',
                    width: 220,
                    cell: (calendar) => calendar.name,
                    sortValue: (calendar) => calendar.name,
                },
            ]}
        />
    );
}
