# Optional SMS nudges (balance-due + pre-arrival)

The site can text guests **transactional** updates about their own booking — a
balance-due reminder and a "your stay starts soon" nudge — alongside the emails.
It's **off by default** and only ever texts guests who ticked *"Text me booking
updates"* on their enquiry. No marketing, ever.

## What guests see
On the enquiry form (once they've entered a phone number) there's a checkbox:

> ☐ Text me booking updates (balance reminders & arrival info)

That consent is stored on the enquiry and carried onto the booking when you
approve it. Only then can that guest be texted.

## Turn it on (Twilio)
1. Create a [Twilio](https://www.twilio.com/) account and buy a UK number
   (or use a trial number while testing).
2. From the Twilio console copy your **Account SID**, **Auth Token**, and the
   **number** (in E.164, e.g. `+447700900000`).
3. In your live `config.php` set:

```php
define('SMS_ENABLED', true);
define('TWILIO_SID', 'AC…');            // Account SID
define('TWILIO_TOKEN', 'your-token');   // Auth Token — keep secret
define('TWILIO_FROM', '+447700900000'); // your Twilio number
```

4. Run the migration (`migrate.php`, or Settings → System check → Run
   migrations) so the `sms_opt_in` columns exist.

That's it. The daily crons (`payments-due.php`, `pre-arrival.php`) already send
the email; when SMS is configured they also text any guest who opted in and left
a number. Nothing is sent to guests who didn't opt in, and if a number is
malformed it's simply skipped.

## Notes
- Texts are **service messages** about the guest's own booking. Key/lock codes
  are never put in a text — the SMS only says "check your email".
- Numbers are normalised to E.164 for the UK (`07…` → `+447…`). International
  numbers must already be in `+` form.
- Each SMS costs a few pence via Twilio; you only pay for guests who opted in.
- To pause SMS without losing config, set `SMS_ENABLED` back to `false`.
