# Bekap i vraćanje — M&M Safety Accounting

Bekap radi GitHub Actions u **zasebnom privatnom** repozitorijumu `mm-accounting-backup`.
U ovom (javnom) repozitorijumu je samo izvor; ovde se ništa ne pokreće.

| Šta | Kada | Čuva se |
|---|---|---|
| Baza: šema `public` + svi podaci, nalozi (`auth.users`, `auth.identities`) | svaki dan 03:00 (zimi; leti 04:00) | 30 dana |
| Svi fajlovi iz Storage-a (`documents`, `receipts`, `statements`) | nedeljom, ili ručno | 10 dana |

Sve je šifrovano (`gpg`, AES-256) lozinkom `BACKUP_PASSPHRASE`. **Bez te lozinke bekap se ne može otvoriti** — čuvati je i van GitHub-a (npr. u menadžeru lozinki).
Dnevni posao ujedno čita bazu i REST API, pa Supabase ne pauzira besplatni projekat posle 7 dana neaktivnosti.
Ako posao ne uspe, GitHub šalje mejl.

Fajlovi se čuvaju 10, a ne 30 dana: besplatan GitHub nalog ima 500 MB za artifact-e, a jedna kopija fajlova je oko 110 MB.

## Postavljanje (jednom)

1. GitHub → **New repository** → ime `mm-accounting-backup`, **Private**.
2. U njega ubaciti iz ovog foldera:
   - `workflows/backup.yml` → `.github/workflows/backup.yml`
   - `scripts/storage-backup.mjs`, `scripts/storage-restore.mjs` → `scripts/`
   - ovaj `README.md`
3. **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL` — Supabase → projekat → **Connect** → *Session pooler* → URI (port 5432), sa upisanom lozinkom baze.
     (GitHub runneri nemaju IPv6, pa direktna konekcija `db.<ref>.supabase.co` ne radi.)
   - `SUPABASE_URL` — `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — Settings → API Keys → secret / service_role
   - `BACKUP_PASSPHRASE` — duga nasumična lozinka (i zapisati je van GitHub-a)
4. **Actions → backup → Run workflow** (štiklirati „Bekap i fajlova“) i proveriti da su oba posla zelena i da su se pojavili artifact-i `db-…` i `files-…`.

## Vraćanje u novi projekat

Potrebno: `psql`/`pg_restore` verzije ≥ verzije baze (Supabase: 17), `gpg`, Node 22.

1. Napraviti novi Supabase projekat (EU, Frankfurt).
2. SQL Editor: izvršiti sve fajlove iz `supabase/migrations/` (javni repozitorijum aplikacije), redom.
3. GitHub → `mm-accounting-backup` → Actions → poslednji uspešan posao → preuzeti artifact-e i raspakovati.
4. Dešifrovati:

       gpg -d -o public.dump public-YYYY-MM-DD.dump.gpg
       gpg -d -o auth.dump   auth-YYYY-MM-DD.dump.gpg
       gpg -d -o files.zip   files-YYYY-MM-DD.zip.gpg

5. Vratiti podatke (prvo nalozi, pa ostalo) u **praznu** bazu. `session_replication_role = replica` isključuje trigere i provere stranih ključeva tokom vraćanja, pa se `audit_log` ne duplira i redosled tabela nije bitan. Pooler ne prosleđuje `PGOPTIONS`, zato `SET` ide u istu sesiju; sve je jedna transakcija (greška = ništa upisano):

       export NEW_DB_URL='postgresql://…'   # Session pooler URI novog projekta (host i region iz Connect → Direct → Session pooler)
       { echo "SET session_replication_role = replica;"
         pg_restore --data-only --no-owner --no-privileges -f - auth.dump
         pg_restore --data-only --no-owner --no-privileges -f - public.dump
       } | psql "$NEW_DB_URL" -q -v ON_ERROR_STOP=1 --single-transaction -o /dev/null

6. Vratiti fajlove:

       unzip files.zip -d storage
       npm install @supabase/supabase-js@2.49.4
       SUPABASE_URL=https://<novi-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/storage-restore.mjs storage

7. Edge Function `send-email` i njene secrets postaviti kao na starom projektu; u `js/config.js` aplikacije upisati URL i publishable ključ novog projekta.
8. Proveriti: prijava vlasnika, Dashboard (stanje), Dokumenti → otvoriti par fajlova.

Postupak je proveren lokalno (dump → restore u bazu sa istim migracijama: isti broj redova, bez duplog `audit_log`, brojač šifara partnera nastavlja dalje). Proba na Supabase-u (2026-10-23) je pokazala da pooler ignoriše `PGOPTIONS` — zato gornji oblik sa `SET` u istoj sesiji.
