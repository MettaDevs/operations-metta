"""Bukti bahwa normalisasi harness sama dengan konversi skema yang dipakai kandidat.

Dua pemeriksaan: ulid_to_uuid/uuid_to_ulid dan user_id_to_uuid/uuid_to_user_id Python sama bit demi bit dengan
fungsi SQL di database uuid, dan setiap baris seed CoreERP yang dinormalisasi sama persis dengan barisnya di seed
uuid. Jalankan ulang setiap kali skema berubah; baris yang berbeda berarti aturan kunci di ids.py atau konversi
skemanya perlu ditinjau.
"""

from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal
import json
from pathlib import Path
import random
import uuid

from compare_posting import input_hash
import ids
from lab import Lab


def tables(lab: Lab, database: str) -> list[str]:
    names = lab.sql("SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                    "WHERE n.nspname='public' AND c.relkind='r';", database)
    return names.split(",")


def dump(lab: Lab, database: str, names: list[str]) -> dict[str, list[dict]]:
    statement = " UNION ALL ".join(f"SELECT '{name}' AS t, coalesce(json_agg(row_to_json(x)), '[]') AS r FROM \"{name}\" x" for name in names)
    return json.loads(lab.sql(f"SELECT json_object_agg(t, r) FROM ({statement}) s;", database), parse_float=Decimal)


def normalize_row(table: str, row: dict) -> dict:
    normalized = ids.normalize_row(table, row)
    # Konversi skema menghitung ulang input_hash dengan id uuid hanya bila resepnya cocok dengan hash tersimpan.
    if table == "finance_postings" and isinstance(row.get("input"), dict):
        try:
            if input_hash(row) == row["input_hash"]:
                normalized["input_hash"] = input_hash(normalized)
        except (KeyError, TypeError, ValueError):
            pass
    return normalized


def canonical(row: dict) -> str:
    return json.dumps(row, sort_keys=True, default=str)


def compare_rows(table: str, before: list[dict], after: list[dict]) -> dict | None:
    expected = Counter(canonical(normalize_row(table, row)) for row in before)
    actual = Counter(canonical(row) for row in after)
    if expected == actual:
        return None
    columns: Counter = Counter()
    if before and "id" in before[0]:
        converted = {row["id"]: row for row in after}
        for row in before:
            normalized = normalize_row(table, row)
            other = converted.get(normalized["id"], {})
            columns.update(key for key in normalized if canonical({"v": normalized[key]}) != canonical({"v": other.get(key)}))
    return {"rows": len(before), "unmatched_rows": sum((expected - actual).values()), "columns": dict(columns)}


def function_agreement(lab: Lab, database: str, count: int) -> dict:
    generator = random.Random(20261109)
    values = [ids.uuid_to_ulid(str(uuid.UUID(int=generator.getrandbits(128)))) for _ in range(count)]
    values += ["00000000000000000000000000", "7ZZZZZZZZZZZZZZZZZZZZZZZZZ", "01JC9X0V2B3C4D5E6F7G8H9JKM"]
    values += [value.lower() for value in values[:100]]
    literal = json.dumps(values).replace("'", "''")
    ulid_rows = json.loads(lab.sql("SELECT json_agg(json_build_array(v, public.ulid_to_uuid(v)::text, public.uuid_to_ulid(public.ulid_to_uuid(v)))) "
                                   f"FROM json_array_elements_text('{literal}') v;", database))
    mismatched = [row for row in ulid_rows if row[1] != ids.ulid_to_uuid(row[0]) or row[2] != ids.uuid_to_ulid(row[1])]
    users = [generator.randrange(ids.BIGINT_LIMIT) for _ in range(count)] + [generator.randrange(1 << 20) for _ in range(100)]
    users += [0, 1, 12, ids.BIGINT_LIMIT - 1]
    user_rows = json.loads(lab.sql("SELECT json_agg(json_build_array(v::text, public.user_id_to_uuid(v)::text, "
                                   "public.uuid_to_user_id(public.user_id_to_uuid(v))::text)) "
                                   f"FROM unnest('{{{','.join(map(str, users))}}}'::bigint[]) v;", database))
    mismatched += [row for row in user_rows
                   if row[1] != ids.user_id_to_uuid(int(row[0])) or int(row[2]) != ids.uuid_to_user_id(row[1])]
    return {"values": len(ulid_rows) + len(user_rows), "mismatched": mismatched[:5], "mismatch_count": len(mismatched)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", required=True, type=Path)
    parser.add_argument("--coreerp-database", required=True, help="Seed CoreERP sebelum konversi (ULID).")
    parser.add_argument("--uuid-database", required=True, help="Seed yang sama sesudah konversi uuid; hanya dibaca.")
    parser.add_argument("--random-values", type=int, default=5000)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    lab = Lab.load(args.lab)
    for database in [args.coreerp_database, args.uuid_database]:
        lab.validate_database(database)
    coreerp_tables, uuid_tables = set(tables(lab, args.coreerp_database)), set(tables(lab, args.uuid_database))
    names = sorted(coreerp_tables & uuid_tables)
    before, after = dump(lab, args.coreerp_database, names), dump(lab, args.uuid_database, names)
    differences = {name: result for name in names if (result := compare_rows(name, before[name], after[name])) is not None}
    report = {"functions": function_agreement(lab, args.uuid_database, args.random_values), "tables": len(names),
              "only_coreerp_tables": sorted(coreerp_tables - uuid_tables), "only_uuid_tables": sorted(uuid_tables - coreerp_tables),
              "rows": sum(len(rows) for rows in before.values()), "differences": differences}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"functions_mismatched": report["functions"]["mismatch_count"], "tables": report["tables"], "rows": report["rows"],
                      "only_uuid_tables": report["only_uuid_tables"], "only_coreerp_tables": report["only_coreerp_tables"],
                      "tables_with_differences": {name: result for name, result in differences.items()}}, default=str))
    if differences or report["functions"]["mismatch_count"]:
        raise SystemExit(1)
