import monitor as m

ATOM = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id><title>Lithuania travel advice</title>
<updated>%s</updated><summary>%s</summary><link href="http://x"/></entry></feed>'''
RSS = b"<rss><channel></channel></rss>"

def run(summary, state):
    f = lambda url: RSS if "state.gov" in url else (ATOM % (b"2026-11-07", summary) if "lithuania" in url else (b"{}" if "gov.uk" not in url else b"<feed/>"))
    return m.check(m.collect(f), state)

s0, a0 = run(b"Safety and security", None)
assert a0 == [] and s0
s1, a1 = run(b"Safety and security", s0)
assert a1 == []                                   # nepasikeitė
s2, a2 = run(b"Minor update to entry rules", s1)
assert len(a2) == 1 and a2[0][0] is False         # pokytis, ne skubus
s3, a3 = run(b"US ordered departure of non-emergency staff", s2)
assert len(a3) == 1 and a3[0][0] is True          # skubus
print("OK")

# ---- DE / CA JSON ----
import json
DE = {"response": {"1": {"lastModified": 1, "title": "Litauen: Reise- und Sicherheitshinweise",
                         "warning": False, "partialWarning": False},
                   "2": {"title": "Frankreich: Reise- und Sicherheitshinweise", "warning": True}}}
CA = {"data": {"LT": {"country-iso": "LT", "country-eng": "Lithuania",
                      "advisory-text": "Take normal security precautions"},
               "FR": {"country-iso": "FR", "country-eng": "France", "advisory-text": "Avoid all travel"}}}

def run2(de, ca, state):
    def f(url):
        if "auswaertiges" in url: return json.dumps(de).encode()
        if "international.gc.ca" in url: return json.dumps(ca).encode()
        return b"<feed/>" if "gov.uk" in url else RSS
    return m.check(m.collect(f), state)

t0, b0 = run2(DE, CA, None)
keys = [k for k in t0 if k.startswith(("DE|", "CA|"))]
assert len(keys) == 2, keys                      # tik Lietuva, ne Prancūzija
t1, b1 = run2(DE, CA, t0); assert b1 == []
CA2 = json.loads(json.dumps(CA)); CA2["data"]["LT"]["advisory-text"] = "Avoid all travel"
t2, b2 = run2(DE, CA2, t1)
assert len(b2) == 1 and b2[0][1] == "CA" and b2[0][0] is True
DE2 = json.loads(json.dumps(DE)); DE2["response"]["1"]["warning"] = True
t3, b3 = run2(DE2, CA2, t2)
assert len(b3) == 1 and b3[0][1] == "DE" and b3[0][0] is True
DE3 = json.loads(json.dumps(DE2)); DE3["response"]["1"]["lastModified"] = 2
t4, b4 = run2(DE3, CA2, t3)
assert len(b4) == 1 and b4[0][0] is True        # pakitęs tekstas, vis dar su įspėjimu
print("OK json")

# ---- JAV ambasada ----
EMB = b"""<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><guid>a1</guid><title>Demonstration Alert</title><link>http://e/1</link>
<description>Protest near Seimas</description></item></channel></rss>"""
EMB2 = EMB.replace(b"</channel>", b"""<item><guid>a2</guid><title>Security Alert</title><link>http://e/2</link>
<description>Embassy ordered departure of family members</description></item></channel>""")
def run3(emb, state):
    def f(url):
        if "usembassy" in url: return emb
        return b"{}" if "gov.uk" not in url else b"<feed/>"
    return m.check([x for x in m.collect(f)], state)
u0, c0 = run3(EMB, None); assert any(k.startswith("JAV amb.|") for k in u0)
u1, c1 = run3(EMB, u0); assert c1 == []
u2, c2 = run3(EMB2, u1)
assert len(c2) == 1 and c2[0][1] == "JAV amb." and c2[0][0] is True
assert "JAV amb." in m.ALWAYS_NOTIFY
print("OK embassy")
