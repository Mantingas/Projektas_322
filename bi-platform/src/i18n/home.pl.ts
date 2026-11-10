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
  'home.ex.what': 'Nota kredytowa, która może być jeszcze niewykorzystana. Saldo wynosi {amount}.',
  'home.ex.why': 'Dlaczego to oznaczono?',
  'home.ex.records': 'Powiązane zapisy: {n}',
  'home.ex.status': 'Status opisuje wyłącznie zapisy w wczytanych plikach: uzasadniają one obliczenie. Nie potwierdza rzeczywistej straty, rzeczywistego długu ani błędu w czyichkolwiek księgach.',
  'home.ex.note': 'Przykład demonstracyjny z danych syntetycznych, wygenerowany tą samą analizą, która działa na Twoich plikach. To wskazówka do weryfikacji, a nie potwierdzona strata.',
  'home.ex.open': 'Otwórz demonstrację i zobacz dowody',
  'home.ex.show': 'Pokaż dowody',

  'home.what.title': 'Czego szuka program',
  'home.what.sub': 'Pięć obszarów. Każdy wynik to sygnał do sprawdzenia, a nie wniosek o Twojej księgowości.',
  'home.m.purchasing': 'Zmiany cen zakupu', 'home.m.purchasing.d': 'Gdzie wzrosły ceny zakupu i czy inny dostawca sprzedawał ten sam towar taniej.',
  'home.m.debts': 'Należności, noty kredytowe i płatności', 'home.m.debts.d': 'Przeterminowane faktury, noty kredytowe, które mogą być niewykorzystane, możliwe zdublowane płatności i płatności niepasujące do faktury.',
  'home.m.sales': 'Sprzedaż i marże', 'home.m.sales.d': 'Spadający klienci i produkty, a po podaniu kosztu – produkty o niskiej marży.',
  'home.m.inventory': 'Zalegające zapasy i ryzyko braków', 'home.m.inventory.d': 'Towary bez ruchu, nadmiar zapasów i towary, których może zabraknąć.',
  'home.m.universal': 'Dowolna inna tabela', 'home.m.universal.d': 'Trendy, odchylenia, duplikaty i jakość danych w dowolnej tabeli Excel lub CSV.',

  'home.how.title': 'Jak to działa',
  'home.how.1': 'Otwórz demonstrację lub wczytaj własny plik Excel / CSV', 'home.how.2': 'Potwierdź, co oznacza każda kolumna', 'home.how.3': 'Program sprawdza jakość danych i oblicza wskaźniki', 'home.how.4': 'Przeczytaj wyniki z dowodami i wyeksportuj raport',

  'home.priv.title': 'Prywatność: jak przetwarzamy Twoje dane',
  'home.priv.1': 'Pliki są odczytywane i analizowane w Twojej przeglądarce (Web Worker). Program nie wysyła ich zawartości na serwer.',
  'home.priv.2': 'Zaimportowane dane są przechowywane tylko w tej przeglądarce (IndexedDB) i można je usunąć jednym kliknięciem.',
  'home.priv.3': 'Brak zewnętrznej AI, analityki i śledzenia błędów. Polityka bezpieczeństwa strony dopuszcza połączenia tylko z samą stroną.',
  'home.priv.4': 'Strona jest dostarczana jako pliki statyczne. Zwykłe logi hostingu mogą zapisać, że strona została otwarta, ale nie zawartość Twoich plików.',

  'home.stage.title': 'Na jakim etapie jest produkt',
  'home.stage.body': 'Program był testowany na danych syntetycznych. Pilotaże na danych prawdziwych firm jeszcze się nie odbyły, więc wyniki nie są potwierdzonymi oszczędnościami i niczego w tej sprawie nie obiecujemy.',

  'home.pilot.title': 'Szukamy pierwszych firm do bezpłatnego pilotażu.',
  'home.pilot.what.t': 'Co możesz wypróbować', 'home.pilot.what.d': 'Własne eksporty – na przykład raport niezapłaconych faktur, pozycje zakupów i sprzedaży albo stany magazynowe. Pliki zostają na Twoim komputerze.',
  'home.pilot.how.t': 'Jak sprawdzamy wyniki', 'home.pilot.how.d': 'Osoba znająca Twoją księgowość przegląda każdy wynik i oznacza go: potwierdzony, odrzucony lub niejasny. Liczymy, ile wyników się potwierdziło.',
  'home.pilot.fb.t': 'O jaką opinię prosimy', 'home.pilot.fb.d': 'Co pokazał wynik, czego brakowało i co było błędne. W pilotażu niczego nie sprzedajemy, a cen jeszcze nie ma.',
  'home.pilot.title.plan': 'Planujemy bezpłatny pilotaż z pierwszymi firmami.',
  'home.pilot.contact.lead': 'Chcesz wziąć udział? Napisz:', 'home.pilot.contact.safe': 'W pierwszej wiadomości prosimy nie wysyłać plików finansowych – najpierw ustalimy, jak Twoje dane pozostają u Ciebie.',

  'demo.banner': 'Demonstracja · dane syntetyczne – Twoje dane nie są tu używane.',
  'demo.loading': 'Wczytywanie syntetycznych plików przykładowych… {done}/{total}',
  'demo.failed': 'Nie udało się w pełni wczytać plików demonstracyjnych. Odśwież stronę lub uruchom demonstrację ponownie.',
  'demo.restart': 'Uruchom demonstrację od nowa', 'demo.exit': 'Wróć do własnego obszaru roboczego',
  'demo.note': 'Pliki przykładowe mają litewskie nagłówki i zmyślone nazwy firm. To nie są prawdziwe firmy ani eksporty ERP.',
};
export default pl;
