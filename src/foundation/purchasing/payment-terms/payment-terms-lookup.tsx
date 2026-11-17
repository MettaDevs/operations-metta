import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '@operations-metta/ui/master-lookup';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';

export type PaymentTermsRow =
    ApiBody<'purchasingPaymentTermsList'>['data'][number];
export type PaymentTermsChoice = Omit<PaymentTermsRow, 'version'>;

const load = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.purchasingPaymentTermsList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data,
        nextCursor: body.next_cursor,
        canCreate: body.can_manage,
    };
};

export const paymentTermsChoice = (
    terms: PaymentTermsRow,
): PaymentTermsChoice => ({
    id: terms.id,
    code: terms.code,
    name: terms.name,
    due_days: terms.due_days,
});

export const paymentTermsText = (terms: PaymentTermsChoice | null) =>
    terms ? `${terms.code} · ${terms.name}` : '';

export function PaymentTermsLookup(
    props: MasterLookupProps<PaymentTermsRow>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Termin"
            load={load}
            display={(terms) => `${terms.code} · ${terms.name}`}
            columns={[
                codeColumn(),
                nameColumn(),
                {
                    id: 'due_days',
                    header: 'Hari',
                    width: 80,
                    cell: (terms) => String(terms.due_days),
                },
            ]}
        />
    );
}
