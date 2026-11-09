"""Bandingkan flow HTTP kandidat dengan flow CoreERP; hanya ID baru dan timestamp valid yang boleh dipetakan.

Flow CoreERP diterjemahkan ke uuid lebih dulu (ids.normalize_flow), lalu dibandingkan persis.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

import ids

PROFILE = Path(__file__).resolve().parent / "profile.json"
TIMESTAMPS = {"created_at", "updated_at", "occurred_at", "last_validated_at", "published_at"}


class Comparison:
    def __init__(self) -> None:
        self.left_ids: dict[str, str] = {}
        self.right_ids: dict[str, str] = {}
        self.differences: list[dict] = []
        self.windows: tuple[tuple[datetime, datetime], tuple[datetime, datetime]] | None = None
        self.current_operation = ""
        self.timestamp_values: dict[tuple[int, str, str], str] = {}

    def register(self, left: object, right: object, identity: str) -> None:
        if not isinstance(left, str) or not isinstance(right, str):
            raise ValueError("New identity is not a string.")
        if identity != "$request-key" and any(ids.UUID.fullmatch(value) is None for value in [left, right]):
            raise ValueError("New record ID is not a canonical UUID: " + identity)
        for mapping, value in [(self.left_ids, left), (self.right_ids, right)]:
            if value in mapping and mapping[value] != identity:
                raise ValueError("ID mapping is not bijective: " + identity)
            mapping[value] = identity

    def prepare(self, left: list[dict], right: list[dict]) -> None:
        if len(left) != len(right):
            self.differences.append({"path": "events.length", "expected": len(left), "actual": len(right)})
        previous_details: dict[int, tuple[str, str]] = {}
        for index, (expected, actual) in enumerate(zip(left, right)):
            if expected["operation"] != actual["operation"]:
                continue
            operation = expected["operation"]
            a, b = expected["body"].get("data"), actual["body"].get("data")
            if operation == "receipt-create" and isinstance(a, dict) and isinstance(b, dict):
                self.register(a["id"], b["id"], "$receipt")
                self.register(a["creation_key"], b["creation_key"], "$request-key")
            if operation in {"receipt-create", "receipt-replace-lines"} and isinstance(a, dict) and isinstance(b, dict):
                for line_index, (ad, bd) in enumerate(zip(a.get("details", []), b.get("details", []))):
                    pair = (ad["id"], bd["id"])
                    if previous_details.get(line_index) != pair:
                        self.register(pair[0], pair[1], f"$detail-{index}-{line_index}")
                        previous_details[line_index] = pair
            if operation == "receipt-assets" and isinstance(a, list) and isinstance(b, list):
                by_code = {asset["kode"]: asset for asset in b}
                for asset in a:
                    if asset["kode"] in by_code:
                        self.register(asset["id"], by_code[asset["kode"]]["id"], "$asset-" + asset["kode"])
            if isinstance(a, dict) and isinstance(b, dict):
                ap, bp = a.get("posting"), b.get("posting")
                if isinstance(ap, dict) and isinstance(bp, dict) and ap.get("id") and bp.get("id"):
                    self.register(ap["id"], bp["id"], "$posting")

    def text(self, value: str, mapping: dict[str, str]) -> str:
        for original, replacement in sorted(mapping.items(), key=lambda item: len(item[0]), reverse=True):
            value = value.replace(original, replacement)
        return value

    def compare(self, expected: object, actual: object, path: str = "", new_entity: bool = False, identity: str | None = None) -> None:
        if isinstance(expected, dict) and isinstance(actual, dict):
            new_entity = new_entity or expected.get("id") in self.left_ids
            identity = self.left_ids.get(expected.get("id"), identity)
            for key in sorted(set(expected) | set(actual)):
                child = path + "." + key
                if key not in actual or key not in expected:
                    self.differences.append({"path": child, "expected": expected.get(key, "$ABSENT"), "actual": actual.get(key, "$ABSENT")})
                elif key in TIMESTAMPS and new_entity and isinstance(expected[key], str) and isinstance(actual[key], str):
                    for side, value in enumerate([expected[key], actual[key]]):
                        identity_key = (side, identity or path, key)
                        previous = self.timestamp_values.get(identity_key)
                        mutable = key == "updated_at" and self.current_operation in {"receipt-replace-lines", "receipt-complete"}
                        if previous is not None and value != previous and not mutable:
                            self.differences.append({"path": child, "reason": "stored timestamp changed during readback", "expected": previous, "actual": value})
                        self.timestamp_values[identity_key] = value
                    if not same_timestamp_shape(expected[key], actual[key]):
                        self.differences.append({"path": child, "expected": expected[key], "actual": actual[key], "reason": "timestamp format"})
                    elif self.windows is not None:
                        for value, window in zip([expected[key], actual[key]], self.windows):
                            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                            if parsed.tzinfo is None:
                                parsed = parsed.replace(tzinfo=timezone.utc)
                            if not window[0] - timedelta(seconds=2) <= parsed <= window[1] + timedelta(seconds=2):
                                self.differences.append({"path": child, "reason": "timestamp outside actual request window", "actual": value})
                else:
                    self.compare(expected[key], actual[key], child, new_entity, identity)
        elif isinstance(expected, list) and isinstance(actual, list):
            if len(expected) != len(actual):
                self.differences.append({"path": path + ".length", "expected": len(expected), "actual": len(actual)})
            for index, (a, b) in enumerate(zip(expected, actual)):
                self.compare(a, b, f"{path}[{index}]", new_entity, identity)
        elif isinstance(expected, str) and isinstance(actual, str):
            if self.text(expected, self.left_ids) != self.text(actual, self.right_ids):
                self.differences.append({"path": path, "expected": expected, "actual": actual})
        elif type(expected) is not type(actual) or expected != actual:
            self.differences.append({"path": path, "expected": expected, "actual": actual})


def same_timestamp_shape(expected: str, actual: str) -> bool:
    try:
        datetime.fromisoformat(expected.replace("Z", "+00:00"))
        datetime.fromisoformat(actual.replace("Z", "+00:00"))
    except ValueError:
        return False
    return re.sub(r"\d", "#", expected) == re.sub(r"\d", "#", actual)


def compare_runs(expected: dict, actual: dict) -> dict:
    """Kedua run sudah dalam bentuk uuid: `expected` lewat ids.normalize_flow, `actual` dari kandidat."""
    comparison = Comparison()
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    expected_operations = profile["main_flow"][:-1] + [profile["main_flow"][-1]] * profile["fixture"]["units"]
    for side, run in enumerate([expected, actual]):
        for key, value in [("source_sha", profile["source_sha"]), ("profile_id", profile["id"])]:
            if run.get(key) != value:
                comparison.differences.append({"path": f"run[{side}].{key}", "expected": value, "actual": run.get(key)})
        for key in ["fixture_id", "fixture_hash", "run_id"]:
            if not isinstance(run.get(key), str) or not run[key] or run.get(key) != expected.get(key):
                comparison.differences.append({"path": f"run[{side}].{key}", "reason": "missing or mismatched experiment identity"})
        if not isinstance(run.get("account"), dict) or run["account"].get("user_id") is None or run.get("account") != expected.get("account"):
            comparison.differences.append({"path": f"run[{side}].account", "reason": "both runs must act as the same fixture account"})
        if [entry.get("status") for entry in run.get("authentication", [])] != [200, 200, 200]:
            comparison.differences.append({"path": f"run[{side}].authentication", "reason": "three successful HTTP authentication/workspace actions required"})
        if [event.get("operation") for event in run.get("events", [])] != expected_operations:
            comparison.differences.append({"path": f"run[{side}].events", "reason": "complete ordered profile required"})
        for event in run.get("events", []):
            status = 201 if event.get("operation") == "receipt-create" else 200
            if event.get("status") != status:
                comparison.differences.append({"path": f"run[{side}].events.status", "expected": status, "actual": event.get("status")})
            if event.get("operation") == "receipt-create" and event.get("body", {}).get("data", {}).get("creation_key") != "compare-" + str(run.get("run_id")):
                comparison.differences.append({"path": f"run[{side}].creation_key", "reason": "persisted response must match submitted run key"})
    if comparison.differences:
        return {"verdict": "NOT VERIFIED", "differences": comparison.differences, "timestamp_freshness_verified": False}
    if all(all("started_at" in event and "finished_at" in event for event in run["events"]) for run in [expected, actual]):
        comparison.windows = tuple((datetime.fromisoformat(run["events"][0]["started_at"]), datetime.fromisoformat(run["events"][-1]["finished_at"])) for run in [expected, actual])
    comparison.prepare(expected["events"], actual["events"])
    for index, (left, right) in enumerate(zip(expected["events"], actual["events"])):
        comparison.current_operation = left["operation"]
        for key in ["operation", "status", "body"]:
            comparison.compare(left[key], right[key], f"events[{index}].{key}")
        a = {key.lower(): value for key, value in left["headers"].items()}
        b = {key.lower(): value for key, value in right["headers"].items()}
        for headers in [a, b]:
            if "location" in headers:
                location = urlsplit(headers["location"])
                headers["location"] = location.path + ("?" + location.query if location.query else "")
        comparison.compare(a, b, f"events[{index}].headers")
    return {
        "verdict": "NOT VERIFIED" if comparison.differences else "VERIFIED" if comparison.windows is not None else "INCONCLUSIVE",
        "differences": comparison.differences,
        "normalization": "CoreERP ULIDs under id keys, posting IDs, and the Location path become the same 128-bit value as UUID text (ids.normalize_flow). Then bijective new receipt/detail/asset/posting IDs, request key, valid timestamp shape on new records, and Location origin. Names, codes, array order, field types, null/absence, money, dates, versions, status and ETag remain exact.",
        "timestamp_freshness_verified": comparison.windows is not None,
        "limitation": "This comparison alone does not prove database effects or all query obligations. Timestamp checks assume source config UTC and clock skew under two seconds.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected", type=Path, required=True, help="Flow CoreERP (ULID).")
    parser.add_argument("--actual", type=Path, required=True, help="Flow kandidat (uuid).")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    expected = ids.normalize_flow(json.loads(args.expected.read_text(encoding="utf-8")))
    result = compare_runs(expected, json.loads(args.actual.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": result["verdict"], "difference_count": len(result["differences"]), "paths": [difference["path"] for difference in result["differences"][:20]]}))
    if result["differences"]:
        raise SystemExit(1)
