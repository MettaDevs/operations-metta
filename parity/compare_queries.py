"""Bandingkan kewajiban SQL per aksi antara trace CoreERP dan kandidat, bukan teks query.

Kewajiban yang dibandingkan: baris yang ditulis per tabel, kunci baris per tabel, tabel yang dibaca,
batas transaksi, dan kerja trigger/function (statement nested). Strategi query yang berbeda (satu INSERT
multi-baris lawan tiga INSERT) tidak dihitung selisih selama kewajibannya sama. Trace tidak memuat id,
karena pg_stat_statements mengganti konstanta dengan parameter, jadi tidak ada yang dipetakan.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
AUTHORITY = {"sessions", "users", "tenant_memberships", "role_assignments", "roles", "security_role_duties",
             "security_duty_privileges", "security_privilege_permissions", "role_assignment_data_policy_scopes"}
IDENTIFIER = r'"?([a-z_][a-z0-9_]*)(?![a-z0-9_])"?(?:\."?([a-z_][a-z0-9_]*)(?![a-z0-9_])"?)?'
LOCK = re.compile(r"\bfor (update|no key update|share|key share)\b")


def operations() -> list[tuple[str, str]]:
    profile = json.loads((HERE / "profile.json").read_text(encoding="utf-8"))
    flow = profile["main_flow"][:-1] + [profile["main_flow"][-1]] * profile["fixture"]["units"]
    methods = {"receipt-create": "POST", "receipt-replace-lines": "PATCH", "receipt-complete": "POST"}
    return [("login-page", "GET"), ("login", "POST"), ("workspace", "PUT")] + [(name, methods.get(name, "GET")) for name in flow]


def tables(text: str) -> list[str]:
    ctes = set(re.findall(r"(?:\bwith(?: recursive)?|,)\s+([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(", text))
    found = []
    # Kurung sesudah from/join berarti fungsi; sesudah into berarti daftar kolom.
    for match in re.finditer(r"\b(?:(?:from|join)\s+" + IDENTIFIER + r"(?!\s*\()|(?:into|(?<!for )(?<!do )(?<!key )update)\s+" + IDENTIFIER + ")", text):
        name = match.group(2) or match.group(1) or match.group(4) or match.group(3)
        # "do update set" dan "for update skip locked" bukan nama tabel.
        if name not in ctes and name not in {"select", "lateral", "only", "set", "skip", "nowait", "of"}:
            found.append(name)
    return found


def verb(text: str) -> str:
    body = re.sub(r"^with(?: recursive)?\s.*?\)\s*(?=(select|insert|update|delete)\b)", "", text, flags=re.S)
    word = body.split(None, 1)[0] if body else ""
    if word == "insert" and re.search(r"\bon conflict\b.*\bdo update\b", body):
        return "upsert"
    return word


def obligations(trace: dict) -> dict:
    writes: dict[str, Counter] = {}
    locks, reads, transactions, nested = set(), set(), Counter(), Counter()
    statements: dict[str, str] = {}
    actor = 0
    for row in trace["queries"]:
        text = re.sub(r"\s+", " ", row["query"]).strip().lower()
        if not row["toplevel"]:
            nested[row["fingerprint"]] += row["calls"]
            statements[row["fingerprint"]] = row["query"]
            continue
        kind = verb(text)
        names = tables(text)
        if kind in {"begin", "commit"} or text.startswith(("start transaction", "rollback")) and "savepoint" not in text:
            transactions["begin" if kind in {"begin", "start"} else kind] += row["calls"]
        elif kind in {"savepoint", "release"} or text.startswith("rollback to"):
            transactions["savepoint:" + ("rollback" if kind == "rollback" else kind)] += row["calls"]
        elif kind in {"insert", "update", "delete", "upsert"} and names:
            writes.setdefault(names[0], Counter())[kind] += row["rows"]
            reads.update(names[1:])
        elif kind == "select":
            reads.update(names)
            if LOCK.search(text):
                locks.update((name, LOCK.search(text).group(1)) for name in names)
            if "set_config(" in text:
                actor += row["calls"]
            if "pg_advisory" in text:
                locks.add(("advisory", "advisory"))
        else:
            transactions["other:" + text[:40]] += row["calls"]
    return {"writes": {table: dict(counter) for table, counter in sorted(writes.items())}, "locks": sorted(locks),
            "reads": sorted(reads), "transactions": dict(transactions), "nested": nested, "statements": statements,
            "actor_calls": actor, "top_level_calls": trace["top_level_calls"], "nested_calls": trace["nested_calls"]}


def compare(expected: dict, actual: dict, authenticated: bool) -> list[dict]:
    findings = []

    def add(severity: str, kind: str, detail: object) -> None:
        findings.append({"severity": severity, "kind": kind, "detail": detail})

    if expected["nested"] != actual["nested"]:
        texts = {**expected["statements"], **actual["statements"]}
        changed = [{"query": texts[fingerprint], "expected": expected["nested"][fingerprint], "actual": actual["nested"][fingerprint]}
                   for fingerprint in sorted(set(expected["nested"]) | set(actual["nested"]))
                   if expected["nested"][fingerprint] != actual["nested"][fingerprint]]
        add("FAIL", "nested-work", {"expected_calls": expected["nested_calls"], "actual_calls": actual["nested_calls"], "statements": changed})
    for table in sorted(set(expected["writes"]) | set(actual["writes"])):
        left, right = expected["writes"].get(table, {}), actual["writes"].get(table, {})
        if sum(left.values()) != sum(right.values()):
            add("FAIL", "write-rows", {"table": table, "expected": left, "actual": right})
        elif left != right:
            add("REVIEW", "write-verb", {"table": table, "expected": left, "actual": right})
    for lock in sorted(set(map(tuple, expected["locks"])) - set(map(tuple, actual["locks"]))):
        add("FAIL", "lock-missing", list(lock))
    for lock in sorted(set(map(tuple, actual["locks"])) - set(map(tuple, expected["locks"]))):
        add("REVIEW", "lock-extra", list(lock))
    for table in sorted(set(expected["reads"]) - set(actual["reads"])):
        add("FAIL" if authenticated and table in AUTHORITY else "REVIEW", "read-missing", table)
    for table in sorted(set(actual["reads"]) - set(expected["reads"])):
        add("REVIEW", "read-extra", table)
    for key in sorted(set(expected["transactions"]) | set(actual["transactions"])):
        left, right = expected["transactions"].get(key, 0), actual["transactions"].get(key, 0)
        if left != right:
            add("FAIL" if key in {"begin", "commit"} else "REVIEW", "transaction-" + key, {"expected": left, "actual": right})
    if (expected["actor_calls"] > 0) != (actual["actor_calls"] > 0):
        add("FAIL", "actor", {"expected": expected["actor_calls"], "actual": actual["actor_calls"]})
    return findings


def load(directory: Path) -> list[dict]:
    files = sorted(directory.glob("*.json"))
    expected = operations()
    if len(files) != len(expected):
        raise ValueError(f"{directory}: needs {len(expected)} traces, found {len(files)}.")
    for path, (name, method) in zip(files, expected):
        if path.name.split("-")[1] != method:
            raise ValueError(f"{path.name}: method does not match action {name}.")
    return [json.loads(path.read_text(encoding="utf-8")) for path in files]


def waived(finding: dict, operation: str, waivers: list[dict]) -> dict | None:
    detail = finding["detail"]
    for waiver in waivers:
        match = waiver.get("match")
        if isinstance(match, list):
            matches = detail in match
        elif isinstance(match, dict) and isinstance(detail, dict):
            matches = all(detail.get(key) == value for key, value in match.items())
        else:
            matches = match is None or detail == match
        if ("*" in waiver["operations"] or operation in waiver["operations"]) and waiver["kind"] == finding["kind"] and matches:
            return waiver
    return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected", required=True, type=Path, help="Folder trace CoreERP.")
    parser.add_argument("--actual", required=True, type=Path, help="Folder trace kandidat.")
    parser.add_argument("--waivers", type=Path, default=HERE / "query-obligations.json")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    waivers = json.loads(args.waivers.read_text(encoding="utf-8"))["waivers"]
    report = []
    for index, ((operation, _), left, right) in enumerate(zip(operations(), load(args.expected), load(args.actual))):
        # Login page dan POST login belum membawa sesi terautentikasi.
        for finding in compare(obligations(left), obligations(right), authenticated=index >= 2):
            waiver = waived(finding, operation, waivers)
            report.append({"operation": operation, "steady": index >= 2, **finding,
                           "waiver": {"reason": waiver["reason"], "evidence": waiver["evidence"]} if waiver else None})
    # FAIL hanya boleh dikecualikan dengan evidence perilaku yang setara; REVIEW cukup alasan tertulis.
    open_items = [item for item in report if item["waiver"] is None or (item["severity"] == "FAIL" and not item["waiver"]["evidence"])]
    result = {"verdict": "NOT VERIFIED" if open_items else "VERIFIED",
              "steady_verdict": "NOT VERIFIED" if any(item["steady"] for item in open_items) else "VERIFIED",
              "login_open": sum(not item["steady"] for item in open_items),
              "fail_open": sum(item["severity"] == "FAIL" and item in open_items for item in report),
              "review_open": sum(item["severity"] == "REVIEW" and item in open_items for item in report),
              "waived": len(report) - len(open_items), "findings": report,
              "limitation": "Successful statements aggregated by pg_stat_statements per request. Failed statements come from the PostgreSQL log, not from this report."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ["verdict", "steady_verdict", "login_open", "fail_open", "review_open", "waived"]}))
    if open_items:
        raise SystemExit(1)
