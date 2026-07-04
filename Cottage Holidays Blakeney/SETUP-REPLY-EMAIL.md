# Reply-by-email setup

Reply to a **"New website message"** notification straight from your inbox and
your reply reaches the guest **both** ways — in the website chat *and* by email.
It's optional; until you set it up, notifications behave exactly as before.

## How it works

1. A guest messages you on the site → you get the usual owner email, but now its
   **Reply-To** points at a dedicated inbound mailbox, tagged with the
   conversation.
2. You hit **Reply**, type, send.
3. Your mail provider's *inbound route* POSTs the reply to `inbound-mail.php`,
   which matches it to the conversation, posts it into the website chat, and
   emails it to the guest.

Only replies **from one of your owner-notification addresses** are accepted
(Settings → Notifications), and the webhook needs the secret — so nobody else
can inject messages.

## One-time setup (~10 minutes, free)

1. **Pick an inbound address**, e.g. `reply@yourdomain.co.uk`.

2. **In `config.php`** set:
   ```php
   define('REPLY_INBOX', 'reply@yourdomain.co.uk');
   define('INBOUND_SECRET', 'a-long-random-string');   // not your APP_SECRET
   ```

3. **Create a free inbound-mail route** for that address that forwards to a
   webhook (any one of these works):
   - **ImprovMX** (free) — add your domain, create an alias `reply@` with a
     *webhook* target of
     `https://yourdomain.co.uk/inbound-mail.php?key=YOUR_INBOUND_SECRET`.
   - **Mailgun Routes** — match `reply@yourdomain.co.uk`, action
     `forward("https://yourdomain.co.uk/inbound-mail.php?key=YOUR_INBOUND_SECRET")`.
   - **CloudMailin** — point the address at the same URL (it POSTs the parsed mail).

4. **Test:** message yourself from the site's chat, reply to the email you get,
   then check the reply shows in the back-office thread and arrives in the guest
   inbox. Settings → Health check shows a green **Reply-by-email** row when
   `REPLY_INBOX` is set.

## Notes

- Providers post different field names; `inbound-mail.php` accepts the common
  ones (Mailgun `stripped-text`, SendGrid/CloudMailin `text`, plus raw MIME).
- It keeps only what you typed above the quoted history / signature.
- Guests can reply to *their* email too — it routes back into the same thread.
