"""Probe negatif, race, pencabutan akses, rollback, dan throttle yang sama dengan acuan CoreERP.

Hanya HTTP dan SQL pada clone uji; tidak memakai kode kandidat. Kandidat dijalankan dari image pada clone
baru seed uuid, lalu hasilnya dibandingkan dengan hasil probe yang sama pada CoreERP.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import copy
import http.cookiejar
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

import candidate
from http_baseline import Client, fixture_password, load_fixture
import ids
from lab import Lab

SECTIONS = ["http", "revocation", "rollback", "throttle"]


class ProbeClient:
    """Klien probe HTTP apa adanya dari eksperimen: Content-Type selalu terkirim dan tanpa X-Requested-With.
    Acuan CoreERP direkam dengan klien ini, jadi bentuk request-nya dipertahankan."""

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, method: str, path: str, body=None, headers=None):
        selected = {"Accept": "application/json", "Content-Type": "application/json"}
        if method not in {"GET", "HEAD", "OPTIONS"}:
            selected["X-XSRF-TOKEN"] = next((urllib.parse.unquote(c.value) for c in self.cookies if c.name == "XSRF-TOKEN"), "")
        selected.update(headers or {})
        request = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=selected, method=method)
        try:
            result = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            result = error
        raw = result.read()
        try:
            content = json.loads(raw)
        except json.JSONDecodeError:
            content = {"non_json_bytes": len(raw)}
        return result.status, content, dict(result.headers)

    def login(self, account: dict, password: str, workspace=True):
        assert self.request("GET", "/login")[0] == 200
        assert self.request("POST", "/login", {"email": account["email"], "password": password})[0] == 200
        if workspace:
            assert self.request("PUT", "/api/v1/workspace-context", {"membership_id": account["membership_id"], "legal_entity_id": account["legal_entity_id"], "org_unit_id": account["department_id"]})[0] == 200


def http_probes(base: str, fixture: dict, password: str) -> dict:
    prefix = "/api/modules/" + fixture["module_id"] + "/v1"
    receipts = prefix + "/penerimaan-aset"
    owner = fixture["accounts"][0]
    tenant = next(t for t in fixture["tenants"] if t["tenant_id"] == owner["tenant_id"])
    document = tenant["receipt_body"]
    events = []

    def check(name, actual, expected):
        assert actual[0] == expected, (name, actual[0], actual[1])
        events.append({"probe": name, "status": actual[0]})
        return actual

    anonymous = ProbeClient(base)
    check("anonymous", anonymous.request("GET", receipts), 401)
    check("login-bootstrap", anonymous.request("GET", "/login"), 200)
    check("csrf-missing", anonymous.request("POST", "/login", {"email": owner["email"], "password": password}, {"X-XSRF-TOKEN": ""}), 419)
    check("csrf-wrong", anonymous.request("POST", "/login", {"email": owner["email"], "password": password}, {"X-XSRF-TOKEN": "wrong"}), 419)
    client = ProbeClient(base)
    client.login(owner, password)
    key = "conformance-" + uuid.uuid4().hex
    created = check("create", client.request("POST", receipts, document, {"Idempotency-Key": key}), 201)[1]["data"]
    path = receipts + "/" + created["id"]
    replay = check("changed-body-replay", client.request("POST", receipts, {"unexpected": True}, {"Idempotency-Key": key}), 200)
    assert replay[1]["data"]["id"] == created["id"] and "details" not in replay[1]["data"]
    assert {key.lower(): value for key, value in replay[2].items()}.get("idempotent-replayed") == "true"
    check("missing-version", client.request("POST", path + "/selesaikan", {}), 428)
    check("bad-version-header", client.request("POST", path + "/selesaikan", {"version": created["version"]}, {"If-Match": "wrong"}), 428)
    check("stale-zero-version", client.request("POST", path + "/selesaikan", {"version": 0}), 409)
    denied = next(a for a in fixture["probe_accounts"] if a["tenant_id"] == owner["tenant_id"] and a["kind"] == "no_asset_create")
    no_create = ProbeClient(base)
    no_create.login(denied, password)
    check("asset-create-required", no_create.request("POST", path + "/selesaikan", {"version": created["version"]}), 403)
    outside = next(a for a in fixture["probe_accounts"] if a["tenant_id"] == owner["tenant_id"] and a["kind"] == "outside_scope")
    outside_client = ProbeClient(base)
    outside_client.login(outside, password, workspace=False)
    check("unit-scope-show", outside_client.request("GET", path), 404)
    check("unit-scope-create", outside_client.request("POST", receipts, document, {"Idempotency-Key": key + "-outside"}), 403)
    foreign = next(a for a in fixture["accounts"] if a["tenant_id"] != owner["tenant_id"])
    foreign_client = ProbeClient(base)
    foreign_client.login(foreign, password)
    check("tenant-show", foreign_client.request("GET", path), 404)
    check("tenant-body-cannot-grant-access", foreign_client.request("POST", receipts, {**document, "tenant_id": owner["tenant_id"]}, {"Idempotency-Key": key + "-foreign"}), 422)
    invalid = copy.deepcopy(document)
    invalid["details"][0]["atribut"] = []
    check("required-attribute", client.request("POST", receipts, invalid, {"Idempotency-Key": key + "-attribute"}), 422)
    invalid = copy.deepcopy(document)
    invalid["details"][0]["nilai_per_unit"] = "333333.3331"
    check("unit-precision", client.request("POST", receipts, invalid, {"Idempotency-Key": key + "-precision"}), 422)
    updated = check("patch", client.request("PATCH", path, {**document, "version": created["version"]}), 200)[1]["data"]
    assert updated["version"] == created["version"] + 2
    check("patch-stale", client.request("PATCH", path, {**document, "version": created["version"]}), 409)
    workers = [ProbeClient(base) for _ in range(3)]
    worker_accounts = [a for a in fixture["accounts"] if a["tenant_id"] == owner["tenant_id"] and a["user_index"] != 1]
    for worker, account in zip(workers, worker_accounts):
        worker.login(account, password)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda c: c.request("POST", path + "/selesaikan", {"version": updated["version"]}), workers))
    statuses = sorted(r[0] for r in results)
    assert statuses.count(200) == 1 and all(status in {200, 409, 422} for status in statuses), statuses
    events.append({"probe": "completion-race", "statuses": statuses})
    check("repeat-completion", client.request("POST", path + "/selesaikan", {"version": updated["version"]}), 422)
    generated = check("generated-assets", client.request("GET", path + "/aset"), 200)[1]["data"]
    assert len(generated) == sum(d["jumlah"] for d in document["details"])
    codes = [a["kode"] for a in generated]
    assert len(codes) == len(set(codes))
    for asset in generated:
        check("asset-show", client.request("GET", prefix + "/aset/" + asset["id"]), 200)
    first = check("cursor-page-one", client.request("GET", receipts + "?per_page=1&sort=kode"), 200)[1]
    assert first["next_cursor"]
    second = check("cursor-page-two", client.request("GET", receipts + "?per_page=1&sort=kode&cursor=" + urllib.parse.quote(first["next_cursor"])), 200)[1]
    assert first["data"][0]["id"] != second["data"][0]["id"]
    check("bad-cursor", client.request("GET", receipts + "?cursor=invalid"), 422)
    punctuation = check("punctuation-search", client.request("GET", receipts + "?q=..."), 200)[1]
    assert punctuation["data"] == []
    phrase = urllib.parse.quote('"' + document["details"][0]["nama"] + '"')
    assets = check("phrase-search", client.request("GET", prefix + "/aset?q=" + phrase), 200)[1]
    assert all(a["nama"] == document["details"][0]["nama"] for a in assets["data"]) and assets["data"]
    saved_cookies = [copy.copy(cookie) for cookie in client.cookies]
    check("logout", client.request("POST", "/logout", {}), 204)
    old_client = ProbeClient(base)
    for cookie in saved_cookies:
        old_client.cookies.set_cookie(cookie)
    check("deleted-session", old_client.request("GET", receipts), 401)
    return {"verdict": "PASS", "profile": fixture["profile"], "receipt_id": created["id"], "events": events, "boundary": "HTTP only. The independent SQL oracle must verify persisted effects and rollback."}


def revocation(base: str, fixture: dict, password: str, lab: Lab, database: str) -> list[dict]:
    """Izin dibaca ulang tiap request: mutasi akses pada sesi yang masih hidup harus langsung berlaku."""
    account = fixture["accounts"][3]
    membership, user_id = account["membership_id"], int(account["user_id"])
    if not ids.UUID.fullmatch(membership):
        raise ValueError("Fixture membership ID is not a canonical UUID.")
    client = Client(base)
    client.login(account, password)
    path = "/api/modules/" + fixture["module_id"] + "/v1/penerimaan-aset"
    observed: list[dict] = []

    def observe(label: str) -> None:
        result = client.request("GET", path)
        empty = isinstance(result.body, dict) and result.body.get("data") == []
        observed.append({"probe": label, "status": result.status, "empty": empty})

    def run(statement: str) -> str:
        return lab.sql(statement, database)

    def literal(value) -> str:
        return "null" if value is None else "'" + str(value).replace("'", "''") + "'"

    def mutated(label: str, change: str, backup: str, restore) -> None:
        rows = json.loads(run(f"SELECT coalesce(json_agg(row_to_json(b)),'[]') FROM ({backup}) b;"))
        try:
            run(change)
            observe(label)
        finally:
            for row in rows:
                run(restore(row))

    owned = f"SELECT id FROM role_assignments WHERE membership_id='{membership}'"
    observe("active-session")
    mutated("assignment-revoked-live-session", f"UPDATE role_assignments SET status='inactive' WHERE membership_id='{membership}';",
            f"SELECT id,status FROM role_assignments WHERE membership_id='{membership}'",
            lambda row: f"UPDATE role_assignments SET status={literal(row['status'])} WHERE id={literal(row['id'])};")
    observe("assignment-restored")
    mutated("assignment-expired-live-session", f"UPDATE role_assignments SET valid_until=now()-interval '1 minute' WHERE membership_id='{membership}';",
            f"SELECT id,valid_until FROM role_assignments WHERE membership_id='{membership}'",
            lambda row: f"UPDATE role_assignments SET valid_until={literal(row['valid_until'])} WHERE id={literal(row['id'])};")
    mutated("role-disabled-live-session", f"UPDATE roles SET is_active=false WHERE id IN (SELECT role_id FROM role_assignments WHERE membership_id='{membership}');",
            f"SELECT DISTINCT r.id,r.is_active FROM roles r JOIN role_assignments a ON a.role_id=r.id WHERE a.membership_id='{membership}'",
            lambda row: f"UPDATE roles SET is_active={'true' if row['is_active'] else 'false'} WHERE id={literal(row['id'])};")
    mutated("data-scope-expired-live-session",
            f"UPDATE role_assignment_data_policy_scopes SET valid_until=now()-interval '1 minute' WHERE role_assignment_id IN ({owned}) AND policy_code='management-aset.asset-responsibility';",
            f"SELECT id,valid_until FROM role_assignment_data_policy_scopes WHERE role_assignment_id IN ({owned}) AND policy_code='management-aset.asset-responsibility'",
            lambda row: f"UPDATE role_assignment_data_policy_scopes SET valid_until={literal(row['valid_until'])} WHERE id={literal(row['id'])};")
    mutated("membership-revoked-live-session", f"UPDATE tenant_memberships SET status='inactive' WHERE id='{membership}';",
            f"SELECT id,status FROM tenant_memberships WHERE id='{membership}'",
            lambda row: f"UPDATE tenant_memberships SET status={literal(row['status'])} WHERE id={literal(row['id'])};")
    observe("membership-restored")
    # Margin 60 detik di kedua sisi lifetime 120 menit; ::integer membulatkan, jadi -7201 jatuh tepat di batas detik.
    run(f"UPDATE sessions SET last_activity=floor(extract(epoch FROM now()))::integer-7140 WHERE user_id={user_id};")
    observe("database-session-near-lifetime")
    run(f"UPDATE sessions SET last_activity=floor(extract(epoch FROM now()))::integer-7260 WHERE user_id={user_id};")
    observe("database-session-expired")
    client.login(account, password)
    run(f"DELETE FROM sessions WHERE user_id={user_id};")
    observe("database-session-deleted")
    client.login(account, password)
    observe("new-session-after-revocation")
    return observed


def rollback(base: str, fixture: dict, password: str, lab: Lab, database: str) -> list[dict]:
    """INSERT posting yang gagal di tengah completion wajib membatalkan claim, aset, nomor aset, dan posting."""
    account = fixture["accounts"][1]
    tenant = next(item for item in fixture["tenants"] if item["tenant_id"] == account["tenant_id"])
    client = Client(base)
    client.login(account, password)
    receipts = "/api/modules/" + fixture["module_id"] + "/v1/penerimaan-aset"
    created = client.request("POST", receipts, tenant["receipt_body"], {"Idempotency-Key": "conformance-rollback-" + uuid.uuid4().hex})
    observed = [{"probe": "rollback-create", "status": created.status}]
    receipt = created.body["data"]
    if not ids.UUID.fullmatch(receipt["id"]):
        raise ValueError("Receipt ID is not a canonical UUID.")
    state = f"""SELECT json_build_object('status',r.status,'version',r.version,
      'assets',(SELECT count(*) FROM aset_tr_aset a WHERE a.penerimaan_aset_id=r.id),
      'postings',(SELECT count(*) FROM finance_postings p WHERE p.source_id=r.id::text),
      'asset_numbers',(SELECT count(*) FROM number_sequence_issues i WHERE i.idempotency_key LIKE 'aset:penerimaan:'||r.id||':%'))
      FROM aset_tr_penerimaan_aset r WHERE r.id='{receipt['id']}';"""
    before = json.loads(lab.sql(state, database))
    lab.sql(f"ALTER TABLE finance_postings ADD CONSTRAINT conformance_reject_posting CHECK (posting_id <> 'AST-ACQ-{receipt['id']}') NOT VALID;", database)
    try:
        failed = client.request("POST", receipts + "/" + receipt["id"] + "/selesaikan", {"version": receipt["version"]})
        observed.append({"probe": "rollback-posting-insert-fails", "status": failed.status, "body": failed.body})
        observed.append({"probe": "rollback-no-partial-effect", "before": before, "after": json.loads(lab.sql(state, database))})
    finally:
        lab.sql("ALTER TABLE finance_postings DROP CONSTRAINT conformance_reject_posting;", database)
    retried = client.request("POST", receipts + "/" + receipt["id"] + "/selesaikan", {"version": receipt["version"]})
    assets = client.request("GET", receipts + "/" + receipt["id"] + "/aset")
    observed.append({"probe": "rollback-retry-completes", "status": retried.status, "version": retried.body.get("data", {}).get("version")})
    observed.append({"probe": "rollback-asset-codes", "status": assets.status, "codes": sorted(asset["kode"] for asset in assets.body.get("data", []))})
    return observed


def throttle(base: str) -> list[dict]:
    """Limiter login Fortify: percobaan gagal untuk satu email dan IP dihitung, lalu ditolak dengan petunjuk tunggu."""
    client = Client(base)
    client.request("GET", "/login")
    observed = []
    email = f"throttle-{uuid.uuid4().hex}@parity.example.invalid"
    for attempt in range(1, 7):
        result = client.request("POST", "/login", {"email": email, "password": "wrong-password"})
        headers = {key.lower(): value for key, value in result.headers.items()}
        body = result.body if isinstance(result.body, dict) else {}
        # Nilai limit/remaining pasti; retry-after dan reset bergantung jam, jadi hanya keberadaannya.
        observed.append({"probe": f"login-throttle-{attempt}", "status": result.status,
                         "limit": headers.get("x-ratelimit-limit"), "remaining": headers.get("x-ratelimit-remaining"),
                         "timed_headers": sorted(header for header in headers if header in {"retry-after", "x-ratelimit-reset"}),
                         "message": re.sub(r"\d+", "#", str(body.get("message"))),
                         "errors": {field: [re.sub(r"\d+", "#", message) for message in messages] for field, messages in body.get("errors", {}).items()}})
    return observed


def compare(expected: dict, actual: dict) -> list[dict]:
    """`expected` adalah hasil CoreERP sesudah ids.normalize."""
    differences = []
    for section in [name for name in SECTIONS if name in expected and name in actual]:
        left, right = expected[section], actual[section]
        if section == "http":
            left, right = left["events"], right["events"]
        if len(left) != len(right):
            differences.append({"path": section + ".length", "expected": len(left), "actual": len(right)})
        for index, (a, b) in enumerate(zip(left, right)):
            # Pemenang race sudah diwajibkan tepat satu 200; status pihak kalah (409/422) bergantung waktu.
            if a.get("probe") == b.get("probe") == "completion-race":
                continue
            if a != b:
                differences.append({"path": f"{section}[{index}]", "expected": a, "actual": b})
    return differences


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", required=True, type=Path)
    parser.add_argument("--image", required=True)
    parser.add_argument("--template", required=True, help="Database seed uuid yang di-clone untuk run ini.")
    parser.add_argument("--database", required=True, help="Nama clone baru; tidak boleh sudah ada.")
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--expected", required=True, type=Path, help="Hasil conformance CoreERP.")
    parser.add_argument("--output", required=True, type=Path, help="Folder evidence baru.")
    parser.add_argument("--sections", nargs="+", choices=SECTIONS, default=SECTIONS)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise SystemExit("Evidence folder is not empty; a run never overwrites earlier evidence.")
    args.output.mkdir(parents=True, exist_ok=True)
    lab = Lab.load(args.lab)
    fixture, _ = load_fixture(args.fixture)
    password = fixture_password(args.env)
    lab.clone(args.template, args.database)
    started = candidate.start(lab, args.image, args.database, args.env)
    base = started["base"]
    probes = {"http": lambda: http_probes(base, fixture, password),
              "revocation": lambda: revocation(base, fixture, password, lab, args.database),
              "rollback": lambda: rollback(base, fixture, password, lab, args.database),
              "throttle": lambda: throttle(base)}
    try:
        report = {"database": args.database, "base": base, "runtime": started, **{section: probes[section]() for section in args.sections}}
    finally:
        (args.output / "container.log").write_text(candidate.stop(), encoding="utf-8")
    report["differences"] = compare(ids.normalize(json.loads(args.expected.read_text(encoding="utf-8"))), report)
    report["verdict"] = "NOT VERIFIED" if report["differences"] else "VERIFIED"
    (args.output / "conformance.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    counts = {section: len(report[section]["events"] if section == "http" else report[section]) for section in args.sections}
    print(json.dumps({"verdict": report["verdict"], "differences": len(report["differences"]), **counts}))
    if report["differences"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
