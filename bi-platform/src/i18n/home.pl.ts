import type home from './home.en';
const pl: Record<keyof typeof home, string> = {
  'home.hero.title': 'Sprawdź, co warto zweryfikować w liczbach swojej firmy.',
  'home.hero.sub': 'Program analizuje Twoje raporty Excel i szuka możliwych strat, nietypowych zmian oraz niezauważonych rozbieżności w sprzedaży, zakupach, rozrachunkach i zapasach. Każdy wynik ma wyjaśnienie i zapisy, które go uzasadniają.',
  'home.hero.demo': 'Zobacz demonstrację', 'home.hero.own': 'Wypróbuj na własnym pliku',
  'home.hero.note': 'Bez rejestracji. Demonstracja nie wymaga Twoich danych – używa syntetycznych plików przykładowych.',
  'home.hero.local': 'Twoje pliki są analizowane w Twojej przeglądarce.',

  'home.ex.label': 'Przykładowy wynik · dane syntetyczne',
  'home.ex.kind': 'Do sprawdzenia',
  'home.ex.amount': 'kwota do sprawdzenia',
  'home.ex.why': 'Dlaczego to oznaczono?',
  'home.ex.records': 'Powiązane zapisy: {n}',
  'home.ex.caveat': 'Wynik opiera się na zapisach w wczytanych danych. Czy to rzeczywista rozbieżność finansowa, trzeba sprawdzić.',
  'home.ex.open': 'Otwórz demonstrację i zobacz dowody',
  'home.ex.show': 'Pokaż dowody',

  'home.what.title': 'Czego szuka program',
  'home.m.purchasing': 'Zmiany cen zakupu', 'home.m.purchasing.d': 'Zauważ wzrost cen zakupu oraz wcześniejsze różnice cen między dostawcami.',
  'home.m.debts': 'Należności, noty kredytowe i płatności', 'home.m.debts.d': 'Przeterminowane faktury, noty kredytowe, które mogą być niewykorzystane, i możliwe zdublowane płatności.',
  'home.m.sales': 'Sprzedaż i marże', 'home.m.sales.d': 'Spadający klienci i produkty, a po podaniu kosztu – produkty o niskiej marży.',
  'home.m.inventory': 'Zapasy', 'home.m.inventory.d': 'Towary bez ruchu, nadmiar zapasów i towary, których może zabraknąć.',
  'home.m.universal': 'Dowolna inna tabela', 'home.m.universal.d': 'Trendy, odchylenia, duplikaty i jakość danych w dowolnej tabeli Excel lub CSV.',

  'home.how.title': 'Jak to działa',
  'home.how.1': 'Otwórz demonstrację lub wczytaj plik Excel / CSV', 'home.how.2': 'W razie potrzeby potwierdź znaczenie kolumn', 'home.how.3': 'Program analizuje dane', 'home.how.4': 'Przejrzyj wyniki i ich dowody',

  'home.priv.title': 'Prywatność',
  'home.priv.f1': 'Pliki są analizowane w Twojej przeglądarce.', 'home.priv.f2': 'Program nie wysyła zawartości plików na serwer.', 'home.priv.f3': 'Dane możesz w każdej chwili usunąć z pamięci tej przeglądarki.',
  'home.priv.more': 'Szczegóły techniczne',
  'home.priv.d1': 'Analiza działa w Web Worker w Twojej przeglądarce. Zaimportowane dane są przechowywane tylko w tej przeglądarce (IndexedDB).',
  'home.priv.d2': 'Brak zewnętrznej AI, analityki i śledzenia błędów. Polityka bezpieczeństwa strony dopuszcza połączenia tylko z samą stroną.',
  'home.priv.d3': 'Strona jest dostarczana jako pliki statyczne. Zwykłe logi hostingu mogą zapisać, że strona została otwarta, ale nie zawartość Twoich plików.',

  'home.stage.title': 'Na jakim etapie jest produkt',
  'home.stage.body': 'Program był testowany na danych syntetycznych. Pilotaże na danych prawdziwych firm nie zostały jeszcze przeprowadzone.',

  'home.pilot.title': 'Szukamy pierwszych firm do bezpłatnego pilotażu.',
  'home.pilot.title.plan': 'Przygotowujemy bezpłatny pilotaż.',
  'home.pilot.what': 'Firmy mogłyby wypróbować własne eksporty – na przykład raport niezapłaconych faktur, pozycje zakupów lub sprzedaży albo stany magazynowe. Pliki zostają na ich komputerze.',
  'home.pilot.how': 'Osoba znająca księgowość przeglądałaby każdy wynik i oznaczała go: potwierdzony, odrzucony lub niejasny. Dzięki temu policzylibyśmy, ile wyników się potwierdziło.',
  'home.pilot.contact.lead': 'Chcesz wziąć udział? Napisz:', 'home.pilot.contact.safe': 'W pierwszej wiadomości prosimy nie wysyłać plików finansowych – najpierw ustalimy, jak Twoje dane pozostają u Ciebie.',

  'demo.banner': 'Demonstracja · dane syntetyczne – Twoje dane nie są tu używane.',
  'demo.loading': 'Wczytywanie syntetycznych plików przykładowych… {done}/{total}',
  'demo.failed': 'Nie udało się w pełni wczytać plików demonstracyjnych. Odśwież stronę lub uruchom demonstrację ponownie.',
  'demo.restart': 'Uruchom demonstrację od nowa', 'demo.exit': 'Wróć do własnego obszaru roboczego',
  'demo.note': 'Pliki przykładowe mają litewskie nagłówki i zmyślone nazwy firm. To nie są prawdziwe firmy ani eksporty ERP.',
};
export default pl;
