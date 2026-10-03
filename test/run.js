/**
 * Unit tests for the pure functions in Config.gs, Aliases.gs, Normalize.gs
 * and Reconcile.gs. These hold the logic most likely to break silently, so
 * they are worth a harness. Anything touching GmailApp or SpreadsheetApp is
 * not covered here.
 *
 *   node test/run.js
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const src = ['Config', 'Aliases', 'Normalize', 'Reconcile', 'Gmail']
  .map(f => fs.readFileSync(path.join(SRC, f + '.gs'), 'utf8'))
  .join('\n');
eval(src);

const results = [];
function eq(actual, expected, name) { results.push([actual === expected, name, actual, expected]); }


// company canonicalization — variants pulled from the real sheet
eq(canonicalCompany_('Oracle '),'Oracle','trailing space');
eq(canonicalCompany_('Qualtrix'),'Qualtrics','typo alias');
eq(canonicalCompany_('Anduril Industries '),'Anduril','alias + space');
eq(canonicalCompany_('Superior Insurance Partners LLC'),'Superior Insurance Partners','legal suffix');
eq(canonicalCompany_('Paypal'),'PayPal','casing alias');
eq(canonicalCompany_(null),'','null');

// title cleaning — req ids glued on, as they are today
eq(cleanTitle_('Software Engineer - Fullstack, Redmond (1798161)'),'Software Engineer - Fullstack, Redmond','paren req');
eq(cleanTitle_('Software Developer 1 - 325062'),'Software Developer 1','dash req');
eq(cleanTitle_('FULL STACK SOFTWARE ENGINEER, CONSTELLATION TOOLS (STARLINK)'),
   'Full Stack Software Engineer, Constellation Tools (Starlink)','all caps');

// location
eq(normalizeLocation_('Remond, WA'),'Redmond, WA','city typo');
eq(normalizeLocation_('NYC, NY'),'NYC, NY','passthrough');
eq(normalizeLocation_('Remote'),'Remote','remote');
eq(normalizeLocation_('San Francisco, California'),'San Francisco, CA','state name');
eq(normalizeLocation_('SF, NYC • LA'),'SF, NYC','first of many');

// url sorting — the Microsoft action center problem
const u1=sortUrls_('https://jobs.careers.microsoft.com/actioncenter/submitted',null);
eq(u1.job,'','portal demoted out of job_url');
eq(u1.portal,'https://jobs.careers.microsoft.com/actioncenter/submitted','portal kept');
const u2=sortUrls_('https://job-boards.greenhouse.io/andurilindustries/jobs/4997234007',null);
eq(u2.job,'https://job-boards.greenhouse.io/andurilindustries/jobs/4997234007','real posting kept');
eq(sortUrls_('LinkedIn',null).job,'','non-url rejected');

// reconcile keys
eq(reqKey_('Oracle','325062'),'oracle|325062','req key');
eq(titleKey_('IXL','Software Engineer, New Grad'),'ixl|software engineer','filler stripped');
eq(titleKey_('Cisco','Software Engineer I'),titleKey_('Cisco','Software Engineer 1'),'I == 1');
eq(titleKey_('Nuro','Front-End Software Engineer, New Grad'),
   titleKey_('Nuro','Front-End Software Engineer'),'dupe rows collapse');

// findMatch_ — the Nexthop case: the confirmation names no title, the rejection does
const newIndex = () => ({ byReq: {}, byTitle: {}, byCompany: {} });
const bare = { company: 'Nexthop AI', title: '', req_id: '' };
const titled = { company: 'Nexthop AI', title: 'Software Engineer - New Grad', req_id: '' };
const confirmedAt = new Date('2026-09-30T01:54:10Z');
const rejectedAt = new Date('2026-09-30T18:53:12Z');

let ix = newIndex();
registerInIndex_(ix, bare, 7, 'applied', confirmedAt);
eq(findMatch_(titled, ix, rejectedAt).entry.row, 7, 'rejection finds bare confirmation row');

ix = newIndex();
registerInIndex_(ix, titled, 6, 'rejected', rejectedAt);
eq(findMatch_(bare, ix, confirmedAt).entry.row, 6, 'earlier confirmation folds into rejected row');
eq(findMatch_(bare, ix, new Date('2026-11-01')), null, 'confirmation after rejection is a new application');

ix = newIndex();
registerInIndex_(ix, { company: 'Cisco', title: 'Software Engineer I', req_id: '2007003' }, 2, 'applied', confirmedAt);
eq(findMatch_({ company: 'Cisco', title: 'Software Engineer Data/AI', req_id: '2000073' }, ix, rejectedAt),
   null, 'different jobs at one company stay separate');
registerInIndex_(ix, { company: 'Cisco', title: 'Software Engineer Data/AI', req_id: '2000073' }, 3, 'applied', confirmedAt);
eq(findMatch_({ company: 'Cisco', title: '', req_id: '' }, ix, rejectedAt).ambiguous, 2,
   'bare email with two open rows is ambiguous');

// ATS vendor — a same-length table key must not match
eq(atsVendorForDomain_('us.greenhouse-mail.io'), 'greenhouse', 'greenhouse-mail subdomain');
eq(atsVendorForDomain_('myworkday.com'), 'workday', 'workday exact');
eq(atsVendorForDomain_('notifications.example.com'), '', 'unknown domain');


let failed = 0;
results.forEach(([ok, name, actual, expected]) => {
  if (!ok) {
    failed++;
    console.log('FAIL: ' + name);
    console.log('  got:  ' + JSON.stringify(actual));
    console.log('  want: ' + JSON.stringify(expected));
  }
});
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
