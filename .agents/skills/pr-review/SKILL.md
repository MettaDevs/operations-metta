---
name: pr-review
description: >
  Review a GitHub pull request against operations-metta's patterns (AGENTS.md,
  the operations-metta-* skills, CoreERP as behaviour reference), security, tenant
  and data boundaries, performance, UI behavior and code quality. Use for review
  PR, code review, review pull request, or a PR URL supplied for review. Produce evidenced findings and verified inline anchors; publish only
  within the user's authorization. CI monitoring alone uses the status workflow.
license: MIT
metadata:
  version: "1.2.0"
  category: code-review
---

# PR reviewer

Review the code and its behavior. Do not stop at build/lint status, a fixed finding
count, or the first useful issues. Keep review read-only unless the user also asks
for fixes. Preserve unrelated work and do not turn the owner's future feature
plans into work assigned to a PR author.

## Workflow

1. Read the applicable AGENTS.md and pin the PR head/base, description, changed
   files, commits, checks and existing discussions. Determine the owning PR for
   inherited changes in a stack.
2. Read [review criteria](references/review_criteria.md). Read only the relevant
   architecture/UI/React/TypeScript skills and canonical source. Existing
   asset-management code is an example, not permission to violate a newer rule.
   For a ported flow, CoreERP's behaviour is the reference. A flow that computes
   or records money or numbers needs the parity harness (`parity/`); a green
   test suite is not proof that such a flow is ported.
3. Trace the changed behavior through its real callers and boundaries. Check
   negative, empty, stale, retry and partial-input cases as applicable. Reproduce
   cheap concrete failures with actual code; distinguish measured, source-only,
   inferred and untested claims.
4. Record coverage using [review format](references/review-format.md). The record
   must include every check implied by the actual diff. A placeholder without
   database work does not require a fabricated N+1 test.
5. Prepare the human review and inline comments. Each actionable finding includes
   its scenario/impact, smallest complete fix, inspected asset-management/Core or
   equivalent owning-source pattern, and reading links. For this repository,
   explicitly cover lazy loading DataTable, current error header rules,
   query/payload bounds, tenant filtering through `Workspace`, and data retention
   when relevant.
6. Run the coverage validator below. A missing check must be investigated or
   recorded as source_only with an honest limitation; never silently omitted.
   Passing coverage does not mean the code is correct or ready to merge.
7. Before authorized posting, refresh the head. If it changed, re-evaluate the
   affected diff and comment anchors. Submit the chosen review action and inline
   comments together when supported. Verify the actual review state, comments,
   source/doc links and anchors after posting.

## Scope and evidence

- Separate direct defects from inherited ones. Reply to the owning existing
  thread when adding evidence; do not repost the same finding on every stacked PR.
  Record inspected prior threads under existing_findings, separately from new
  findings that need inline anchors and publication content.
- For business resources and shared capabilities, apply the architecture skill's
  availability-without-module gate. If another module must work without buying
  Procurement, its required common master/capability cannot be owned by Procurement.
  Route masters to `src/foundation/` and neutral engines to `src/platform/`. State the
  owning-source evidence, required move and an absent/disabled-module verification.
  Do not ask again where a resource belongs when canonical rules already decide it;
  reserve questions for unresolved business meaning/scope or an explicit exception.
- Audit query count and row/payload volume separately. One batched `in (...)`
  query can remove read N+1 while still overfetching. Per-child INSERTs are not
  automatically N+1. `TRACE_FILE` records every query per request with its
  fingerprint; use it to count. Measure serialization too before claiming a read
  path passed.
- DataTable uses lazy loading/incremental scroll with bounded server batches and
  cursor continuation (`incrementalList`), not numbered-page navigation. UI lazy
  loading and a service that queries once per row are different problems.
- Save errors belong below the active form header/toolbar and at its fields.
  List errors remain visible on the active list. Toast duration Infinity does not
  replace the current feedback pattern.
- Test partial rows and reopening edits when touching child data. Do not let
  filtering silently discard input or rebuild identity/category from editable
  labels. Check version/replay/soft-delete rules at the actual write boundary.
- Inspect `@operations-metta/ui` behavior before flagging a pattern. renderRows and
  native controls are not defects merely because another screen uses a different form.
- Check the repository gates the diff touches: `bun run check:boundaries` rules,
  test placement under `test/`, English names in code, soft delete with partial
  unique indexes, hand-written contracts, and nothing in the public repository
  that names a real server, IP, SSH user, secret, patient, or customer.
- Length, hook count, casts and repetition guide investigation. Explain the
  specific maintenance or behavior cost; keep optional cleanup P3. Do not demand
  speculative abstractions or a new framework.
- Explain what already follows the canonical design and what remains unverified.
  Lack of evidence is not proof of a bug, and an unchanged head is not a fixed PR.

## Collection and artifacts

Prefer sufficient connected GitHub tools. gh and git are supported fallbacks.
Use real tools and scripts available in this installation, not imaginary helpers.

Useful read-only commands:

```powershell
gh pr view NUMBER --repo OWNER/REPO --json title,body,headRefOid,baseRefOid,files,commits,statusCheckRollup
gh api repos/OWNER/REPO/pulls/NUMBER/comments --paginate
gh pr diff NUMBER --repo OWNER/REPO
```

Store metadata, diff, discussions, evidence, review.json, and pr/review.md,
pr/human.md, pr/inline.md in a local review directory. Existing script-generated
artifacts may be reused after checking the head. Do not overwrite application
source just to inspect a PR.

```powershell
python .agents/skills/pr-review/scripts/validate_review.py REVIEW/review.json --diff REVIEW/diff.patch
python .agents/skills/pr-review/scripts/validate_review.py REVIEW/review.json --diff REVIEW/diff.patch --publication REVIEW/post-review.json
python .agents/skills/pr-review/scripts/validate_review.py --self-test
```

The validator checks scope-implied coverage, measured N+1 clearance, findings with
pattern/docs, and supplied changed-line anchors. With --publication it also checks
the actual structured inline payload and pinned head. It does not verify that
evidence is truthful, fetch a live head, publish, approve or merge.

## Authorization and delivery

Drafting and local evidence work are allowed by a review request. Posting comments,
requesting changes or approving follows explicit user authorization and continuing
session scope. Natural-language authorization counts; /send and /send-decline are
not required magic words. Do not ask again for authorization already supplied.

Without authorization to post, deliver concrete drafts and findings. Do not post
merely because a skill was loaded. With authorization, finish the work and post
without an extra confirmation. Do not merge or implement changes unless requested.

For each posted comment, use a verified line in the current diff. Link examples to
an inspected revision and actual line; do not invent docs or a comparison pattern.
If no local pattern applies, say so and use the relevant primary documentation
instead of pretending one exists.

After a correction or missed criterion, audit the earlier reviews against the
criterion, distinguish initial coverage from later follow-up, add only missing
substantiated findings within scope, and update this workflow or its validator.
Do not claim a regression test or check succeeded unless it was run.
