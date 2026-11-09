"""Alur HTTP nyata profil pending-purchase: login, workspace, lalu transaksi penerimaan sampai readback aset."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import http.cookiejar
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import ids
from lab import Lab, capture, difference

PROFILE = Path(__file__).resolve().parent / "profile.json"


@dataclass
class Result:
    status: int
    headers: dict[str, str]
    body: object
    duration_ms: float
    started_at: str
    finished_at: str


@dataclass
class Trace:
    lab: Lab
    database: str
    directory: Path


class Client:
    def __init__(self, base: str, trace: Trace | None = None) -> None:
        self.base = base.rstrip("/")
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.trace = trace
        self.trace_sequence = 0

    def csrf(self) -> str:
        return next((urllib.parse.unquote(cookie.value) for cookie in self.cookies if cookie.name == "XSRF-TOKEN"), "")

    def request(self, method: str, path: str, payload: object = None, headers: dict[str, str] | None = None) -> Result:
        selected = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"}
        if payload is not None:
            selected["Content-Type"] = "application/json"
        if method not in {"GET", "HEAD", "OPTIONS"}:
            selected["X-XSRF-TOKEN"] = self.csrf()
        selected.update(headers or {})
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=selected, method=method)
        if self.trace is not None:
            before = self.trace.lab.snapshot(self.trace.database)
        started_at = datetime.now(timezone.utc).isoformat()
        start = time.perf_counter()
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        elapsed = (time.perf_counter() - start) * 1000
        finished_at = datetime.now(timezone.utc).isoformat()
        if self.trace is not None:
            time.sleep(0.1)
            after = self.trace.lab.snapshot(self.trace.database)
            self.trace_sequence += 1
            label = re.sub(r"[^a-zA-Z0-9_-]+", "-", urllib.parse.urlsplit(path).path).strip("-")
            capture(self.trace.directory / f"{self.trace_sequence:02d}-{method}-{label}.json", difference(before, after), self.trace.database)
        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = {"non_json_bytes": len(raw)}
        return Result(response.status, dict(response.headers.items()), body, elapsed, started_at, finished_at)

    def login(self, account: dict, password: str) -> list[Result]:
        bootstrap = self.request("GET", "/login")
        if bootstrap.status != 200 or not self.csrf():
            raise RuntimeError(f"Login bootstrap failed, HTTP {bootstrap.status}, csrf_present={bool(self.csrf())}.")
        login = self.request("POST", "/login", {"email": account["email"], "password": password})
        if login.status != 200:
            raise RuntimeError(f"Login failed, HTTP {login.status}.")
        workspace = self.request("PUT", "/api/v1/workspace-context", {
            "membership_id": account["membership_id"],
            "legal_entity_id": account["legal_entity_id"],
            "org_unit_id": account["department_id"],
        })
        if workspace.status != 200:
            raise RuntimeError(f"Workspace selection failed, HTTP {workspace.status}.")
        return [bootstrap, login, workspace]


def fixture_password(path: Path) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("COMPARE_PASSWORD="):
            return line.split("=", 1)[1]
    raise ValueError("COMPARE_PASSWORD is missing from the runtime env.")


def load_fixture(path: Path) -> tuple[dict, str]:
    """Fixture lab ber-ULID, sedangkan kandidat membaca seed uuid. Hash tetap dari berkas asli, identitas run."""
    fixture = json.loads(path.read_text(encoding="utf-8"))
    digest = hashlib.sha256(json.dumps(fixture, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return ids.normalize_fixture(fixture), digest


def run_flow(client: Client, fixture: dict, account: dict, run_id: str) -> list[dict]:
    tenant = next(item for item in fixture["tenants"] if item["tenant_id"] == account["tenant_id"])
    prefix = "/api/modules/" + fixture["module_id"] + "/v1"
    document = tenant["receipt_body"]
    events: list[dict] = []

    def execute(operation: str, method: str, path: str, payload: object = None, headers: dict[str, str] | None = None, expected: int = 200) -> Result:
        result = client.request(method, prefix + path, payload, headers)
        events.append({"operation": operation, "status": result.status, "duration_ms": result.duration_ms, "started_at": result.started_at,
                       "finished_at": result.finished_at,
                       "headers": {key: value for key, value in result.headers.items() if key.lower() in {"etag", "idempotent-replayed", "location"}},
                       "body": result.body})
        if result.status != expected:
            raise RuntimeError(f"{operation} failed, HTTP {result.status}, expected {expected}.")
        return result

    execute("receipt-list", "GET", "/penerimaan-aset?per_page=40")
    created = execute("receipt-create", "POST", "/penerimaan-aset", document, {"Idempotency-Key": "compare-" + run_id}, 201)
    receipt_id = created.body["data"]["id"]
    shown = execute("receipt-show-draft", "GET", "/penerimaan-aset/" + receipt_id)
    changed = execute("receipt-replace-lines", "PATCH", "/penerimaan-aset/" + receipt_id, {**document, "version": shown.body["data"]["version"]})
    execute("receipt-preview", "GET", "/penerimaan-aset/" + receipt_id + "/pratinjau-posting")
    completed = execute("receipt-complete", "POST", "/penerimaan-aset/" + receipt_id + "/selesaikan", {"version": changed.body["data"]["version"]})
    if completed.body["data"].get("posting", {}).get("status") != "pending":
        raise RuntimeError("Posting is not pending; the business profile is not met.")
    execute("receipt-show-completed", "GET", "/penerimaan-aset/" + receipt_id)
    assets = execute("receipt-assets", "GET", "/penerimaan-aset/" + receipt_id + "/aset")
    if len(assets.body["data"]) != 3:
        raise RuntimeError("Asset count does not match the three-unit profile.")
    execute("asset-list", "GET", "/aset?per_page=40")
    for asset in assets.body["data"]:
        execute("asset-show", "GET", "/aset/" + asset["id"])
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--env", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--account", type=int, default=0)
    parser.add_argument("--run-id")
    parser.add_argument("--lab", type=Path, help="Wajib bersama --trace-directory.")
    parser.add_argument("--trace-database")
    parser.add_argument("--trace-directory", type=Path)
    arguments = parser.parse_args()
    trace = None
    if arguments.trace_directory is not None:
        if arguments.lab is None or arguments.trace_database is None:
            parser.error("--trace-directory needs --lab and --trace-database.")
        trace = Trace(Lab.load(arguments.lab), arguments.trace_database, arguments.trace_directory)
    fixture, fixture_hash = load_fixture(arguments.fixture)
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    client = Client(arguments.base, trace)
    account = fixture["accounts"][arguments.account]
    login = client.login(account, fixture_password(arguments.env))
    run_id = arguments.run_id or uuid.uuid4().hex
    events = run_flow(client, fixture, account, run_id)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "source_sha": fixture["source_sha"], "profile_id": profile["id"], "fixture_id": fixture["fixture_id"],
        "fixture_hash": fixture_hash, "run_id": run_id,
        "account": {"index": arguments.account, **{key: account[key] for key in ["user_id", "tenant_id", "legal_entity_id", "membership_id"]}},
        "authentication": [{"status": result.status, "duration_ms": result.duration_ms} for result in login],
        "events": events,
    }
    arguments.output.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"operations": len(events), "statuses": [event["status"] for event in events], "capacity_claim": False}))


if __name__ == "__main__":
    main()
