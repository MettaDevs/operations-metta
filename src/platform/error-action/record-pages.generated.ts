// Dibuat `bun scripts/generate-client.ts` dari setiap `defineRecordPage` di berkas `.page.tsx`; jangan disunting tangan.
export const recordPageKeys = [
    'core.inventory-location',
    'core.payment',
    'core.purchase-invoice',
    'core.purchase-order',
    'core.purchase-receipt',
    'core.vendor-payment',
] as const;
