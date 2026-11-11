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
  'mp.sharedNumber': 'Dokumentai, kurių numeris sutampa su kitų metų', 'mp.sharedNumberNote': 'Šie dokumentų numeriai jau išsaugoti kitiems metams (numeracija dažnai prasideda iš naujo kiekvienais metais). Jie laikomi atskirais dokumentais ir senųjų nepakeičia. Jei tai tų pačių sąskaitų pataisytos versijos, faile turi būti originalios datos.',
  'pw.previous_unverified': 'Jūsų duomenys prasideda {dataFrom}, bet ankstesnis laikotarpis prasideda anksčiau. NEŽINOMA, ar eksportas jį apima (pirma operacija nebūtinai yra eksporto pradžia), todėl pokyčiai nerodomi. Importuodami nurodykite eksporto laikotarpį arba pasirinkite trumpesnį laikotarpį.',
  'pw.previous_declared_incomplete': 'Nurodėte, kad eksportas prasideda {declaredFrom}, jau po ankstesnio laikotarpio pradžios: jis padengtas tik iš dalies, todėl pokyčiai nerodomi.',
  'lim.previous_unknown': 'Ankstesnis palyginimo laikotarpis prasideda {from}, o jūsų pirma operacija – {dataFrom}. NEŽINOMA, ar eksportas apima ankstesnę dalį (galbūt tiesiog nebuvo operacijų). Pokyčiai ir palyginimu pagrįsti radiniai nerodomi. Jei eksportas iš tiesų prasideda anksčiau, importuodami nurodykite jo laikotarpį; kitaip pasirinkite trumpesnį laikotarpį.',
  'lim.previous_incomplete': 'Nurodėte, kad eksportas prasideda {declaredFrom}, o ankstesnis palyginimo laikotarpis prasideda {from}: jis padengtas tik iš dalies. Pokyčiai ir palyginimu pagrįsti radiniai nerodomi. Įkelkite ankstesnį eksportą arba pasirinkite trumpesnį laikotarpį.',
  'import.cover.title': 'Eksporto laikotarpis (neprivaloma)', 'import.cover.from': 'Nuo', 'import.cover.to': 'Iki',
  'import.cover.help': 'Jei žinote, kokį laikotarpį apima ataskaita, nurodykite. Tada ramus pradžios ar pabaigos laikotarpis (be operacijų) atskiriamas nuo trūkstamų duomenų, o palyginimais su ankstesniu laikotarpiu galima pasitikėti. Jei nežinote, palikite tuščią: žinoma tik pirma ir paskutinė operacija.',
};
export default lt;
