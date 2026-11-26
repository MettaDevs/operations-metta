-- Search indexes for bill_farmasi (combined FTS GIN + B-tree prefix seek on nomor)

CREATE INDEX IF NOT EXISTS bill_farmasi_search_combined_gin_idx
    ON public.bill_farmasi USING gin (
        to_tsvector(
            'simple'::regconfig,
            regexp_replace(
                normalize(
                    coalesce(cast(nomor as text), '') || ' ' || coalesce(cast(pembeli_nama as text), ''),
                    NFC
                ),
                '[^[:alnum:]]+',
                ' ',
                'g'
            )
        )
    )
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bill_farmasi_nomor_prefix_idx
    ON public.bill_farmasi (tenant_id, legal_entity_id, lower(cast(nomor as text)) text_pattern_ops)
    WHERE deleted_at IS NULL;
