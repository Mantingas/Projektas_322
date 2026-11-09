import type d2 from './dash2.en';
const d: Record<keyof typeof d2, string> = {
  'diag.title': 'Diagnostyka importu', 'diag.structure': 'Wykryta struktura pliku', 'diag.kind': 'Typ pliku', 'diag.encoding': 'Kodowanie', 'diag.delimiter': 'Separator', 'diag.sheet': 'Arkusz',
  'diag.size': '{rows} wierszy × {cols} kolumn', 'diag.headerRow': 'Nagłówek w wierszu {row} (pewność {pct})', 'diag.truncated': 'Obcięto: arkusz jest większy niż obsługiwany rozmiar',
  'diag.columns': 'Kolumny i proponowane znaczenia', 'diag.unrecognized': 'Nierozpoznane kolumny (pomijane, dopóki ich nie przypiszesz)', 'diag.noneUnrecognized': 'Każda kolumna z danymi ma znaczenie.',
  'diag.validation': 'Problemy walidacji', 'diag.noIssues': 'Nie znaleziono problemów.', 'diag.examples': 'np. wiersze {rows}', 'diag.rows': 'Wiersze: odczytano {read}, zaimportowano {imported}, pominięto {skipped}',
  'diag.metrics': 'Co można obliczyć z tego pliku', 'diag.available': 'dostępne', 'diag.unavailable': 'niedostępne',
  'diag.aspNote': 'Średnia cena sprzedaży jest pokazywana, gdy w panelu wybrano dokładnie jeden towar.',
  'diag.download': 'Pobierz diagnostykę (bez wartości komórek)', 'diag.privacy': 'Plik diagnostyczny zawiera tylko strukturę i liczby – bez wartości komórek, klientów ani towarów. Nazwy nagłówków są dołączone.',
  'diag.source.saved': 'zapisane mapowanie', 'diag.source.template': 'znany układ', 'diag.source.heuristic': 'sugestia', 'diag.source.user': 'Twój wybór',
  'diag.confidence': 'pewność', 'diag.working': 'Analizowanie…',

  'mode.partial': 'Dokumenty częściowe (tylko część pozycji)',
  'mode.help.full': 'Plik zawiera każdy dokument okresu ze wszystkimi pozycjami. Tylko ten tryb może zastąpić zapisane pozycje – i tylko po Twoim potwierdzeniu.',
  'mode.help.incremental': 'Tylko transakcje nowe lub zmienione od ostatniego eksportu. Zapisane pozycje nigdy nie są zastępowane.',
  'mode.help.partial': 'Dokumenty mogą zawierać tylko część pozycji. Do zapisanych dokumentów można dodawać pozycje; zapisane pozycje nigdy nie są usuwane.',
  'mode.help.unknown': 'Nie masz pewności. Wszystko, co mogłoby zmienić zapisane dane, jest wstrzymywane do Twojej weryfikacji.',

  'mp.newDocs': 'Nowe dokumenty', 'mp.additions': 'Zapisane dokumenty zyskujące pozycje', 'mp.held': 'Pozycje wstrzymane do weryfikacji', 'mp.heldDocs': 'Dokumenty wstrzymane do weryfikacji',
  'mp.removed': 'Dokumenty, które straciłyby pozycje', 'mp.omitted': 'Dokumenty z zapisanymi pozycjami, których brak w pliku (zachowane)', 'mp.absent': 'Zapisane dokumenty z tego okresu, których nie ma w pliku (zachowane)',
  'mp.skipped': 'Pominięte pozycje (tylko nowe daty)', 'mp.safe': 'Ten import niczego nie zastępuje ani nie usuwa z zapisanych danych.',
  'mp.heldNote': 'Wstrzymane pozycje są zapisane, ale nie wchodzą do żadnych liczb, dopóki ich nie rozstrzygniesz w Historia → Przegląd konfliktów.',

  'pol.conflicts': 'Jeśli zapisany dokument różni się od pliku', 'pol.hold': 'Wstrzymaj nowe pozycje do weryfikacji (zalecane)', 'pol.replace': 'Zastąp zapisane pozycje wersją z tego pliku',
  'pol.add_alongside': 'Zachowaj obie wersje (możliwe podwójne liczenie)', 'pol.content': 'Pozycje bez numeru dokumentu nakładające się na zapisane daty', 'pol.hold_overlap': 'Wstrzymaj nakładające się pozycje do weryfikacji (zalecane)',
  'pol.only_new_dates': 'Importuj tylko pozycje z datą późniejszą niż ostatnia zapisana', 'pol.dedupe_exact': 'Pomiń dokładne duplikaty, resztę dodaj (skorygowana pozycja może zostać policzona dwa razy)', 'pol.proposed': 'proponowane',
  'cf.title': 'Potwierdź przed importem', 'cf.replacements': 'Zapisane pozycje {n} dokumentów zostaną zastąpione. Zostają w audycie i wracają po usunięciu tego importu.',
  'cf.removals': '{n} dokumentów straci pozycje, których brak w tym pliku. Zostają w audycie i wracają po usunięciu tego importu.',
  'cf.add_alongside': 'Pozycje zostaną dodane obok zapisanych i mogą być policzone dwa razy.',
  'cf.content_overlap': 'Nakładające się pozycje zostaną dodane, ale bez numerów dokumentów nie rozpoznamy korekty: sumy mogą być podwójne.',
  'cf.checkbox': 'Rozumiem i potwierdzam', 'cf.needed': 'Wymagane potwierdzenie',

  'import.result.held': 'Pozycje wstrzymane do weryfikacji', 'import.result.reviewNow': 'Przejrzyj konflikty', 'import.result.removed': 'Dokumenty z usuniętymi pozycjami',
  'lim.held_pending': '{lines} zaimportowanych pozycji czeka na Twoją weryfikację i NIE jest uwzględnione w żadnych liczbach. Rozstrzygnij w Historia → Przegląd konfliktów.',

  'cr.title': 'Przegląd konfliktów importu', 'cr.empty': 'Nic nie czeka na Twoją decyzję.',
  'cr.intro': 'Te pozycje pochodzą z importu, ale nie zostały dodane do liczb, bo plik mógłby zmienić dane, które już masz. Zdecyduj dla każdego dokumentu. Nic nie jest usuwane: zastąpione i odrzucone pozycje zostają w historii audytu, a usunięcie importu wszystko cofa.',
  'cr.stored': 'Zapisane pozycje', 'cr.held': 'Pozycje z {file}', 'cr.useNew': 'Użyj nowej wersji', 'cr.keepStored': 'Zostaw zapisane', 'cr.keepBoth': 'Zachowaj obie', 'cr.add': 'Dodaj te pozycje', 'cr.discard': 'Odrzuć te pozycje',
  'cr.noDoc': 'Pozycje bez numeru dokumentu', 'cr.bulk': 'Zastosuj do wszystkich konfliktów', 'cr.doc': 'Dokument', 'cr.amount': 'Kwota', 'cr.product': 'Towar', 'cr.date': 'Data', 'cr.sum': 'Razem',
  'cr.pending': 'oczekuje: {n}', 'cr.hintUseNew': 'Użyj nowej wersji: zastąpione zapisane pozycje zostają w audycie.', 'cr.hintKeepBoth': 'Zachowaj obie: liczone są obie wersje, więc sumy mogą być podwójne.',

  'au.title': 'Dziennik audytu', 'au.time': 'Kiedy', 'au.action': 'Akcja', 'au.detail': 'Szczegóły', 'au.import': 'Import', 'au.delete_import': 'Import usunięty', 'au.resolve_conflict': 'Konflikt rozstrzygnięty', 'au.empty': 'Brak zdarzeń.',
  'hist.held': 'Wstrzymane',

  'rolling.title': 'Alerty z okna kroczącego 30 dni', 'rolling.toggle': 'Pokaż alerty z okna kroczącego', 'rolling.badge': 'Kroczące 30 dni',
  'rolling.note': 'Te alerty zawsze porównują ostatnie 30 dni z poprzednimi 30 dniami, niezależnie od wybranego wyżej okresu. Liczby tutaj mogą celowo się różnić.',
  'dash.computing': 'Obliczanie…', 'err.worker': 'Proces w tle nieoczekiwanie się zatrzymał. Spróbuj ponownie.', 'err.workerTimeout': 'Proces w tle nie odpowiedział na czas i został zatrzymany.',
};
export default d;
