# Supabase setup

This project is a static HTML, CSS, and JavaScript website. Supabase can store feedback submissions and manage authentication. Authentication and feedback use the public project URL and anon/publishable key; cloud-saved documents are not supported.

## 1. Create a Supabase project

1. Create a project in the Supabase dashboard and save its database password somewhere private.
2. Wait for the project to finish provisioning.
3. Open the project's **SQL Editor**.

## 2. Create the feedback table and policy

Open [`../database/feedback.sql`](../database/feedback.sql), copy the complete SQL into the SQL Editor, and run it. The script creates `public.website_feedback`, enables row-level security, and grants the anonymous role permission to insert feedback only. Anonymous users cannot read, update, or delete submitted rows through the API.

Do not disable row-level security or add an anonymous read policy. Review received feedback in the Supabase dashboard using an account with appropriate project access.

## 3. Configure the public client settings

In the Supabase dashboard, open **Project Settings → API** (the labels may change) and copy:

- The **Project URL**.
- The **anon / publishable public key**.

Open [`../assets/js/feedback-config.js`](../assets/js/feedback-config.js) and set the two existing values:

```js
window.URDU_WRITER_SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  anonKey: 'YOUR-PUBLIC-ANON-OR-PUBLISHABLE-KEY'
};
```

The public key is intended for browser use; the database's row-level security is essential. **Never put a service-role or secret key in this file or in any client-side code.** Do not commit private database credentials.

## 4. Configure authentication

1. In **Authentication → Providers**, enable Email and Google. Configure Google OAuth credentials in Google Cloud; use the Supabase project's Auth callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) as the authorized redirect URI in Google Cloud.
2. In **Authentication → URL Configuration**, add the deployed home page URL to the allowed redirect URLs. Add local development URLs if needed, for example `http://localhost:8000/**`.
3. Configure `assets/js/feedback-config.js` with the project URL and public anon/publishable key as described above. The home page loads this shared config for auth as well as feedback.
4. Publish the site over HTTPS. Never expose a service-role or secret key in browser code.

The home page provides email/password sign-up and sign-in, Google OAuth, current-session profile display, and sign-out. Email confirmation behavior follows the Supabase project's Auth settings. OAuth redirects back to the current home page. Account credentials and profile information are handled by Supabase; documents remain in browser storage and are not associated with the account.

## 5. Publish and test

1. Publish the whole site, including the home page's `assets/js/auth.js`, `assets/js/home.js`, and configured `assets/js/feedback-config.js`, to your static host.
2. Open the published home page and test email sign-up/sign-in, Google sign-in, profile display, and sign-out. Confirm the deployed URL is allowed in Supabase Auth settings.
3. Open the feedback page and submit a valid test message (at least 10 characters). Confirm the success message appears and that a row is visible in **Table Editor → website_feedback**.
4. If authentication fails, check the browser console/network panel, the project URL and key, Supabase's allowed redirect URLs, and the Google provider credentials. If feedback fails, also check that the SQL completed successfully and that the table's RLS policy is enabled.

The anonymous key is public, so the insert policy cannot prove a submission came from a real person. Monitor usage and database limits; add abuse controls such as a server-side endpoint or CAPTCHA if spam becomes a problem. Avoid collecting personal information that is not needed.

## What this setup does not provide

- **Cloud documents:** The editor stores documents in the current browser's local storage. Cloud saving requires a separate authenticated document schema, per-user row-level security policies, and sync/conflict handling. Do not store documents in the public feedback table.
