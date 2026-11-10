/** Landing page and public demo. Wording rules: no promised savings, no ROI, "possible" for anything unverified, no claim of real pilots. */
const home = {
  'home.hero.title': 'Find what is worth checking in your business numbers.',
  'home.hero.sub': 'The app analyses your Excel reports and looks for possible losses, unusual changes and overlooked discrepancies in sales, purchasing, receivables/payables and stock. Every finding comes with an explanation and the records behind it.',
  'home.hero.demo': 'See the demo', 'home.hero.own': 'Try it with your own file',
  'home.hero.note': 'No sign-up. The demo needs none of your data – it uses synthetic sample files.',
  'home.hero.local': 'Your files are analysed in your browser.',

  'home.ex.label': 'Example finding · synthetic data',
  'home.ex.kind': 'Needs checking',
  'home.ex.amount': 'amount to check',
  'home.ex.what': 'A credit note that may still be unused. The balance is {amount}.',
  'home.ex.why': 'Why was this flagged?',
  'home.ex.records': 'Records behind it: {n}',
  'home.ex.note': 'Demo example from synthetic data, produced by the same analysis the app runs on your files. It is a lead to verify, not a confirmed loss.',
  'home.ex.open': 'Open the demo and see the evidence',
  'home.ex.show': 'Show the evidence',

  'home.what.title': 'What the app looks for',
  'home.what.sub': 'Five areas. Each result is a prompt to check something, never a conclusion about your accounts.',
  'home.m.purchasing': 'Purchase price changes', 'home.m.purchasing.d': 'Where purchase prices rose, and whether another supplier sold the same item for less.',
  'home.m.debts': 'Receivables, credit notes and payments', 'home.m.debts.d': 'Overdue invoices, credit notes that may be unused, possible duplicate payments and payments that do not match an invoice.',
  'home.m.sales': 'Sales and margins', 'home.m.sales.d': 'Customers and products that are declining, and low-margin products when cost is provided.',
  'home.m.inventory': 'Slow stock and shortage risk', 'home.m.inventory.d': 'Items that do not move, excess stock and items that may run out.',
  'home.m.universal': 'Any other table', 'home.m.universal.d': 'Trends, outliers, duplicates and data quality in any Excel or CSV table.',

  'home.how.title': 'How it works',
  'home.how.1': 'Open the demo or load your own Excel / CSV file', 'home.how.2': 'Confirm which column means what', 'home.how.3': 'The app checks data quality and calculates the figures', 'home.how.4': 'Read the findings with their evidence and export a report',

  'home.priv.title': 'Privacy: how your data is handled',
  'home.priv.1': 'Files are read and analysed inside your browser (a Web Worker). The app does not upload their contents.',
  'home.priv.2': 'Imported data is stored only in this browser (IndexedDB) and can be deleted with one click.',
  'home.priv.3': 'No external AI service, no analytics or error tracking. The site’s security policy allows connections only to the site itself.',
  'home.priv.4': 'The page is delivered as static files. Ordinary hosting logs may record that the page was opened, but not your file contents.',

  'home.stage.title': 'Where the product stands',
  'home.stage.body': 'The app has been tested with synthetic data. No pilots with real company data have been carried out yet, so the results are not confirmed savings and we make no promises about them.',

  'home.pilot.title': 'We are looking for the first companies for a free pilot.',
  'home.pilot.what.t': 'What you could try', 'home.pilot.what.d': 'Your own exports – for example an open-invoice report, purchase lines, sales lines or stock balances. The files stay on your computer.',
  'home.pilot.how.t': 'How findings are checked', 'home.pilot.how.d': 'A person who knows your accounts reviews each finding and marks it confirmed, rejected or unclear. We count how many hold up.',
  'home.pilot.fb.t': 'Feedback we would ask for', 'home.pilot.fb.d': 'What the finding showed, what was missing and what was wrong. Nothing is sold during the pilot and no prices exist yet.',

  'demo.banner': 'Demo · synthetic data – your own data is not involved.',
  'demo.loading': 'Loading the synthetic sample files… {done}/{total}',
  'demo.failed': 'The demo files could not be loaded completely. Reload the page or start the demo again.',
  'demo.restart': 'Restart demo', 'demo.exit': 'Leave demo',
  'demo.note': 'Sample files use Lithuanian headers and invented company names. They are not real companies or ERP exports.',
} as const;
export default home;
