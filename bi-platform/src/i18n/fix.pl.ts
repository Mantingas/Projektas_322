import type fix from './fix.en';
const pl: Record<keyof typeof fix, string> = {
  'issue.credit_sign_ambiguous': 'Wiersz noty kredytowej z kwotą dodatnią NIE zaimportowany (pozostałe noty są ujemne)',
  'issue.quantity_sign_normalised': 'Ilość w wierszu z kwotą ujemną zmieniona na ujemną (zwroty zmniejszają ilość)',
  'issue.quantity_sign_ambiguous': 'Ilość zignorowana: jej znak nie zgadza się ze znakiem kwoty',
  'issue.cost_suspect': 'Koszt nieużyty: ujemny, znacznie wyższy od ceny albo o nieznanym znaku przy zwrocie',
  'issue.cost_zero': 'Zerowy koszt sprzedaży (zachowany; jeśli oznacza „nieznany”, marża będzie zawyżona)',
  'itrust.credit_ambiguous': '{n} wierszy jest oznaczonych jako noty kredytowe, ale mają kwotę DODATNIĄ, podczas gdy inne noty są ujemne. Plik miesza dwie konwencje znaków, więc te wiersze nie zostały zaimportowane (inaczej liczyłyby się jako sprzedaż). Popraw znaki w pliku i zaimportuj ponownie.',
  'sales.margin_overview.body_partial': 'Zysk brutto to {profit} ze sprzedaży z kosztem, po odjęciu zwrotów ze znanym kosztem. Ta sprzedaż to tylko {coverage} całego przychodu, więc to nie jest marża całego obrotu.',
  'mu.cost_revenue_coverage': 'Koszt znany dla mniej niż 80% PRZYCHODU ze sprzedaży (nawet jeśli jest w wielu pozycjach)', 'mu.returns_cost_unknown': 'Zwroty / korekty są istotne, a ich koszt jest nieznany lub o nieznanym znaku', 'mu.mixed_units': 'Ilości w różnych jednostkach, których nie można dodać (np. kg i szt.)', 'mu.units_missing': 'Część ilości nie ma jednostki, a inne mają',
  'lim.units_unstated': 'Plik nie podaje jednostek miary, więc ilości są sumowane tak, jak są, przy założeniu tej samej jednostki.',
  'lim.margin_partial': 'Marża obejmuje tylko {pct} przychodu ze sprzedaży (pozycje z odpowiednim kosztem). To nie jest marża całego obrotu.',
  'mp.sharedNumber': 'Dokumenty o numerze z innego roku', 'mp.sharedNumberNote': 'Te numery dokumentów są już zapisane dla innego roku (numeracja często zaczyna się od nowa co roku). Są traktowane jako osobne dokumenty i nie zastępują starszych. Jeśli to poprawione wersje tych samych faktur, w pliku muszą być oryginalne daty.',
  'pw.previous_unverified': 'Twoje dane zaczynają się {dataFrom}, ale poprzedni okres zaczyna się wcześniej. NIE WIADOMO, czy eksport go obejmuje (pierwsza transakcja nie musi być początkiem eksportu), więc zmiany nie są pokazywane. Podaj okres eksportu przy imporcie lub wybierz krótszy okres.',
  'pw.previous_declared_incomplete': 'Podałeś, że eksport zaczyna się {declaredFrom}, po początku poprzedniego okresu: jest pokryty tylko częściowo, więc zmiany nie są pokazywane.',
  'lim.previous_unknown': 'Poprzedni okres porównawczy zaczyna się {from}, a Twoja pierwsza transakcja to {dataFrom}. NIE WIADOMO, czy eksport obejmuje wcześniejszą część (może po prostu nie było transakcji). Zmiany i wnioski oparte na porównaniu nie są pokazywane. Jeśli eksport naprawdę zaczyna się wcześniej, podaj jego okres przy imporcie; w przeciwnym razie wybierz krótszy okres.',
  'lim.previous_incomplete': 'Podałeś, że eksport zaczyna się {declaredFrom}, a poprzedni okres porównawczy zaczyna się {from}: jest pokryty tylko częściowo. Zmiany i wnioski oparte na porównaniu nie są pokazywane. Wczytaj wcześniejszy eksport lub wybierz krótszy okres.',
  'import.cover.title': 'Okres eksportu (opcjonalnie)', 'import.cover.from': 'Od', 'import.cover.to': 'Do',
  'import.cover.help': 'Jeśli wiesz, jaki okres obejmuje raport, podaj go. Wtedy spokojny początek lub koniec (bez transakcji) odróżnimy od brakujących danych, a porównaniom z wcześniejszym okresem można ufać. Zostaw puste, jeśli nie wiesz: znana jest wtedy tylko pierwsza i ostatnia transakcja.',
};
export default pl;
