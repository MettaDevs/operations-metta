"""Normalisasi atas bukti CoreERP yang sebenarnya. Bukti itu privat di lab, jadi test ini hanya berjalan bila
PARITY_COREERP_FLOW, PARITY_FIXTURE, dan PARITY_CANDIDATE_FLOW menunjuk ke berkasnya; tanpa itu test dilewati."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import re
import unittest

from compare_http import compare_runs
import ids

PATHS = {name: os.environ.get(name) for name in ["PARITY_COREERP_FLOW", "PARITY_FIXTURE", "PARITY_CANDIDATE_FLOW"]}


def load(name: str) -> dict:
    return json.loads(Path(PATHS[name]).read_text(encoding="utf-8"))


def leaves(value: object, key: str | None = None):
    if isinstance(value, dict):
        for name, item in value.items():
            yield from leaves(item, name)
    elif isinstance(value, list):
        for item in value:
            yield from leaves(item, key)
    else:
        yield key, value


@unittest.skipUnless(all(PATHS.values()), "private lab evidence is not available")
class RealEvidenceTests(unittest.TestCase):
    def assert_only_id_parts_changed(self, before: dict, after: dict, sections: list[str]) -> int:
        changed = ids.changes(before, after)
        for path, old, new in changed:
            key = re.sub(r"\[\]$", "", path).rsplit(".", 1)[-1]
            rule = ids.separators(key)
            self.assertIsNotNone(rule, path)
            parts = re.split(f"([{re.escape(rule)}])", old) if rule else [old]
            self.assertEqual(new, "".join(ids.ulid_to_uuid(part) if ids.ULID.fullmatch(part) else part for part in parts), path)
            restored = re.sub(ids.UUID.pattern, lambda match: ids.uuid_to_ulid(match.group()), new)
            self.assertEqual(old.upper(), restored.upper(), path)
        for key, value in leaves([after[section] for section in sections]):
            if key is not None and ids.separators(key) == "" and isinstance(value, str):
                self.assertIsNone(ids.ULID.fullmatch(value), f"{key} still holds a ULID")
        return len(changed)

    def test_flow_changes_only_ids_and_keeps_names_and_identity(self):
        flow = load("PARITY_COREERP_FLOW")
        normalized = ids.normalize_flow(flow)
        self.assertGreater(self.assert_only_id_parts_changed(flow, normalized, ["account", "events"]), 100)
        for key in ["source_sha", "profile_id", "fixture_id", "fixture_hash", "run_id"]:
            self.assertEqual(flow[key], normalized[key], key)
        names = [value for key, value in leaves(flow["events"]) if key in {"nama", "lokasi_aset_nama", "name"} and isinstance(value, str)]
        self.assertTrue(names and all(flow["fixture_id"] in name for name in names if "simulasi" in name))
        self.assertEqual(names, [value for key, value in leaves(normalized["events"]) if key in {"nama", "lokasi_aset_nama", "name"} and isinstance(value, str)])
        created = next(event for event in normalized["events"] if event["operation"] == "receipt-create")
        self.assertTrue(created["headers"]["Location"].endswith("/" + created["body"]["data"]["id"]))
        self.assertEqual("AST-ACQ-" + created["body"]["data"]["id"],
                         next(event for event in normalized["events"] if event["operation"] == "receipt-complete")["body"]["data"]["posting"]["posting_id"])

    def test_fixture_changes_only_ids(self):
        fixture = load("PARITY_FIXTURE")
        normalized = ids.normalize_fixture(fixture)
        self.assertGreater(self.assert_only_id_parts_changed(fixture, normalized, ["accounts", "probe_accounts", "tenants"]), 50)
        self.assertEqual(fixture["fixture_id"], normalized["fixture_id"])
        self.assertTrue(all(ids.UUID.fullmatch(account[key]) for account in normalized["accounts"] for key in ["tenant_id", "legal_entity_id", "membership_id", "department_id"]))

    def test_candidate_flow_matches_and_one_injected_value_turns_it_red(self):
        expected, actual = ids.normalize_flow(load("PARITY_COREERP_FLOW")), load("PARITY_CANDIDATE_FLOW")
        self.assertEqual("VERIFIED", compare_runs(expected, actual)["verdict"])
        wrong = copy.deepcopy(expected)
        index = next(index for index, event in enumerate(wrong["events"]) if event["operation"] == "receipt-show-completed")
        data = wrong["events"][index]["body"]["data"]
        data["lokasi_aset_id"] = ids.ulid_to_uuid("01M6G2RVPJW0ADS6D17DQEW6R1")
        result = compare_runs(wrong, actual)
        self.assertEqual("NOT VERIFIED", result["verdict"])
        self.assertEqual([f"events[{index}].body.data.lokasi_aset_id"], [item["path"] for item in result["differences"]])
        self.assertEqual("VERIFIED", compare_runs(expected, actual)["verdict"])


if __name__ == "__main__":
    unittest.main()
