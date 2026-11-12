-- Obat layanan kesehatan menjadi barang Core (rencana farmasi + persediaan, langkah 6a, keputusan 13 November 2026).
-- Obat adalah barang: kode, nama, satuan dasar, satuan kemasan, pelacakan, dan blokir milik gd_m_barang. Module
-- layanan kesehatan menyimpan atribut klinisnya di sim_m_obat sebagai perluasan barang (pola table extension BC), dengan
-- id yang sama. Satuan obat (sim_m_satuan_obat) menjadi satuan Core (gd_m_satuan), juga dengan id yang sama.
--
-- Migration ini menyalin data E3 yang sudah ada. Core boleh membaca tabel module (keputusan pemilik produk, 3 Oktober
-- 2026), sedangkan module hanya menulis data Core lewat fungsi Core, jadi penyalinan ditaruh di sini dan migration
-- module berikutnya (healthcare 0027) memasang FK lalu membuang kolom kembar. Ini satu-satunya migration Core yang
-- menyebut tabel module, dan hanya membaca; aturan "migration Core tidak merujuk tabel module" dilonggarkan untuk
-- pindahan satu kali ini dengan dua penjaga:
-- - Di database baru migration Core berjalan sebelum migration module, sehingga tabelnya belum ada. to_regclass
--   melewati penyalinan; obat yang dibuat sesudahnya langsung lahir sebagai barang lewat kartu obat.
-- - Di database yang sudah berisi E3, runner menjalankan semua migration Core sebelum module, jadi salinan ini selalu
--   lebih dulu dari healthcare 0027.
--
-- Barang dan satuan Core milik legal entity, sedangkan obat dan satuan obat E3 milik tenant. Satu id hanya bisa
-- berada di satu legal entity, jadi semua obat satu tenant pindah ke satu legal entity: yang kunjungannya paling banyak
-- (sim_tr_registrasi.legal_entity_id, tempat E-Resep dipakai dan stok kelak dikeluarkan farmasi), lalu yang paling awal
-- dibuat. Tenant tanpa legal entity tidak bisa memegang barang dan dilewati; healthcare 0027 menangani obatnya.
--
-- Kode Core wajib, paling panjang 20, huruf besar, dan unik per legal entity. Kode obat dan satuan dipakai apa adanya
-- dalam huruf besar. Kode yang kosong, lebih dari 20 karakter, atau sudah dipakai barang Core di legal entity itu diganti
-- OBT- (atau SAT-) ditambah 12 karakter terakhir id-nya. Satuan obat yang kodenya sudah ada sebagai satuan Core di legal
-- entity itu tidak disalin; obat yang memakainya menunjuk satuan Core tersebut. Baris yang sudah dihapus ikut disalin
-- sebagai baris terhapus, supaya resep dan alergi lama tetap menunjuk barang yang ada.

DO $$
BEGIN
    IF to_regclass('public.sim_m_obat') IS NULL OR to_regclass('public.sim_m_satuan_obat') IS NULL THEN
        RETURN;
    END IF;

    CREATE TEMPORARY TABLE pindah_legal_entity ON COMMIT DROP AS
    SELECT t.tenant_id,
           (SELECT o.id
            FROM public.organizations o
            WHERE o.tenant_id = t.tenant_id AND o.classification = 'legal_entity'
            ORDER BY (SELECT count(*) FROM public.sim_tr_registrasi r
                      WHERE r.tenant_id = o.tenant_id AND r.legal_entity_id = o.id) DESC,
                     o.created_at, o.id
            LIMIT 1) AS legal_entity_id
    FROM (SELECT DISTINCT tenant_id FROM public.sim_m_obat
          UNION
          SELECT DISTINCT tenant_id FROM public.sim_m_satuan_obat) t;
    DELETE FROM pindah_legal_entity WHERE legal_entity_id IS NULL;

    CREATE TEMPORARY TABLE pindah_satuan ON COMMIT DROP AS
    SELECT s.id AS satuan_obat_id, s.tenant_id, l.legal_entity_id, s.nama, s.created_at, s.updated_at, s.deleted_at,
           upper(trim(s.kode)) AS kode,
           (SELECT g.id FROM public.gd_m_satuan g
            WHERE g.tenant_id = s.tenant_id AND g.legal_entity_id = l.legal_entity_id
              AND g.kode = upper(trim(s.kode)) AND g.deleted_at IS NULL) AS satuan_core_id
    FROM public.sim_m_satuan_obat s
    JOIN pindah_legal_entity l ON l.tenant_id = s.tenant_id;

    INSERT INTO public.gd_m_satuan (id, tenant_id, legal_entity_id, kode, nama, created_at, updated_at, deleted_at)
    SELECT p.satuan_obat_id, p.tenant_id, p.legal_entity_id,
           CASE WHEN p.kode = '' OR length(p.kode) > 20
                THEN 'SAT-' || upper(right(replace(p.satuan_obat_id::text, '-', ''), 12))
                ELSE p.kode END,
           left(p.nama, 100), p.created_at, p.updated_at, p.deleted_at
    FROM pindah_satuan p
    WHERE p.satuan_core_id IS NULL OR p.deleted_at IS NOT NULL;

    INSERT INTO public.gd_m_barang (id, tenant_id, legal_entity_id, kode, nama, satuan_dasar_id, diblokir, created_at,
                                    updated_at, deleted_at)
    SELECT o.id, o.tenant_id, l.legal_entity_id,
           CASE WHEN coalesce(trim(o.kode), '') = '' OR length(trim(o.kode)) > 20
                     OR EXISTS (SELECT 1 FROM public.gd_m_barang b
                                WHERE b.tenant_id = o.tenant_id AND b.legal_entity_id = l.legal_entity_id
                                  AND b.kode = upper(trim(o.kode)) AND b.deleted_at IS NULL)
                THEN 'OBT-' || upper(right(replace(o.id::text, '-', ''), 12))
                ELSE upper(trim(o.kode)) END,
           o.nama,
           CASE WHEN p.deleted_at IS NULL THEN coalesce(p.satuan_core_id, p.satuan_obat_id) ELSE p.satuan_obat_id END,
           false, o.created_at, o.updated_at, o.deleted_at
    FROM public.sim_m_obat o
    JOIN pindah_legal_entity l ON l.tenant_id = o.tenant_id
    JOIN pindah_satuan p ON p.satuan_obat_id = o.satuan_id;
END;
$$;
