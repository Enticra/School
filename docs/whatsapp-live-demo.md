# Live WhatsApp in a pitch demo

During a pitch, the client's phone gets a real WhatsApp message from the "school" when a teacher marks a child absent. The ticks in the portal then change from Sent to Delivered to Read as the phone gets the message and opens it.

## How it works

- The sample parents have made-up numbers, so they are never messaged.
- You link up to 5 real phones to sample parents, for example your phone and the client's. Messages meant for those parents go to the real phones. Every other message stays simulated.
- Messages go through Meta's WhatsApp Cloud API, using Meta's free test number.
- WhatsApp reports delivery back to the portal (Delivered, Read or Failed). The Parent messages page then updates on its own.
- Only the principal can link phones. The portal only ever shows the last 4 digits of a linked number.

The shareable demo link always stays simulated. Live messages need the full portal running on a server, as described below.

## 1. Set up Meta (about 15 minutes, free)

1. **Create the app.** Go to developers.facebook.com, sign in with a Facebook account, and choose **My Apps → Create app**.
   - Pick the **Business** type.
   - When asked which products to add, choose **WhatsApp**.
   - Meta creates a test business number for you.
2. **Copy two values.** Open **WhatsApp → API Setup** and copy:
   - the **Phone number ID**;
   - the **temporary access token**, which lasts 24 hours.
     - For a token that doesn't expire: in Meta Business Settings, create a **System user**, give it the app with the `whatsapp_business_messaging` permission, and generate a token.
3. **Add the receiving phones.** Under **To**, choose **Manage phone number list** and add each phone that will get messages. You can add up to 5. Each phone confirms with a code that WhatsApp sends to it.
4. **Copy the app secret.** Open **App settings → Basic** and copy the **App secret**.
5. **Choose a verify token.** This can be any phrase you like, for example `enticra-demo-2026`. You use it twice: in your settings file in step 2, and in Meta's webhook settings in step 3.

## 2. Run the portal on a server

Copy `.env.example` to `.env` and fill in the values from Meta:

```
TZ=Asia/Kolkata
DEMO_LOGIN=1
WHATSAPP_TOKEN=...            # the access token
WHATSAPP_PHONE_NUMBER_ID=...  # the phone number ID
WHATSAPP_APP_SECRET=...       # the app secret
WHATSAPP_VERIFY_TOKEN=...     # the phrase you chose
```

Never share or commit the `.env` file, because it holds the keys.

Meta has to reach the portal over the internet using https. There are two ways to do that.

**A. From your laptop for a pitch (quickest).** You need Node.js 22 installed. Run:

```bash
npm install
npm start                                          # portal on http://localhost:8787
cloudflared tunnel --url http://localhost:8787     # in a second window; prints an https://….trycloudflare.com address
```

The tunnel address changes every time you start it. When it does, update the webhook URL in Meta (step 3).

**B. On a hosting plan (a fixed address).** Use any Node.js host, such as Hostinger (Business or Cloud plans with Node.js), Render or Railway.
- Start command: `npm start`.
- Add the same settings as environment variables.
- Use a persistent disk for `DATA_DIR` so linked phones and messages survive a restart.

When the server starts, it prints `live WhatsApp: text`. That means the settings were read.

## 3. Connect Meta's webhook

In Meta, open **WhatsApp → Configuration → Webhook → Edit** and enter:

- **Callback URL:** `https://YOUR-ADDRESS/api/whatsapp/webhook`
- **Verify token:** the phrase you chose.

Then click **Verify and save**. Under **Webhook fields**, subscribe to **messages**. This one subscription brings in both the delivery ticks and messages that phones send to the school number.

## 4. Link the phones in the portal

1. Sign in as the principal (Mrs. S. Sujatha) and open **Parent messages**. A **Live WhatsApp** card appears there.
2. Click **Link a phone**. Choose a sample parent, for example **Mrs. P. Priya, parent of Arun Kumar P**. Enter the real number with its country code, and tick that the phone's owner has agreed.
3. On that phone, send **"Hi"** to the Meta test number. WhatsApp only lets a business send a free-form message after the person has messaged it in the last 24 hours. The card shows **Ready** once the "Hi" arrives.
4. Click **Send a test**. The phone should get a test message within a few seconds.

## 5. The pitch moment

1. Sign in as the teacher **Mrs. R. Lakshmi**. Open **Attendance** for **10-A**, mark **Arun Kumar P** absent and save.
2. The client's phone buzzes with the absence message. It is in the parent's chosen language; Mrs. P. Priya's is Tamil.
3. Sign in as the principal and open **Parent messages**. Arun's row carries a **Live** tag. Its tick changes to **Delivered**, and then to **Read** as soon as the client opens the message.

Posting homework or publishing test marks for 10-A also sends the linked parents a real message.

Quiet hours still apply, from 9 pm to 7 am for the sample school. A message created during quiet hours waits until 7 am and then goes out by itself. To demo in the evening, change the quiet hours in **Settings** first.

## After the pitch

- Click **Unlink** for each phone. Those parents' messages go back to being simulated.
- Linked numbers are stored only on the server, in `data/whatsapp-routes.json`.

## For a real school later

For a real school, the setup changes as follows:
- **Sender:** the school's own verified WhatsApp number replaces the test number, through Meta directly or a provider such as Gupshup or Interakt.
- **Templates:** each message type (absent, homework, marks) needs a Meta-approved **Utility** template. A template is needed because a school messages parents first, often outside the 24-hour window.
  - The server already supports one general template. Set `WHATSAPP_TEMPLATE` to its name. The template body should be text with one variable, for example: `Message from your school: {{1}}`.
- **Cost:** Meta charges for each message, roughly ₹0.1 to ₹0.8 depending on the category.

## If something goes wrong

The **Status** column on Parent messages explains each failure in plain words:

| What you see | What to do |
|---|---|
| More than 24 hours since this phone messaged the school number | Send "Hi" from the phone again. |
| This phone is not on the allowed list | Add the phone in Meta under **API Setup → To**. |
| The access token has expired | Create a new token, put it in `.env` and restart the server. |
| The ticks stay at Sent | The webhook isn't reaching the server. Check the callback URL, and that **messages** is subscribed. |
