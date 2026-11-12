import { cn } from '@operations-metta/ui/utils';
import type { ReactNode } from 'react';
import {
    isVisitCondition,
    isVisitStatus,
    type VisitCondition,
    type VisitStatus,
} from './visit.statuses.ts';

// Tampilan status kunjungan, sakit/sehat, dan kategori skrining yang dipakai daftar dan halaman pendaftaran. Kelas warna
// ditulis lengkap di berkas .tsx karena Tailwind hanya memindai .tsx.

// Label status mengikuti daftar registrasi sistem lama.
export const visitStatusLabels: Record<VisitStatus, string> = {
    terdaftar: 'Belum periksa',
    diperiksa: 'Sedang periksa',
    selesai: 'Sudah periksa',
    batal: 'Batal',
};

const statusDot: Record<VisitStatus, string> = {
    terdaftar: 'bg-muted-foreground',
    diperiksa: 'bg-primary',
    selesai: 'bg-success',
    batal: 'bg-destructive',
};

const statusText: Record<VisitStatus, string> = {
    terdaftar: 'text-foreground',
    diperiksa: 'text-primary',
    selesai: 'text-success',
    batal: 'text-destructive',
};

export const visitConditionLabels: Record<VisitCondition, string> = {
    sakit: 'Kunjungan sakit',
    sehat: 'Kunjungan sehat',
};

export function visitConditionLabel(code: string): string {
    return isVisitCondition(code) ? visitConditionLabels[code] : code;
}

export function StatusDot({ status }: { status: VisitStatus }): ReactNode {
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

export function VisitStatusText({ status }: { status: string }): ReactNode {
    if (!isVisitStatus(status)) return status;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 font-medium',
                statusText[status],
            )}
        >
            <StatusDot status={status} />
            {visitStatusLabels[status]}
        </span>
    );
}

// `warna` kategori skrining berisi nama token warna layar (sim_m_skrining_kategori.warna). Nama yang belum dikenal
// memakai warna teks redup, supaya kategori baru tetap terbaca.
const triageDot: Record<string, string> = {
    'triage-red': 'bg-triage-red',
    'triage-orange': 'bg-triage-orange',
    'triage-yellow': 'bg-triage-yellow',
    'triage-green': 'bg-triage-green',
};

export function TriageDot({ color }: { color: string | null }): ReactNode {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                (color && triageDot[color]) ?? 'bg-muted-foreground',
            )}
        />
    );
}
