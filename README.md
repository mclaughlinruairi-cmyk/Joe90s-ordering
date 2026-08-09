# Joe 90's Chip Shop — online ordering site

A branded ordering site with real Stripe payments. Zero npm dependencies —
just Node's built-ins — so there's nothing to install, nothing to break on
`npm install`, and it deploys anywhere that runs Node.

## What's in here

```
joe90s-site/
  server.js          — the whole backend (static files + API + Stripe)
  package.json
  .env.example        — copy to .env for local testing
  data/
    menu.json          — edit this to change items/prices, no code changes needed
    orders.json         — created automatically once real orders come in
  public/
    index.html          — the ordering page
    success.html         — order confirmation page
    app.js               — cart logic, calls the API
    styles.css
    images/               — drop logo.png and hero.jpg in here (see Branding below)
```

## 1. Run it locally

You need Node 18 or newer installed (check with `node -v`).

```bash
cd joe90s-site
cp .env.example .env
npm start
```

Open http://localhost:3000 — the menu and cart will work immediately. The
"Pay & place order" button won't work yet because `.env` has placeholder
Stripe keys — that's expected, see step 2.

## 2. Get your Stripe keys

1. Create a free account at https://dashboard.stripe.com/register (you'll
   do this yourself — nobody else can create it on your behalf).
2. Once logged in, make sure you're in **Test mode** (toggle top-right of
   the dashboard).
3. Go to **Developers → API keys** and copy the **Secret key**
   (`sk_test_...`).
4. Paste it into `.env` as `STRIPE_SECRET_KEY`.
5. Restart the server (`npm start`) and try a test order using Stripe's
   test card: card number `4242 4242 4242 4242`, any future expiry date,
   any 3-digit CVC, any postcode. You should land on the confirmation page
   with a mock printed receipt.

## 3. Set up the webhook (so paid orders actually get recorded)

Right now, the checkout flow works end-to-end for the customer, but the
server only *knows* an order was paid when Stripe calls its webhook. Two
ways to test this:

**Locally, using the Stripe CLI** (optional, only needed if you want to see
orders land in `data/orders.json` while testing on your own machine):

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

This prints a `whsec_...` value — put that in `.env` as
`STRIPE_WEBHOOK_SECRET`.

**In production**, you'll add the webhook in the Stripe dashboard once the
site is deployed (step 5 below) — Stripe needs a real public URL to send
webhooks to, so this step happens after deployment, not before.

## 4. Push to GitHub

```bash
cd joe90s-site
git init
git add .
git commit -m "Joe 90's ordering site"
```

Then create a new empty repo on GitHub (no README/license, you already have
files), and follow GitHub's "push an existing repository" instructions it
shows you — something like:

```bash
git remote add origin https://github.com/<your-username>/joe90s-ordering.git
git branch -M main
git push -u origin main
```

`.env` is already in `.gitignore` so your real Stripe key never gets
committed.

## 5. Deploy (Render — free to start, recommended)

1. Go to https://render.com and sign in with your GitHub account.
2. **New → Web Service**, pick the `joe90s-ordering` repo.
3. Settings:
   - Build command: (leave blank — nothing to build)
   - Start command: `npm start`
4. Add environment variables (Render → your service → Environment):
   - `STRIPE_SECRET_KEY` = your real secret key
   - `PUBLIC_BASE_URL` = the URL Render gives you, e.g.
     `https://joe90s-ordering.onrender.com` (or your custom domain once
     connected)
   - Leave `STRIPE_WEBHOOK_SECRET` empty for now.
5. Deploy. Render gives you a live URL.
6. Back in the Stripe dashboard → **Developers → Webhooks → Add endpoint**:
   - URL: `https://<your-render-url>/api/webhook`
   - Event to send: `checkout.session.completed`
   - Copy the **Signing secret** it gives you, add it to Render as
     `STRIPE_WEBHOOK_SECRET`, redeploy.

*Note: Render's free tier sleeps after 15 minutes of no traffic, so the
first order after a quiet spell will feel slow (~30s cold start). Fine for
testing and the pitch demo; upgrade to Render's paid tier (~$7/month) once
this is a live shop taking real orders, so it never sleeps.*

Railway (railway.app) works the same way if you'd rather use that — connect
the GitHub repo, set the same environment variables, deploy.

## 6. Custom domain

Buy a domain (Namecheap, GoDaddy, etc. — roughly £10-15/year) and point it
at Render following their "Custom Domains" docs for your service. Update
`PUBLIC_BASE_URL` to match once it's live.

## 7. Branding — logo & photos

Drop these files in and the placeholders disappear automatically:

- `public/images/logo.png` — square logo, shown in a circle at the top
- `public/images/hero.jpg` — a shopfront or food photo, shown behind the dark
  overlay in the header banner (roughly 1200×400px works well). Optional —
  the header looks intentional even without one, thanks to the dark
  gradient background.

The logo already in `public/images/logo.png` was extracted from Joe 90's own
posted menu. Swap it for a proper vector/high-res logo file if the shop has
one.

Note: this site is set up for **collection only** (no delivery), matching
how Joe 90's currently operates. If that changes, the fulfilment toggle
would need to be re-added to `public/menu.html` and `public/app.js`.

## Site structure (updated)

- `public/index.html` — the home/marketing page: hero, food gallery, About
  Us, reviews, and contact (with a Google Maps embed and Facebook link).
- `public/menu.html` — the actual ordering page (menu, cart, checkout).
  The "Order Now" button on the home page links here.
- Food photos in `public/images/food/` were cropped from the menu photo
  you sent — fine for now, but real photography would look sharper. Swap
  them out any time; same filenames, same aspect ratio.
- Reviews on the home page are genuine short excerpts from Joe 90's
  Tripadvisor page, each attributed to the reviewer. Update these if you'd
  rather feature different or more recent ones.
- Opening hours are deliberately not stated precisely on the site — the
  sources I checked disagreed with each other, so it links to the shop's
  Facebook page instead rather than risk publishing wrong hours. Worth
  confirming the real hours with the shop and adding them directly if you
  want that displayed.
- Address corrected to **16 Main Street** (Tripadvisor's listing, which
  includes the postcode BT94 1GJ) — earlier drafts had 14, which appears
  to be wrong.

## Service fee (covers Stripe's cut)

`server.js` automatically adds a "Service & card fee" line item to every
order, calculated so the shop always receives the full menu subtotal after
Stripe takes its cut — the customer effectively pays Stripe's processing
fee instead of the shop absorbing it. This uses Stripe's standard UK
domestic card rate (1.5% + 20p) as of 2026; see `computeServiceFeePence()`
in `server.js` if that rate ever changes. Non-UK or premium/corporate cards
cost Stripe slightly more than this, so on those specific transactions the
shop nets a few pence less than the full subtotal — not worth solving for
up front since Stripe doesn't tell you the card type until after charging.

No code changes needed — the page checks for these files and falls back to
a plain placeholder if they're missing.

## 8. Going live for real

Before taking real money:

- Switch Stripe from Test mode to Live mode, complete Stripe's business
  verification (bank details, business info) — this is done by the shop
  owner in their own Stripe account, not by you on their behalf.
- Swap `STRIPE_SECRET_KEY` for the **live** secret key, and re-add the
  webhook endpoint under Live mode (test and live webhooks are separate).
- Decide who legally owns the Stripe account — usually it should be the
  takeaway's own Stripe account (so money goes straight to them), with you
  paid separately via your flat monthly fee, not by routing their money
  through your account.

## 9. Kitchen printer (not wired up yet)

`server.js` has a clearly marked spot in the webhook handler where a print
job would be sent once payment is confirmed. It's left as a stub because it
needs to match whatever printer the shop actually has — most modern thermal
printers support Star CloudPRNT or Epson's ePOS Print API, which both work
by POSTing the order to the printer's cloud endpoint. Once you know the
model, that's a small, self-contained addition.
