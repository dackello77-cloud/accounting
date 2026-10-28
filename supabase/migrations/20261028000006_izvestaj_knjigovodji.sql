-- Izveštaj knjigovođi: fakture i izvodi (dinarski i devizni) se šalju mejlom; svako slanje nosi
-- samo dokumente sačuvane posle prethodnog. Poslat dokument dobija accountant_report_id.

-- Jedan red: mejlovi knjigovođe i datum od kog se dokumenti šalju (bira se pri prvom slanju).
create table public.accountant_settings (
  id         boolean primary key default true check (id),
  emails     text[] not null default '{}' check (public.valid_emails(emails)),
  start_date date,
  updated_at timestamptz not null default now()
);
insert into public.accountant_settings (id) values (true);

-- Jedno slanje (može biti više mejlova ako je priloga mnogo).
create table public.accountant_reports (
  id         uuid primary key default gen_random_uuid(),
  sent_at    timestamptz not null default now(),
  recipients text[] not null default '{}',
  doc_count  int not null default 0,
  created_by uuid default auth.uid()
);
create index accountant_reports_sent_idx on public.accountant_reports (sent_at desc);

alter table public.documents add column accountant_report_id uuid references public.accountant_reports (id);
create index documents_accountant_pending_idx on public.documents (category, created_at)
  where accountant_report_id is null;

alter table public.accountant_settings enable row level security;
alter table public.accountant_reports  enable row level security;

create policy accountant_settings_select on public.accountant_settings for select to authenticated using (public.is_active_user());
create policy accountant_settings_update on public.accountant_settings for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy accountant_reports_select on public.accountant_reports for select to authenticated using (public.is_active_user());
create policy accountant_reports_insert on public.accountant_reports for insert to authenticated with check (public.is_active_user());
create policy accountant_reports_update on public.accountant_reports for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create trigger accountant_settings_updated_at before update on public.accountant_settings
  for each row execute function public.set_updated_at();
create trigger accountant_settings_audit after insert or update or delete on public.accountant_settings
  for each row execute function public.audit_trigger();
create trigger accountant_reports_audit after insert or update or delete on public.accountant_reports
  for each row execute function public.audit_trigger();

-- Mejlovi knjigovođe → email_recipients (send-email šalje samo na adrese sa te liste).
create or replace function public.sync_accountant_emails()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.email_recipients (email, name)
  select e, 'Knjigovođa' from unnest(new.emails) e
  on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.sync_accountant_emails() from public, anon, authenticated;

create trigger accountant_settings_sync_emails before insert or update of emails on public.accountant_settings
  for each row execute function public.sync_accountant_emails();
