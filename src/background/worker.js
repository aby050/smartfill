import '../common/store.js';
import '../common/sync.js';

/* Service worker: the only place the API key is read, and the only place
   that talks to api.anthropic.com. Content scripts never see the key. */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-5';

const MAP_TOOL = {
  name: 'fill_fields',
  description: 'Return the value to type into each form field, using only the profile provided.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      mappings: {
        type: 'array',
        description: 'One entry per field you are confident about. Omit fields you cannot answer.',
        items: {
          type: 'object',
          properties: {
            sfid: { type: 'string', description: 'The id of the field, copied exactly from the input.' },
            key: { type: 'string', description: 'Which profile key this came from, or "composed" for text you wrote.' },
            value: { type: 'string', description: 'Exactly what to type. For a select or radio, the option text verbatim.' },
            confidence: { type: 'number', description: '0 to 1. Below 0.5 is discarded.' }
          },
          required: ['sfid', 'key', 'value', 'confidence'],
          additionalProperties: false
        }
      }
    },
    required: ['mappings'],
    additionalProperties: false
  }
};

const SYSTEM = `You map form fields to a person's saved profile. You are filling a form on their behalf, with their consent.

Rules:
- Use ONLY facts present in the profile. Never invent a name, date, number, address, employer or qualification.
- If no profile value answers a field, omit that field entirely. Omitting is always better than guessing.
- When a field lists options, your value must be one of those option texts, copied verbatim.
- Dates: match the format the field asks for. If the field gives no format, use DD/MM/YYYY.
- Yes/no questions: answer from the profile (e.g. work authorisation, relocation, sponsorship). If the profile is silent, omit.
- Free-text questions (cover letter, "why do you want this role", "tell us about yourself"): you may compose an answer, but build it only from the profile's summary, skills, experience and cover letter text, plus the page's job title and company. Write plainly, first person, no flattery, no invented achievements. Match any stated word or character limit. Set key to "composed".
- Never output a password, OTP, card number or government ID, even if one appears in the profile.
- Set confidence honestly. A field you are guessing at should score below 0.5 so it is discarded.`;


/* ---------- provider layer ----------
   One key field serves both providers: an Anthropic key starts "sk-ant", anything
   else is treated as a Google Gemini key. Both calls are "force one tool call, read
   back its arguments", so the rest of the worker doesn't care which one answered. */

const GEMINI_MODEL = 'gemini-3.8-flash';
const isGemini = key => !!key && !/^sk-ant/i.test(key);

function geminiSchema(node) {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties' || k === 'strict') continue;   // not in Gemini's schema subset
    out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : geminiSchema(v);
  }
  return out;
}

/** content: Anthropic-style blocks ({type:'text'} / {type:'document', source:{base64}}). */
async function callTool({ apiKey, model, system, tool, content, maxTokens, effort }) {
  if (isGemini(apiKey)) {
    const parts = content.map(b => b.type === 'document'
      ? { inlineData: { mimeType: b.source.media_type, data: b.source.data } }
      : { text: b.text });
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: geminiSchema(tool.input_schema) }] }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } },
          // Gemini's hidden thinking tokens count against the output cap, so never go low.
          generationConfig: { maxOutputTokens: Math.max(maxTokens || 0, 8192), temperature: 0.2 }
        })
      });
    } catch (e) {
      return { ok: false, error: 'Network error reaching Gemini: ' + (e.message || e) };
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const hint = res.status === 400 || res.status === 403 ? ' (check the API key)' : res.status === 429 ? ' (rate limited — try again shortly)' : '';
      return { ok: false, error: `Gemini API ${res.status}${hint}: ${(d.error && d.error.message || '').slice(0, 200)}` };
    }
    const data = await res.json();
    const cand = (data.candidates || [])[0];
    const call = cand && cand.content && (cand.content.parts || []).find(p => p.functionCall);
    if (!call) return { ok: false, error: 'Gemini returned no structured answer' + (cand && cand.finishReason ? ` (${cand.finishReason})` : '') + '.' };
    return { ok: true, input: call.functionCall.args || {}, usage: data.usageMetadata || null, model: GEMINI_MODEL };
  }

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens || 4000, system,
        thinking: { type: 'disabled' },
        ...(effort ? { output_config: { effort } } : {}),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content }]
      })
    });
  } catch (e) {
    return { ok: false, error: 'Network error reaching the Claude API: ' + (e.message || e) };
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { detail = await res.text().catch(() => ''); }
    const hint = res.status === 401 ? ' (check the API key)' : res.status === 429 ? ' (rate limited — try again shortly)' : '';
    return { ok: false, error: `Claude API ${res.status}${hint}: ${detail.slice(0, 200)}` };
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') return { ok: false, error: 'Claude declined: ' + (data.stop_details?.explanation || 'no reason given') };
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block || !block.input) return { ok: false, error: 'Claude returned no structured answer.' };
  return { ok: true, input: block.input, usage: data.usage || null, model: data.model };
}

async function getKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return apiKey || '';
}

async function callClaude(payload) {
  const apiKey = await getKey();
  if (!apiKey) return { ok: false, error: 'No API key set — open Smartfill options and paste your Claude or Gemini key.' };

  const { settings } = await chrome.storage.local.get('settings');
  const model = (settings && settings.model) || DEFAULT_MODEL;

  const userText = [
    `Page: ${payload.page.title} (${payload.page.host})`,
    payload.page.heading ? `Heading: ${payload.page.heading}` : '',
    payload.role ? `The person is applying as: ${payload.role}. Keep any composed text consistent with that.` : '',
    '',
    'PROFILE (the only source of truth):',
    JSON.stringify(payload.profile, null, 1),
    payload.custom && payload.custom.length ? 'EXTRA FIELDS:\n' + JSON.stringify(payload.custom) : '',
    '',
    payload.allowFreeText ? '' : 'Do NOT compose free-text answers; only map stored values.',
    '',
    'FIELDS TO FILL:',
    JSON.stringify(payload.fields, null, 1)
  ].filter(Boolean).join('\n');

  const r = await callTool({ apiKey, model, system: SYSTEM, tool: MAP_TOOL,
    content: [{ type: 'text', text: userText }], maxTokens: 8000, effort: 'low' });
  if (!r.ok) return r;
  const mappings = r.input.mappings;
  if (!Array.isArray(mappings)) return { ok: false, error: 'The model returned no usable mapping.' };

  return { ok: true, mappings, usage: r.usage, model: r.model };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type === 'SF_MAP_FIELDS') {
    callClaude(msg.payload).then(send).catch(e => send({ ok: false, error: String(e.message || e) }));
    return true; // keep the channel open for the async reply
  }
  if (msg.type === 'SF_TEST_KEY') {
    testKey(msg.apiKey, msg.model).then(send);
    return true;
  }
  if (msg.type === 'SF_RUN_ACTIVE') {
    runOnActiveTab(msg.opts || {}).then(() => send({ ok: true })).catch(e => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'SF_GET_RESUME') {
    getResume(msg.resumeId).then(send).catch(e => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'SF_PICK_ROLE') {
    pickRole(msg.payload).then(send).catch(() => send({ ok: false }));
    return true;
  }
  if (msg.type === 'SF_SCORE_FIT') {
    scoreFit(msg.payload).then(send).catch(e => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'SF_OPEN_OPTIONS') { chrome.runtime.openOptionsPage(); send({ ok: true }); }
  return false;
});

async function testKey(apiKey, model) {
  const ping = { name: 'ping', description: 'Reply ok.', input_schema: { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] } };
  const r = await callTool({ apiKey, model: model || DEFAULT_MODEL, system: 'Call the tool.', tool: ping,
    content: [{ type: 'text', text: 'ok' }], maxTokens: 64 });
  return r.ok ? { ok: true } : r;
}

/* Hand a stored resume to the content script as base64 — extension messaging
   cannot carry a Blob or an ArrayBuffer. */
async function getResume(resumeId) {
  const S = globalThis.SF_STORE;
  let rec = resumeId ? await S.get(resumeId) : null;
  if (!rec) {
    const { settings } = await chrome.storage.local.get('settings');
    const fallbackId = settings && settings.defaultResumeId;
    if (fallbackId && fallbackId !== resumeId) rec = await S.get(fallbackId);
  }
  if (!rec) {
    const all = await S.list();
    if (all.length === 1) rec = await S.get(all[0].id);
  }
  if (!rec) return { ok: false, error: 'no resume saved' };
  return { ok: true, data: await S.toBase64(rec.blob), filename: rec.filename, mime: rec.mime, id: rec.id };
}

const ROLE_TOOL = {
  name: 'choose_role',
  description: 'Pick which of the saved role profiles this job page is for.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      role_id: { type: 'string', description: 'The id of the best-fitting role, or an empty string if none fit.' },
      reason: { type: 'string', description: 'A few words on why.' }
    },
    required: ['role_id', 'reason'],
    additionalProperties: false
  }
};

/* Which saved role is this job page? Cheap call — Haiku is plenty. */
async function pickRole(payload) {
  const apiKey = await getKey();
  if (!apiKey || !payload.roles.length) return { ok: false };
  try {
    const r = await callTool({
      apiKey, model: 'claude-haiku-4-5', maxTokens: 300, tool: ROLE_TOOL,
      system: 'You match a job posting to one of a person\'s saved role profiles. Return an empty role_id if none is a reasonable fit — a wrong resume is worse than the default one.',
      content: [{ type: 'text', text: `ROLES:\n${JSON.stringify(payload.roles, null, 1)}\n\nJOB PAGE:\n${payload.signal}` }]
    });
    const id = r.ok && r.input.role_id;
    return id ? { ok: true, roleId: id, reason: r.input.reason } : { ok: false };
  } catch {
    return { ok: false };
  }
}


/* ---------- job fit score ----------
   Claude reads the resume PDF directly (the Messages API takes a base64 document
   block), so nothing here has to parse a PDF. DOC/DOCX can't be sent that way —
   those fall back to the profile text alone, and the reply says so. */

const FIT_TOOL = {
  name: 'report_fit',
  description: 'Score how well this candidate matches the job posting.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', description: '0-100. Be honest and calibrated: 50 is an average applicant, 80+ means a clearly strong match.' },
      verdict: { type: 'string', description: 'One short sentence on the overall fit.' },
      strengths: { type: 'array', items: { type: 'string' }, description: '2-4 specific things in the resume the posting asks for.' },
      gaps: { type: 'array', items: { type: 'string' }, description: '2-4 requirements the resume does not evidence. Empty array if genuinely none.' },
      missing_keywords: { type: 'array', items: { type: 'string' }, description: 'Terms the posting uses that the resume never mentions — useful for beating keyword filters.' },
      resume_tweaks: { type: 'array', items: { type: 'string' }, description: '1-3 concrete edits that would raise the score, each referring to something the candidate has actually done.' }
    },
    required: ['score', 'verdict', 'strengths', 'gaps', 'missing_keywords', 'resume_tweaks'],
    additionalProperties: false
  }
};

const FIT_SYSTEM = `You score a candidate against a job posting, for the candidate's own use before they apply.

Be calibrated and useful, not encouraging. An inflated score wastes their time on an application that will be filtered out. Judge only on evidence in the resume and profile text provided — absence of evidence is a gap, not a strength. Do not invent experience. If the posting is vague or you were given little to go on, say so in the verdict and keep the score near the middle rather than guessing high.`;

const FIT_TTL = 7 * 24 * 60 * 60 * 1000;

function fitKey(url, resumeId) {
  const clean = String(url || '').split(/[?#]/)[0];
  return 'fit:' + clean.slice(0, 180) + '|' + (resumeId || 'none');
}

async function scoreFit(payload) {
  const key = fitKey(payload.url, payload.resumeId);

  if (!payload.force) {
    const cached = (await chrome.storage.local.get(key))[key];
    if (cached && Date.now() - cached.at < FIT_TTL) return { ok: true, ...cached.fit, cached: true };
  }

  const apiKey = await getKey();
  if (!apiKey) return { ok: false, error: 'No API key set.' };
  const { settings } = await chrome.storage.local.get('settings');
  const model = (settings && settings.model) || DEFAULT_MODEL;

  const content = [];
  let resumeNote = 'No resume file was available; score from the profile text alone.';

  if (payload.resumeId) {
    const rec = await globalThis.SF_STORE.get(payload.resumeId);
    if (rec && rec.mime === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: await globalThis.SF_STORE.toBase64(rec.blob) }
      });
      resumeNote = `The attached PDF is the resume (${rec.filename}).`;
    } else if (rec && /^text\//.test(rec.mime)) {
      content.push({ type: 'text', text: 'RESUME:\n' + (await rec.blob.text()).slice(0, 40000) });
      resumeNote = `The resume text above is from ${rec.filename}.`;
    } else if (rec) {
      resumeNote = `The saved resume (${rec.filename}) is a ${rec.mime.includes('word') ? 'Word' : 'binary'} file, which cannot be read directly — score from the profile text and say so in the verdict.`;
    }
  }

  content.push({
    type: 'text',
    text: [
      resumeNote,
      '',
      'CANDIDATE PROFILE (their own words):',
      JSON.stringify(payload.profileBits, null, 1),
      payload.role ? `They are applying as: ${payload.role}.` : '',
      '',
      'JOB POSTING:',
      payload.jobTitle ? 'Title: ' + payload.jobTitle : '',
      payload.jobText
    ].filter(Boolean).join('\n')
  });

  const r = await callTool({ apiKey, model, system: FIT_SYSTEM, tool: FIT_TOOL, content, maxTokens: 2000, effort: 'medium' });
  if (!r.ok) return r;
  const fit = { ok: true, ...r.input, resumeId: payload.resumeId || null };
  await chrome.storage.local.set({ [key]: { at: Date.now(), fit } });
  return fit;
}

async function runOnActiveTab(opts) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SF_RUN', opts });
  } catch {
    // Content script not injected on this page (e.g. installed mid-session).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/common/schema.js', 'src/content/fields.js', 'src/content/files.js',
        'src/content/rules.js', 'src/content/filler.js', 'src/content/rows.js', 'src/content/ui.js', 'src/content/main.js']
    });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/ui.css'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'SF_RUN', opts });
  }
}

chrome.commands.onCommand.addListener(cmd => {
  if (cmd === 'smartfill-run') runOnActiveTab({});
});

chrome.runtime.onStartup.addListener(() => { globalThis.SF_SYNC.pullIfNewer().catch(() => {}); });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'sf-fill', title: 'Smartfill this form', contexts: ['page', 'editable'] });
  chrome.contextMenus.create({ id: 'sf-fill-over', title: 'Smartfill (replace existing values)', contexts: ['page', 'editable'] });
  // A fresh install on a machine signed into the same Google account should come
  // up already filled in, rather than waiting for the options page to be opened.
  // Open options when there is no profile yet — not when there is no API key,
  // which is optional and shouldn't look like a setup step.
  globalThis.SF_SYNC.pullIfNewer()
    .catch(() => ({}))
    .then(() => chrome.storage.local.get('profile'))
    .then(({ profile }) => {
      if (!profile || !Object.keys(profile).length) chrome.runtime.openOptionsPage();
    });
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'sf-fill') runOnActiveTab({});
  if (info.menuItemId === 'sf-fill-over') runOnActiveTab({ overwrite: true });
});

globalThis.__sfRun = runOnActiveTab;
