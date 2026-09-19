/* DOM-free regression suite. Everything the extension decides without a browser —
 * field rules, URL shaping, role matching, upload classification, the consent guard,
 * standing answers, passenger rows — is checked here.
 *   node test/run.js
 */
globalThis.window = {};
const path = require('path');
const fs = require('fs');
const R = path.join(__dirname, '..', 'src');
require(path.join(R, 'common/schema.js'));
require(path.join(R, 'content/rules.js'));
require(path.join(R, 'content/files.js'));

const S = globalThis.SF_SCHEMA, RU = globalThis.SF_RULES, F = globalThis.SF_FILES;

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`  FAIL ${name}\n       got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`));
};
const group = n => console.log('\n' + n);

/* ---- field rules ---- */
group('field rules');
const profile = S.resolve({
  firstName: 'Abhay', lastName: 'Bundela', email: 'jane.doe@example.com', phone: '+919876543210',
  dob: '1998-04-12', addressLine1: '12 MG Road', addressLine2: 'Flat 4B', city: 'Indore',
  state: 'Madhya Pradesh', postalCode: '452001', country: 'India', countryCode: 'IN',
  currentTitle: 'Founder', currentCompany: 'RVA Studio', yearsExperience: '7',
  expectedSalary: '2400000', currentSalary: '1800000', university: 'DAVV',
  highestDegree: 'B.Tech', gradYear: '2020', linkedin: 'https://linkedin.com/in/abhay-bundela',
  github: 'https://github.com/aby050', website: 'rva.studio', panNumber: 'ABCDE1234F',
  willingToRelocate: 'Yes', noticePeriod: '30 days'
});
profile.__custom = [];
const fld = (label, name, kind) => ({
  label, kind: kind || 'text', haystack: (label + ' ' + name).toLowerCase(),
  attrs: { autocomplete: '', name, placeholder: '', maxlength: null }
});
for (const [l, n, want] of [
  ['First Name','first_name','firstName'], ['Surname','sn','lastName'],
  ['Full Name','applicant_name','fullName'], ['Email Address','email','email'],
  ['Mobile Number','mobile','phone'], ['Date of Birth','dob','dob'], ['D.O.B','birth','dob'],
  ['Street Address','addr1','addressLine1'], ['Address Line 2','addr2','addressLine2'],
  ['City / Town','city','city'], ['State','state','state'], ['PIN Code','pincode','postalCode'],
  ['Country','country','country'], ['Current CTC','ctc','currentSalary'],
  ['Expected CTC','ectc','expectedSalary'], ['Total Years of Experience','exp','yearsExperience'],
  ['Notice Period','np','noticePeriod'], ['Current Designation','desig','currentTitle'],
  ['Current Employer','emp','currentCompany'], ['Highest Qualification','qual','highestDegree'],
  ['University / College','uni','university'], ['Year of Passing','yop','gradYear'],
  ['LinkedIn Profile URL','linkedin_url','linkedin'], ['Public profile URL','pub','linkedin'],
  ['Social profile link','soc','linkedin'], ['GitHub','gh','github'],
  ['Personal Website','site','website'], ['PAN Number','pan','panNumber'],
  ['Password','pw',null], ['How many cats do you own','cats',null]
]) {
  const m = RU.score(fld(l, n), profile);
  t(`rule: ${l}`, m ? m.key : null, want);
}

/* ---- value shaping ---- */
group('value shaping');
const sh = (hay, ph, max) => ({ kind: 'text', haystack: hay, attrs: { placeholder: ph || '', maxlength: max || null } });
t('dob -> text', RU.shape('1998-04-12', sh(''), 'dob'), '12/04/1998');
t('dob -> native picker', RU.shape('1998-04-12', { kind: 'date', haystack: '', attrs: { placeholder: '', maxlength: null } }, 'dob'), '1998-04-12');
t('dob -> mm/dd', RU.shape('1998-04-12', sh('dob mm/dd/yyyy', 'MM/DD/YYYY'), 'dob'), '04/12/1998');
t('phone trimmed to maxlength', RU.shape('+919876543210', { kind: 'tel', haystack: '', attrs: { placeholder: '', maxlength: 10 } }, 'phone'), '9876543210');
t('linkedin -> full url', RU.shape(profile.linkedin, sh('linkedin profile url'), 'linkedin'), 'https://www.linkedin.com/in/abhay-bundela');
t('linkedin -> handle', RU.shape(profile.linkedin, sh('linkedin username'), 'linkedin'), 'abhay-bundela');
t('linkedin -> handle via placeholder', RU.shape(profile.linkedin, sh('linkedin', 'linkedin.com/in/'), 'linkedin'), 'abhay-bundela');
t('bare handle -> full url', RU.shape('abhay-bundela', sh('linkedin profile url'), 'linkedin'), 'https://www.linkedin.com/in/abhay-bundela');
t('website gets protocol', RU.shape('rva.studio', sh('website'), 'website'), 'https://rva.studio');

/* ---- option matching ---- */
group('option matching');
const states = [{ value: 'MP', text: 'Madhya Pradesh' }, { value: 'MH', text: 'Maharashtra' }];
t('exact', RU.matchOption('Madhya Pradesh', states).value, 'MP');
t('fuzzy', RU.matchOption('madhya-pradesh', states).value, 'MP');
t('yes/no', RU.matchOption('Yes', [{ value: '1', text: 'Yes' }, { value: '0', text: 'No' }]).value, '1');
t('no match', RU.matchOption('Kerala', states), null);

/* ---- roles ---- */
group('role matching');
const roles = [
  { id: 'pm', name: 'Product Manager', keywords: ['product manager', 'product owner', 'roadmap'], overrides: { currentTitle: 'Senior Product Manager' } },
  { id: 'prj', name: 'Project Manager', keywords: ['project manager', 'delivery manager', 'PMP'], overrides: {} },
  { id: 'eng', name: 'Engineer', keywords: ['software engineer', 'react native'], overrides: {} }
];
for (const [text, want] of [
  ['Senior Product Manager — Payments | Acme Careers', 'pm'],
  ['Project Manager (PMP preferred)', 'prj'],
  ['We are hiring a Delivery Manager', 'prj'],
  ['React Native Engineer, Mobile', 'eng'],
  ['Head of Marketing, EMEA', null]
]) {
  const h = S.matchRole(roles, text);
  t(`role: ${text.slice(0, 32)}`, h ? h.role.id : null, want);
}
t('overrides applied', S.applyRole({ currentTitle: 'Founder' }, roles[0]).currentTitle, 'Senior Product Manager');
t('overrides absent leave base', S.applyRole({ currentTitle: 'Founder' }, roles[2]).currentTitle, 'Founder');

/* ---- uploads ---- */
group('upload classification');
for (const [text, want] of [
  ['Upload your resume / CV (PDF or DOCX)', 'resume'], ['Attach CV', 'resume'],
  ['Drag and drop your resume here', 'resume'], ['Cover letter (optional)', 'cover'],
  ['Upload a cover letter with your resume', 'cover'], ['Profile photograph', 'photo'],
  ['Upload Aadhaar card', 'other'], ['Attach supporting file', 'unknown']
]) t(`upload: ${text.slice(0, 34)}`, F.classify(text), want);

const pdf = { name: 'a.pdf', type: 'application/pdf' };
const docx = { name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
t('accept .pdf,.docx + pdf', F.accepts('.pdf,.doc,.docx', pdf), true);
t('accept .pdf + docx', F.accepts('.pdf', docx), false);
t('accept image/* + pdf', F.accepts('image/*', pdf), false);
t('accept empty', F.accepts('', pdf), true);

/* ---- consent guard ---- */
group('consent guard');
const src = fs.readFileSync(path.join(R, 'content/fields.js'), 'utf8');
const CONSENT_RE = eval(src.match(/const CONSENT_RE = (new RegExp\([\s\S]*?'i'\));/)[1]);
const NOT_CONSENT_RE = eval(src.match(/const NOT_CONSENT_RE = (\/.*\/i);/)[1]);
const isConsent = x => CONSENT_RE.test(x.toLowerCase()) && !NOT_CONSENT_RE.test(x.toLowerCase());
for (const [text, want] of [
  ['does not collect any personal information other than the types specified in this Consent', true],
  ['What is your nationality?', false],
  ['Do you require a visa to legally work in India?', false],
  ['(Required) By submitting your resume, you consent to the required collection and use', true],
  ['(Optional) I consent to reference checks on me', true],
  ['(Optional) Recordings of the interview process may be collected', true],
  ['I hereby confirm that I DO NOT have any Relatives working in the Group', true],
  ['Do you acknowledge and agree that where required under applicable laws', true],
  ['Are you legally authorized to work in the United States?', false],
  ['Name of Relative(s):', false], ['First Name', false], ['Expected CTC', false]
]) t(`consent: ${text.slice(0, 40)}`, isConsent(text), want);

/* ---- standing answers ---- */
group('standing answers');
t('seed ships no pre-set answers', S.COMMON_ANSWERS.filter(a => a.value).length, 0);
const seeded = S.COMMON_ANSWERS.map(a => ({ ...a, value: a.match }));
for (const [q, want] of [
  ['1. What is your nationality?', 'what is your nationality'],
  ['2. Do you require a visa to legally work in India?', 'require a visa'],
  ['(Required) By submitting your resume, you consent to the required collection and use', 'consent to the required collection'],
  ['(Optional) I consent to reference checks on me', 'reference check'],
  ['I hereby confirm that I DO NOT have any Relatives working in any company', 'confirm that i do not have any relatives'],
  ['2. Give details below if you have any relatives working in the Group', 'any relatives working in'],
  ['Relationship:', undefined]
]) {
  const m = S.matchAnswer(seeded, q);
  t(`answer: ${q.slice(0, 40)}`, m ? m.match : undefined, want);
}
t('longest match wins', S.matchAnswer(
  [{ match: 'consent', value: 'WRONG' }, { match: 'consent to reference checks', value: 'RIGHT' }],
  'I consent to reference checks on me').value, 'RIGHT');

/* ---- passenger rows ---- */
group('passenger rows');
const humanize = v => String(v || '').replace(/[_\-.\[\]]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
for (const [label, want] of [
  ['Passenger Name', 'name'], ['Age (Yrs)', 'age'], ['Gender', 'gender'], ['Sex', 'gender'],
  ['Berth Preference', 'berth'], ['Food Choice', 'food'], ['Meal Preference', 'food'],
  ['Nationality', 'nationality'], ['ID Card Type', 'idType'], ['ID Card Number', 'idNumber'],
  ['Mobile Number', null], ['Train Number', null]
]) t(`pax: ${label}`, S.passengerKeyFor(label), want);
for (const [attr, want] of [
  ['passengerAge', 'age'], ['passenger_name', 'name'], ['psgn-berth-choice', 'berth'],
  ['foodChoice', 'food'], ['idCardType', 'idType']
]) t(`pax attr: ${attr}`, S.passengerKeyFor(humanize(attr)), want);

/* ---- date normalisation for the PrimeNG calendar adapter ---- */
group('date -> ISO (calendar adapter)');
const fsrc = fs.readFileSync(path.join(R, 'content/filler.js'), 'utf8');
const toIso = eval('(' + fsrc.match(/function toIso\(v\) \{[\s\S]*?\n  \}/)[0].replace(/^function/, 'function') + ')');
t('already ISO', toIso('2026-09-29'), '2026-09-29');
t('DD/MM/YYYY', toIso('29/09/2026'), '2026-09-29');
t('D/M/YYYY', toIso('9/9/2026'), '2026-09-09');
t('DD-MM-YYYY', toIso('29-09-2026'), '2026-09-29');

/* ---- IRCTC passenger row, as observed live on 2026-09-18 ---- */
group('IRCTC passenger row');
const humanize2 = v => String(v || '').replace(/[_\-.\[\]]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
for (const [ctrl, want] of [
  ['Full Name as per Govt. ID', 'name'],
  [humanize2('passengerAge'), 'age'],
  [humanize2('passengerGender'), 'gender'],
  [humanize2('passengerNationality'), 'nationality'],
  [humanize2('passengerBerthChoice'), 'berth'],
  [humanize2('passengerFoodChoice'), 'food']
]) t(`irctc: ${ctrl}`, S.passengerKeyFor(ctrl), want);

const berthOpts = ['No Preference', 'Lower', 'Upper', 'Side Lower', 'Side Upper']
  .map(x => ({ value: x, text: x }));
t('berth Upper', RU.matchOption('Upper', berthOpts).text, 'Upper');
t('berth Side Lower', RU.matchOption('Side Lower', berthOpts).text, 'Side Lower');
const genderOpts = ['Gender', 'Male', 'Female', 'Transgender'].map(x => ({ value: x, text: x }));
t('gender Male', RU.matchOption('Male', genderOpts).text, 'Male');

const ADD_RE = /^(\+\s*)?add\s*(one\s*)?(more\s*)?(another\s*)?(passenger|traveller|traveler|person|adult|guest)/i;
t('add-passenger button matches', ADD_RE.test('+ Add Passenger/ Add Infant With Berth'), true);
t('infant button ignored', ADD_RE.test('+ Add Infant Without Berth'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
