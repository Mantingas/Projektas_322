import type { SalesField } from '../types';

/**
 * LT / PL / EN header synonyms for the sales canonical model.
 * Entries are written in normalised form (lower-case, no diacritics, no punctuation).
 */
export const SALES_SYNONYMS: Record<SalesField, string[]> = {
  document_date: [
    'data', 'dok data', 'dokumento data', 'saskaitos data', 'pardavimo data', 'operacijos data', 'israsymo data', 'saskaitos israsymo data',
    'data sprzedazy', 'data wystawienia', 'data dokumentu', 'data faktury', 'data operacji', 'data transakcji',
    'date', 'document date', 'invoice date', 'sales date', 'posting date', 'transaction date', 'order date',
  ],
  document_id: [
    'dokumento nr', 'dokumento numeris', 'saskaitos nr', 'saskaitos numeris', 'dok nr', 'saskaita faktura', 'nr', 'numeris', 'dokumentas',
    'numer dokumentu', 'nr dokumentu', 'numer faktury', 'nr faktury', 'numer', 'dokument', 'faktura',
    'document no', 'document number', 'invoice no', 'invoice number', 'invoice', 'doc id', 'order number', 'order no', 'document id',
  ],
  customer_name: [
    'klientas', 'pirkejas', 'kliento pavadinimas', 'kontrahentas', 'partneris', 'pirkejo pavadinimas', 'klientas pavadinimas',
    'kontrahent', 'nabywca', 'klient', 'nazwa kontrahenta', 'odbiorca', 'nazwa klienta', 'nazwa nabywcy',
    'customer', 'customer name', 'client', 'buyer', 'client name', 'account name',
  ],
  customer_id: [
    'kliento kodas', 'pirkejo kodas', 'kliento id', 'kliento nr', 'imones kodas', 'partnerio kodas',
    'kod kontrahenta', 'kod klienta', 'id klienta', 'nip', 'symbol kontrahenta', 'numer klienta',
    'customer id', 'customer code', 'client id', 'customer no', 'client code',
  ],
  product_name: [
    'preke', 'prekes pavadinimas', 'produktas', 'pavadinimas', 'paslauga', 'prekes aprasymas', 'preke paslauga',
    'towar', 'nazwa towaru', 'produkt', 'nazwa', 'nazwa produktu', 'usluga', 'artykul', 'nazwa artykulu',
    'product', 'product name', 'item', 'item name', 'description', 'article',
  ],
  product_id: [
    'prekes kodas', 'kodas', 'artikulas', 'sku', 'prekes nr', 'artikulo kodas',
    'kod towaru', 'kod', 'symbol', 'indeks', 'symbol towaru', 'numer katalogowy', 'kod produktu',
    'product code', 'product id', 'item code', 'item no', 'part number', 'article number',
  ],
  quantity: ['kiekis', 'kiek', 'vnt', 'kiekis vnt', 'parduotas kiekis', 'ilosc', 'il', 'ilosc sprzedana', 'szt', 'quantity', 'qty', 'units', 'units sold'],
  unit_price: ['kaina', 'vieneto kaina', 'vnt kaina', 'cena', 'cena jednostkowa', 'cena sprzedazy', 'price', 'unit price', 'sales price'],
  net_amount: [
    'suma be pvm', 'verte be pvm', 'be pvm', 'grynoji suma', 'neto', 'suma neto', 'pardavimo suma be pvm', 'apyvarta be pvm', 'suma eur be pvm', 'pardavimai be pvm',
    'netto', 'wartosc netto', 'kwota netto', 'wartosc sprzedazy netto', 'suma netto', 'sprzedaz netto', 'obrot netto',
    'net amount', 'net', 'net sales', 'amount excl vat', 'amount excluding vat', 'net revenue', 'revenue net', 'total net', 'excl vat', 'sales net',
  ],
  gross_amount: [
    'suma su pvm', 'verte su pvm', 'su pvm', 'bruto', 'suma bruto', 'moketina suma', 'viso su pvm', 'pardavimai su pvm',
    'brutto', 'wartosc brutto', 'kwota brutto', 'suma brutto', 'razem brutto', 'sprzedaz brutto',
    'gross amount', 'gross', 'amount incl vat', 'incl vat', 'total gross', 'total with vat', 'amount including vat', 'sales gross',
  ],
  amount_unknown_basis: [
    'suma', 'verte', 'pardavimai', 'apyvarta', 'pardavimo suma', 'viso', 'suma eur',
    'kwota', 'wartosc', 'wartosc sprzedazy', 'sprzedaz', 'obrot', 'razem',
    'amount', 'total', 'value', 'sales', 'revenue', 'turnover', 'line total',
  ],
  vat_amount: ['pvm', 'pvm suma', 'pvm verte', 'vat', 'kwota vat', 'podatek vat', 'podatek', 'vat amount', 'tax', 'tax amount'],
  cost_amount: [
    'savikaina', 'savikainos suma', 'savikaina eur', 'pardavimo savikaina', 'savikaina viso',
    'koszt', 'koszt wlasny', 'wartosc kosztu', 'koszt sprzedazy', 'koszt wlasny sprzedazy', 'kwg',
    'cost', 'cogs', 'total cost', 'cost of sales', 'cost amount',
  ],
  unit_cost: ['vieneto savikaina', 'vnt savikaina', 'cena zakupu', 'koszt jednostkowy', 'cena nabycia', 'cena zakupu netto', 'unit cost', 'purchase price'],
  currency: ['valiuta', 'val', 'waluta', 'currency', 'ccy', 'cur'],
  product_category: [
    'prekiu grupe', 'grupe', 'kategorija', 'prekes grupe', 'prekiu kategorija', 'asortimento grupe',
    'grupa towarowa', 'kategoria', 'grupa', 'grupa produktow', 'kategoria towaru',
    'category', 'product group', 'product category', 'item group', 'group',
  ],
  salesperson: [
    'pardavejas', 'vadybininkas', 'atsakingas', 'pardavimu vadybininkas', 'vadyb',
    'handlowiec', 'sprzedawca', 'opiekun', 'przedstawiciel', 'opiekun handlowy',
    'salesperson', 'sales rep', 'seller', 'sales manager', 'account manager', 'rep', 'sales person',
  ],
};

export const NUMERIC_FIELDS: SalesField[] = [
  'quantity', 'unit_price', 'net_amount', 'gross_amount', 'amount_unknown_basis', 'vat_amount', 'cost_amount', 'unit_cost',
];
export const TEXT_FIELDS: SalesField[] = ['customer_name', 'product_name', 'salesperson', 'product_category'];
export const ID_FIELDS: SalesField[] = ['document_id', 'customer_id', 'product_id'];

/** Header tokens that decide VAT basis of an amount. */
export const NET_HINT_TOKENS = ['netto', 'neto', 'net', 'excl', 'excluding'];
export const GROSS_HINT_TOKENS = ['brutto', 'bruto', 'gross', 'incl', 'including'];
