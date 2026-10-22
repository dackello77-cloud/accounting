# Testovi baze

`access_test.sql` proverava RLS, storno, dashboard, karticu, fakture, audit i storage.
Radi u transakciji sa `rollback`, ne ostavlja podatke.

Docker nije dostupan, pa se pokreće na privremenoj lokalnoj bazi (Homebrew Postgres)
sa minimalnim `auth` / `storage` šemama, pa migracije, pa ovaj fajl:

    psql -v ON_ERROR_STOP=1 -f supabase/tests/access_test.sql

Svaka provera ispisuje `ok …`; prva neuspešna prekida skriptu sa `FAIL: …`.
