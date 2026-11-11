import type fix from './fix.en';
const lt: Record<keyof typeof fix, string> = {
  'issue.credit_sign_ambiguous': 'Kreditinės eilutė su teigiama suma NEimportuota (kitos kreditinės yra neigiamos)',
  'issue.quantity_sign_normalised': 'Neigiamos sumos eilutės kiekis padarytas neigiamas (grąžinimai mažina kiekį)',
  'issue.quantity_sign_ambiguous': 'Kiekis ignoruotas: jo ženklas nesutampa su sumos ženklu',
  'issue.cost_suspect': 'Savikaina nenaudojama: neigiama, gerokai viršija kainą arba nežinomo ženklo grąžinimo savikaina',
  'issue.cost_zero': 'Nulinė pardavimo savikaina (paliekama; jei reiškia „nežinoma“, marža bus per didelė)',
  'itrust.credit_ambiguous': '{n} eil. pažymėta kaip kreditinės, bet jų suma TEIGIAMA, o kitos kreditinės neigiamos. Faile sumaišytos dvi ženklų taisyklės, todėl šios eilutės neimportuotos (kitaip jos būtų skaičiuojamos kaip pardavimai). Pataisykite ženklus faile ir importuokite iš naujo.',
  'sales.margin_overview.body_partial': 'Bendrasis pelnas – {profit} iš pardavimų, kuriems yra savikaina, atėmus grąžinimus su žinoma savikaina. Šie pardavimai sudaro tik {coverage} visų pardavimų pajamų, todėl tai ne visos apyvartos marža.',
  'mu.cost_revenue_coverage': 'Savikaina žinoma mažiau nei 80 % pardavimų PAJAMŲ (net jei ji yra daugelyje eilučių)', 'mu.returns_cost_unknown': 'Grąžinimai / kreditinės reikšmingi, o jų savikainos nėra arba ženklas nežinomas', 'mu.mixed_units': 'Kiekiai skirtingais vienetais, kurių sudėti negalima (pvz., kg ir vnt.)', 'mu.units_missing': 'Dalis kiekių neturi vieneto, o kiti turi',
  'lim.units_unstated': 'Faile nenurodyti matavimo vienetai, todėl kiekiai sudedami tokie, kokie yra, laikant, kad jie tuo pačiu vienetu.',
  'lim.margin_partial': 'Marža apima tik {pct} pardavimų pajamų (eilutes su tinkama savikaina). Tai ne visos apyvartos marža.',
  'lim.previous_incomplete': 'Ankstesnis palyginimo laikotarpis prasideda {from}, o jūsų duomenys – {dataFrom}: {missing} d. jo faile nėra. Pokyčiai ir radiniai, pagrįsti palyginimu, nerodomi, nes būtų lyginamas pilnas laikotarpis su daliniu. Įkelkite ankstesnį eksportą arba pasirinkite trumpesnį laikotarpį.',
  'mp.sharedNumber': 'Dokumentai, kurių numeris sutampa su kitų metų', 'mp.sharedNumberNote': 'Šie dokumentų numeriai jau išsaugoti kitiems metams (numeracija dažnai prasideda iš naujo kiekvienais metais). Jie laikomi atskirais dokumentais ir senųjų nepakeičia. Jei tai tų pačių sąskaitų pataisytos versijos, faile turi būti originalios datos.',
};
export default lt;
