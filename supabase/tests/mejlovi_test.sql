-- Mejlovi: više mejlova po partneru, primaoci obračuna, lista email_recipients.
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

insert into public.partners (id, group_type, name, emails) values
  ('10000000-0000-0000-0000-000000000001', 'ulaz', 'Poslodavac US', array['ap@us.example', 'boss@us.example']);
select pg_temp.expect((select email from public.partners where id = '10000000-0000-0000-0000-000000000001') = 'ap@us.example', 'email = prvi iz liste');
select pg_temp.expect((select count(*) from public.email_recipients where email in ('ap@us.example', 'boss@us.example')) = 2, 'mejlovi partnera u email_recipients');

update public.partners set emails = array['boss@us.example', 'novi@us.example'] where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect((select email from public.partners where id = '10000000-0000-0000-0000-000000000001') = 'boss@us.example', 'izmena liste menja prvi mejl');
select pg_temp.expect((select count(*) from public.email_recipients where lower(email) = 'boss@us.example') = 1, 'bez duplikata u email_recipients');
select pg_temp.expect((select count(*) from public.email_recipients where email = 'novi@us.example') = 1, 'novi mejl dodat u email_recipients');

update public.partners set emails = '{}' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect((select email from public.partners where id = '10000000-0000-0000-0000-000000000001') is null, 'prazna lista → email null');
select pg_temp.expect_error($$update public.partners set emails = array['nije-mejl'] where id = '10000000-0000-0000-0000-000000000001'$$, 'neispravan mejl odbijen');

-- Primaoci obračuna
select pg_temp.expect((select count(*) from public.payroll_recipients) = 2, 'redovi R i K');
update public.payroll_recipients set emails = array['knjigovodja@example.rs', 'BOSS@us.example'] where type = 'R';
select pg_temp.expect((select emails from public.payroll_recipients where type = 'R') = array['knjigovodja@example.rs', 'BOSS@us.example'], 'primaoci R sačuvani');
select pg_temp.expect((select name from public.email_recipients where email = 'knjigovodja@example.rs') = 'Obračun R', 'primalac obračuna u email_recipients');
select pg_temp.expect((select count(*) from public.email_recipients where lower(email) = 'boss@us.example') = 1, 'isti mejl drugim slovima nije dupliran');
select pg_temp.expect_error($$update public.payroll_recipients set emails = array['x@'] where type = 'K'$$, 'neispravan primalac obračuna odbijen');
delete from public.payroll_recipients;
select pg_temp.expect((select count(*) from public.payroll_recipients) = 2, 'brisanje primalaca obračuna odbijeno');

reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.expect((select count(*) from public.payroll_recipients) = 0, 'anon: 0 primalaca obračuna');

reset role;
rollback;
