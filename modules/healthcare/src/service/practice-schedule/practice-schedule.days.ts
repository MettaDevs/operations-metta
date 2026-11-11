// Hari template jadwal dan hitungan tanggal yang dipakai server dan layar. Hari 1..7 = Senin..Minggu (ISO), 8 = template
// hari libur. Tanggal ditulis YYYY-MM-DD dan dihitung di UTC supaya tidak bergeser karena zona waktu.
export const holidayDay = 8;

export const dayNames: Record<number, string> = {
    1: 'Senin',
    2: 'Selasa',
    3: 'Rabu',
    4: 'Kamis',
    5: 'Jumat',
    6: 'Sabtu',
    7: 'Minggu',
    8: 'Hari libur',
};

const dayMs = 24 * 60 * 60 * 1000;

export const addDays = (date: string, days: number): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs)
        .toISOString()
        .slice(0, 10);

export const isoDay = (date: string): number =>
    ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

// Senin pada minggu tanggal itu.
export const weekStart = (date: string): string =>
    addDays(date, 1 - isoDay(date));

export const daysBetween = (from: string, to: string): number =>
    Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
            dayMs,
    );
