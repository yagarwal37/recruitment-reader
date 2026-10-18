# recruitment-tracker

Google Apps Script that reads job application emails from a filtered Gmail
label, extracts structured fields with the Anthropic API, and maintains an
`Applications` tab in an existing Google Sheet.

Deterministic work — search, dedupe, reconcile, append — is plain code. The
model is used for exactly one thing: pulling company, title, location and
requisition out of unstructured email bodies.

## Pipeline

```
Gmail (Apps/Inbound label)
  → harvest + dedupe gate          Gmail.gs
  → split trusted metadata / body  Gmail.gs
  → classify + extract (Haiku)     Extract.gs + Prompt.gs
  → validate                       Validate.gs (delegates cleanup to Normalize.gs)
  → reconcile: append or update    Reconcile.gs
  → write, mark processed, label   Sheet.gs
```

Trusted metadata — message id, received date, sender, subject, ATS vendor —
never passes through the model. The email body does, and is treated as
untrusted throughout.

## File layout

```
src/               everything clasp pushes to Apps Script
  appsscript.json    the manifest (scopes, timezone)
  Config.gs          tunables + pipeline constants (CONFIG, statuses, categories)
  Aliases.gs         hand-maintained lookup tables — edit this as new company
                     name variants, city typos, or ATS domains show up
  Main.gs            entry points: setup(), runIngest()
  Gmail.gs           reads Gmail, builds the trusted message object, labels
  Prompt.gs          the instructions sent to the model
  Extract.gs         the API call itself (HTTP, retries, JSON parsing)
  Validate.gs        accept/reject gate on what the model returned
  Normalize.gs       string/URL cleanup helpers Validate.gs relies on
  Reconcile.gs       matches a record to an existing row, or decides it's new
  Setup.gs           one-time tab creation, run only from setup()
  Sheet.gs           every-run spreadsheet writes
docs/
  SCHEMA.md          column layout and status model
test/
  run.js             `node test/run.js` — pure-function unit tests
```

Apps Script has no real module system — every function and constant across
every file in `src/` shares one global namespace at runtime. This folder
split is purely for you to navigate; it doesn't change what runs or in what
order (that's still `Main.gs`'s `runIngest()`).

## Setup

**1. Gmail filters**

Create two filters in the Gmail UI (Settings → Filters → Create a new
filter), both applying the label `Apps/Inbound`. They're split because one
combined query exceeds Gmail's filter length limit. Don't put sender domains
in the *From* box and phrases in the *Subject* box of the same filter — Gmail
ANDs those fields, so an email would need to match both.

*Filter A — ATS senders.* Has the words:

```
from:(greenhouse-mail.io OR greenhouse.io OR myworkday.com OR
myworkdayjobs.com OR lever.co OR ashbyhq.com OR icims.com OR
smartrecruiters.com OR avature.net OR eightfold.ai OR oraclecloud.com OR
taleo.net OR jobvite.com OR successfactors.com OR brassring.com OR
recsolu.com OR workablemail.com OR bamboohr.com OR jazzhr.com OR breezy.hr OR
rippling.com OR dover.com OR hackerrank.com OR codesignal.com OR
hirevue.com OR codility.com)
```

Doesn't have:

```
subject:("security code" OR "verification code" OR "confirm your identity"
OR "complete your application" OR incomplete OR "new job opportunities" OR
"jobs you may be interested in" OR "is hiring")
```

Greenhouse sends from `us.greenhouse-mail.io`, which `greenhouse.io` does
not match — keep both.

*Filter B — subject phrases, any sender.* Catches companies that mail from
their own domain (Stripe, Coinbase, Oracle, IBM, Amazon, Amex), LinkedIn
Easy Apply receipts, and recruiters writing directly. Subject:

```
("thank you for applying" OR "thanks for applying" OR "application received"
OR "your application" OR "received your application" OR
"thank you for your application" OR "thank you for your interest" OR
"application status" OR "application update" OR "update re" OR interview OR
"intro call" OR "phone screen" OR "next steps" OR assessment OR
"coding challenge" OR "offer letter")
```

Doesn't have:

```
subject:("security code" OR "verification code" OR "confirm your identity"
OR "complete your application" OR incomplete OR "new job opportunities" OR
"jobs you may be interested in" OR "is hiring" OR "interview prep" OR
"interview preparation") OR from:(jobalerts-noreply@linkedin.com OR
editors-noreply@linkedin.com OR redditmail.com OR joinleland.com OR
luma-mail.com OR interviewkickstart.com OR jobscan.co OR substack.com OR
tldrnewsletter.com OR builtin.com OR dhs.gov)
```

Before saving either filter, paste its query into the Gmail search bar to
preview what it catches. Tick "Also apply filter to matching conversations"
to label mail that already arrived.

The filters do the coarse routing. Keeping the search surface small is what
makes each run cheap; anything that slips through and isn't an application
lands in `Ignored`.

**2. Apps Script project**

Create a project bound to the spreadsheet (Extensions → Apps Script), or a
standalone project — `CONFIG.SPREADSHEET_ID` is set explicitly either way.
Copy the `.gs` files from `src/` into it, and paste `src/appsscript.json`
into the manifest (enable "Show appsscript.json" under Project Settings).
Or skip all of this and use `clasp push` — see below.

**3. API key**

Project Settings → Script Properties → add:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |

Never put the key in `Config.gs`. It would end up in this repo.

**4. Run setup**

Run `setup()` once from the editor and grant the scopes it asks for. It
creates the six tabs, applies the status dropdown and date formats, creates
the Gmail labels and installs a nightly trigger (`CONFIG.TRIGGER_HOUR`,
default 2am in the timezone set in `appsscript.json`).

**5. First real run**

Run `runIngest()` by hand. Check `_runs` for the counts and `Review` for
anything the validator kicked out. Expect the first run to route more to
Review than steady state — that is the threshold doing its job.

## Deploying with clasp

`clasp` requires Node **v20+** — check with `node --version` before installing.

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # paste your scriptId
clasp push
```

`.clasp.json` is gitignored because `scriptId` is account-specific.

Day to day, once that's set up: edit a file in `src/`, then `npm run deploy`
(same as `clasp push`) to make it live. Apps Script isn't compiled or
restarted — the next time any function runs (a manual click, or the nightly
trigger), it just uses whatever's currently pushed.

## Cost

One Haiku call per new message, roughly 1.5k input and 200 output tokens.
Haiku 4.5 is $1 per million input tokens and $5 per million output. At a
hundred applications a month with follow-ups, that is a few cents. Apps
Script execution is free.

`CONFIG.API.MODEL` is a single constant if you want to swap models. Check
current model IDs at https://docs.claude.com/en/docs/about-claude/models —
`claude-haiku-4-5-20251001` is pinned here, and pinned versions get
deprecated eventually.

## Operating it

- `_runs` is the health check. A run with `scanned` climbing and `appended`
  flat means extraction is failing quietly.
- `Errors` has an attempt counter. After `MAX_ATTEMPTS` a message is marked
  processed so it stops burning budget; the row stays for inspection.
- `Review` is meant to be non-empty. Ambiguous emails belong there, not in
  the tab of record. `Ignored` is separate — recruiter outreach and
  newsletters the model categorized confidently, just not an application.
- `listStaleApplications()` lists rows still `applied` with no update in 45
  days.

## Limits worth knowing

- Apps Script caps execution at 6 minutes. `MAX_MESSAGES_PER_RUN` is 40; a
  large backlog drains across successive runs, which the dedupe gate makes
  free. With a nightly trigger that's 40/day — raise `MAX_MESSAGES_PER_RUN`
  or `installTrigger()`'s frequency if your backlog needs to clear faster.
- Gmail labels are thread-level, not message-level. `Apps/Logged` is
  cosmetic; the real idempotency marker is the message id set built from
  `_processed`, `Applications`, `Review` and `Ignored`.
- The script is the only writer to `Applications`. Anything else that wants
  to change a row should write to `Review` and let the next run promote it.

See `docs/SCHEMA.md` for the column layout and the status model.

## Tests

```bash
npm test   # same as: node test/run.js
```

Covers the normalization and reconcile-key logic, seeded with the company,
title, location and URL variants already present in the sheet. The Gmail and
Spreadsheet layers are not covered.
