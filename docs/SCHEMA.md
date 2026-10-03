# Schema

## Tabs

| Tab | Written by | Purpose |
|---|---|---|
| `Applications` | script only | the record of truth |
| `Review` | script, resolved by human | anything the validator rejected, or an email that could match several rows — genuine ambiguity |
| `Ignored` | script | recruiter outreach / newsletters / etc — categorized cleanly, just not an application |
| `Errors` | script | messages that threw, with an attempt counter |
| `_processed` | script | every message id the pipeline has resolved |
| `_runs` | script | one row per run, for spotting silent failures |

The three historical tabs are untouched. They stay as an archive.

## `Applications` columns

| # | Column | Source | Notes |
|---|---|---|---|
| A | `message_id` | Gmail | hidden; part of the dedupe key |
| B | `date_applied` | Gmail received date | never from the model |
| C | `last_updated` | script | drives the staleness check |
| D | `company` | model, then alias map | canonical form only |
| E | `title` | model | requisition stripped out |
| F | `location_primary` | model, then normalizer | `City, ST` or `Remote` |
| G | `location_all` | model | raw string when multi-site |
| H | `req_id` | model, title, or subject | the natural key |
| I | `job_url` | model | the posting itself |
| J | `portal_url` | model | generic ATS status page |
| K | `ats_vendor` | sender domain | deterministic lookup |
| L | `status` | reconcile | dropdown, validated |
| M | `new_grad` | model | yes / no / unknown |
| N | `source_email` | Gmail permalink | click back to the source |
| O | `entry_source` | script | `auto` or `manual` |
| P | `confidence` | model | below 0.8 never reaches this tab |
| Q | `notes` | script and human | transition breadcrumbs |

## Status model

`applied` → `oa` → `interview` → `offer`, with `rejected` and `withdrawn` as
terminal states.

Two invariants enforced in `advanceStatus_`:

1. Status never regresses. A late "we received your application" cannot reset
   a row that has already reached `interview`.
2. Terminal states are never overwritten.

**Ghosted is not a status.** It is computed: `status = applied` and
`last_updated` older than `CONFIG.STALE_DAYS`. Storing it would require a
sweep job and would go stale the moment a reply arrived. Call
`listStaleApplications()` or drop this in a cell:

```
=FILTER(Applications!D:E, Applications!L:L="applied", Applications!C:C < TODAY()-45)
```

## Manual rows

Add them by hand with `entry_source` set to `manual` and `message_id` left
empty. LinkedIn Easy Apply and anything that never sends a confirmation will
land here. Reconcile still matches against them, so a later rejection email
updates the manual row rather than creating a duplicate.

## Keys used by reconcile

1. `normalize(company) + "|" + normalize(req_id)` — exact
2. `normalize(company) + "|" + normalize(title)` — fallback
3. `normalize(company)` alone — only when the email or the row has neither a
   req id nor a title, which is common for "we received your application"
   emails. One candidate row matches; several go to `Review`. A `rejected` or
   `withdrawn` row only matches emails older than it, so a confirmation after
   a rejection is a new application.

On a match, the row's empty cells are filled from the email and
`date_applied` moves back if the email is older. Emails are processed oldest
first, so a confirmation always lands before the rejection that follows it.

`normKey_` strips punctuation and the filler that varies between postings of
the same role: `new grad`, `early career`, `entry level`, `university`,
roman numerals and trailing digits. That is what collapses "Software
Engineer I" and "Software Engineer 1" onto one key.
