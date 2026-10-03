/**
 * Config.gs — every tunable value and pipeline constant lives here.
 * The API key does NOT live here. Set it once via Project Settings >
 * Script Properties, key: ANTHROPIC_API_KEY.
 *
 * The hand-maintained lookup tables (company aliases, ATS domains, city
 * typos, portal URL patterns) live in Aliases.gs instead — split out because
 * you'll edit those often and they aren't pipeline behavior.
 */

const CONFIG = {
  SPREADSHEET_ID: '1ehcpulwIBo5gJt6R4rBdLQx6HE8-NZUHJa6ddTDq1R0',

  // Local hour (0-23, in appsscript.json's timeZone) the nightly trigger
  // fires around. Apps Script picks a moment within that hour, not exactly
  // on it.
  TRIGGER_HOUR: 2,

  TABS: {
    APPLICATIONS: 'Applications',
    REVIEW: 'Review',
    IGNORED: 'Ignored',
    ERRORS: 'Errors',
    PROCESSED: '_processed',
    RUNS: '_runs'
  },

  GMAIL: {
    INBOUND_LABEL: 'Apps/Inbound',
    LOGGED_LABEL: 'Apps/Logged',
    SEARCH_WINDOW: 'newer_than:30d',
    MAX_THREADS_PER_RUN: 100,
    MAX_MESSAGES_PER_RUN: 40
  },

  API: {
    URL: 'https://api.anthropic.com/v1/messages',
    VERSION: '2023-06-01',
    MODEL: 'claude-haiku-4-5-20251001',
    MAX_TOKENS: 800,
    RETRIES: 2,
    RETRY_BACKOFF_MS: 1500
  },

  BODY_CHAR_LIMIT: 4000,
  CONFIDENCE_THRESHOLD: 0.8,
  MAX_ATTEMPTS: 3,
  STALE_DAYS: 45,
  NOTIFY_ON_FAILURE: true
};

/** Column order for the Applications tab. Index is position, 0-based. */
const COLUMNS = [
  'message_id', 'date_applied', 'last_updated', 'company', 'title',
  'location_primary', 'location_all', 'req_id', 'job_url', 'portal_url',
  'ats_vendor', 'status', 'new_grad', 'source_email', 'entry_source',
  'confidence', 'notes'
];

const COL = (function () {
  const m = {};
  COLUMNS.forEach(function (name, i) { m[name] = i; });
  return m;
})();

/** Ordered pipeline. A row only ever moves forward, or to a terminal state. */
const STATUS_RANK = {
  applied: 1,
  oa: 2,
  interview: 3,
  offer: 4,
  rejected: 9,
  withdrawn: 9
};
const STATUSES = Object.keys(STATUS_RANK);
const TERMINAL_STATUSES = ['rejected', 'withdrawn'];

/** What the model is allowed to return for `category`. */
const CATEGORIES = [
  'confirmation', 'rejection', 'interview_invite',
  'oa_invite', 'recruiter_outreach', 'other'
];

/** category -> status the row should move to. null means "no status change". */
const CATEGORY_TO_STATUS = {
  confirmation: 'applied',
  rejection: 'rejected',
  interview_invite: 'interview',
  oa_invite: 'oa',
  recruiter_outreach: null,
  other: null
};
