# M&M Safety Accounting — pravila projekta

Lični alat vlasnika (jedan korisnik) za praćenje novca, fakture poslodavcima u SAD i mesečne obračune R i K.
Radi se verzija 2.0: prelazak sa Google Sheet / Apps Script / Drive na **Supabase** (besplatan plan); mejl ostaje Gmail.
Specifikacija: `docs/V2_SPEC.md` — odobrena od vlasnika. Pročitaj je celu pre prve izmene i radi po koracima iz odeljka 7.

## Kontrolne tačke

- Posle **M3, M4 i M5** stani, napiši vlasniku kratko šta da proveri i čekaj odobrenje.
- **M7 (produkcija)** samo uz izričitu potvrdu vlasnika.
- Kad nešto u specifikaciji nije jasno ili se pokaže kao pogrešno, pitaj vlasnika umesto da pogađaš.

## Struktura

| Putanja | Šta je |
|---|---|
| `index.html` | Ekrani i stilovi; izgled i redosled polja kao u `legacy/index.html` |
| `js/config.js` | Samo `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `js/api.js` | Sav pristup bazi, Storage-u i Edge Function-u na jednom mestu |
| `js/*.js` | ES moduli po ekranima, bez bundlera |
| `supabase/migrations/*.sql` | Šema, RLS, view, RPC, trigeri |
| `supabase/functions/send-email/` | Edge Function (Deno), Gmail SMTP 465 |
| `supabase/tests/` | pgTAP testovi |
| `migration/` | Jednokratna migracija (`input/` i `output/` u `.gitignore`) |
| `tests/` | Playwright testovi |
| `backup/` | Workflow i uputstvo za privatni repozitorijum `mm-accounting-backup` (ne aktivira se u ovom, javnom repozitorijumu) |
| `legacy/` | Kod 1.x, samo referenca; ne menjati |

## Pravila

1. Repozitorijum aplikacije je **javan**: u njemu nikad service role ključ, Gmail app lozinka, konekcioni string ni podaci. Samo `.env.example`.
2. RLS na svakoj tabeli; nova tabela bez policy-ja je greška. Poslovni podaci se ne brišu (storno / `active = false`).
3. Šema samo kroz `supabase/migrations`.
4. Novac `numeric(14,2)`; sve u RSD osim valute fakture i kursa u Obračunu R. U interfejsu srpski format `1.234,56`.
5. Datum događaja `date`, vreme unosa `timestamptz`, prikaz Europe/Belgrade.
6. Vrednosti iz baze u `innerHTML` kroz `escapeHtml()`; gde može `textContent`.
7. Tekst i poruke grešaka na srpskom (latinica).
8. CDN biblioteke sa fiksnom verzijom.
9. Testovi samo na dev projektu. Na dev-u mejl ide samo na `TEST_EMAIL_TO`.
10. Mali commitovi sa oznakom koraka (npr. `M3: kartica po partner_id`).

## Komande

- `supabase db push` na dev (ili `supabase db reset` lokalno ako je Docker dostupan); `supabase test db`
- `supabase functions deploy send-email`
- Playwright: Chromium je instaliran, ne pokretati `playwright install`
- `node migration/migrate.mjs --target=dev` (prod samo u M7, uz potvrdu vlasnika)
