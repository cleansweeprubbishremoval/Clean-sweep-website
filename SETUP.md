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

## 2. Google Calendar (about 5 minutes)

1. Go to **script.google.com**, signed in to the Google account whose calendar you use. Click **New project**.
2. Delete what's there, paste in everything from `google-calendar/Code.gs`, and click **Save**.
3. Optional check: pick `testBooking` in the menu at the top and click **Run**. Allow access when asked. A test booking for tomorrow should appear in your calendar (delete it after).
4. Click **Deploy → New deployment**, click the cog and choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, allow access, and copy the **Web app URL**.
6. Send that URL to Claude, or paste it into `CALENDAR_URL` in `index.html`.

Each booking then appears in your calendar in the customer's arrival window, with their name and phone number in the title, the address as the location, and every detail in the notes. You also get an email for each one.
