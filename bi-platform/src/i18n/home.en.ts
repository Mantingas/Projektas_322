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
  'home.ex.why': 'Why was this flagged?',
  'home.ex.records': 'Records behind it: {n}',
  'home.ex.caveat': 'The finding is based on records in the loaded data. Whether it is a real financial discrepancy has to be checked.',
  'home.ex.open': 'Open the demo and see the evidence',
  'home.ex.show': 'Show the evidence',

  'home.what.title': 'What the app looks for',
  'home.m.purchasing': 'Purchase price changes', 'home.m.purchasing.d': 'Spot rising purchase prices and earlier price differences between suppliers.',
  'home.m.debts': 'Receivables, credit notes and payments', 'home.m.debts.d': 'Overdue invoices, credit notes that may be unused and possible duplicate payments.',
  'home.m.sales': 'Sales and margins', 'home.m.sales.d': 'Declining customers and products, and low-margin products when cost is provided.',
  'home.m.inventory': 'Stock', 'home.m.inventory.d': 'Items that do not move, excess stock and items that may run out.',
  'home.m.universal': 'Any other table', 'home.m.universal.d': 'Trends, outliers, duplicates and data quality in any Excel or CSV table.',

  'home.how.title': 'How it works',
  'home.how.1': 'Open the demo or load an Excel / CSV file', 'home.how.2': 'Confirm what the columns mean, when asked', 'home.how.3': 'The app analyses the data', 'home.how.4': 'Review the findings and their evidence',

  'home.priv.title': 'Privacy',
  'home.priv.f1': 'Your files are analysed in your browser.', 'home.priv.f2': 'The app does not send file contents to a server.', 'home.priv.f3': 'You can remove your data from this browser’s storage at any time.',
  'home.priv.more': 'Technical details',
  'home.priv.d1': 'Analysis runs in a Web Worker in your browser. Imported data is stored only in this browser (IndexedDB).',
  'home.priv.d2': 'No external AI service, no analytics or error tracking. The site’s security policy allows connections only to the site itself.',
  'home.priv.d3': 'The page is delivered as static files. Ordinary hosting logs may record that the page was opened, but not your file contents.',

  'home.stage.title': 'Where the product stands',
  'home.stage.body': 'The app has been tested with synthetic data. Pilots with real company data have not been carried out yet.',

  'home.pilot.title': 'We are looking for the first companies for a free pilot.',
  'home.pilot.title.plan': 'We are preparing a free pilot.',
  'home.pilot.what': 'Companies could try their own exports – for example an open-invoice report, purchase or sales lines, or stock balances. The files stay on their computer.',
  'home.pilot.how': 'A person who knows the accounts would review each finding and mark it confirmed, rejected or unclear, so we can count how many hold up.',
  'home.pilot.contact.lead': 'Want to take part? Write to:', 'home.pilot.contact.safe': 'Please do not send financial files in the first e-mail – we will first agree how your data stays with you.',

  'demo.banner': 'Demo · synthetic data – your own data is not involved.',
  'demo.loading': 'Loading the synthetic sample files… {done}/{total}',
  'demo.failed': 'The demo files could not be loaded completely. Reload the page or start the demo again.',
  'demo.restart': 'Restart demo', 'demo.exit': 'Back to my workspace',
  'demo.note': 'Sample files use Lithuanian headers and invented company names. They are not real companies or ERP exports.',
} as const;
export default home;
