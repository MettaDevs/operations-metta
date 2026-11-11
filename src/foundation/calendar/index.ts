// Kalender kerja Core (Sys Admin → Kalender), pola kalender F&O, dipakai semua module. Module yang memasang kalender ke
// datanya, misalnya jadwal praktik, menyimpan id kalender di tabelnya sendiri lalu membaca jam kerja lewat isOpen atau
// workingTimes, dan boleh menyusun jam kerja lewat composeWorkingTimes. Tanggal yang belum disusun dihitung tutup.
export { calendarRoutes } from './calendar.routes.ts';
export type { WorkingTimeInterval } from './calendar.schema.ts';
export {
    composeWorkingTimes,
    isOpen,
    workingTimes,
    type ComposeResult,
    type WorkingDay,
} from './working-times.service.ts';
