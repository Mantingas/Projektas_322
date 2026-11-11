import type fix from './fix.en';
const pl: Record<keyof typeof fix, string> = {
  'issue.credit_sign_ambiguous': 'Wiersz noty kredytowej z kwotą dodatnią NIE zaimportowany (pozostałe noty są ujemne)',
  'issue.quantity_sign_normalised': 'Ilość w wierszu z kwotą ujemną zmieniona na ujemną (zwroty zmniejszają ilość)',
  'issue.quantity_sign_ambiguous': 'Ilość zignorowana: jej znak nie zgadza się ze znakiem kwoty',
  'issue.cost_suspect': 'Koszt nieużyty: ujemny, znacznie wyższy od ceny albo o nieznanym znaku przy zwrocie',
  'issue.cost_zero': 'Zerowy koszt sprzedaży (zachowany; jeśli oznacza „nieznany”, marża będzie zawyżona)',
  'itrust.credit_ambiguous': '{n} wierszy jest oznaczonych jako noty kredytowe, ale mają kwotę DODATNIĄ, podczas gdy inne noty są ujemne. Plik miesza dwie konwencje znaków, więc te wiersze nie zostały zaimportowane (inaczej liczyłyby się jako sprzedaż). Popraw znaki w pliku i zaimportuj ponownie.',
};
export default pl;
