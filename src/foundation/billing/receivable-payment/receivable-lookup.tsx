import { displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import {
    MasterLookup,
    type LookupRequest,
    type MasterLookupProps,
} from '@operations-metta/ui/master-lookup';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';

type ReceivableRow = ApiBody<'billingReceivableList'>['data'][number];
export type Receivable = ReceivableRow & { code: string; name: string };

const load = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.billingReceivableList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((row): Receivable => ({
            ...row,
            code: row.invoice_number,
            name: row.patient_name,
        })),
        nextCursor: body.next_cursor,
    };
};

// Lookup Nomor Invoice form Pembayaran Hutang: piutang yang belum lunas, satu baris per jenis bayar piutang pada
// pembayaran itu.
export function ReceivableLookup(
    props: MasterLookupProps<Receivable>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Invoice"
            placeholder="Cari nomor invoice, no. registrasi, atau pasien…"
            load={load}
            display={(receivable) => receivable.code}
            columns={[
                {
                    id: 'invoice_number',
                    header: 'Nomor Invoice',
                    width: 150,
                    cell: (row) => row.invoice_number,
                },
                {
                    id: 'invoice_date',
                    header: 'Tanggal',
                    width: 110,
                    cell: (row) => displayDate(row.invoice_date),
                },
                {
                    id: 'registration_number',
                    header: 'No. Registrasi',
                    width: 140,
                    cell: (row) => row.registration_number,
                },
                {
                    id: 'patient_name',
                    header: 'Pasien',
                    width: 200,
                    cell: (row) => row.patient_name,
                },
                {
                    id: 'party_name',
                    header: 'Pihak',
                    width: 180,
                    cell: (row) => row.party_name,
                },
                {
                    id: 'payment_method_name',
                    header: 'Jenis bayar',
                    width: 130,
                    cell: (row) => row.payment_method_name,
                },
                {
                    id: 'remaining',
                    header: 'Kewajiban',
                    width: 130,
                    align: 'right',
                    cell: (row) => displayNumber(row.remaining),
                },
            ]}
        />
    );
}
