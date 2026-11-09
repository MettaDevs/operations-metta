"""Oracle SQL independen atas database kandidat. Tidak mengimpor kode aplikasi.

Setiap baris tahan lama baru harus dimiliki pekerjaan yang diakui HTTP, dan setiap baris seed harus identik
dengan baseline yang direkam dari clone seed uuid sebelum kandidat menyentuhnya.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
from pathlib import Path
import re

import ids
from lab import Lab

CREATION_KEY = re.compile(r"[A-Za-z0-9:_-]{1,200}")
PHANTOM_RECEIPT = "77777777-7777-7777-7777-777777777777"
POSTING_OWNER = "(SELECT p.posting_id FROM finance_postings p WHERE p.id=x.finance_posting_id)"
# Pekerjaan tahan lama profil ini. Setiap baris baru harus dimiliki receipt, aset, posting, atau
# nomor yang diakui HTTP; baris seed harus tetap identik dengan baseline.
DURABLE = {
    "aset_tr_penerimaan_aset": ("x.id", "receipt"),
    "aset_tr_penerimaan_aset_details": ("x.penerimaan_aset_id", "receipt"),
    "aset_tr_aset": ("x.id", "asset"),
    "aset_tr_buku_aset": ("x.aset_id", "asset"),
    "aset_tr_ledger_aset": ("x.aset_id", "asset"),
    "aset_tr_penempatan_aset": ("x.aset_id", "asset"),
    "aset_tr_aset_atribut": ("x.aset_id", "asset"),
    "finance_postings": ("x.posting_id", "posting"),
    "finance_posting_lines": (POSTING_OWNER, "posting"),
    "finance_posting_events": (POSTING_OWNER, "posting"),
    "finance_posting_deliveries": (POSTING_OWNER, "posting"),
    "number_sequence_issues": ("x.idempotency_key", "number"),
}
HEADER_FIELDS = [
    "legal_entity_id", "responsible_org_unit_id", "receiving_org_unit_id", "tanggal", "tanggal_siap_pakai",
    "diterima_oleh_user_id", "penanggung_jawab_user_id", "lokasi_aset_id", "currency_code", "keterangan",
    "cara_perolehan", "vendor_id", "vendor_invoice_reference", "vendor_invoice_date", "purchase_order_reference",
]
DETAIL_TEXT_FIELDS = [
    "nama", "group_aset_id", "jenis_aset_id", "kondisi_aset_id", "pabrikan_aset_id", "model_aset_id",
    "model_number", "keterangan", "permintaan_pembelian_detail_id",
]


def durable_rows() -> str:
    return "\n UNION ALL ".join(
        f"SELECT '{table}' AS table_name, x.id::text AS id, md5(row_to_json(x)::text) AS hash, '{kind}' AS kind, ({owner})::text AS owner FROM {table} x"
        for table, (owner, kind) in DURABLE.items()
    )


def capture_baseline(lab: Lab, database: str, template: str) -> dict:
    lab.validate_database(database)
    rows = json.loads(lab.sql("SELECT coalesce(json_agg(json_build_array(table_name,id,hash)),'[]'::json) FROM (" + durable_rows() + ") d;", database))
    tables: dict[str, dict[str, str]] = {table: {} for table in DURABLE}
    for table, identifier, digest in rows:
        tables[table][identifier] = digest
    return {"database": database, "template": template, "tables": tables}


def missing_seed_rows(baseline: dict, coreerp: dict) -> dict[str, dict[str, int]]:
    """Seed uuid harus memuat tepat baris tahan lama seed CoreERP. Hash isi tidak bisa dibandingkan lintas bentuk id,
    karena row_to_json menulis teks id-nya, jadi yang dicocokkan adalah himpunan id lewat ulid_to_uuid."""
    gaps = {}
    for table in DURABLE:
        expected = {ids.ulid_to_uuid(value) if ids.ULID.fullmatch(value) else value for value in coreerp["tables"][table]}
        actual = set(baseline["tables"][table])
        if expected != actual:
            gaps[table] = {"only_coreerp": len(expected - actual), "only_uuid_seed": len(actual - expected)}
    return gaps


def single(run: dict, operation: str, status: int) -> dict:
    events = [event for event in run["events"] if event["operation"] == operation]
    if len(events) != 1 or events[0]["status"] != status:
        raise ValueError("Exactly one HTTP acknowledgement is required: " + operation)
    return events[0]["body"]["data"]


def flow_acknowledgement(run: dict) -> dict:
    """Satu siklus driver HTTP: hanya respons yang diterima generator, tanpa membaca database."""
    created = single(run, "receipt-create", 201)
    completed = single(run, "receipt-complete", 200)
    assets = single(run, "receipt-assets", 200)
    if completed["id"] != created["id"] or completed["status"] != "selesai":
        raise ValueError("Completion acknowledgement does not point to the created receipt.")
    return {
        "account": run["account"], "receipt_id": created["id"], "creation_key": created["creation_key"],
        "receipt_code": created["kode"], "outcome": "completed", "version": completed["version"],
        "asset_ids": [asset["id"] for asset in assets], "asset_codes": [asset["kode"] for asset in assets],
        "posting_id": completed["posting"]["posting_id"],
    }


def load_acknowledgements(paths: list[Path]) -> list[dict]:
    entries = []
    for path in paths:
        run = json.loads(path.read_text(encoding="utf-8"))
        entries.extend(run["acknowledgements"] if "acknowledgements" in run else [flow_acknowledgement(run)])
    return entries


def bind(entries: list[dict], fixture: dict) -> list[dict]:
    """Ikat acknowledgement ke akun dan input fixture; fixture, bukan generator, menjadi sumber harapan."""
    bound, receipts, keys = [], set(), set()
    tenants = {tenant["tenant_id"]: tenant for tenant in fixture["tenants"]}
    for entry in entries:
        account = fixture["accounts"][entry["account"]["index"]]
        for key in ["user_id", "tenant_id", "legal_entity_id", "membership_id"]:
            if entry["account"].get(key) != account[key]:
                raise ValueError("Acknowledgement account differs from the fixture: " + key)
        if entry["outcome"] not in {"completed", "draft"} or type(entry["version"]) is not int:
            raise ValueError("Acknowledgement outcome or version is invalid.")
        identifiers = [entry["receipt_id"], *entry["asset_ids"]]
        if not all(isinstance(value, str) and ids.UUID.fullmatch(value) for value in identifiers):
            raise ValueError("Acknowledgement ID is not a canonical UUID.")
        if not isinstance(entry["creation_key"], str) or not CREATION_KEY.fullmatch(entry["creation_key"]):
            raise ValueError("Acknowledgement creation_key is invalid.")
        if entry["receipt_id"] in receipts or entry["creation_key"] in keys or len(set(entry["asset_ids"])) != len(entry["asset_ids"]):
            raise ValueError("One job is acknowledged twice.")
        receipts.add(entry["receipt_id"])
        keys.add(entry["creation_key"])
        bound.append({
            "user_id": account["user_id"], "tenant_id": account["tenant_id"], "legal_entity_id": account["legal_entity_id"],
            "receipt_id": entry["receipt_id"], "creation_key": entry["creation_key"], "receipt_code": entry["receipt_code"],
            "outcome": entry["outcome"], "version": entry["version"], "asset_ids": entry["asset_ids"],
            "asset_codes": entry["asset_codes"], "posting_id": entry.get("posting_id"),
            "body": tenants[account["tenant_id"]]["receipt_body"],
        })
    return bound


def query(fixture: dict, acknowledgements: list[dict], baseline: dict) -> str:
    data = {**fixture, "acknowledgements": acknowledgements, "baseline": baseline}
    encoded = base64.b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    header = ", ".join(f"('{field}', x.{field}::text)" for field in HEADER_FIELDS)
    detail = "\n       ".join(f"AND x.{field}::text IS NOT DISTINCT FROM line.body->>'{field}'" for field in DETAIL_TEXT_FIELDS)
    tables = ", ".join(f"('{table}')" for table in DURABLE)
    # source_id di finance_postings dan aset_tr_ledger_aset tetap varchar berisi teks uuid, jadi dibandingkan sebagai teks.
    return """
WITH input AS (
 SELECT convert_from(decode('""" + encoded + """','base64'),'UTF8')::jsonb AS data
), f AS (
 SELECT item.*, data->>'module_id' AS module_id
 FROM input, jsonb_to_recordset(data->'tenants') AS item(
   tenant_id uuid, legal_entity_id uuid, vendor_id uuid, book_id uuid, profile_id uuid,
   attribute_id uuid, attribute_value text, business_unit_code text
 )
), ack AS (
 SELECT item.* FROM input, jsonb_to_recordset(data->'acknowledgements') AS item(
   user_id bigint, tenant_id uuid, legal_entity_id uuid, receipt_id uuid, creation_key text, receipt_code text,
   outcome text, version integer, asset_ids jsonb, asset_codes jsonb, posting_id text, body jsonb
 )
), ack_asset AS (
 SELECT k.receipt_id, asset.value::uuid AS asset_id FROM ack k, jsonb_array_elements_text(k.asset_ids) asset(value)
), ack_owner AS (
 SELECT 'receipt' AS kind, receipt_id::text AS owner FROM ack
 UNION SELECT 'asset', asset_id::text FROM ack_asset
 UNION SELECT 'posting', posting_id FROM ack WHERE posting_id IS NOT NULL
 UNION SELECT 'number', 'penerimaan-aset:'||creation_key FROM ack
 UNION SELECT 'number', 'aset:'||a.creation_key FROM aset_tr_aset a JOIN ack_asset k ON k.asset_id=a.id
), base_row AS (
 SELECT t.key AS table_name, r.key AS id, r.value #>> '{}' AS hash
 FROM input, jsonb_each(data->'baseline'->'tables') t, jsonb_each(t.value) r
), durable AS (
 """ + durable_rows() + """
), new_row AS (
 SELECT n.* FROM durable n WHERE NOT EXISTS(SELECT 1 FROM base_row b WHERE b.table_name=n.table_name AND b.id=n.id)
), r AS (
 SELECT r.*, f.book_id, f.profile_id, f.attribute_id, f.attribute_value, f.business_unit_code, f.module_id
 FROM aset_tr_penerimaan_aset r JOIN f USING(tenant_id)
 WHERE r.deleted_at IS NULL
), d AS (
 SELECT penerimaan_aset_id AS receipt_id, sum(jumlah) AS quantity,
   sum(round(nilai_per_unit*jumlah,2)) AS value,
   sum(round(ppn_per_unit*jumlah,2)) AS tax
 FROM aset_tr_penerimaan_aset_details GROUP BY penerimaan_aset_id
), completed AS (
 SELECT r.*, coalesce(d.quantity,0) AS quantity, coalesce(d.value,0) AS value, coalesce(d.tax,0) AS tax
 FROM r LEFT JOIN d ON d.receipt_id=r.id WHERE r.status='selesai'
), asset AS (
 SELECT a.*, c.profile_id AS expected_profile_id, c.book_id AS expected_book_id,
   c.attribute_id AS expected_attribute_id, c.attribute_value AS expected_attribute_value,
   c.updated_by_user_id AS expected_actor_id, c.module_id,
   line.jumlah AS line_quantity, round(line.nilai_per_unit*line.jumlah,2) AS line_value,
   substring(a.creation_key FROM ':([0-9]+)$')::integer AS unit_index
 FROM aset_tr_aset a JOIN completed c ON c.id=a.penerimaan_aset_id
 JOIN aset_tr_penerimaan_aset_details line ON line.id=a.penerimaan_aset_detail_id
 WHERE a.deleted_at IS NULL
), failures AS (
 SELECT 'foreign_tenant' AS label, count(*) AS violations FROM tenants
 WHERE id NOT IN (SELECT tenant_id FROM f)
 UNION ALL SELECT 'ack_nonempty_completed', CASE WHEN EXISTS(SELECT 1 FROM ack WHERE outcome='completed') THEN 0 ELSE 1 END
 UNION ALL SELECT 'ack_receipt_stored', count(*) FROM ack k WHERE NOT EXISTS(
   SELECT 1 FROM aset_tr_penerimaan_aset x WHERE x.id=k.receipt_id AND x.tenant_id=k.tenant_id
     AND x.legal_entity_id=k.legal_entity_id AND x.creation_key=k.creation_key AND x.kode=k.receipt_code AND x.deleted_at IS NULL)
 UNION ALL SELECT 'ack_state', count(*) FROM ack k JOIN aset_tr_penerimaan_aset x ON x.id=k.receipt_id
 WHERE x.version<>k.version OR x.status<>CASE k.outcome WHEN 'completed' THEN 'selesai' ELSE 'draft' END
 UNION ALL SELECT 'ack_actor', count(*) FROM ack k WHERE
   EXISTS(SELECT 1 FROM aset_tr_penerimaan_aset x WHERE x.id=k.receipt_id
     AND (x.created_by_user_id IS DISTINCT FROM k.user_id OR x.updated_by_user_id IS DISTINCT FROM k.user_id))
   OR EXISTS(SELECT 1 FROM aset_tr_penerimaan_aset_details x WHERE x.penerimaan_aset_id=k.receipt_id
     AND (x.created_by_user_id IS DISTINCT FROM k.user_id OR x.updated_by_user_id IS DISTINCT FROM k.user_id))
   OR EXISTS(SELECT 1 FROM aset_tr_aset x WHERE x.penerimaan_aset_id=k.receipt_id
     AND (x.created_by_user_id IS DISTINCT FROM k.user_id OR x.updated_by_user_id IS DISTINCT FROM k.user_id))
 UNION ALL SELECT 'ack_header_input', count(*) FROM ack k JOIN aset_tr_penerimaan_aset x ON x.id=k.receipt_id
 WHERE EXISTS(SELECT 1 FROM (VALUES """ + header + """) stored(field, value)
   WHERE k.body->>stored.field IS DISTINCT FROM stored.value)
 UNION ALL SELECT 'ack_detail_input', count(*) FROM ack k WHERE
   (SELECT count(*) FROM aset_tr_penerimaan_aset_details x WHERE x.penerimaan_aset_id=k.receipt_id)<>jsonb_array_length(k.body->'details')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(k.body->'details') WITH ORDINALITY line(body, number)
     WHERE NOT EXISTS(SELECT 1 FROM aset_tr_penerimaan_aset_details x
       WHERE x.penerimaan_aset_id=k.receipt_id AND x.tenant_id=k.tenant_id AND x.line_number=line.number
       """ + detail + """
       AND x.jumlah=(line.body->>'jumlah')::integer
       AND x.nilai_per_unit=(line.body->>'nilai_per_unit')::numeric
       AND x.ppn_per_unit=coalesce((line.body->>'ppn_per_unit')::numeric,0)
       AND x.residu_per_unit=coalesce((line.body->>'residu_per_unit')::numeric,0)
       AND x.akumulasi_per_unit=0 AND x.periode_berjalan=0 AND x.saldo_awal_buku IS NULL
       AND x.atribut::jsonb=coalesce(line.body->'atribut','[]'::jsonb)))
 UNION ALL SELECT 'ack_assets_exact', count(*) FROM ack k WHERE
   coalesce((SELECT jsonb_agg(x.id::text ORDER BY x.id) FROM aset_tr_aset x WHERE x.penerimaan_aset_id=k.receipt_id AND x.deleted_at IS NULL),'[]'::jsonb)
     <> (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements_text(k.asset_ids) value)
   OR coalesce((SELECT jsonb_agg(x.kode ORDER BY x.kode) FROM aset_tr_aset x WHERE x.penerimaan_aset_id=k.receipt_id AND x.deleted_at IS NULL),'[]'::jsonb)
     <> (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements_text(k.asset_codes) value)
   OR jsonb_array_length(k.asset_ids)<>CASE k.outcome WHEN 'completed'
     THEN (SELECT sum((line->>'jumlah')::integer) FROM jsonb_array_elements(k.body->'details') line) ELSE 0 END
 UNION ALL SELECT 'ack_posting', count(*) FROM ack k WHERE
   (SELECT count(*) FROM finance_postings p WHERE p.tenant_id=k.tenant_id AND p.source_id=k.receipt_id::text)
     <> CASE k.outcome WHEN 'completed' THEN 1 ELSE 0 END
   OR (k.outcome='completed' AND (k.posting_id IS DISTINCT FROM 'AST-ACQ-'||k.receipt_id OR NOT EXISTS(
     SELECT 1 FROM finance_postings p WHERE p.tenant_id=k.tenant_id AND p.source_id=k.receipt_id::text AND p.posting_id=k.posting_id)))
 UNION ALL SELECT 'unacknowledged_'||t.table_name, (SELECT count(*) FROM new_row n WHERE n.table_name=t.table_name
   AND NOT EXISTS(SELECT 1 FROM ack_owner o WHERE o.kind=n.kind AND o.owner=n.owner))
 FROM (VALUES """ + tables + """) t(table_name)
 UNION ALL SELECT 'baseline_rows_changed', count(*) FROM base_row b
 WHERE NOT EXISTS(SELECT 1 FROM durable n WHERE n.table_name=b.table_name AND n.id=b.id AND n.hash=b.hash)
 UNION ALL SELECT 'completed_header_version', count(*) FROM completed WHERE version<3
 UNION ALL SELECT 'completed_asset_count', count(*) FROM completed c
 WHERE (SELECT count(*) FROM asset a WHERE a.penerimaan_aset_id=c.id)<>c.quantity
 UNION ALL SELECT 'asset_value_sum', count(*) FROM completed c
 WHERE (SELECT coalesce(sum(acquisition_value),0) FROM asset a WHERE a.penerimaan_aset_id=c.id)<>c.value
 UNION ALL SELECT 'asset_allocation', count(*) FROM asset
 WHERE unit_index IS NULL OR acquisition_value <>
   (floor(line_value*100/line_quantity) + CASE WHEN unit_index<=mod(line_value*100,line_quantity) THEN 1 ELSE 0 END)/100
 UNION ALL SELECT 'asset_scope', count(*) FROM asset a JOIN completed c ON c.id=a.penerimaan_aset_id
 WHERE a.tenant_id<>c.tenant_id OR a.legal_entity_id<>c.legal_entity_id
 UNION ALL SELECT 'asset_actor', count(*) FROM asset
 WHERE created_by_user_id IS DISTINCT FROM expected_actor_id
 UNION ALL SELECT 'asset_actual_state', count(*) FROM asset
 WHERE is_budgeted OR lifecycle_state<>'received'
 UNION ALL SELECT 'draft_no_completion', count(*) FROM r WHERE status='draft' AND (
   EXISTS(SELECT 1 FROM aset_tr_aset a WHERE a.penerimaan_aset_id=r.id) OR
   EXISTS(SELECT 1 FROM finance_postings p WHERE p.posting_id='AST-ACQ-'||r.id AND p.tenant_id=r.tenant_id))
 UNION ALL SELECT 'one_pending_posting', count(*) FROM completed c WHERE
   (SELECT count(*) FROM finance_postings p WHERE p.tenant_id=c.tenant_id AND p.posting_id='AST-ACQ-'||c.id AND p.status='pending')<>1
 UNION ALL SELECT 'posting_scope', count(*) FROM completed c JOIN finance_postings p ON p.posting_id='AST-ACQ-'||c.id AND p.tenant_id=c.tenant_id
 WHERE p.legal_entity_id<>c.legal_entity_id OR p.vendor_id IS DISTINCT FROM c.vendor_id OR p.settlement_mode<>'direct_payable'
 UNION ALL SELECT 'balanced_journal', count(*) FROM completed c JOIN finance_postings p ON p.posting_id='AST-ACQ-'||c.id AND p.tenant_id=c.tenant_id
 WHERE (SELECT coalesce(sum(debit),0) FROM finance_posting_lines l WHERE l.finance_posting_id=p.id)<>c.value+c.tax
    OR (SELECT coalesce(sum(credit),0) FROM finance_posting_lines l WHERE l.finance_posting_id=p.id)<>c.value+c.tax
 UNION ALL SELECT 'journal_line_sides_dimensions', count(*) FROM finance_posting_lines l
 JOIN finance_postings p ON p.id=l.finance_posting_id
 JOIN completed c ON p.posting_id='AST-ACQ-'||c.id AND p.tenant_id=c.tenant_id
 WHERE (l.debit>0)=(l.credit>0) OR l.business_unit_code IS DISTINCT FROM c.business_unit_code
 UNION ALL SELECT 'one_posted_book', count(*) FROM asset a WHERE
   (SELECT count(*) FROM aset_tr_buku_aset b WHERE b.tenant_id=a.tenant_id AND b.aset_id=a.id AND b.buku_id=a.expected_book_id AND b.depreciate AND b.useful_life_periods=48 AND b.depreciation_profile_id=a.expected_profile_id)<>1
 UNION ALL SELECT 'ledger_matches_asset', count(*) FROM asset a WHERE
   (SELECT count(*) FROM aset_tr_ledger_aset l JOIN aset_tr_buku_aset b ON b.id=l.buku_aset_id
    WHERE l.tenant_id=a.tenant_id AND l.aset_id=a.id AND b.buku_id=a.expected_book_id
      AND l.posting_type='acquisition' AND l.source_id=a.penerimaan_aset_id::text AND l.acquisition_delta=a.acquisition_value)<>1
 UNION ALL SELECT 'typed_attribute', count(*) FROM asset a WHERE
   (SELECT count(*) FROM aset_tr_aset_atribut t WHERE t.tenant_id=a.tenant_id AND t.aset_id=a.id AND t.tipe_atribut_id=a.expected_attribute_id AND t.nilai_number=a.expected_attribute_value::numeric)<>1
 UNION ALL SELECT 'attribute_locked', count(*) FROM f JOIN aset_m_tipe_atribut t ON t.id=f.attribute_id AND t.tenant_id=f.tenant_id WHERE NOT t.data_type_locked AND EXISTS(SELECT 1 FROM completed c WHERE c.tenant_id=f.tenant_id)
 UNION ALL SELECT 'one_placement', count(*) FROM asset a WHERE
   (SELECT count(*) FROM aset_tr_penempatan_aset p WHERE p.tenant_id=a.tenant_id AND p.aset_id=a.id)<>1
 UNION ALL SELECT 'posting_published_once', count(*) FROM completed c JOIN finance_postings p ON p.posting_id='AST-ACQ-'||c.id AND p.tenant_id=c.tenant_id WHERE
   (SELECT count(*) FROM finance_posting_events e WHERE e.tenant_id=c.tenant_id AND e.finance_posting_id=p.id AND e.event='published')<>1
 UNION ALL SELECT 'asset_number_issued', count(*) FROM asset a WHERE NOT EXISTS(
   SELECT 1 FROM number_sequence_issues i JOIN tenant_number_sequences s ON s.id=i.sequence_id
   JOIN app_number_sequence_references ref ON ref.id=s.reference_id
   WHERE s.tenant_id=a.tenant_id AND ref.code=a.module_id||'.asset-code'
     AND i.formatted_value=a.kode AND i.idempotency_key='aset:'||a.creation_key)
 UNION ALL SELECT 'receipt_number_issued', count(*) FROM r WHERE NOT EXISTS(
   SELECT 1 FROM number_sequence_issues i JOIN tenant_number_sequences s ON s.id=i.sequence_id
   JOIN app_number_sequence_references ref ON ref.id=s.reference_id
   WHERE s.tenant_id=r.tenant_id AND ref.code=r.module_id||'.penerimaan-aset'
     AND i.formatted_value=r.kode AND i.idempotency_key='penerimaan-aset:'||r.creation_key)
 UNION ALL SELECT 'duplicate_asset_code', count(*) FROM (
   SELECT tenant_id,legal_entity_id,kode FROM aset_tr_aset WHERE deleted_at IS NULL GROUP BY 1,2,3 HAVING count(*)>1
 ) duplicates
 UNION ALL SELECT 'duplicate_receipt_code', count(*) FROM (
   SELECT tenant_id,legal_entity_id,kode FROM aset_tr_penerimaan_aset WHERE deleted_at IS NULL GROUP BY 1,2,3 HAVING count(*)>1
 ) duplicates
)
SELECT json_build_object('checks',(SELECT count(*) FROM failures),
 'acknowledged_completed',(SELECT count(*) FROM ack WHERE outcome='completed'),
 'new_rows',(SELECT count(*) FROM new_row),
 'failures',coalesce((SELECT json_agg(row_to_json(failures)) FROM failures WHERE violations>0),'[]'::json));
"""


def evaluate(lab: Lab, fixture: dict, database: str, acknowledgements: list[dict], baseline: dict, mutation: str = "") -> dict:
    lab.validate_database(database)
    statement = query(fixture, acknowledgements, baseline)
    if mutation:
        statement = "BEGIN;\n" + mutation + ";\n" + statement + "\nROLLBACK;"
    result = json.loads(lab.sql(statement, database))
    result["database"] = database
    result["baseline_template"] = baseline["template"]
    return result


def probes(acknowledgements: list[dict], baseline: dict) -> list[tuple[str, str, list[dict], set[str]]]:
    """Kerusakan yang wajib merah: mutasi SQL dibatalkan ROLLBACK, mutasi ledger hanya di memori."""
    receipt = acknowledgements[0]["receipt_id"]
    seed = next(identifier for identifier in baseline["tables"]["aset_tr_penerimaan_aset"] if ids.UUID.fullmatch(identifier))
    phantom = copy.deepcopy(acknowledgements[0])
    phantom.update(receipt_id=PHANTOM_RECEIPT, creation_key="phantom-acknowledgement", asset_ids=[], asset_codes=[], posting_id=None, outcome="draft")
    first_asset = f"(SELECT id FROM aset_tr_aset WHERE penerimaan_aset_id='{receipt}' ORDER BY id LIMIT 1)"
    return [
        ("asset_value_cent", f"UPDATE aset_tr_aset SET acquisition_value=acquisition_value+0.01 WHERE id={first_asset}",
         acknowledgements, {"asset_value_sum", "asset_allocation", "ledger_matches_asset"}),
        ("soft_deleted_receipt", f"UPDATE aset_tr_penerimaan_aset SET deleted_at=now() WHERE id='{receipt}'", acknowledgements, {"ack_receipt_stored"}),
        ("header_input", f"UPDATE aset_tr_penerimaan_aset SET tanggal_siap_pakai=tanggal_siap_pakai+1 WHERE id='{receipt}'", acknowledgements, {"ack_header_input"}),
        ("detail_input", f"UPDATE aset_tr_penerimaan_aset_details SET nama=nama||' diubah' WHERE penerimaan_aset_id='{receipt}'", acknowledgements, {"ack_detail_input"}),
        ("asset_actor", f"UPDATE aset_tr_aset SET created_by_user_id=created_by_user_id+1 WHERE penerimaan_aset_id='{receipt}'", acknowledgements, {"ack_actor"}),
        ("seed_row_changed", f"UPDATE aset_tr_penerimaan_aset SET keterangan='diubah' WHERE id='{seed}'", acknowledgements, {"baseline_rows_changed"}),
        ("missing_acknowledgement", "", acknowledgements[1:], {"unacknowledged_aset_tr_penerimaan_aset", "unacknowledged_aset_tr_aset", "unacknowledged_finance_postings", "unacknowledged_number_sequence_issues"}),
        ("phantom_acknowledgement", "", acknowledgements + [phantom], {"ack_receipt_stored"}),
        ("no_new_work", "", [], {"ack_nonempty_completed"}),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    capture = actions.add_parser("baseline", help="Rekam hash baris tahan lama dari clone seed uuid yang belum disentuh kandidat.")
    capture.add_argument("--lab", required=True, type=Path)
    capture.add_argument("--database", required=True)
    capture.add_argument("--template", required=True, help="Database seed uuid asal clone, dicatat sebagai sumber baseline.")
    capture.add_argument("--coreerp-baseline", type=Path, help="Baseline seed CoreERP (ULID); himpunan id-nya wajib sama.")
    capture.add_argument("--output", required=True, type=Path)
    check = actions.add_parser("check", help="Rekonsiliasi acknowledgement HTTP dengan database dan fixture.")
    check.add_argument("--lab", required=True, type=Path)
    check.add_argument("--fixture", required=True, type=Path)
    check.add_argument("--database", required=True)
    check.add_argument("--baseline", required=True, type=Path)
    check.add_argument("--acknowledgements", required=True, type=Path, nargs="+")
    check.add_argument("--selftest", action="store_true")
    check.add_argument("--output", type=Path)
    args = parser.parse_args()
    lab = Lab.load(args.lab)
    if args.action == "baseline":
        baseline = capture_baseline(lab, args.database, args.template)
        gaps = missing_seed_rows(baseline, json.loads(args.coreerp_baseline.read_text(encoding="utf-8"))) if args.coreerp_baseline else {}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(baseline, indent=1) + "\n", encoding="utf-8")
        print(json.dumps({"database": args.database, "rows": {table: len(rows) for table, rows in baseline["tables"].items()},
                          "seed_row_gaps": gaps}))
        if gaps:
            raise SystemExit(1)
        return
    fixture = ids.normalize_fixture(json.loads(args.fixture.read_text(encoding="utf-8")))
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    acknowledgements = bind(load_acknowledgements(args.acknowledgements), fixture)
    result = evaluate(lab, fixture, args.database, acknowledgements, baseline)
    if args.selftest:
        if result["failures"]:
            raise SystemExit("Selftest needs a clean fixture first: " + json.dumps(result["failures"]))
        result["probes"] = []
        for name, mutation, ledger, expected in probes(acknowledgements, baseline):
            probe = evaluate(lab, fixture, args.database, ledger, baseline, mutation)
            detected = {failure["label"] for failure in probe["failures"]}
            result["probes"].append({"probe": name, "expected": sorted(expected), "detected": sorted(detected), "red": expected <= detected})
        restored = evaluate(lab, fixture, args.database, acknowledgements, baseline)
        result["rollback_restored"] = not restored["failures"]
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "probes"}))
    if args.selftest:
        missed = [probe["probe"] for probe in result["probes"] if not probe["red"]]
        print(json.dumps({"probes": len(result["probes"]), "missed": missed, "rollback_restored": result["rollback_restored"]}))
        if missed or not result["rollback_restored"]:
            raise SystemExit(1)
    elif result["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
