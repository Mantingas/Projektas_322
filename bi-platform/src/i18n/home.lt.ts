import type home from './home.en';
const lt: Record<keyof typeof home, string> = {
  'home.hero.title': 'Atraskite, ką verta patikrinti savo verslo skaičiuose.',
  'home.hero.sub': 'Programa analizuoja jūsų Excel ataskaitas ir ieško galimų nuostolių, neįprastų pokyčių bei nepastebėtų neatitikimų pardavimuose, pirkimuose, skolose ir atsargose. Kiekvienas radinys pateikiamas su paaiškinimu ir jį pagrindžiančiais įrašais.',
  'home.hero.demo': 'Pamatyti demonstraciją', 'home.hero.own': 'Išbandyti su savo failu',
  'home.hero.note': 'Be registracijos. Demonstracijai savo duomenų nereikia – naudojami sintetiniai pavyzdiniai failai.',
  'home.hero.local': 'Jūsų failai analizuojami jūsų naršyklėje.',

  'home.ex.label': 'Radinio pavyzdys · sintetiniai duomenys',
  'home.ex.kind': 'Reikia patikrinti',
  'home.ex.amount': 'tikrintina suma',
  'home.ex.why': 'Kodėl tai pažymėta?',
  'home.ex.records': 'Susiję įrašai: {n}',
  'home.ex.caveat': 'Radinys pagrįstas įkeltų duomenų įrašais. Ar tai tikras finansinis neatitikimas, reikia patikrinti.',
  'home.ex.open': 'Atidaryti demonstraciją ir peržiūrėti įrodymus',
  'home.ex.show': 'Rodyti įrodymus',

  'home.what.title': 'Ko programa ieško',
  'home.m.purchasing': 'Pirkimo kainų pokyčiai', 'home.m.purchasing.d': 'Pastebėkite pirkimo kainų kilimą ir ankstesnius kainų skirtumus tarp tiekėjų.',
  'home.m.debts': 'Skolos, kreditinės ir mokėjimai', 'home.m.debts.d': 'Pradelstos sąskaitos, galimai nepanaudotos kreditinės ir galimi pasikartojantys mokėjimai.',
  'home.m.sales': 'Pardavimai ir maržos', 'home.m.sales.d': 'Mažėjantys klientai ir prekės, o nurodžius savikainą – mažos maržos produktai.',
  'home.m.inventory': 'Atsargos', 'home.m.inventory.d': 'Nejudančios prekės, atsargų perteklius ir prekės, kurių gali pritrūkti.',
  'home.m.universal': 'Bet kokia kita lentelė', 'home.m.universal.d': 'Tendencijos, nukrypimai, dublikatai ir duomenų kokybė bet kurioje Excel ar CSV lentelėje.',

  'home.how.title': 'Kaip tai veikia',
  'home.how.1': 'Atidarykite demonstraciją arba įkelkite Excel / CSV failą', 'home.how.2': 'Prireikus patvirtinkite stulpelių reikšmes', 'home.how.3': 'Programa analizuoja duomenis', 'home.how.4': 'Peržiūrėkite radinius ir jų įrodymus',

  'home.priv.title': 'Privatumas',
  'home.priv.f1': 'Failai analizuojami jūsų naršyklėje.', 'home.priv.f2': 'Programa failų turinio nesiunčia į serverį.', 'home.priv.f3': 'Duomenis bet kada galite pašalinti iš šios naršyklės saugyklos.',
  'home.priv.more': 'Techninės detalės',
  'home.priv.d1': 'Analizė vyksta jūsų naršyklės Web Worker. Importuoti duomenys saugomi tik šioje naršyklėje (IndexedDB).',
  'home.priv.d2': 'Jokio išorinio DI, analitikos ar klaidų sekimo. Svetainės saugumo politika leidžia ryšį tik su pačia svetaine.',
  'home.priv.d3': 'Puslapis pateikiamas kaip statiniai failai. Įprasti talpinimo žurnalai gali užfiksuoti, kad puslapis atidarytas, bet ne jūsų failų turinį.',

  'home.stage.title': 'Kurioje stadijoje produktas',
  'home.stage.body': 'Programa išbandyta su sintetiniais duomenimis. Tikrų įmonių duomenų pilotai dar neatlikti.',

  'home.pilot.title': 'Ieškome pirmųjų įmonių nemokamam pilotui.',
  'home.pilot.title.plan': 'Ruošiame nemokamą pilotą.',
  'home.pilot.what': 'Įmonės galėtų išbandyti savo eksportus – pavyzdžiui, neapmokėtų sąskaitų ataskaitą, pirkimų ar pardavimų eilutes, likučius. Failai lieka jų kompiuteryje.',
  'home.pilot.how': 'Apskaitą išmanantis žmogus peržiūrėtų kiekvieną radinį ir pažymėtų: patvirtintas, atmestas ar neaišku. Taip suskaičiuotume, kiek radinių pasitvirtino.',
  'home.pilot.contact.lead': 'Norite dalyvauti? Parašykite:', 'home.pilot.contact.safe': 'Pirmame laiške prašome nesiųsti finansinių failų – pirmiausia aptarsime, kaip duomenys lieka pas jus.',

  'demo.banner': 'Demonstracija · sintetiniai duomenys – jūsų duomenys čia nenaudojami.',
  'demo.loading': 'Įkeliami sintetiniai pavyzdiniai failai… {done}/{total}',
  'demo.failed': 'Demonstracijos failų nepavyko įkelti pilnai. Atnaujinkite puslapį arba paleiskite demonstraciją iš naujo.',
  'demo.restart': 'Pradėti demonstraciją iš naujo', 'demo.exit': 'Grįžti į savo darbo vietą',
  'demo.note': 'Pavyzdiniai failai su lietuviškomis antraštėmis ir išgalvotais įmonių pavadinimais. Tai ne tikros įmonės ir ne ERP eksportai.',
};
export default lt;
