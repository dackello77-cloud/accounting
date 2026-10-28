-- Izveštaj knjigovođi: podešavanja, mejlovi u email_recipients, slanja, označavanje dokumenata, pristup.
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

select pg_temp.expect((select count(*) from public.accountant_settings) = 1, 'jedan red podešavanja');
update public.accountant_settings set emails = array['knjig@test.example'], start_date = '2026-10-01' where id;
select pg_temp.expect((select count(*) from public.email_recipients where email = 'knjig@test.example') = 1, 'mejl knjigovođe u email_recipients');
select pg_temp.expect_error($$insert into public.accountant_settings (id) values (false)$$, 'drugi red podešavanja');
select pg_temp.expect_error($$update public.accountant_settings set emails = array['nije-mejl'] where id$$, 'neispravan mejl');

insert into public.documents (id, category, storage_path, file_name) values
  ('20000000-0000-0000-0000-000000000001', 'fakture', 'fakture/001.pdf', '001.pdf'),
  ('20000000-0000-0000-0000-000000000002', 'izvodi_devizni', 'devizni/x/iz.pdf', 'iz.pdf');
insert into public.accountant_reports (id, recipients) values
  ('30000000-0000-0000-0000-000000000001', array['knjig@test.example']);
update public.documents set accountant_report_id = '30000000-0000-0000-0000-000000000001'
 where id = '20000000-0000-0000-0000-000000000001' and accountant_report_id is null;
update public.accountant_reports set doc_count = 1 where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.expect((select count(*) from public.documents where accountant_report_id is null
  and category in ('fakture','izvodi_dinarski','izvodi_devizni')) = 1, 'ostaje jedan neposlat dokument');
select pg_temp.expect((select doc_count from public.accountant_reports) = 1, 'broj dokumenata u slanju');
delete from public.accountant_reports;
select pg_temp.expect((select count(*) from public.accountant_reports) = 1, 'slanje se ne briše (nema delete policy)');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'authenticated');
select pg_temp.expect((select count(*) from public.accountant_reports) = 0, 'neaktivan: 0 slanja');
select pg_temp.expect((select count(*) from public.accountant_settings) = 0, 'neaktivan: 0 podešavanja');

select pg_temp.as_user(null, 'anon');
select pg_temp.expect((select count(*) from public.accountant_reports) = 0, 'anon: 0 slanja');

reset role;
rollback;
