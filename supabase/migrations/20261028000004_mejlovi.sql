-- Više mejlova po partneru (faktura ih postavlja za slanje) i stalni primaoci Obračuna R i K.
-- Svaki takav mejl ulazi i u email_recipients, jer send-email šalje samo na adrese sa te liste.

create or replace function public.valid_emails(p text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(e ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'), true) from unnest(p) e;
$$;

-- Partner: lista mejlova; stara kolona email ostaje = prvi mejl (kompatibilnost).
alter table public.partners
  add column emails text[] not null default '{}' check (public.valid_emails(emails));
update public.partners set emails = array[btrim(email)]
 where coalesce(btrim(email), '') <> '' and btrim(email) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$';

-- Primaoci obračuna: jedan red po tipu (R, K).
create table public.payroll_recipients (
  id         uuid not null unique default gen_random_uuid(),
  type       text primary key check (type in ('R','K')),
  emails     text[] not null default '{}' check (public.valid_emails(emails)),
  updated_at timestamptz not null default now()
);
insert into public.payroll_recipients (type) values ('R'), ('K');

alter table public.payroll_recipients enable row level security;
create policy payroll_recipients_select on public.payroll_recipients for select to authenticated using (public.is_active_user());
create policy payroll_recipients_insert on public.payroll_recipients for insert to authenticated with check (public.is_active_user());
create policy payroll_recipients_update on public.payroll_recipients for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create trigger payroll_recipients_updated_at before update on public.payroll_recipients
  for each row execute function public.set_updated_at();
create trigger payroll_recipients_audit after insert or update or delete on public.payroll_recipients
  for each row execute function public.audit_trigger();

-- Mejlovi partnera i primalaca obračuna → email_recipients (bez duplikata).
create or replace function public.sync_email_recipients()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'partners' then
    new.email := new.emails[1];
    insert into public.email_recipients (email, name)
    select e, new.name from unnest(new.emails) e
    on conflict do nothing;
  else
    insert into public.email_recipients (email, name)
    select e, 'Obračun ' || new.type from unnest(new.emails) e
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.sync_email_recipients() from public, anon, authenticated;

create trigger partners_sync_emails before insert or update of emails, name on public.partners
  for each row execute function public.sync_email_recipients();
create trigger payroll_recipients_sync_emails before insert or update of emails on public.payroll_recipients
  for each row execute function public.sync_email_recipients();

insert into public.email_recipients (email, name)
select e, p.name from public.partners p, unnest(p.emails) e
on conflict do nothing;
