"""Pemetaan ULID dan id pengguna ke uuid, dan aturan normalisasi bukti CoreERP; tanpa database."""

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
# Sama dengan vektor di database/check-ids.sql untuk user_id_to_uuid dan uuid_to_user_id.
USER_VECTORS = {
    0: "00000000-0000-0000-0000-000000000000",
    1: "00000000-0000-0000-0000-000000000001",
    12: "00000000-0000-0000-0000-00000000000c",
    4294967296: "00000000-0000-0000-0000-000100000000",
    9223372036854775807: "00000000-0000-0000-7fff-ffffffffffff",
}


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
            "creation_key": f"comparison:{MARKER}-0001", "module_id": "management-aset", "deleted_at": None,
        }
        result = ids.normalize(source)
        self.assertEqual(ids.ulid_to_uuid(RECEIPT), result["id"])
        self.assertEqual(ids.ulid_to_uuid(MARKER), result["tenant_id"])
        self.assertEqual([ids.ulid_to_uuid(RECEIPT), ids.ulid_to_uuid(MARKER)], result["asset_ids"])
        for key in ["external_id", "nama", "email", "creation_key", "module_id", "deleted_at"]:
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
        self.assertEqual(USER_VECTORS[1], result["account"]["user_id"])
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


class UserIdTests(unittest.TestCase):
    def test_vectors_match_the_sql_function(self):
        for user_id, expected in USER_VECTORS.items():
            with self.subTest(user_id=user_id):
                self.assertEqual(expected, ids.user_id_to_uuid(user_id))
                self.assertEqual(user_id, ids.uuid_to_user_id(expected))
                self.assertEqual(user_id, ids.uuid_to_user_id(expected.upper()))

    def test_order_is_kept_and_new_uuid_v7_ids_never_collide(self):
        values = [1, 2, 9, 10, 255, 256, 4294967296]
        converted = [ids.user_id_to_uuid(value) for value in values]
        self.assertEqual(converted, sorted(converted))
        v7 = "019a6b3c-1d2e-7f40-8a5b-6c7d8e9f0a1b"
        self.assertLess(ids.user_id_to_uuid(9223372036854775807), v7)
        with self.assertRaises(ValueError):
            ids.uuid_to_user_id(v7)

    def test_rejects_values_outside_non_negative_bigint(self):
        for value in [-1, 1 << 63, True, 1.0, "1", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ids.user_id_to_uuid(value)
        for value in ["00000000-0000-0001-0000-000000000000", "00000000-0000-0000-8000-000000000000", "1"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ids.uuid_to_user_id(value)

    def test_user_keys_convert_numbers_and_decimal_text_only(self):
        source = {
            "user_id": 1, "created_by_user_id": "12", "diterima_oleh_user_id": "3", "principal_id": 8, "created_by": 2,
            "requested_by": 5, "updated_by": 6, "sso_redeemed_by": 4, "detail": {"principal_id": 9, "membership_id": MARKER},
            "approved_by": 7, "user_index": 1, "users_per_tenant": 4, "jumlah": 3, "acted_by_user_id": "Budi",
            "requester_user_id": "007", "updated_by_user_id": None, "oleh_user_id": True, "responsible_user_id": 1 << 63,
        }
        result = ids.normalize(source)
        for key, user_id in [("user_id", 1), ("created_by_user_id", 12), ("diterima_oleh_user_id", 3), ("principal_id", 8),
                             ("created_by", 2), ("requested_by", 5), ("updated_by", 6), ("sso_redeemed_by", 4)]:
            self.assertEqual(ids.user_id_to_uuid(user_id), result[key], key)
        self.assertEqual({"principal_id": ids.user_id_to_uuid(9), "membership_id": ids.ulid_to_uuid(MARKER)}, result["detail"])
        for key in ["approved_by", "user_index", "users_per_tenant", "jumlah", "acted_by_user_id", "requester_user_id",
                    "updated_by_user_id", "oleh_user_id", "responsible_user_id"]:
            self.assertEqual(source[key], result[key], key)

    def test_actor_scope_converts_only_its_user_part(self):
        customer = "9b2f4c1e-5d6a-4e7b-8c9d-0a1b2c3d4e5f"
        result = ids.normalize({"actor_scope": "system:1", "other": {"actor_scope": "customer:" + customer}})
        self.assertEqual("system:" + ids.user_id_to_uuid(1), result["actor_scope"])
        self.assertEqual("customer:" + customer, result["other"]["actor_scope"])

    def test_users_table_id_is_a_user_id_and_other_tables_keep_theirs(self):
        self.assertEqual(ids.user_id_to_uuid(3), ids.normalize_row("users", {"id": 3, "name": "Pengguna 3"})["id"])
        self.assertEqual(3, ids.normalize_row("jobs", {"id": 3})["id"])
        self.assertEqual(ids.user_id_to_uuid(3), ids.normalize_row("sessions", {"id": "x", "user_id": 3})["user_id"])

    def test_fixture_accounts_act_as_converted_users(self):
        fixture = ids.normalize_fixture({"accounts": [{"user_id": 1, "user_index": 1}], "probe_accounts": [{"user_id": 12, "user_index": 0}],
                                         "users_per_tenant": 4})
        self.assertEqual((ids.user_id_to_uuid(1), 1), (fixture["accounts"][0]["user_id"], fixture["accounts"][0]["user_index"]))
        self.assertEqual(ids.user_id_to_uuid(12), fixture["probe_accounts"][0]["user_id"])
        self.assertEqual(4, fixture["users_per_tenant"])


if __name__ == "__main__":
    unittest.main()
