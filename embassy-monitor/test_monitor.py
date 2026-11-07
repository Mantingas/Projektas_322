import monitor as m

ATOM = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id><title>Lithuania travel advice</title>
<updated>%s</updated><summary>%s</summary><link href="http://x"/></entry></feed>'''
RSS = b"<rss><channel></channel></rss>"

def run(summary, state):
    f = lambda url: RSS if "state.gov" in url else (ATOM % (b"2026-11-07", summary) if "lithuania" in url else b"<feed/>")
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
