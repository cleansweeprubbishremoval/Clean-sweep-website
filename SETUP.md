# Turning on online bookings

Two things to set up: **Stripe** (to take payments) and **Google Calendar** (so bookings land in your calendar). Do them on a computer if you can.

## 1. Stripe payments (about 20 minutes)

1. Sign up at **stripe.com** and choose Australia. Verify your business with your ABN (55 989 268 862).
2. Add your business bank account (BSB and account number) for payouts under **Settings → Business → Bank accounts**. Stripe pays your money into this account.
3. Under **Settings → Payments → Payment methods**, turn on **Cards**, **Apple Pay**, **Google Pay** and **BECS Direct Debit**. BECS direct debit takes about 3 business days to clear.
4. Go to **Payment Links → New** and make these 7 links, one at a time:

   | Name | Price |
   |---|---|
   | Booking deposit | $100 |
   | ¼ load | $550 |
   | ½ load | $950 |
   | ¾ load | $1,350 |
   | Full load | $1,750 |
   | The Big Sweep | $400 |
   | Bin collection | $40 |

   For each one, under **After payment**, choose **Don't show confirmation page** and enter
   `https://cleansweeprubbishremoval.com/?paid=1`
5. Send all 7 links to Claude, or paste them into `STRIPE_LINKS` in `index.html`.

Every payment shows the customer's booking number (like `CS-261103-AB12`) in Stripe under **Client reference ID**, so you can match payments to bookings.

## 2. Google Calendar, emails, texts and 48-hour reminders (about 10 minutes)

Do this signed in to **cleansweeprubbishremoval@gmail.com**. Bookings go into that account's calendar and emails come from it.

1. Go to **script.google.com** and click **New project**.
2. Delete what's there, paste in everything from `google-calendar/Code.gs`, and click **Save**.
3. In the menu at the top, pick **setup** and click **Run**. Allow access when Google asks (click *Advanced → Go to project* if it warns you). This switches on the hourly check that sends 48-hour reminders, and emails you to say it's connected.
4. Optional check: pick **testBooking** and click **Run**. A test booking appears in your calendar and you get the emails. Delete the test event after.
5. Click **Deploy → New deployment**, click the cog and choose **Web app**. Set *Execute as*: **Me**, and *Who has access*: **Anyone**. Click **Deploy** and copy the **Web app URL**.
6. Send that URL to Claude, or paste it into `CALENDAR_URL` in `index.html`.

### Text messages (optional)
Google can't send texts by itself. To get a text on 0493 866 368 for every booking, and to text customers who only gave a phone number:
1. Make an account at **clicksend.com** (Australian, pay as you go, a few cents per text) and add some credit.
2. Copy your **username** and **API key** from the ClickSend dashboard.
3. Paste them into `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` at the top of the script, click **Save**, then **Deploy → Manage deployments → Edit → New version → Deploy**.

Without ClickSend, everything else still works: calendar, your booking emails, and customer emails. Free tip: turn on Gmail and Google Calendar notifications on your phone to get an alert the moment a booking lands.

### What customers get
- A confirmation as soon as they book (email, or a text if they only gave a phone number).
- A reminder 48 hours before their collection (email and/or text).
- Both mention that cancellations less than 24 hours before collection are non-refundable.

## 3. Your private customer list and monthly email

When a customer ticks **"Email me Clean Sweep offers"** while booking (and gives an email), they're added to a Google Sheet called **Clean Sweep customer list** in your Google Drive. Only you can see it. Running **setup** emails you its link.

- **Customers** tab: name, email, suburb, date joined, last booking, and status (`subscribed` or `unsubscribed`).
- **Monthly email** tab: write your subject and message there, then change **B1** from `NO` to `YES`. It sends at 9am on the 1st of every month to everyone marked `subscribed`. `{name}` becomes each customer's first name.
- Every email includes your business name, phone and ABN, plus an unsubscribe link. Anyone who clicks it is marked `unsubscribed` automatically, as Australia's Spam Act requires. Don't add people who didn't tick the box.
- Gmail can send to about 100 people a day this way. When your list gets bigger than that, move to a mailing service like Mailchimp (export the sheet to CSV).

If you'd already set up the script, paste in the new `Code.gs`, click **Save**, run **setup** again, then **Deploy → Manage deployments → Edit → New version → Deploy**.
