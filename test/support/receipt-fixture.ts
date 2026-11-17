import PizZip from 'pizzip';
import type postgres from 'postgres';
import {
    registerBillingEventHandlers,
    replaceSaleBill,
} from '../../src/foundation/billing/index.ts';
import { Database } from '../../src/platform/database/index.ts';
import { createBillingBusiness, json } from './billing-fixtures.ts';
import type { Browser } from './operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
    setCurrencyPrecision,
} from './tenant-fixtures.ts';

// Teks dokumen Word, satu baris per paragraf, untuk memeriksa isi cetakan tanpa renderer.
export function documentText(docx: Uint8Array): string {
    const xml = new PizZip(docx).file('word/document.xml')?.asText() ?? '';
    return xml
        .replaceAll(/<\/w:p>/g, '\n')
        .replaceAll(/<[^>]+>/g, '')
        .replaceAll(/[ \t]+/g, ' ');
}

// Satu pembayaran kasir sintetis untuk test cetak: penjualan obat 24.000 dibayar tunai 50.000, di legal entity berzona
// WITA dengan rupiah utuh dan kop surat sendiri. `duties` menambah duty kasir pembuatnya.
export async function paidReceipt(
    pool: postgres.Sql,
    browser: () => Browser,
    name: string,
    duties: string[] = [],
) {
    registerBillingEventHandlers();
    const business = await createBillingBusiness(pool, browser, name, [
        'core.billing-setup.manage',
        'core.clerk.operate',
        'core.payment.operate',
        ...duties,
    ]);
    const { tenantId, legalEntityId, admin: cashier } = business;
    await setCurrencyPrecision(pool, tenantId, {
        amount_decimals: 0,
        unit_amount_decimals: 2,
        invoice_rounding_precision: '1',
        invoice_rounding_type: 'nearest',
    });
    await pool.unsafe(
        `update legal_entities set timezone = 'Asia/Makassar' where organization_id = $1`,
        [legalEntityId],
    );
    await pool.unsafe(
        `insert into print_identities (id, tenant_id, organization_id, display_name, parent_lines, tax_id,
                                       registration_id, footer_text, logos, created_at, updated_at)
         values ($1, $2, $3, 'Klinik Pratama Uji', '["Yayasan Sehat Uji"]', '01.234.567.8-901.000',
                 'Izin 123/2026', 'Terima kasih atas kunjungan Anda', '[]', now(), now())`,
        [Bun.randomUUIDv7(), tenantId, legalEntityId],
    );
    await json(
        await cashier.post('/api/v1/billing/payment-methods', {
            code: 'TUN',
            name: 'Tunai',
            behavior: 'tunai',
            counted_at_close: true,
        }),
        201,
    );
    await json(await cashier.post('/api/v1/billing/clerks/start', {}), 201);
    const documentId = Bun.randomUUIDv7();
    const item = (code: string, itemName: string) => ({
        id: Bun.randomUUIDv7(),
        code,
        name: itemName,
    });
    const connection = await pool.reserve();
    let version: number;
    try {
        const db = new Database(connection, undefined, Bun.randomUUIDv7());
        ({ version } = await db.transaction(() =>
            replaceSaleBill(db, {
                tenantId,
                legalEntityId,
                operatingUnitId: null,
                module: 'pharmacy',
                documentId,
                number: 'OTC-0001',
                date: '2026-11-16',
                buyer: { partyId: null, name: 'Budi Contoh' },
                group: 'OBAT',
                fees: [],
                lines: [
                    {
                        lineId: Bun.randomUUIDv7(),
                        item: item('PCT', 'Parasetamol'),
                        quantity: '10',
                        unitPrice: '1500',
                        discountPercent: '0',
                    },
                    {
                        lineId: Bun.randomUUIDv7(),
                        item: item('VTC', 'Vitamin C'),
                        quantity: '2',
                        unitPrice: '5000',
                        discountPercent: '10',
                    },
                ],
            }),
        ));
    } finally {
        connection.release();
    }
    const paid = await json<{ data: { id: string; number: string } }>(
        await cashier.post(`/api/v1/billing/visits/${documentId}/payments`, {
            version,
            received: '50000',
        }),
        201,
    );
    // Anggota lain di tenant yang sama, dengan duty yang disebut.
    async function member(memberDuties: string[], app = { pool, browser }) {
        const created = await createMember(app.pool, tenantId, memberDuties);
        await grantAllOrganizations(app.pool, tenantId, created.membershipId);
        const session = app.browser();
        await session.login(created.email, created.password);
        return session;
    }
    return {
        tenantId,
        legalEntityId,
        membershipId: business.member.membershipId,
        cashier,
        paymentId: paid.data.id,
        paymentNumber: paid.data.number,
        member,
    };
}
