-- Potraživanja: račun dobija kompaniju, broj fakture i iznos (RSD);
-- uplate su transakcije vezane za račun (transactions.receipt_id), storno se ne računa.

alter table public.receipts
  add column partner_id     uuid references public.partners (id),
  add column invoice_number text,
  add column amount         numeric(14,2) check (amount > 0);

-- Ili sva tri podatka ili nijedan (običan račun bez potraživanja).
alter table public.receipts add constraint receipts_claim_complete check (
  (partner_id is null and invoice_number is null and amount is null)
  or (partner_id is not null and btrim(coalesce(invoice_number, '')) <> '' and amount is not null));

create index receipts_partner_idx on public.receipts (partner_id);

alter table public.transactions
  add column receipt_id uuid references public.receipts (id);
create index transactions_receipt_idx on public.transactions (receipt_id);

-- Dosadašnje veze: račun je bio uz jednu transakciju.
update public.transactions t
   set receipt_id = r.id
  from public.receipts r
 where r.transaction_id = t.id and t.receipt_id is null;

-- Status: neplacena (ništa uplaćeno), delimicno, placena (uplaćeno >= iznos; višak se ne prati).
create view public.v_receivables
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
where r.amount is not null;
