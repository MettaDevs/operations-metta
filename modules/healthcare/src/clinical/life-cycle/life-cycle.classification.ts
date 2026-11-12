// Penentuan siklus hidup kunjungan dari aturan di sim_m_siklus_hidup. Fungsi murni: aturan aktif dibaca pemanggilnya.

export type LifeCycleRule = {
    id: string;
    cluster_id: string;
    min_age_months: number;
    max_age_months: number | null;
    gender: string | null;
    requires_pregnancy: boolean | null;
    priority: number;
};

export type VisitSubject = {
    gender: string | null;
    birthDate: string | null;
    visitDate: string;
    pregnant: boolean;
};

export const undeterminedLifeCycleMessage =
    'Siklus hidup pasien tidak dapat ditentukan. Periksa pengaturan Siklus hidup.';

function parts(date: string): [number, number, number] {
    const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
    return [year, month, day];
}

// Umur dalam bulan genap pada tanggal kunjungan, sama dengan age() PostgreSQL: bulan berjalan baru dihitung setelah
// tanggal lahirnya tercapai.
export function ageInMonths(birthDate: string, on: string): number {
    const [birthYear, birthMonth, birthDay] = parts(birthDate);
    const [year, month, day] = parts(on);
    return (
        (year - birthYear) * 12 +
        (month - birthMonth) -
        (day < birthDay ? 1 : 0)
    );
}

// Tanggal lahir yang tidak diketahui hanya cocok dengan aturan yang tidak membatasi umur.
function ageFits(rule: LifeCycleRule, months: number | null): boolean {
    if (months === null)
        return rule.min_age_months === 0 && rule.max_age_months === null;
    return (
        months >= rule.min_age_months &&
        (rule.max_age_months === null || months < rule.max_age_months)
    );
}

function fits(
    rule: LifeCycleRule,
    subject: Omit<VisitSubject, 'pregnant'>,
): boolean {
    const months = subject.birthDate
        ? ageInMonths(subject.birthDate, subject.visitDate)
        : null;
    return (
        (rule.gender === null || rule.gender === subject.gender) &&
        ageFits(rule, months)
    );
}

// Aturan yang cocok, prioritas terkecil lebih dulu.
export function matchingLifeCycles<T extends LifeCycleRule>(
    rules: readonly T[],
    subject: VisitSubject,
): T[] {
    return rules
        .filter(
            (rule) =>
                fits(rule, subject) &&
                (rule.requires_pregnancy === null ||
                    rule.requires_pregnancy === subject.pregnant),
        )
        .sort((a, b) => a.priority - b.priority);
}

// Pemenangnya, atau null bila tidak ada yang cocok atau dua aturan teratas berprioritas sama.
export function classifyVisit<T extends LifeCycleRule>(
    rules: readonly T[],
    subject: VisitSubject,
): T | null {
    const [first, second] = matchingLifeCycles(rules, subject);
    if (!first || (second && second.priority === first.priority)) return null;
    return first;
}

// Status hamil hanya ditanyakan bila ada aturan bersyarat hamil yang dapat berlaku untuk jenis kelamin dan umur pasien.
export function asksPregnancy(
    rules: readonly LifeCycleRule[],
    subject: Omit<VisitSubject, 'pregnant'>,
): boolean {
    return rules.some(
        (rule) => rule.requires_pregnancy === true && fits(rule, subject),
    );
}
