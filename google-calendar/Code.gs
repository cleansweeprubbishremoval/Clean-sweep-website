/**
 * Clean Sweep Rubbish Removals: website bookings -> Google Calendar
 *
 * Every booking made on the website is added to your Google Calendar
 * with the customer's name, best contact number and address, and you
 * get an email with the full details.
 *
 * Setup (about 5 minutes, see SETUP.md):
 *  1. Go to script.google.com while signed in to the Google account whose
 *     calendar you want bookings in, and click "New project".
 *  2. Delete what's there, paste this whole file in, and click Save.
 *  3. Click Deploy > New deployment > type "Web app".
 *     Execute as: Me. Who has access: Anyone. Click Deploy and allow access.
 *  4. Copy the Web app URL and send it to Claude (or paste it into
 *     CALENDAR_URL in index.html).
 */

// Booking emails go to the Google account that runs this script.
const NOTIFY_EMAIL = Session.getEffectiveUser().getEmail();

// Arrival windows on the website -> start and end hours (24h, Sydney time)
const WINDOWS = {
  'Morning (7–11am)': [7, 11],
  'Midday (11am–2pm)': [11, 14],
  'Afternoon (2–5pm)': [14, 17],
};

function doPost(e) {
  const p = (e && e.parameter) || {};
  try {
    const event = addBooking_(p);
    notify_(p);
    return json_({ ok: true, id: event.getId() });
  } catch (err) {
    MailApp.sendEmail(NOTIFY_EMAIL, 'Website booking needs checking: ' + (p.name || 'unknown'),
      'A booking came in but could not be added to your calendar.\n\nError: ' + err + '\n\n' + details_(p));
    return json_({ ok: false, error: String(err) });
  }
}

// Visiting the web app URL in a browser shows this, so you can check it's live.
function doGet() {
  return ContentService.createTextOutput('Clean Sweep booking calendar is running.');
}

function addBooking_(p) {
  const [y, m, d] = String(p.date || '').split('-').map(Number);
  if (!y || !m || !d) throw new Error('Missing or invalid date: ' + p.date);
  const hours = WINDOWS[p.window] || [7, 11];
  const tz = 'Australia/Sydney';
  const start = Utilities.parseDate(Utilities.formatString('%04d-%02d-%02d %02d:00', y, m, d, hours[0]), tz, 'yyyy-MM-dd HH:mm');
  const end = Utilities.parseDate(Utilities.formatString('%04d-%02d-%02d %02d:00', y, m, d, hours[1]), tz, 'yyyy-MM-dd HH:mm');
  const address = [p.street, p.suburb, 'NSW', p.postcode].filter(String).join(' ');
  const title = 'Clean Sweep: ' + (p.size || 'Pickup') + ' – ' + (p.name || 'Customer') + ' – ' + (p.phone || '');
  const cal = CalendarApp.getDefaultCalendar();
  const ev = cal.createEvent(title, start, end, { location: address, description: details_(p) });
  ev.setColor(CalendarApp.EventColor.GREEN);
  ev.addPopupReminder(24 * 60);
  return ev;
}

function details_(p) {
  return [
    'Booking ' + (p.ref || ''),
    '',
    'Name: ' + (p.name || ''),
    'Phone: ' + (p.phone || ''),
    'Email: ' + (p.email || ''),
    'Address: ' + [p.street, p.suburb, p.postcode].filter(String).join(', '),
    '',
    'Job: ' + (p.job || ''),
    p.extras ? 'Extras: ' + p.extras : '',
    'When: ' + (p.dateLabel || p.date || '') + ', ' + (p.window || ''),
    'Estimated total: ' + (p.total || ''),
    'Payment chosen: ' + (p.payChoice || '') + ' (' + (p.payNow || '') + ' online). Check Stripe for booking ' + (p.ref || '') + '.',
    p.items ? 'Items: ' + p.items : '',
    p.notes ? 'Notes: ' + p.notes : '',
  ].filter(function (l) { return l !== ''; }).join('\n');
}

function notify_(p) {
  MailApp.sendEmail(NOTIFY_EMAIL,
    'New booking: ' + (p.name || '') + ', ' + (p.suburb || '') + ' – ' + (p.dateLabel || p.date || ''),
    details_(p) + '\n\nIt has been added to your Google Calendar.');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (select testBooking, click Run) to check
// everything works. It adds a test booking for tomorrow; delete it after.
function testBooking() {
  const t = new Date(Date.now() + 24 * 3600 * 1000);
  doPost({ parameter: {
    ref: 'CS-TEST', name: 'Test Customer', phone: '0400 000 000', email: NOTIFY_EMAIL,
    street: '1 Test St', suburb: 'Parramatta', postcode: '2150', size: '½ load', job: '½ load ($950)',
    date: Utilities.formatDate(t, 'Australia/Sydney', 'yyyy-MM-dd'), dateLabel: 'Tomorrow',
    window: 'Morning (7–11am)', total: '$950', payChoice: 'Deposit', payNow: '$100', notes: 'Test booking, delete me',
  } });
}
