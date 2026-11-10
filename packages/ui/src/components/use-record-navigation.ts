import * as React from 'react';
import type { PageDialogNavigation } from './page-dialog';

/** Navigasi mengikuti urutan daftar, termasuk batas batch yang belum dimuat. */
export function useRecordNavigation<T>({
    items,
    currentId,
    getId,
    onNavigate,
    hasMore = false,
    loading = false,
    loadMore,
    scopeKey,
    disabled = false,
}: {
    items: readonly T[];
    currentId: string | null;
    getId: (item: T) => string;
    onNavigate: (id: string) => void;
    hasMore?: boolean;
    loading?: boolean;
    // Pemanggil boleh memberi fungsi tanpa nilai kembali; hanya `false` yang berarti batal.
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    loadMore?: () => boolean | void;
    scopeKey: string;
    disabled?: boolean;
}): PageDialogNavigation {
    const pending = React.useRef<{
        id: string;
        scope: string;
    } | null>(null);
    const index = items.findIndex((item) => getId(item) === currentId);
    React.useEffect(() => {
        if (!pending.current) {
            return;
        }

        const nextItem = index >= 0 ? items[index + 1] : undefined;

        if (
            pending.current.id !== currentId ||
            pending.current.scope !== scopeKey ||
            disabled
        ) {
            pending.current = null;
        } else if (nextItem !== undefined) {
            pending.current = null;
            onNavigate(getId(nextItem));
        } else if (!loading) {
            pending.current = null;
        }
    }, [
        currentId,
        scopeKey,
        disabled,
        index,
        items,
        loading,
        onNavigate,
        getId,
    ]);

    return {
        previousDisabled: disabled || loading || index <= 0,
        nextDisabled:
            disabled ||
            loading ||
            index < 0 ||
            (index + 1 >= items.length && !(hasMore && loadMore)),
        previous: () => {
            const previousItem = index > 0 ? items[index - 1] : undefined;

            if (
                !disabled &&
                !loading &&
                !pending.current &&
                previousItem !== undefined
            ) {
                onNavigate(getId(previousItem));
            }
        },
        next: () => {
            if (disabled || loading || pending.current || index < 0) {
                return;
            }

            const nextItem = items[index + 1];

            if (nextItem !== undefined) {
                onNavigate(getId(nextItem));
            } else if (hasMore && loadMore && currentId) {
                pending.current = { id: currentId, scope: scopeKey };

                if (loadMore() === false) {
                    pending.current = null;
                }
            }
        },
    };
}
