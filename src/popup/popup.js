/* The popup reads the form first and only then offers to fill it, so the click
   that changes the page is always the user's and always informed. */
const view = document.getElementById('view');

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

/** Talk to the content script, injecting it first if this tab predates the install. */
async function ask(type, opts, tries = 2) {
  const tab = await activeTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, opts });
  } catch (e) {
    if (tries <= 0) throw e;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/common/schema.js', 'src/content/fields.js', 'src/content/files.js',
        'src/content/rules.js', 'src/content/filler.js', 'src/content/ui.js', 'src/content/main.js']
    });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/ui.css'] });
    return ask(type, opts, tries - 1);
  }
}

function waiting(text) {
  view.innerHTML = '';
  const s = el('div', 'state');
  s.append(el('span', 'spin'), el('span', null, text));
  view.append(s);
}

function message(text, isWarning) {
  view.innerHTML = '';
  view.append(el('p', isWarning ? 'warn' : 'note', text));
  const opts = el('button', null, 'Open my profile');
  opts.onclick = () => chrome.runtime.openOptionsPage();
  view.append(opts);
}

function row(label, value) {
  const li = el('li');
  li.append(el('span', null, label), el('b', null, String(value)));
  return li;
}

function render(p) {
  view.innerHTML = '';

  if (p.blocked) return message('Smartfill is switched off for this site.');
  if (p.profileEmpty) return message('Your profile is empty — add your details first.', true);
  if (!p.total && !p.uploads && !p.rows) return message('No empty fields found on this page.');

  const fillable = p.ready + (p.useAI ? p.unknown : 0) + (p.uploads && p.hasResume ? p.uploads : 0)
    + ((p.rows || p.canAddRows) ? p.savedPassengers : 0);

  const sum = el('div', 'sum');
  sum.append(el('span', 'big', String(fillable)), el('span', null, fillable === 1 ? 'field ready to fill' : 'fields ready to fill'));
  view.append(sum);

  const br = el('ul', 'br');
  if (p.ready) br.append(row('From your profile', p.ready));
  if (p.unknown) br.append(row(p.useAI ? 'Claude will work out' : 'Unmatched (AI is off)', p.unknown));
  if (p.uploads) br.append(row('Resume upload', p.hasResume ? 'ready' : 'none saved'));
  if (p.savedPassengers && (p.rows || p.canAddRows)) {
    br.append(row('Passenger rows', `${p.savedPassengers} saved, ${p.rows} on page`));
  }
  if (p.consents) br.append(row('Consents — yours to answer', p.consents));
  if (p.role) br.append(row('Role', p.role));
  view.append(br);

  const fill = el('button', 'pri', 'Autofill this form');
  fill.onclick = async () => {
    fill.disabled = true;
    fill.textContent = 'Filling…';
    await ask('SF_RUN', {});
    window.close();
  };
  view.append(fill);

  const over = el('button', null, 'Fill and replace existing values');
  over.onclick = async () => { await ask('SF_RUN', { overwrite: true }); window.close(); };

  const undo = el('button', null, 'Undo last fill');
  undo.onclick = async () => { await ask('SF_UNDO'); window.close(); };

  const opts = el('button', null, 'Edit my profile');
  opts.onclick = () => chrome.runtime.openOptionsPage();

  view.append(over, undo, opts);

  if (p.consents) {
    view.append(el('p', 'note', 'Consents and declarations are never answered automatically. Save your own answer for one in options and it will be reused from then on.'));
  }
  view.append(el('p', 'kbd', 'Alt+Shift+F anywhere'));
}

(async function init() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  try {
    const p = await ask('SF_PREVIEW');
    if (!p || !p.ok) throw new Error((p && p.error) || 'could not read the page');
    render(p);
    if (p.useAI && p.unknown && !apiKey) {
      const n = el('p', 'note', `Rules-only mode — ${p.unknown} unmatched field${p.unknown === 1 ? '' : 's'} will be left blank. Add your own Claude key in options to have those filled too.`);
      view.insertBefore(n, view.firstChild);
    }
  } catch (e) {
    message('Smartfill can\'t read this page. Chrome blocks extensions on its own pages and on the Web Store.', true);
  }
})();
