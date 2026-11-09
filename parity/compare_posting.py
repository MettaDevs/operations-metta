"""Bandingkan graph posting purchase pending CoreERP dan kandidat lewat SELECT, tanpa kode aplikasi.

Graph CoreERP dibaca dari database referensi ber-ULID, diterjemahkan ke uuid, lalu dibandingkan persis.
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import re

import ids
from lab import Lab, SqlError

ABSENT = "$ABSENT"


def load_json(value: str) -> object:
    return json.loads(value, parse_float=Decimal)


def context(run: dict, id_pattern: re.Pattern = ids.UUID) -> dict:
    selected = {}
    for operation in ["receipt-create", "receipt-complete", "receipt-show-completed"]:
        events = [event for event in run["events"] if event["operation"] == operation]
        if len(events) != 1 or events[0]["status"] not in {200, 201}:
            raise ValueError("Exactly one successful acknowledgement is required: " + operation)
        selected[operation] = events[0]
    created = selected["receipt-create"]["body"]["data"]
    completed = selected["receipt-complete"]["body"]["data"]
    shown = selected["receipt-show-completed"]["body"]["data"]
    if not isinstance(created["id"], str) or not id_pattern.fullmatch(created["id"]):
        raise ValueError("HTTP receipt ID has the wrong shape.")
    if not all(data["id"] == created["id"] for data in [completed, shown]):
        raise ValueError("HTTP acknowledgements do not point to the same receipt.")
    for data in [completed, shown]:
        if data["status"] != "selesai" or data["posting"]["status"] != "pending":
            raise ValueError("Trace is not a completed purchase with a pending posting.")
        if data["posting"]["posting_id"] != "AST-ACQ-" + created["id"]:
            raise ValueError("HTTP posting identity is not bound to the receipt.")
    event = selected["receipt-complete"]
    return {
        "receipt_id": created["id"],
        "creation_key": created["creation_key"],
        "tenant_id": created["tenant_id"],
        "receipt_code": created["kode"],
        "started_at": event["started_at"],
        "finished_at": event["finished_at"],
    }


def query(selection: dict) -> str:
    encoded = base64.b64encode(json.dumps(selection).encode()).decode()
    # Cast ::text membuat query yang sama berjalan di database ULID (char(26)) dan uuid; source_id tetap varchar.
    return """
WITH selection AS (
 SELECT convert_from(decode('__SELECTION__','base64'),'UTF8')::jsonb AS data
), receipts AS (
 SELECT r.* FROM aset_tr_penerimaan_aset r, selection s
 WHERE r.creation_key=s.data->>'creation_key' OR r.id::text=s.data->>'receipt_id'
), postings AS (
 SELECT p.* FROM finance_postings p, selection s
 WHERE p.source_id IN (SELECT id::text FROM receipts)
    OR p.posting_id IN (SELECT 'AST-ACQ-'||id FROM receipts)
    OR p.source_id=s.data->>'receipt_id'
    OR p.posting_id='AST-ACQ-'||(s.data->>'receipt_id')
), lines AS (
 SELECT l.* FROM finance_posting_lines l WHERE l.finance_posting_id IN (SELECT id FROM postings)
), account_ids AS (
 SELECT account_id::text AS id FROM lines
 UNION SELECT item->>'account_id' FROM postings p,
 jsonb_array_elements(CASE WHEN jsonb_typeof(p.input->'lines')='array'
 THEN p.input->'lines' ELSE '[]'::jsonb END) item
)
SELECT json_build_object(
 'receipts',coalesce((SELECT json_agg(json_build_object(
   'id',id,'creation_key',creation_key,'tenant_id',tenant_id,'kode',kode,
   'legal_entity_id',legal_entity_id,'vendor_id',vendor_id,'currency_code',currency_code,
   'status',status,'deleted_at',deleted_at) ORDER BY tenant_id,kode) FROM receipts),'[]'::json),
 'postings',coalesce((SELECT json_agg(row_to_json(p) ORDER BY tenant_id,posting_id) FROM postings p),'[]'::json),
 'lines',coalesce((SELECT json_agg(row_to_json(l) ORDER BY finance_posting_id,line_no) FROM lines l),'[]'::json),
 'events',coalesce((SELECT json_agg(row_to_json(e) ORDER BY finance_posting_id,created_at,id)
   FROM finance_posting_events e WHERE e.finance_posting_id IN (SELECT id FROM postings)),'[]'::json),
 'deliveries',coalesce((SELECT json_agg(row_to_json(d) ORDER BY finance_posting_id,created_at,id)
   FROM finance_posting_deliveries d WHERE d.finance_posting_id IN (SELECT id FROM postings)),'[]'::json),
 'accounts',coalesce((SELECT json_agg(row_to_json(a) ORDER BY id)
   FROM finance_reference_accounts a WHERE a.id::text IN (SELECT id FROM account_ids)),'[]'::json)
);
""".replace("__SELECTION__", encoded)


def read_graph(lab: Lab, database: str, selection: dict) -> dict:
    lab.validate_database(database)
    return load_json(lab.sql("BEGIN READ ONLY;\n" + query(selection) + "\nCOMMIT;", database))


def money(value: object, decimals: int) -> str:
    if type(value) is int:
        value = str(value)
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d+)?", value.strip()):
        raise ValueError("Journal input value is not a valid decimal.")
    if len(value.strip().partition(".")[2]) > decimals:
        raise ValueError("Journal input precision exceeds the currency.")
    with localcontext() as arithmetic:
        arithmetic.prec = 80
        return format(Decimal(value.strip()), f".{decimals}f")


def optional_text(data: dict, key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Text input is not a string: " + key)
    return value.strip() or None


def input_hash(posting: dict) -> str:
    """Urutan/scaling JSON PHP PostingPublisher::normalize, baris 469-472."""
    data = posting["input"]
    decimals = posting["currency_decimals"]
    if type(decimals) is not int or not 0 <= decimals <= 8:
        raise ValueError("Currency precision is invalid.")
    if "reversal_snapshot" in data:
        raise ValueError("Reversal snapshot is outside the pending purchase profile.")
    parts = [
        optional_text(data, "posting_type"),
        optional_text(data, "legal_entity_id"),
        (optional_text(data, "currency_code") or "").upper(),
        data["posting_date"],
        data["document_date"],
        optional_text(data, "settlement_mode"),
        optional_text(data, "vendor_id"),
        optional_text(data, "reverses_posting_id"),
        optional_text(data, "adjusts_posting_id"),
        [
            [
                optional_text(line, "account_id"),
                money(line.get("debit", "0"), decimals),
                money(line.get("credit", "0"), decimals),
                optional_text(line, "org_unit_id"),
            ]
            for line in data["lines"]
        ],
    ]
    encoded = json.dumps(parts, ensure_ascii=True, separators=(",", ":")).replace("/", "\\/")
    return hashlib.sha256(encoded.encode()).hexdigest()


def normalize_graph(graph: dict) -> dict:
    """Id CoreERP menjadi uuid. input_hash adalah hash atas id, jadi diturunkan ulang dari input yang sudah
    diterjemahkan dengan resep yang sama, yang lebih dulu diperiksa cocok dengan hash simpanan CoreERP."""
    normalized = ids.normalize(graph)
    for posting in normalized["postings"]:
        posting["input_hash"] = input_hash(posting)
    return normalized


def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def timestamp_path(path: str) -> bool:
    return bool(
        re.fullmatch(r"postings\[0\]\.(?:created|updated|occurred|published)_at", path)
        or re.fullmatch(r"postings\[0\]\.(?:input|payload)\.(?:occurred|published)_at", path)
        or re.fullmatch(r"(?:lines|events)\[\d+\]\.(?:created|updated)_at", path)
    )


class Comparison:
    def __init__(self) -> None:
        self.differences: list[dict] = []
        self.ids: tuple[dict, dict] = ({}, {})
        self.receipt_ids: tuple[str, str] = ("", "")

    def check(self, expected: object, actual: object, path: str) -> None:
        def same(left: object, right: object) -> bool:
            if type(left) is not type(right):
                return False
            if isinstance(left, dict):
                return left.keys() == right.keys() and all(same(left[key], right[key]) for key in left)
            if isinstance(left, list):
                return len(left) == len(right) and all(same(a, b) for a, b in zip(left, right))
            return left == right

        if not same(expected, actual):
            self.differences.append({"path": path, "expected": expected, "actual": actual})

    def register(self, left: str, right: str, identity: str) -> None:
        for mapping, value in zip(self.ids, [left, right]):
            if not isinstance(value, str) or not ids.UUID.fullmatch(value):
                raise ValueError("Posting/receipt ID is not a canonical UUID: " + identity)
            if value in mapping and mapping[value] != identity:
                raise ValueError("ID mapping is not bijective: " + identity)
            mapping[value] = identity

    def mapped(self, value: str, path: str, side: int) -> str:
        receipt = self.receipt_ids[side]
        if re.fullmatch(r"postings\[0\]\.(?:(?:input|payload)\.)?posting_id", path):
            return "AST-ACQ-$receipt" if value == "AST-ACQ-" + receipt else value
        if path == "postings[0].input.source_document.url" and value.endswith("/" + receipt):
            return value[: -len(receipt)] + "$receipt"
        allowed = (
            path in {"receipts[0].id", "postings[0].id", "postings[0].source_id"}
            or path == "postings[0].input.source_document.id"
            or path in {"postings[0].input.details.receipt.id", "postings[0].payload.details.receipt.id"}
            or re.fullmatch(r"(?:lines|events)\[\d+\]\.finance_posting_id", path)
        )
        return self.ids[side].get(value, value) if allowed else value

    def compare(self, expected: object, actual: object, path: str = "") -> None:
        if isinstance(expected, dict) and isinstance(actual, dict):
            for key in sorted(set(expected) | set(actual)):
                child = path + "." + key if path else key
                if key not in expected or key not in actual:
                    self.differences.append({
                        "path": child,
                        "expected": expected.get(key, ABSENT),
                        "actual": actual.get(key, ABSENT),
                        "reason": "field absent on one side",
                    })
                else:
                    self.compare(expected[key], actual[key], child)
        elif isinstance(expected, list) and isinstance(actual, list):
            self.check(len(expected), len(actual), path + ".length")
            for index, (left, right) in enumerate(zip(expected, actual)):
                self.compare(left, right, f"{path}[{index}]")
        elif isinstance(expected, str) and isinstance(actual, str):
            if re.fullmatch(r"(?:lines|events)\[\d+\]\.id", path):
                return
            if timestamp_path(path):
                try:
                    instant(expected)
                    instant(actual)
                    self.check(re.sub(r"\d", "#", expected), re.sub(r"\d", "#", actual), path + ".format")
                except ValueError:
                    self.differences.append({"path": path, "reason": "invalid timestamp", "expected": expected, "actual": actual})
            else:
                self.check(self.mapped(expected, path, 0), self.mapped(actual, path, 1), path)
        else:
            self.check(expected, actual, path)

    def validate(self, graph: dict, selection: dict, side: str) -> None:
        def check(expected: object, actual: object, path: str) -> None:
            self.check(expected, actual, side + "." + path)

        for table, count in [("receipts", 1), ("postings", 1), ("lines", 3), ("events", 1), ("deliveries", 0), ("accounts", 3)]:
            check(count, len(graph[table]), table + ".length")
        if len(graph["receipts"]) != 1 or len(graph["postings"]) != 1:
            return
        receipt, posting = graph["receipts"][0], graph["postings"][0]
        for key, expected in [
            ("id", selection["receipt_id"]), ("creation_key", selection["creation_key"]),
            ("tenant_id", selection["tenant_id"]), ("kode", selection["receipt_code"]),
            ("status", "selesai"), ("deleted_at", None),
        ]:
            check(expected, receipt[key], "receipts[0]." + key)
        data, payload = posting["input"], posting["payload"]
        for table in ["postings", "lines", "events"]:
            identifiers = [row["id"] for row in graph[table]]
            check(len(identifiers), len(set(identifiers)), table + ".unique_ids")
            for index, row in enumerate(graph[table]):
                check(True, isinstance(row["id"], str) and bool(ids.UUID.fullmatch(row["id"])), f"{table}[{index}].id.valid")
                check(receipt["tenant_id"], row["tenant_id"], f"{table}[{index}].tenant_id")
                if table != "postings":
                    check(posting["id"], row["finance_posting_id"], f"{table}[{index}].finance_posting_id")
        try:
            check(input_hash(posting), posting["input_hash"], "postings[0].input_hash.recomputed")
            for key in ["tenant_id", "legal_entity_id", "vendor_id", "currency_code"]:
                check(receipt[key], posting[key], "postings[0]." + key)
            for key in ["tenant_id", "legal_entity_id", "vendor_id", "currency_code", "posting_type", "posting_id", "posting_date", "document_date", "settlement_mode"]:
                check(posting[key], data[key], "postings[0].input." + key)
            check("pending", posting["status"], "postings[0].status")
            check("direct_payable", posting["settlement_mode"], "postings[0].settlement_mode")
            check(receipt["id"], posting["source_id"], "postings[0].source_id")
            check("AST-ACQ-" + receipt["id"], posting["posting_id"], "postings[0].posting_id")
            check(receipt["id"], data["source_document"]["id"], "postings[0].input.source_document.id")
            check(receipt["id"], payload["details"]["receipt"]["id"], "postings[0].payload.details.receipt.id")
            for key in ["posting_id", "posting_type", "posting_date", "document_date", "settlement_mode", "contract_version", "reverses_posting_id", "adjusts_posting_id"]:
                check(posting[key], payload[key], "postings[0].payload." + key)
            check(posting["legal_entity_id"], payload["legal_entity"]["id"], "postings[0].payload.legal_entity.id")
            check(posting["currency_code"], payload["currency"]["code"], "postings[0].payload.currency.code")
            check(posting["currency_decimals"], payload["currency"]["decimals"], "postings[0].payload.currency.decimals")
            check(data["details"], payload["details"], "postings[0].payload.details")
            for column, key in [("source_module", "module"), ("source_type", "type"), ("source_number", "number")]:
                check(posting[column], data["source_document"][key], "postings[0].input.source_document." + key)
                check(posting[column], payload["source_document"][key], "postings[0].payload.source_document." + key)
            check([1, 2, 3], [line["line_no"] for line in graph["lines"]], "lines.order")
            check(3, len(data["lines"]), "postings[0].input.lines.length")
            check(3, len(payload["journal_lines"]), "postings[0].payload.journal_lines.length")
            accounts = {account["id"]: account for account in graph["accounts"]}
            for index, line in enumerate(graph["lines"]):
                source, snapshot = data["lines"][index], payload["journal_lines"][index]
                account = accounts[source["account_id"]]
                for key in ["account_id", "org_unit_id", "description"]:
                    check(source[key], line[key], f"lines[{index}]." + key)
                check(index + 1, snapshot["line_no"], f"payload.journal_lines[{index}].line_no")
                check(account["tenant_id"], posting["tenant_id"], f"accounts[{index}].tenant_id")
                check(True, account["active"], f"accounts[{index}].active")
                check(account["code"], line["account_code"], f"lines[{index}].account_code")
                check(account["external_id"], line["account_external_id"], f"lines[{index}].account_external_id")
                check({key: account[key] for key in ["external_id", "code", "name"]}, snapshot["account"], f"payload.journal_lines[{index}].account")
                for amount in ["debit", "credit"]:
                    normalized = money(source.get(amount, "0"), posting["currency_decimals"])
                    check(Decimal(normalized), Decimal(line[amount]), f"lines[{index}]." + amount)
                    check(normalized, snapshot[amount], f"payload.journal_lines[{index}]." + amount)
            for amount in ["debit", "credit"]:
                total = sum((Decimal(line[amount]) for line in graph["lines"]), Decimal(0))
                check(total, Decimal(posting["total_" + amount]), "postings[0].total_" + amount)
                check(format(total, f".{posting['currency_decimals']}f"), payload["totals"][amount], "postings[0].payload.totals." + amount)
            for index, event in enumerate(graph["events"]):
                for key, value in [("event", "published"), ("from_status", None), ("to_status", "pending"), ("data", {"problems": 0})]:
                    check(value, event[key], f"events[{index}]." + key)
            groups = [
                [posting["occurred_at"], data["occurred_at"], payload["occurred_at"]],
                [posting["published_at"], payload["published_at"]],
                [posting["created_at"], posting["updated_at"]],
                [line[key] for line in graph["lines"] for key in ["created_at", "updated_at"]],
            ]
            for index, values in enumerate(groups):
                check(1, len({instant(value) for value in values}), f"timestamps.alias_group[{index}]")
            start, finish = instant(selection["started_at"]), instant(selection["finished_at"])
            values = [value for group in groups for value in group]
            values.extend(event["created_at"] for event in graph["events"])
            for index, value in enumerate(values):
                check(True, start - timedelta(seconds=2) <= instant(value) <= finish + timedelta(seconds=2), f"timestamps.request_window[{index}]")
        except (KeyError, TypeError, ValueError, ArithmeticError, IndexError) as error:
            check("complete valid publication graph", f"{type(error).__name__}: {error}", "graph_structure")


def compare_graphs(expected: dict, actual: dict, expected_http: dict, actual_http: dict) -> dict:
    """`expected` dan `expected_http` masih ULID CoreERP; `actual` dan `actual_http` milik kandidat (uuid)."""
    comparison = Comparison()
    for index, posting in enumerate(expected["postings"]):
        comparison.check(posting.get("input_hash"), input_hash(posting), f"expected.postings[{index}].input_hash.coreerp_recipe")
    expected, expected_http = normalize_graph(expected), ids.normalize_flow(expected_http)
    selections = [context(run) for run in [expected_http, actual_http]]
    for key in ["creation_key", "tenant_id", "receipt_code"]:
        comparison.check(selections[0][key], selections[1][key], "http_binding." + key)
    comparison.receipt_ids = tuple(selection["receipt_id"] for selection in selections)
    comparison.register(*comparison.receipt_ids, "$receipt")
    if all(len(graph["postings"]) == 1 for graph in [expected, actual]):
        comparison.register(expected["postings"][0]["id"], actual["postings"][0]["id"], "$posting")
    for graph, selection, side in zip([expected, actual], selections, ["expected", "actual"]):
        comparison.validate(graph, selection, side)
    comparison.compare(expected, actual)
    return {
        "verdict": "NOT VERIFIED" if comparison.differences else "VERIFIED",
        "scope": "One completed purchase receipt, direct payable, pending; whole stored posting/input/payload, three ordered lines, published event, deliveries and referenced account rows.",
        "differences": comparison.differences,
        "input_hashes": [[posting["input_hash"] for posting in graph["postings"]] for graph in [expected, actual]],
        "normalization": "CoreERP ULIDs under id keys, posting IDs, source_document.url and mapping.reference become the same 128-bit value as UUID text; input_hash is re-derived from the normalized input after the recipe is checked against the stored CoreERP hash. Then bijective generated receipt/posting PKs only at typed foreign links, business posting IDs and document URL. Standalone line/event IDs are validated and omitted from equality; line_no/order/event/foreign links remain exact. Known generated timestamps retain format, request window and internal aliases. Accounts, all other fields, JSON types/null/absence/order and exact Decimal amounts remain unnormalized.",
        "limitation": "Selected publication graph only; authentication, full workload acknowledgement and other database effects require their separate gates. Timestamp windows assume UTC and clock skew below two seconds.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", required=True, type=Path)
    parser.add_argument("--expected-database", required=True, help="Database referensi CoreERP (ULID) sesudah flow yang sama.")
    parser.add_argument("--actual-database", required=True)
    parser.add_argument("--expected-http", required=True, type=Path)
    parser.add_argument("--actual-http", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    lab = Lab.load(args.lab)
    try:
        expected_http, actual_http = [load_json(path.read_text(encoding="utf-8")) for path in [args.expected_http, args.actual_http]]
        expected = read_graph(lab, args.expected_database, context(expected_http, ids.ULID))
        actual = read_graph(lab, args.actual_database, context(actual_http))
        result = compare_graphs(expected, actual, expected_http, actual_http)
    except (KeyError, TypeError, ValueError, OSError, SqlError) as error:
        result = {"verdict": "NOT VERIFIED", "differences": [{"path": "evidence", "reason": f"{type(error).__name__}: {error}"}]}
    result["databases"] = [args.expected_database, args.actual_database]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": result["verdict"], "difference_count": len(result["differences"]), "paths": [difference["path"] for difference in result["differences"][:20]]}))
    if result["differences"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
