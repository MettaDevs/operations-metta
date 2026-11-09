// Pintu publik Shell untuk kode peramban: halaman di folder fitur Core dan module meng-import dari sini. Folder ini
// hanya berisi kode yang dibundel untuk peramban; server tidak meng-import-nya.
export {
    api,
    ApiError,
    errorText,
    isSessionExpired,
    orpc,
    type ShellData,
} from './api.ts';
export { FormErrorHeader } from './form-error-header.tsx';
export { definePage } from './page.ts';
export {
    appLayoutRoute,
    authLayoutRoute,
    indexRoute,
    rootRoute,
    routerOptions,
    startClient,
} from './router.tsx';
