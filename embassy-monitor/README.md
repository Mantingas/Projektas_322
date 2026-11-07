# Ambasadų / kelionių rekomendacijų monitorius

Kas 15 min tikrina JAV (travel.state.gov), JK (gov.uk FCDO), Vokietijos (Auswärtiges Amt open data) ir Kanados (travel.gc.ca) rekomendacijas
Lietuvai, Latvijai, Estijai, Lenkijai, Suomijai. Pokyčiui su raktažodžiais
(ordered/authorized departure, evacuat…, level 4, do not travel) siunčia **SKUBU** pranešimą.
Pirmas paleidimas tik išsaugo esamą būseną.

## Kanalai (įjunkite nustatę kintamuosius)
| Kanalas | Kintamieji |
|---|---|
| El. paštas | `SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM EMAIL_TO` |
| SMS (Twilio) | `TWILIO_SID TWILIO_TOKEN TWILIO_FROM SMS_TO` |
| Telegram | `TELEGRAM_TOKEN TELEGRAM_CHAT_ID` |
| Push (ntfy.sh programėlė) | `NTFY_TOPIC` (nebūtina `NTFY_SERVER`) |

`SEND_INFO=1` – siųsti ir nesvarbius pokyčius.

## Naudojimas
    python3 monitor.py --test     # patikrinti kanalus
    python3 monitor.py            # vienas patikrinimas
    */15 * * * * cd /kelias/embassy-monitor && python3 monitor.py   # crontab

Testai: `python3 test_monitor.py`

## Vokietijos ir Kanados šaltiniai
Tai JSON šaltiniai (`DE_FEED`, `CA_FEED` faile `monitor.py`). Jų tikra struktūra kūrimo metu
nebuvo patikrinta (tinklas užblokuotas), todėl kodas struktūros nepriklauso: suranda mažiausią
objektą, kuriame minima šalis (pvz. Litauen/Lithuania/LT), ir seka jo pokyčius; vokiškas
`*warning*` laukas, tapęs `true`, laikomas SKUBIU. Po pirmo paleidimo patikrinkite, ar žurnale
nėra `[klaida] DE` / `[klaida] CA`, ir ar `state.json` turi `DE|…` bei `CA|…` įrašų.

## Apribojimai
Tai vėluojantis rodiklis, galimi klaidingi aliarmai; staigaus puolimo atveju
signalo gali nebūti. Šaltinių URL realiai neišbandyti iš kūrimo aplinkos –
pirmą kartą paleiskite ir pažiūrėkite, ar nėra „[klaida]“ eilučių.
Nepakeičia oficialių Lietuvos institucijų (KAM, URM, 112) pranešimų.

## GitHub Actions (be savo serverio)
Workflow: `.github/workflows/embassy-monitor.yml` (kas 15 min; būsena laikoma Actions cache).
**Svarbu:** `schedule` veikia tik pagrindinėje (default) šakoje – pirma sujunkite (merge) šią šaką.

Repo → Settings → Secrets and variables → Actions → New repository secret:

- **Telegram:** Telegram'e parašykite @BotFather → `/newbot` → gausite `TELEGRAM_TOKEN`.
  Savo botui parašykite bet ką, tada atsidarykite
  `https://api.telegram.org/bot<TOKEN>/getUpdates` ir paimkite `chat.id` → `TELEGRAM_CHAT_ID`.
- **Push (ntfy):** įdiekite ntfy programėlę, užsiprenumeruokite sunkiai atspėjamą temą
  (pvz. `ambasados-x7k2q9m4`), tą pačią reikšmę įrašykite į `NTFY_TOPIC`.
- **El. paštas:** pvz. Gmail su „App password“: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
  `SMTP_USER`, `SMTP_PASS` (app password), `SMTP_FROM`, `EMAIL_TO`.

Tada Actions → Embassy monitor → Run workflow su `test` = true, kad patikrintumėte visus kanalus.
Pastaba: GitHub gali vėlinti `schedule` paleidimus dešimtis minučių.
