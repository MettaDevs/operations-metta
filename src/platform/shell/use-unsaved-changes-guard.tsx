import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { discardChangesConfirmation } from '@operations-metta/ui/use-record-transition';
import { useBlocker } from '@tanstack/react-router';
import type { ReactNode } from 'react';

// Penjaga form halaman penuh yang belum disimpan. Selama `dirty`, setiap perpindahan layar (menu, rail, tombol Back
// peramban, tautan) menunggu konfirmasi yang sama dengan kartu record, dan menutup tab atau memuat ulang memunculkan
// peringatan bawaan peramban. Perpindahan milik form itu sendiri, misalnya sesudah simpan berhasil, memakai
// `ignoreBlocker: true`. Perpindahan ke halaman yang sama, misalnya menu halaman ini diklik lagi, tidak membongkar form,
// jadi `onDiscardInPlace` yang mengosongkannya setelah pengguna memilih membuang perubahan.
export function useUnsavedChangesGuard(
    dirty: boolean,
    onDiscardInPlace: () => void,
): ReactNode {
    const { confirm, confirmation } = useConfirmation();
    useBlocker({
        shouldBlockFn: async ({ current, next }) => {
            const discard = await confirm(discardChangesConfirmation);
            if (discard && current.pathname === next.pathname)
                onDiscardInPlace();
            return !discard;
        },
        enableBeforeUnload: dirty,
        disabled: !dirty,
    });
    return confirmation;
}
