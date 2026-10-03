/**
 * Reconcile.gs — decides whether a record is a new application or a state
 * change on an existing one.
 *
 * This is the stage that makes the tracker useful. A rejection email is not
 * a new row; it is a transition. Without this, the sheet becomes an
 * append-only log with a Status column that nobody maintains.
 */

/**
 * Builds a lookup from the Applications tab. One entry per row, reachable by
 * three key families, checked in order of reliability:
 *   1. company + req_id   — exact, when a req id exists
 *   2. company + title    — fuzzy fallback
 *   3. company alone      — only when one side has neither (see findMatch_)
 *
 * Each entry is { row, status, dateApplied, bare }. bare means the row has no
 * req id or title, so only the company key can ever reach it.
 */
function buildIndex_(ss) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const lastRow = sheet.getLastRow();
  const index = { byReq: {}, byTitle: {}, byCompany: {} };

  if (lastRow < 2) return index;

  const values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();

  for (var i = 0; i < values.length; i++) {
    const row = values[i];
    const company = String(row[COL.company] || '');
    if (!company) continue;

    registerInIndex_(index, {
      company: company,
      title: row[COL.title],
      req_id: row[COL.req_id]
    }, i + 2, String(row[COL.status] || '').toLowerCase(), row[COL.date_applied]);
  }

  return index;
}

/**
 * Returns { entry, via } for a single match, { ambiguous: n } when several
 * rows could be this application, or null when it is new.
 *
 * The company-only fallback exists because ATS emails are inconsistent about
 * what they include. A "we received your application" email often names no
 * title, so its row has no req or title key, and the rejection that follows
 * could never find it through those keys.
 */
function findMatch_(record, index, receivedAt) {
  const reqKey = reqKey_(record.company, record.req_id);
  if (reqKey && index.byReq[reqKey]) {
    return { entry: index.byReq[reqKey], via: 'req_id' };
  }

  const titleKey = titleKey_(record.company, record.title);
  if (titleKey && index.byTitle[titleKey]) {
    return { entry: index.byTitle[titleKey], via: 'title' };
  }

  const recordBare = !reqKey && !titleKey;
  const candidates = (index.byCompany[normKey_(record.company)] || []).filter(function (entry) {
    // Both sides name a job and the keys above didn't match: different jobs.
    if (!recordBare && !entry.bare) return false;
    if (TERMINAL_STATUSES.indexOf(entry.status) === -1) return true;
    // A closed row only absorbs emails that predate it. A confirmation that
    // arrives after a rejection is a fresh application.
    return entry.dateApplied instanceof Date && receivedAt <= entry.dateApplied;
  });

  if (candidates.length === 1) return { entry: candidates[0], via: 'company' };
  if (candidates.length > 1) return { ambiguous: candidates.length };
  return null;
}

/** Adds a row to the index and returns its entry. */
function registerInIndex_(index, record, rowNumber, status, dateApplied) {
  const entry = { row: rowNumber, status: status, dateApplied: dateApplied, bare: true };
  const companyKey = normKey_(record.company);
  if (!index.byCompany[companyKey]) index.byCompany[companyKey] = [];
  index.byCompany[companyKey].push(entry);
  indexKeys_(index, record, entry);
  return entry;
}

/**
 * Keeps an entry current after a match changed its row, so a later email in
 * the same run sees the new status, date and keys. Mirrors fillBlanks_.
 */
function refreshInIndex_(index, entry, record, status, receivedAt) {
  entry.status = status;
  if (!entry.dateApplied || (entry.dateApplied instanceof Date && receivedAt < entry.dateApplied)) {
    entry.dateApplied = receivedAt;
  }
  indexKeys_(index, record, entry);
}

/** Points the record's req and title keys at the entry. A row with either is no longer bare. */
function indexKeys_(index, record, entry) {
  const reqKey = reqKey_(record.company, record.req_id);
  if (reqKey) index.byReq[reqKey] = entry;

  const titleKey = titleKey_(record.company, record.title);
  if (titleKey && !index.byTitle[titleKey]) index.byTitle[titleKey] = entry;

  if (reqKey || titleKey) entry.bare = false;
}

function reqKey_(company, reqId) {
  const r = String(reqId || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!r) return '';
  return normKey_(company) + '|' + r;
}

function titleKey_(company, title) {
  const t = normKey_(title);
  if (!t) return '';
  return normKey_(company) + '|' + t;
}

/** Lowercase, strip punctuation and filler words that vary between postings. */
function normKey_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|of|for|and|at|in|new grad|early career|university|graduate|entry level|i|ii|iii|1|2|3)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fields a later email can supply when the matched row is still missing them. */
const FILLABLE_FIELDS = [
  'title', 'location_primary', 'location_all', 'req_id',
  'job_url', 'portal_url', 'ats_vendor'
];

/**
 * Copies fields the matched row is missing from this email — a bare
 * confirmation row picks up the title from the rejection that follows it.
 * Never overwrites a filled cell. Also pulls date_applied back when this
 * email predates the row, so it reflects the earliest email seen.
 */
function fillBlanks_(ss, rowNumber, record, msg) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const row = sheet.getRange(rowNumber, 1, 1, COLUMNS.length).getValues()[0];

  FILLABLE_FIELDS.forEach(function (name) {
    if (!row[COL[name]] && record[name]) {
      sheet.getRange(rowNumber, COL[name] + 1).setValue(record[name]);
    }
  });

  const newGrad = row[COL.new_grad];
  if ((!newGrad || newGrad === 'unknown') && record.new_grad !== 'unknown') {
    sheet.getRange(rowNumber, COL.new_grad + 1).setValue(record.new_grad);
  }

  const applied = row[COL.date_applied];
  if (!applied || (applied instanceof Date && msg.receivedAt < applied)) {
    sheet.getRange(rowNumber, COL.date_applied + 1).setValue(msg.receivedAt);
  }
}

/**
 * Moves a row's status forward. Never regresses, and never overwrites a
 * terminal state — a stray "we received your application" follow-up should
 * not reset a row that is already Rejected.
 * Returns true if anything changed.
 */
function advanceStatus_(ss, rowNumber, targetStatus, msg) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const current = String(
    sheet.getRange(rowNumber, COL.status + 1).getValue() || ''
  ).toLowerCase();

  const currentRank = STATUS_RANK[current] || 0;
  const targetRank = STATUS_RANK[targetStatus] || 0;

  if (TERMINAL_STATUSES.indexOf(current) !== -1) return false;
  if (targetRank <= currentRank) {
    // Still refresh last_updated so the staleness formula stays honest.
    sheet.getRange(rowNumber, COL.last_updated + 1).setValue(msg.receivedAt);
    return false;
  }

  sheet.getRange(rowNumber, COL.status + 1).setValue(targetStatus);
  sheet.getRange(rowNumber, COL.last_updated + 1).setValue(msg.receivedAt);

  // Keep a breadcrumb to the email that caused the transition.
  const notesCell = sheet.getRange(rowNumber, COL.notes + 1);
  const existing = String(notesCell.getValue() || '');
  const entry = Utilities.formatDate(msg.receivedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    + ' ' + targetStatus;
  notesCell.setValue(existing ? existing + '; ' + entry : entry);

  return true;
}
