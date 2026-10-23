# M&M Safety Accounting 2.0 — specifikacija (Supabase)

Datum: 17. 10. 2026. Status: sve celine pregledao i odobrio vlasnik.
Polazna verzija 1.x je u `legacy/` (`index.html` ~4.100 linija, `code.gs` Google Apps Script sa 32 akcije, Google Sheet, Google Drive, Gmail).

Aplikacija je **lični alat vlasnika** (jedan korisnik) za praćenje novca, fakture poslodavcima u SAD i mesečne obračune. Zvanično knjigovodstvo vodi knjigovođa; SEF i PDV nisu potrebni ni sada ni kasnije.

---

## 0. Odluke

| Tema | Odluka |
|---|---|
| Baza | Supabase (Postgres) umesto Google Sheet-a, **besplatan plan** |
| Backend | Aplikacija razgovara direktno sa Supabase-om: Supabase Auth, RLS u bazi, Edge Function samo za slanje mejla. Apps Script se gasi. |
| Dokumenti | Supabase Storage (privatni bucket-i) umesto Drive foldera |
| Mejl | **Gmail kao i do sada**, sa `mmsafetydoo@gmail.com`, preko Edge Function i Gmail SMTP-a (port 465) |
| Hosting | GitHub Pages, isto mesto kao 1.x |
| PDF | Pravi se u pregledaču; mala odstupanja u prelomu i fontu su prihvatljiva |
| Korisnici | Samo vlasnik; bez uloga; ostaje prijavljen dok se sam ne odjavi |
| Valuta | Sve transakcije u RSD; USD samo kao preračun u Obračunu R; faktura RSD ili USD po izboru |
| Brisanje | Transakcije i fakture se storniraju, partneri i artikli deaktiviraju; ništa se ne briše |
| Podaci | Prenosi se sve od početka |

Van obima 2.0: SEF, PDV, uvoz izvoda, praćenje naplate faktura, CSV izvoz, više korisnika i uloge, novi izveštaji.

---

## 1. Šta aplikacija radi (mora da radi i u 2.0)

Izgled ekrana i redosled polja ostaju kao u 1.x (`legacy/index.html` je referenca za izgled i ponašanje).

| Meni | Šta radi |
|---|---|
| Prijava | Username ili email + lozinka |
| Dashboard | Trenutno stanje, ukupan ulaz i izlaz, prihodi i rashodi tekuće godine, trake po kategorijama (prihodi, porezi, klijenti, zaposleni), poslednjih 20 transakcija, podsetnici za 24 h u meniju; sat (Europe/Belgrade), tamna/svetla tema |
| Dodaj / Uredi | Partneri po grupama Ulaz, Porezi, Klijenti, Zaposleni; Artikli (naziv, cena); izmena i deaktivacija |
| **Ulaz, Porezi, Klijenti, Zaposleni** (4 stavke menija, umesto jedne „Transakcije”) | Sve četiri otvaraju **isti obrazac**; kategorija je određena stavkom menija (nema izbora tipa); naslov „Nova transakcija – <kategorija>”; **Naziv je padajući meni samo sa aktivnim partnerima te kategorije** (adresa i žiro se popunjavaju); iznos (srpski format, `,` decimalno); **Datum** (podrazumevano danas); broj fakture; napomena; prilog iz skeniranih računa; posle čuvanja SAVE PDF / PRINT / SAVE PDF & PRINT / NOVA TRANSAKCIJA |
| Pregled | Transakcije za period (podrazumevano tekući mesec), sve kategorije, STORNO |
| Kartica | Kategorija, partner (izbor iz liste), period; pojedinačno / po mesecima / po godinama; zbir; SAVE PDF / PRINT |
| Sačuvaj račun | Upload skeniranog računa uz napomenu u „inbox” |
| Dokumenti | Lista fajlova po kategoriji (Transakcije, Kartice, Izvodi dinarski, Izvodi devizni, Obračun R, Obračun K, Računi, Fakture): otvori, preuzmi; upload izvoda |
| Notes / Podsetnik | Beleške i podsetnici sa datumom i vremenom; izmena; brisanje (označavanjem) |
| Obračun R (račun) | Specifikacija troškova koji idu preko računa (porezi, mesečni troškovi, plate na račun); **šalje se mejlom poslodavcu u SAD, koji posle toga uplaćuje novac**. Mesec, godina, kurs USD; kolona USD se automatski preračunava iz RSD kad se unese kurs; učitavanje zaposlenih, iznos za sve; zbir; automatsko pamćenje poslednjeg stanja; SAVE PDF / PRINT / SEND EMAIL. Šalje se oko 25. u mesecu. |
| Obračun K (keš) | Obračun dela koji zaposleni dobijaju na ruke, uz oznaku ko prima na račun a ko keš; **šalje se mejlom poslodavcu u SAD**. Dodatna kolona (tekst ili štikliranje), napomene, automatsko pamćenje; SAVE PDF / PRINT / SEND EMAIL. Šalje se 5. u mesecu. |
| Faktura | Predlog broja `NNN/YYYY`; datum izdavanja, valuta plaćanja (dana), datum plaćanja, mesto, **valuta RSD ili USD**, račun; kupac iz šifarnika (poslodavci iz SAD su u grupi Ulaz, npr. VRH Tracking Tech); stavke (usluga, količina, cena, iznos); pregled uživo; SAVE PDF / PRINT / SEND EMAIL (i knjigovođi) |
| Email primaoci | Lista sačuvanih primalaca; dodavanje iz prozora za slanje |

### Greške 1.x koje se ne smeju ponoviti

1. Prijava samo u pregledaču; API otvoren svakome.
2. Lozinke kao običan tekst, čitljive kroz API.
3. Kartica poredi delove imena („Marko” hvata „Marko Marković”); preimenovanje partnera gubi istoriju.
4. Datum transakcije se ne bira.
5. SAVE PDF pa SEND EMAIL pravi dupli red i dupli PDF fakture.
6. Podaci se ubacuju u HTML bez `escapeHtml`.
7. Neispravan iznos pretvara zbir u `NaN`.

---

## 2. Arhitektura

```
GitHub Pages: index.html + js/*.js (bez build koraka)
   │  supabase-js (anon ključ + JWT korisnika)
   ├── Supabase Auth ........ email + lozinka, trajna sesija
   ├── Postgres + RLS ....... tabele, view, RPC, trigeri
   ├── Storage .............. privatni bucket-i, signed URL (60 s)
   └── Edge Function send-email ──► Gmail SMTP smtp.gmail.com:465 (SSL)
```

- `supabase-js` i `html2pdf.js` sa CDN-a, uvek fiksna verzija.
- `js/config.js`: samo `SUPABASE_URL` i `SUPABASE_ANON_KEY` (anon ključ je javan po dizajnu; repozitorijum aplikacije je javan).
- Service role ključ, Gmail app lozinka i konekcioni string baze **nikad** u repozitorijumu aplikacije.
- PDF: isti HTML šabloni kao u 1.x, pretvaranje u PDF u pregledaču (`html2pdf.js`), upload u Storage. PRINT kao u 1.x (skriveni iframe).
- Edge Functions ne mogu da koriste portove 25 i 587; zato SMTP na 465. Rezerva ako SMTP ne radi pouzdano: Gmail API preko HTTPS-a (OAuth refresh token u secrets).
- Šema se menja samo kroz `supabase/migrations/*.sql`.

---

## 3. Model podataka

Iznosi `numeric(14,2)`, uvek RSD osim `invoices` (valuta fakture) i kursa u obračunu. Datum događaja `date`, vreme unosa `timestamptz`, prikaz Europe/Belgrade. Tabele imaju `created_at timestamptz default now()` i gde ima smisla `created_by uuid default auth.uid()`.

### 3.1 Tabele

**profiles** — `id uuid pk references auth.users`, `username text unique`, `full_name text`, `active boolean default true`. (Jedan red; struktura ostaje da se kasnije lako doda korisnik.)

**partners** — zamenjuje listove Ulaz, Porezi, Klijenti, Zaposleni
`id uuid pk`, `code text unique` (`P-000001`, sekvenca), `group_type text check in ('ulaz','porezi','klijenti','zaposleni')`, `name text not null`, `address text`, `country text default 'RS'` (ISO 2), `tax_id text` (PIB za RS, EIN za US…), `registration_no text` (matični broj, samo RS), `bank_account text`, `email text`, `active boolean default true`, `updated_at`.
Provera: kad je `country = 'RS'` i polje nije prazno, `tax_id ~ '^\d{9}$'` i `registration_no ~ '^\d{8}$'`; za ostale države bez provere formata.
Indeks `(group_type, active, lower(name))`.

**articles** — `id`, `name`, `price numeric(14,2)`, `active`.

**transactions**
`id uuid pk`, `legacy_id bigint unique`, `tx_date date not null`, `type text check in ('ulaz','porezi','klijenti','zaposleni')`, `partner_id uuid references partners` (null samo za migrirane redove bez poklapanja), `partner_name text not null` (snimak u trenutku unosa, za PDF i za nepovezane), `address text`, `bank_account text`, `invoice_number text`, `amount numeric(14,2) not null`, `notes text`, `status text check in ('active','storno') default 'active'`, `storno_at`, `storno_by`, `document_path text`, `created_at`, `created_by`.
Indeksi `(tx_date)`, `(partner_id, tx_date)`, `(type, tx_date)`.

**receipts** — `id`, `storage_path`, `original_name`, `note`, `transaction_id uuid references transactions` (null = u inbox-u), `uploaded_at`, `uploaded_by`.

**invoices** — `id`, `number text unique not null` (`NNN/YYYY`), `issue_date date`, `payment_days int`, `due_date date`, `place text`, `currency text check in ('RSD','USD')`, `bank_account text` (polje „Račun”), `partner_id uuid references partners`, `company_name`, `company_address`, `company_bank_account`, `company_tax_id` (snimci), `total numeric(14,2)`, `status text check in ('izdata','stornirana') default 'izdata'`, `pdf_path`, `created_at`, `created_by`, `updated_at`.

**invoice_items** — `id`, `invoice_id references invoices on delete cascade`, `position int`, `service text`, `qty numeric(12,2)`, `price numeric(14,2)`, `amount numeric(14,2) generated always as (round(qty*price,2)) stored`.

**invoice_counters** — `year int pk`, `last_no int`.

**payroll_r** — `id`, `month int check 1..12`, `year int`, `usd_rate numeric(10,4)`, `data jsonb` (oblik `getObracunRState()` iz 1.x), `pdf_path`, `created_at`.
**payroll_k** — `id`, `month`, `year`, `data jsonb` (oblik `getObracunKState()`), `pdf_path`, `created_at`.
**calc_drafts** — `type text pk check in ('R','K')`, `data jsonb`, `updated_at` (zamenjuje autosave iz Script Properties i localStorage).

**email_recipients** — `id`, `name`, `email text unique`.

**notes** — `id`, `type text check in ('note','reminder')`, `title`, `body`, `remind_at timestamptz`, `status text check in ('active','deleted')`, `created_at`.

**documents** — `id`, `category text check in ('transakcije','kartice','izvodi_dinarski','izvodi_devizni','obracun_r','obracun_k','racuni','fakture')`, `storage_path`, `file_name`, `created_at`.

**audit_log** — `id bigserial`, `at timestamptz default now()`, `user_id`, `action`, `table_name`, `record_id`, `details jsonb`. Puni se trigerima (security definer) na svim poslovnim tabelama i iz `send-email`. Niko ne piše direktno.

### 3.2 View i RPC

- `v_partner_card` — transakcije sa partnerom, za karticu.
- `dashboard_summary(p_year int)` — isto pravilo kao 1.x: `ulaz` je prihod, ostali tipovi rashod, storno se ne računa; vraća stanje, ukupan ulaz/izlaz, zbir po tipu za godinu, poslednjih 20 transakcija.
- `card(p_partner uuid, p_type text, p_from date, p_to date, p_view text)` — `single` / `monthly` / `yearly`; sa partnerom filtrira po `partner_id`, bez partnera po tipu.
- `next_invoice_number(p_year int)` — samo predlog za prikaz.
- `save_invoice(p_invoice jsonb, p_items jsonb)` — `security definer` uz proveru `is_active_user()`; jedna transakcija; bez `id` dodeljuje broj zaključavanjem reda u `invoice_counters` (`for update`); sa `id` ažurira istu fakturu i zamenjuje stavke; ručno upisan broj koji već postoji na drugoj fakturi → greška „Broj fakture je već iskorišćen”.
- `storno_transaction(p_id uuid)` — postavlja status, `storno_at`, `storno_by`; greška ako je već stornirana.

---

## 4. Bezbednost

### 4.1 Prijava

- Supabase Auth, email + lozinka; javna registracija isključena. Nalog vlasnika se pravi jednom u Supabase dashboard-u; nema ekrana Korisnici ni pozivnica.
- Polje „Username ili email”: ako nije email, RPC `email_for_username(text)` (security definer, samo aktivan profil) vraća email. Ista poruka za nepostojeći nalog i pogrešnu lozinku.
- Sesija je trajna (supabase-js `persistSession`, automatsko osvežavanje), i na telefonu; nema automatske odjave.
- Ako sesija ipak istekne ili je odbijena: prijava se prikazuje **preko** aplikacije, otvoreni prozori i uneti podaci ostaju.

### 4.2 RLS

- Uključen na svakoj tabeli. `is_active_user()` (security definer, stable): postoji aktivan `profiles` red za `auth.uid()`.
- Poslovne tabele: select/insert/update za `is_active_user()`; **delete niko** (izuzetak: `invoice_items` kroz `save_invoice`).
- `audit_log`: select za `is_active_user()`; insert/update/delete niko (samo trigeri).
- Anon bez prijave: 0 redova, svaki upis odbijen.

### 4.3 Storage

| Bucket | Sadržaj |
|---|---|
| `receipts` | `inbox/…`, `transactions/<tx_id>/…` |
| `documents` | `transakcije/`, `kartice/`, `fakture/`, `obracun-r/`, `obracun-k/` |
| `statements` | `dinarski/`, `devizni/` |

- Svi privatni; select/insert/update za `is_active_user()`; delete niko iz aplikacije.
- Otvaranje preko `createSignedUrl` (60 s). Dozvoljeni PDF, JPG, PNG, HEIC, do 15 MB.
- Nazivi fajlova kao u 1.x: transakcija `MM-dd-yyyy - Ime - Faktura.pdf`, račun `dd-MM-yyyy - napomena - original`, faktura `Invoice_012_2026.pdf`, obračun `OBRAČUN - R - Oktobar 2026.pdf`. Ponovno čuvanje iste fakture ili obračuna za isti mesec prepisuje fajl (`upsert`).

### 4.4 Edge Function `send-email`

- Proverava JWT i `is_active_user`.
- Ulaz: `to[]`, `subject`, `html`, `attachments[]` (Storage putanje), `kind` (`faktura`/`obracun_r`/`obracun_k`), `record_id`.
- Svaka adresa iz `to` mora postojati u `email_recipients`.
- Šalje preko `smtp.gmail.com:465` (SSL) kao `GMAIL_USER` (`mmsafetydoo@gmail.com`) sa `GMAIL_APP_PASSWORD` iz secrets. Limit Gmail-a: 500 mejlova dnevno.
- **Test režim:** ako postoji secret `TEST_EMAIL_TO`, svaki mejl ide samo na tu adresu, naslov dobija prefiks `[TEST]` i spisak pravih primalaca. Na razvojnom projektu je postavljen (`mmsafetydoo@gmail.com`), na produkciji ne.
- Upisuje `audit_log` (primaoci, kind, record_id).
- Iz `html` uklanja `<script>` i `on*` atribute.

### 4.5 Frontend

- Sve vrednosti iz baze u `innerHTML` kroz `escapeHtml()`; gde može `textContent`.
- U kodu samo anon ključ.

---

## 5. Promene na ekranima u odnosu na 1.x

| Ekran | Promena |
|---|---|
| Meni | „Transakcije” zamenjuju četiri stavke: Ulaz, Porezi, Klijenti, Zaposleni (isti obrazac, kategorija unapred zadata, Naziv kao padajući meni partnera te kategorije) |
| Obrazac transakcije | Novo polje Datum (podrazumevano danas) |
| Dodaj / Uredi | Polja država, poreski broj, matični broj, email; prikaz šifre partnera; deaktivacija umesto brisanja; neaktivni ne ulaze u padajuće menije |
| Kartica | Partner iz liste, kartica po `partner_id` |
| Dokumenti | Lista fajlova iz Storage-a umesto Drive linkova; upload izvoda |
| Faktura | Broj konačan pri prvom čuvanju; ponovno čuvanje ne pravi duplikat; poreski broj kupca u PDF-u ako postoji |
| Obračun R i K | Bez promena za korisnika; poslednje stanje u `calc_drafts` (debounce 1 s) |
| Prijava | Username ili email |

Novih ekrana nema.

---

## 6. Migracija podataka

Skripta `migration/migrate.mjs` (Node, `@supabase/supabase-js`, `xlsx`), lokalno, service role ključ iz `.env`. Ponovljiva: briše samo redove sa oznakom migracije (`legacy_id` / kolona `source = 'migration'`) ili radi na praznoj bazi. Prenosi **sve od početka**.

### 6.1 Ulaz (priprema vlasnik)

1. `migration/input/accounting.xlsx` — Google Sheet preuzet kao Excel.
2. `migration/input/drive/<folder>/` — Drive folderi preuzeti kao zip i raspakovani: Transakcije, Kartice, Računi, Računi uz transakcije, Obračun R, Obračun K, Fakture, Izvodi dinarski, Izvodi devizni.
3. `migration/input/partner_map.csv` (opciono, posle prvog prolaza) — `grupa;stari naziv;šifra partnera`.

### 6.2 Mapiranje

| Iz | U | Pravilo |
|---|---|---|
| Ulaz, Porezi, Klijenti, Zaposleni | `partners` | `group_type` = ime lista malim slovima; dodeljuje se šifra; `country` RS osim ako vlasnik kasnije izmeni; duplikati u istom listu (isti ključ naziva) se spajaju i prijavljuju |
| Artikli | `articles` | Cena kao broj ili tekst `1.234,56` |
| Transakcije | `transactions` | `legacy_id` = ID; datum iz Date ili teksta `d.M.yyyy` / `yyyy-MM-dd` / `M/d/yyyy` (kao `parseDateFlexible` u 1.x); tip malim slovima; partner po `group_type` + ključu naziva (mala slova, bez `.,;:()-_/\`, bez razmaka), zatim po `partner_map.csv`; **bez poklapanja partner se ne pravi automatski**: `partner_id` ostaje null, `partner_name` je stari naziv, red ide u izveštaj; ACTIVE→active, STORNO→storno |
| Faktura | `invoices` | Duplirani brojevi: ostaje poslednji red, ostali u izveštaj; partner po nazivu kompanije; stavke ne postoje u Sheet-u (samo ukupan iznos); valuta nepoznata → `null` uz napomenu u izveštaju; `invoice_counters` = najveći broj po godini |
| ObracunR, ObracunK | `payroll_r`, `payroll_k` | DATA_JSON parsiran |
| Email | `email_recipients` | Bez duplikata adresa |
| Notes | `notes` | DELETED→deleted |
| Login | — | Ne prenosi se |
| Drive fajlovi | Storage + `documents` / `receipts` / `pdf_path` / `document_path` | Vezivanje po FILE_NAME (fakture, obračuni) i po obrascu naziva (transakcije, računi); ostalo u `documents` po kategoriji foldera |

### 6.3 Izveštaj `migration/output/report.md`

- Broj redova po izvoru i tabeli.
- Zbir aktivnih transakcija po tipu i godini: Sheet = baza do pare; razlika → skripta završava sa greškom.
- Zbir faktura po godini.
- Spisak naziva bez partnera (sa brojem transakcija i zbirom), dupliranih faktura, nepovezanih fajlova, redova sa neispravnim datumom ili iznosom.
- Uzorak 10 transakcija iz oba izvora jedna pored druge.
- Ukupna veličina fajlova (limit besplatnog plana 1 GB; upozorenje iznad 800 MB).

---

## 7. Redosled rada

| Korak | Šta | Gotovo kada |
|---|---|---|
| M1 Šema | Tabele, view, RPC, audit trigeri, RLS, storage policy | Testovi pristupa prolaze |
| M2 Prijava | config, `js/api.js`, prijava, trajna sesija, prijava preko otvorenih prozora | Prijava radi; bez prijave nema podataka |
| M3 Osnovni ekrani | Dashboard, Dodaj/Uredi, Ulaz/Porezi/Klijenti/Zaposleni (bez priloga), Pregled, Kartica, Notes, primaoci | Isti zbirovi kao 1.x na test podacima; **pregled vlasnika** |
| M4 Dokumenti | Storage, PDF, računi, Dokumenti, Obračun R i K, Faktura, `send-email` | PDF i mejl rade za fakturu i oba obračuna; **pregled vlasnika** (probni mejl sebi) |
| M5 Migracija (probna) | Skripta, prenos pravih podataka na razvojni projekat, izveštaj; vlasnik popunjava `partner_map.csv` | Zbirovi do pare; **pregled vlasnika** |
| M6 Završna provera | Svi ekrani na prenetim podacima, ispravke razlika | Vlasnik potvrdi da sve radi kao 1.x |
| M7 Prelazak | Odeljak 9 | Vlasnik radi u 2.0 |

**Claude Code staje i čeka odobrenje vlasnika posle M3, M4 i M5.** M7 počinje samo uz izričitu potvrdu vlasnika.

---

## 8. Testiranje

Razvojni (dev) i produkcijski (prod) projekat; testovi samo na dev.

**Baza** (`supabase test db` sa pgTAP ako je Docker dostupan, inače Node testovi protiv dev-a):
- anon: 0 redova, upis odbijen; neaktivan profil: isto;
- aktivan: dozvoljeni CRUD; delete na `transactions`, `invoices`, `partners` odbijen;
- `audit_log` se ne može pisati direktno;
- `save_invoice` dva puta sa istim `id` → jedan red; dve nove paralelno → različiti brojevi;
- `dashboard_summary` i `card` na poznatom skupu daju očekivane zbirove; storno se ne računa.

**Aplikacija** (Playwright protiv dev-a; Chromium je instaliran, ne pokretati `playwright install`):
- prijava; istek sesije preko otvorene fakture, sadržaj ostaje;
- stavka menija Porezi: padajući meni ima samo partnere grupe Porezi;
- transakcija sa jučerašnjim datumom vidi se u Pregledu i Kartici;
- naziv `<img src=x onerror=alert(1)>` prikazan kao tekst (dashboard, Pregled, Kartica);
- faktura: SAVE PDF pa SEND EMAIL → jedan red, jedan fajl, mejl stiže samo na `TEST_EMAIL_TO` sa `[TEST]`.

**Migracija:** probni prenos sa pravim izvozom; izveštaj bez grešaka u zbirovima.

---

## 9. Prelazak, bekap i povratak

**Termin:** Obračun K se šalje 5., Obračun R oko 25. u mesecu. Prelazak između **6. i 20.** u mesecu (najbolje 6–10.), uz jedan radni dan paralelnog rada. Ako je M6 gotov posle 20., čeka se 6. naredni mesec.

1. Dan pre: probna migracija na dev je odobrena (M5, M6).
2. Dan prelaska: u staru aplikaciju se više ne unosi.
3. Novi izvoz Sheet-a i Drive-a, migracija na prod, izveštaj bez grešaka.
4. Novi `index.html` na GitHub Pages (isto mesto).
5. Stari Apps Script deploy se arhivira (Manage deployments > Archive), ne briše. Sheet i Drive ostaju kao arhiva.

**Povratak:** ponovo aktivirati stari deploy i stari `index.html`; podaci uneti u 2.0 posle prelaska prenose se ručno.

**Bekap i sprečavanje pauze (besplatan plan):**
- GitHub Actions workflow u **zasebnom privatnom repozitorijumu** `mm-accounting-backup` (artifact-i javnog repozitorijuma su dostupni svima).
- Svakog dana u 03:00 (Europe/Belgrade): `pg_dump` cele baze, šifrovan `gpg --symmetric` (lozinka u secrets), artifact 30 dana. Isti posao dnevno pristupa bazi i REST API-ju, pa projekat nije neaktivan 7 dana i ne pauzira se.
- Nedeljno: svi Storage fajlovi kao šifrovana zip arhiva, 30 dana.
- Neuspeh workflow-a → GitHub šalje mejl vlasniku.
- Secrets (samo u tom repozitorijumu): `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE`.
- Uputstvo za vraćanje (`pg_restore` u novi projekat + upload fajlova) je deo isporuke i jednom se proba na dev-u.
- Limiti besplatnog plana: 500 MB baze, 1 GB fajlova.

---

## 10. Šta priprema vlasnik

- [ ] Supabase nalog (besplatan plan), projekti dev i prod, region EU (Frankfurt).
- [ ] Project URL i anon ključ dev projekta dati Claude Code-u (idu u `js/config.js`).
- [ ] Service role ključ upisati sam u `.env` na svom računaru (po `.env.example`).
- [ ] `supabase login` i `supabase link --project-ref <ref>` u terminalu.
- [ ] Na `mmsafetydoo@gmail.com`: verifikacija u dva koraka i app lozinka; postaviti `supabase secrets set GMAIL_USER=mmsafetydoo@gmail.com GMAIL_APP_PASSWORD=...` (na dev još i `TEST_EMAIL_TO=mmsafetydoo@gmail.com`).
- [ ] Nalog vlasnika (email + lozinka) napraviti u Supabase dashboard-u (Authentication > Users > Add user) na dev, kasnije na prod.
- [ ] Privatni GitHub repozitorijum `mm-accounting-backup` i njegovi secrets.
- [ ] Izvoz Sheet-a (.xlsx) i Drive foldera (zip); proveriti ukupnu veličinu (limit 1 GB).
- [ ] Do prelaska proveriti deljenje Drive foldera (linkovi su javno u kodu 1.x).

Ključevi se nikad ne šalju u čet.

---

## 11. Odgovorena pitanja

- Plan: besplatan, uz bekap i sprečavanje pauze iz odeljka 9.
- Pošiljalac mejla: `mmsafetydoo@gmail.com`, običan Gmail (500 mejlova dnevno).
- Korisnici: samo vlasnik, bez uloga.
- SEF i PDV: nisu potrebni; knjigovođa vodi zvanično knjigovodstvo.
- Knjigovođa dobija PDF fakture mejlom; CSV izvoz nije potreban.
