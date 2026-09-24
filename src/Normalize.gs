/**
 * Normalize.gs — cleans up individual values coming back from the model.
 *
 * Split out of Validate.gs: that file decides pass/fail on a whole record,
 * this file is the collection of small, single-purpose string/URL cleanup
 * functions it leans on. None of these functions reject anything — they just
 * turn messy model output into the canonical form the sheet expects.
 */

/**
 * Trailing spaces and spelling variants are why reconcile misses. The sheet
 * already contains "Oracle " next to "Oracle" and "Qualtrix" for Qualtrics.
 */
function canonicalCompany_(value) {
  const s = cleanString_(value);
  if (!s) return '';

  const stripped = s
    .replace(/[,\s]+(inc|llc|ltd|corp|corporation|co|plc|gmbh)\.?$/i, '')
    .trim();

  const alias = COMPANY_ALIASES[stripped.toLowerCase()];
  return alias || stripped;
}

/** Strips a requisition number that the model left glued to the title. */
function cleanTitle_(value) {
  var s = cleanString_(value);
  if (!s) return '';
  s = s.replace(/\s*[\(\[]\s*(?:req(?:uisition)?\s*#?\s*)?[A-Z]{0,3}\d{4,}\s*[\)\]]\s*$/i, '');
  s = s.replace(/\s*[-–—]\s*(?:[A-Z]{1,3})?\d{4,}\s*$/i, '');
  if (s === s.toUpperCase() && s.length > 12) s = toTitleCase_(s);
  return s.trim();
}

function toTitleCase_(s) {
  const small = ['and', 'or', 'of', 'the', 'for', 'in', 'to', 'a', 'an'];
  return s.toLowerCase().split(/(\s+|[\/,()-])/).map(function (word, i) {
    if (!/[a-z]/.test(word)) return word;
    if (i > 0 && small.indexOf(word) !== -1) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join('');
}

/**
 * Pulls a req id from the model's field, then the title, then any URL path.
 * This is the best natural key available, and the sheet shows it was already
 * being captured by hand inside the title column.
 */
function extractReqId_(value, title, msg) {
  const direct = cleanString_(value);
  if (direct) return direct;

  const fromTitle = /\b((?:JR|R|REQ)?\d{5,})\b/i.exec(String(title || ''));
  if (fromTitle) return fromTitle[1];

  const fromSubject = /\b((?:JR|R|REQ)[-_]?\d{4,})\b/i.exec(msg.subject || '');
  if (fromSubject) return fromSubject[1];

  return '';
}

function normalizeLocation_(value) {
  var s = cleanString_(value);
  if (!s) return '';
  if (/^remote$/i.test(s)) return 'Remote';

  // Take the first location when several are listed.
  s = s.split(/\s*[;•|]\s*|\s+(?:and|or)\s+/i)[0].trim();

  const parts = s.split(',').map(function (p) { return p.trim(); });
  var city = parts[0] || '';
  var state = parts[1] || '';

  const fix = LOCATION_FIXES[city.toLowerCase()];
  if (fix) city = fix;

  if (state) {
    const abbrev = STATE_ABBREV[state.toLowerCase()];
    if (abbrev) state = abbrev;
    else if (state.length === 2) state = state.toUpperCase();
  }

  return state ? city + ', ' + state : city;
}

/**
 * Demotes a generic post-submit page from job_url to portal_url. The sheet
 * has twelve byte-identical copies of the Microsoft action center URL sitting
 * in the Link column, which is the problem this prevents.
 */
function sortUrls_(jobUrl, portalUrl) {
  var job = cleanUrl_(jobUrl);
  var portal = cleanUrl_(portalUrl);

  if (job && isPortalUrl_(job)) {
    if (!portal) portal = job;
    job = '';
  }
  if (portal && job && portal === job) portal = '';

  return { job: job, portal: portal };
}

function isPortalUrl_(url) {
  const lower = url.toLowerCase();
  for (var i = 0; i < PORTAL_URL_PATTERNS.length; i++) {
    if (lower.indexOf(PORTAL_URL_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

function cleanUrl_(value) {
  const s = cleanString_(value);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  if (s.length > 2000) return '';
  // Tracking pixels and unsubscribe links are not job links.
  if (/\/(unsubscribe|pixel|open\.gif|track)\b/i.test(s)) return '';
  return s;
}

function normalizeTriState_(value) {
  const s = String(value || '').toLowerCase().trim();
  if (s === 'yes' || s === 'true') return 'yes';
  if (s === 'no' || s === 'false') return 'no';
  return 'unknown';
}

function cleanString_(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'unknown') return '';
  return s;
}
