-- Potraživanja: podaci računa, status po uplatama, storno, pristup.
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

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'authenticated');

insert into public.partners (id, group_type, name) values
  ('10000000-0000-0000-0000-000000000001', 'klijenti', 'Kap života'),
  ('10000000-0000-0000-0000-000000000002', 'klijenti', 'Preventiva');

-- Sva tri podatka ili nijedan
insert into public.receipts (id, storage_path) values ('40000000-0000-0000-0000-000000000009', 'inbox/a/obican.pdf');
select pg_temp.expect((select count(*) from public.v_receivables) = 0, 'račun bez podataka nije u potraživanjima');
select pg_temp.expect_error($$insert into public.receipts (storage_path, partner_id) values ('inbox/b/x.pdf', '10000000-0000-0000-0000-000000000001')$$, 'samo kompanija → odbijeno');
select pg_temp.expect_error($$insert into public.receipts (storage_path, partner_id, invoice_number, amount) values ('inbox/c/x.pdf', '10000000-0000-0000-0000-000000000001', '1', 0)$$, 'iznos 0 → odbijeno');
select pg_temp.expect_error($$insert into public.receipts (storage_path, partner_id, invoice_number, amount) values ('inbox/d/x.pdf', '10000000-0000-0000-0000-000000000001', '  ', 10)$$, 'prazan broj fakture → odbijeno');

insert into public.receipts (id, storage_path, partner_id, invoice_number, amount) values
  ('40000000-0000-0000-0000-000000000001', 'inbox/e/125.pdf', '10000000-0000-0000-0000-000000000001', '125', 1000.00),
  ('40000000-0000-0000-0000-000000000002', 'inbox/f/7.pdf',   '10000000-0000-0000-0000-000000000002', '7',   200.00);

select pg_temp.expect((select status from public.v_receivables where id = '40000000-0000-0000-0000-000000000001') = 'neplacena', 'bez uplata → neplacena');
select pg_temp.expect((select remaining from public.v_receivables where id = '40000000-0000-0000-0000-000000000001') = 1000.00, 'preostalo = iznos');

-- Delimično: 300 + 200 od 1.000
insert into public.transactions (id, tx_date, type, partner_id, partner_name, amount, receipt_id) values
  ('20000000-0000-0000-0000-000000000001', '2026-10-10', 'klijenti', '10000000-0000-0000-0000-000000000001', 'Kap života', 300.00, '40000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '2026-10-15', 'klijenti', '10000000-0000-0000-0000-000000000001', 'Kap života', 200.00, '40000000-0000-0000-0000-000000000001');
select pg_temp.expect((select (paid, remaining, status, payments::int, last_payment)
                         from public.v_receivables where id = '40000000-0000-0000-0000-000000000001')
                      = (500.00::numeric(14,2), 500.00::numeric(14,2), 'delimicno'::text, 2, '2026-10-15'::date), 'delimično: 500 plaćeno, 500 preostalo');

-- Storno uplate se ne računa
select public.storno_transaction('20000000-0000-0000-0000-000000000002');
select pg_temp.expect((select paid from public.v_receivables where id = '40000000-0000-0000-0000-000000000001') = 300.00, 'storno uplate se ne računa');

-- Dopuna do punog iznosa → placena
insert into public.transactions (tx_date, type, partner_id, partner_name, amount, receipt_id) values
  ('2026-10-20', 'klijenti', '10000000-0000-0000-0000-000000000001', 'Kap života', 700.00, '40000000-0000-0000-0000-000000000001');
select pg_temp.expect((select (status, remaining) from public.v_receivables where id = '40000000-0000-0000-0000-000000000001')
                      = ('placena'::text, 0.00::numeric(14,2)), 'tačno do iznosa → placena');

-- Preplata: placena, preostalo 0 (višak se ne prati)
insert into public.transactions (tx_date, type, partner_id, partner_name, amount, receipt_id) values
  ('2026-10-21', 'klijenti', '10000000-0000-0000-0000-000000000002', 'Preventiva', 250.00, '40000000-0000-0000-0000-000000000002');
select pg_temp.expect((select (status, remaining) from public.v_receivables where id = '40000000-0000-0000-0000-000000000002')
                      = ('placena'::text, 0.00::numeric(14,2)), 'preplata → placena, preostalo 0');

-- Izmena iznosa vraća fakturu u otvorene
update public.receipts set amount = 300.00 where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.expect((select status from public.v_receivables where id = '40000000-0000-0000-0000-000000000002') = 'delimicno', 'veći iznos → ponovo delimično');

-- Uklanjanje podataka: račun izlazi iz potraživanja
update public.receipts set partner_id = null, invoice_number = null, amount = null where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.expect((select count(*) from public.v_receivables) = 1, 'bez podataka → van potraživanja');

-- ---------- Neaktivan i anon ne vide potraživanja ----------
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'authenticated');
select pg_temp.expect((select count(*) from public.v_receivables) = 0, 'neaktivan: 0 potraživanja');
reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.expect((select count(*) from public.v_receivables) = 0, 'anon: 0 potraživanja');

reset role;
rollback;
