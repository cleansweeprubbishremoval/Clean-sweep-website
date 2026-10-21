/**
 * Clean Sweep Rubbish Removals: website bookings -> Google Calendar, emails and texts
 *
 * What it does for every booking made on the website:
 *   1. Adds it to your Google Calendar in the customer's arrival window, with their
 *      name, best contact number and pickup address.
 *   2. Emails you the full booking. Texts you too, once SMS is switched on (below).
 *   3. Emails the customer their booking confirmation with a branded invoice (in the email and
 *      as a PDF), and saves a copy of each invoice to "Clean Sweep invoices" in your Google Drive.
 *      Customers who only gave a phone number get a text confirmation instead.
 *   4. 48 hours before the job, sends the customer a reminder (email and/or text).
 *   5. Customers who tick "Email me offers" go on a private Google Sheet in your Drive
 *      ("Clean Sweep customer list"). On the 1st of each month at 9am they get your
 *      monthly email, with a working unsubscribe link (required by the Spam Act).
 *   6. Every hour it copies new Stripe payments into a private Google Sheet
 *      ("Clean Sweep income") with monthly and financial-year totals.
 *
 * Setup: see SETUP.md. Do it while signed in to cleansweeprubbishremoval@gmail.com.
 */

// ---------------- settings ----------------
const OWNER_MOBILE = '0493866368';            // you get a text for every new booking (needs SMS below)
const SEND_CUSTOMER_CONFIRMATION = true;      // confirmation as soon as they book
const SEND_INVOICE = true;                    // attach a branded invoice to the confirmation email
const GST_REGISTERED = false;                 // set to true once you're registered for GST: invoices become "Tax invoice" and show the GST included
const WEBSITE = 'cleansweeprubbishremovals.netlify.app';
const LOGO_URL = 'https://cleansweeprubbishremovals.netlify.app/logo-email.png';
const REMINDER_HOURS_BEFORE = 48;

// Text messages: Google can't send texts by itself, so this uses ClickSend
// (an Australian SMS service, pay as you go, a few cents per text).
// Make a free account at clicksend.com, then paste your username and API key here.
// Leave blank to skip texts; emails still work.
const CLICKSEND_USERNAME = '';
const CLICKSEND_API_KEY = '';

// Income records: paste a Stripe *restricted* key with read-only access (starts with rk_live_).
// Stripe dashboard > Developers > API keys > Create restricted key > set everything to "Read".
// Keep this script private. Leave blank to skip.
const STRIPE_READ_KEY = '';
// ------------------------------------------

const TZ = 'Australia/Sydney';
const WINDOWS = { 'Morning (7–11am)': [7, 11], 'Midday (11am–2pm)': [11, 14], 'Afternoon (2–5pm)': [14, 17] };
const OWNER_EMAIL = () => Session.getEffectiveUser().getEmail();

function doPost(e) {
  const p = (e && e.parameter) || {};
  try {
    const ev = addBooking_(p);
    notifyOwner_(p);
    if (SEND_CUSTOMER_CONFIRMATION) confirmCustomer_(p);
    if (p.marketing === 'yes' && p.email) addSubscriber_(p);
    return json_({ ok: true, id: ev.getId() });
  } catch (err) {
    MailApp.sendEmail(OWNER_EMAIL(), 'Website booking needs checking: ' + (p.name || 'unknown'),
      'A booking came in but something went wrong.\n\nError: ' + err + '\n\n' + details_(p));
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const t = e && e.parameter && e.parameter.unsub;
  if (t) {
    const ok = unsubscribe_(t);
    return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;text-align:center;color:#12203A">' +
      '<h2>' + (ok ? "You're unsubscribed" : 'Already unsubscribed') + '</h2><p>You won\'t get any more offer emails from Clean Sweep Rubbish Removals.</p>' +
      '<p>Bookings and reminders for jobs you book still come through.</p></div>').setTitle('Unsubscribed');
  }
  return ContentService.createTextOutput('Clean Sweep booking calendar is running.');
}

// ---------- calendar ----------
function addBooking_(p) {
  const [y, m, d] = String(p.date || '').split('-').map(Number);
  if (!y || !m || !d) throw new Error('Missing or invalid date: ' + p.date);
  const h = WINDOWS[p.window] || hourSlot_(p.window);
  const at = hr => Utilities.parseDate(Utilities.formatString('%04d-%02d-%02d %02d:00', y, m, d, hr), TZ, 'yyyy-MM-dd HH:mm');
  const address = [p.street, p.suburb, 'NSW', p.postcode].filter(String).join(' ');
  const title = 'Clean Sweep: ' + (p.size || 'Pickup') + ' – ' + (p.name || 'Customer') + ' – ' + (p.phone || p.email || '');
  const ev = CalendarApp.getDefaultCalendar().createEvent(title, at(h[0]), at(h[1]), { location: address, description: details_(p) });
  ev.setColor(CalendarApp.EventColor.GREEN);
  ev.addPopupReminder(24 * 60);
  // stored on the event so the 48-hour reminder knows who to contact
  ev.setTag('cs_booking', 'yes');
  ev.setTag('cs_name', p.name || ''); ev.setTag('cs_phone', p.phone || ''); ev.setTag('cs_email', p.email || '');
  ev.setTag('cs_ref', p.ref || ''); ev.setTag('cs_window', p.window || ''); ev.setTag('cs_reminded', 'no');
  return ev;
}

function details_(p) {
  return [
    'Booking ' + (p.ref || ''), '',
    'Name: ' + (p.name || ''),
    'Phone: ' + (p.phone || 'not given'),
    'Email: ' + (p.email || 'not given'),
    'Pickup address: ' + [p.street, p.suburb, p.postcode].filter(String).join(', '), '',
    'Job: ' + (p.job || ''),
    p.extras ? 'Extras: ' + p.extras : '',
    'When: ' + (p.dateLabel || p.date || '') + ', ' + (p.window || ''),
    'Estimated total: ' + (p.total || ''),
    'Payment chosen: ' + (p.payChoice || '') + ' (' + (p.payNow || '') + ' online). Check Stripe for booking ' + (p.ref || '') + '.',
    p.items ? 'Items: ' + p.items : '',
    p.notes ? 'Notes: ' + p.notes : '',
  ].filter(function (l) { return l !== ''; }).join('\n');
}

// ---------- messages ----------
function notifyOwner_(p) {
  MailApp.sendEmail(OWNER_EMAIL(), 'New booking: ' + (p.name || '') + ', ' + (p.suburb || '') + ' – ' + (p.dateLabel || p.date || ''),
    details_(p) + '\n\nIt has been added to your Google Calendar.');
  sms_(OWNER_MOBILE, 'New Clean Sweep booking ' + (p.ref || '') + ': ' + (p.name || '') + ', ' + (p.phone || p.email || '') + '. ' +
    (p.size || '') + ' at ' + [p.street, p.suburb].filter(String).join(', ') + ', ' + (p.dateLabel || p.date || '') + ' ' + shortWindow_(p.window) + '.');
}

function confirmCustomer_(p) {
  const first = String(p.name || '').split(' ')[0] || 'there';
  const when = (p.dateLabel || p.date || '') + ', ' + (p.window || '');
  const where = [p.street, p.suburb, p.postcode].filter(String).join(', ');
  if (p.email) {
    if (SEND_INVOICE) {
      try { sendInvoice_(p); return; } catch (err) {
        MailApp.sendEmail(OWNER_EMAIL(), 'Invoice not sent for booking ' + (p.ref || ''), 'The booking confirmation went out without an invoice.\n\nError: ' + err + '\n\n' + details_(p));
      }
    }
    MailApp.sendEmail({
      to: p.email, name: 'Clean Sweep Rubbish Removals', replyTo: OWNER_EMAIL(),
      subject: 'Your Clean Sweep booking is confirmed (' + (p.ref || '') + ')',
      body: 'Hi ' + first + ',\n\nThanks for booking with Clean Sweep Rubbish Removals.\n\n' +
        'When: ' + when + '\nWhere: ' + where + '\nJob: ' + (p.job || '') + (p.extras ? ' + ' + p.extras : '') + '\nEstimated total: ' + (p.total || '') + '\n\n' +
        "We'll be in touch 48 hours before to confirm. Your final price is confirmed on site before we start loading.\n\n" +
        'Need to change or cancel? Call or text 0493 866 368. Bookings cancelled less than 24 hours before the collection time are non-refundable.\n\n' +
        'Cheers,\nLucas\nClean Sweep Rubbish Removals\n0493 866 368 · ABN 55 989 268 862',
    });
  } else {
    sms_(p.phone, 'Hi ' + first + ', your Clean Sweep booking ' + (p.ref || '') + ' is confirmed for ' + when + ' at ' + where +
      '. Changes or cancellations: 0493 866 368 (less than 24 hrs notice is non-refundable).');
  }
}

// ---------- invoices ----------
function nextInvoiceNo_() {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const n = Number(props.getProperty('INVOICE_NO') || 0) + 1;
    props.setProperty('INVOICE_NO', String(n));
    return 'INV-' + ('000' + n).slice(-4);
  } finally { lock.releaseLock(); }
}

const money_ = n => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num_ = v => Number(String(v || '').replace(/[^\d.]/g, '')) || 0;
const esc_ = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Works out the invoice figures from what the website sent.
function invoiceData_(p) {
  let lines = [];
  try { lines = JSON.parse(p.lines || '[]'); } catch (e) { lines = []; }
  lines = lines.filter(l => l && l.d).map(l => ({ d: String(l.d), q: Number(l.q) || 1, u: Number(l.u) || 0 }));
  if (!lines.length) lines = [{ d: p.job || p.size || 'Rubbish removal', q: 1, u: num_(p.total) }];
  const total = lines.reduce((t, l) => t + l.q * l.u, 0);
  const deposit = /deposit/i.test(p.payChoice || '');
  const payNow = Math.min(total, num_(p.payNow) || total);
  return { lines, total, deposit, payNow, balance: Math.max(0, total - payNow), gst: GST_REGISTERED ? total / 11 : 0 };
}

// The invoice itself, as HTML. logoSrc is a cid: or data: image.
function invoiceHtml_(p, no, issued, logoSrc) {
  const d = invoiceData_(p);
  const navy = '#12203A', lime = '#84C430', soft = '#5B6577', line = '#E3E8DD';
  const cell = 'padding:10px 8px;border-bottom:1px solid ' + line + ';font-size:14px;';
  const rows = d.lines.map(l =>
    '<tr><td style="' + cell + '">' + esc_(l.d) + '</td><td style="' + cell + 'text-align:center">' + l.q + '</td>' +
    '<td style="' + cell + 'text-align:right">' + money_(l.u) + '</td><td style="' + cell + 'text-align:right;font-weight:700">' + money_(l.q * l.u) + '</td></tr>').join('');
  const sumRow = (label, value, strong) => '<tr><td style="padding:6px 8px;font-size:' + (strong ? 16 : 14) + 'px;' + (strong ? 'font-weight:800;color:' + navy : 'color:' + soft) + '">' + label + '</td>' +
    '<td style="padding:6px 8px;text-align:right;font-size:' + (strong ? 16 : 14) + 'px;font-weight:' + (strong ? 800 : 600) + ';color:' + navy + '">' + value + '</td></tr>';
  const pay = d.deposit
    ? sumRow('Deposit, payable online at booking', money_(d.payNow)) + sumRow('Balance due on collection day', money_(d.balance), true)
    : sumRow('Payable online at booking', money_(d.payNow)) + (d.balance ? sumRow('Extras due on collection day', money_(d.balance), true) : '');
  const addr = [p.street, [p.suburb, 'NSW', p.postcode].filter(String).join(' ')].filter(String).map(esc_).join('<br>');
  const contact = [p.phone, p.email].filter(String).map(esc_).join('<br>');
  const label = 'font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:' + soft + ';font-weight:700;margin:0 0 6px';
  return '<div style="background:#F3F7EF;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:' + navy + '">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + line + '">' +
  '<tr><td style="background:' + navy + ';padding:22px 24px;border-bottom:5px solid ' + lime + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:middle;width:84px">' + (logoSrc ? '<img src="' + logoSrc + '" width="72" height="72" alt="Clean Sweep" style="display:block;border-radius:50%">' : '') + '</td>' +
    '<td style="vertical-align:middle;color:#ffffff"><div style="font-size:20px;font-weight:800;font-style:italic">CLEAN <span style="color:' + lime + '">SWEEP</span> RUBBISH REMOVALS</div>' +
    '<div style="font-size:12px;color:#C9D4E6;margin-top:4px">ABN 55 989 268 862 · 0493 866 368 · Fully insured</div></td>' +
    '<td style="vertical-align:middle;text-align:right;color:#ffffff"><div style="font-size:22px;font-weight:800;letter-spacing:.04em">' + (GST_REGISTERED ? 'TAX INVOICE' : 'INVOICE') + '</div>' +
    '<div style="font-size:13px;color:#C9D4E6;margin-top:4px">' + esc_(no) + '</div></td></tr></table></td></tr>' +
  '<tr><td style="padding:22px 24px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:top;width:50%;padding-right:12px"><p style="' + label + '">Bill to</p><div style="font-size:14px;line-height:1.5"><b>' + esc_(p.name) + '</b><br>' + addr + (contact ? '<br>' + contact : '') + '</div></td>' +
    '<td style="vertical-align:top;width:50%"><p style="' + label + '">Details</p><div style="font-size:14px;line-height:1.6">' +
      'Invoice date: <b>' + esc_(issued) + '</b><br>Booking: <b>' + esc_(p.ref) + '</b><br>Collection: <b>' + esc_(p.dateLabel || p.date) + '</b><br>Preferred time: <b>' + esc_(p.window) + '</b></div></td>' +
  '</tr></table></td></tr>' +
  '<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr><th align="left" style="' + label + 'padding:8px;border-bottom:2px solid ' + navy + '">Description</th><th style="' + label + 'padding:8px;border-bottom:2px solid ' + navy + ';text-align:center">Qty</th>' +
    '<th style="' + label + 'padding:8px;border-bottom:2px solid ' + navy + ';text-align:right">Price</th><th style="' + label + 'padding:8px;border-bottom:2px solid ' + navy + ';text-align:right">Amount</th></tr>' + rows + '</table></td></tr>' +
  '<tr><td style="padding:10px 24px 4px"><table role="presentation" cellpadding="0" cellspacing="0" style="margin-left:auto;min-width:300px">' +
    sumRow('Total', money_(d.total), true) + (GST_REGISTERED ? sumRow('Includes GST of', money_(d.gst)) : '') + pay + '</table></td></tr>' +
  '<tr><td style="padding:14px 24px 22px"><div style="background:#F3F7EF;border-radius:10px;padding:14px 16px;font-size:12.5px;line-height:1.6;color:' + soft + '">' +
    '<b style="color:' + navy + '">Good to know</b><br>' +
    'Your final price is confirmed on site before we start loading. Online payments are made through our secure Stripe checkout, and Stripe emails your receipt.<br>' +
    'If you paid in full, any extra rubbish not included in this booking won\'t be picked up unless the price difference is paid.<br>' +
    'Bookings cancelled less than 24 hours before the collection time are non-refundable. To change or cancel, call or text 0493 866 368.' +
  '</div><p style="font-size:12px;color:' + soft + ';text-align:center;margin:16px 0 0">Clean Sweep Rubbish Removals · ABN 55 989 268 862 · 0493 866 368 · ' + esc_(WEBSITE) + '</p></td></tr>' +
  '</table></div>';
}

function invoiceFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('INVOICE_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Clean Sweep invoices');
  props.setProperty('INVOICE_FOLDER', f.getId());
  return f;
}

function sendInvoice_(p) {
  const first = String(p.name || '').split(' ')[0] || 'there';
  const no = nextInvoiceNo_();
  const issued = Utilities.formatDate(new Date(), TZ, 'd MMMM yyyy');
  let logo = null;
  try { logo = UrlFetchApp.fetch(LOGO_URL, { muteHttpExceptions: true }); logo = logo.getResponseCode() === 200 ? logo.getBlob().setName('logo.png') : null; } catch (e) { logo = null; }
  const pdfHtml = '<html><body style="margin:0">' + invoiceHtml_(p, no, issued, logo ? 'data:image/png;base64,' + Utilities.base64Encode(logo.getBytes()) : '') + '</body></html>';
  const pdf = Utilities.newBlob(pdfHtml, 'text/html', 'invoice.html').getAs('application/pdf').setName('Clean Sweep ' + no + ' (' + (p.ref || '') + ').pdf');
  try { invoiceFolder_().createFile(pdf.copyBlob()); } catch (e) { console.warn('Could not save invoice to Drive: ' + e); }
  const intro = '<div style="max-width:640px;margin:0 auto;padding:20px 12px 0;font-family:Arial,Helvetica,sans-serif;color:#12203A;font-size:15px;line-height:1.55">' +
    '<p>Hi ' + esc_(first) + ',</p><p>Thanks for booking with Clean Sweep Rubbish Removals. You\'re booked in for <b>' + esc_(p.dateLabel || p.date) + '</b>, around <b>' + esc_(p.window) + '</b>, at ' +
    esc_([p.street, p.suburb].filter(String).join(', ')) + '. We\'ll be in touch 48 hours before to confirm.</p><p>Your invoice is below and attached as a PDF.</p></div>';
  const outro = '<div style="max-width:640px;margin:0 auto;padding:0 12px 24px;font-family:Arial,Helvetica,sans-serif;color:#12203A;font-size:15px;line-height:1.55"><p>Cheers,<br>Lucas<br>Clean Sweep Rubbish Removals · 0493 866 368</p></div>';
  const d = invoiceData_(p);
  const opts = {
    to: p.email, bcc: OWNER_EMAIL(), name: 'Clean Sweep Rubbish Removals', replyTo: OWNER_EMAIL(),
    subject: 'Booking confirmed + invoice ' + no + ' (' + (p.ref || '') + ')',
    body: 'Hi ' + first + ',\n\nThanks for booking with Clean Sweep Rubbish Removals. You\'re booked in for ' + (p.dateLabel || p.date || '') + ', around ' + (p.window || '') + '.\n\n' +
      'Invoice ' + no + ' is attached. Total: ' + money_(d.total) + (d.balance ? '. Due on collection day: ' + money_(d.balance) : '') + '.\n\n' +
      'Bookings cancelled less than 24 hours before the collection time are non-refundable. Call or text 0493 866 368 to change or cancel.\n\nCheers,\nLucas',
    htmlBody: intro + invoiceHtml_(p, no, issued, logo ? 'cid:logo' : '') + outro,
    attachments: [pdf],
  };
  if (logo) opts.inlineImages = { logo: logo };
  MailApp.sendEmail(opts);
}

// Runs every hour (see setup()). Sends a reminder to customers whose job is about 48 hours away.
function sendReminders() {
  const now = new Date();
  const from = new Date(now.getTime() + (REMINDER_HOURS_BEFORE - 1) * 3600e3);
  const to = new Date(now.getTime() + (REMINDER_HOURS_BEFORE + 1) * 3600e3);
  CalendarApp.getDefaultCalendar().getEvents(from, to).forEach(function (ev) {
    if (ev.getTag('cs_booking') !== 'yes' || ev.getTag('cs_reminded') === 'yes') return;
    const name = (ev.getTag('cs_name') || '').split(' ')[0] || 'there';
    const when = Utilities.formatDate(ev.getStartTime(), TZ, "EEEE d MMMM") + ', ' + (ev.getTag('cs_window') || Utilities.formatDate(ev.getStartTime(), TZ, 'h:mm a'));
    const where = ev.getLocation();
    const email = ev.getTag('cs_email'), phone = ev.getTag('cs_phone');
    if (email) {
      MailApp.sendEmail({
        to: email, name: 'Clean Sweep Rubbish Removals', replyTo: OWNER_EMAIL(),
        subject: 'Reminder: Clean Sweep pickup on ' + Utilities.formatDate(ev.getStartTime(), TZ, 'EEEE d MMMM'),
        body: 'Hi ' + name + ',\n\nJust a reminder that Clean Sweep is booked to collect your rubbish:\n\n' +
          'When: ' + when + '\nWhere: ' + where + '\n\n' +
          "Please leave the rubbish somewhere easy to get to, and let us know about any gates, pets or parking.\n\n" +
          'Need to change or cancel? Call or text 0493 866 368 now. Cancellations less than 24 hours before the collection time are non-refundable.\n\n' +
          'Cheers,\nLucas\nClean Sweep Rubbish Removals · 0493 866 368',
      });
    }
    if (phone) sms_(phone, 'Hi ' + name + ', reminder: Clean Sweep is collecting your rubbish ' + when + ' at ' + where +
      '. Changes or cancellations: 0493 866 368 (less than 24 hrs notice is non-refundable).');
    ev.setTag('cs_reminded', 'yes');
  });
}

// ---------- private customer list + monthly email ----------
function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('LIST_ID'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Clean Sweep customer list');
    const list = ss.getSheets()[0]; list.setName('Customers');
    list.appendRow(['Name', 'Email', 'Suburb', 'Joined', 'Last booking', 'Status', 'Unsubscribe code']);
    list.setFrozenRows(1); list.getRange('A1:G1').setFontWeight('bold');
    const m = ss.insertSheet('Monthly email');
    m.getRange('A1:B4').setValues([
      ['Send each month?', 'NO'],
      ['Subject', 'Spring clean? Clean Sweep is here to help'],
      ['Message', 'Hi {name},\n\nGot a shed, garage or backyard that needs clearing? Clean Sweep Rubbish Removals can take it all away, from old furniture and mattresses to green waste.\n\nBook online at cleansweeprubbishremoval.com or call/text Lucas on 0493 866 368.\n\nCheers,\nLucas'],
      ['How to use', 'Change the subject and message, then set B1 to YES. It sends on the 1st of each month at 9am to everyone with Status "subscribed". {name} becomes their first name.'],
    ]);
    m.setColumnWidth(1, 150); m.setColumnWidth(2, 620); m.getRange('B3').setWrap(true); m.getRange('A1:A4').setFontWeight('bold');
    props.setProperty('LIST_ID', ss.getId());
  }
  return ss;
}

function addSubscriber_(p) {
  const list = sheet_().getSheetByName('Customers');
  const email = String(p.email).trim().toLowerCase();
  const rows = list.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === email) { list.getRange(i + 1, 5).setValue(today); return; } // keep their existing status
  }
  list.appendRow([p.name || '', email, p.suburb || '', today, today, 'subscribed', Utilities.getUuid()]);
}

function unsubscribe_(code) {
  const list = sheet_().getSheetByName('Customers'), rows = list.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][6] === code) { if (rows[i][5] === 'unsubscribed') return false; list.getRange(i + 1, 6).setValue('unsubscribed'); return true; }
  }
  return false;
}

// Runs on the 1st of each month at 9am (see setup()).
function sendMonthlyEmail() {
  const ss = sheet_(), m = ss.getSheetByName('Monthly email');
  if (String(m.getRange('B1').getValue()).trim().toUpperCase() !== 'YES') return;
  const subject = m.getRange('B2').getValue(), message = String(m.getRange('B3').getValue());
  const base = ScriptApp.getService().getUrl();
  const rows = ss.getSheetByName('Customers').getDataRange().getValues();
  let sent = 0;
  for (let i = 1; i < rows.length; i++) {
    const [name, email, , , , status, code] = rows[i];
    if (status !== 'subscribed' || !email) continue;
    if (MailApp.getRemainingDailyQuota() < 2) { MailApp.sendEmail(OWNER_EMAIL(), 'Monthly email paused', 'Gmail\'s daily sending limit was reached after ' + sent + ' emails. The rest were not sent this month.'); break; }
    const first = String(name || '').split(' ')[0] || 'there';
    const unsub = base + '?unsub=' + encodeURIComponent(code);
    MailApp.sendEmail({
      to: email, name: 'Clean Sweep Rubbish Removals', replyTo: OWNER_EMAIL(), subject: subject,
      body: message.replace(/\{name\}/g, first) + '\n\n--\nClean Sweep Rubbish Removals · 0493 866 368 · ABN 55 989 268 862\n' +
        'You are getting this because you asked for offers when you booked with us.\nUnsubscribe: ' + unsub,
    });
    sent++;
  }
  MailApp.sendEmail(OWNER_EMAIL(), 'Monthly email sent to ' + sent + ' customers', 'Subject: ' + subject);
}

// ---------- income records (Stripe -> Google Sheet) ----------
const PAY_LABELS = { deposit: 'Booking deposit', q1: '¼ load', q2: '½ load', q3: '¾ load', full: 'Full load', sweep: 'The Big Sweep', bin: 'Bin collection' };

function incomeSheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('INCOME_ID'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Clean Sweep income');
    const pay = ss.getSheets()[0]; pay.setName('Payments');
    pay.appendRow(['Date', 'Booking ref', 'Customer', 'Email', 'For', 'Paid by', 'Amount', 'Stripe fee', 'You receive', 'Source', 'Stripe ID']);
    pay.setFrozenRows(1); pay.getRange('A1:K1').setFontWeight('bold');
    pay.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm'); pay.getRange('G:I').setNumberFormat('$#,##0.00');
    const t = ss.insertSheet('Totals');
    t.getRange('A1').setValue('By month').setFontWeight('bold');
    t.getRange('A2').setFormula('=IFERROR(QUERY(Payments!A2:I, "select year(A), month(A)+1, sum(G), sum(H), sum(I) where A is not null group by year(A), month(A)+1 order by year(A) desc, month(A)+1 desc label year(A) \'Year\', month(A)+1 \'Month\', sum(G) \'Income\', sum(H) \'Fees\', sum(I) \'You receive\'", 0), "No payments yet")');
    t.getRange('G1').setValue('Financial year (1 July – 30 June)').setFontWeight('bold');
    t.getRange('G2:J2').setValues([['Financial year', 'Income', 'Fees', 'You receive']]).setFontWeight('bold');
    for (let i = 0; i < 6; i++) {
      const r = 3 + i, start = 2025 + i;
      t.getRange(r, 7).setValue(start + '–' + String(start + 1).slice(2));
      ['G', 'H', 'I'].forEach((col, k) => t.getRange(r, 8 + k).setFormula('=SUMIFS(Payments!' + col + ':' + col + ', Payments!A:A, ">="&DATE(' + start + ',7,1), Payments!A:A, "<"&DATE(' + (start + 1) + ',7,1))'));
    }
    t.getRange('H3:J8').setNumberFormat('$#,##0.00');
    t.getRange('A12').setValue('Cash or bank transfer on the day? Add a row on the Payments tab yourself (Source: Cash) and it is included in the totals.');
    props.setProperty('INCOME_ID', ss.getId());
  }
  return ss;
}

function stripe_(path) {
  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/' + path, { headers: { Authorization: 'Bearer ' + STRIPE_READ_KEY }, muteHttpExceptions: true });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 300) throw new Error('Stripe: ' + (body.error && body.error.message));
  return body;
}

// Runs every hour (see setup()). Adds paid Stripe checkouts from the last 30 days that aren't recorded yet.
function syncStripePayments() {
  if (!STRIPE_READ_KEY) return;
  const pay = incomeSheet_().getSheetByName('Payments');
  const seen = new Set(pay.getRange(1, 11, Math.max(1, pay.getLastRow()), 1).getValues().map(r => r[0]));
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  let after = '', rows = [];
  for (let page = 0; page < 10; page++) {
    const list = stripe_('checkout/sessions?limit=100&created[gte]=' + since + (after ? '&starting_after=' + after : ''));
    list.data.forEach(cs => {
      if (cs.payment_status !== 'paid' || seen.has(cs.id)) return;
      let fee = '', net = '', method = '';
      try {
        const pi = stripe_('payment_intents/' + cs.payment_intent + '?expand[]=latest_charge.balance_transaction');
        const ch = pi.latest_charge || {}, bt = ch.balance_transaction || {};
        method = (ch.payment_method_details && ch.payment_method_details.type || '').replace('au_becs_debit', 'Direct debit').replace('card', 'Card');
        if (bt.fee != null) { fee = bt.fee / 100; net = bt.net / 100; }
      } catch (e) {}
      const d = cs.customer_details || {};
      rows.push([new Date(cs.created * 1000), cs.client_reference_id || '', d.name || '', d.email || '',
        PAY_LABELS[(cs.metadata || {}).site_key] || 'Payment', method, cs.amount_total / 100, fee, net, 'Stripe', cs.id]);
    });
    if (!list.has_more || !list.data.length) break;
    after = list.data[list.data.length - 1].id;
  }
  if (!rows.length) return;
  rows.sort((a, b) => a[0] - b[0]);
  pay.getRange(pay.getLastRow() + 1, 1, rows.length, 11).setValues(rows);
}

// ---------- texts via ClickSend ----------
function sms_(to, body) {
  if (!to || !CLICKSEND_USERNAME || !CLICKSEND_API_KEY) return;
  let num = String(to).replace(/[^\d+]/g, '');
  if (num.startsWith('0')) num = '+61' + num.slice(1);
  if (!num.startsWith('+')) num = '+' + num;
  try {
    UrlFetchApp.fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(CLICKSEND_USERNAME + ':' + CLICKSEND_API_KEY) },
      payload: JSON.stringify({ messages: [{ source: 'clean-sweep-website', to: num, body: body.slice(0, 600) }] }),
    });
  } catch (err) { console.warn('SMS failed: ' + err); }
}

// '10am' .. '4pm' from the website -> a one-hour calendar slot, e.g. [15, 16] for 3pm
function hourSlot_(w) {
  const m = String(w || '').match(/(\d{1,2})\s*(am|pm)/i);
  if (!m) return [10, 11];
  let h = Number(m[1]) % 12; if (m[2].toLowerCase() === 'pm') h += 12;
  return [h, h + 1];
}

function shortWindow_(w) { return String(w || '').replace(/.*\((.*)\)/, '$1'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- run these from the editor ----------
// Run ONCE after pasting this in: turns on the hourly 48-hour reminder check.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendMonthlyEmail') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendMonthlyEmail').timeBased().onMonthDay(1).atHour(9).inTimezone(TZ).create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncStripePayments') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncStripePayments').timeBased().everyHours(1).create();
  const list = sheet_(), income = incomeSheet_();
  invoiceFolder_();
  MailApp.sendEmail(OWNER_EMAIL(), 'Clean Sweep bookings are connected', 'Bookings from your website will now go into your Google Calendar, customers get an invoice by email, and 48-hour reminders are switched on.\n\n' +
    'Your private customer list (for the monthly email) is here: ' + list.getUrl() + '\n\n' +
    'Your income records are here: ' + income.getUrl() + (STRIPE_READ_KEY ? '' : '\n(Add your Stripe read-only key at the top of the script to start filling it in.)'));
}

// Optional check: adds a test booking for 2 days from now and sends you the emails. Delete the event after.
function testBooking() {
  const t = new Date(Date.now() + 48 * 3600e3);
  doPost({ parameter: {
    ref: 'CS-TEST', name: 'Test Customer', phone: '', email: OWNER_EMAIL(),
    street: '1 Test St', suburb: 'Parramatta', postcode: '2150', size: '½ load', job: '½ load ($950)',
    date: Utilities.formatDate(t, TZ, 'yyyy-MM-dd'), dateLabel: Utilities.formatDate(t, TZ, 'EEEE d MMMM'),
    window: '10am', total: '$1,070', payChoice: 'Deposit', payNow: '$100', notes: 'Test booking, delete me',
    lines: JSON.stringify([{ d: '½ trailer load (about 8 m³)', q: 1, u: 950 }, { d: 'Mattress (extra)', q: 1, u: 120 }]),
  } });
}
