create table if not exists public.website_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bug', 'suggestion', 'usability', 'other')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(message) between 10 and 5000),
  email text check (email is null or char_length(email) <= 254),
  page_url text check (page_url is null or char_length(page_url) <= 2048),
  created_at timestamptz not null default now()
);

alter table public.website_feedback enable row level security;

revoke all on table public.website_feedback from anon, authenticated;
grant insert on table public.website_feedback to anon;

drop policy if exists "Allow anonymous feedback submissions" on public.website_feedback;
create policy "Allow anonymous feedback submissions"
  on public.website_feedback
  for insert
  to anon
  with check (true);
