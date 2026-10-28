-- Izveštaj knjigovođi šalje i plaćene račune: račun sa bar jednom aktivnom uplatom
-- (transactions.receipt_id) i, kod potraživanja, uplaćeno >= iznos. Računi na čekanju
-- i delimično plaćeni ne idu. Poslat račun dobija accountant_report_id.

alter table public.receipts add column accountant_report_id uuid references public.accountant_reports (id);

-- paid_at: kada je uneta poslednja uplata (za datum prvog slanja).
create view public.v_accountant_receipts
with (security_invoker = true)
as
select r.id, r.storage_path, r.partner_id, r.invoice_number, r.amount, r.uploaded_at,
       r.accountant_report_id, s.paid, s.paid_at
from public.receipts r
join lateral (
  select sum(t.amount) as paid, max(t.created_at) as paid_at
  from public.transactions t
  where t.receipt_id = r.id and t.status = 'active'
) s on s.paid_at is not null
where r.active
  and (r.amount is null or s.paid >= r.amount);
