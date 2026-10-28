-- Obračun R i K se šalje izabranoj kompaniji (njeni mejlovi su primaoci); izbor se pamti po tipu.
-- Zamenjuje listu mejlova iz 20261028000004.

alter table public.payroll_recipients add column partner_id uuid references public.partners (id);

drop trigger payroll_recipients_sync_emails on public.payroll_recipients;
alter table public.payroll_recipients drop column emails;

-- Ostaje samo za partnere: prvi mejl u email, svi mejlovi u email_recipients.
create or replace function public.sync_email_recipients()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := new.emails[1];
  insert into public.email_recipients (email, name)
  select e, new.name from unnest(new.emails) e
  on conflict do nothing;
  return new;
end;
$$;
