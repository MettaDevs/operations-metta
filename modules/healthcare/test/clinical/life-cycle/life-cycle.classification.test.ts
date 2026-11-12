import { describe, expect, test } from 'bun:test';
import {
    ageInMonths,
    asksPregnancy,
    classifyVisit,
    matchingLifeCycles,
    type LifeCycleRule,
} from '../../../src/clinical/life-cycle/life-cycle.classification.ts';

// Sama dengan isi bawaan 0018_ilp_cluster.sql.
const rule = (
    id: string,
    cluster: string,
    min: number,
    max: number | null,
    extra: Partial<LifeCycleRule> = {},
): LifeCycleRule => ({
    id,
    cluster_id: cluster,
    min_age_months: min,
    max_age_months: max,
    gender: null,
    requires_pregnancy: null,
    priority: 10,
    ...extra,
});
const rules = [
    rule('ibu', 'K2', 0, null, {
        gender: 'female',
        requires_pregnancy: true,
        priority: 1,
    }),
    rule('balita', 'K2', 0, 84),
    rule('anak', 'K2', 84, 216),
    rule('dewasa', 'K3', 216, 720),
    rule('lansia', 'K3', 720, null),
];
const visitDate = '2026-11-12';
const classify = (
    birthDate: string | null,
    gender = 'male',
    pregnant = false,
) =>
    classifyVisit(rules, { gender, birthDate, visitDate, pregnant })?.id ??
    null;

describe('life cycle classification', () => {
    test('age in completed months turns over on the birthday, like PostgreSQL age()', () => {
        expect(ageInMonths('2019-11-12', visitDate)).toBe(84);
        expect(ageInMonths('2019-11-13', visitDate)).toBe(83);
        expect(ageInMonths('2026-01-31', '2026-02-28')).toBe(0);
        expect(ageInMonths('2026-01-31', '2026-03-01')).toBe(1);
        expect(ageInMonths('2024-02-29', '2025-02-28')).toBe(11);
        expect(ageInMonths('2024-02-29', '2025-03-01')).toBe(12);
    });

    test('age boundaries are exact at the birthday', () => {
        expect(classify('2019-12-12')).toBe('balita');
        expect(classify('2019-11-13')).toBe('balita');
        expect(classify('2019-11-12')).toBe('anak');
        expect(classify('2009-11-12')).toBe('anak');
        expect(classify('2008-11-13')).toBe('anak');
        expect(classify('2008-11-12')).toBe('dewasa');
        expect(classify('1967-11-12')).toBe('dewasa');
        expect(classify('1966-11-13')).toBe('dewasa');
        expect(classify('1966-11-12')).toBe('lansia');
    });

    test('pregnancy wins over age for women and is only asked where a pregnancy rule can apply', () => {
        expect(classify('2001-05-01', 'female', true)).toBe('ibu');
        expect(classify('2001-05-01', 'female', false)).toBe('dewasa');
        expect(classify('2012-05-01', 'female', true)).toBe('ibu');
        const subject = { birthDate: '2001-05-01', visitDate };
        expect(asksPregnancy(rules, { ...subject, gender: 'female' })).toBe(
            true,
        );
        expect(asksPregnancy(rules, { ...subject, gender: 'male' })).toBe(
            false,
        );
        expect(
            asksPregnancy(
                rules.filter((item) => item.id !== 'ibu'),
                { ...subject, gender: 'female' },
            ),
        ).toBe(false);
    });

    test('a tie on the winning priority or no match leaves the life cycle undetermined', () => {
        const tied = [...rules, rule('ganda', 'K5', 216, 720)];
        expect(
            matchingLifeCycles(tied, {
                gender: 'male',
                birthDate: '1990-01-01',
                visitDate,
                pregnant: false,
            }).map((item) => item.id),
        ).toEqual(['dewasa', 'ganda']);
        expect(
            classifyVisit(tied, {
                gender: 'male',
                birthDate: '1990-01-01',
                visitDate,
                pregnant: false,
            }),
        ).toBeNull();
        expect(classify(null, 'female', false)).toBeNull();
        expect(classify(null, 'female', true)).toBe('ibu');
        expect(
            classifyVisit([], {
                gender: 'male',
                birthDate: '1990-01-01',
                visitDate,
                pregnant: false,
            }),
        ).toBeNull();
    });
});
