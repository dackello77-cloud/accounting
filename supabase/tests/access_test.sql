-- M1: testovi pristupa i RPC-a (spec. odeljak 8, „Baza”).
-- Pokreće se u jednoj transakciji koja se na kraju poništava (rollback),
-- pa ne ostavlja podatke. Svaka greška prekida skriptu porukom FAIL.

begin;

-- Korisnici: aktivan vlasnik i neaktivan nalog
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'vlasnik@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'neaktivan@test.local');
insert into public.profiles (id, username, active) values
  ('00000000-0000-0000-0000-00000000000a', 'vlasnik', true),
  ('00000000-0000-0000-0000-00000000000b', 'neaktivan', false);

create function pg_temp.as_user(p_uid text, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"anon"}'
         else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
end;
$$;

create function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok  %', p_label;
    return;
  end;
  raise exception 'FAIL: % (nije odbijeno)', p_label;
end;
$$;

create function pg_temp.expect(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'ok  %', p_label;
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- ---------- Aktivan korisnik: CRUD i poznat skup ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'authenticated');

insert into public.partners (id, group_type, name) values
  ('10000000-0000-0000-0000-000000000001', 'ulaz', 'VRH Tracking Tech'),
  ('10000000-0000-0000-0000-000000000002', 'porezi', 'Poreska uprava'),
  ('10000000-0000-0000-0000-000000000003', 'zaposleni', 'Marko'),
  ('10000000-0000-0000-0000-000000000004', 'zaposleni', 'Marko Marković');

insert into public.transactions (id, tx_date, type, partner_id, partner_name, amount) values
  ('20000000-0000-0000-0000-000000000001', '2026-01-10', 'ulaz',      '10000000-0000-0000-0000-000000000001', 'VRH Tracking Tech', 100000.00),
  ('20000000-0000-0000-0000-000000000002', '2026-02-15', 'porezi',    '10000000-0000-0000-0000-000000000002', 'Poreska uprava', 12345.67),
  ('20000000-0000-0000-0000-000000000003', '2026-02-20', 'zaposleni', '10000000-0000-0000-0000-000000000003', 'Marko', 30000.00),
  ('20000000-0000-0000-0000-000000000004', '2026-03-01', 'zaposleni', '10000000-0000-0000-0000-000000000004', 'Marko Marković', 40000.00),
  ('20000000-0000-0000-0000-000000000005', '2025-12-31', 'ulaz',      '10000000-0000-0000-0000-000000000001', 'VRH Tracking Tech', 5000.00),
  ('20000000-0000-0000-0000-000000000006', '2026-03-05', 'zaposleni', '10000000-0000-0000-0000-000000000003', 'Marko', 999.99);

select pg_temp.expect((select count(*) from public.partners) = 4, 'aktivan: vidi partnere');
select pg_temp.expect((select code from public.partners where name = 'VRH Tracking Tech') ~ '^P-\d{6}$', 'šifra partnera P-000001');

update public.partners set address = 'Beograd' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.expect((select address from public.partners where id = '10000000-0000-0000-0000-000000000002') = 'Beograd', 'aktivan: izmena partnera');

select pg_temp.expect_error($$insert into public.partners (group_type, name, tax_id) values ('ulaz', 'Loš PIB', '123')$$, 'RS PIB mora imati 9 cifara');
select pg_temp.expect_error($$insert into public.partners (group_type, name, registration_no) values ('ulaz', 'Loš MB', '12')$$, 'RS matični broj mora imati 8 cifara');
insert into public.partners (group_type, name, country, tax_id) values ('ulaz', 'US firma', 'US', '12-3456789');
select pg_temp.expect(true, 'US poreski broj bez provere formata');

-- Brisanje odbijeno (nema delete policy-ja → 0 obrisanih redova)
delete from public.transactions;
select pg_temp.expect((select count(*) from public.transactions) = 6, 'delete transactions odbijen');
delete from public.partners;
select pg_temp.expect((select count(*) from public.partners) = 5, 'delete partners odbijen');

-- Storno
select public.storno_transaction('20000000-0000-0000-0000-000000000006');
select pg_temp.expect((select status from public.transactions where id = '20000000-0000-0000-0000-000000000006') = 'storno', 'storno postavlja status');
select pg_temp.expect_error($$select public.storno_transaction('20000000-0000-0000-0000-000000000006')$$, 'drugi storno → greška');

-- Dashboard (storno se ne računa)
select pg_temp.expect((public.dashboard_summary(2026)->>'ulaz')::numeric = 105000.00, 'dashboard ulaz');
select pg_temp.expect((public.dashboard_summary(2026)->>'izlaz')::numeric = 82345.67, 'dashboard izlaz');
select pg_temp.expect((public.dashboard_summary(2026)->>'stanje')::numeric = 22654.33, 'dashboard stanje');
select pg_temp.expect((public.dashboard_summary(2026)->'godina'->>'ulaz')::numeric = 100000.00, 'dashboard godina ulaz');
select pg_temp.expect((public.dashboard_summary(2026)->'godina'->>'zaposleni')::numeric = 70000.00, 'dashboard godina zaposleni');
select pg_temp.expect(jsonb_array_length(public.dashboard_summary(2026)->'poslednje') = 5, 'dashboard poslednje (bez storna)');

-- Kartica po partner_id: „Marko” ne hvata „Marko Marković” (greška 3 iz 1.x)
select pg_temp.expect((public.card('10000000-0000-0000-0000-000000000003', null, null, null, 'single')->>'total')::numeric = 30000.00, 'kartica Marko = samo Marko');
select pg_temp.expect((public.card(null, 'zaposleni', null, null, 'single')->>'total')::numeric = 70000.00, 'kartica po tipu');
select pg_temp.expect(jsonb_array_length(public.card(null, null, '2026-01-01', '2026-12-31', 'monthly')->'rows') = 3, 'kartica po mesecima');
select pg_temp.expect((public.card(null, null, null, null, 'yearly')->'rows'->0->>'period') = '2026', 'kartica po godinama, novija prva');
select pg_temp.expect((public.card(null, 'ulaz', '2026-01-01', '2026-12-31', 'single')->>'total')::numeric = 100000.00, 'kartica period');

-- Preimenovanje partnera ne gubi istoriju
update public.partners set name = 'VRH Tracking Technologies' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect((public.card('10000000-0000-0000-0000-000000000001', null, null, null, 'single')->>'total')::numeric = 105000.00, 'preimenovanje ne gubi karticu');

-- Fakture
select pg_temp.expect(public.next_invoice_number(2026) = '001/2026', 'predlog broja 001/2026');
select pg_temp.expect(
  (public.save_invoice('{"id":"30000000-0000-0000-0000-000000000001","issue_date":"2026-10-22","currency":"USD","company_name":"VRH"}',
                       '[{"service":"Usluga","qty":2,"price":1500.50}]')->>'number') = '001/2026', 'nova faktura dobija 001/2026');
select public.save_invoice('{"id":"30000000-0000-0000-0000-000000000001","issue_date":"2026-10-22","currency":"USD","company_name":"VRH"}',
                           '[{"service":"Usluga","qty":3,"price":1000}]');
select pg_temp.expect((select count(*) from public.invoices) = 1, 'save_invoice dva puta isti id → jedan red');
select pg_temp.expect((select total from public.invoices) = 3000.00, 'drugo čuvanje menja stavke i zbir');
select pg_temp.expect((select count(*) from public.invoice_items) = 1, 'stavke zamenjene');
select pg_temp.expect((public.save_invoice('{"issue_date":"2026-10-23"}', '[]')->>'number') = '002/2026', 'sledeća faktura 002/2026');
select pg_temp.expect_error($$select public.save_invoice('{"number":"001/2026","issue_date":"2026-10-23"}', '[]')$$, 'zauzet broj → greška');
select pg_temp.expect((public.save_invoice('{"number":"010/2026","issue_date":"2026-10-24"}', '[]')->>'number') = '010/2026', 'ručno upisan broj');
select pg_temp.expect(public.next_invoice_number(2026) = '011/2026', 'predlog posle ručnog broja');
select pg_temp.expect_error($$insert into public.invoice_items (invoice_id, position, service) values ('30000000-0000-0000-0000-000000000001', 9, 'x')$$, 'direktan upis stavki odbijen');
delete from public.invoices;
select pg_temp.expect((select count(*) from public.invoices) = 3, 'delete invoices odbijen');

-- Audit
select pg_temp.expect((select count(*) from public.audit_log where table_name = 'transactions') >= 7, 'audit beleži transakcije');
select pg_temp.expect((select details ? 'status' from public.audit_log where table_name = 'transactions' and action = 'update' limit 1), 'audit update čuva samo izmene');
select pg_temp.expect_error($$insert into public.audit_log (action) values ('lažno')$$, 'direktan upis u audit_log odbijen');
update public.audit_log set action = 'x';
select pg_temp.expect((select count(*) from public.audit_log where action = 'x') = 0, 'izmena audit_log odbijena');

-- Storage
insert into storage.objects (bucket_id, name) values ('documents', 'fakture/test.pdf');
select pg_temp.expect((select count(*) from storage.objects) = 1, 'aktivan: upload u storage');
delete from storage.objects;
select pg_temp.expect((select count(*) from storage.objects) = 1, 'storage delete odbijen');

-- ---------- Neaktivan korisnik ----------
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'authenticated');
select pg_temp.expect((select count(*) from public.transactions) = 0, 'neaktivan: 0 transakcija');
select pg_temp.expect((select count(*) from public.partners) = 0, 'neaktivan: 0 partnera');
select pg_temp.expect_error($$insert into public.notes (title) values ('x')$$, 'neaktivan: upis odbijen');
select pg_temp.expect(public.dashboard_summary(2026) is null, 'neaktivan: dashboard prazan');
select pg_temp.expect_error($$select public.save_invoice('{}', '[]')$$, 'neaktivan: save_invoice odbijen');
select pg_temp.expect((select count(*) from storage.objects) = 0, 'neaktivan: 0 fajlova');

-- ---------- Anon (bez prijave) ----------
reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.expect((select count(*) from public.transactions) = 0, 'anon: 0 transakcija');
select pg_temp.expect((select count(*) from public.audit_log) = 0, 'anon: 0 audit');
select pg_temp.expect((select count(*) from public.profiles) = 0, 'anon: 0 profila');
select pg_temp.expect_error($$insert into public.partners (group_type, name) values ('ulaz', 'x')$$, 'anon: upis odbijen');
select pg_temp.expect_error($$select public.dashboard_summary(2026)$$, 'anon: dashboard odbijen');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('documents', 'x.pdf')$$, 'anon: storage upload odbijen');
select pg_temp.expect(public.email_for_username('VLASNIK') = 'vlasnik@test.local', 'anon: email za username');
select pg_temp.expect(public.email_for_username('neaktivan') is null, 'anon: neaktivan username → null');
select pg_temp.expect(public.email_for_username('nepostoji') is null, 'anon: nepostojeći username → null');

reset role;
rollback;
