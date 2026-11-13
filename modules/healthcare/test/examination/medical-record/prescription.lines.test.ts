import { expect, test } from 'bun:test';
import {
    compoundNumbers,
    isCompoundComponent,
    placeLine,
    removeLines,
} from '../../../src/examination/medical-record/prescription.lines.ts';

type Line = {
    name: string;
    is_compound_header: boolean;
    drug_id: string | null;
    compound: number | null;
};

const header: Line = {
    name: 'Racikan 1',
    is_compound_header: true,
    drug_id: null,
    compound: 1,
};
const component: Line = {
    name: 'Amoxicillin',
    is_compound_header: false,
    drug_id: 'amoxicillin',
    compound: 1,
};
const blank: Line = {
    name: 'baris baru',
    is_compound_header: false,
    drug_id: null,
    compound: null,
};

test('a blank line given a compound number becomes a component under that compound, not a second header', () => {
    const lines = placeLine([header, component, blank], 2, {
        ...blank,
        compound: 1,
    });

    expect(lines.map((line) => line.name)).toEqual([
        'Racikan 1',
        'Amoxicillin',
        'baris baru',
    ]);
    expect(isCompoundComponent(lines[2]!)).toBe(true);
    expect(compoundNumbers(lines)).toEqual([1]);
});

test('deleting a component without a drug keeps the compound header and its other components', () => {
    const lines = [header, component, { ...blank, compound: 1 }];

    expect(removeLines(lines, [2]).map((line) => line.name)).toEqual([
        'Racikan 1',
        'Amoxicillin',
    ]);
});

test('deleting a compound header deletes its components and keeps other lines', () => {
    const single: Line = {
        name: 'Paracetamol',
        is_compound_header: false,
        drug_id: 'paracetamol',
        compound: null,
    };
    const lines = [header, component, { ...blank, compound: 1 }, single];

    expect(removeLines(lines, [0]).map((line) => line.name)).toEqual([
        'Paracetamol',
    ]);
});

test('a line taken out of its compound moves to the end of the prescription', () => {
    const single: Line = {
        name: 'Paracetamol',
        is_compound_header: false,
        drug_id: 'paracetamol',
        compound: null,
    };
    const lines = placeLine([header, component, single], 1, {
        ...component,
        compound: null,
    });

    expect(lines.map((line) => line.name)).toEqual([
        'Racikan 1',
        'Paracetamol',
        'Amoxicillin',
    ]);
});
