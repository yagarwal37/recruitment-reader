/**
 * Gmail.gs — the source leg.
 *
 * Everything this file produces is deterministic. No field here ever comes
 * from the model, which is why date_applied and message_id can be trusted.
 *
 * Note on labels: Gmail labels are thread-level, not message-level. A thread
 * that holds a confirmation and a later rejection would be skipped entirely
 * if the label were the dedupe key. So labels are cosmetic here, and the real
 * idempotency marker is the per-message id set in loadSeenIds_().
 */

/**
 * Returns up to `limit` unseen messages, oldest first. Gmail search returns
 * newest first, which would process a rejection before the confirmation it
 * follows and leave the confirmation nothing to attach to.
 */
function harvestMessages_(seenIds, limit) {
  const query = 'label:' + CONFIG.GMAIL.INBOUND_LABEL + ' ' + CONFIG.GMAIL.SEARCH_WINDOW;
  const threads = GmailApp.search(query, 0, CONFIG.GMAIL.MAX_THREADS_PER_RUN);
  const pending = [];

  for (var t = 0; t < threads.length; t++) {
    const thread = threads[t];
    const messages = thread.getMessages();
    for (var m = 0; m < messages.length; m++) {
      const message = messages[m];
      if (seenIds[message.getId()]) continue;
      pending.push({ message: message, thread: thread, date: message.getDate() });
    }
  }

  pending.sort(function (a, b) { return a.date - b.date; });
  return pending.slice(0, limit).map(function (p) {
    return prepareMessage_(p.message, p.thread);
  });
}

/** Splits a raw Gmail message into the trusted metadata the pipeline needs. */
function prepareMessage_(message, thread) {
  const from = message.getFrom() || '';
  const domain = domainFromAddress_(from);
  return {
    messageId: message.getId(),
    threadId: thread.getId(),
    receivedAt: message.getDate(),
    from: from,
    senderName: displayNameFromAddress_(from),
    senderDomain: domain,
    atsVendor: atsVendorForDomain_(domain),
    subject: message.getSubject() || '',
    body: truncateBody_(message.getPlainBody() || ''),
    permalink: 'https://mail.google.com/mail/u/0/#all/' + thread.getId(),
    thread: thread
  };
}

function labelThread_(msg) {
  try {
    const label = GmailApp.getUserLabelByName(CONFIG.GMAIL.LOGGED_LABEL);
    if (label && msg.thread) msg.thread.addLabel(label);
  } catch (ignored) { /* cosmetic only — never fail the run over a label */ }
}

/** Creates the inbound/logged Gmail labels if they do not exist yet. */
function ensureLabels_() {
  [CONFIG.GMAIL.INBOUND_LABEL, CONFIG.GMAIL.LOGGED_LABEL].forEach(function (name) {
    if (!GmailApp.getUserLabelByName(name)) GmailApp.createLabel(name);
  });
}

/**
 * Head-weighted truncation. Company and title live in the first screen;
 * the tail is signature and legal boilerplate. Keeping a small tail helps
 * with the ATS footers that sometimes carry the req id.
 */
function truncateBody_(body) {
  const clean = body.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const limit = CONFIG.BODY_CHAR_LIMIT;
  if (clean.length <= limit) return clean;
  const headLen = Math.floor(limit * 0.8);
  const tailLen = limit - headLen;
  return clean.slice(0, headLen) + '\n...[truncated]...\n' + clean.slice(-tailLen);
}

function domainFromAddress_(from) {
  const m = /<?([^<>@\s]+)@([^<>\s]+)>?\s*$/.exec(from.trim());
  return m ? m[2].toLowerCase().replace(/[>,;]+$/, '') : '';
}

function displayNameFromAddress_(from) {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return m ? m[1].trim() : '';
}

/** Longest-suffix match, so mail.greenhouse.io still resolves to greenhouse. */
function atsVendorForDomain_(domain) {
  if (!domain) return '';
  var best = '';
  for (var key in ATS_DOMAINS) {
    if (domain === key || domain.slice(-(key.length + 1)) === '.' + key) {
      if (key.length > best.length) best = key;
    }
  }
  return best ? ATS_DOMAINS[best] : '';
}
