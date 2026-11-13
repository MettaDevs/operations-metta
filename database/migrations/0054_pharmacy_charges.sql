-- Obat resep sampai ke kasir (src/foundation/billing/charge/), irisan 9 spesifikasi kasir. Padanannya blok BILLFarmasi
-- di GetDetailRincianBiaya: baris OBAT ada sejak penyerahan farmasi disiapkan (BILLFarmasi lahir di Siapkan), dengan
-- Qty = JmlPemakaian - JmlRetur. Module farmasi mengirim potret penuh baris obat satu penyerahan setiap kali Siapkan,
-- Batal siapkan, retur, dan batal retur (pharmacy.dispensing.charges-replaced.v1).
--
-- 1. kunjungan_kasir.jenis_bayar_otomatis_id: jenis bayar otomatis kunjungan dari potret kunjungan selesai, supaya kasir
--    bisa melunasi ulang tagihan yang berubah sesudah lunas otomatis (obat yang disiapkan sesudah kunjungan selesai,
--    tindakan yang diubah, atau rujuk internal). Sistem lama melakukan hal yang sama: Seroja menulis ulang pembayaran
--    BPJS di setiap Simpan poli, dan Kuta melunasi obat BPJS tersendiri di Siapkan.

ALTER TABLE public.kunjungan_kasir
    ADD COLUMN jenis_bayar_otomatis_id uuid;
