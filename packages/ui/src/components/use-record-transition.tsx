import { useConfirmation } from './use-confirmation';

// Satu teks untuk setiap penjaga perubahan yang belum disimpan: kartu record dan perpindahan layar.
export const discardChangesConfirmation = {
    title: 'Buang perubahan yang belum disimpan?',
    description:
        'Perubahan pada kartu ini belum disimpan. Pilih Batal untuk melanjutkan mengisi kartu.',
    confirmLabel: 'Buang perubahan',
    destructive: true,
};

export function useRecordTransition(dirty: boolean, busy: boolean) {
    const { confirm, confirmation } = useConfirmation();

    function request(action: () => void) {
        if (busy) {
            return;
        }

        if (!dirty) {
            action();

            return;
        }

        void confirm(discardChangesConfirmation).then((confirmed) => {
            if (confirmed) {
                action();
            }
        });
    }

    return { request, confirmation };
}
