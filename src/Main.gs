/**
 * Main.gs — entry points.
 *
 * Run setup() once by hand. runIngest() is what the trigger calls.
 */

/**
 * Idempotent. Creates tabs, headers, validation rules and Gmail labels,
 * then installs the time trigger. Safe to re-run after a config change.
 */
function setup() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  ensureTabs_(ss);
  decorateApplications_(ss);
  ensureLabels_();
  installTrigger();
  Logger.log('Setup complete. Tabs, labels and trigger are in place.');
}

/**
 * Nightly trigger, fires once around CONFIG.TRIGGER_HOUR in the timezone set
 * in appsscript.json. Removes any existing one first so re-running is safe.
 */
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('runIngest').timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .nearMinute(0)
    .create();
  Logger.log('Trigger installed: runIngest nightly around ' + CONFIG.TRIGGER_HOUR + ':00.');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runIngest') ScriptApp.deleteTrigger(t);
  });
}

/**
 * The pipeline. Ordering is load-bearing:
 *   write outcome -> mark processed -> label thread
 * A crash between steps means the message is retried, and the dedupe gate
 * in harvestMessages_ absorbs the duplicate. The reverse order would lose rows.
 *
 * sortApplicationsByDate_ only runs once, after the whole loop — row numbers
 * cached in `index` during the loop would be invalidated by sorting mid-loop.
 */
function runIngest() {
  const started = new Date();
  const stats = {
    scanned: 0, appended: 0, updated: 0, review: 0, errors: 0, ignored: 0
  };
  let ss;

  try {
    ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    ensureTabs_(ss);

    const seen = loadSeenIds_(ss);
    const messages = harvestMessages_(seen, CONFIG.GMAIL.MAX_MESSAGES_PER_RUN);
    stats.scanned = messages.length;

    if (messages.length === 0) {
      logRun_(ss, stats, started, '');
      return;
    }

    const index = buildIndex_(ss);

    for (var i = 0; i < messages.length; i++) {
      const msg = messages[i];
      try {
        const raw = extractFields_(msg);
        const check = validate_(raw, msg);

        if (!check.ok) {
          appendReview_(ss, msg, raw, check.reason);
          markProcessed_(ss, msg, 'review');
          labelThread_(msg);
          stats.review++;
          continue;
        }

        const outcome = applyRecord_(ss, check.data, msg, index);
        markProcessed_(ss, msg, outcome.action);
        labelThread_(msg);

        if (outcome.action === 'append') stats.appended++;
        else if (outcome.action === 'update') stats.updated++;
        else if (outcome.action === 'review') stats.review++;
        else stats.ignored++;

      } catch (err) {
        const attempts = recordError_(ss, msg, err);
        stats.errors++;
        if (attempts >= CONFIG.MAX_ATTEMPTS) {
          markProcessed_(ss, msg, 'failed');
          labelThread_(msg);
        }
      }
    }

    // Not just on append: fillBlanks_ can move an existing row's date_applied.
    sortApplicationsByDate_(ss);

    logRun_(ss, stats, started, '');

  } catch (fatal) {
    if (ss) logRun_(ss, stats, started, String(fatal));
    if (CONFIG.NOTIFY_ON_FAILURE) notifyFailure_(fatal);
    throw fatal;
  }
}

/**
 * Routes a validated record to the sheet. Returns { action, row }.
 * action is one of: append, update, ignore, review.
 */
function applyRecord_(ss, record, msg, index) {
  const targetStatus = CATEGORY_TO_STATUS[record.category];

  // recruiter_outreach and other never touch the tab of record. They already
  // passed validate_ cleanly, so they go to Ignored, not Review — Review is
  // for the model being unsure, not for "this was never an application."
  if (targetStatus === null) {
    appendIgnored_(ss, msg, record);
    return { action: 'ignore', row: null };
  }

  const match = findMatch_(record, index, msg.receivedAt);

  if (match === null) {
    const row = appendApplication_(ss, record, msg, targetStatus);
    registerInIndex_(index, record, row, targetStatus, msg.receivedAt);
    return { action: 'append', row: row };
  }

  // Several rows at this company could be the one this email is about, and it
  // names no title or req id to tell them apart.
  if (match.ambiguous) {
    appendReview_(ss, msg, record,
      'ambiguous: ' + match.ambiguous + ' ' + record.company + ' rows could match');
    return { action: 'review', row: null };
  }

  const entry = match.entry;
  fillBlanks_(ss, entry.row, record, msg);
  const changed = advanceStatus_(ss, entry.row, targetStatus, msg);
  refreshInIndex_(index, entry, record, changed ? targetStatus : entry.status, msg.receivedAt);
  return { action: changed ? 'update' : 'ignore', row: entry.row };
}

function notifyFailure_(err) {
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Recruitment tracker: ingest failed',
      'runIngest threw:\n\n' + (err && err.stack ? err.stack : String(err))
    );
  } catch (ignored) { /* never let the notifier mask the real error */ }
}
