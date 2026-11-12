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
  unit_price: ['kaina', 'pardavimo kaina', 'vieneto kaina', 'vnt kaina', 'cena', 'cena jednostkowa', 'cena sprzedazy', 'price', 'unit price', 'sales price'],
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
  document_type: [
    'dokumento tipas', 'dok tipas', 'operacijos tipas', 'dokumento rusis', 'tipas', 'rusis',
    'typ dokumentu', 'rodzaj dokumentu', 'rodzaj', 'typ',
    'document type', 'doc type', 'transaction type', 'type',
  ],
  unit: [
    'matavimo vnt', 'mato vnt', 'mato vienetas', 'matavimo vienetas', 'vienetas', 'mv', 'unit',
    'jednostka miary', 'jm', 'j m', 'jednostka', 'miara',
    'uom', 'unit of measure', 'unit of measurement', 'measure',
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

// ───────────────────────── purchasing ─────────────────────────
import type { FieldId, FinanceField, InventoryField, ModuleId, PurchaseField } from '../types';

/**
 * Purchasing-specific header synonyms (normalised). Fields not listed here fall back to SALES_SYNONYMS (date, document, product, amounts…).
 * Note the deliberate differences from sales: "Pardavėjas" / "Kontrahent" mean the SUPPLIER here, and "vnt" / "szt" are UNITS, not quantities.
 */
export const PURCHASE_SYNONYMS: Partial<Record<PurchaseField, string[]>> = {
  document_date: [
    'pirkimo data', 'saskaitos gavimo data', 'gavimo data', 'data zakupu', 'data przyjecia', 'data wplywu', 'data otrzymania',
    'purchase date', 'receipt date', 'bill date', 'invoice date',
  ],
  document_id: [
    'tiekejo saskaitos nr', 'tiekejo saskaita', 'pirkimo dokumentas', 'pirkimo saskaitos nr', 'nr faktury dostawcy', 'numer faktury zakupu', 'faktura zakupu',
    'supplier invoice', 'supplier invoice no', 'vendor invoice no', 'vendor invoice', 'purchase invoice', 'bill no',
  ],
  supplier_name: [
    'tiekejas', 'tiekejo pavadinimas', 'tiekejas pavadinimas', 'tiekejo', 'pardavejas', 'pardavejo pavadinimas', 'kontrahentas', 'partneris',
    'dostawca', 'nazwa dostawcy', 'kontrahent', 'nazwa kontrahenta', 'sprzedawca', 'wystawca',
    'supplier', 'supplier name', 'vendor', 'vendor name', 'seller',
  ],
  supplier_id: [
    'tiekejo kodas', 'tiekejo id', 'tiekejo nr', 'tiekejo imones kodas',
    'kod dostawcy', 'id dostawcy', 'nip dostawcy', 'symbol dostawcy', 'kod kontrahenta', 'nip',
    'supplier id', 'supplier code', 'vendor id', 'vendor code', 'vendor no',
  ],
  quantity: ['kiekis', 'kiek', 'gautas kiekis', 'pirktas kiekis', 'ilosc', 'il', 'ilosc zakupu', 'quantity', 'qty', 'received quantity', 'purchased quantity'],
  unit: [
    'matavimo vnt', 'mato vnt', 'mato vienetas', 'matavimo vienetas', 'vienetas', 'mv', 'unit',
    'jednostka miary', 'jm', 'j m', 'jednostka', 'miara',
    'uom', 'unit of measure', 'unit of measurement', 'measure',
  ],
  unit_price: [
    'kaina', 'vieneto kaina', 'pirkimo kaina', 'vnt kaina', 'kaina be pvm', 'savikaina vnt',
    'cena', 'cena jednostkowa', 'cena zakupu', 'cena zakupu netto', 'cena netto',
    'price', 'unit price', 'purchase price', 'cost price', 'unit cost',
  ],
  discount_amount: [
    'nuolaida', 'nuolaidos suma', 'nuolaida eur', 'rabatas', 'rabatas suma',
    'rabat', 'kwota rabatu', 'upust', 'kwota upustu',
    'discount', 'discount amount', 'rebate', 'rebate amount',
  ],
  warehouse: [
    'sandelis', 'sandelys', 'skyrius', 'padalinys', 'sandelio kodas',
    'magazyn', 'dzial', 'oddzial', 'miejsce skladowania', 'kod magazynu',
    'warehouse', 'store', 'location', 'department', 'branch', 'site',
  ],
  document_type: [
    'dokumento tipas', 'dok tipas', 'operacijos tipas', 'dokumento rusis', 'tipas', 'rusis',
    'typ dokumentu', 'rodzaj dokumentu', 'rodzaj', 'typ',
    'document type', 'doc type', 'transaction type', 'type',
  ],
  net_amount: [
    'pirkimo suma be pvm', 'pirkimo verte be pvm', 'wartosc zakupu netto', 'kwota zakupu netto', 'zakup netto',
    'purchase net', 'net cost', 'net purchase amount', 'net spend',
  ],
  gross_amount: [
    'pirkimo suma su pvm', 'pirkimo verte su pvm', 'wartosc zakupu brutto', 'kwota zakupu brutto', 'zakup brutto',
    'purchase gross', 'gross cost', 'gross purchase amount',
  ],
  amount_unknown_basis: [
    'pirkimo suma', 'pirkimo verte', 'pirkimai', 'islaidos', 'suma', 'verte', 'viso',
    'wartosc zakupu', 'kwota zakupu', 'zakup', 'wartosc', 'kwota', 'razem',
    'purchase amount', 'purchase value', 'spend', 'cost', 'line cost', 'amount', 'total', 'value',
  ],
};

/** What one module understands. The mapper, validator and import UI all read this. */
export interface ModuleSpec {
  id: ModuleId;
  fields: readonly FieldId[];
  numeric: FieldId[];
  text: FieldId[];
  ids: FieldId[];
  /** Short categorical text columns (low distinct count). */
  short: FieldId[];
  synonyms(field: FieldId): string[];
}

import { SALES_FIELDS, PURCHASE_FIELDS, INVENTORY_FIELDS, FINANCE_FIELDS } from '../types';

export const SALES_SPEC: ModuleSpec = {
  id: 'sales',
  fields: SALES_FIELDS,
  numeric: NUMERIC_FIELDS,
  text: TEXT_FIELDS,
  ids: ID_FIELDS,
  short: ['currency', 'unit', 'document_type'],
  synonyms: (f) => SALES_SYNONYMS[f as keyof typeof SALES_SYNONYMS] ?? [],
};

export const PURCHASE_SPEC: ModuleSpec = {
  id: 'purchasing',
  fields: PURCHASE_FIELDS,
  numeric: ['quantity', 'unit_price', 'discount_amount', 'net_amount', 'gross_amount', 'amount_unknown_basis', 'vat_amount'],
  text: ['supplier_name', 'product_name', 'warehouse'],
  ids: ['document_id', 'supplier_id', 'product_id'],
  short: ['currency', 'unit', 'document_type'],
  // purchasing-specific words PLUS the shared vocabulary; quantity is the exception: in purchasing "vnt" / "szt" are UNITS
  synonyms: (f) => [...(PURCHASE_SYNONYMS[f as PurchaseField] ?? []), ...(f === 'quantity' ? [] : SALES_SYNONYMS[f as keyof typeof SALES_SYNONYMS] ?? [])],
};


// ───────────────────────── inventory ─────────────────────────
/**
 * Inventory-specific header synonyms (normalised). Fields not listed fall back to the purchasing vocabulary for unit / currency / product / category,
 * and to the sales vocabulary for the rest. "Likutis" (LT) / "Stan" (PL) are quantities HERE, "vnt" / "szt" are units.
 */
export const INVENTORY_SYNONYMS: Partial<Record<InventoryField, string[]>> = {
  snapshot_date: [
    'likucio data', 'likutis data', 'likutis datai', 'busenos data', 'ataskaitos data', 'inventorizacijos data', 'likutis dienos pabaigoje', 'data pagal',
    'data stanu', 'stan na dzien', 'stan na', 'data inwentaryzacji', 'data raportu', 'na dzien',
    'snapshot date', 'as of', 'as of date', 'balance date', 'stock date', 'report date', 'closing date', 'date',
    'data',
  ],
  movement_date: [
    'judejimo data', 'operacijos data', 'dokumento data', 'judejimo dokumento data', 'israsymo data', 'pajamavimo data',
    'data ruchu', 'data operacji', 'data dokumentu', 'data wydania', 'data przyjecia',
    'movement date', 'transaction date', 'posting date', 'document date', 'booking date',
  ],
  document_id: [
    'judejimo dokumentas', 'judejimo dokumento nr', 'dokumento nr', 'dok nr', 'dokumentas', 'operacijos nr',
    'numer dokumentu', 'nr dokumentu', 'dokument', 'numer ruchu',
    'document no', 'document number', 'doc no', 'reference', 'ref no', 'movement document',
  ],
  product_id: [
    'prekes kodas', 'prekes nr', 'artikulas', 'sku', 'kodas', 'artikulo kodas', 'medziagos kodas',
    'kod towaru', 'indeks', 'symbol', 'symbol towaru', 'kod produktu', 'numer katalogowy', 'kod',
    'item code', 'product code', 'item no', 'part number', 'material', 'material no', 'article number',
  ],
  product_name: [
    'preke', 'prekes pavadinimas', 'pavadinimas', 'produktas', 'prekes aprasymas', 'medziaga',
    'towar', 'nazwa towaru', 'nazwa', 'produkt', 'nazwa produktu', 'artykul', 'nazwa artykulu',
    'product', 'product name', 'item', 'item name', 'description', 'material description', 'article',
  ],
  product_category: [
    'prekiu grupe', 'grupe', 'kategorija', 'prekes grupe', 'prekiu kategorija', 'asortimento grupe',
    'grupa towarowa', 'kategoria', 'grupa', 'grupa produktow', 'kategoria towaru',
    'category', 'product group', 'product category', 'item group', 'group',
  ],
  warehouse: [
    'sandelis', 'sandelys', 'sandelio kodas', 'sandelis is', 'is sandelio', 'saltinio sandelis', 'skyrius', 'padalinys', 'vieta',
    'magazyn', 'kod magazynu', 'magazyn zrodlowy', 'z magazynu', 'miejsce skladowania', 'lokalizacja', 'oddzial',
    'warehouse', 'storage location', 'location', 'from warehouse', 'source warehouse', 'site', 'store', 'branch',
  ],
  warehouse_to: [
    'i sandeli', 'sandelis i', 'kitas sandelis', 'paskirties sandelis', 'gavejo sandelis', 'sandelis kuriam',
    'magazyn docelowy', 'do magazynu', 'magazyn do', 'magazyn przyjmujacy',
    'to warehouse', 'destination warehouse', 'target warehouse', 'receiving warehouse', 'destination',
  ],
  quantity: [
    'kiekis', 'likutis', 'likutis kiekis', 'atsargu kiekis', 'kiekis sandelyje', 'likutis vnt', 'faktinis likutis', 'kiek',
    'ilosc', 'stan', 'stan magazynowy', 'stan ilosciowy', 'il', 'stan koncowy',
    'quantity', 'qty', 'stock', 'stock qty', 'on hand', 'qty on hand', 'balance', 'stock on hand', 'closing quantity', 'closing stock',
  ],
  unit_cost: [
    'savikaina', 'vieneto savikaina', 'vnt savikaina', 'vidutine savikaina', 'savikaina vnt', 'kaina', 'vieneto kaina', 'vidutine kaina',
    'cena zakupu', 'koszt jednostkowy', 'cena ewidencyjna', 'sredni koszt', 'cena', 'cena jednostkowa', 'cena nabycia', 'sredni koszt jednostkowy',
    'unit cost', 'average cost', 'avg cost', 'cost per unit', 'standard cost', 'cost price', 'moving average price', 'unit price',
  ],
  stock_value: [
    'likucio verte', 'atsargu verte', 'verte', 'savikainos suma', 'likutis verte', 'likutis eur', 'bendra verte', 'sandelio verte', 'suma',
    'wartosc', 'wartosc stanu', 'wartosc magazynowa', 'wartosc zapasu', 'wartosc zapasow', 'wartosc ewidencyjna', 'kwota',
    'stock value', 'inventory value', 'value', 'total value', 'total cost', 'extended cost', 'amount', 'valuation', 'book value',
  ],
  movement_type: [
    'judejimo tipas', 'operacijos tipas', 'operacija', 'dokumento tipas', 'dok tipas', 'judejimo rusis', 'tipas', 'rusis', 'operacijos rusis',
    'typ ruchu', 'rodzaj ruchu', 'typ dokumentu', 'rodzaj dokumentu', 'typ operacji', 'rodzaj operacji', 'typ', 'rodzaj',
    'movement type', 'transaction type', 'operation', 'operation type', 'doc type', 'document type', 'type', 'movement',
  ],
  min_stock: [
    'minimalus likutis', 'min likutis', 'minimalus kiekis', 'minimumas', 'minimalus atsargu lygis', 'atsargu minimumas', 'saugos atsargos', 'uzsakymo riba',
    'stan minimalny', 'min stan', 'zapas minimalny', 'minimum', 'minimalny stan', 'zapas bezpieczenstwa', 'punkt zamowienia',
    'minimum stock', 'min stock', 'reorder level', 'reorder point', 'safety stock', 'par level', 'min qty', 'minimum quantity',
  ],
};

export const INVENTORY_SPEC: ModuleSpec = {
  id: 'inventory',
  fields: INVENTORY_FIELDS,
  numeric: ['quantity', 'unit_cost', 'stock_value', 'min_stock'],
  text: ['product_name', 'product_category', 'warehouse', 'warehouse_to'],
  ids: ['document_id', 'product_id'],
  short: ['currency', 'unit', 'movement_type'],
  synonyms: (f) => {
    const own = INVENTORY_SYNONYMS[f as InventoryField];
    if (own) return own;
    if (f === 'unit') return PURCHASE_SYNONYMS.unit ?? [];
    return SALES_SYNONYMS[f as keyof typeof SALES_SYNONYMS] ?? [];
  },
};

// ───────────────────────── receivables / payables / cash ─────────────────────────
/**
 * Finance header synonyms (normalised). Note "1-30" → "1 30" and "90+" → "90" after normalisation.
 * Fields not listed fall back to the sales vocabulary (currency …).
 */
export const FINANCE_SYNONYMS: Partial<Record<FinanceField, string[]>> = {
  document_date: ['saskaitos data', 'israsymo data', 'dokumento data', 'saskaitos israsymo data', 'data faktury', 'data wystawienia', 'data dokumentu', 'invoice date', 'issue date', 'document date', 'posting date', 'date', 'data'],
  snapshot_date: ['ataskaitos data', 'likucio data', 'skolos data', 'skolu data', 'busenos data', 'data pagal', 'stan na dzien', 'stan na', 'na dzien', 'data raportu', 'data salda', 'as of', 'as of date', 'report date', 'balance date', 'aging date', 'ageing date', 'snapshot date', 'statement date', 'cut off date'],
  due_date: ['apmokejimo terminas', 'terminas', 'moketi iki', 'apmoketi iki', 'mokejimo terminas', 'termino data', 'galutinis terminas', 'termin platnosci', 'termin', 'platne do', 'termin zaplaty', 'data terminu', 'due date', 'due', 'payment due', 'payable by', 'maturity date', 'pay by'],
  payment_date: ['apmokejimo data', 'mokejimo data', 'sumokejimo data', 'apmokejimo diena', 'data zaplaty', 'data wplaty', 'data przelewu', 'data platnosci', 'payment date', 'paid on', 'date paid', 'receipt date', 'value date', 'bank date'],
  document_id: ['saskaitos nr', 'saskaitos numeris', 'saskaita', 'dokumento nr', 'dok nr', 'numeris', 'nr', 'dokumentas', 'kreditines nr', 'numer faktury', 'nr faktury', 'numer dokumentu', 'nr dokumentu', 'faktura', 'dokument', 'invoice no', 'invoice number', 'invoice', 'document no', 'document number', 'doc no', 'credit note no', 'credit note number', 'number'],
  counterparty_name: ['klientas', 'pirkejas', 'tiekejas', 'kontrahentas', 'partneris', 'imone', 'pavadinimas', 'skolininkas', 'kreditorius', 'kliento pavadinimas', 'tiekejo pavadinimas', 'kontrahent', 'nabywca', 'dostawca', 'odbiorca', 'dluznik', 'wierzyciel', 'nazwa kontrahenta', 'klient', 'customer', 'customer name', 'supplier', 'supplier name', 'vendor', 'vendor name', 'client', 'debtor', 'creditor', 'counterparty', 'name', 'account name', 'party', 'bill to'],
  counterparty_id: ['kliento kodas', 'tiekejo kodas', 'kodas', 'imones kodas', 'partnerio kodas', 'kontrahento kodas', 'kod kontrahenta', 'kod klienta', 'kod dostawcy', 'nip', 'symbol kontrahenta', 'customer id', 'customer code', 'supplier id', 'supplier code', 'vendor id', 'vendor code', 'account no', 'counterparty id', 'party id'],
  original_amount: ['saskaitos suma', 'sask suma', 'suma', 'israsyta suma', 'bendra suma', 'viso', 'verte', 'dokumento suma', 'kreditines suma', 'kwota faktury', 'wartosc faktury', 'kwota brutto', 'wartosc brutto', 'razem', 'kwota', 'wartosc', 'invoice amount', 'original amount', 'invoice total', 'amount', 'total', 'gross amount', 'document amount', 'face value', 'credit amount', 'credit note amount'],
  outstanding_amount: ['neapmoketa suma', 'neapmoketa', 'neapmoketas likutis', 'likutis', 'skola', 'skolos suma', 'moketina suma', 'lieka sumoketi', 'nesumoketa suma', 'nesumoketa', 'neatsiskaityta', 'saldo', 'do zaplaty', 'pozostalo do zaplaty', 'pozostalo', 'nierozliczone', 'nierozliczona kwota', 'zaleglosc', 'naleznosc', 'outstanding', 'outstanding amount', 'balance', 'open amount', 'amount due', 'remaining', 'unpaid', 'open balance', 'balance due'],
  paid_amount: ['sumoketa suma', 'sumoketa', 'apmoketa suma', 'apmoketa', 'sumokejimai', 'mokejimo suma', 'sumoketas', 'gauta suma', 'zaplacono', 'kwota zaplacona', 'wplata', 'zaplata', 'kwota wplaty', 'kwota platnosci', 'paid', 'paid amount', 'payment', 'payment amount', 'amount paid', 'received', 'received amount'],
  document_type: ['dokumento tipas', 'dok tipas', 'tipas', 'rusis', 'typ dokumentu', 'rodzaj dokumentu', 'typ', 'rodzaj', 'document type', 'doc type', 'type', 'transaction type'],
  credit_reference: ['kreditinio pagrindas', 'pagrindine saskaita', 'pagrindas', 'koreguojama saskaita', 'saskaita kuriai', 'faktura korygowana', 'dokument zrodlowy', 'nr faktury korygowanej', 'korygowana faktura', 'original invoice', 'original invoice no', 'credited invoice', 'credit reference', 'against invoice'],
  invoice_reference: ['apmoketa saskaita', 'apmokamos saskaitos nr', 'saskaitos nr apmokejimui', 'dotyczy faktury', 'faktura rozliczana', 'nr faktury rozliczanej', 'rozliczana faktura', 'applied to invoice', 'paid invoice', 'invoice paid', 'invoice ref', 'invoice reference', 'settles invoice'],
  payment_reference: ['mokejimo nr', 'mokejimo numeris', 'mokejimo nuoroda', 'pavedimo nr', 'banko operacijos nr', 'nr platnosci', 'numer platnosci', 'numer przelewu', 'referencja platnosci', 'payment reference', 'payment ref', 'payment no', 'payment id', 'transaction id', 'bank reference', 'remittance reference', 'transfer id'],
  aging_current: ['nepradelsta', 'nepradelsti', 'dar nepasibaiges', 'terminas nepasibaiges', 'neprosrocone', 'biezace', 'nieprzeterminowane', 'current', 'not due', 'not yet due', 'undue', '0 days', 'nepasibaiges terminas'],
  aging_1_30: ['1 30', '1 30 d', '1 30 dienu', 'vely 1 30', 'po termino 1 30', '1 30 dni', 'do 30 dni', '1 30 days', '0 30', 'overdue 1 30', '1 to 30', 'pradelsta 1 30'],
  aging_31_60: ['31 60', '31 60 d', '31 60 dienu', 'vely 31 60', '31 60 dni', '31 60 days', '31 to 60', 'overdue 31 60', 'pradelsta 31 60'],
  aging_61_90: ['61 90', '61 90 d', '61 90 dienu', 'vely 61 90', '61 90 dni', '61 90 days', '61 to 90', 'overdue 61 90', 'pradelsta 61 90'],
  aging_90_plus: ['90', '91', 'daugiau nei 90', 'virs 90', 'ponad 90', 'powyzej 90', 'over 90', 'more than 90', '90 plus', '91 plus', 'older than 90', 'pradelsta virs 90'],
};

export const FINANCE_SPEC: ModuleSpec = {
  id: 'finance',
  fields: FINANCE_FIELDS,
  numeric: ['original_amount', 'outstanding_amount', 'paid_amount', 'aging_current', 'aging_1_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus'],
  text: ['counterparty_name'],
  ids: ['document_id', 'counterparty_id', 'credit_reference', 'invoice_reference', 'payment_reference'],
  short: ['currency', 'document_type'],
  synonyms: (f) => FINANCE_SYNONYMS[f as FinanceField] ?? SALES_SYNONYMS[f as keyof typeof SALES_SYNONYMS] ?? [],
};

export const SPECS: Record<ModuleId, ModuleSpec> = { sales: SALES_SPEC, purchasing: PURCHASE_SPEC, inventory: INVENTORY_SPEC, finance: FINANCE_SPEC };

// Words that identify the kind of file. Ambiguous words (e.g. "kontrahent", "pardavėjas") are deliberately in neither list.
export const PURCHASING_WORDS = ['tiekejas', 'tiekejo', 'dostawca', 'dostawcy', 'supplier', 'vendor', 'pirkimo', 'pirkimai', 'zakupu', 'zakup', 'purchase', 'purchases'];
export const SALES_WORDS = ['klientas', 'kliento', 'pirkejas', 'pirkejo', 'nabywca', 'klient', 'klienta', 'odbiorca', 'customer', 'client', 'buyer', 'pardavimo', 'pardavimai', 'sprzedazy', 'sprzedaz', 'sales', 'handlowiec', 'vadybininkas'];

/** Inventory-only words. "Sandėlis" / "magazyn" / "warehouse" are deliberately in no list: purchase exports have them too. */
export const INVENTORY_WORDS = ['likutis', 'likuciai', 'likucio', 'atsargos', 'atsargu', 'inventorius', 'stan', 'magazynowy', 'zapas', 'zapasy', 'zapasow', 'stock', 'inventory', 'hand', 'movement', 'judejimo', 'ruchu', 'snapshot', 'reorder', 'minimalus', 'minimalny'];

/** Receivables / payables words. Generic words (invoice, amount, date) are deliberately in no list. */
export const FINANCE_WORDS = ['terminas', 'apmokejimo', 'neapmoketa', 'nesumoketa', 'skola', 'skolos', 'skolininkas', 'skolininkai', 'gautinos', 'moketinos', 'vely', 'pradelsta', 'pradelsti', 'termin', 'platnosci', 'zaplacono', 'zaleglosc', 'zaleglosci', 'przeterminowane', 'nierozliczone', 'naleznosci', 'zobowiazania', 'dluznik', 'wierzyciel', 'kreditorius', 'overdue', 'outstanding', 'receivable', 'receivables', 'payable', 'payables', 'due', 'aging', 'ageing', 'debtor', 'creditor', 'unpaid', 'maturity', 'mokejimo', 'sumoketa', 'apmoketa', 'kreditines', 'pagrindine', 'payment', 'paid', 'credit', 'zaplata', 'wplata', 'nieprzeterminowane', 'nepradelsta', 'nepradelsti', 'nepasibaiges', '60', '90'];
/** Who owes whom: customer-side words mean receivables, supplier-side words payables. */
export const RECEIVABLE_WORDS = ['klientas', 'kliento', 'pirkejas', 'pirkejo', 'skolininkas', 'skolininkai', 'gautinos', 'nabywca', 'klient', 'klienta', 'odbiorca', 'dluznik', 'naleznosci', 'customer', 'client', 'buyer', 'debtor', 'receivable', 'receivables'];
export const PAYABLE_WORDS = ['tiekejas', 'tiekejo', 'kreditorius', 'moketinos', 'dostawca', 'dostawcy', 'wierzyciel', 'zobowiazania', 'supplier', 'vendor', 'creditor', 'payable', 'payables', 'pardavejas'];
