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
  'home.ex.what': 'Kreditinė sąskaita, kuri galimai dar nepanaudota. Likutis – {amount}.',
  'home.ex.why': 'Kodėl tai pažymėta?',
  'home.ex.records': 'Susiję įrašai: {n}',
  'home.ex.status': 'Būsena apibūdina tik įkeltų failų įrašus: jie pagrindžia skaičiavimą. Tai nepatvirtina tikro nuostolio, tikros skolos ar kieno nors apskaitos klaidos.',
  'home.ex.note': 'Demonstracinis pavyzdys iš sintetinių duomenų, sukurtas ta pačia analize, kuri veikia su jūsų failais. Tai užuomina patikrinimui, o ne patvirtintas nuostolis.',
  'home.ex.open': 'Atidaryti demonstraciją ir peržiūrėti įrodymus',
  'home.ex.show': 'Rodyti įrodymus',

  'home.what.title': 'Ko programa ieško',
  'home.what.sub': 'Penkios sritys. Kiekvienas rezultatas – tai raginimas kažką patikrinti, o ne išvada apie jūsų apskaitą.',
  'home.m.purchasing': 'Pirkimo kainų pokyčiai', 'home.m.purchasing.d': 'Kur pakilo pirkimo kainos ir ar tą pačią prekę kitas tiekėjas pardavė pigiau.',
  'home.m.debts': 'Skolos, kreditinės ir mokėjimai', 'home.m.debts.d': 'Pradelstos sąskaitos, galimai nepanaudotos kreditinės, galimi pasikartojantys mokėjimai ir mokėjimai, kurių neatitinka sąskaita.',
  'home.m.sales': 'Pardavimai ir maržos', 'home.m.sales.d': 'Mažėjantys klientai ir prekės, o nurodžius savikainą – mažos maržos produktai.',
  'home.m.inventory': 'Nejudančios atsargos ir trūkumo rizika', 'home.m.inventory.d': 'Nejudančios prekės, atsargų perteklius ir prekės, kurių gali pritrūkti.',
  'home.m.universal': 'Bet kokia kita lentelė', 'home.m.universal.d': 'Tendencijos, nukrypimai, dublikatai ir duomenų kokybė bet kurioje Excel ar CSV lentelėje.',

  'home.how.title': 'Kaip tai veikia',
  'home.how.1': 'Atidarykite demonstraciją arba įkelkite savo Excel / CSV failą', 'home.how.2': 'Patvirtinkite, ką reiškia kiekvienas stulpelis', 'home.how.3': 'Programa patikrina duomenų kokybę ir paskaičiuoja rodiklius', 'home.how.4': 'Perskaitykite radinius su įrodymais ir eksportuokite ataskaitą',

  'home.priv.title': 'Privatumas: kaip tvarkomi jūsų duomenys',
  'home.priv.1': 'Failai skaitomi ir analizuojami jūsų naršyklėje (Web Worker). Programa jų turinio nesiunčia į serverį.',
  'home.priv.2': 'Importuoti duomenys saugomi tik šioje naršyklėje (IndexedDB) ir ištrinami vienu paspaudimu.',
  'home.priv.3': 'Jokio išorinio DI, jokios analitikos ar klaidų sekimo. Svetainės saugumo politika leidžia ryšį tik su pačia svetaine.',
  'home.priv.4': 'Puslapis pateikiamas kaip statiniai failai. Įprasti talpinimo žurnalai gali užfiksuoti, kad puslapis atidarytas, bet ne jūsų failų turinį.',

  'home.stage.title': 'Kurioje stadijoje produktas',
  'home.stage.body': 'Programa išbandyta su sintetiniais duomenimis. Pilotų su tikrų įmonių duomenimis dar nebuvo, todėl rezultatai nėra patvirtinti sutaupymai ir dėl jų nieko nežadame.',

  'home.pilot.title': 'Ieškome pirmųjų įmonių nemokamam pilotui.',
  'home.pilot.what.t': 'Ką galėtumėte išbandyti', 'home.pilot.what.d': 'Savo eksportus – pavyzdžiui, neapmokėtų sąskaitų ataskaitą, pirkimų, pardavimų eilutes ar likučius. Failai lieka jūsų kompiuteryje.',
  'home.pilot.how.t': 'Kaip tikrinami radiniai', 'home.pilot.how.d': 'Jūsų apskaitą išmanantis žmogus peržiūri kiekvieną radinį ir pažymi: patvirtintas, atmestas ar neaišku. Skaičiuojame, kiek radinių pasitvirtino.',
  'home.pilot.fb.t': 'Kokio grįžtamojo ryšio prašytume', 'home.pilot.fb.d': 'Ką radinys parodė, ko trūko ir kas buvo klaidinga. Pilotui nieko neparduodame, o kainų kol kas nėra.',
  'home.pilot.title.plan': 'Planuojame nemokamą pilotą su pirmosiomis įmonėmis.',
  'home.pilot.contact.lead': 'Norite dalyvauti? Parašykite:', 'home.pilot.contact.safe': 'Pirmame laiške prašome nesiųsti finansinių failų – pirmiausia aptarsime, kaip duomenys lieka pas jus.',

  'demo.banner': 'Demonstracija · sintetiniai duomenys – jūsų duomenys čia nenaudojami.',
  'demo.loading': 'Įkeliami sintetiniai pavyzdiniai failai… {done}/{total}',
  'demo.failed': 'Demonstracijos failų nepavyko įkelti pilnai. Atnaujinkite puslapį arba paleiskite demonstraciją iš naujo.',
  'demo.restart': 'Pradėti demonstraciją iš naujo', 'demo.exit': 'Grįžti į savo darbo vietą',
  'demo.note': 'Pavyzdiniai failai su lietuviškomis antraštėmis ir išgalvotais įmonių pavadinimais. Tai ne tikros įmonės ir ne ERP eksportai.',
};
export default lt;
