-- LPLPO tidak lagi menjadi layar tetap (keputusan pemilik produk, 13 November 2026): laporan akan berupa template di
-- mesin laporan dan cetak tersendiri. Yang tersisa dari izin laporan persediaan hanya layar Stok per lokasi, jadi
-- namanya disesuaikan. Kodenya tetap, karena kode itu sudah tercatat di role.

UPDATE public.app_entry_points SET name = 'Layar stok per lokasi', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.inventory-report.form';

UPDATE public.permissions SET name = 'Lihat stok per lokasi', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.inventory-report.read';

UPDATE public.security_privileges SET name = 'Melihat stok per lokasi', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.inventory-report.view';

UPDATE public.security_duties SET name = 'Lihat stok per lokasi', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.inventory-report.inquire';
