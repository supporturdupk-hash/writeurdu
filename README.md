# Urdu Writer

A static Urdu writing site built with HTML, CSS, and browser JavaScript. It has no package manager or build step.

## Run locally

Open the project folder in VS Code and use a static server such as Live Server. Alternatively, if Python is installed, open PowerShell in this folder and run:

```powershell
py -m http.server 8000
```

Then visit `http://localhost:8000`. A local server is preferable to opening files directly because browser storage, file access, and external-service requests can behave differently for `file:` URLs.

## Project layout

- Root HTML pages are the site's entry points: home, editor, feedback, help, and policy pages.
- `assets/css/` contains shared home and editor styles.
- `assets/js/` contains the site's browser-side behavior and optional feedback configuration.
- `assets/Media/` contains icons and other static media used by the pages.
- `database/feedback.sql` creates the Supabase feedback table and its row-level security policy.
- `docs/database-setup.md` explains how to configure and test Supabase feedback.

## Current service limits

- Documents are saved in local browser storage; there is no account-based cloud sync.
- Login, sign-up, and Google sign-in are interface-only.
- Feedback is not sent or saved until Supabase is configured as described in the database guide.

## Checks

JavaScript syntax can be checked from PowerShell with:

```powershell
Get-ChildItem -Recurse -File assets\js\*.js | ForEach-Object { node --check $_.FullName }
```

