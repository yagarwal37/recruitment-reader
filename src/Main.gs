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

/** Hourly trigger. Removes any existing one first so re-running is safe. */
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('runIngest').timeBased().everyHours(6).create();
  Logger.log('Trigger installed: runIngest every 6 hours.');
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

    logRun_(ss, stats, started, '');

  } catch (fatal) {
    if (ss) logRun_(ss, stats, started, String(fatal));
    if (CONFIG.NOTIFY_ON_FAILURE) notifyFailure_(fatal);
    throw fatal;
  }
}

/**
 * Routes a validated record to the sheet. Returns { action, row }.
 * action is one of: append, update, ignore.
 */
function applyRecord_(ss, record, msg, index) {
  const targetStatus = CATEGORY_TO_STATUS[record.category];

  // recruiter_outreach and other never touch the tab of record.
  if (targetStatus === null) {
    appendReview_(ss, msg, record, 'category=' + record.category);
    return { action: 'ignore', row: null };
  }

  const match = findMatch_(record, index);

  if (match === null) {
    const row = appendApplication_(ss, record, msg, targetStatus);
    registerInIndex_(index, record, row);
    return { action: 'append', row: row };
  }

  const changed = advanceStatus_(ss, match.row, targetStatus, msg);
  return { action: changed ? 'update' : 'ignore', row: match.row };
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
