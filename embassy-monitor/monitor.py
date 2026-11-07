#!/usr/bin/env python3
"""Stebi ambasadų/kelionių rekomendacijų pokyčius Baltijos šalims ir kaimynams.

Siunčia pranešimus el. paštu, SMS (Twilio), Telegram ir ntfy (push).
Paleiskite periodiškai (cron). Būsena saugoma state.json.
Nustatymai - aplinkos kintamieji (žr. README.md).
"""
import base64, hashlib, json, os, re, smtplib, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from email.message import EmailMessage

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "state.json")

COUNTRIES = {"lithuania": "Lietuva", "latvia": "Latvija", "estonia": "Estija",
             "poland": "Lenkija", "finland": "Suomija"}

# JAV: vienas bendras RSS; JK: atskiras atom kiekvienai šaliai.
US_FEED = "https://travel.state.gov/_res/rss/TAsTWs.xml"
UK_FEED = "https://www.gov.uk/foreign-travel-advice/{c}.atom"

URGENT = re.compile(
    r"ordered departure|authori[sz]ed departure|evacuat|leave immediately|"
    r"depart (the country )?immediately|level 4|do not travel|"
    r"advise against all travel|suspend(ed)? (embassy )?operations", re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "embassy-monitor/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def parse(xml_bytes):
    """Grąžina [(id, title, text, link)] iš RSS arba Atom."""
    root = ET.fromstring(xml_bytes)
    out = []
    for e in root.iter():
        tag = e.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        g = lambda n: next((c for c in e if c.tag.split("}")[-1] == n), None)
        txt = lambda n: ((g(n).text or "") if g(n) is not None else "").strip()
        link = txt("link")
        if not link and g("link") is not None:
            link = g("link").get("href", "")
        body = " ".join(filter(None, [txt("title"), txt("description"),
                                       txt("summary"), txt("content"), txt("updated")]))
        out.append((txt("guid") or txt("id") or link or txt("title"),
                    txt("title"), re.sub(r"<[^>]+>", " ", body), link))
    return out


def collect(fetcher=fetch):
    items = []
    try:
        for i, t, b, l in parse(fetcher(US_FEED)):
            if any(c in (t + b).lower() for c in COUNTRIES):
                items.append(("JAV", i, t, b, l))
    except Exception as ex:
        print(f"[klaida] JAV: {ex}", file=sys.stderr)
    for c in COUNTRIES:
        try:
            for i, t, b, l in parse(fetcher(UK_FEED.format(c=c))):
                items.append(("JK", f"{c}:{i}", t, b, l))
        except Exception as ex:
            print(f"[klaida] JK {c}: {ex}", file=sys.stderr)
    return items


def load():
    try:
        return json.load(open(STATE))
    except Exception:
        return None


def check(items, state):
    """Grąžina (naujos_būsena, [(urgent, šaltinis, pavadinimas, nuoroda)])."""
    new_state, alerts = {}, []
    for src, i, t, b, l in items:
        h = hashlib.sha256((t + b).encode()).hexdigest()
        key = f"{src}|{i}"
        new_state[key] = h
        if state is not None and state.get(key) != h:
            alerts.append((bool(URGENT.search(t + " " + b)), src, t, l))
    return new_state, alerts


# ---------- kanalai ----------
def env(n): return os.environ.get(n, "").strip()


def send_email(subj, body):
    if not env("SMTP_HOST"): return
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subj, env("SMTP_FROM") or env("SMTP_USER"), env("EMAIL_TO")
    m.set_content(body)
    with smtplib.SMTP(env("SMTP_HOST"), int(env("SMTP_PORT") or 587)) as s:
        s.starttls()
        if env("SMTP_USER"): s.login(env("SMTP_USER"), env("SMTP_PASS"))
        s.send_message(m)


def post(url, data, headers=None):
    req = urllib.request.Request(url, urllib.parse.urlencode(data).encode(), headers or {})
    urllib.request.urlopen(req, timeout=30).read()


def send_sms(subj, body):
    sid, tok = env("TWILIO_SID"), env("TWILIO_TOKEN")
    if not (sid and tok): return
    auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
    post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
         {"From": env("TWILIO_FROM"), "To": env("SMS_TO"), "Body": (subj + " " + body)[:300]},
         {"Authorization": "Basic " + auth})


def send_telegram(subj, body):
    if not env("TELEGRAM_TOKEN"): return
    post(f"https://api.telegram.org/bot{env('TELEGRAM_TOKEN')}/sendMessage",
         {"chat_id": env("TELEGRAM_CHAT_ID"), "text": f"{subj}\n{body}"})


def send_ntfy(subj, body):
    if not env("NTFY_TOPIC"): return
    req = urllib.request.Request(f"{env('NTFY_SERVER') or 'https://ntfy.sh'}/{env('NTFY_TOPIC')}",
                                 body.encode(), {"Title": subj.encode("utf-8").decode("latin-1", "ignore"),
                                                 "Priority": "urgent"})
    urllib.request.urlopen(req, timeout=30).read()


CHANNELS = [send_email, send_sms, send_telegram, send_ntfy]


def notify(subj, body):
    for ch in CHANNELS:
        try:
            ch(subj, body)
        except Exception as ex:
            print(f"[klaida] {ch.__name__}: {ex}", file=sys.stderr)


def main():
    if "--test" in sys.argv:
        notify("TESTAS: ambasadų monitorius", "Jei tai matote, kanalas veikia.")
        return
    state = load()
    new_state, alerts = check(collect(), state)
    json.dump(new_state, open(STATE, "w"))
    if state is None:
        print(f"Pirmas paleidimas: išsaugota {len(new_state)} įrašų, pranešimų nėra.")
        return
    send_info = env("SEND_INFO") == "1"
    for urgent, src, title, link in alerts:
        print(("SKUBU " if urgent else "info ") + f"[{src}] {title} {link}")
        if urgent or send_info:
            notify(("⚠ SKUBU: " if urgent else "Pokytis: ") + f"[{src}] {title}"[:100],
                   f"{title}\n{link}")


if __name__ == "__main__":
    main()
