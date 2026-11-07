# Ambasadų / kelionių rekomendacijų monitorius

Kas 15 min tikrina JAV (travel.state.gov) ir JK (gov.uk FCDO) rekomendacijas
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

## Apribojimai
Tai vėluojantis rodiklis, galimi klaidingi aliarmai; staigaus puolimo atveju
signalo gali nebūti. Šaltinių URL realiai neišbandyti iš kūrimo aplinkos –
pirmą kartą paleiskite ir pažiūrėkite, ar nėra „[klaida]“ eilučių.
Nepakeičia oficialių Lietuvos institucijų (KAM, URM, 112) pranešimų.
