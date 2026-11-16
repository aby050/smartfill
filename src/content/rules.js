/* Deterministic field -> profile-key matching. Runs first, costs nothing,
   and handles the ~80% of fields that are named sanely. Whatever it can't
   place with confidence is handed to Claude. */
(function () {
  // WHATWG autocomplete tokens are authoritative when present.
  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'additional-name': 'middleName', 'family-name': 'lastName',
    'name': 'fullName', 'nickname': 'preferredName', 'honorific-prefix': null,
    'email': 'email', 'tel': 'phone', 'tel-national': 'phone', 'url': 'website',
    'street-address': 'fullAddress', 'address-line1': 'addressLine1', 'address-line2': 'addressLine2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'postalCode',
    'country': 'countryCode', 'country-name': 'country', 'bday': 'dob',
    'organization': 'currentCompany', 'organization-title': 'currentTitle'
  };

  // [profileKey, [positive regexes], [negative regexes]] — order matters:
  // more specific keys are listed before the generic ones they'd collide with.
  const RULES = [
    ['firstName', [/\bfirst.?name\b/, /\bgiven.?name\b/, /\bfname\b/, /^first$/, /\bforename\b/]],
    ['lastName', [/\blast.?name\b/, /\bfamily.?name\b/, /\blname\b/, /^last$/, /\bsurname\b/]],
    ['middleName', [/\bmiddle.?(name|initial)\b/, /\bmname\b/]],
    ['preferredName', [/\bpreferred.?name\b/, /\bnick.?name\b/, /\bdisplay.?name\b/, /\bknown as\b/]],
    ['fullName', [/\bfull.?name\b/, /\byour name\b/, /\bname of (the )?(applicant|candidate)\b/, /\bapplicant.?name\b/, /^name$/, /\bcontact name\b/],
      [/user.?name/, /company/, /organi[sz]ation/, /school/, /college/, /universit/, /file.?name/, /father/, /mother/, /spouse/, /referen/, /emergency/]],

    ['fatherName', [/father'?s?.?name/, /\bfather\b/]],
    ['motherName', [/mother'?s?.?name/, /\bmother\b/]],

    ['altEmail', [/(alternate|alternative|secondary|other).?e.?mail/]],
    ['email', [/\be.?mail\b/, /\bemail address\b/], [/alternate/, /secondary/, /confirm/, /re.?enter/, /verify/]],
    ['altPhone', [/(alternate|alternative|secondary|other|work|home).?(phone|mobile|contact number)/]],
    ['phone', [/\bphone\b/, /\bmobile\b/, /\btelephone\b/, /\bcontact number\b/, /\bcell\b/, /\bwhatsapp\b/], [/country.?code/, /dial.?code/, /\bisd\b/, /extension/, /\bext\b/]],

    ['linkedin', [/linked.?in/, /\bli profile\b/,
      /(public|social|online|professional)?.?profile.?(url|link|address)/,
      /profile.?(url|link)/, /social.?(media|profile).?(url|link|handle)?/]],
    ['github', [/git.?hub/]],
    ['portfolio', [/portfolio/, /\bbehance\b/, /\bdribbble\b/]],
    ['website', [/\bwebsite\b/, /\bpersonal site\b/, /\bblog\b/, /\bhomepage\b/, /\burl\b/], [/linked/, /git/, /portfolio/, /company/]],

    ['addressLine2', [/address.?(line.?)?2/, /\bapt\b/, /\bapartment\b/, /\bsuite\b/, /\bunit\b/, /\blandmark\b/, /address 2/]],
    ['addressLine1', [/address.?(line.?)?1/, /\bstreet\b/, /\bstreet address\b/, /address 1/, /\bhouse\b/, /\bflat\b/]],
    ['city', [/\bcity\b/, /\btown\b/, /\blocality\b/, /\bdistrict\b/, /address.?level.?2/]],
    ['state', [/\bstate\b/, /\bprovince\b/, /\bregion\b/, /\bcounty\b/, /address.?level.?1/], [/statement/, /united states/, /marital/, /employment/]],
    ['postalCode', [/\bpostal.?code\b/, /\bzip\b/, /\bpin.?code\b/, /\bpostcode\b/], [/pin number/]],
    ['dialCode', [/\bdial.?code\b/, /\bisd\b/, /calling code/, /phone.?code/, /country.?code.*(phone|mobile)|(phone|mobile).*country.?code/]],
    ['countryCode', [/country.?code/]],
    ['country', [/\bcountry\b/, /\bnation\b/], [/code/, /nationality/]],
    ['fullAddress', [/\bfull address\b/, /\bcomplete address\b/, /\bmailing address\b/, /\bresidential address\b/, /^address$/]],

    ['dob', [/\bdate of birth\b/, /\bbirth.?date\b/, /\bd\.?o\.?b\b/, /\bbday\b/, /\bborn on\b/]],
    ['placeOfBirth', [/place of birth/, /birth.?place/]],
    ['gender', [/\bgender\b/, /\bsex\b/], [/sexual orientation/]],
    ['maritalStatus', [/\bmarital\b/, /\bmarriage status\b/]],
    ['nationality', [/\bnationality\b/, /\bcitizenship\b/, /\bcitizen of\b/]],

    ['currentTitle', [/\b(current |present )?(job )?title\b/, /\b(current|present) (position|role|designation)\b/, /\bdesignation\b/, /\bposition held\b/, /\brole\b/, /\boccupation\b/],
      [/title of/, /mr\b/, /honorific/, /job you/, /position applied/, /applying/]],
    ['currentCompany', [/\b(current |present )?(company|employer|organi[sz]ation)\b/, /\bworking at\b/], [/previous/, /school/, /college/]],
    ['yearsExperience', [/years? of experience/, /\btotal experience\b/, /\bexperience \(years\)/, /\byrs? exp\b/, /\bwork experience\b/]],
    ['noticePeriod', [/notice period/, /how soon can you join/, /availability to join/]],
    ['expectedSalary', [/expected (ctc|salary|compensation|pay)/, /\badd salary\b/, /\bdesired (pay|rate)\b/, /salary expectation/, /desired salary/]],
    ['currentSalary', [/current (ctc|salary|compensation|pay)/, /present salary/]],
    ['startDate', [/start date/, /available from/, /earliest.*(start|join)/, /joining date/]],
    ['workAuth', [/work authori[sz]ation/, /authorized to work/, /legally (eligible|authorized) to work/, /right to work/]],
    ['requiresSponsorship', [/sponsor/, /visa sponsorship/, /require sponsorship/]],
    ['willingToRelocate', [/relocat/]],
    ['skills', [/\bskills?\b/, /\btechnolog(y|ies)\b/, /\bcompetenc/]],
    ['summary', [/\bsummary\b/, /\babout (you|yourself|me)\b/, /\bbio\b/, /\bprofile\b/, /\bintroduc/], [/company/, /job summary/]],
    ['coverLetter', [/cover.?letter/, /\bmotivation\b/, /why do you want/, /why are you/, /tell us (about|why)/, /message to.*(hiring|recruiter)/, /additional information/]],

    ['highestDegree', [/\bdegree\b/, /\bqualification\b/, /\beducation level\b/, /\bhighest (education|degree)\b/]],
    ['fieldOfStudy', [/field of study/, /\bmajor\b/, /\bdiscipline\b/, /\bspeciali[sz]ation\b/, /\bstream\b/, /\bbranch\b/]],
    ['university', [/\buniversit/, /\bcollege\b/, /\bschool\b/, /\binstitut/, /\balma mater\b/]],
    ['gradYear', [/graduation year/, /year of (passing|graduation|completion)/, /\bpassing year\b/, /\bgrad year\b/]],
    ['gpa', [/\bgpa\b/, /\bcgpa\b/, /\bpercentage\b/, /\bmarks\b/, /\bgrade\b/], [/upgrade/]],

    ['panNumber', [/\bpan\b/, /permanent account number/]],
    ['aadhaarNumber', [/\baadha?ar\b/, /\buidai\b/]],
    ['passportNumber', [/\bpassport\b/]],
    ['driversLicense', [/driver'?s? licen[cs]e/, /\bdl number\b/, /\bdriving licen[cs]e\b/]],
    ['taxId', [/\btax id\b/, /\btin\b/, /\bvat\b/, /\bgstin?\b/]],

    ['referral', [/referr(ed|al)/, /\bref(erence)? code\b/, /who referred/]],
    ['howHeard', [/how did you (hear|find|learn)/, /where did you hear/, /source/], [/open source/]]
  ];

  const BOOL_TRUE = /^(yes|true|y|1|i (do|am|have)|authorized|eligible)$/i;

  function score(field, profile) {
    const hay = field.haystack;

    // A "Title" made of Mr / Mrs / Ms is a salutation, not the job title.
    if (field.options && field.options.some(o => /^(mr|mrs|ms|miss|dr)\.?$/i.test(String(o.text || o.value).trim()))) return null;

    // 1. autocomplete token wins outright.
    const ac = field.attrs.autocomplete.split(/\s+/).pop();
    if (ac && AUTOCOMPLETE[ac] && profile[AUTOCOMPLETE[ac]]) {
      return { key: AUTOCOMPLETE[ac], score: 1.0, via: 'autocomplete' };
    }
    // 2. input type is a strong hint for a couple of keys.
    if (field.kind === 'email' && profile.email) return { key: 'email', score: 0.95, via: 'type' };
    if (field.kind === 'tel' && profile.phone) return { key: 'phone', score: 0.9, via: 'type' };

    // 3. Regex rules, first match wins (list is ordered specific -> generic).
    for (const [key, pos, neg] of RULES) {
      if (!has(profile, key)) continue;
      if (neg && neg.some(r => r.test(hay))) continue;
      for (const r of pos) {
        if (r.test(hay)) {
          // A match in the label text is worth more than one in a mangled id.
          const inLabel = (field.label || '').toLowerCase();
          const s = r.test(inLabel) ? 0.9 : 0.72;
          return { key, score: s, via: 'rule' };
        }
      }
    }
    // 4. Custom fields match on their own key text.
    for (const c of (profile.__custom || [])) {
      if (c.key && hay.includes(c.key.toLowerCase())) return { key: c.key, score: 0.8, via: 'custom' };
    }
    return null;
  }

  function has(profile, key) {
    const v = profile[key];
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  /* ---- value shaping ---- */

  function formatDate(iso, field) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
    if (!m) return iso;
    const [, y, mo, d] = m;
    if (field.kind === 'date') return `${y}-${mo}-${d}`;          // native picker
    if (field.kind === 'month') return `${y}-${mo}`;
    const hint = (field.haystack + ' ' + (field.attrs.placeholder || '')).toLowerCase();
    if (/dd\s*[\/.-]\s*mm\s*[\/.-]\s*yyyy/.test(hint)) return `${d}/${mo}/${y}`;
    if (/mm\s*[\/.-]\s*dd\s*[\/.-]\s*yyyy/.test(hint)) return `${mo}/${d}/${y}`;
    if (/yyyy\s*[\/.-]\s*mm\s*[\/.-]\s*dd/.test(hint)) return `${y}-${mo}-${d}`;
    return `${d}/${mo}/${y}`;
  }

  function shape(value, field, key) {
    let v = String(value);
    if (key === 'dob' || key === 'startDate' || field.kind === 'date' || field.kind === 'month') {
      v = formatDate(v, field);
    }
    if (key === 'phone' || field.kind === 'tel') {
      const digitsOnly = /^[\d\s()+-]+$/.test(v);
      if (digitsOnly) {
        // Strip the country code when the field is clearly national-length.
        const max = field.attrs.maxlength;
        const bare = v.replace(/[^\d]/g, '');
        if (max && bare.length > max) v = bare.slice(-max);
        else if (/\bnational\b|\b10 digit\b/.test(field.haystack) && bare.length > 10) v = bare.slice(-10);
      }
    }
    if (key === 'linkedin' || key === 'github' || key === 'portfolio' || key === 'website') {
      v = shapeUrl(v, field, key);
    }
    if (field.kind === 'number') v = v.replace(/[^\d.]/g, '');
    if (field.attrs.maxlength && v.length > field.attrs.maxlength) v = v.slice(0, field.attrs.maxlength);
    return v;
  }

  const LINKEDIN_HOST = 'https://www.linkedin.com/in/';

  /** A LinkedIn field may want the full URL, or just the handle. Read the field. */
  function shapeUrl(v, field, key) {
    v = v.trim();
    const hint = (field.haystack + ' ' + (field.attrs.placeholder || '')).toLowerCase();
    // A placeholder that is itself a URL means the site wants the full URL, whatever else the hint says.
    const urlPlaceholder = /^https?:\/\//i.test(field.attrs.placeholder || '');
    const wantsHandle = !urlPlaceholder && (/\b(handle|username|user name)\b/.test(hint) ||
      /linkedin\.com\/in\/?$/.test(field.attrs.placeholder || '') ||
      (field.attrs.maxlength && field.attrs.maxlength < 40));

    if (key === 'linkedin') {
      // Accept anything the user typed: a full URL, "in/abhay", or a bare handle.
      const m = /linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i.exec(v);
      const handle = m ? m[1] : (/^[\w.-]+$/.test(v) ? v : null);
      if (wantsHandle && handle) return handle;
      if (handle) return LINKEDIN_HOST + handle;
    }
    if (wantsHandle) {
      const seg = v.replace(/^https?:\/\//i, '').split('/').filter(Boolean).pop();
      if (seg) return seg;
    }
    if (!/^https?:\/\//i.test(v) && /\./.test(v)) return 'https://' + v;
    return v;
  }

  /** Map a value onto the closest <option>/radio, or null if nothing is close. */
  function matchOption(value, options) {
    if (!options || !options.length) return null;
    const want = norm(value);
    if (!want) return null;
    const cands = options.map(o => ({ o, t: norm(o.text), v: norm(o.value) }));

    let hit = cands.find(c => c.t === want || c.v === want);
    if (hit) return hit.o;

    // A number against range options: 12 -> "7+ years", 5 -> "4 - 6 years", 0.5 -> "Less than 1 year".
    // For open-ended "N+" options take the largest N that still fits, not the first.
    if (/^\d+(\.\d+)?$/.test(String(value).trim())) {
      const n = Number(value);
      let open = null;
      for (const c of cands) {
        const txt = String(c.o.text || c.o.value || '').toLowerCase().replace(/\s+/g, ' ').trim();
        let m;
        if ((m = /^(\d+)\s*(?:-|–|to)\s*(\d+)/.exec(txt)) && n >= +m[1] && n <= +m[2] + 0.99) return c.o;   // "4 - 6 years"
        if ((m = /^(?:less than|under|below)\s*(\d+)/.exec(txt)) && n < +m[1]) return c.o;                    // "Less than 1 year"
        if ((m = /^(\d+)\s*(\+|plus|or more)/.exec(txt)) && n >= +m[1] && (!open || +m[1] > open.min)) open = { min: +m[1], o: c.o };
      }
      if (open) return open.o;
    }

    // Booleans expressed as yes/no options.
    if (/^(true|yes)$/i.test(value)) hit = cands.find(c => /^(yes|y|true)$/.test(c.t));
    if (/^(false|no)$/i.test(value)) hit = cands.find(c => /^(no|n|false)$/.test(c.t));
    if (hit) return hit.o;

    // A whole word/number beats a substring: "91" is "IN +91", not "BO +591".
    hit = cands.find(c => c.t.split(' ').includes(want));
    if (hit) return hit.o;

    hit = cands.find(c => c.t.startsWith(want) || want.startsWith(c.t));
    if (hit) return hit.o;
    hit = cands.find(c => c.t.includes(want) || (want.length > 3 && want.includes(c.t) && c.t.length > 3));
    if (hit) return hit.o;
    return null;
  }

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  globalThis.SF_RULES = { score, shape, shapeUrl, matchOption, formatDate, BOOL_TRUE, norm };
})();
