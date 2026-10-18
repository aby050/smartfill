/* Profile schema shared by the options page and the content script.
   Loaded as a plain script, so it publishes onto globalThis. */
(function () {
  const SECTIONS = [
    {
      id: 'personal',
      title: 'Personal',
      fields: [
        { key: 'firstName', label: 'First name' },
        { key: 'middleName', label: 'Middle name' },
        { key: 'lastName', label: 'Last name' },
        { key: 'fullName', label: 'Full name', derived: p => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') },
        { key: 'preferredName', label: 'Preferred name / nickname' },
        { key: 'dob', label: 'Date of birth', type: 'date', hint: 'Stored as YYYY-MM-DD; reformatted per form.' },
        { key: 'gender', label: 'Gender' },
        { key: 'maritalStatus', label: 'Marital status' },
        { key: 'nationality', label: 'Nationality' },
        { key: 'placeOfBirth', label: 'Place of birth' },
        { key: 'fatherName', label: "Father's name" },
        { key: 'motherName', label: "Mother's name" }
      ]
    },
    {
      id: 'contact',
      title: 'Contact',
      fields: [
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'altEmail', label: 'Alternate email', type: 'email' },
        { key: 'phone', label: 'Phone', hint: 'Include country code, e.g. +91 87700 39953' },
        { key: 'altPhone', label: 'Alternate phone' },
        { key: 'website', label: 'Website' },
        { key: 'linkedin', label: 'LinkedIn URL' },
        { key: 'github', label: 'GitHub URL' },
        { key: 'portfolio', label: 'Portfolio URL' }
      ]
    },
    {
      id: 'address',
      title: 'Address',
      fields: [
        { key: 'addressLine1', label: 'Address line 1' },
        { key: 'addressLine2', label: 'Address line 2' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State / province' },
        { key: 'postalCode', label: 'Postal / ZIP code' },
        { key: 'country', label: 'Country' },
        { key: 'countryCode', label: 'Country code (ISO-2)', hint: 'e.g. IN, US' },
        { key: 'fullAddress', label: 'Full address (one line)', derived: p => [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode, p.country].filter(Boolean).join(', ') }
      ]
    },
    {
      id: 'work',
      title: 'Professional',
      fields: [
        { key: 'currentTitle', label: 'Current job title' },
        { key: 'currentCompany', label: 'Current company' },
        { key: 'yearsExperience', label: 'Years of experience' },
        { key: 'noticePeriod', label: 'Notice period' },
        { key: 'currentSalary', label: 'Current salary' },
        { key: 'expectedSalary', label: 'Expected salary' },
        { key: 'startDate', label: 'Earliest start date', type: 'date' },
        { key: 'workAuth', label: 'Work authorisation' },
        { key: 'requiresSponsorship', label: 'Requires visa sponsorship', type: 'bool' },
        { key: 'willingToRelocate', label: 'Willing to relocate', type: 'bool' },
        { key: 'skills', label: 'Skills', type: 'textarea' },
        { key: 'summary', label: 'Professional summary', type: 'textarea' },
        { key: 'coverLetter', label: 'Default cover letter', type: 'textarea', hint: 'Claude uses this as raw material when a form asks an open question.' }
      ]
    },
    {
      id: 'education',
      title: 'Education',
      fields: [
        { key: 'highestDegree', label: 'Highest degree' },
        { key: 'fieldOfStudy', label: 'Field of study' },
        { key: 'university', label: 'University / college' },
        { key: 'gradYear', label: 'Graduation year' },
        { key: 'gpa', label: 'GPA / percentage' }
      ]
    },
    {
      id: 'ids',
      title: 'Identity documents',
      sensitive: true,
      fields: [
        { key: 'panNumber', label: 'PAN number' },
        { key: 'aadhaarNumber', label: 'Aadhaar number' },
        { key: 'passportNumber', label: 'Passport number' },
        { key: 'driversLicense', label: "Driver's licence" },
        { key: 'taxId', label: 'Tax ID' }
      ]
    },
    {
      id: 'misc',
      title: 'Other',
      fields: [
        { key: 'referral', label: 'Referred by' },
        { key: 'howHeard', label: 'How did you hear about us' }
      ]
    }
  ];

  const ALL_FIELDS = SECTIONS.flatMap(s => s.fields.map(f => ({ ...f, section: s.id, sensitive: !!s.sensitive })));
  const SENSITIVE_KEYS = new Set(ALL_FIELDS.filter(f => f.sensitive).map(f => f.key));

  /** Profile with derived values (fullName, fullAddress) resolved. */
  function resolve(profile) {
    const p = { ...(profile || {}) };
    for (const f of ALL_FIELDS) {
      if (f.derived && !p[f.key]) {
        const v = f.derived(p);
        if (v) p[f.key] = v;
      }
    }
    for (const c of (profile?.customFields || [])) {
      if (c.key && c.value) p[c.key] = c.value;
    }
    return p;
  }

  const DEFAULT_SETTINGS = {
    model: 'claude-sonnet-5',
    useAI: true,
    aiForFreeText: true,
    autofillOnLoad: false,
    confirmSensitive: true,
    attachResume: true,
    syncEnabled: true,
    showLauncher: true,
    launcherOffHosts: [],
    aiPickRole: true,
    blockedHosts: [],
    learnFromTyping: true,  // remember answers typed by hand into fields Smartfill could not place
    autoScore: true,        // score every job page against the resume as it loads
    applyMin: 70,           // score at or above -> "Apply"
    skipBelow: 50,          // score below -> "Skip"; in between -> "Maybe"
    autoApply: false,       // opt-in: fill, advance and submit with no clicks
    autoApplyMin: 80,       // never auto-submit below this score
    autoApplyMaxSteps: 8
  };

  /** Apply / Maybe / Skip for a 0-100 fit score. */
  function verdictFor(score, st) {
    const s = { applyMin: 70, skipBelow: 50, ...(st || {}) };
    const n = Number(score);
    if (!isFinite(n)) return 'maybe';
    if (n >= s.applyMin) return 'apply';
    if (n < s.skipBelow) return 'skip';
    return 'maybe';
  }

  /** A question's label reduced to a stable key: lower-case, no asterisks / "(required)" / colon. */
  function learnKey(label) {
    return String(label || '').toLowerCase().replace(/\(required\)|\(optional\)|[*:]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 90);
  }
  const NEVER_LEARN_RE = /(aadhaar|aadhar|\bpan\b|passport|ssn|social security|tax.?id|licen[cs]e|password|otp|cvv|card|captcha|signature)/i;
  /** Is this hand-typed value worth keeping for next time? */
  function worthLearning(key, value, kind) {
    const v = String(value || '').trim();
    if (key.length < 4 || !v || v.length > 200) return false;
    if (kind === 'textarea' || kind === 'richtext') return false;   // job-specific prose; Claude writes those
    if (NEVER_LEARN_RE.test(key)) return false;
    if (/^\d{12}$/.test(v.replace(/\s/g, ''))) return false;       // looks like an ID number
    return true;
  }

  const SUBMIT_RE = /^(submit( my)?( application)?|apply( now)?|send( my)?( application)?|finish|complete application)$/i;
  const NEXT_RE = /^(next|continue|save (and|&) continue|next step|proceed|review)$/i;
  /** What a button does in an application flow: 'submit', 'next' or null. */
  function buttonRole(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 30) return null;
    if (SUBMIT_RE.test(t)) return 'submit';
    if (NEXT_RE.test(t)) return 'next';
    return null;
  }

  /* ---- passengers ----
     Multi-row forms (rail/air booking, group applications) repeat the same block
     per traveller. Stored in order; row 1 gets passengers[0], and so on. */

  const PASSENGER_FIELDS = [
    { key: 'name', label: 'Name (as on ID)' },
    { key: 'age', label: 'Age' },
    { key: 'gender', label: 'Gender' },
    { key: 'berth', label: 'Berth preference' },
    { key: 'food', label: 'Food preference' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'idType', label: 'ID card type' },
    { key: 'idNumber', label: 'ID card number', sensitive: true }
  ];

  /* Which profile-ish key a field inside a passenger row is asking for. */
  const PASSENGER_RULES = [
    ['name', [/\bname\b/, /passenger.?name/, /traveller.?name/, /full.?name/]],
    ['age', [/\bage\b/, /\byrs\b/, /years/]],
    ['gender', [/\bgender\b/, /\bsex\b/, /\bm\/f\b/]],
    ['berth', [/berth/, /\bseat.?pref/, /coach.?pref/, /lower|upper|side/]],
    ['food', [/food/, /\bmeal\b/, /catering/, /veg\b/, /\bdiet/]],
    ['nationality', [/nationality/, /\bcountry\b/]],
    ['idType', [/id.?(card.?)?type/, /proof.?type/, /document.?type/]],
    ['idNumber', [/id.?(card.?)?(number|no)/, /proof.?number/, /document.?number/]]
  ];

  function passengerKeyFor(haystack) {
    const hay = String(haystack || '').toLowerCase();
    for (const [key, pats] of PASSENGER_RULES) {
      if (pats.some(r => r.test(hay))) return key;
    }
    return null;
  }

  /* ---- standing answers ----
     Questions a form asks that no profile field covers: consents, declarations,
     eligibility statements. The user sets each answer ONCE, here. The extension
     only ever replays a decision they already made — it never originates one,
     which is why a consent can be filled from this list but never by the model. */

  const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Best standing answer for a field, or null. Longest match wins. */
  function matchAnswer(answers, haystack) {
    const hay = norm(haystack);
    let best = null;
    for (const a of answers || []) {
      const m = norm(a.match);
      if (!m || !a.value) continue;
      if (!hay.includes(m)) continue;
      if (!best || m.length > norm(best.match).length) best = a;
    }
    return best;
  }

  /* Seeds for the questions almost every application asks. Consent items ship
     with an EMPTY value on purpose — the user picks those themselves. */
  const COMMON_ANSWERS = [
    { match: 'what is your nationality', value: '', hint: 'e.g. Indian' },
    { match: 'require a visa', value: '', hint: 'Do you need sponsorship to work there?' },
    { match: 'legally authorized to work', value: '', hint: 'Yes / No' },
    { match: 'require sponsorship', value: '', hint: 'Yes / No' },
    { match: 'willing to relocate', value: '', hint: 'Yes / No' },
    { match: 'notice period', value: '', hint: 'e.g. 30 days' },
    { match: 'government official', value: '', hint: 'Usually No' },
    { match: 'confirm that i do not have any relatives', value: '', consent: true, hint: 'Declaration that you have no relatives at the company' },
    { match: 'any relatives working in', value: '', hint: 'Yes/no version of the relatives question' },
    { match: 'previously applied', value: '', hint: 'Yes / No' },
    { match: 'previously worked', value: '', hint: 'Yes / No' },
    { match: 'criminal', value: '', hint: 'Usually No' },
    { match: 'how did you hear', value: '', hint: 'e.g. Company website' },
    { match: 'specified in this consent', value: '', consent: true, hint: 'Confirms your resume holds no extra personal data' },
    { match: 'consent to the required collection', value: '', consent: true, hint: 'Required consent — your decision' },
    { match: 'privacy policy', value: '', consent: true, hint: 'Required consent — your decision' },
    { match: 'reference check', value: '', consent: true, hint: 'Optional consent — your decision' },
    { match: 'recordings of the interview', value: '', consent: true, hint: 'Optional consent — your decision' },
    { match: 'recruitment notifications', value: '', consent: true, hint: 'Optional consent — marketing contact' },
    { match: 'collected and used on an ongoing basis', value: '', consent: true, hint: 'Optional consent — data kept for future roles' },
    { match: 'acknowledge and agree', value: '', consent: true, hint: 'Declaration — your decision' }
  ];

  /* ---- role profiles ----
     A role is a named variant: its own resume, plus overrides for the handful of
     fields that actually differ between "Product Manager" and "Project Manager". */

  const ROLE_OVERRIDE_KEYS = [
    'currentTitle', 'summary', 'skills', 'coverLetter',
    'expectedSalary', 'linkedin', 'portfolio', 'website'
  ];

  /** Score each role against the job page's text. Returns the best, or null. */
  function matchRole(roles, text) {
    const hay = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    let best = null;
    for (const role of roles || []) {
      let score = 0;
      for (const kw of (role.keywords || [])) {
        const k = String(kw).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!k) continue;
        if (hay.includes(' ' + k + ' ')) score += k.includes(' ') ? 3 : 2;  // phrases beat single words
      }
      if (score > 0 && (!best || score > best.score)) best = { role, score };
    }
    return best;
  }

  /** Merge a role's overrides over the base profile. */
  function applyRole(profile, role) {
    if (!role) return profile;
    const out = { ...profile };
    for (const k of ROLE_OVERRIDE_KEYS) {
      const v = role.overrides && role.overrides[k];
      if (v && String(v).trim()) out[k] = v;
    }
    return out;
  }

  globalThis.SF_SCHEMA = {
    SECTIONS, ALL_FIELDS, SENSITIVE_KEYS, resolve, DEFAULT_SETTINGS,
    ROLE_OVERRIDE_KEYS, matchRole, applyRole, matchAnswer, COMMON_ANSWERS,
    PASSENGER_FIELDS, passengerKeyFor, verdictFor, buttonRole, learnKey, worthLearning
  };
})();
