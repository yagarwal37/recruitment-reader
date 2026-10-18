# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Google Apps Script (V8 runtime) that reads job-application emails from the Gmail label `Apps/Inbound`, uses the Anthropic API (Haiku) to extract company/title/location/req id from the email body, and maintains an `Applications` tab in a Google Sheet. `README.md` covers setup and operations; `docs/SCHEMA.md` covers tab/column layout, the status model and reconcile keys. Read those before changing sheet layout or matching logic.

## Commands

```bash
npm test          # node test/run.js — pure-function unit tests, no deps
npm run deploy    # clasp push — makes src/ live immediately (needs Node 20+, .clasp.json)
```

- There is no build, lint, or per-test filter. `test/run.js` is a single flat script of `eq(actual, expected, name)` assertions; add new cases there.
- `npm run deploy` overwrites the production Apps Script project; the next manual run or nightly trigger uses whatever was pushed. Don't deploy without the user asking.
- `setup()`, `runIngest()`, `listStaleApplications()` only run inside Apps Script (editor or trigger) — they can't be exercised locally.

## Architecture

**One global namespace.** Apps Script has no modules: every top-level function/const in every `src/*.gs` file is shared. The file split is for navigation only. Watch for name collisions when adding helpers.

**Naming convention.** A trailing underscore (`foo_`) marks a private function, which Apps Script hides from the editor's run menu and from triggers. The no-underscore functions (`setup`, `runIngest`, `installTrigger`, `removeTriggers`, `listStaleApplications`) are the user-facing entry points.

**How the tests load code.** `test/run.js` concatenates `Config.gs`, `Aliases.gs`, `Normalize.gs`, `Reconcile.gs` and `Gmail.gs` and `eval`s them in Node. So:
- Those files must not call `GmailApp`/`SpreadsheetApp`/etc. at top level. Calls inside function bodies are fine as long as tests don't invoke them.
- To test a pure function that lives in another file, add that file to the list in `test/run.js`.

**Pipeline** (`runIngest()` in `Main.gs`): harvest unseen messages oldest-first (`Gmail.gs`) → extract via model (`Extract.gs` + `Prompt.gs`) → `validate_` (`Validate.gs`, using `Normalize.gs` + `Aliases.gs` tables) → `applyRecord_` routes to append / update / Review / Ignored (`Reconcile.gs` for matching, `Sheet.gs` for writes).

Invariants that span files:
- **Write outcome → `markProcessed_` → `labelThread_`**, in that order. Idempotency comes from the message-id set `loadSeenIds_` builds from `_processed`, `Applications`, `Review` and `Ignored`, not from Gmail labels (labels are thread-level and only cosmetic). Reordering these steps can lose rows.
- **Trusted vs untrusted.** Message id, received date, sender, subject and ATS vendor come straight from Gmail and never go through the model. The email body goes to the model and is treated as untrusted. `date_applied` is always the Gmail received date.
- **The in-memory reconcile index caches row numbers.** `sortApplicationsByDate_` runs once after the loop; sorting or inserting rows mid-loop would invalidate the index. Newly appended rows must be added with `registerInIndex_`, and updated rows refreshed with `refreshInIndex_`.
- **Oldest-first processing** (`harvestMessages_` sorts by date) is what lets reconcile fold a confirmation into a row before the rejection that follows it.
- **Status only moves forward** (`STATUS_RANK` in `Config.gs`, enforced in `advanceStatus_`); terminal states (`rejected`, `withdrawn`) are never overwritten. "Ghosted" is computed, not stored.
- **Review vs Ignored.** Review is for validator rejections and ambiguous matches (several rows could match). Ignored is for confidently categorized non-applications (`CATEGORY_TO_STATUS[category] === null`).
- **Column positions** come from `COLUMNS`/`COL` in `Config.gs`, and the live sheet already has data in that order. Changing `COLUMNS` means migrating the sheet and updating `docs/SCHEMA.md`.

**Where to make common edits:**
- New company-name variants, city typos, ATS sender domains, portal-URL patterns → `Aliases.gs`, plus a test case seeded from the real value.
- Thresholds, batch sizes, model id, trigger hour → `CONFIG` in `Config.gs`.
- What the model extracts or how it categorizes → `Prompt.gs`. Allowed categories are in `CATEGORIES` / `CATEGORY_TO_STATUS` in `Config.gs` and are checked by `validate_`.

`ANTHROPIC_API_KEY` lives in Script Properties and is read by `getApiKey_()`; it must never be put in `Config.gs`. `.clasp.json` (holds the account-specific `scriptId`) is gitignored; `.clasp.json.example` is the template.
