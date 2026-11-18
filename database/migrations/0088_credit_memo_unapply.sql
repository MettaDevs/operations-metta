-- Lepas dari faktur, padanan Unapply Entries pada Vendor Ledger Entry BC (page 624 "Unapply Vendor Entries"): nota
-- kredit yang langsung mengurangi utang faktur bisa dilepas lagi. Jumlah yang diterapkan dicatat saat posting, dan
-- pelepasan mencatat tanggal, waktu, dan orangnya; barisnya tidak pernah dihapus.

ALTER TABLE public.ap_tr_nota_kredit
    ADD COLUMN jumlah_diterapkan numeric(19,4),
    ADD COLUMN tanggal_dilepas date,
    ADD COLUMN dilepas_pada timestamp(0) without time zone,
    ADD COLUMN dilepas_oleh_user_id uuid,
    ADD CONSTRAINT ap_tr_nota_kredit_jumlah_diterapkan_check
        CHECK (jumlah_diterapkan IS NULL OR (jumlah_diterapkan > 0 AND entri_utang_tujuan_id IS NOT NULL)),
    ADD CONSTRAINT ap_tr_nota_kredit_dilepas_check
        CHECK (num_nonnulls(tanggal_dilepas, dilepas_pada) IN (0, 2)
               AND (dilepas_pada IS NULL OR jumlah_diterapkan IS NOT NULL));

-- Nota yang diposting sebelum kolom ini ada: jumlahnya pasti hanya bila kreditnya belum dipakai pembayaran.
UPDATE public.ap_tr_nota_kredit h
SET jumlah_diterapkan = e.sisa - e.jumlah
FROM public.ap_tr_entri_utang e
WHERE e.tenant_id = h.tenant_id AND e.nota_kredit_id = h.id AND e.jenis = 'nota_kredit'
  AND h.status = 'diposting' AND h.entri_utang_tujuan_id IS NOT NULL AND e.sisa > e.jumlah
  AND NOT EXISTS (SELECT 1 FROM public.ap_tr_pembayaran_detail d
                  JOIN public.ap_tr_pembayaran p ON p.tenant_id = d.tenant_id AND p.id = d.pembayaran_id
                  WHERE d.tenant_id = e.tenant_id AND d.entri_utang_id = e.id AND d.deleted_at IS NULL
                    AND p.status = 'diposting');
