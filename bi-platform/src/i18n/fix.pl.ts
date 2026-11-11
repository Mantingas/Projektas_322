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
  'lim.previous_incomplete': 'Poprzedni okres porównawczy zaczyna się {from}, a Twoje dane zaczynają się {dataFrom}: brakuje {missing} dni w pliku. Zmiany i wnioski oparte na porównaniu nie są pokazywane, bo porównywałyby pełny okres z częściowym. Wczytaj wcześniejszy eksport lub wybierz krótszy okres.',
  'mp.sharedNumber': 'Dokumenty o numerze z innego roku', 'mp.sharedNumberNote': 'Te numery dokumentów są już zapisane dla innego roku (numeracja często zaczyna się od nowa co roku). Są traktowane jako osobne dokumenty i nie zastępują starszych. Jeśli to poprawione wersje tych samych faktur, w pliku muszą być oryginalne daty.',
};
export default pl;
