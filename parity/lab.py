"""Lab uji: cluster PostgreSQL yang diakses lewat docker exec, ditambah observer pg_stat_statements.

Nama container, user, jaringan, dan awalan database lab datang dari berkas lab JSON di luar repo, karena
repo ini publik. Contoh isinya ada di README.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import subprocess


class SqlError(RuntimeError):
    pass


@dataclass(frozen=True)
class Lab:
    postgres_container: str
    postgres_user: str
    network: str
    database_host: str
    database_prefix: str
    candidate_port: int

    @classmethod
    def load(cls, path: Path) -> Lab:
        return cls(**json.loads(path.read_text(encoding="utf-8")))

    def validate_database(self, database: str) -> None:
        # Nama database masuk ke teks SQL, jadi bentuknya dibatasi di sini, bukan di setiap pemanggil.
        if re.fullmatch(re.escape(self.database_prefix) + r"[a-z0-9_]+", database) is None or len(database) > 63:
            raise ValueError(f"Database {database!r} is outside the lab namespace {self.database_prefix!r}.")

    def sql(self, statement: str, database: str = "postgres") -> str:
        result = subprocess.run(
            ["docker", "exec", "-i", self.postgres_container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
             "-U", self.postgres_user, "-d", database],
            input=statement, capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise SqlError(f"psql on {database} exited {result.returncode}: {result.stderr.strip()[-2000:]}")
        return result.stdout.strip()

    def clone(self, template: str, database: str) -> None:
        for name in [template, database]:
            self.validate_database(name)
        if self.sql(f"SELECT count(*) FROM pg_database WHERE datname='{database}';") != "0":
            raise SystemExit(f"Database {database} already exists; the harness never overwrites or drops a database.")
        self.sql(f'CREATE DATABASE "{database}" TEMPLATE "{template}";')

    def reset_statistics(self) -> None:
        # Cluster lab memuat puluhan clone; tanpa reset, pg_stat_statements.max mengusir fingerprint di tengah trace.
        self.sql("SELECT pg_stat_statements_reset();")

    def snapshot(self, database: str) -> list[dict]:
        self.validate_database(database)
        statement = """
            SELECT coalesce(json_agg(row_to_json(s)), '[]'::json) FROM (
              SELECT queryid::text, query, calls, rows, total_exec_time, total_plan_time,
                     shared_blks_hit, shared_blks_read, wal_records, wal_bytes::text, toplevel
              FROM pg_stat_statements
              WHERE dbid = (SELECT oid FROM pg_database WHERE datname='__DATABASE__')
              ORDER BY toplevel DESC, calls DESC, queryid
            ) s;
        """
        return json.loads(self.sql(statement.replace("__DATABASE__", database)))


def difference(before: list[dict], after: list[dict]) -> list[dict]:
    previous = {(row["queryid"], row["toplevel"]): row for row in before}
    current_keys = {(row["queryid"], row["toplevel"]) for row in after}
    if any(key not in current_keys and row["calls"] > 0 for key, row in previous.items()):
        raise RuntimeError("SQL fingerprint disappeared: statistics were reset or evicted, so the capture is invalid.")
    rows = []
    for row in after:
        old = previous.get((row["queryid"], row["toplevel"]), {})
        delta = dict(row)
        for key in ["calls", "rows", "total_exec_time", "total_plan_time", "shared_blks_hit", "shared_blks_read", "wal_records"]:
            delta[key] = row[key] - old.get(key, 0)
        delta["wal_bytes"] = str(int(row["wal_bytes"]) - int(old.get("wal_bytes", 0)))
        if delta["calls"] < 0:
            raise RuntimeError("Statistics were reset during the capture, so it is invalid.")
        if delta["calls"] > 0:
            rows.append(delta)
    return rows


def capture(output: Path, rows: list[dict], database: str) -> None:
    for row in rows:
        template = re.sub(r"\s+", " ", row["query"]).strip()
        row["fingerprint"] = hashlib.sha256(template.encode()).hexdigest()
        row["query"] = template
    output.parent.mkdir(parents=True, exist_ok=True)
    evidence = {
        "database": database,
        "scope": "dedicated cluster; pg_stat_statements.track=all",
        "top_level_calls": sum(row["calls"] for row in rows if row["toplevel"]),
        "nested_calls": sum(row["calls"] for row in rows if not row["toplevel"]),
        "timing_disclosure": "Parent execution time contains nested work. Do not add parent and nested durations.",
        "limitations": "Aggregated successful statements. Failed query and execution order need separate evidence. Other fixture activity contaminates a capture.",
        "queries": rows,
    }
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
