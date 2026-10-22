-- M1: šema, RLS, view, RPC, audit trigeri, storage
-- M&M Safety Accounting 2.0 (docs/V2_SPEC.md, odeljci 3 i 4)

-- ============================================================
-- Pomoćne funkcije
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- Tabele
-- ============================================================

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text unique,
  full_name  text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence public.partner_code_seq;

create table public.partners (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique
                  default 'P-' || lpad(nextval('public.partner_code_seq')::text, 6, '0'),
  group_type      text not null check (group_type in ('ulaz','porezi','klijenti','zaposleni')),
  name            text not null check (btrim(name) <> ''),
  address         text,
  country         text not null default 'RS' check (country ~ '^[A-Z]{2}$'),
  tax_id          text,
  registration_no text,
  bank_account    text,
  email           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  constraint partners_tax_id_rs check (
    country <> 'RS' or coalesce(tax_id, '') = '' or tax_id ~ '^\d{9}$'),
  constraint partners_registration_no_rs check (
    country <> 'RS' or coalesce(registration_no, '') = '' or registration_no ~ '^\d{8}$')
);
alter sequence public.partner_code_seq owned by public.partners.code;
create index partners_group_active_name_idx on public.partners (group_type, active, lower(name));

create table public.articles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  price      numeric(14,2) not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  legacy_id      bigint unique,
  tx_date        date not null,
  type           text not null check (type in ('ulaz','porezi','klijenti','zaposleni')),
  partner_id     uuid references public.partners (id),
  partner_name   text not null,
  address        text,
  bank_account   text,
  invoice_number text,
  amount         numeric(14,2) not null,
  notes          text,
  status         text not null default 'active' check (status in ('active','storno')),
  storno_at      timestamptz,
  storno_by      uuid,
  document_path  text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);
create index transactions_tx_date_idx on public.transactions (tx_date);
create index transactions_partner_date_idx on public.transactions (partner_id, tx_date);
create index transactions_type_date_idx on public.transactions (type, tx_date);

create table public.receipts (
  id             uuid primary key default gen_random_uuid(),
  storage_path   text not null unique,
  original_name  text,
  note           text,
  transaction_id uuid references public.transactions (id),
  uploaded_at    timestamptz not null default now(),
  uploaded_by    uuid default auth.uid()
);
create index receipts_transaction_idx on public.receipts (transaction_id);

create table public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  number               text not null unique,
  issue_date           date,
  payment_days         int,
  due_date             date,
  place                text,
  currency             text check (currency in ('RSD','USD')),
  bank_account         text,
  partner_id           uuid references public.partners (id),
  company_name         text,
  company_address      text,
  company_bank_account text,
  company_tax_id       text,
  total                numeric(14,2) not null default 0,
  status               text not null default 'izdata' check (status in ('izdata','stornirana')),
  pdf_path             text,
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now()
);

create table public.invoice_items (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position   int not null,
  service    text,
  qty        numeric(12,2) not null default 0,
  price      numeric(14,2) not null default 0,
  amount     numeric(14,2) generated always as (round(qty * price, 2)) stored
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

create table public.invoice_counters (
  year    int primary key,
  last_no int not null default 0
);

create table public.payroll_r (
  id         uuid primary key default gen_random_uuid(),
  month      int not null check (month between 1 and 12),
  year       int not null,
  usd_rate   numeric(10,4),
  data       jsonb,
  pdf_path   text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index payroll_r_period_idx on public.payroll_r (year, month);

create table public.payroll_k (
  id         uuid primary key default gen_random_uuid(),
  month      int not null check (month between 1 and 12),
  year       int not null,
  data       jsonb,
  pdf_path   text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index payroll_k_period_idx on public.payroll_k (year, month);

create table public.calc_drafts (
  type       text primary key check (type in ('R','K')),
  data       jsonb,
  updated_at timestamptz not null default now()
);

create table public.email_recipients (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text not null,
  created_at timestamptz not null default now()
);
create unique index email_recipients_email_idx on public.email_recipients (lower(email));

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  type       text not null default 'note' check (type in ('note','reminder')),
  title      text,
  body       text,
  remind_at  timestamptz,
  status     text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index notes_status_remind_idx on public.notes (status, remind_at);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('transakcije','kartice','izvodi_dinarski',
                 'izvodi_devizni','obracun_r','obracun_k','racuni','fakture')),
  storage_path text not null unique,
  file_name    text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index documents_category_idx on public.documents (category, created_at desc);

create table public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  action     text not null,
  table_name text,
  record_id  text,
  details    jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

create trigger partners_updated_at before update on public.partners
  for each row execute function public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger calc_drafts_updated_at before update on public.calc_drafts
  for each row execute function public.set_updated_at();

-- ============================================================
-- Pristup
-- ============================================================

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
  );
$$;

-- Prijava sa username-om: vraća email samo za aktivan profil.
create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.active and lower(p.username) = lower(btrim(p_username))
  limit 1;
$$;

-- ============================================================
-- Audit
-- ============================================================

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_details := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_details
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value;
    if v_details = '{}'::jsonb then
      return new;
    end if;
  else
    v_details := to_jsonb(old);
  end if;

  insert into public.audit_log (user_id, action, table_name, record_id, details)
  values (auth.uid(), lower(tg_op), tg_table_name,
          case when tg_op = 'DELETE' then old.id::text else new.id::text end,
          v_details);
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['partners','articles','transactions','receipts','invoices',
                           'payroll_r','payroll_k','email_recipients','notes','documents']
  loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function public.audit_trigger()', t, t);
  end loop;
end;
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles         enable row level security;
alter table public.partners         enable row level security;
alter table public.articles         enable row level security;
alter table public.transactions     enable row level security;
alter table public.receipts         enable row level security;
alter table public.invoices         enable row level security;
alter table public.invoice_items    enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.payroll_r        enable row level security;
alter table public.payroll_k        enable row level security;
alter table public.calc_drafts      enable row level security;
alter table public.email_recipients enable row level security;
alter table public.notes            enable row level security;
alter table public.documents        enable row level security;
alter table public.audit_log        enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

-- Poslovne tabele: select/insert/update za aktivnog korisnika, delete niko.
do $$
declare
  t text;
begin
  foreach t in array array['partners','articles','transactions','receipts','invoices',
                           'payroll_r','payroll_k','calc_drafts','email_recipients',
                           'notes','documents']
  loop
    execute format('create policy %I_select on public.%I for select to authenticated
                      using (public.is_active_user())', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated
                      with check (public.is_active_user())', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated
                      using (public.is_active_user()) with check (public.is_active_user())', t, t);
  end loop;
end;
$$;

-- Stavke fakture i brojač se menjaju samo kroz save_invoice; audit samo trigerima.
create policy invoice_items_select on public.invoice_items
  for select to authenticated using (public.is_active_user());
create policy invoice_counters_select on public.invoice_counters
  for select to authenticated using (public.is_active_user());
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_active_user());

-- ============================================================
-- View
-- ============================================================

create view public.v_partner_card
with (security_invoker = true)
as
select t.id, t.tx_date, t.type, t.partner_id, p.code as partner_code,
       p.name as partner_current_name, t.partner_name, t.address, t.bank_account,
       t.invoice_number, t.amount, t.notes, t.status, t.document_path, t.created_at
from public.transactions t
join public.partners p on p.id = t.partner_id;

-- ============================================================
-- RPC
-- ============================================================

-- Dashboard: ulaz = prihod, ostali tipovi rashod; storno se ne računa.
create or replace function public.dashboard_summary(p_year int)
returns jsonb
language sql
stable
set search_path = public
as $$
  with a as (
    select * from public.transactions where status = 'active'
  )
  select jsonb_build_object(
    'stanje', coalesce((select sum(case when type = 'ulaz' then amount else -amount end) from a), 0),
    'ulaz',   coalesce((select sum(amount) from a where type = 'ulaz'), 0),
    'izlaz',  coalesce((select sum(amount) from a where type <> 'ulaz'), 0),
    'godina', jsonb_build_object(
      'ulaz',      coalesce((select sum(amount) from a where type = 'ulaz'      and extract(year from tx_date) = p_year), 0),
      'porezi',    coalesce((select sum(amount) from a where type = 'porezi'    and extract(year from tx_date) = p_year), 0),
      'klijenti',  coalesce((select sum(amount) from a where type = 'klijenti'  and extract(year from tx_date) = p_year), 0),
      'zaposleni', coalesce((select sum(amount) from a where type = 'zaposleni' and extract(year from tx_date) = p_year), 0)
    ),
    'poslednje', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.legacy_id desc nulls last)
      from (
        select id, legacy_id, tx_date, type, partner_name, invoice_number, amount, notes, created_at
        from a
        order by created_at desc, legacy_id desc nulls last
        limit 20
      ) x
    ), '[]'::jsonb)
  )
  where public.is_active_user();
$$;

-- Kartica: sa partnerom po partner_id, bez partnera po tipu (bez tipa sve).
create or replace function public.card(p_partner uuid, p_type text, p_from date, p_to date, p_view text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_view text := coalesce(nullif(p_view, ''), 'single');
  v_rows jsonb;
  v_total numeric(14,2);
begin
  if not public.is_active_user() then
    return null;
  end if;
  if v_view not in ('single','monthly','yearly') then
    raise exception 'Nepoznat prikaz kartice: %', p_view;
  end if;

  with f as (
    select * from public.transactions t
    where t.status = 'active'
      and (p_partner is null or t.partner_id = p_partner)
      and (p_partner is not null or coalesce(p_type, '') = '' or t.type = p_type)
      and (p_from is null or t.tx_date >= p_from)
      and (p_to is null or t.tx_date <= p_to)
  ), g as (
    select case when v_view = 'monthly' then to_char(tx_date, 'YYYY-MM')
                else to_char(tx_date, 'YYYY') end as period,
           sum(amount) as amount
    from f
    group by 1
  )
  select
    case when v_view = 'single' then
      (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'tx_date', tx_date, 'type', type, 'partner_id', partner_id,
                'partner_name', partner_name, 'address', address, 'bank_account', bank_account,
                'invoice_number', invoice_number, 'amount', amount, 'notes', notes,
                'document_path', document_path)
              order by tx_date desc, created_at desc), '[]'::jsonb) from f)
    else
      (select coalesce(jsonb_agg(jsonb_build_object('period', period, 'amount', amount)
                                 order by period desc), '[]'::jsonb) from g)
    end,
    (select coalesce(sum(amount), 0) from f)
  into v_rows, v_total;

  return jsonb_build_object('view', v_view, 'rows', v_rows, 'total', v_total);
end;
$$;

-- Predlog broja fakture (samo za prikaz; konačan broj daje save_invoice).
create or replace function public.next_invoice_number(p_year int)
returns text
language sql
stable
set search_path = public
as $$
  select lpad((greatest(
           coalesce((select last_no from public.invoice_counters where year = p_year), 0),
           coalesce((select max(split_part(number, '/', 1)::int) from public.invoices
                     where number ~ ('^\d+/' || p_year || '$')), 0)
         ) + 1)::text, 3, '0') || '/' || p_year
  where public.is_active_user();
$$;

create or replace function public.save_invoice(p_invoice jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := nullif(p_invoice->>'id', '')::uuid;
  v_number text := nullif(btrim(p_invoice->>'number'), '');
  v_issue  date := nullif(p_invoice->>'issue_date', '')::date;
  v_year   int;
  v_no     int;
  v_exists boolean;
  v_total  numeric(14,2);
begin
  if not public.is_active_user() then
    raise exception 'Nemate pristup';
  end if;

  v_year := coalesce(extract(year from v_issue)::int,
                     extract(year from (now() at time zone 'Europe/Belgrade'))::int);
  v_exists := v_id is not null and exists (select 1 from public.invoices where id = v_id);

  if v_number is not null and exists (
       select 1 from public.invoices where number = v_number and id is distinct from v_id) then
    raise exception 'Broj fakture je već iskorišćen';
  end if;

  if not v_exists then
    insert into public.invoice_counters (year, last_no) values (v_year, 0)
      on conflict (year) do nothing;
    select last_no into v_no from public.invoice_counters where year = v_year for update;

    if v_number is null then
      loop
        v_no := v_no + 1;
        v_number := lpad(v_no::text, 3, '0') || '/' || v_year;
        exit when not exists (select 1 from public.invoices where number = v_number);
      end loop;
      update public.invoice_counters set last_no = v_no where year = v_year;
    elsif v_number ~ ('^\d+/' || v_year || '$') then
      update public.invoice_counters
         set last_no = greatest(last_no, split_part(v_number, '/', 1)::int)
       where year = v_year;
    end if;

    v_id := coalesce(v_id, gen_random_uuid());
    insert into public.invoices (id, number, issue_date, payment_days, due_date, place, currency,
      bank_account, partner_id, company_name, company_address, company_bank_account,
      company_tax_id, pdf_path)
    values (v_id, v_number, v_issue,
      nullif(p_invoice->>'payment_days', '')::int,
      nullif(p_invoice->>'due_date', '')::date,
      p_invoice->>'place',
      nullif(p_invoice->>'currency', ''),
      p_invoice->>'bank_account',
      nullif(p_invoice->>'partner_id', '')::uuid,
      p_invoice->>'company_name',
      p_invoice->>'company_address',
      p_invoice->>'company_bank_account',
      p_invoice->>'company_tax_id',
      nullif(p_invoice->>'pdf_path', ''));
  else
    update public.invoices set
      number               = coalesce(v_number, number),
      issue_date           = v_issue,
      payment_days         = nullif(p_invoice->>'payment_days', '')::int,
      due_date             = nullif(p_invoice->>'due_date', '')::date,
      place                = p_invoice->>'place',
      currency             = nullif(p_invoice->>'currency', ''),
      bank_account         = p_invoice->>'bank_account',
      partner_id           = nullif(p_invoice->>'partner_id', '')::uuid,
      company_name         = p_invoice->>'company_name',
      company_address      = p_invoice->>'company_address',
      company_bank_account = p_invoice->>'company_bank_account',
      company_tax_id       = p_invoice->>'company_tax_id',
      pdf_path             = coalesce(nullif(p_invoice->>'pdf_path', ''), pdf_path)
    where id = v_id
    returning number into v_number;

    delete from public.invoice_items where invoice_id = v_id;
  end if;

  insert into public.invoice_items (invoice_id, position, service, qty, price)
  select v_id, row_number() over (order by i.ord), i.value->>'service',
         coalesce(nullif(i.value->>'qty', '')::numeric, 0),
         coalesce(nullif(i.value->>'price', '')::numeric, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as i(value, ord);

  select coalesce(sum(amount), 0) into v_total from public.invoice_items where invoice_id = v_id;
  update public.invoices set total = v_total where id = v_id;

  return jsonb_build_object('id', v_id, 'number', v_number, 'total', v_total);
exception
  when unique_violation then
    raise exception 'Broj fakture je već iskorišćen';
end;
$$;

create or replace function public.storno_transaction(p_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_active_user() then
    raise exception 'Nemate pristup';
  end if;

  select status into v_status from public.transactions where id = p_id for update;
  if v_status is null then
    raise exception 'Transakcija ne postoji';
  elsif v_status = 'storno' then
    raise exception 'Transakcija je već stornirana';
  end if;

  update public.transactions
     set status = 'storno', storno_at = now(), storno_by = auth.uid()
   where id = p_id;
end;
$$;

revoke execute on function public.audit_trigger() from public, anon, authenticated;
revoke execute on function public.save_invoice(jsonb, jsonb) from public, anon;
revoke execute on function public.storno_transaction(uuid) from public, anon;
revoke execute on function public.card(uuid, text, date, date, text) from public, anon;
revoke execute on function public.dashboard_summary(int) from public, anon;
revoke execute on function public.next_invoice_number(int) from public, anon;
grant execute on function public.save_invoice(jsonb, jsonb) to authenticated;
grant execute on function public.storno_transaction(uuid) to authenticated;
grant execute on function public.card(uuid, text, date, date, text) to authenticated;
grant execute on function public.dashboard_summary(int) to authenticated;
grant execute on function public.next_invoice_number(int) to authenticated;
grant execute on function public.email_for_username(text) to anon, authenticated;
grant execute on function public.is_active_user() to anon, authenticated;

-- ============================================================
-- Storage: privatni bucket-i, PDF/JPG/PNG/HEIC do 15 MB
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts',   'receipts',   false, 15728640, array['application/pdf','image/jpeg','image/png','image/heic','image/heif']),
  ('documents',  'documents',  false, 15728640, array['application/pdf','image/jpeg','image/png','image/heic','image/heif']),
  ('statements', 'statements', false, 15728640, array['application/pdf','image/jpeg','image/png','image/heic','image/heif'])
on conflict (id) do nothing;

create policy mm_storage_select on storage.objects
  for select to authenticated
  using (bucket_id in ('receipts','documents','statements') and public.is_active_user());
create policy mm_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('receipts','documents','statements') and public.is_active_user());
create policy mm_storage_update on storage.objects
  for update to authenticated
  using (bucket_id in ('receipts','documents','statements') and public.is_active_user())
  with check (bucket_id in ('receipts','documents','statements') and public.is_active_user());
