import { expect, test } from 'bun:test';
import {
    emptyDraft,
    isDraftDirty,
    type Draft,
} from '../../../src/registration/visit/visit-draft.ts';

test('an untouched registration form is not dirty', () => {
    expect(isDraftDirty(emptyDraft)).toBe(false);
    expect(isDraftDirty({ ...emptyDraft })).toBe(false);
});

test('any field the clerk fills or picks makes the form dirty', () => {
    const changes: Partial<Draft>[] = [
        {
            payer: {
                patientType: { id: 't1', name: 'Umum', behaviors: [] },
                guarantor: null,
                cardNumber: '',
            },
        },
        { height: '170' },
        { weight: '60' },
        { condition: 'sehat' },
        { conditionIds: ['c1'] },
        { signIds: ['s1'] },
        { kind: 'poli' },
        { sectionId: 'sec1' },
        { scheduleId: 'sch1' },
        { pregnant: true },
    ];
    for (const change of changes)
        expect(isDraftDirty({ ...emptyDraft, ...change })).toBe(true);
});

test('ticking a sign and unticking it again leaves the form clean', () => {
    const ticked = { ...emptyDraft, signIds: ['s1'] };
    expect(isDraftDirty({ ...ticked, signIds: [] })).toBe(false);
});
