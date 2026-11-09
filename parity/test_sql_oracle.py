"""Pengikatan ledger acknowledgement ke fixture uuid; tidak membuka database."""

from __future__ import annotations

import copy
import unittest
import uuid

import ids
from sql_oracle import DURABLE, bind, flow_acknowledgement, missing_seed_rows

RECEIPT, ASSETS = str(uuid.UUID(int=10)), [str(uuid.UUID(int=11)), str(uuid.UUID(int=12)), str(uuid.UUID(int=13))]
TENANT = "01M6G2RVPJW0ADS6D17DQEW6QX"
FIXTURE = ids.normalize_fixture({
    "accounts": [{"email": "unit@example.invalid", "user_id": 7, "tenant_id": TENANT, "legal_entity_id": "01m6g2sgvrndjjd3hjqw9kpgt7", "membership_id": "01m6g2rys01hv1pmrx2g4ev19n"}],
    "tenants": [{"tenant_id": TENANT, "receipt_body": {"details": [{"jumlah": 3}]}}],
})
ACCOUNT = {"index": 0, **{key: FIXTURE["accounts"][0][key] for key in ["user_id", "tenant_id", "legal_entity_id", "membership_id"]}}


def flow() -> dict:
    receipt = {"id": RECEIPT, "creation_key": "compare-unit", "kode": "R1", "status": "selesai", "version": 5,
               "posting": {"posting_id": "AST-ACQ-" + RECEIPT}}
    return {"account": dict(ACCOUNT), "events": [
        {"operation": "receipt-create", "status": 201, "body": {"data": {**receipt, "status": "draft", "version": 1}}},
        {"operation": "receipt-complete", "status": 200, "body": {"data": receipt}},
        {"operation": "receipt-assets", "status": 200, "body": {"data": [{"id": value, "kode": "A" + str(index)} for index, value in enumerate(ASSETS)]}},
    ]}


class LedgerTests(unittest.TestCase):
    def test_flow_binds_fixture_input_not_generator_payload(self):
        entry = bind([flow_acknowledgement(flow())], FIXTURE)[0]
        self.assertEqual((ids.user_id_to_uuid(7), ids.ulid_to_uuid(TENANT), RECEIPT, 5, ASSETS),
                         (entry["user_id"], entry["tenant_id"], entry["receipt_id"], entry["version"], entry["asset_ids"]))
        self.assertIs(entry["body"], FIXTURE["tenants"][0]["receipt_body"])

    def test_missing_or_repeated_acknowledgement_fails(self):
        for operation in ["receipt-create", "receipt-complete", "receipt-assets"]:
            for repeat in [0, 2]:
                run = flow()
                event = next(item for item in run["events"] if item["operation"] == operation)
                run["events"] = [item for item in run["events"] if item is not event] + [event] * repeat
                with self.subTest(operation=operation, repeat=repeat), self.assertRaises(ValueError):
                    flow_acknowledgement(run)

    def test_account_must_match_the_normalized_fixture(self):
        for key, value in [("user_id", ids.user_id_to_uuid(8)), ("user_id", 7), ("tenant_id", TENANT), ("membership_id", str(uuid.UUID(int=1)))]:
            entry = flow_acknowledgement(flow())
            entry["account"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                bind([entry], FIXTURE)

    def test_one_job_cannot_be_acknowledged_twice(self):
        entry = flow_acknowledgement(flow())
        with self.assertRaises(ValueError):
            bind([entry, copy.deepcopy(entry)], FIXTURE)

    def test_identifiers_must_be_uuids_and_keys_safe(self):
        for key, value in [("receipt_id", ids.uuid_to_ulid(RECEIPT)), ("receipt_id", RECEIPT.upper()), ("asset_ids", ["x"]), ("creation_key", "x'; DROP")]:
            entry = flow_acknowledgement(flow())
            entry[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                bind([entry], FIXTURE)


class SeedTests(unittest.TestCase):
    def test_uuid_seed_must_hold_exactly_the_coreerp_seed_rows(self):
        coreerp = {"tables": {table: {} for table in DURABLE}}
        coreerp["tables"]["aset_tr_aset"] = {TENANT: "hash"}
        uuid_seed = copy.deepcopy(coreerp)
        uuid_seed["tables"]["aset_tr_aset"] = {ids.ulid_to_uuid(TENANT): "other hash"}
        self.assertEqual({}, missing_seed_rows(uuid_seed, coreerp))
        uuid_seed["tables"]["aset_tr_aset"] = {}
        self.assertEqual({"aset_tr_aset": {"only_coreerp": 1, "only_uuid_seed": 0}}, missing_seed_rows(uuid_seed, coreerp))


if __name__ == "__main__":
    unittest.main()
