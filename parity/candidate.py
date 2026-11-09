"""Jalankan image operations-metta di jaringan lab.

Budget, port internal, dan environment sama dengan kandidat `operations` di eksperimen pembanding stack:
2 CPU, 1 GiB, nofile 65536, dua proses Bun reusePort dengan pool 4 koneksi masing-masing.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

from lab import Lab

PROCESSES = 2
CONTAINER = "operations-metta-parity"
SECRETS = ["DB_PASSWORD", "APP_KEY"]


def docker(*args: str, environment: dict | None = None) -> str:
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True, env=environment).stdout.strip()


def listening() -> int:
    logs = subprocess.run(["docker", "logs", CONTAINER], capture_output=True, text=True)
    return (logs.stdout + logs.stderr).count('"event":"listening"')


def start(lab: Lab, image: str, database: str, runtime_env: Path) -> dict:
    lab.validate_database(database)
    environment = dict(os.environ)
    for line in runtime_env.read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        if key in SECRETS:
            environment[key] = value
    settings = {"DB_HOST": lab.database_host, "DB_PORT": "5432", "DB_USERNAME": lab.postgres_user, "DB_DATABASE": database,
                "HOST": "0.0.0.0", "PORT": "8000", "DB_POOL_SIZE": str(8 // PROCESSES)}
    arguments = ["run", "-d", "--name", CONTAINER, "--network", lab.network, "--cpus", "2", "--memory", "1g",
                 "--ulimit", "nofile=65536:65536", "-p", f"127.0.0.1:{lab.candidate_port}:8000"]
    for key, value in settings.items():
        arguments += ["-e", f"{key}={value}"]
    # Secret diteruskan lewat environment proses docker, bukan argumen, supaya tidak tampil di daftar proses.
    for key in SECRETS:
        arguments += ["-e", key]
    command = ["sh", "-c", f"for i in $(seq {PROCESSES}); do bun dist/main.js & done; wait"]
    container = docker(*arguments, image, *command, environment=environment)
    base = f"http://127.0.0.1:{lab.candidate_port}"
    deadline = time.monotonic() + 30
    while True:
        try:
            with urllib.request.urlopen(base + "/up", timeout=2):
                break
        except urllib.error.HTTPError as error:
            if error.code < 500:
                break
        except OSError:
            pass
        if time.monotonic() > deadline:
            raise SystemExit("Candidate did not answer HTTP within 30 seconds:\n" + stop())
        time.sleep(0.25)
    # Dua proses berbagi port lewat reusePort; satu respons belum membuktikan proses kedua siap.
    while listening() < PROCESSES:
        if time.monotonic() > deadline:
            raise SystemExit("Only part of the candidate processes started within 30 seconds:\n" + stop())
        time.sleep(0.25)
    inspect = json.loads(docker("inspect", container))[0]
    return {"container": container[:12], "image": image, "image_id": inspect["Image"], "database": database, "base": base,
            "settings": settings, "cpus": 2, "memory": "1g", "nofile": 65536, "processes": PROCESSES}


def stop() -> str:
    logs = subprocess.run(["docker", "logs", "--tail", "200", CONTAINER], capture_output=True, text=True)
    subprocess.run(["docker", "rm", "-f", CONTAINER], check=True, capture_output=True)
    return logs.stdout + logs.stderr


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    clone = actions.add_parser("clone", help="Buat database baru dari template, misalnya seed yang sudah dikonversi.")
    clone.add_argument("--lab", required=True, type=Path)
    clone.add_argument("--template", required=True)
    clone.add_argument("--database", required=True)
    up = actions.add_parser("up")
    up.add_argument("--lab", required=True, type=Path)
    up.add_argument("--image", required=True)
    up.add_argument("--database", required=True)
    up.add_argument("--env", required=True, type=Path, help="runtime.env lab: DB_PASSWORD dan APP_KEY.")
    actions.add_parser("down")
    args = parser.parse_args()
    if args.action == "clone":
        Lab.load(args.lab).clone(args.template, args.database)
        print(json.dumps({"database_created": args.database, "template": args.template}))
    elif args.action == "up":
        print(json.dumps(start(Lab.load(args.lab), args.image, args.database, args.env)))
    else:
        print(stop())
