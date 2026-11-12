-- Envelope event membawa org_unit_id bila faktanya milik operating unit (docs/dev/04-api-and-integration.md di repo
-- CoreERP, Kontrak wajib). Outbox CoreERP tidak punya kolomnya; celah itu tercatat di docs/design-system/03-alur-data.md
-- bagian 10. Kolom ini ditambahkan sebelum event pertama diterbitkan, karena field asal fakta tidak bisa diisi
-- belakangan untuk baris yang sudah ada.
ALTER TABLE public.outbox_events ADD COLUMN org_unit_id uuid;
