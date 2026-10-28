-- Izveštaj knjigovođi, početno stanje: sve fakture, izvodi i plaćeni računi koji već postoje
-- računaju se kao poslati (slanje bez primalaca = "Početno stanje"); šalje se samo ono što
-- nastane posle ove migracije. Datum prvog slanja = danas, pa ga aplikacija ne traži.

do $$
declare
  v_report uuid;
  v_docs int;
  v_receipts int;
begin
  insert into public.accountant_reports (recipients) values ('{}') returning id into v_report;

  update public.documents set accountant_report_id = v_report
   where accountant_report_id is null
     and category in ('fakture', 'izvodi_dinarski', 'izvodi_devizni');
  get diagnostics v_docs = row_count;

  update public.receipts set accountant_report_id = v_report
   where accountant_report_id is null
     and id in (select id from public.v_accountant_receipts);
  get diagnostics v_receipts = row_count;

  update public.accountant_reports set doc_count = v_docs + v_receipts where id = v_report;

  update public.accountant_settings
     set start_date = coalesce(start_date, (now() at time zone 'Europe/Belgrade')::date)
   where id;
end;
$$;
