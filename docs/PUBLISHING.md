# Publishing Smartfill to the Chrome Web Store

## Before you move or publish anything: export your data

An unpacked extension's ID is derived from its folder path. A published one gets an
ID assigned by the store. **Every ID change gives you a blank slate** — `chrome.storage`
(profile, roles, standing answers) and IndexedDB (your resume files) are keyed to the ID,
not to you.

So, in this order:

1. In the **current** extension: options → **Export everything (JSON)**. Keep the file.
2. Load / install the new copy.
3. Options → **Import backup** → pick that file.
4. Paste the API key again (never exported, on purpose).

Skipping step 1 loses your resumes — they are the one thing account sync cannot carry.

## Package it

```bash
./package.sh
```

Writes `smartfill-<version>.zip` containing only `manifest.json`, `icons/` and `src/`.
`test/`, the markdown files and `package.sh` itself are excluded — the store rejects
packages carrying files the manifest never references.

Bump `version` in `manifest.json` before each upload. The store refuses a version it
has already seen, and versions only go up.

## One-time setup

1. **Developer account** — [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole),
   **$5 one-time fee**, paid by card. Sign in with the Google account that should own it.
2. **Verify your email and, for a public listing, your identity.** Unverified publishers
   can only publish unlisted items.
3. **A privacy policy at a public URL.** Mandatory here — the extension handles personal
   data. Any static host works (GitHub Pages, Cloudflare Pages). It must state plainly: data is stored locally in the browser, form
   fields and profile text are sent to Anthropic's API to be matched, resume files are
   sent only when the user asks for a fit score, identity-document numbers are never sent,
   and nothing is sold or shared with anyone else.

## The listing

| Field | What to put |
|---|---|
| Name | Smartfill — AI Form Autofill |
| Summary | 132 characters max. "Fills job applications and signup forms from your saved profile, attaches the right resume, and scores your fit." |
| Description | The README's opening sections, rewritten without the developer detail |
| Category | Productivity / Workflow & Planning |
| Language | English |
| Icon | `icons/icon128.png` (already the right size) |
| Screenshots | **1280×800 or 640×400, at least one, up to five.** You have to take these — load the extension, open `test/form.html`, and capture: the popup preview, the review panel mid-fill, the fit score, the options page |
| Promo tile | 440×280, optional unless you want to be featured |

## Permission justifications

The console makes you justify each one in a text box. Review rejects vague answers.
Draft text, edit to taste:

- **`storage`** — "Stores the user's own profile, role settings and saved answers locally,
  and syncs the text portion through their Chrome account so a second machine works
  without re-entering it."
- **`unlimitedStorage`** — "Resume files are held in IndexedDB. A few PDFs exceed the
  default quota."
- **`activeTab` / `scripting`** — "The content script is injected into the tab the user
  invoked the extension on, so a form can be read and filled. Needed for tabs that were
  already open when the extension was installed."
- **`contextMenus`** — "Adds a right-click item to fill the form on the current page."
- **Host permission `<all_urls>`** — "The user chooses which page to fill; a form can be
  on any site, so no narrower list is possible. The extension reads nothing until the user
  clicks its icon or presses its shortcut."
- **Remote code** — answer **No.** The extension loads no external scripts. It makes HTTPS
  requests to `api.anthropic.com` carrying data, which is not remote code.

## Data disclosures

You must tick what the extension collects and certify three statements. Truthfully:

- **Collects:** personally identifiable information (name, address, email, phone),
  and "website content" (the form fields it reads).
- **Does not collect:** health, financial, authentication, location, activity, or
  personal communications.
- Certify: not sold to third parties; not used for anything unrelated to the single
  purpose; not used to determine creditworthiness or for lending. All three are true.
- **Single purpose statement:** "Fill web forms on the user's behalf from a profile they
  have entered themselves."

## Expect a slow review

`<all_urls>` plus PII collection puts this in the manual-review queue. Days, sometimes
two to three weeks, and a rejection usually names one fixable thing. Two ways to shorten it:

- **Publish unlisted first.** The item gets a real ID and install link, only people with
  the link can find it, and review is lighter. This is the right first step for something
  only you use.
- **Drop `<all_urls>`** in favour of `optional_host_permissions`, so Chrome asks for
  access to a site the first time you fill a form there. Materially easier to justify,
  and honest about what the extension does. Costs a refactor of the content-script
  injection path and breaks "fill automatically on page load", which is off by default
  anyway. Worth doing if a public listing is the goal.

## The alternative: don't publish

If this is only for your own machines, the store is optional. Keep the unpacked folder
somewhere permanent and it survives reboots. To move it to a second machine without the
store, copy the folder and use Export/Import.
