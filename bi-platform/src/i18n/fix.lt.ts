import type fix from './fix.en';
const lt: Record<keyof typeof fix, string> = {
  'issue.credit_sign_ambiguous': 'Kreditinės eilutė su teigiama suma NEimportuota (kitos kreditinės yra neigiamos)',
  'issue.quantity_sign_normalised': 'Neigiamos sumos eilutės kiekis padarytas neigiamas (grąžinimai mažina kiekį)',
  'issue.quantity_sign_ambiguous': 'Kiekis ignoruotas: jo ženklas nesutampa su sumos ženklu',
  'issue.cost_suspect': 'Savikaina nenaudojama: neigiama, gerokai viršija kainą arba nežinomo ženklo grąžinimo savikaina',
  'issue.cost_zero': 'Nulinė pardavimo savikaina (paliekama; jei reiškia „nežinoma“, marža bus per didelė)',
  'itrust.credit_ambiguous': '{n} eil. pažymėta kaip kreditinės, bet jų suma TEIGIAMA, o kitos kreditinės neigiamos. Faile sumaišytos dvi ženklų taisyklės, todėl šios eilutės neimportuotos (kitaip jos būtų skaičiuojamos kaip pardavimai). Pataisykite ženklus faile ir importuokite iš naujo.',
};
export default lt;
