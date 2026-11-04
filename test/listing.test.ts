import { expect, test } from 'bun:test';
import { searchTerms } from '../src/platform/listing.ts';

test('record search retains phrases, Unicode words and punctuation behavior', () => {
    expect(searchTerms('  "Aset baru" CAFE\u0301.12  ')).toEqual([
        { phrase: true, text: 'aset baru' },
        { phrase: false, text: 'café.12' },
    ]);
    expect(searchTerms('--- ... !!!')).toEqual([]);
    expect(searchTerms('"" pompa-air')).toEqual([
        { phrase: false, text: 'pompa-air' },
    ]);
});
