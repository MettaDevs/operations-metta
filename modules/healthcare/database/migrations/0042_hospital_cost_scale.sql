-- Cost RS tindakan mengikuti satu skala persen dan presisi jumlah mata uang tenant (src/platform/money/ dan
-- src/foundation/currency/), bukan dua angka di belakang koma yang ditulis mati di kode. Kolomnya dilebarkan seperti
-- kolom persen dan uang lain: persen numeric(9,4), jumlah numeric(19,4). Pembulatannya tetap di kode. Nilai yang ada
-- tidak berubah.

ALTER TABLE public.sim_m_tindakan
    ALTER COLUMN cost_rs_persen TYPE numeric(9,4),
    ALTER COLUMN cost_rs_rupiah TYPE numeric(19,4);
