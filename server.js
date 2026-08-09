// Joe 90's Chip Shop — ordering site backend
//
// Deliberately zero npm dependencies. Uses Node's built-in http, crypto and
// fetch (Node 18+) to talk to Stripe's plain REST API directly instead of
// the `stripe` SDK. This keeps the project trivial to deploy anywhere that
// runs Node (Render, Railway, Fly.io, a VPS) with no install step to break.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------
// tiny .env loader (no dotenv dependency)
// ---------------------------------------------------------------------
function loadEnv(file = '.env') {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CURRENCY = 'gbp';

// Stripe's standard UK domestic card rate (1.5% + 20p) as of 2026. This is
// added as a visible "Service & card fee" line item so the shop always
// nets the full menu subtotal — the customer covers the processing cost
// instead of the shop absorbing it. See computeServiceFeePence() below for
// the gross-up math. If Stripe's rates change, update these two constants.
const STRIPE_RATE = 0.015;
const STRIPE_FIXED_PENCE = 20;

// Given a subtotal in pence, returns the service fee (in pence) that,
// when added to the subtotal and charged as one total, leaves the shop
// with exactly the subtotal after Stripe deducts its cut from the total.
function computeServiceFeePence(subtotalPence) {
  const totalPence = Math.ceil((subtotalPence + STRIPE_FIXED_PENCE) / (1 - STRIPE_RATE));
  return totalPence - subtotalPence;
}

// ---------------------------------------------------------------------
// menu (edit data/menu.json to change prices/items — no code change needed)
// ---------------------------------------------------------------------
const MENU = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'menu.json'), 'utf8'));
const ITEM_INDEX = {};
for (const cat of Object.keys(MENU)) {
  for (const item of MENU[cat]) ITEM_INDEX[item.n] = item;
}

// ---------------------------------------------------------------------
// orders log (flat JSON file — fine for one shop's volume; swap for a real
// database later if this becomes a multi-client product)
// ---------------------------------------------------------------------
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
function loadOrders() {
  if (!fs.existsSync(ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; }
}
function saveOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------
// Stripe REST helpers (no SDK — direct calls to api.stripe.com)
// ---------------------------------------------------------------------
async function stripePost(endpoint, formParams) {
  const body = new URLSearchParams(formParams).toString();
  const resp = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.error?.message || 'Stripe request failed');
    err.stripe = data;
    throw err;
  }
  return data;
}

async function stripeGet(endpoint) {
  const resp = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.error?.message || 'Stripe request failed');
    err.stripe = data;
    throw err;
  }
  return data;
}

function flattenLineItems(cartLines) {
  const params = {};
  cartLines.forEach((line, i) => {
    params[`line_items[${i}][price_data][currency]`] = CURRENCY;
    params[`line_items[${i}][price_data][product_data][name]`] = line.name;
    params[`line_items[${i}][price_data][unit_amount]`] = String(line.unitAmount);
    params[`line_items[${i}][quantity]`] = String(line.qty);
  });
  return params;
}

// Verifies the Stripe-Signature header per Stripe's documented scheme:
// https://docs.stripe.com/webhooks#verify-manually
export function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx), p.slice(idx + 1)];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== gotBuf.length) return false;
  if (!crypto.timingSafeEqual(expectedBuf, gotBuf)) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  return age <= toleranceSeconds;
}

// ---------------------------------------------------------------------
// static file serving
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = safePath === '/' ? '/index.html' : safePath;
  const publicDir = path.join(__dirname, 'public');
  const full = path.join(publicDir, filePath);
  if (!full.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------
// server
// ---------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/menu') {
      return sendJSON(res, 200, MENU);
    }

    if (req.method === 'POST' && url.pathname === '/api/create-checkout-session') {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        return sendJSON(res, 400, { error: 'Invalid JSON body' });
      }
      const { cart, fulfilment, name, phone, address, notes, paymentMethod } = payload;
      if (!cart || typeof cart !== 'object' || Object.keys(cart).length === 0) {
        return sendJSON(res, 400, { error: 'Cart is empty' });
      }
      const payMethod = paymentMethod === 'cash' ? 'cash' : 'card';

      // Prices are always looked up server-side from menu.json — never
      // trust a price sent by the browser.
      const lineItems = [];
      for (const [itemName, qty] of Object.entries(cart)) {
        const q = Number(qty);
        if (!Number.isInteger(q) || q <= 0) continue;
        const item = ITEM_INDEX[itemName];
        if (!item) return sendJSON(res, 400, { error: `Unknown item: ${itemName}` });
        lineItems.push({ name: item.n, unitAmount: Math.round(item.p * 100), qty: q });
      }
      if (lineItems.length === 0) return sendJSON(res, 400, { error: 'Cart is empty' });

      const subtotalPence = lineItems.reduce((sum, li) => sum + li.unitAmount * li.qty, 0);

      // Card orders: charged online now, so the customer covers Stripe's
      // processing cost via a visible service fee (the shop always nets
      // the subtotal — see computeServiceFeePence()).
      //
      // Cash orders: no charge and no fund hold happens at checkout at
      // all. We use a Stripe Checkout Session in "setup" mode, which just
      // securely saves the customer's card (attached to a Stripe Customer)
      // without authorising or reserving any amount — nothing shows as a
      // pending charge on their statement. If they collect and pay cash,
      // nothing further ever happens. If they don't show up, the shop
      // charges the saved card afterwards from the Stripe dashboard
      // (Customers → find them → Create invoice → charge automatically).
      if (payMethod === 'card') {
        const feePence = computeServiceFeePence(subtotalPence);
        lineItems.push({ name: 'Service & card fee', unitAmount: feePence, qty: 1 });
      }

      if (!STRIPE_SECRET_KEY) {
        return sendJSON(res, 500, {
          error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to your environment variables and restart the server.',
        });
      }

      const orderRef = crypto.randomBytes(4).toString('hex').toUpperCase();
      const params = {
        success_url: `${PUBLIC_BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${PUBLIC_BASE_URL}/?cancelled=1`,
        'metadata[order_ref]': orderRef,
        'metadata[fulfilment]': fulfilment || 'collect',
        'metadata[payment_method]': payMethod,
        'metadata[subtotal_pence]': String(subtotalPence),
        'metadata[name]': name || '',
        'metadata[phone]': phone || '',
        'metadata[address]': address || '',
        'metadata[notes]': notes || '',
      };

      if (payMethod === 'cash') {
        // Setup mode: save the card, take/hold nothing. No line_items are
        // allowed in this mode. The description shows up on the saved
        // Stripe Customer/SetupIntent so it's easy to find in the
        // dashboard later if a no-show charge is ever needed.
        params.mode = 'setup';
        params['setup_intent_data[description]'] =
          `Joe 90's order ${orderRef} — cash on collection, card saved as no-show protection (order value £${(subtotalPence / 100).toFixed(2)}). No charge unless customer doesn't collect.`;
        params['setup_intent_data[metadata][order_ref]'] = orderRef;
        params['setup_intent_data[metadata][payment_method]'] = 'cash';
        params['setup_intent_data[metadata][subtotal_pence]'] = String(subtotalPence);
      } else {
        params.mode = 'payment';
        Object.assign(params, flattenLineItems(lineItems));
      }

      const session = await stripePost('checkout/sessions', params);
      return sendJSON(res, 200, { url: session.url });
    }

    if (req.method === 'GET' && url.pathname === '/api/order-status') {
      const sessionId = url.searchParams.get('session_id');
      if (!sessionId) return sendJSON(res, 400, { error: 'Missing session_id' });
      if (!STRIPE_SECRET_KEY) return sendJSON(res, 500, { error: 'Stripe not configured' });
      const session = await stripeGet(`checkout/sessions/${sessionId}`);
      // For card orders, "paid" means the charge went through. For cash
      // orders (setup mode) nothing is ever charged at checkout — the
      // signal that the order is confirmed is the Checkout Session
      // itself completing (session.status === 'complete'), which fires
      // once the customer's card is saved. Setup-mode sessions also have
      // no amount_total (no line items), so the order value comes from
      // the subtotal_pence we stashed in metadata instead.
      const paymentMethod = session.metadata?.payment_method || 'card';
      const confirmed = paymentMethod === 'cash'
        ? session.status === 'complete'
        : session.payment_status === 'paid';
      const amountTotal = paymentMethod === 'cash'
        ? Number(session.metadata?.subtotal_pence || 0)
        : session.amount_total;
      return sendJSON(res, 200, {
        paid: confirmed,
        paymentMethod,
        amount_total: amountTotal,
        metadata: session.metadata,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/webhook') {
      const raw = await readBody(req);
      const sig = req.headers['stripe-signature'];

      if (STRIPE_WEBHOOK_SECRET) {
        if (!verifyStripeSignature(raw, sig, STRIPE_WEBHOOK_SECRET)) {
          res.writeHead(400);
          return res.end('Invalid signature');
        }
      } else {
        console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set — webhook signature was NOT verified. Set it before going live.');
      }

      let event;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        res.writeHead(400);
        return res.end('Invalid payload');
      }

      // checkout.session.completed fires once the customer finishes
      // Checkout — for card orders that means paid; for cash orders it
      // means their card is authorised (held) but not charged.
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const paymentMethod = session.metadata?.payment_method || 'card';
        const amountPence = paymentMethod === 'cash'
          ? Number(session.metadata?.subtotal_pence || 0)
          : session.amount_total;
        saveOrder({
          id: session.id,
          ref: session.metadata?.order_ref,
          amountPence,
          paymentMethod,
          stripeCustomerId: session.customer || null,
          fulfilment: session.metadata?.fulfilment,
          name: session.metadata?.name,
          phone: session.metadata?.phone,
          address: session.metadata?.address,
          notes: session.metadata?.notes,
          created: new Date().toISOString(),
        });

        // --- Kitchen printer hook ---
        // Once you know what printer the shop has, send the print job here
        // (e.g. Star CloudPRNT or Epson ePOS Print). Deliberately left as a
        // stub until real hardware is confirmed.
        if (paymentMethod === 'cash') {
          console.log(
            `🧾 Cash order ${session.metadata?.order_ref} — £${(amountPence / 100).toFixed(2)} due on collection. ` +
            `Card saved, NOT charged (no hold either). Stripe customer: ${session.customer}. ` +
            `If they don't show up: Stripe dashboard → Customers → find "${session.metadata?.name}" → Create invoice for £${(amountPence / 100).toFixed(2)}, set to charge automatically.`
          );
        } else {
          console.log(`✅ Paid order ${session.metadata?.order_ref} — £${(amountPence / 100).toFixed(2)}`);
        }
      }

      res.writeHead(200);
      return res.end('ok');
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'Not found' });
    }

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Joe 90's ordering site running at http://localhost:${PORT}`);
  if (!STRIPE_SECRET_KEY) console.log('⚠️  STRIPE_SECRET_KEY not set — payments are disabled until you add it.');
  if (!STRIPE_WEBHOOK_SECRET) console.log('⚠️  STRIPE_WEBHOOK_SECRET not set — webhook signatures are not verified.');
});
