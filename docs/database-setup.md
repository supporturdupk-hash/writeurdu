# Supabase setup

This project is a static HTML, CSS, and JavaScript website. Supabase can store feedback submissions, but this setup does **not** enable user accounts, Google sign-in, or cloud-saved documents.

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

## 4. Publish and test

1. Publish the whole site, including `feedback.html`, `assets/js/feedback.js`, and the configured `assets/js/feedback-config.js`, to your static host.
2. Open the published feedback page and submit a valid test message (at least 10 characters).
3. Confirm the success message appears and that a row is visible in **Table Editor → website_feedback** in the Supabase dashboard.
4. If submission fails, check the browser console/network panel, the project URL and key, that the SQL completed successfully, and the table's RLS policy. The page reports that feedback was not saved when the request fails.

The anonymous key is public, so the insert policy cannot prove a submission came from a real person. Monitor usage and database limits; add abuse controls such as a server-side endpoint or CAPTCHA if spam becomes a problem. Avoid collecting personal information that is not needed.

## What this setup does not provide

- **Login and sign-up:** The current forms are interface-only. Configure Supabase Auth and implement server/client session handling before presenting them as working accounts.
- **Google sign-in:** Configure Google OAuth credentials in Google Cloud and Supabase Auth, then wire the callback and session flow. The current button is a placeholder.
- **Cloud documents:** The editor stores documents in the current browser's local storage. Cloud saving requires a separate authenticated document schema, per-user row-level security policies, and sync/conflict handling. Do not store documents in the public feedback table.

