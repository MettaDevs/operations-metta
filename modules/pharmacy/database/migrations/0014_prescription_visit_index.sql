-- Resep per kunjungan. Daftar Pembayaran dan Form Pembayaran membaca ulang resep yang belum disiapkan untuk semua
-- kunjungan belum bayar secara berkala (waitingPrescriptionHolds), jadi far_tr_resep dicari lewat kunjungan_id, bukan
-- dipindai seluruhnya.

CREATE INDEX far_tr_resep_kunjungan_index
    ON public.far_tr_resep USING btree (tenant_id, kunjungan_id) WHERE (deleted_at IS NULL);
