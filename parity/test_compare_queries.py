"""Aturan pembanding kewajiban SQL; trace dibuat di memori, tanpa database."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from compare_queries import compare, obligations, tables, waived


def statement(query: str, calls: int = 1, rows: int = 1, toplevel: bool = True) -> dict:
    return {"query": query, "calls": calls, "rows": rows, "toplevel": toplevel, "fingerprint": query}


def trace(*queries: dict) -> dict:
    return {"queries": list(queries), "top_level_calls": sum(q["calls"] for q in queries if q["toplevel"]),
            "nested_calls": sum(q["calls"] for q in queries if not q["toplevel"])}


BASE = trace(
    statement('select * from "sessions" where "id" = $1'),
    statement('select * from "role_assignments" where "membership_id" = $1'),
    statement("BEGIN", rows=0),
    statement('select * from "number_sequence_counters" where "id" = $1 for update'),
    statement('insert into "aset_tr_aset" ("id") values ($1), ($2), ($3)', rows=3),
    statement("COMMIT", rows=0),
    statement('update "sessions" set "payload" = $1 where "id" = $2'),
    statement("select aset_ledger_trigger()", calls=3, toplevel=False),
)


def kinds(expected: dict, actual: dict, authenticated: bool = True) -> set[tuple[str, str]]:
    return {(item["severity"], item["kind"]) for item in compare(obligations(expected), obligations(actual), authenticated)}


def without(source: dict, fragment: str) -> dict:
    changed = copy.deepcopy(source)
    changed["queries"] = [q for q in changed["queries"] if fragment not in q["query"]]
    return changed


class ObligationTests(unittest.TestCase):
    def test_equivalent_strategy_is_clean(self):
        split = copy.deepcopy(BASE)
        split["queries"][4] = statement("insert into aset_tr_aset (id) values ($1)", calls=3, rows=3)
        self.assertEqual(set(), kinds(BASE, split))

    def test_missing_written_rows_fail(self):
        fewer = copy.deepcopy(BASE)
        fewer["queries"][4]["rows"] = 2
        self.assertIn(("FAIL", "write-rows"), kinds(BASE, fewer))

    def test_missing_lock_fails_and_extra_lock_is_reviewed(self):
        self.assertIn(("FAIL", "lock-missing"), kinds(BASE, without(BASE, "for update")))
        self.assertIn(("REVIEW", "lock-extra"), kinds(without(BASE, "for update"), BASE))

    def test_missing_authority_read_fails_only_with_a_session(self):
        unauthorized = without(BASE, "role_assignments")
        self.assertIn(("FAIL", "read-missing"), kinds(BASE, unauthorized))
        self.assertIn(("REVIEW", "read-missing"), kinds(BASE, unauthorized, authenticated=False))

    def test_transaction_boundaries_and_trigger_work_fail(self):
        self.assertIn(("FAIL", "transaction-begin"), kinds(BASE, without(BASE, "BEGIN")))
        self.assertIn(("FAIL", "nested-work"), kinds(BASE, without(BASE, "aset_ledger_trigger")))

    def test_changed_trigger_statement_names_both_texts(self):
        changed = copy.deepcopy(BASE)
        changed["queries"][7] = statement("select aset_ledger_trigger()::text", calls=3, toplevel=False)
        finding = compare(obligations(BASE), obligations(changed), True)[0]
        self.assertEqual(("FAIL", "nested-work"), (finding["severity"], finding["kind"]))
        self.assertEqual([{"query": "select aset_ledger_trigger()", "expected": 3, "actual": 0},
                          {"query": "select aset_ledger_trigger()::text", "expected": 0, "actual": 3}],
                         finding["detail"]["statements"])

    def test_upsert_is_reviewed_not_silently_equal(self):
        upsert = copy.deepcopy(BASE)
        upsert["queries"][6] = statement("insert into sessions(id,payload) values($1,$2) on conflict(id) do update set payload=excluded.payload")
        self.assertEqual({("REVIEW", "write-verb")}, kinds(BASE, upsert))

    def test_waiver_matches_operation_kind_and_detail(self):
        finding = {"severity": "FAIL", "kind": "lock-missing", "detail": ["cache", "update"]}
        waiver = {"operations": {"login"}, "kind": "lock-missing", "match": [["cache", "update"]], "reason": "x", "evidence": ""}
        self.assertIs(waiver, waived(finding, "login", [waiver]))
        self.assertIsNone(waived(finding, "workspace", [waiver]))
        self.assertIsNone(waived({**finding, "detail": ["sessions", "update"]}, "login", [waiver]))

    def test_register_waivers_are_well_formed(self):
        register = json.loads((Path(__file__).resolve().parent / "query-obligations.json").read_text(encoding="utf-8"))
        for waiver in register["waivers"]:
            with self.subTest(kind=waiver["kind"]):
                self.assertTrue(waiver["reason"])
                self.assertTrue(waiver["operations"])
                self.assertIn("evidence", waiver)

    def test_table_extraction_ignores_functions_ctes_and_lock_clauses(self):
        cases = {
            "insert into sessions(id) values($1) on conflict(id) do update set id=excluded.id": ["sessions"],
            "select x from jsonb_to_recordset($1) a join \"public\".\"tenants\" t on true": ["tenants"],
            "with recursive reachable(id) as (select id from roles) select * from reachable join permissions p on true": ["roles", "permissions"],
            "select id from number_sequence_allocations order by id for update limit $1": ["number_sequence_allocations"],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(expected, tables(query))


if __name__ == "__main__":
    unittest.main()
