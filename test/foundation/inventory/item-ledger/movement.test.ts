import { describe, expect, test } from 'bun:test';
import { movementLabel } from '../../../../src/foundation/inventory/item-ledger/movement.ts';

describe('stock card movement words', () => {
    test('a direction names the movement, and a reversal names what it undoes', () => {
        const label = (
            kind: Parameters<typeof movementLabel>[0]['kind'],
            inbound: boolean,
            reversal = false,
            sourceType = '',
        ) => movementLabel({ kind, sourceType, inbound, reversal });
        expect(label('penerimaan', true)).toBe('Terima dari vendor');
        expect(label('penerimaan', false)).toBe('Retur ke vendor');
        expect(label('penerimaan', false, true)).toBe(
            'Batal terima dari vendor',
        );
        expect(label('transfer', false)).toBe('Mutasi keluar');
        expect(label('penyerahan', false)).toBe('Keluar ke pasien');
        expect(label('penyerahan', true)).toBe('Retur dari pasien');
        expect(label('penyesuaian_kurang', false, false, 'opname')).toBe(
            'Selisih opname (kurang)',
        );
        expect(label('pemakaian', true, true)).toBe('Batal pemakaian');
    });
});
