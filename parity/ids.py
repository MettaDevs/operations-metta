"""ULID dan id pengguna CoreERP lawan uuid operations-metta: nilai yang sama dalam dua bentuk teks.

Bukti CoreERP (flow HTTP, graph posting, fixture) menyimpan ULID dan id pengguna bigint, sedangkan kandidat
membaca seed yang dikonversi `ulid_to_uuid` (migration 0002) dan `user_id_to_uuid` (migration 0003). Bukti itu
diterjemahkan ke uuid sebelum dibandingkan, dengan aturan kunci yang sama dengan konversi database: hanya nilai
di bawah kunci id yang berubah, nama dan teks bebas tidak.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import uuid

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID = re.compile(r"[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# Teks yang disusun dari id, dengan pemisah bagiannya, sama dengan daftar kolom teks di konversi skema 0002.
# location, url, dan reference hanya ada di respons dan input posting. Selain kunci ini, kunci id/*_id/*_ids
# berisi satu id utuh; posting_id(s) ("AST-ACQ-<id>") berpemisah '-'.
EMBEDDED = {"scope_key": "|:", "period_key": ":", "record_id": ",", "location": "/", "url": "/", "reference": ":"}
# Id pengguna dalam bentuk teks: angka desimal tanpa nol di depan dan di bawah 2^63, sama dengan migration 0003.
DECIMAL = re.compile(r"0|[1-9][0-9]{0,18}")
BIGINT_LIMIT = 1 << 63
# Kunci id pengguna selain user_id dan *_user_id: nama kolom id pengguna di katalog yang tidak berpola itu.
USER_KEYS = {"created_by", "updated_by", "requested_by", "sso_redeemed_by", "principal_id"}
# Teks yang disusun dari id pengguna, dengan pemisahnya, sama dengan tenant_creation_requests.actor_scope di 0003.
USER_EMBEDDED = {"actor_scope": ":"}


def is_user_id(value: object) -> bool:
    """Bilangan bulat atau teks angka di rentang bigint yang tidak negatif. Angka JSON dan teks diperiksa lewat teks
    desimalnya, sama dengan migration 0003."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return False
    text = str(value)
    return DECIMAL.fullmatch(text) is not None and int(text) < BIGINT_LIMIT


def user_id_to_uuid(value: int) -> str:
    """Id pengguna n menjadi uuid bernilai n: 64 bit atas nol, n di 64 bit bawah. Sama dengan fungsi SQL di 0003."""
    if not isinstance(value, int) or not is_user_id(value):
        raise ValueError(f"Not a user ID: {value!r}")
    return str(uuid.UUID(int=value))


def uuid_to_user_id(value: str) -> int:
    if not UUID.fullmatch(value.lower()):
        raise ValueError(f"Not a UUID: {value!r}")
    number = uuid.UUID(value).int
    if number >= BIGINT_LIMIT:
        raise ValueError(f"Not a converted user ID: {value!r}")
    return number


def user_id_key(key: str) -> bool:
    key = key.lower()
    return key == "user_id" or key.endswith("_user_id") or key in USER_KEYS


def ulid_to_uuid(value: str) -> str:
    if not ULID.fullmatch(value):
        raise ValueError(f"Not a ULID: {value!r}")
    number = 0
    for character in value.upper():
        number = number * 32 + CROCKFORD.index(character)
    return str(uuid.UUID(int=number))


def uuid_to_ulid(value: str) -> str:
    if not UUID.fullmatch(value.lower()):
        raise ValueError(f"Not a UUID: {value!r}")
    number = uuid.UUID(value).int
    return "".join(CROCKFORD[(number >> shift) & 31] for shift in range(125, -1, -5))


def separators(key: str) -> str | None:
    key = key.lower()
    if key.endswith(("posting_id", "posting_ids")):
        return "-"
    if key in EMBEDDED:
        return EMBEDDED[key]
    if key == "id" or key.endswith(("_id", "_ids")):
        return ""
    return None


def convert(value: str, separator: str) -> str:
    parts = re.split(f"([{re.escape(separator)}])", value) if separator else [value]
    return "".join(ulid_to_uuid(part) if ULID.fullmatch(part) else part for part in parts)


def convert_user_ids(value: str, separator: str) -> str:
    parts = re.split(f"([{re.escape(separator)}])", value)
    return "".join(user_id_to_uuid(int(part)) if is_user_id(part) else part for part in parts)


def normalize(value: object, key: str | None = None) -> object:
    if isinstance(value, dict):
        return {name: normalize(item, name) for name, item in value.items()}
    if isinstance(value, list):
        return [normalize(item, key) for item in value]
    if key is not None and user_id_key(key) and is_user_id(value):
        return user_id_to_uuid(int(value))
    if key is not None and isinstance(value, str) and key.lower() in USER_EMBEDDED:
        value = convert_user_ids(value, USER_EMBEDDED[key.lower()])
    rule = separators(key) if isinstance(value, str) and key is not None else None
    return value if rule is None else convert(value, rule)


def normalize_row(table: str, row: dict) -> dict:
    """Satu baris tabel CoreERP. users.id adalah id pengguna walau kuncinya hanya id."""
    normalized = normalize(row)
    if table == "users" and is_user_id(row.get("id")):
        normalized["id"] = user_id_to_uuid(int(row["id"]))
    return normalized


def normalize_flow(run: dict) -> dict:
    """Akun dan respons berasal dari seed; identitas run (fixture_id, run_id, hash) tetap seperti aslinya."""
    return {**run, **{key: normalize(run[key]) for key in ("account", "events") if key in run}}


def normalize_fixture(fixture: dict) -> dict:
    return {**fixture, **{key: normalize(fixture[key]) for key in ("accounts", "probe_accounts", "tenants") if key in fixture}}


def changes(before: object, after: object, path: str = "$") -> list[tuple[str, str, str]]:
    if isinstance(before, dict) and isinstance(after, dict):
        return [change for key in before for change in changes(before[key], after[key], f"{path}.{key}")]
    if isinstance(before, list) and isinstance(after, list):
        return [change for item, other in zip(before, after) for change in changes(item, other, path + "[]")]
    return [(path, before, after)] if before != after else []


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tulis bukti CoreERP dalam bentuk uuid, untuk diperiksa atau dipakai ulang.")
    parser.add_argument("kind", choices=["flow", "fixture"])
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = json.loads(args.input.read_text(encoding="utf-8"))
    result = normalize_flow(source) if args.kind == "flow" else normalize_fixture(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    converted = Counter(path for path, _, _ in changes(source, result))
    print(json.dumps({"converted": sum(converted.values()), "paths": converted}))
