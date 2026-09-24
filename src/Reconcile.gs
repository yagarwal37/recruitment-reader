/**
 * Reconcile.gs — decides whether a record is a new application or a state
 * change on an existing one.
 *
 * This is the stage that makes the tracker useful. A rejection email is not
 * a new row; it is a transition. Without this, the sheet becomes an
 * append-only log with a Status column that nobody maintains.
 */

/**
 * Builds a lookup from the Applications tab. Two key families, checked in
 * order of reliability:
 *   1. company + req_id   — exact, when a req id exists
 *   2. company + title    — fuzzy fallback
 */
function buildIndex_(ss) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const lastRow = sheet.getLastRow();
  const index = { byReq: {}, byTitle: {} };

  if (lastRow < 2) return index;

  const values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();

  for (var i = 0; i < values.length; i++) {
    const row = values[i];
    const rowNumber = i + 2;
    const company = String(row[COL.company] || '');
    if (!company) continue;

    const reqKey = reqKey_(company, row[COL.req_id]);
    if (reqKey) index.byReq[reqKey] = rowNumber;

    const titleKey = titleKey_(company, row[COL.title]);
    if (titleKey && !index.byTitle[titleKey]) index.byTitle[titleKey] = rowNumber;
  }

  return index;
}

function findMatch_(record, index) {
  const reqKey = reqKey_(record.company, record.req_id);
  if (reqKey && index.byReq[reqKey]) {
    return { row: index.byReq[reqKey], via: 'req_id' };
  }

  const titleKey = titleKey_(record.company, record.title);
  if (titleKey && index.byTitle[titleKey]) {
    return { row: index.byTitle[titleKey], via: 'title' };
  }

  return null;
}

function registerInIndex_(index, record, rowNumber) {
  const reqKey = reqKey_(record.company, record.req_id);
  if (reqKey) index.byReq[reqKey] = rowNumber;

  const titleKey = titleKey_(record.company, record.title);
  if (titleKey && !index.byTitle[titleKey]) index.byTitle[titleKey] = rowNumber;
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
