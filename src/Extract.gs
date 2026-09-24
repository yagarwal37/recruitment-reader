/**
 * Extract.gs — the one stage that needs a model.
 *
 * Classification and extraction happen in a single call. Splitting them costs
 * double and produces worse classification, because the category is easier to
 * judge once the fields have been parsed.
 *
 * The instructions given to the model (EXTRACTION_SYSTEM_PROMPT) live in
 * Prompt.gs. Nothing the model returns here is trusted until Validate.gs
 * has checked it.
 */

function extractFields_(msg) {
  const apiKey = getApiKey_();

  const userContent = [
    'Sender domain: ' + (msg.senderDomain || 'unknown'),
    'Detected ATS vendor: ' + (msg.atsVendor || 'unknown'),
    '',
    '<email>',
    '<from>' + msg.from + '</from>',
    '<subject>' + msg.subject + '</subject>',
    '<body>',
    msg.body,
    '</body>',
    '</email>'
  ].join('\n');

  const payload = {
    model: CONFIG.API.MODEL,
    max_tokens: CONFIG.API.MAX_TOKENS,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }]
  };

  const text = callAnthropic_(apiKey, payload);
  return parseJsonResponse_(text);
}

function callAnthropic_(apiKey, payload) {
  var lastError = '';

  for (var attempt = 0; attempt <= CONFIG.API.RETRIES; attempt++) {
    if (attempt > 0) Utilities.sleep(CONFIG.API.RETRY_BACKOFF_MS * attempt);

    const response = UrlFetchApp.fetch(CONFIG.API.URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': CONFIG.API.VERSION
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200) {
      const parsed = JSON.parse(body);
      const blocks = parsed.content || [];
      var out = '';
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].type === 'text') out += blocks[i].text;
      }
      if (!out) throw new Error('API returned no text block');
      return out;
    }

    lastError = 'HTTP ' + code + ': ' + body.slice(0, 400);

    // 4xx other than 429 will not succeed on retry.
    if (code >= 400 && code < 500 && code !== 429) break;
  }

  throw new Error('Anthropic API call failed. ' + lastError);
}

/** Tolerates a stray markdown fence without tolerating anything else. */
function parseJsonResponse_(text) {
  var cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model response contained no JSON object: ' + cleaned.slice(0, 200));
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it under Project Settings > Script Properties.'
    );
  }
  return key;
}
