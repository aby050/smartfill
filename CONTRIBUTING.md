# Contributing to Smartfill

Thanks for taking the time to contribute. This guide keeps reviews quick and the codebase consistent.

## Ground rules

- **Privacy first.** Smartfill must never send passwords, OTPs, card data or identity-document
  numbers anywhere, and must never answer a consent or declaration on the user's behalf.
  Pull requests that weaken either guarantee will not be merged.
- **Rules before AI.** If a field can be matched deterministically, add a rule in
  `src/content/rules.js` rather than relying on the Claude fallback.
- **No build step.** The extension is plain JavaScript loaded unpacked. Please don't add a
  bundler, framework or runtime dependency without opening an issue first.
- **Dry runs stay offline.** Preview paths (popup counts, the floating launcher) must not make
  network calls.

## Getting set up

1. Fork and clone the repository.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the repo folder.
3. After editing, click the reload icon on the extension card and refresh the page under test.

## Tests

```bash
node test/run.js
```

The suite is DOM-free and needs only Node 18+. Every change to matching, value shaping,
consent detection or row handling should come with an assertion. For behaviour that needs a
real page, extend `test/form.html` or `test/booking.html` so the case can be reproduced by hand.

## Reporting a form that fills wrongly

The most useful bug report contains:

- the site URL (or a minimal HTML reproduction — please strip any personal data),
- the field's label, `name`, `id`, `autocomplete` and `placeholder`,
- what Smartfill put in and what it should have put in,
- the tag shown in the review panel (`matched`, `AI`, `your saved answer`).

## Pull requests

1. Create a branch from `master` (`fix/…`, `feat/…`, `docs/…`).
2. Keep the change focused; one concern per PR.
3. Make sure `node test/run.js` passes and the manifest still loads without errors.
4. Bump `version` in `manifest.json` only for user-facing changes, following semver.
5. Describe *what* changed and *why*, and include before/after screenshots for UI changes.

## Code style

- Modern JavaScript (ES2022), two-space indentation, single quotes, semicolons.
- Small pure functions in `rules.js` / `schema.js`; DOM work stays in `src/content/`.
- Comments explain *why* — especially for site-specific workarounds.

## Code of conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
