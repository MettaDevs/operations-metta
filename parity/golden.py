"""Satu golden run operations-metta: clone seed uuid, rekam baseline, alur HTTP bertrace, lalu keempat gate.

Gate: respons HTTP, oracle SQL, graph posting, dan kewajiban SQL, masing-masing terhadap bukti CoreERP yang
sama. Verdict VERIFIED hanya bila keenam langkah keluar 0.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

import candidate
from lab import Lab

HERE = Path(__file__).resolve().parent


def tool(name: str, *args: str | Path) -> dict:
    result = subprocess.run([sys.executable, "-B", str(HERE / name), *map(str, args)], capture_output=True, text=True)
    return {"tool": name, "exit": result.returncode, "last_line": (result.stdout.strip().splitlines() or [""])[-1],
            "stderr_tail": result.stderr.strip()[-1500:]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", required=True, type=Path)
    parser.add_argument("--image", required=True)
    parser.add_argument("--template", required=True, help="Database seed uuid yang di-clone untuk run ini.")
    parser.add_argument("--database", required=True, help="Nama clone baru; tidak boleh sudah ada.")
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--expected-flow", required=True, type=Path, help="Flow CoreERP pada run-id yang sama.")
    parser.add_argument("--expected-traces", required=True, type=Path, help="Folder trace CoreERP dari flow yang sama.")
    parser.add_argument("--expected-database", required=True, help="Database CoreERP sesudah flow yang sama.")
    parser.add_argument("--coreerp-baseline", required=True, type=Path, help="Baseline seed CoreERP (ULID).")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output", required=True, type=Path, help="Folder evidence baru.")
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise SystemExit("Evidence folder is not empty; a golden run never overwrites earlier evidence.")
    args.output.mkdir(parents=True, exist_ok=True)
    lab = Lab.load(args.lab)
    lab.clone(args.template, args.database)
    flow, traces, baseline = args.output / "flow.json", args.output / "traces", args.output / "baseline.json"
    steps = [tool("sql_oracle.py", "baseline", "--lab", args.lab, "--database", args.database, "--template", args.template,
                  "--coreerp-baseline", args.coreerp_baseline, "--output", baseline)]
    started = None
    if steps[0]["exit"] == 0:
        lab.reset_statistics()
        started = candidate.start(lab, args.image, args.database, args.env)
        try:
            steps.append(tool("http_baseline.py", "--base", started["base"], "--fixture", args.fixture, "--env", args.env,
                              "--output", flow, "--run-id", args.run_id, "--lab", args.lab, "--trace-database", args.database,
                              "--trace-directory", traces))
        finally:
            (args.output / "container.log").write_text(candidate.stop(), encoding="utf-8")
    if len(steps) == 2 and steps[1]["exit"] == 0:
        steps += [
            tool("compare_http.py", "--expected", args.expected_flow, "--actual", flow, "--output", args.output / "http.json"),
            tool("sql_oracle.py", "check", "--lab", args.lab, "--fixture", args.fixture, "--database", args.database,
                 "--baseline", baseline, "--acknowledgements", flow, "--output", args.output / "oracle.json"),
            tool("compare_posting.py", "--lab", args.lab, "--expected-database", args.expected_database, "--actual-database", args.database,
                 "--expected-http", args.expected_flow, "--actual-http", flow, "--output", args.output / "posting.json"),
            tool("compare_queries.py", "--expected", args.expected_traces, "--actual", traces, "--output", args.output / "queries.json"),
        ]
    summary = {"verdict": "VERIFIED" if len(steps) == 6 and all(step["exit"] == 0 for step in steps) else "NOT VERIFIED",
               "template": args.template, "runtime": started, "steps": steps}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": summary["verdict"], "steps": [(step["tool"], step["exit"]) for step in steps]}))
    if summary["verdict"] != "VERIFIED":
        raise SystemExit(1)
