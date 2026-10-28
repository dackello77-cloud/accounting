# Testovi baze

`access_test.sql` proverava RLS, storno, dashboard, karticu, fakture, audit i storage;
`potrazivanja_test.sql` podatke računa, status po uplatama (delimično, preplata, storno) i pristup.
Oba rade u transakciji sa `rollback` i ne ostavljaju podatke.

Docker nije dostupan, pa se pokreće na privremenoj lokalnoj bazi (Homebrew Postgres)
sa minimalnim `auth` / `storage` šemama, pa migracije, pa ovi fajlovi:

    psql -v ON_ERROR_STOP=1 -f supabase/tests/access_test.sql

Svaka provera ispisuje `ok …`; prva neuspešna prekida skriptu sa `FAIL: …`.

# Testovi aplikacije

`tests/e2e_m3.mjs` (Playwright, protiv DEV projekta) prolazi kroz prijavu, Dodaj / Uredi,
Ulaz / Porezi / Klijenti / Zaposleni, Pregled + STORNO, Karticu, Notes, istek sesije i XSS.
Koristi probni nalog `test` (lozinka samo u env `TEST_PASSWORD`, nikad u repozitorijumu).
