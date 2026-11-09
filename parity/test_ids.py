"""Pemetaan ULID ke uuid dan aturan normalisasi bukti CoreERP; tanpa database."""

from __future__ import annotations

import unittest

import ids

VECTORS = {
    "01JC9X0V2B3C4D5E6F7G8H9JKM": "019313d0-6c4b-1b08-d2b8-cf3c1114ca74",
    "00000000000000000000000000": "00000000-0000-0000-0000-000000000000",
    "7ZZZZZZZZZZZZZZZZZZZZZZZZZ": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "0000000000000000000000000Z": "00000000-0000-0000-0000-00000000001f",
    "10000000000000000000000000": "20000000-0000-0000-0000-000000000000",
}
RECEIPT = "01M6GK931BX1FYNBR3B97ANRRQ"
MARKER = "01m6g2rvpjw0ads6d17dqew6qw"


class MappingTests(unittest.TestCase):
    def test_vectors_match_the_sql_function(self):
        for ulid, expected in VECTORS.items():
            with self.subTest(ulid=ulid):
                self.assertEqual(expected, ids.ulid_to_uuid(ulid))
                self.assertEqual(ulid, ids.uuid_to_ulid(expected))

    def test_case_insensitive_both_ways(self):
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), ids.ulid_to_uuid(RECEIPT.lower()))
        uuid_text = ids.ulid_to_uuid(RECEIPT)
        self.assertEqual(RECEIPT, ids.uuid_to_ulid(uuid_text.upper()))

    def test_round_trip_preserves_order(self):
        values = sorted([RECEIPT, MARKER.upper(), "01M6G2RVPJW0ADS6D17DQEW6R8", "01M6G2RVPJW0ADS6D17DQEW6RA", "01M6GK94MWPXT2WVC3BEEYG36P"])
        converted = [ids.ulid_to_uuid(value) for value in values]
        self.assertEqual(converted, sorted(converted))
        self.assertEqual(values, [ids.uuid_to_ulid(value) for value in converted])

    def test_rejects_values_outside_the_alphabet_or_range(self):
        for value in ["8ZZZZZZZZZZZZZZZZZZZZZZZZZ", "01JC9X0V2B3C4D5E6F7G8H9JKI", "01JC9X0V2B3C4D5E6F7G8H9JKL",
                      "01JC9X0V2B3C4D5E6F7G8H9JKO", "01JC9X0V2B3C4D5E6F7G8H9JKU", "01JC9X0V2B3C4D5E6F7G8H9JK",
                      "01JC9X0V2B3C4D5E6F7G8H9JKMM", "01JC9X0V2B3C4D5E6F7G8H9JKM"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ids.ulid_to_uuid(value)
        for value in ["019313d06c4b1b08d2b8cf3c1114ca74", "019313d0-6c4b-1b08-d2b8-cf3c1114ca7", "{019313d0-6c4b-1b08-d2b8-cf3c1114ca74}"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ids.uuid_to_ulid(value)


class NormalizationTests(unittest.TestCase):
    def test_id_keys_convert_and_free_text_keeps_ulid_shaped_markers(self):
        source = {
            "id": RECEIPT, "tenant_id": MARKER, "asset_ids": [RECEIPT, MARKER], "external_id": f"comparison:{MARKER}-0001:tax",
            "nama": f"Aset simulasi {MARKER}-0001", "email": f"owner-{MARKER}-0001@comparison.invalid",
            "creation_key": f"comparison:{MARKER}-0001", "module_id": "management-aset", "user_id": 1, "deleted_at": None,
        }
        result = ids.normalize(source)
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), result["id"])
        self.assertEqual(ids.ulid_to_uuid(MARKER), result["tenant_id"])
        self.assertEqual([ids.ulid_to_uuid(RECEIPT), ids.ulid_to_uuid(MARKER)], result["asset_ids"])
        for key in ["external_id", "nama", "email", "creation_key", "module_id", "user_id", "deleted_at"]:
            self.assertEqual(source[key], result[key], key)

    def test_text_built_from_ids_converts_only_whole_parts(self):
        receipt = ids.ulid_to_uuid(RECEIPT)
        group = "01M6G2RVPJW0ADS6D17DQEW6QY"
        result = ids.normalize({
            "posting_id": "AST-ACQ-" + RECEIPT, "finance_posting_id": MARKER,
            "headers": {"Location": "http://127.0.0.1:18641/api/modules/management-aset/v1/penerimaan-aset/" + RECEIPT},
            "source_document": {"url": "/management-aset/inventarisasi-aset/penerimaan/" + RECEIPT},
            "mapping": {"reference": f"posting-group:{group}:acquisition_account_id", "fix_url": "/management-aset/fixed-aset-posting-profiles"},
            "vendor_invoice_reference": f"INV:{RECEIPT}",
        })
        self.assertEqual("AST-ACQ-" + receipt, result["posting_id"])
        self.assertEqual(ids.ulid_to_uuid(MARKER), result["finance_posting_id"])
        self.assertTrue(result["headers"]["Location"].endswith("/penerimaan-aset/" + receipt))
        self.assertEqual("/management-aset/inventarisasi-aset/penerimaan/" + receipt, result["source_document"]["url"])
        self.assertEqual(f"posting-group:{ids.ulid_to_uuid(group)}:acquisition_account_id", result["mapping"]["reference"])
        self.assertEqual("/management-aset/fixed-aset-posting-profiles", result["mapping"]["fix_url"])
        self.assertEqual(f"INV:{RECEIPT}", result["vendor_invoice_reference"])

    def test_run_identity_stays_as_recorded(self):
        run = {"fixture_id": MARKER, "run_id": "golden-20261103", "fixture_hash": "f" * 64,
               "account": {"index": 0, "user_id": 1, "tenant_id": RECEIPT}, "events": [{"body": {"data": {"id": RECEIPT}}}]}
        result = ids.normalize_flow(run)
        self.assertEqual((MARKER, "golden-20261103", "f" * 64), (result["fixture_id"], result["run_id"], result["fixture_hash"]))
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), result["account"]["tenant_id"])
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), result["events"][0]["body"]["data"]["id"])
        self.assertEqual(RECEIPT, run["events"][0]["body"]["data"]["id"], "input is not mutated")

    def test_fixture_seed_sections_convert_and_identity_stays(self):
        fixture = {"fixture_id": MARKER, "module_id": "management-aset",
                   "accounts": [{"tenant_id": RECEIPT, "email": f"owner-{MARKER}-0001@comparison.invalid"}],
                   "probe_accounts": [{"role_id": RECEIPT, "duty_code": f"comparison.{RECEIPT}.outside_scope"}],
                   "tenants": [{"tenant_id": RECEIPT, "receipt_body": {"details": [{"atribut": [{"tipe_atribut_id": MARKER}]}]}}]}
        result = ids.normalize_fixture(fixture)
        self.assertEqual(MARKER, result["fixture_id"])
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), result["accounts"][0]["tenant_id"])
        self.assertEqual(fixture["accounts"][0]["email"], result["accounts"][0]["email"])
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), result["probe_accounts"][0]["role_id"])
        self.assertEqual(fixture["probe_accounts"][0]["duty_code"], result["probe_accounts"][0]["duty_code"])
        self.assertEqual(ids.ulid_to_uuid(MARKER), result["tenants"][0]["receipt_body"]["details"][0]["atribut"][0]["tipe_atribut_id"])


if __name__ == "__main__":
    unittest.main()
