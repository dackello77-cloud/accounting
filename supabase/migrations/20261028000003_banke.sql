-- Banke: Banca Intesa (podrazumevana) i UniCredit. Svaka transakcija ima banku; prenos između
-- banaka (type 'prenos', bank_id → to_bank_id) ne ulazi u ulaz/izlaz, samo u stanje po banci.
-- Partner ima prioritetnu banku (null = podrazumevana); faktura pamti banku.

create table public.banks (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z]+$'),
  name        text not null check (btrim(name) <> ''),
  account_rsd text,
  account_usd text,
  is_default  boolean not null default false,
  position    int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index banks_one_default on public.banks (is_default) where is_default;

alter table public.banks enable row level security;
create policy banks_select on public.banks for select to authenticated using (public.is_active_user());
create policy banks_insert on public.banks for insert to authenticated with check (public.is_active_user());
create policy banks_update on public.banks for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create trigger banks_audit after insert or update or delete on public.banks
  for each row execute function public.audit_trigger();

-- Brojevi računa Intese su već na fakturi (javni); UniCredit se dopunjuje u Dodaj / Uredi → Banke.
insert into public.banks (code, name, account_rsd, account_usd, is_default, position) values
  ('intesa', 'Banca Intesa', '160-6000001770008-96', '160-6000001770455-16', true, 1),
  ('unicredit', 'UniCredit Bank', null, null, false, 2);

create or replace function public.default_bank_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select id from public.banks where is_default limit 1;
$$;

-- Partner: prioritetna banka
alter table public.partners add column bank_id uuid references public.banks (id);

-- Transakcije: banka (sve dosadašnje na podrazumevanu) i prenos
alter table public.transactions
  add column bank_id    uuid references public.banks (id),
  add column to_bank_id uuid references public.banks (id);
update public.transactions set bank_id = public.default_bank_id() where bank_id is null;
alter table public.transactions alter column bank_id set default public.default_bank_id();
alter table public.transactions alter column bank_id set not null;

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('ulaz','porezi','klijenti','zaposleni','prenos'));
alter table public.transactions add constraint transactions_transfer_check check (
  (type = 'prenos') = (to_bank_id is not null)
  and (type <> 'prenos' or (to_bank_id <> bank_id and amount > 0 and partner_id is null and receipt_id is null)));
create index transactions_bank_idx on public.transactions (bank_id, tx_date);

-- Faktura: banka (dosadašnje na podrazumevanu)
alter table public.invoices add column bank_id uuid references public.banks (id);
update public.invoices set bank_id = public.default_bank_id() where bank_id is null;

-- Dashboard: prenos nije ni ulaz ni izlaz; stanje po banci.
create or replace function public.dashboard_summary(p_year int)
returns jsonb
language sql
stable
set search_path = public
as $$
  with a as (
    select * from public.transactions where status = 'active'
  ), m as (
    select * from a where type <> 'prenos'
  ), moves as (
    select bank_id, case when type = 'ulaz' then amount else -amount end as delta from m
    union all select bank_id, -amount from a where type = 'prenos'
    union all select to_bank_id, amount from a where type = 'prenos'
  )
  select jsonb_build_object(
    'stanje', coalesce((select sum(case when type = 'ulaz' then amount else -amount end) from m), 0),
    'ulaz',   coalesce((select sum(amount) from m where type = 'ulaz'), 0),
    'izlaz',  coalesce((select sum(amount) from m where type <> 'ulaz'), 0),
    'godina', jsonb_build_object(
      'ulaz',      coalesce((select sum(amount) from m where type = 'ulaz'      and extract(year from tx_date) = p_year), 0),
      'porezi',    coalesce((select sum(amount) from m where type = 'porezi'    and extract(year from tx_date) = p_year), 0),
      'klijenti',  coalesce((select sum(amount) from m where type = 'klijenti'  and extract(year from tx_date) = p_year), 0),
      'zaposleni', coalesce((select sum(amount) from m where type = 'zaposleni' and extract(year from tx_date) = p_year), 0)
    ),
    'banke', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'stanje', coalesce(s.stanje, 0)) order by b.position)
      from public.banks b
      left join (select bank_id, sum(delta) as stanje from moves group by bank_id) s on s.bank_id = b.id
      where b.active
    ), '[]'::jsonb),
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

-- Kartica: prenos samo kad se traži tip 'prenos'.
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
      and (t.type <> 'prenos' or p_type = 'prenos')
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

-- Faktura: save_invoice pamti i banku (ostalo kao u 20261022000001).
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
  v_bank   uuid := coalesce(nullif(p_invoice->>'bank_id', '')::uuid, public.default_bank_id());
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
      bank_account, bank_id, partner_id, company_name, company_address, company_bank_account,
      company_tax_id, pdf_path)
    values (v_id, v_number, v_issue,
      nullif(p_invoice->>'payment_days', '')::int,
      nullif(p_invoice->>'due_date', '')::date,
      p_invoice->>'place',
      nullif(p_invoice->>'currency', ''),
      p_invoice->>'bank_account',
      v_bank,
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
      bank_id              = v_bank,
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

revoke execute on function public.default_bank_id() from public, anon;
grant execute on function public.default_bank_id() to authenticated;
