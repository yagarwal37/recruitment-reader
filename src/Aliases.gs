/**
 * Aliases.gs — the lookup tables you'll keep extending by hand.
 *
 * Nothing in this file is pipeline logic. It's the data Normalize.gs and
 * Gmail.gs read from. When a new company variant, city typo, or ATS vendor
 * shows up in the sheet, this is the only file you should need to touch.
 */

/** Sender domain -> ATS vendor. Derived deterministically, never from the model. */
const ATS_DOMAINS = {
  'greenhouse.io': 'greenhouse',
  'greenhouse-mail.io': 'greenhouse',
  'myworkday.com': 'workday',
  'myworkdayjobs.com': 'workday',
  'wd1.myworkdayjobs.com': 'workday',
  'lever.co': 'lever',
  'hire.lever.co': 'lever',
  'ashbyhq.com': 'ashby',
  'icims.com': 'icims',
  'smartrecruiters.com': 'smartrecruiters',
  'successfactors.com': 'successfactors',
  'avature.net': 'avature',
  'eightfold.ai': 'eightfold',
  'oraclecloud.com': 'oracle-hcm',
  'taleo.net': 'taleo',
  'jobvite.com': 'jobvite',
  'brassring.com': 'brassring',
  'recsolu.com': 'recsolu',
  'ripplematch.com': 'ripplematch',
  'rippling.com': 'rippling'
};

/**
 * Company aliases, seeded from the variants already present in the sheet.
 * Key is lowercased+trimmed input; value is the canonical form.
 * Extend this as new variants appear — it is what makes reconcile work.
 */
const COMPANY_ALIASES = {
  'qualtrix': 'Qualtrics',
  'droppel': 'Doppel',
  'medtronics': 'Medtronic',
  'ussa': 'USAA',
  'conde nest': 'Condé Nast',
  'seat geek': 'SeatGeek',
  'net app': 'NetApp',
  'hp enterprises': 'HPE',
  'hp enterprise': 'HPE',
  'hewlett packard enterprise': 'HPE',
  'paypal': 'PayPal',
  'tiktok': 'TikTok',
  'jp morgan chase': 'JPMorgan Chase',
  'jpmorgan chase & co': 'JPMorgan Chase',
  'walt disney company': 'The Walt Disney Company',
  'anduril industries': 'Anduril',
  'doordash': 'DoorDash',
  'cloudflare': 'Cloudflare',
  'whatnot': 'Whatnot',
  'nvidia': 'NVIDIA',
  'ibm': 'IBM',
  'aqr': 'AQR',
  'esri': 'Esri',
  'ey': 'EY',
  'hpe': 'HPE',
  'usaa': 'USAA'
};

/** Common city typos seen in the sheet. */
const LOCATION_FIXES = {
  'remond': 'Redmond',
  'bellavue': 'Bellevue',
  'san francicso': 'San Francisco',
  'seatle': 'Seattle',
  'san antonia': 'San Antonio'
};

/** US state abbreviations, for normalizing "City, ST". */
const STATE_ABBREV = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX',
  'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
};

/**
 * URL paths that identify a generic post-submit portal rather than a posting.
 * A URL matching one of these is demoted from job_url to portal_url — your
 * sheet has a dozen identical copies of the Microsoft one.
 */
const PORTAL_URL_PATTERNS = [
  '/actioncenter/submitted',
  '/applicant',
  '/my-profile',
  '/userhome',
  '/profile/roles',
  '/profile/home',
  '/profile/info',
  '/yourapplications',
  '/careers/profile',
  '/jobs/applications',
  '/careerhub/my/jobs',
  '/applications/dashboard',
  '/position/application'
];
