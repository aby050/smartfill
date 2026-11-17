# Security Policy

Smartfill handles personal data, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Instead, email **work@rvastudio.in** or use
GitHub's [private vulnerability reporting](https://github.com/aby050/smartfill/security/advisories/new).

Include steps to reproduce, the affected version (`manifest.json`), and the impact. You can
expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days.

## Scope

Of particular interest:

- any path by which profile data, resume files or the API key reach a host other than
  `api.anthropic.com`,
- a page script being able to read Smartfill's storage or trigger a fill without user action,
- consent, password, OTP, card or identity-document fields being filled or transmitted.

## Supported versions

Only the latest release on `master` receives security fixes.
