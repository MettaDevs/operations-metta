---
name: operations-metta-docs
description: Write and maintain operations-metta developer documentation — `modules/<module>/README.md`, `parity/README.md`, `README.md`, `AGENTS.md`, `docs/design-system/`, contract descriptions in `contracts/`, and skill files. Use when adding or changing any of them, when documenting a feature, module, master, or process, when a feature is finished and needs its page, when wording Indonesian text with technical loanwords, or when auditing documentation for coverage, stale claims, or wording.
---

# operations-metta developer documentation

Documentation is written for the developer who will touch the code, not for the end user. A page explains **what is stored, which rules the code enforces, and why those rules exist** — never how to click through a screen. Docs, comments, and commit messages are written in Indonesian; names in code stay English (`AGENTS.md`, section Bahasa).

Where documentation lives in this repository:

| What | Where |
| --- | --- |
| Rules for working in the repository | `AGENTS.md` |
| A module's behaviour and the rules it enforces | `modules/<module>/README.md` (table Susunan repo in `AGENTS.md`) |
| The parity harness and its waivers | `parity/README.md` |
| Stack-neutral design: tokens, component behaviour, screen-to-database flows | `docs/design-system/` |
| Promises to callers outside the runtime | `contracts/`, including the gap statement in `info.description` |

The full pattern for a module page, its section order, and worked examples live in CoreERP at [`docs/apps/management-aset/pola-dokumen.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/apps/management-aset/pola-dokumen.md). Read it before writing a module README; this skill does not restate it, because a second copy of a style guide drifts from the first. CoreERP's `docs/` is the behaviour reference for flows not yet ported, not the description of this repository: never copy a CoreERP page here without checking every claim against this repository's code.

## Documentation is part of finishing, not a follow-up

A feature that passes every gate and ships without its page forces the next person to read services line by line to learn the rules it enforces. Those rules live in one person's head and in code comments, and both disappear when that person moves on.

CoreERP made this a stage with its own exit gate in [`docs/apps/membangun-app-baru.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/apps/membangun-app-baru.md). Treat a feature as unfinished until its module README describes it and every relative link in the changed pages resolves. This repository has no documentation build yet, so nothing fails on a dead link: check them yourself.

## Counts in prose go stale, and they contradict themselves

Two distinct failures, both common:

**Counting something that grows.** "Eight master data", "twenty-nine number references" — wrong within weeks, and a wrong document is worse than none. Point at the source instead: *"the routes are registered in `modules/asset-management/src/index.ts`"*. The same applies to column lists, permission lists, and package versions.

**A count that contradicts the list beneath it.** "Four endpoints, all under `/api/v1`" above a table of six. This is easy to introduce by editing the table and not the sentence, and easy to detect mechanically: compare each number word in prose against the table that follows it.

Prefer a sentence with no number at all. If a number genuinely helps, verify it against the list every time either changes.

## Do not translate English figures of speech word for word

This is the failure that survives review, because the result looks like Indonesian while meaning nothing:

| Wrong | Why | Write instead |
| --- | --- | --- |
| "jendelanya 300 detik" | *Time window*. In Indonesian a `jendela` is a window in a house | "batas selisihnya 300 detik" |
| "pemeriksa yang berteriak serigala" | *Cry wolf*. The fable is not a local proverb | "pemeriksa yang sering salah memberi peringatan" |
| "stempel karet" | *Rubber stamp* | "persetujuan yang hanya formalitas" |

Test it by reading the sentence aloud to someone who does not speak English. If they stop and ask what it means, rewrite it.

### Where the loanword boundary sits

Technical terms that name a thing stay as they are: `tenant_id`, endpoint, permission, idempotency, deploy, release, event, scope. Translating them makes the text harder to search against the code, not easier.

The same holds for protocol and integration vocabulary, and it holds on screens, in validation messages, and in `contracts/` as much as in documentation. The owner's rule: GET stays GET, POST stays POST, PUT stays PUT.

| Wrong | Write instead |
| --- | --- |
| "Mode Dorong", "Mode Tarik", "tarikan berikutnya" | push, pull, "pull berikutnya" |
| "cakupan `vendors.read`" | scope `vendors.read` |
| "awalan jenis posting" | prefix jenis posting |
| "rahasia penanda tangan", "tanda tangan HMAC" | signing secret, signature HMAC |
| "badan mentah", "stempel waktu", "kursor", "batas laju" | raw body, timestamp, cursor, rate limit |
| "mengakui posting" | mengirim ack |

The sentence around the term stays Indonesian: "Kirim ack setelah posting dibukukan", not a whole sentence switched to English. A business screen may still describe an effect in plain words instead of naming the mechanism — "Posting ini belum pernah sampai ke aplikasi finance" needs neither "pull" nor "tarik".

What gets replaced is the word with **no technical reason** that already has a plain equivalent — "artefak" becomes "berkas", "krusial" becomes an explanation of why it matters. And no architecture term reaches a business user's screen; CoreERP's forbidden list is in [`docs/onboarding/glosarium.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/onboarding/glosarium.md).

## Coverage is verified mechanically, never by feeling finished

"I think I covered everything" is not a result. Compare the code surface against the documentation and count what is missing. The dimensions that have actually caught gaps:

| Dimension | Source of truth |
| --- | --- |
| Endpoints | every procedure in the module's `*.routes.ts`, `*.internal.routes.ts`, and `*.integration.routes.ts`, as registered in its `src/index.ts` |
| Screens | every `.page.tsx` (none yet) |
| Business rules | `*.service.ts` and `*.posting.ts` in each feature folder |
| Tests | the module's `test/` folder — the page should say where to add one |
| Load-test scenarios | none in this repository yet; CoreERP's are in [`modules/apperp/management-aset/loadtest/`](https://github.com/MettaDevs/coreERP/tree/main/modules/apperp/management-aset/loadtest) |
| Contract files | `contracts/` |
| Live tables | migrations in `database/migrations/` and `modules/<module>/database/migrations/`, minus tables a later migration drops |
| Referenced files | every `path/to/file.ts` in the docs must exist |

Run the sweep, fix what it finds, then run it again. Repeat until two consecutive runs are clean — the first clean run is often clean because the check is wrong.

## Verify the checker before trusting the check

A checker that reports success is worth nothing until you have seen it fail on purpose. Both of these happened while writing CoreERP's asset documentation:

- A table-coverage check flagged a table as undocumented; the table had been dropped by a later migration and no longer existed.
- The fix then treated every `drop table` in a rollback path as a drop, so it silently discarded almost every table and reported "8 tables, all covered". That reads exactly like success.

Before believing a clean run, break something on purpose and confirm the check catches it. A silent pass from a broken checker is more dangerous than no checker, because it ends the search.

## Windows: PowerShell destroys UTF-8 in these files

`Set-Content` and `Out-File` in Windows PowerShell 5.1 read UTF-8 as the ANSI codepage and write it back double-encoded. Every em dash and arrow becomes `â€"`. This has corrupted both documentation and skill files in CoreERP.

Use the Edit tool for text edits. When a bulk replacement across many files is genuinely needed:

```powershell
$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $text, $enc)
```

Then check for damage before committing: search the changed files for `â€` and `â†`.

## The repository is public

Anyone can read every file, including deleted ones, because git history keeps them (`AGENTS.md`, section Repo ini publik). Documentation and skills write server addresses, IPs, SSH users, and service names as examples (`server.example.com`, `203.0.113.10`), never real values. No secret, no patient data, no real customer or tenant name.

## Checks before calling it done

- Every relative link in the changed pages resolves to a file or heading that exists.
- Every referenced code path exists in the repository it names; a CoreERP path is written as a link to the CoreERP repository, not as a local path.
- No mojibake, no stale counts, no untranslated figures of speech.
- `bun run format:check` covers code, `package.json`, and `.github`, not Markdown, so formatting of documentation is checked by reading it.
