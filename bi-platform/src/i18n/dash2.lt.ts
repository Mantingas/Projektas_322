import type d2 from './dash2.en';
const d: Record<keyof typeof d2, string> = {
  'diag.title': 'Importo diagnostika', 'diag.structure': 'Aptikta failo struktūra', 'diag.kind': 'Failo tipas', 'diag.encoding': 'Koduotė', 'diag.delimiter': 'Skyriklis', 'diag.sheet': 'Lapas',
  'diag.size': '{rows} eilučių × {cols} stulpelių', 'diag.headerRow': 'Antraštė {row} eilutėje (patikimumas {pct})', 'diag.truncated': 'Nutraukta: lapas didesnis nei palaikomas dydis',
  'diag.columns': 'Stulpeliai ir siūlomos reikšmės', 'diag.unrecognized': 'Neatpažinti stulpeliai (ignoruojami, kol nepriskirsite)', 'diag.noneUnrecognized': 'Kiekvienas stulpelis su duomenimis turi reikšmę.',
  'diag.validation': 'Validacijos problemos', 'diag.noIssues': 'Problemų nerasta.', 'diag.examples': 'pvz., eilutės {rows}', 'diag.rows': 'Eilutės: perskaityta {read}, importuota {imported}, praleista {skipped}',
  'diag.metrics': 'Ką galima apskaičiuoti iš šio failo', 'diag.available': 'galima', 'diag.unavailable': 'negalima',
  'diag.aspNote': 'Vidutinė pardavimo kaina rodoma, kai skydelyje pasirinkta lygiai viena prekė.',
  'diag.download': 'Atsisiųsti diagnostiką (be langelių reikšmių)', 'diag.privacy': 'Diagnostikos faile yra tik struktūra ir skaičiai – jokių langelių reikšmių, klientų ar prekių. Antraščių pavadinimai įtraukti.',
  'diag.source.saved': 'išsaugotas susiejimas', 'diag.source.template': 'žinomas formatas', 'diag.source.heuristic': 'pasiūlyta', 'diag.source.user': 'jūsų pasirinkimas',
  'diag.confidence': 'patikimumas', 'diag.working': 'Analizuojama…',

  'mode.partial': 'Daliniai dokumentai (tik dalis eilučių)',
  'mode.help.full': 'Faile yra kiekvienas laikotarpio dokumentas su visomis eilutėmis. Tik šis režimas gali pakeisti išsaugotas eilutes – ir tik po jūsų patvirtinimo.',
  'mode.help.incremental': 'Tik naujos ar pakeistos operacijos nuo paskutinio eksporto. Išsaugotos eilutės niekada nekeičiamos.',
  'mode.help.partial': 'Dokumentuose gali būti tik dalis eilučių. Prie išsaugotų dokumentų galima pridėti eilučių; išsaugotos eilutės niekada nešalinamos.',
  'mode.help.unknown': 'Nesate tikri. Viskas, kas galėtų pakeisti išsaugotus duomenis, sulaikoma jūsų peržiūrai.',

  'mp.newDocs': 'Nauji dokumentai', 'mp.additions': 'Išsaugoti dokumentai, gaunantys eilučių', 'mp.held': 'Peržiūrai sulaikytos eilutės', 'mp.heldDocs': 'Peržiūrai sulaikyti dokumentai',
  'mp.removed': 'Dokumentai, kurie prarastų eilučių', 'mp.omitted': 'Dokumentai, kurių išsaugotų eilučių faile nėra (paliekama)', 'mp.absent': 'Šio laikotarpio išsaugoti dokumentai, kurių faile nėra (paliekama)',
  'mp.skipped': 'Praleistos eilutės (tik naujos datos)', 'mp.safe': 'Šis importas nieko neperrašo ir nešalina iš išsaugotų duomenų.',
  'mp.heldNote': 'Sulaikytos eilutės išsaugomos, bet į jokius skaičius neįtraukiamos, kol jų neišspręsite Istorija → Konfliktų peržiūra.',

  'pol.conflicts': 'Jei išsaugotas dokumentas skiriasi nuo failo', 'pol.hold': 'Sulaikyti naujas eilutes peržiūrai (rekomenduojama)', 'pol.replace': 'Pakeisti išsaugotas eilutes šio failo versija',
  'pol.add_alongside': 'Palikti abi versijas (gali dubliuotis)', 'pol.content': 'Eilutės be dokumento numerio, kurios persidengia su išsaugotomis datomis', 'pol.hold_overlap': 'Sulaikyti persidengiančias eilutes peržiūrai (rekomenduojama)',
  'pol.only_new_dates': 'Importuoti tik eilutes, vėlesnes nei paskutinė išsaugota data', 'pol.dedupe_exact': 'Praleisti tikslius dublikatus, likusias pridėti (pataisyta eilutė gali būti suskaičiuota du kartus)', 'pol.proposed': 'siūloma',
  'cf.title': 'Prieš importuodami patvirtinkite', 'cf.replacements': 'Bus pakeistos {n} dokumentų išsaugotos eilutės. Jos paliekamos auditui ir sugrįžta ištrynus šį importą.',
  'cf.removals': '{n} dokumentų neteks eilučių, kurių šiame faile nėra. Jos paliekamos auditui ir sugrįžta ištrynus šį importą.',
  'cf.add_alongside': 'Eilutės bus pridėtos šalia išsaugotų ir gali būti suskaičiuotos du kartus.',
  'cf.content_overlap': 'Persidengiančios eilutės bus pridėtos, bet be dokumentų numerių pataisytos eilutės neatpažinsime: sumos gali dubliuotis.',
  'cf.checkbox': 'Suprantu ir patvirtinu', 'cf.needed': 'Reikalingas patvirtinimas',

  'import.result.held': 'Peržiūrai sulaikytos eilutės', 'import.result.reviewNow': 'Peržiūrėti konfliktus', 'import.result.removed': 'Dokumentai su pašalintomis eilutėmis',
  'lim.held_pending': '{lines} importuotų eilučių sulaikyta jūsų peržiūrai ir NEĮTRAUKTA į jokius skaičius. Išspręskite Istorija → Konfliktų peržiūra.',

  'cr.title': 'Importo konfliktų peržiūra', 'cr.empty': 'Nieko nelaukia jūsų sprendimo.',
  'cr.intro': 'Šios eilutės atkeliavo su importu, bet į jūsų skaičius neįtrauktos, nes failas galėtų pakeisti jau turimus duomenis. Nuspręskite dėl kiekvieno dokumento. Niekas netrinama: pakeistos ir atmestos eilutės lieka audito istorijoje, o ištrynus importą viskas atšaukiama.',
  'cr.stored': 'Išsaugotos eilutės', 'cr.held': 'Eilutės iš {file}', 'cr.useNew': 'Naudoti naują versiją', 'cr.keepStored': 'Palikti išsaugotą', 'cr.keepBoth': 'Palikti abi', 'cr.add': 'Pridėti šias eilutes', 'cr.discard': 'Atmesti šias eilutes',
  'cr.noDoc': 'Eilutės be dokumento numerio', 'cr.bulk': 'Taikyti visiems konfliktams', 'cr.doc': 'Dokumentas', 'cr.amount': 'Suma', 'cr.product': 'Prekė', 'cr.date': 'Data', 'cr.sum': 'Iš viso',
  'cr.pending': 'laukia: {n}', 'cr.hintUseNew': 'Naudoti naują versiją: pakeistos išsaugotos eilutės paliekamos auditui.', 'cr.hintKeepBoth': 'Palikti abi: skaičiuojamos abi versijos, todėl sumos gali dubliuotis.',

  'au.title': 'Audito žurnalas', 'au.time': 'Kada', 'au.action': 'Veiksmas', 'au.detail': 'Detalės', 'au.import': 'Importas', 'au.delete_import': 'Importas ištrintas', 'au.resolve_conflict': 'Konfliktas išspręstas', 'au.empty': 'Įvykių dar nėra.',
  'hist.held': 'Sulaikyta',

  'rolling.title': 'Slenkančių 30 dienų perspėjimai', 'rolling.toggle': 'Rodyti slenkančio lango perspėjimus', 'rolling.badge': 'Slenkančios 30 d.',
  'rolling.note': 'Šie perspėjimai visada lygina paskutines 30 dienų su prieš tai buvusiomis 30 dienų, nepriklausomai nuo viršuje pasirinkto laikotarpio. Skaičiai čia gali sąmoningai skirtis.',
  'dash.computing': 'Skaičiuojama…', 'err.worker': 'Foninis procesas netikėtai sustojo. Bandykite dar kartą.', 'err.workerTimeout': 'Foninis procesas neatsakė laiku ir buvo sustabdytas.',
};
export default d;
