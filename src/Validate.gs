/**
 * Validate.gs — the gate on model output.
 *
 * Nothing from Extract.gs reaches the Applications tab without passing
 * through here. Failures are not errors; they are routed to Review, which
 * is the correct destination for a genuinely ambiguous email.
 *
 * The actual string/URL cleanup (canonicalCompany_, normalizeLocation_, etc.)
 * lives in Normalize.gs — this file only decides pass/fail and assembles the
 * validated record.
 */

function validate_(raw, msg) {
  if (!raw || typeof raw !== 'object') {
    return fail_('response was not an object');
  }

  const category = String(raw.category || '').toLowerCase().trim();
  if (CATEGORIES.indexOf(category) === -1) {
    return fail_('unknown category: ' + category);
  }

  var confidence = Number(raw.confidence);
  if (!isFinite(confidence) || confidence < 0 || confidence > 1) confidence = 0;

  const company = canonicalCompany_(raw.company);
  const title = cleanTitle_(raw.title);

  // A confirmation with no company is unusable. Everything else can go to
  // Review and be resolved by hand.
  if (!company) return fail_('no company extracted', confidence);
  if (confidence < CONFIG.CONFIDENCE_THRESHOLD) {
    return fail_('confidence ' + confidence.toFixed(2) + ' below threshold', confidence);
  }

  const urls = sortUrls_(raw.job_url, raw.portal_url);

  return {
    ok: true,
    data: {
      category: category,
      company: company,
      title: title,
      location_primary: normalizeLocation_(raw.location_primary),
      location_all: cleanString_(raw.location_all),
      req_id: extractReqId_(raw.req_id, title, msg),
      job_url: urls.job,
      portal_url: urls.portal,
      new_grad: normalizeTriState_(raw.new_grad),
      ats_vendor: msg.atsVendor,
      confidence: confidence
    }
  };
}

function fail_(reason, confidence) {
  return { ok: false, reason: reason, confidence: confidence || 0 };
}
