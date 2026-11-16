import { displayNumber } from '@operations-metta/ui/display-number';
import type { ReactNode } from 'react';

// Biaya racik dan resep yang ditagih bersama obat, di bawah baris obat penyerahan dan penjualan.
export function FeeLines({
    fees,
    muted = false,
}: {
    fees: { name: string; amount: string }[];
    muted?: boolean;
}): ReactNode {
    if (!fees.length) return null;
    return (
        <ul
            aria-label="Biaya racik dan resep"
            className={`space-y-1 text-sm ${muted ? 'text-muted-foreground' : ''}`}
        >
            {fees.map((fee, index) => (
                <li
                    key={`${fee.name}:${String(index)}`}
                    className="flex justify-end gap-6"
                >
                    <span>{fee.name}</span>
                    <span className="min-w-24 text-right tabular-nums">
                        {displayNumber(fee.amount)}
                    </span>
                </li>
            ))}
        </ul>
    );
}
