import { displayDate } from '@operations-metta/ui/date-picker';
import type { ReactNode } from 'react';

// Waktu dari API adalah ISO UTC; layar menampilkannya dalam waktu peramban, seperti antrean poli.
export function clockText(iso: string): string {
    return new Date(iso).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function dateTimeText(iso: string): string {
    const date = new Date(iso);
    return `${date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} ${clockText(iso)}`;
}

// Lama tunggu dibulatkan ke menit: "12 mnt", "1 j 5 mnt", "2 hr 3 j".
export function durationText(fromIso: string, toIso: string | null): string {
    const end = toIso ? new Date(toIso).getTime() : Date.now();
    const minutes = Math.max(
        0,
        Math.floor((end - new Date(fromIso).getTime()) / 60000),
    );
    if (minutes < 60) return `${minutes} mnt`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} j ${minutes % 60} mnt`;
    return `${Math.floor(hours / 24)} hr ${hours % 24} j`;
}

export function ageText(birthDate: string | null): string | null {
    if (!birthDate) return null;
    const born = new Date(`${birthDate}T00:00:00`);
    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    if (
        now.getMonth() < born.getMonth() ||
        (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
    )
        years -= 1;
    return `${years} th`;
}

export function Fact({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}): ReactNode {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words">{children || '—'}</dd>
        </div>
    );
}

export const birthText = (birthDate: string | null) =>
    birthDate
        ? `${displayDate(birthDate)} (${ageText(birthDate) ?? ''})`
        : null;
