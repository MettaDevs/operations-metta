import { useMatches } from '@tanstack/react-router';
import { useEffect } from 'react';

// Judul tab peramban: judul halaman (`definePage({ title })`), lalu nama ruang kerja bila sudah login. Nama produk tidak
// ditulis di kode.
export function useDocumentTitle(suffix: string | null): void {
    const title = useMatches({
        select: (matches) =>
            matches.findLast((match) => match.staticData.title)?.staticData
                .title,
    });

    useEffect(() => {
        document.title = [title, suffix].filter(Boolean).join(' - ');
    }, [title, suffix]);
}
