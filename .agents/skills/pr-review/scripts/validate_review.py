#!/usr/bin/env python3
"""Check review coverage and inline anchors without publishing anything."""

import argparse
import copy
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


SCOPE_CHECKS = {
    "database_reads": {"n_plus_one", "payload_and_batch_bounds"},
    "ui_lists": {"datatable_incremental", "load_error_states"},
    "ui_forms": {"error_header_and_fields", "shared_capability_ownership"},
    "api_endpoints": {"authorization_and_input", "shared_capability_ownership"},
    "security_changes": {"authorization_and_input"},
    "lifecycle": {"numbering_concurrency_soft_delete", "shared_capability_ownership"},
    "contracts": {"contracts_and_docs"},
}
BASE_CHECKS = {"scope", "behavior", "code_quality", "verification"}
STATUSES = {"verified", "finding", "source_only", "not_applicable"}


def has_text(value):
    return isinstance(value, str) and bool(value.strip())


def has_evidence(value):
    return isinstance(value, list) and bool(value) and all(map(has_text, value))


def is_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.netloc) and bool(parsed.path)


def added_lines(patch):
    result = {}
    path = None
    line = None
    for row in patch.splitlines():
        if row.startswith("+++ "):
            path = row[4:]
            if path.startswith('"'):
                path = json.loads(path)
            path = path[2:] if path.startswith("b/") else path
            result.setdefault(path, set())
            line = None
        elif row.startswith("@@ "):
            match = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", row)
            if not match:
                raise ValueError("Unsupported diff hunk. Use a unified git diff.")
            line = int(match[1])
        elif line is not None and row.startswith("+"):
            result[path].add(line)
            line += 1
        elif line is not None and row.startswith(" "):
            line += 1
    return result


def validate_review(review, patch=None):
    issues = []
    if not isinstance(review, dict):
        return ["Review must be a JSON object."]
    metadata = review.get("metadata", {})
    if not isinstance(metadata, dict):
        return ["metadata must be an object."]
    if not has_text(metadata.get("repository")):
        issues.append("metadata.repository is required.")
    if type(metadata.get("number")) is not int or metadata["number"] < 1:
        issues.append("metadata.number must identify the PR.")
    for key in ("head_sha", "base_sha"):
        if not re.fullmatch(r"[a-fA-F0-9]{40}", str(metadata.get(key, ""))):
            issues.append(f"metadata.{key} must pin a full commit SHA.")

    scope = review.get("scope", {})
    if not isinstance(scope, dict):
        return issues + ["scope must be an object."]
    required = set(BASE_CHECKS)
    for flag, checks in SCOPE_CHECKS.items():
        if type(scope.get(flag)) is not bool:
            issues.append(f"scope.{flag} must be explicitly true or false.")
        elif scope[flag]:
            required.update(checks)

    findings = review.get("findings", [])
    if not isinstance(findings, list):
        return issues + ["findings must be an array."]
    ids = set()
    existing = review.get("existing_findings", [])
    if not isinstance(existing, list):
        return issues + ["existing_findings must be an array."]
    for known in existing:
        if not isinstance(known, dict):
            issues.append("Each existing finding must be an object.")
            continue
        identifier = known.get("id")
        if not has_text(identifier) or identifier in ids:
            issues.append("Every existing finding needs a distinct nonempty id.")
        else:
            ids.add(identifier)
        if not is_url(known.get("thread_url")) or not has_evidence(known.get("evidence")):
            issues.append("Existing findings need an inspected thread_url and evidence.")
    anchors = added_lines(patch) if patch is not None else None
    for finding in findings:
        if not isinstance(finding, dict):
            issues.append("Each finding must be an object.")
            continue
        identifier = finding.get("id")
        if not has_text(identifier) or identifier in ids:
            issues.append("Every finding needs a distinct nonempty id.")
        elif identifier:
            ids.add(identifier)
        label = identifier or "finding"
        for key in ("title", "path", "impact", "fix"):
            if not has_text(finding.get(key)):
                issues.append(f"{label}.{key} is required.")
        if finding.get("priority") not in {"P0", "P1", "P2", "P3"}:
            issues.append(f"{label}.priority must be P0/P1/P2/P3.")
        if type(finding.get("line")) is not int or finding["line"] < 1:
            issues.append(f"{label}.line must be a positive source line.")
        if not has_evidence(finding.get("evidence")):
            issues.append(f"{label}.evidence must identify source or reproduction.")
        if not is_url(finding.get("pattern_url")):
            issues.append(f"{label}.pattern_url must link an inspected pattern.")
        docs = finding.get("documentation_urls")
        if not isinstance(docs, list) or not docs or not all(map(is_url, docs)):
            issues.append(f"{label}.documentation_urls must link reading material.")
        if anchors is not None and finding.get("line") not in anchors.get(finding.get("path"), set()):
            issues.append(f"{label} is not anchored to an added line in this diff.")

    checks = review.get("checks", {})
    if not isinstance(checks, dict):
        return issues + ["checks must be an object."]
    for name in sorted(required - checks.keys()):
        issues.append(f"Missing check {name}; inspect it or record source_only with limits.")
    for name, check in checks.items():
        if not isinstance(check, dict) or check.get("status") not in STATUSES:
            issues.append(f"{name} needs an explicit supported status.")
            continue
        status = check["status"]
        if status == "not_applicable":
            if name in required:
                issues.append(f"{name} is required by scope and cannot be not_applicable.")
            if not has_text(check.get("reason")):
                issues.append(f"{name} needs a reason for not_applicable.")
            continue
        if not has_evidence(check.get("evidence")):
            issues.append(f"{name} needs evidence.")
        if status == "finding":
            linked = check.get("finding_ids")
            if not isinstance(linked, list) or not linked or any(item not in ids for item in linked):
                issues.append(f"{name} must reference existing finding_ids.")
        if status == "source_only":
            if not has_text(check.get("reason")) or not has_evidence(review.get("limitations")):
                issues.append(f"{name} needs a reason and review limitations.")
        if name == "shared_capability_ownership" and status in {"verified", "finding"}:
            ownership = check.get("ownership", {})
            if not isinstance(ownership, dict):
                issues.append("shared_capability_ownership.ownership must be an object.")
                continue
            if not has_text(ownership.get("resource")) or type(ownership.get("needed_without_module")) is not bool:
                issues.append("Ownership needs a named resource and explicit needed_without_module decision.")
            for key in ("current_owner", "target_owner"):
                if ownership.get(key) not in {"foundation", "platform", "module"}:
                    issues.append(f"Ownership {key} must identify foundation/platform/module.")
            if ownership.get("needed_without_module") is True:
                if ownership.get("target_owner") == "module":
                    issues.append("Required shared capability cannot target the module it must work without; route it to Core.")
                if ownership.get("current_owner") == "module" and status == "verified":
                    issues.append("Module-owned required shared capability is not cleared; record the Core move as a finding.")
        if name == "n_plus_one" and status == "verified":
            measure = check.get("measurement", {})
            if not isinstance(measure, dict):
                issues.append("n_plus_one.measurement must be an object.")
                continue
            parents = measure.get("parent_counts", [])
            queries = measure.get("query_counts", [])
            valid_parents = isinstance(parents, list) and len(parents) >= 2 and all(type(n) is int and n > 0 for n in parents)
            if not valid_parents or len(set(parents)) < 2:
                issues.append("n_plus_one needs at least two distinct positive parent counts.")
            if not isinstance(queries, list) or len(queries) != len(parents) or not all(type(n) is int and n >= 0 for n in queries):
                issues.append("n_plus_one query counts must match the measured parent counts.")
            if measure.get("includes_serialization") is not True or not has_text(measure.get("environment")):
                issues.append("n_plus_one needs serialized-response measurements and environment limits.")
    return issues


def validate_publication(review, publication):
    if not isinstance(publication, dict):
        return ["publication must contain the structured tool/API payload."]
    issues = []
    metadata = review["metadata"]
    if publication.get("commit_id") != metadata["head_sha"]:
        issues.append("Publication commit_id must match the reviewed head_sha.")
    if publication.get("repo_full_name") != metadata["repository"] or publication.get("pr_number") != metadata["number"]:
        issues.append("Publication must target the reviewed repository and PR.")
    comments = publication.get("file_comments", [])
    if not isinstance(comments, list) or not all(isinstance(item, dict) for item in comments):
        return issues + ["Publication file_comments must be an array of objects."]
    for finding in review.get("findings", []):
        candidates = [item for item in comments if item.get("path") == finding["path"] and item.get("line") == finding["line"]]
        urls = [finding["pattern_url"], *finding["documentation_urls"]]
        if not any(all(url in str(item.get("body", "")) for url in urls) for item in candidates):
            issues.append(f"Publication inline {finding['id']} must include its inspected pattern and reading URLs at the reviewed anchor.")
    return issues


def self_test():
    scope = dict.fromkeys(SCOPE_CHECKS, False)
    scope.update(database_reads=True, ui_lists=True, ui_forms=True)
    required = BASE_CHECKS | SCOPE_CHECKS["database_reads"] | SCOPE_CHECKS["ui_lists"] | SCOPE_CHECKS["ui_forms"]
    sample = {
        "metadata": {"repository": "MettaDevs/operations-metta", "number": 344, "head_sha": "a" * 40, "base_sha": "b" * 40},
        "scope": scope,
        "checks": {key: {"status": "verified", "evidence": ["inspected artifact"]} for key in required},
        "findings": [],
    }
    sample["checks"]["n_plus_one"]["measurement"] = {
        "environment": "isolated PostgreSQL clone, triggers included", "parent_counts": [1, 10, 25],
        "query_counts": [4, 4, 4], "includes_serialization": True,
    }
    sample["checks"]["shared_capability_ownership"]["ownership"] = {
        "resource": "Module-specific process resource", "needed_without_module": False,
        "current_owner": "module", "target_owner": "module",
    }
    assert not validate_review(sample), validate_review(sample)
    cases = []
    documentation = copy.deepcopy(sample)
    documentation["scope"] = dict.fromkeys(SCOPE_CHECKS, False)
    documentation["checks"] = {key: documentation["checks"][key] for key in BASE_CHECKS}
    assert not validate_review(documentation)
    cases.append("allow a documentation-only scope without invented database tests")
    manifest = copy.deepcopy(documentation)
    manifest["scope"]["security_changes"] = True
    assert any("authorization_and_input" in issue for issue in validate_review(manifest))
    cases.append("require authorization coverage for manifest security changes")
    shared = copy.deepcopy(sample)
    shared["checks"]["shared_capability_ownership"]["ownership"].update(resource="Payment Method", needed_without_module=True)
    assert any("route it to Core" in issue for issue in validate_review(shared))
    cases.append("reject a shared master kept behind a module purchase")
    shared["checks"]["shared_capability_ownership"]["ownership"]["target_owner"] = "foundation"
    assert any("not cleared" in issue for issue in validate_review(shared))
    cases.append("reject clearing a required Core move before source ownership changes")
    for key in ("n_plus_one", "payload_and_batch_bounds", "datatable_incremental", "error_header_and_fields", "code_quality"):
        broken = copy.deepcopy(sample)
        del broken["checks"][key]
        assert any(key in issue for issue in validate_review(broken)), key
        cases.append(f"reject omitted {key}")
    broken = copy.deepcopy(sample)
    broken["checks"]["datatable_incremental"] = {"status": "not_applicable", "reason": "not checked"}
    assert any("cannot be not_applicable" in issue for issue in validate_review(broken))
    cases.append("reject hiding an applicable list check")
    broken = copy.deepcopy(sample)
    del broken["checks"]["n_plus_one"]["measurement"]
    assert any("n_plus_one" in issue for issue in validate_review(broken))
    cases.append("reject unmeasured N+1 clearance")
    finding = {"id": "F1", "priority": "P2", "path": "example.tsx", "line": 1, "title": "Missing batch loader",
               "impact": "Later rows cannot be reached", "fix": "Use incremental cursor loading", "evidence": ["actual source"],
               "pattern_url": "https://example.com/pattern", "documentation_urls": ["https://example.com/docs"]}
    complete = copy.deepcopy(sample)
    complete["findings"] = [finding]
    complete["checks"]["datatable_incremental"].update(status="finding", finding_ids=["F1"])
    patch = "diff --git a/example.tsx b/example.tsx\n--- a/example.tsx\n+++ b/example.tsx\n@@ -0,0 +1 @@\n+new line\n"
    assert not validate_review(complete, patch)
    for key in ("pattern_url", "documentation_urls"):
        broken = copy.deepcopy(complete)
        del broken["findings"][0][key]
        assert any(key in issue for issue in validate_review(broken, patch))
        cases.append(f"reject finding without {key}")
    complete["findings"][0]["line"] = 2
    assert any("added line" in issue for issue in validate_review(complete, patch))
    cases.append("reject an inline anchor outside the diff")
    complete["findings"][0]["line"] = 1
    publication = {"repo_full_name": "MettaDevs/operations-metta", "pr_number": 344, "commit_id": "a" * 40,
                   "file_comments": [{"path": "example.tsx", "line": 1,
                                      "body": "Pattern https://example.com/pattern. Read https://example.com/docs."}]}
    assert not validate_publication(complete, publication)
    followup = copy.deepcopy(sample)
    followup["existing_findings"] = [{"id": "OLD1", "thread_url": "https://example.com/pull/123#discussion_r1", "evidence": ["inspected owning PR/thread"]}]
    followup["checks"]["datatable_incremental"].update(status="finding", finding_ids=["OLD1"])
    assert not validate_review(followup, patch)
    assert not validate_publication(followup, {**publication, "file_comments": []})
    cases.append("allow existing-thread coverage without reposting inherited inline findings")
    publication["file_comments"][0]["body"] = "Please fix this without source or docs."
    assert validate_publication(complete, publication)
    cases.append("reject an actual inline payload that omits pattern/docs")
    publication["commit_id"] = "c" * 40
    assert any("head_sha" in issue for issue in validate_publication(complete, publication))
    cases.append("reject a publication pinned to a different head")
    for case in cases:
        print(f"PASS {case}")
    print("PASS complete coverage and valid anchors; coverage is not proof of code correctness.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", nargs="?", type=Path)
    parser.add_argument("--diff", type=Path)
    parser.add_argument("--publication", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if args.review is None:
        parser.error("provide review.json or --self-test")
    try:
        review = json.loads(args.review.read_text(encoding="utf-8-sig"))
        patch = args.diff.read_text(encoding="utf-8-sig") if args.diff else None
        issues = validate_review(review, patch)
        if not issues and args.publication:
            publication = json.loads(args.publication.read_text(encoding="utf-8-sig"))
            issues.extend(validate_publication(review, publication))
    except (OSError, ValueError, TypeError) as error:
        print(f"Invalid review input: {error}")
        return 2
    if issues:
        for issue in issues:
            print(f"FAIL {issue}")
        return 1
    source_only = [name for name, value in review["checks"].items() if value["status"] == "source_only"]
    print("PASS review coverage, finding references and supplied inline anchors.")
    if source_only:
        print("Source-only limits remain: " + ", ".join(source_only))
    print("This does not verify evidence truth, publish a review, approve code or authorize merge.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
