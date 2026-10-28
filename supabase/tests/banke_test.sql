-- Banke: stanje po banci, prenos, prioritetna banka, faktura.
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

create temp table b as select (select id from public.banks where code = 'intesa') as intesa,
                              (select id from public.banks where code = 'unicredit') as uni;
grant select on b to authenticated;

select pg_temp.expect((select count(*) from public.banks) = 2, 'dve banke');
select pg_temp.expect(public.default_bank_id() = (select intesa from b), 'podrazumevana = Intesa');

insert into public.partners (id, group_type, name, bank_id) values
  ('10000000-0000-0000-0000-000000000001', 'ulaz', 'Poslodavac US', (select uni from b)),
  ('10000000-0000-0000-0000-000000000002', 'klijenti', 'Dobavljač', null);

-- Bez banke → Intesa; sa bankom → ta banka
insert into public.transactions (id, tx_date, type, partner_id, partner_name, amount) values
  ('20000000-0000-0000-0000-000000000001', '2026-10-01', 'ulaz', '10000000-0000-0000-0000-000000000001', 'Poslodavac US', 1000.00);
insert into public.transactions (tx_date, type, partner_id, partner_name, amount, bank_id) values
  ('2026-10-02', 'ulaz', '10000000-0000-0000-0000-000000000001', 'Poslodavac US', 500.00, (select uni from b)),
  ('2026-10-03', 'klijenti', '10000000-0000-0000-0000-000000000002', 'Dobavljač', 200.00, (select uni from b));
select pg_temp.expect((select bank_id from public.transactions where id = '20000000-0000-0000-0000-000000000001') = (select intesa from b), 'transakcija bez banke → Intesa');

-- Prenos 300 sa Intese na UniCredit
insert into public.transactions (id, tx_date, type, partner_name, amount, bank_id, to_bank_id) values
  ('20000000-0000-0000-0000-000000000009', '2026-10-04', 'prenos', 'Banca Intesa → UniCredit Bank', 300.00, (select intesa from b), (select uni from b));

create temp view s as select public.dashboard_summary(2026) as d;
grant select on s to authenticated;
select pg_temp.expect((select (d->>'stanje')::numeric from s) = 1300.00, 'ukupno stanje: prenos ne menja (1000+500−200)');
select pg_temp.expect((select (d->>'ulaz')::numeric from s) = 1500.00 and (select (d->>'izlaz')::numeric from s) = 200.00, 'prenos nije ni ulaz ni izlaz');
select pg_temp.expect((select (d->'godina'->>'klijenti')::numeric from s) = 200.00, 'godišnji pregled bez prenosa');
select pg_temp.expect((select (x->>'stanje')::numeric from s, jsonb_array_elements(d->'banke') x where x->>'name' = 'Banca Intesa') = 700.00, 'Intesa: 1000 − 300 = 700');
select pg_temp.expect((select (x->>'stanje')::numeric from s, jsonb_array_elements(d->'banke') x where x->>'name' = 'UniCredit Bank') = 600.00, 'UniCredit: 500 − 200 + 300 = 600');
select pg_temp.expect((select jsonb_array_length(d->'poslednje') from s) = 4, 'prenos je među poslednjim');
select pg_temp.expect((public.card(null, null, null, null, 'single')->>'total')::numeric = 1700.00, 'kartica (sve) bez prenosa');
select pg_temp.expect((public.card(null, 'prenos', null, null, 'single')->>'total')::numeric = 300.00, 'kartica tipa prenos');

-- Storno prenosa vraća stanja
select public.storno_transaction('20000000-0000-0000-0000-000000000009');
select pg_temp.expect((select (x->>'stanje')::numeric from s, jsonb_array_elements(d->'banke') x where x->>'name' = 'Banca Intesa') = 1000.00, 'storno prenosa: Intesa 1000');

-- Ograničenja prenosa
select pg_temp.expect_error($$insert into public.transactions (tx_date, type, partner_name, amount, bank_id, to_bank_id) select '2026-10-05', 'prenos', 'x', 10, intesa, intesa from b$$, 'prenos na istu banku odbijen');
select pg_temp.expect_error($$insert into public.transactions (tx_date, type, partner_name, amount, bank_id) select '2026-10-05', 'prenos', 'x', 10, intesa from b$$, 'prenos bez banke primaoca odbijen');
select pg_temp.expect_error($$insert into public.transactions (tx_date, type, partner_name, amount, bank_id, to_bank_id) select '2026-10-05', 'prenos', 'x', 0, intesa, uni from b$$, 'prenos 0 odbijen');
select pg_temp.expect_error($$insert into public.transactions (tx_date, type, partner_name, amount, to_bank_id) select '2026-10-05', 'ulaz', 'x', 10, uni from b$$, 'ulaz sa bankom primaocem odbijen');

-- Faktura pamti banku; bez banke → Intesa
select public.save_invoice(jsonb_build_object('id', '30000000-0000-0000-0000-000000000001', 'issue_date', '2026-10-22', 'currency', 'USD', 'bank_id', (select uni from b)), '[]');
select public.save_invoice('{"id":"30000000-0000-0000-0000-000000000002","issue_date":"2026-10-22"}', '[]');
select pg_temp.expect((select bank_id from public.invoices where id = '30000000-0000-0000-0000-000000000001') = (select uni from b), 'faktura: izabrana banka');
select pg_temp.expect((select bank_id from public.invoices where id = '30000000-0000-0000-0000-000000000002') = (select intesa from b), 'faktura bez banke → Intesa');

-- Banke: izmena da, brisanje ne
update public.banks set account_rsd = '170-1-11' where code = 'unicredit';
select pg_temp.expect((select account_rsd from public.banks where code = 'unicredit') = '170-1-11', 'izmena računa banke');
delete from public.banks;
select pg_temp.expect((select count(*) from public.banks) = 2, 'brisanje banke odbijeno');

-- ---------- Neaktivan i anon ne vide banke ----------
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'authenticated');
select pg_temp.expect((select count(*) from public.banks) = 0, 'neaktivan: 0 banaka');
reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.expect((select count(*) from public.banks) = 0, 'anon: 0 banaka');

reset role;
rollback;
