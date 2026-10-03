/**
 * Sheet.gs — every-run writes to the spreadsheet.
 *
 * Keeping every read and write here means there is exactly one writer to the
 * Applications tab. Anything else that wants to change a row (a Cowork
 * triage session, for instance) writes to Review and lets the next run
 * promote it.
 *
 * One-time tab/column setup (ensureTabs_, decorateApplications_) lives in
 * Setup.gs instead, since it only runs from setup(), not on every ingest.
 */

/* ------------------------------------------------------------------ */
/* Dedupe                                                              */
/* ------------------------------------------------------------------ */

/**
 * The union of every message id the pipeline has ever resolved. Reads every
 * outcome tab because each is written before _processed — a crash between
 * the two would otherwise reprocess a message that already has a row.
 */
function loadSeenIds_(ss) {
  const seen = {};
  collectColumn_(ss, CONFIG.TABS.PROCESSED, 1, seen);
  collectColumn_(ss, CONFIG.TABS.APPLICATIONS, COL.message_id + 1, seen);
  collectColumn_(ss, CONFIG.TABS.REVIEW, 1, seen);
  collectColumn_(ss, CONFIG.TABS.IGNORED, 1, seen);
  return seen;
}

function collectColumn_(ss, tabName, columnNumber, into) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, columnNumber, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    const id = String(values[i][0] || '').trim();
    if (id) into[id] = true;
  }
}

function markProcessed_(ss, msg, outcome) {
  ss.getSheetByName(CONFIG.TABS.PROCESSED)
    .appendRow([msg.messageId, new Date(), outcome]);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function appendApplication_(ss, record, msg, status) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const row = new Array(COLUMNS.length).fill('');

  row[COL.message_id] = msg.messageId;
  row[COL.date_applied] = msg.receivedAt;
  row[COL.last_updated] = msg.receivedAt;
  row[COL.company] = record.company;
  row[COL.title] = record.title;
  row[COL.location_primary] = record.location_primary;
  row[COL.location_all] = record.location_all;
  row[COL.req_id] = record.req_id;
  row[COL.job_url] = record.job_url;
  row[COL.portal_url] = record.portal_url;
  row[COL.ats_vendor] = record.ats_vendor;
  row[COL.status] = status;
  row[COL.new_grad] = record.new_grad;
  row[COL.source_email] = msg.permalink;
  row[COL.entry_source] = 'auto';
  row[COL.confidence] = record.confidence;
  row[COL.notes] = record.category === 'confirmation' ? '' : 'first seen as ' + record.category;

  sheet.appendRow(row);
  return sheet.getLastRow();
}

/**
 * Keeps the tab newest-application-first. Call this once, after the whole
 * per-message loop in runIngest() has finished — row numbers cached in the
 * reconcile index (see Reconcile.gs) are only valid for that one run, so
 * sorting mid-loop would silently point advanceStatus_ at the wrong row.
 */
function sortApplicationsByDate_(ss) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  sheet.getRange(2, 1, lastRow - 1, COLUMNS.length)
    .sort({ column: COL.date_applied + 1, ascending: false });
}

function appendReview_(ss, msg, raw, reason) {
  ss.getSheetByName(CONFIG.TABS.REVIEW).appendRow([
    msg.messageId,
    msg.receivedAt,
    reason,
    raw && raw.confidence !== undefined ? raw.confidence : '',
    msg.subject,
    msg.from,
    msg.permalink,
    JSON.stringify(raw || {}).slice(0, 4000),
    ''
  ]);
}

/**
 * For categories that never touch Applications (recruiter_outreach, other).
 * These already passed validate_ cleanly — the model wasn't unsure about
 * anything — so they don't belong in Review, which is for genuine ambiguity.
 */
function appendIgnored_(ss, msg, record) {
  ss.getSheetByName(CONFIG.TABS.IGNORED).appendRow([
    msg.messageId,
    msg.receivedAt,
    record.category,
    record.company,
    record.title,
    msg.subject,
    msg.from,
    msg.permalink
  ]);
}

/**
 * Upserts into Errors and returns the attempt count. A message that fails
 * MAX_ATTEMPTS times is marked processed so it stops consuming budget.
 */
function recordError_(ss, msg, err) {
  const sheet = ss.getSheetByName(CONFIG.TABS.ERRORS);
  const lastRow = sheet.getLastRow();
  const message = String(err && err.message ? err.message : err).slice(0, 500);

  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === msg.messageId) {
        const rowNumber = i + 2;
        const attempts = Number(sheet.getRange(rowNumber, 4).getValue() || 0) + 1;
        sheet.getRange(rowNumber, 3, 1, 4)
          .setValues([[new Date(), attempts, msg.subject, message]]);
        return attempts;
      }
    }
  }

  sheet.appendRow([msg.messageId, new Date(), new Date(), 1, msg.subject, message]);
  return 1;
}

function logRun_(ss, stats, started, fatal) {
  const duration = Math.round((new Date() - started) / 1000);
  ss.getSheetByName(CONFIG.TABS.RUNS).appendRow([
    started, duration, stats.scanned, stats.appended, stats.updated,
    stats.review, stats.ignored, stats.errors, fatal || ''
  ]);
}

/* ------------------------------------------------------------------ */
/* Reporting helper                                                    */
/* ------------------------------------------------------------------ */

/**
 * Not stored as a status — computed. Rows still "applied" with no update in
 * STALE_DAYS are effectively ghosted. Run from the menu or call it ad hoc.
 */
function listStaleApplications() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  const cutoff = new Date(Date.now() - CONFIG.STALE_DAYS * 86400000);
  const stale = [];

  for (var i = 0; i < values.length; i++) {
    const row = values[i];
    if (String(row[COL.status]).toLowerCase() !== 'applied') continue;
    const updated = row[COL.last_updated];
    if (updated instanceof Date && updated < cutoff) {
      stale.push(row[COL.company] + ' — ' + row[COL.title]);
    }
  }

  Logger.log(stale.length + ' stale applications:\n' + stale.join('\n'));
  return stale;
}
