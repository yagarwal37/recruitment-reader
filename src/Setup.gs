/**
 * Setup.gs — one-time provisioning, called from setup() in Main.gs.
 *
 * Split out of Sheet.gs: everything here runs once (or once per config
 * change) to create tabs and decorate the Applications sheet. Sheet.gs is
 * left holding only the writes that happen on every run.
 */

const REVIEW_HEADERS = [
  'message_id', 'received_at', 'reason', 'confidence', 'subject',
  'sender', 'source_email', 'raw_json', 'resolution'
];
const IGNORED_HEADERS = [
  'message_id', 'received_at', 'category', 'company', 'title',
  'subject', 'sender', 'source_email'
];
const ERROR_HEADERS = ['message_id', 'first_seen', 'last_seen', 'attempts', 'subject', 'error'];
const PROCESSED_HEADERS = ['message_id', 'processed_at', 'outcome'];
const RUN_HEADERS = [
  'started_at', 'duration_s', 'scanned', 'appended', 'updated',
  'review', 'ignored', 'errors', 'fatal'
];

function ensureTabs_(ss) {
  ensureSheet_(ss, CONFIG.TABS.APPLICATIONS, COLUMNS);
  ensureSheet_(ss, CONFIG.TABS.REVIEW, REVIEW_HEADERS);
  ensureSheet_(ss, CONFIG.TABS.IGNORED, IGNORED_HEADERS);
  ensureSheet_(ss, CONFIG.TABS.ERRORS, ERROR_HEADERS);
  ensureSheet_(ss, CONFIG.TABS.PROCESSED, PROCESSED_HEADERS);
  ensureSheet_(ss, CONFIG.TABS.RUNS, RUN_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  if (existing.join('|') !== headers.join('|')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Status dropdown, date formats, hidden key column. */
function decorateApplications_(ss) {
  const sheet = ss.getSheetByName(CONFIG.TABS.APPLICATIONS);
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUSES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COL.status + 1, maxRows, 1).setDataValidation(rule);

  sheet.getRange(2, COL.date_applied + 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, COL.last_updated + 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, COL.confidence + 1, maxRows, 1).setNumberFormat('0.00');

  sheet.hideColumns(COL.message_id + 1);
}
