import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { Spinner } from '@operations-metta/ui/spinner';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import {
    Component,
    createContext,
    Suspense,
    useCallback,
    useContext,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import type { ErrorAction } from '../error-action/index.ts';
import { errorText } from './api.ts';
import type { RecordPages } from './page.ts';

type OpenAction = Extract<ErrorAction, { kind: 'open' }>;

const dialogKey = (action: OpenAction) => `${action.page}:${action.recordId}`;

const RecordPagesContext = createContext<RecordPages | null>(null);
const OpenRecordContext = createContext<((action: OpenAction) => void) | null>(
    null,
);

export function RecordPagesProvider({
    pages,
    children,
}: {
    pages: RecordPages;
    children: ReactNode;
}): ReactNode {
    return (
        <RecordPagesContext.Provider value={pages}>
            {children}
        </RecordPagesContext.Provider>
    );
}

// Membuka record dari tombol kotak error; null di luar layout aplikasi, sehingga tombolnya tidak tampil di sana.
export function useOpenRecord(): ((action: OpenAction) => void) | null {
    return useContext(OpenRecordContext);
}

// Record yang dibuka dari kotak error, ditumpuk di atas layar sekarang sebagai PageDialog. Pemiliknya layout aplikasi,
// bukan form yang ditolak: dialog di dalam pohon form itu ikut meneruskan submit ke form asal lewat portal React, dan
// Simpan di record tujuan akan menyimpan form asal juga. Menutupnya tidak menyimpan, memuat ulang, atau mengubah apa pun
// di layar asal; pengguna menekan Simpan lagi sendiri.
export function RecordDialogs({
    children,
}: {
    children: ReactNode;
}): ReactNode {
    const pages = useContext(RecordPagesContext);
    const [opened, setOpened] = useState<readonly OpenAction[]>([]);
    // Stabil, karena kotak error yang memakainya menganggap aksi baru sebagai penolakan baru dan memindahkan fokus.
    const open = useCallback(
        (action: OpenAction) =>
            setOpened((current) =>
                current.some((item) => dialogKey(item) === dialogKey(action))
                    ? current
                    : [...current, action],
            ),
        [],
    );
    return (
        <OpenRecordContext.Provider value={pages ? open : null}>
            {children}
            {pages &&
                opened.map((action) => {
                    const page = pages[action.page];
                    const RecordComponent = page.component;
                    return (
                        <PageDialog
                            key={dialogKey(action)}
                            open
                            onOpenChange={(next) => {
                                if (!next)
                                    setOpened((current) =>
                                        current.filter(
                                            (item) => item !== action,
                                        ),
                                    );
                            }}
                        >
                            <PageDialogContent title={page.title}>
                                <RecordBoundary>
                                    <Suspense
                                        fallback={
                                            <PageDialogBody className="flex justify-center py-10">
                                                <Spinner />
                                            </PageDialogBody>
                                        }
                                    >
                                        <RecordComponent id={action.recordId} />
                                    </Suspense>
                                </RecordBoundary>
                            </PageDialogContent>
                        </PageDialog>
                    );
                })}
        </OpenRecordContext.Provider>
    );
}

function RecordBoundary({ children }: { children: ReactNode }): ReactNode {
    return (
        <QueryErrorResetBoundary>
            {({ reset }) => (
                <RecordErrorBoundary onReset={reset}>
                    {children}
                </RecordErrorBoundary>
            )}
        </QueryErrorResetBoundary>
    );
}

// Record yang gagal dimuat, misalnya karena izinnya dicabut sejak tombolnya tampil, menampilkan pesannya di dalam
// jendela itu saja; layar asal tetap utuh.
class RecordErrorBoundary extends Component<
    { onReset: () => void; children: ReactNode },
    { error: unknown }
> {
    override state: { error: unknown } = { error: null };

    static getDerivedStateFromError(error: unknown) {
        return { error };
    }

    override componentWillUnmount(): void {
        this.props.onReset();
    }

    override render(): ReactNode {
        return this.state.error === null ? (
            this.props.children
        ) : (
            <PageDialogBody className="py-6 text-sm text-destructive">
                {errorText(this.state.error, 'Data ini belum dapat dibuka.')}
            </PageDialogBody>
        );
    }
}
