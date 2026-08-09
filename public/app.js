let MENU = {};
let cart = {}; // itemName -> qty
let paymentMethod = 'card'; // 'card' (pay now) or 'cash' (pay on collection)
const FULFIL = 'collect'; // Joe 90's is collection only — no delivery

// Mirrors the same gross-up formula used server-side (server.js), purely
// for showing the customer an accurate breakdown before they pay. The
// actual charge is always calculated authoritatively on the server.
const STRIPE_RATE = 0.015;
const STRIPE_FIXED_PENCE = 20;
function computeServiceFeePence(subtotalPence) {
  const totalPence = Math.ceil((subtotalPence + STRIPE_FIXED_PENCE) / (1 - STRIPE_RATE));
  return totalPence - subtotalPence;
}

async function loadMenu() {
  const res = await fetch('/api/menu');
  MENU = await res.json();
  renderTabs();
  renderMenu();
}

function catId(cat) { return cat.toLowerCase().replace(/[^a-z]+/g, '-'); }

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  Object.keys(MENU).forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.className = i === 0 ? 'active' : '';
    btn.onclick = () => {
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('cat-' + catId(cat)).scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    tabs.appendChild(btn);
  });
}

function renderMenu() {
  const main = document.getElementById('menu');
  main.innerHTML = '';
  let itemIndex = 0;
  Object.entries(MENU).forEach(([cat, items]) => {
    const section = document.createElement('div');
    section.className = 'category';
    section.id = 'cat-' + catId(cat);
    section.innerHTML = `<h2>${cat}</h2>`;
    main.appendChild(section);
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.style.animationDelay = `${Math.min(itemIndex, 14) * 0.03}s`;
      itemIndex++;
      row.innerHTML = `
        <div class="meta">
          <h3>${escapeHtml(item.n)}</h3>
          <p>${escapeHtml(item.d || '')}</p>
          <div class="price">£${item.p.toFixed(2)}</div>
        </div>
        <div class="control" data-key="${escapeHtml(item.n)}"></div>
      `;
      section.appendChild(row);
      renderControl(item);
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderControl(item) {
  const el = document.querySelector(`.control[data-key="${cssAttrEscape(item.n)}"]`);
  if (!el) return;
  const qty = cart[item.n] || 0;
  if (qty === 0) {
    el.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'add-btn';
    btn.textContent = 'Add';
    btn.onclick = () => addItem(item.n);
    el.appendChild(btn);
  } else {
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'stepper';
    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.onclick = () => changeQty(item.n, -1);
    const span = document.createElement('span');
    span.textContent = qty;
    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.onclick = () => changeQty(item.n, 1);
    wrap.append(minus, span, plus);
    el.appendChild(wrap);
  }
}
function cssAttrEscape(s) { return String(s).replace(/"/g, '\\"'); }

function findItem(name) {
  for (const cat in MENU) {
    const found = MENU[cat].find((i) => i.n === name);
    if (found) return found;
  }
}

function addItem(name) {
  cart[name] = (cart[name] || 0) + 1;
  renderControl(findItem(name));
  updateCartBar(true);
}
function changeQty(name, delta) {
  cart[name] = (cart[name] || 0) + delta;
  if (cart[name] <= 0) delete cart[name];
  renderControl(findItem(name));
  updateCartBar();
  renderCartLines();
}

function cartCount() { return Object.values(cart).reduce((s, q) => s + q, 0); }
function cartTotal() {
  return Object.entries(cart).reduce((s, [name, q]) => {
    const item = findItem(name);
    return s + (item ? item.p * q : 0);
  }, 0);
}

function updateCartBar(bump) {
  const bar = document.getElementById('cartBar');
  const count = cartCount();
  bar.classList.toggle('visible', count > 0);
  document.getElementById('cartBarText').textContent = `${count} item${count === 1 ? '' : 's'} · £${cartTotal().toFixed(2)}`;
  if (bump && count > 0) {
    bar.classList.remove('bump');
    // restart animation
    void bar.offsetWidth;
    bar.classList.add('bump');
  }
}

function openCart() {
  renderCartLines();
  document.getElementById('cartOverlay').classList.add('open');
}
function closeSheet(id) { document.getElementById(id).classList.remove('open'); }

function renderCartLines() {
  const wrap = document.getElementById('cartLines');
  const entries = Object.entries(cart);
  if (entries.length === 0) {
    wrap.innerHTML = `<div class="empty-note">Your order is empty. Add something tasty!</div>`;
    document.getElementById('cartTotal').style.display = 'none';
    document.getElementById('checkoutBtn').disabled = true;
    return;
  }
  wrap.innerHTML = '';
  entries.forEach(([name, qty]) => {
    const item = findItem(name);
    const line = document.createElement('div');
    line.className = 'cart-line';
    line.innerHTML = `
      <div>
        <div class="l-name">${qty} × ${escapeHtml(name)}</div>
        <div class="l-sub">£${item.p.toFixed(2)} each</div>
      </div>
      <div style="text-align:right;">
        <div>£${(item.p * qty).toFixed(2)}</div>
        <button class="l-remove">Remove</button>
      </div>
    `;
    line.querySelector('.l-remove').onclick = () => removeItem(name);
    wrap.appendChild(line);
  });
  document.getElementById('cartTotal').style.display = 'flex';
  document.getElementById('cartTotalAmt').textContent = `£${cartTotal().toFixed(2)}`;
  document.getElementById('checkoutBtn').disabled = false;
}

function removeItem(name) {
  delete cart[name];
  renderControl(findItem(name));
  updateCartBar();
  renderCartLines();
}

function initPaymentMethodToggle() {
  const inputs = document.querySelectorAll('input[name="payMethod"]');
  inputs.forEach((input) => {
    input.addEventListener('change', () => {
      paymentMethod = input.value;
      document.querySelectorAll('.pay-option').forEach((el) => {
        el.classList.toggle('active', el.dataset.value === paymentMethod);
      });
      updateCheckoutTotals();
    });
  });
}

// Recomputes the checkout breakdown for whichever payment method is
// currently selected. Card orders show subtotal + service fee = total
// charged now. Cash orders show subtotal only (no fee, since no online
// charge is expected) plus a note explaining the card hold.
function updateCheckoutTotals() {
  const subtotal = cartTotal();
  const subtotalPence = Math.round(subtotal * 100);

  const feeRow = document.getElementById('feeRow');
  const totalLabel = document.getElementById('totalLabel');
  const holdNote = document.getElementById('holdNote');
  const payBtn = document.getElementById('payBtn');

  document.getElementById('feeSubtotal').textContent = `£${subtotal.toFixed(2)}`;

  if (paymentMethod === 'cash') {
    feeRow.style.display = 'none';
    document.getElementById('checkoutTotalAmt').textContent = `£${subtotal.toFixed(2)}`;
    totalLabel.textContent = 'Due in shop (cash)';
    holdNote.style.display = 'block';
    holdNote.textContent =
      `No payment or hold is taken now. We securely save your card details — ` +
      `you're only charged £${subtotal.toFixed(2)} if you don't collect your order.`;
    payBtn.textContent = 'Reserve order — pay cash on collection';
  } else {
    const feePence = computeServiceFeePence(subtotalPence);
    const fee = feePence / 100;
    const total = subtotal + fee;
    feeRow.style.display = 'flex';
    document.getElementById('feeAmount').textContent = `£${fee.toFixed(2)}`;
    document.getElementById('checkoutTotalAmt').textContent = `£${total.toFixed(2)}`;
    totalLabel.textContent = 'Total to pay';
    holdNote.style.display = 'none';
    payBtn.textContent = 'Pay & place order';
  }
}

function openCheckout() {
  closeSheet('cartOverlay');
  updateCheckoutTotals();
  document.getElementById('checkoutOverlay').classList.add('open');
}

async function placeOrder() {
  const btn = document.getElementById('payBtn');
  const errEl = document.getElementById('checkoutError');
  errEl.style.display = 'none';

  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const notes = document.getElementById('custNotes').value.trim();

  if (!name || !phone) {
    errEl.textContent = 'Please enter your name and phone number.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = paymentMethod === 'cash' ? 'Redirecting to card verification…' : 'Redirecting to secure payment…';

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart, fulfilment: FULFIL, name, phone, address: '', notes, paymentMethod }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    window.location.href = data.url;
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = paymentMethod === 'cash' ? 'Reserve order — pay cash on collection' : 'Pay & place order';
  }
}

loadMenu();
initPaymentMethodToggle();
