import {
    createSaveFeedback,
    FormErrorSummary,
    useFormValidation,
} from '@operations-metta/ui/form-feedback';
import type { FormFeedback } from '@operations-metta/ui/form-feedback';
import { cn } from '@operations-metta/ui/utils';
import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { ErrorAction } from '../error-action/index.ts';
import { useOpenRecord } from './record-dialogs.tsx';

// Ringkasan kesalahan di atas form, dipindah dari form-error-header CoreERP: pesan server, error per field, dan
// kesalahan isian yang ditemukan browser sebelum dikirim. Ia melekat di bawah toolbar: di luar area gulir ia diam
// di tempatnya, di dalam area gulir `sticky` menahannya di tepi atas sehingga tetap terlihat saat isi digulir.
// Karena itu ia harus berada langsung di antara isi form, bukan di dalam pembungkus yang hanya berisi dirinya. z-20
// menaruhnya di atas label mengambang isian (z-10) yang tergulir di bawahnya. `errorActions` adalah `ApiError.actions`
// dari penolakan yang sama dengan `errors`: tombol yang membuka record penyebabnya di atas layar ini.
export function FormErrorHeader({
    actions,
    className,
    errorActions,
    errors,
    message,
    operation = 'Perubahan belum disimpan',
    scopeRef,
}: {
    actions?: FormFeedback['actions'];
    className?: string;
    errorActions?: readonly ErrorAction[];
    errors?: Record<string, string | string[]>;
    message?: string | null;
    operation?: string;
    scopeRef?: RefObject<HTMLElement | null>;
}) {
    const ownScope = useRef<HTMLElement>(null);
    const openRecord = useOpenRecord();
    const feedback = useMemo(() => {
        // openRecord hanya menerima aksi `open`, jadi jenis aksi baru gagal typecheck di sini sampai ditangani.
        const recordActions = openRecord
            ? (errorActions ?? []).map((action) => ({
                  label: action.label,
                  onClick: () => openRecord(action),
              }))
            : [];
        const shownActions = [...recordActions, ...(actions ?? [])];
        const generalError = errors?._form;
        const generalMessage = Array.isArray(generalError)
            ? generalError.join(' ')
            : generalError;
        const fieldErrors = Object.fromEntries(
            Object.entries(errors ?? {}).filter(([field]) => field !== '_form'),
        );

        return message ||
            Object.values(errors ?? {}).some((value) => value.length)
            ? createSaveFeedback({
                  operation,
                  message:
                      message ||
                      generalMessage ||
                      'Periksa isian yang ditandai sebelum melanjutkan.',
                  errors: fieldErrors,
                  code: errors?.version ? 'stale_version' : null,
                  actions: shownActions.length ? shownActions : undefined,
              })
            : null;
    }, [actions, errorActions, errors, message, openRecord, operation]);

    const clientFeedback = useFormValidation(scopeRef ?? ownScope);
    const messages = useMemo(
        () => [clientFeedback, feedback],
        [clientFeedback, feedback],
    );

    return (
        <div
            data-slot="form-error-header"
            className={cn(
                'sticky top-0 z-20 w-full bg-background empty:hidden',
                className,
            )}
            ref={(element) => {
                ownScope.current =
                    element?.closest<HTMLElement>(
                        'form, [data-slot="page-dialog-contents"], [data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"], [data-slot="card"]',
                    ) ??
                    element?.parentElement ??
                    null;
            }}
        >
            <FormErrorSummary
                feedback={messages}
                scopeRef={scopeRef ?? ownScope}
            />
        </div>
    );
}
