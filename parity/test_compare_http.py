"""Comparator flow HTTP; run dibuat di memori, tanpa database atau aplikasi."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest
import uuid

from compare_http import Comparison, compare_runs
import ids
from lab import difference

PROFILE = json.loads((Path(__file__).resolve().parent / "profile.json").read_text(encoding="utf-8"))
TENANT, LEGAL_ENTITY = "01M6G2RVPJW0ADS6D17DQEW6QX", "01m6g2sgvrndjjd3hjqw9kpgt7"
MEMBERSHIP, LOCATION = "01m6g2rys01hv1pmrx2g4ev19n", "01M6G2RVPJW0ADS6D17DQEW6R0"


def generated(number: int, coreerp: bool) -> str:
    value = str(uuid.UUID(int=number))
    return ids.uuid_to_ulid(value) if coreerp else value


def flow(offset: int = 0, coreerp: bool = False) -> dict:
    """CoreERP menyimpan ULID; kandidat membaca seed uuid dan membangkitkan id baru sendiri."""
    seed = (lambda value: value) if coreerp else ids.ulid_to_uuid
    actor = 1 if coreerp else ids.user_id_to_uuid(1)
    record_id = generated(100 + offset, coreerp)
    details = [{"id": generated(200 + offset, coreerp), "penerimaan_aset_id": record_id}]
    assets = [{"id": generated(300 + offset + i, coreerp), "kode": f"A{i}", "lokasi_aset_id": seed(LOCATION)} for i in range(3)]
    events = []
    for operation in PROFILE["main_flow"][:-1] + ["asset-show"] * 3:
        headers = {}
        if operation == "receipt-list":
            body = {"data": [], "next_cursor": None}
        elif operation == "receipt-preview":
            body = {"data": {"status": "pending"}}
        elif operation in {"receipt-assets", "asset-list"}:
            body = {"data": copy.deepcopy(assets)}
        elif operation == "asset-show":
            body = {"data": copy.deepcopy(assets[sum(e["operation"] == "asset-show" for e in events)])}
        else:
            if operation == "receipt-replace-lines":
                details = [{"id": generated(201 + offset, coreerp), "penerimaan_aset_id": record_id}]
            if operation == "receipt-create":
                headers = {"Location": "http://127.0.0.1:18641/api/modules/management-aset/v1/penerimaan-aset/" + record_id}
            body = {"data": {"id": record_id, "tenant_id": seed(TENANT), "lokasi_aset_id": seed(LOCATION), "creation_key": "compare-unit",
                             "lokasi_aset_nama": "Location simulasi 01m6g2rvpjw0ads6d17dqew6qw-0001", "details": copy.deepcopy(details),
                             "posting": {"posting_id": "AST-ACQ-" + record_id, "status": "pending"},
                             "created_at": "2026-11-03 00:00:00", "updated_at": "2026-11-03 00:00:00", "amount": "1000000.00",
                             "created_by_user_id": actor, "updated_by_user_id": actor, "diterima_oleh_user_id": None}}
        events.append({"operation": operation, "status": 201 if operation == "receipt-create" else 200, "headers": headers, "body": body,
                       "started_at": "2026-11-03T00:00:00+00:00", "finished_at": "2026-11-03T00:00:20+00:00"})
    account = {"index": 0, "user_id": actor, "tenant_id": seed(TENANT), "legal_entity_id": seed(LEGAL_ENTITY), "membership_id": seed(MEMBERSHIP)}
    return {"source_sha": PROFILE["source_sha"], "profile_id": PROFILE["id"], "fixture_id": "01m6g2rvpjw0ads6d17dqew6qw",
            "fixture_hash": "unit-fixture-hash", "run_id": "unit", "account": account, "authentication": [{"status": 200}] * 3, "events": events}


def expected() -> dict:
    return ids.normalize_flow(flow(coreerp=True))


class HarnessTests(unittest.TestCase):
    def test_coreerp_ulid_evidence_matches_candidate_uuid_output(self):
        self.assertEqual("VERIFIED", compare_runs(expected(), flow(10))["verdict"])

    def test_unnormalized_coreerp_evidence_does_not_pass(self):
        self.assertEqual("NOT VERIFIED", compare_runs(flow(coreerp=True), flow(10))["verdict"])

    def test_seed_id_or_name_mismatch_fails(self):
        for key, value in [("lokasi_aset_id", ids.ulid_to_uuid("01M6G2RVPJW0ADS6D17DQEW6R1")), ("lokasi_aset_nama", "Location simulasi lain"),
                           ("created_by_user_id", ids.user_id_to_uuid(2)), ("created_by_user_id", 1)]:
            other = flow(10)
            other["events"][1]["body"]["data"][key] = value
            result = compare_runs(expected(), other)
            self.assertEqual("NOT VERIFIED", result["verdict"], key)
            self.assertEqual([f"events[1].body.data.{key}"], [item["path"] for item in result["differences"]])

    def test_posting_id_and_location_must_name_the_new_receipt(self):
        other = flow(10)
        other["events"][1]["body"]["data"]["posting"]["posting_id"] = "AST-ACQ-" + generated(999, False)
        self.assertEqual("NOT VERIFIED", compare_runs(expected(), other)["verdict"])
        other = flow(10)
        other["events"][1]["headers"]["Location"] = "/api/modules/management-aset/v1/penerimaan-aset/" + generated(999, False)
        self.assertEqual("NOT VERIFIED", compare_runs(expected(), other)["verdict"])

    def test_empty_and_partial_profiles_fail(self):
        for events in [[], flow()["events"][:1]]:
            run = flow()
            run["events"] = events
            self.assertEqual(compare_runs(run, copy.deepcopy(run))["verdict"], "NOT VERIFIED")

    def test_source_profile_fixture_run_and_auth_must_match(self):
        for key in ["source_sha", "profile_id", "fixture_id", "fixture_hash", "run_id"]:
            other = flow(10)
            other[key] = "different"
            self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED", key)
        other = flow(10)
        other["authentication"][0] = {"status": 401}
        self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED")
        for account in [None, {**flow()["account"], "index": 1}, {**flow()["account"], "user_id": ids.user_id_to_uuid(2)}]:
            other = flow(10)
            other["account"] = account
            self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED", account)

    def test_money_types_and_missing_fields_are_not_normalized(self):
        for replacement in [999999.99, "999999.99", None]:
            other = flow(10)
            other["events"][1]["body"]["data"]["amount"] = replacement
            self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED")
        other = flow(10)
        del other["events"][1]["body"]["data"]["amount"]
        self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED")

    def test_readback_cannot_change_stored_timestamps(self):
        for field in ["created_at", "updated_at"]:
            other = flow(10)
            other["events"][2]["body"]["data"][field] = "2026-11-03 00:00:09"
            self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED", field)

    def test_timestamp_freshness_is_required(self):
        other = flow(10)
        for event in other["events"]:
            if isinstance(event["body"].get("data"), dict) and "created_at" in event["body"]["data"]:
                event["body"]["data"]["created_at"] = "1970-01-01 00:00:00"
        self.assertEqual(compare_runs(expected(), other)["verdict"], "NOT VERIFIED")

    def test_generated_record_ids_cannot_be_reused(self):
        comparison = Comparison()
        comparison.register(generated(1, False), generated(2, False), "$receipt")
        with self.assertRaises(ValueError):
            comparison.register(generated(3, False), generated(2, False), "$detail")

    def test_candidate_must_emit_canonical_uuid(self):
        for value in [ids.uuid_to_ulid(generated(0xABC, False)), generated(0xABC, False).upper()]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                Comparison().register(generated(1, False), value, "$receipt")

    def test_lost_query_stats_are_inconclusive_not_zero_work(self):
        with self.assertRaises(RuntimeError):
            difference([{"queryid": "1", "toplevel": True, "calls": 1}], [])


if __name__ == "__main__":
    unittest.main()
