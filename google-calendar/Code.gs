/**
 * Clean Sweep Rubbish Removals: website bookings -> Google Calendar, emails and texts
 *
 * What it does for every booking made on the website:
 *   1. Adds it to your Google Calendar in the customer's arrival window, with their
 *      name, best contact number and pickup address.
 *   2. Emails you the full booking. Texts you too, once SMS is switched on (below).
 *   3. Sends the customer a booking confirmation (email, or text if they only gave a phone).
 *   4. 48 hours before the job, sends the customer a reminder (email and/or text).
 *   5. Customers who tick "Email me offers" go on a private Google Sheet in your Drive
 *      ("Clean Sweep customer list"). On the 1st of each month at 9am they get your
 *      monthly email, with a working unsubscribe link (required by the Spam Act).
 *
 * Setup: see SETUP.md. Do it while signed in to cleansweeprubbishremoval@gmail.com.
 */

// ---------------- settings ----------------
const OWNER_MOBILE = '0493866368';            // you get a text for every new booking (needs SMS below)
const SEND_CUSTOMER_CONFIRMATION = true;      // confirmation as soon as they book
const REMINDER_HOURS_BEFORE = 48;

// Text messages: Google can't send texts by itself, so this uses ClickSend
// (an Australian SMS service, pay as you go, a few cents per text).
// Make a free account at clicksend.com, then paste your username and API key here.
// Leave blank to skip texts; emails still work.
const CLICKSEND_USERNAME = '';
const CLICKSEND_API_KEY = '';
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
  const h = WINDOWS[p.window] || [7, 11];
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
      ['Message', 'Hi {name},\n\nGot a shed, garage or backyard that needs clearing? Clean Sweep Rubbish Removals can take it all away, from old furniture and mattresses to green waste.\n\nBook online at cleansweeprubbishremovals.netlify.app or call/text Lucas on 0493 866 368.\n\nCheers,\nLucas'],
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

function shortWindow_(w) { return String(w || '').replace(/.*\((.*)\)/, '$1'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- run these from the editor ----------
// Run ONCE after pasting this in: turns on the hourly 48-hour reminder check.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendMonthlyEmail') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendMonthlyEmail').timeBased().onMonthDay(1).atHour(9).inTimezone(TZ).create();
  const list = sheet_();
  MailApp.sendEmail(OWNER_EMAIL(), 'Clean Sweep bookings are connected', 'Bookings from your website will now go into your Google Calendar, and 48-hour reminders are switched on.\n\n' +
    'Your private customer list (for the monthly email) is here: ' + list.getUrl());
}

// Optional check: adds a test booking for 2 days from now and sends you the emails. Delete the event after.
function testBooking() {
  const t = new Date(Date.now() + 48 * 3600e3);
  doPost({ parameter: {
    ref: 'CS-TEST', name: 'Test Customer', phone: '', email: OWNER_EMAIL(),
    street: '1 Test St', suburb: 'Parramatta', postcode: '2150', size: '½ load', job: '½ load ($950)',
    date: Utilities.formatDate(t, TZ, 'yyyy-MM-dd'), dateLabel: Utilities.formatDate(t, TZ, 'EEEE d MMMM'),
    window: 'Morning (7–11am)', total: '$950', payChoice: 'Deposit', payNow: '$100', notes: 'Test booking, delete me',
  } });
}
