import { cn } from '@operations-metta/ui/utils';
import type { ReactNode } from 'react';
import {
    isDestinationStatus,
    type DestinationStatus,
} from './queue.statuses.ts';

// Tampilan status antrean dan identitas pasien yang dipakai antrean poli dan halaman pemeriksaan. Kelas warna ditulis
// lengkap di berkas .tsx karena Tailwind hanya memindai .tsx.

export const destinationStatusLabels: Record<DestinationStatus, string> = {
    menunggu: 'Menunggu',
    dipanggil: 'Dipanggil',
    diperiksa: 'Diperiksa',
    selesai: 'Selesai',
    tidak_datang: 'Tidak datang',
    batal: 'Batal',
};

const statusDot: Record<DestinationStatus, string> = {
    menunggu: 'bg-muted-foreground',
    dipanggil: 'bg-warning',
    diperiksa: 'bg-primary',
    selesai: 'bg-success',
    tidak_datang: 'bg-destructive',
    batal: 'bg-destructive',
};

export function DestinationStatusDot({
    status,
}: {
    status: DestinationStatus;
}): ReactNode {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                statusDot[status],
            )}
        />
    );
}

export function DestinationStatusText({
    status,
}: {
    status: string;
}): ReactNode {
    if (!isDestinationStatus(status)) return status;
    return (
        <span className="inline-flex items-center gap-1.5 font-medium">
            <DestinationStatusDot status={status} />
            {destinationStatusLabels[status]}
        </span>
    );
}

// Umur saat mendaftar, misalnya "34 thn 6 bln" atau "8 bln 12 hr" untuk bayi.
export function ageText(entry: {
    age_years: number | null;
    age_months: number | null;
    age_days: number | null;
}): string | null {
    if (entry.age_years === null) return null;
    if (entry.age_years > 0)
        return `${String(entry.age_years)} thn ${String(entry.age_months ?? 0)} bln`;
    return `${String(entry.age_months ?? 0)} bln ${String(entry.age_days ?? 0)} hr`;
}

export function timeText(value: string | null): string | null {
    return value
        ? new Date(value).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
          })
        : null;
}
