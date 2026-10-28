-- Brisanje računa = označavanje (active = false), samo dok račun nema aktivnih uplata.
-- Obrisan račun nestaje iz lista i potraživanja; red i fajl ostaju (audit).

alter table public.receipts
  add column active     boolean not null default true,
  add column deleted_at timestamptz;

create or replace function public.receipts_guard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.active and not new.active then
    if exists (select 1 from public.transactions where receipt_id = new.id and status = 'active') then
      raise exception 'Račun ima uplate i ne može se obrisati.';
    end if;
    new.deleted_at := now();
  elsif not old.active and new.active then
    raise exception 'Obrisan račun se ne može vratiti.';
  end if;
  return new;
end;
$$;

create trigger receipts_guard_delete before update of active on public.receipts
  for each row execute function public.receipts_guard_delete();

-- Nova uplata ne može na obrisan račun.
create or replace function public.transactions_guard_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.receipt_id is not null
     and not exists (select 1 from public.receipts where id = new.receipt_id and active) then
    raise exception 'Račun je obrisan i ne može se platiti.';
  end if;
  return new;
end;
$$;

create trigger transactions_guard_receipt before insert or update of receipt_id on public.transactions
  for each row execute function public.transactions_guard_receipt();

revoke execute on function public.receipts_guard_delete() from public, anon, authenticated;
revoke execute on function public.transactions_guard_receipt() from public, anon, authenticated;

-- Potraživanja bez obrisanih računa (iste kolone kao u 20261028000001).
create or replace view public.v_receivables
with (security_invoker = true)
as
select r.id, r.partner_id, p.name as partner_name, r.invoice_number, r.amount,
       coalesce(s.paid, 0)::numeric(14,2) as paid,
       greatest(r.amount - coalesce(s.paid, 0), 0)::numeric(14,2) as remaining,
       case when coalesce(s.paid, 0) >= r.amount then 'placena'
            when coalesce(s.paid, 0) > 0 then 'delimicno'
            else 'neplacena' end as status,
       coalesce(s.payments, 0) as payments, s.last_payment,
       r.storage_path, r.note, r.transaction_id, r.uploaded_at
from public.receipts r
join public.partners p on p.id = r.partner_id
left join lateral (
  select sum(t.amount) as paid, count(*) as payments, max(t.tx_date) as last_payment
  from public.transactions t
  where t.receipt_id = r.id and t.status = 'active'
) s on true
where r.amount is not null and r.active;
