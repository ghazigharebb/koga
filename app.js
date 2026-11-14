window.SEED_ITEMS=[];window.SEED_CUSTOMERS=[];
/* وەستا غەریب — یاساکانی کار (بێ DOM). هەمان فایل لە براوزەر (Core)، Node و Deno بار دەکرێت.
   Every change to the shared state goes through Core.apply(); money is integer cents. */
(function (root, factory) {
  var C = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = C;
  if (root) root.Core = C;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  class Err extends Error { constructor(m) { super(m); this.name = 'CoreErr'; } }
  const LV = { owner: 3, sup: 2, staff: 1 };
  const ROLE = { owner: 'بەڕێوەبەر', sup: 'سوپەرڤایزەر', staff: 'کارمەند' };
  const TYPES = { retail: 'تاک', wholesale: 'جوملە', delivery: 'دلیڤەری' };
  const PAY = { cash: 'کاش', fib: 'FIB', debt: 'قەرز' };
  const LK = { dayoff: 'دەوامی ڕۆژی پشوو', salary: 'مووچە', bonus: 'پاداشت', cut: 'بڕین', other: 'هیتر' };
  /* keys every device shares; everything else in the app's S is screen state */
  const SHARED = ['items', 'customers', 'branches', 'team', 'ledger', 'notes', 'cur', 'rate', 'rates', 'jards', 'target', 'sales', 'expenses', 'payments', 'purchases', 'exchanges', 'approvals', 'log', 'unread', 'nextNo', 'nextId', 'adjusted', 'jardAdj', 'tz', 'closes'];
  /* messages that exist only because the server cannot trust the screen */
  const OWNER_ONLY = 'تەنها بەڕێوەبەر دەتوانێت ئەم کارە بکات', DENIED = 'دەسەڵاتی ئەم کارەت نییە', BAD = 'داواکارییەکە دروست نییە';
  const VOIDED = 'سەبەتەکە گۆڕا؛ داشکاندنەکە هەڵوەشایەوە', AMT = 'بڕێکی دروست بنووسە';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cents = n => Math.round(Number(n) * 100);
  const ms = t => t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : +t;
  const grp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const usd = c => { const p = (Math.abs(c) / 100).toFixed(2).split('.'); return grp(p[0]) + '.' + p[1]; };
  const iqd = (st, c) => Math.round(c * st.rate / 100 / 250) * 250; // dinar, rounded to the smallest note (250)
  const fmtMoney = (st, c) => st.cur === 'IQD' ? (c < 0 ? '-' : '') + grp(iqd(st, Math.abs(c))) + ' د.ع' : (c < 0 ? '-$' : '$') + usd(c);
  const fmtCur = (a, c) => c === 'IQD' ? (a < 0 ? '-' : '') + grp(Math.abs(a)) + ' د.ع' : (a < 0 ? '-$' : '$') + usd(a);
  const money = (st, c) => `<span class="num">${fmtMoney(st, c)}</span>`;
  const pctTxt = v => v == null ? 'دانەنراوە' : `${+v}%`;
  const tzMs = st => (st.tz == null ? 180 : st.tz) * 60000;
  const dayStart = (st, now) => Math.floor((ms(now) + tzMs(st)) / 864e5) * 864e5 - tzMs(st);
  const isoD = (st, now) => new Date(ms(now) + tzMs(st)).toISOString().slice(0, 10);
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
  const QMAX = 100000;                                   // the most pieces one line / one receive / one count may say
  const BC_OK = bc => /^[A-Za-z0-9._\-]{3,40}$/.test(bc) && !/^0+$/.test(bc);   // what a scanner or a printed label can carry
  const cleanBc = v => str(v, 60).replace(/\s+/g, '');
  const PHONE_OK = ph => /^[0-9+\- ]{0,20}$/.test(ph);
  function sane(v, depth) { // every number in a request must be a normal finite size; deep objects are refused
    if (depth > 6) return false;
    if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e11;
    if (v && typeof v === 'object') { const ks = Object.keys(v); if (ks.length > 2000) return false; for (const k of ks) if (!sane(v[k], depth + 1)) return false; }
    return true;
  }
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); // 'constructor' is not a payment type
  const acct = (st, n) => st.team.find(u => u.name === n);
  const item = (st, id) => st.items.find(i => i.id === id);

  function init(seedItems, seedCustomers, now) {
    return {
      items: (seedItems || []).map(x => ({ ...x, r: cents(x.r), w: cents(x.w), s: [...x.s] })),
      customers: (seedCustomers || []).map(x => ({ ...x, debt: cents(x.debt) })),
      branches: ['لقی بازاڕ', 'لقی 60م'],
      team: [{ name: 'وەستا غەریب', role: 'owner', branch: -1, pw: null }, { name: 'سەرپەرشت', role: 'sup', branch: -1, pct: null, salary: null, salaryCur: 'USD', pw: null }, { name: 'qara', role: 'staff', branch: 0, pct: null, salary: null, salaryCur: 'USD', pw: null }],
      ledger: [], notes: [], closes: [], cur: 'USD', rate: 1690, rates: [{ t: now == null ? new Date(0) : now, rate: 1690, by: 'وەستا غەریب' }], jards: [],
      target: 100000, sales: [], expenses: [], payments: [], purchases: [], exchanges: [], approvals: [], log: [], unread: {}, nextNo: 20001, nextId: 200, tz: 180
    };
  }

  /* ---------- log + notifications ---------- */
  function log(st, by, branch, now, kind, text, to, toUser) {
    to = to || 'owner'; toUser = toUser || null;
    st.log.unshift({ t: now, kind, text, by, branch, to, toUser });
    if (st.log.length > 6000) st.log.length = 6000;
    if (st.approvals && st.approvals.length > 600) st.approvals = st.approvals.filter((a, i) => a.status === 'wait' || i < 600);
    if (st.jards && st.jards.length > 400) st.jards.length = 400;
    const bump = n => { if (n !== by) st.unread[n] = (st.unread[n] || 0) + 1; };
    if (toUser) bump(toUser); else st.team.forEach(u => { if (to === 'all' || LV[u.role] > 1) bump(u.name); });
  }
  /* which branch an action is done in; a one-branch employee can only work in their own */
  function br(st, u, p) {
    let b = p.branch; if (b == null) b = u.branch >= 0 ? u.branch : 0;
    if (!Number.isInteger(b) || b < 0 || b >= st.branches.length) throw new Err(BAD);
    if (LV[u.role] === 1 && u.branch >= 0 && b !== u.branch) throw new Err('تەنها لە لقی خۆت دەتوانیت کار بکەیت');
    return b;
  }
  const cartSig = (raw, type) => type + ':' + (Array.isArray(raw) ? raw : []).map(l => (l && l.id) + 'x' + (l && l.qty)).sort().join(',');
  function cartLines(st, raw, type) {
    if (!has(TYPES, type) || !Array.isArray(raw)) throw new Err(BAD);
    const seen = new Set();
    return raw.map(l => {
      const it = l && item(st, l.id);
      if (!it || seen.has(it.id) || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > QMAX) throw new Err(BAD);
      seen.add(it.id); const price = type === 'wholesale' ? it.w : it.r;
      if (!(price > 0)) throw new Err('ئەم کاڵایە نرخی ' + TYPES[type] + 'ی بۆ دانەنراوە');
      return { it, qty: l.qty, price };
    });
  }
  /* what a return is worth; null when a quantity is more than what is left on the receipt */
  function refundCalc(sale, qty) {
    const q = sale.lines.map((l, i) => ({ l, n: Math.floor(+(qty && qty[i]) || 0) }));
    if (q.some(x => x.n < 0 || x.n > x.l.qty - x.l.ret)) return null;
    const value = q.reduce((a, x) => a + x.n * x.l.price, 0), all = q.every(x => x.l.ret + x.n === x.l.qty);
    return { q, value, refund: all ? sale.total - sale.refunded : value - Math.round(sale.disc * value / sale.sub) };
  }
  /* today's movement per item in one branch */
  function moves(st, b, now) {
    const m = {}, g = id => m[id] || (m[id] = { sold: 0, ret: 0, exch: 0 }), t0 = dayStart(st, now);
    st.sales.filter(x => x.branch === b && !x.legacy && ms(x.t) >= t0).forEach(x => x.lines.forEach(l => { g(l.id).sold += l.qty; g(l.id).ret += l.ret; }));
    st.exchanges.filter(x => x.branch === b && ms(x.t) >= t0).forEach(x => g(x.id).exch += x.qty);
    return m;
  }
  function saleOf(st, no) {
    const sale = st.sales.find(s => s.no === +no);
    if (!sale) throw new Err('پسولەی #' + str(no, 20) + ' نەدۆزرایەوە');
    if (sale.legacy) throw new Err('پسولەی #' + sale.no + ' هی سیستەمە کۆنەکەیە');
    return sale;
  }
  const person = (st, n) => { const t = acct(st, n); if (!t || t.role === 'owner') throw new Err(BAD); return t; };

  /* ---------- the actions: [lowest level allowed, rule] ---------- */
  const A = {
    sell: [1, (st, u, p, now) => {
      const b = br(st, u, p), lines = cartLines(st, p.lines, p.type), type = p.type, pay = p.pay;
      if (!has(PAY, pay)) throw new Err(BAD);
      if (!lines.length) throw new Err('سەبەتەکە بەتاڵە');
      const needCust = type !== 'retail' || pay === 'debt', cu = needCust ? st.customers.find(c => c.id === p.customer) : null;
      if (needCust && !cu) throw new Err(pay === 'debt' ? 'بۆ فرۆشتن بە قەرز دەبێت کڕیار هەڵبژێریت' : 'بۆ ' + TYPES[type] + ' دەبێت کڕیار هەڵبژێریت');
      if (pay === 'fib' && !p.fibOk) throw new Err('سەرەتا دڵنیابە پارەکە لە FIB گەیشتووە و نیشانەکە دابنێ');
      if (pay === 'fib' && str(p.fibRef, 60).length < 3) throw new Err('ژمارەی مامەڵەی FIB بنووسە (لە ئەپی FIB دەردەکەوێت)');
      for (const l of lines) if (l.qty > l.it.s[b]) throw new Err('بڕی «' + l.it.name + '» لە کۆگا زیاترە');
      const sub = lines.reduce((a, l) => a + l.qty * l.price, 0);
      let disc = 0, ap = null;
      if (p.req != null) { // a discount the manager agreed to, for exactly this basket
        ap = st.approvals.find(x => x.id === p.req);
        if (!ap || ap.by !== u.name) throw new Err(VOIDED);
        if (ap.status === 'wait') throw new Err('چاوەڕوانی ڕەزامەندیی بەڕێوەبەر');
        if (ap.status !== 'ok' || ap.used || ap.sub !== sub || (ap.sig && ap.sig !== cartSig(p.lines, type))) throw new Err(VOIDED);
        disc = Math.min(ap.amt, sub);
      } else if (p.disc) {
        if (u.role !== 'owner') throw new Err('تەنها بەڕێوەبەر دەتوانێت داشکاندن بکات');
        if (!Number.isInteger(p.disc) || p.disc < 0) throw new Err(AMT);
        if (p.disc >= sub) throw new Err('داشکاندن دەبێت لە کۆی سەبەتە کەمتر بێت');
        disc = p.disc;
      }
      const total = sub - disc;
      const sale = { no: st.nextNo++, t: now, branch: b, by: u.name, rate: st.rate, type, pay, fibRef: pay === 'fib' ? str(p.fibRef, 60) : '', customer: needCust ? cu.id : null, lines: lines.map(l => ({ id: l.it.id, name: l.it.name, qty: l.qty, price: l.price, cost: l.it.c == null ? null : l.it.c, ret: 0 })), sub, disc, total, refunded: 0 };
      lines.forEach(l => l.it.s[b] -= l.qty);
      if (pay === 'debt') cu.debt += total;
      if (ap) ap.used = sale.no;
      st.sales.unshift(sale);
      log(st, u.name, b, now, 'sale', `فرۆشتنی ${TYPES[type]} — پسولەی <b class="num">#${sale.no}</b> بە ${money(st, total)} (${PAY[pay]}): ${sale.lines.map(l => esc(l.name) + ' ×' + l.qty).join('، ')}`);
      return { no: sale.no, total };
    }],
    discountRequest: [1, (st, u, p, now) => {
      const b = br(st, u, p), sub = cartLines(st, p.lines, p.type).reduce((a, l) => a + l.qty * l.price, 0), amt = p.amt;
      if (!Number.isInteger(amt) || !(amt > 0)) throw new Err(AMT);
      if (amt >= sub) throw new Err('داشکاندن دەبێت لە کۆی سەبەتە کەمتر بێت');
      if (st.approvals.filter(x => x.by === u.name && x.status === 'wait').length >= 5) throw new Err('پێنج داواکاریت چاوەڕوانی وەڵامن؛ سەرەتا چاوەڕێی وەڵامیان بکە');
      const a = { id: st.nextId++, amt, sub, sig: cartSig(p.lines, p.type), why: str(p.why, 200), by: u.name, branch: b, t: now, status: 'wait' };
      st.approvals.unshift(a);
      log(st, u.name, b, now, 'req', `داواکاریی داشکاندنی ${money(st, amt)} لەسەر سەبەتەیەکی ${money(st, sub)}${a.why ? ' — ' + esc(a.why) : ''}`);
      return { id: a.id };
    }],
    voidRequest: [1, (st, u, p) => { // the basket changed, so the waiting request no longer fits it
      const a = st.approvals.find(x => x.id === p.id); if (!a) return;
      if (a.by !== u.name && LV[u.role] < 2) throw new Err(DENIED);
      if (a.status === 'wait') a.status = 'void';
    }],
    decideRequest: [3, (st, u, p, now) => {
      const a = st.approvals.find(x => x.id === p.id);
      if (!a || a.status !== 'wait') throw new Err('ئەم داواکارییە ئیتر چاوەڕوان نییە');
      const ok = !!p.ok; a.status = ok ? 'ok' : 'no';
      log(st, u.name, br(st, u, p), now, ok ? 'ok' : 'no', ok ? `بەڕێوەبەر ڕازی بوو بە داشکاندنی ${money(st, a.amt)}` : `بەڕێوەبەر داشکاندنی ${money(st, a.amt)}ی ڕەت کردەوە`, 'owner', a.by);
    }],
    return: [2, (st, u, p, now) => {
      const b = br(st, u, p), sale = saleOf(st, p.no), r = refundCalc(sale, p.qty), why = str(p.why, 200);
      if (!r) throw new Err('بڕی گەڕاوە لە فرۆشراو زیاترە');
      if (!r.value) throw new Err('بڕی لانی کەم یەک کاڵا دیاری بکە');
      if (why.length < 2) throw new Err('هۆکاری گەڕاندنەوەکە بنووسە');
      r.q.forEach(x => { x.l.ret += x.n; const it = item(st, x.l.id); if (it) it.s[sale.branch] += x.n; });
      sale.refunded += r.refund;
      let cash = r.refund, note = '';
      if (sale.pay === 'debt') { const cu = st.customers.find(c => c.id === sale.customer), off = cu ? Math.min(cu.debt, r.refund) : 0; if (cu) cu.debt -= off; cash = r.refund - off; note = ` — ${money(st, off)} لە قەرزی ${esc(cu ? cu.name : '')} کەم کرایەوە`; }
      if (sale.pay === 'fib') { cash = 0; sale.fibBack = (sale.fibBack || 0) + r.refund; note = ' — بە FIB دەگەڕێنرێتەوە'; } else if (sale.pay === 'cash') note = ' — بە کاش لە قاصە درایەوە';
      sale.cashBack = (sale.cashBack || 0) + cash;
      (sale.rets || (sale.rets = [])).push({ t: now, amt: r.refund, cash, fib: sale.pay === 'fib' ? r.refund : 0, branch: b, by: u.name, why });
      log(st, u.name, b, now, 'ret', `گەڕاندنەوە لە پسولەی <b class="num">#${sale.no}</b>: ${r.q.filter(x => x.n).map(x => esc(x.l.name) + ' ×' + x.n).join('، ')} — ${money(st, r.refund)}${note} — هۆکار: ${esc(why)}`);
      return { no: sale.no, refund: r.refund };
    }],
    exchange: [2, (st, u, p, now) => { // warranty: the faulty unit comes back, a new one goes out, no money moves
      const b = br(st, u, p), sale = saleOf(st, p.no), l = Number.isInteger(p.line) ? sale.lines[p.line] : null, it = l && item(st, l.id);
      if (!l || !it) throw new Err(BAD);
      const end = new Date(ms(sale.t)); end.setUTCFullYear(end.getUTCFullYear() + 1);
      if (ms(now) > end.getTime()) throw new Err('زەمانەتی ئەم پسولەیە بەسەرچووە');
      const can = l.qty - l.ret, n = p.qty, why = str(p.why);
      if (!Number.isInteger(n) || n < 1 || n > can) throw new Err('بڕەکە دەبێت لە نێوان 1 و ' + can + ' بێت');
      if (n > it.s[b]) throw new Err('لە کۆگای ' + st.branches[b] + ' ئەوەندە نەماوە بۆ گۆڕین');
      if (!why) throw new Err('کێشەی کاڵاکە بنووسە');
      it.s[b] -= n; it.f = (it.f || 0) + n; l.exch = (l.exch || 0) + n;
      st.exchanges.unshift({ t: now, by: u.name, branch: b, no: sale.no, id: l.id, qty: n, why });
      log(st, u.name, b, now, 'swap', `گۆڕینی زەمانەت — پسولەی <b class="num">#${sale.no}</b>: ${esc(l.name)} ×${n} — ${esc(why)}`);
    }],
    receive: [2, (st, u, p, now) => {
      const b = br(st, u, p), it = item(st, p.id), n = p.qty;
      if (!it || !it.bc) throw new Err('سەرەتا بارکۆدێکی دروست سکان بکە');
      if (!Number.isInteger(n) || n < 1 || n > QMAX) throw new Err(AMT);
      let cost = it.c == null ? null : it.c;
      if (p.cost !== undefined) { // the buying price is the manager's alone
        if (u.role !== 'owner') throw new Err(OWNER_ONLY);
        if (!Number.isInteger(p.cost) || !(p.cost >= 0)) throw new Err('نرخی کڕین دروست نییە');
        cost = it.c = p.cost;
      }
      it.s[b] += n; st.purchases.unshift({ t: now, by: u.name, branch: b, id: it.id, name: it.name, qty: n, cost, retail: it.r });
      log(st, u.name, b, now, 'stock', `داخیلکردنی <b class="num">${n}</b> دانە «${esc(it.name)}» — بەهای فرۆشتن ${money(st, n * it.r)} — ئێستا <span class="num">${it.s[b]}</span> دانە`);
    }],
    stockReduce: [2, (st, u, p, now) => {
      const b = br(st, u, p), it = item(st, p.id), n = p.qty, why = str(p.why);
      if (!it) throw new Err(BAD);
      if (!Number.isInteger(n) || n < 1) throw new Err(AMT);
      if (n > it.s[b]) throw new Err('لە بڕی کۆگا زیاترە');
      if (!why) throw new Err('هۆکار بنووسە');
      it.s[b] -= n; st.adjusted = (st.adjusted || 0) + n;
      log(st, u.name, b, now, 'stock', `کەمکردنەوەی <b class="num">${n}</b> دانە «${esc(it.name)}» — ${esc(why)} — ماوە <span class="num">${it.s[b]}</span>`);
    }],
    newItem: [3, (st, u, p, now) => {
      const name = str(p.name, 120), bc = cleanBc(p.bc), r = p.r, w = p.w, cats = [...new Set(st.items.map(i => i.cat))];
      if (!name) throw new Err('ناوی کاڵا بنووسە');
      if (!bc) throw new Err('بێ بارکۆد کاڵا دروست نابێت');
      if (!BC_OK(bc)) throw new Err('بارکۆدێکی دروست بنووسە (تەنها ژمارە و پیتی ئینگلیزی، 3 تا 40)');
      if (st.items.some(i => i.bc === bc)) throw new Err('ئەم بارکۆدە پێشتر بۆ کاڵایەکی تر بەکارهاتووە');
      if (!Number.isInteger(r) || !Number.isInteger(w) || !(r > 0) || !(w > 0)) throw new Err('هەردوو نرخەکە بنووسە');
      if (w > r) throw new Err('نرخی جوملە نابێت لە تاک زیاتر بێت');
      const it = { id: st.nextId++, name, bc, r, w, s: st.branches.map(() => 0), cat: str(p.cat, 60) || cats[0] || '' };
      st.items.unshift(it);
      log(st, u.name, br(st, u, p), now, 'price', `کاڵای نوێ «${esc(name)}» دروست کرا — تاک ${money(st, r)} · جوملە ${money(st, w)}`);
      return { id: it.id };
    }],
    editPrice: [3, (st, u, p, now) => {
      const it = item(st, p.id), r = p.r, w = p.w, hasC = p.c !== undefined;
      if (!it) throw new Err(BAD);
      if (!Number.isInteger(r) || !Number.isInteger(w) || !(r > 0) || !(w > 0)) throw new Err('هەردوو نرخەکە دەبێت لە سفر زیاتر بن');
      if (w > r) throw new Err('نرخی جوملە نابێت لە تاک زیاتر بێت');
      if (hasC && (!Number.isInteger(p.c) || !(p.c >= 0))) throw new Err('نرخی کڕین دروست نییە');
      if (hasC) it.c = p.c;
      if (r !== it.r || w !== it.w) log(st, u.name, br(st, u, p), now, 'price', `نرخی «${esc(it.name)}» گۆڕدرا: تاک ${money(st, it.r)} ← ${money(st, r)} · جوملە ${money(st, it.w)} ← ${money(st, w)}`);
      it.r = r; it.w = w;
    }],
    setBarcode: [2, (st, u, p, now) => {
      const it = item(st, p.id), bc = cleanBc(p.bc);
      if (!it) throw new Err(BAD);
      if (it.bc) throw new Err('ئەم کاڵایە پێشتر بارکۆدی هەیە');
      if (!BC_OK(bc)) throw new Err('بارکۆدێکی دروست بنووسە (تەنها ژمارە و پیتی ئینگلیزی، 3 تا 40)');
      if (st.items.some(i => i.bc === bc)) throw new Err('ئەم بارکۆدە بۆ کاڵایەکی تر بەکارهاتووە');
      it.bc = bc; log(st, u.name, br(st, u, p), now, 'price', `بارکۆد بۆ «${esc(it.name)}» دانرا: <span class="num">${esc(bc)}</span>`);
    }],
    newCustomer: [1, (st, u, p, now) => {
      const b = br(st, u, p), name = str(p.name, 120), phone = str(p.phone, 40);
      if (!name) throw new Err('ناو بنووسە');
      if (!PHONE_OK(phone)) throw new Err('ژمارەی مۆبایل تەنها ژمارەی تێدا بێت');
      if (phone && st.customers.some(c => c.phone === phone)) throw new Err('ئەم ژمارەیە پێشتر تۆمار کراوە');
      const c = { id: st.nextId++, name, phone, addr: str(p.addr), debt: 0 };
      st.customers.unshift(c); log(st, u.name, b, now, 'cust', `کڕیاری نوێ: ${esc(name)}`);
      return { id: c.id };
    }],
    payDebt: [1, (st, u, p, now) => {
      const b = br(st, u, p), c = st.customers.find(x => x.id === p.customer), a = p.amt, m = p.method;
      if (!c || (m !== 'cash' && m !== 'fib')) throw new Err(BAD);
      if (!Number.isInteger(a) || !(a > 0)) throw new Err(AMT);
      if (a > c.debt) throw new Err('بڕەکە لە قەرزەکە زیاترە');
      c.debt -= a; st.payments.unshift({ t: now, amt: a, method: m, branch: b, by: u.name, customer: c.id });
      log(st, u.name, b, now, 'pay', `${money(st, a)} بە ${PAY[m]} لە ${esc(c.name)} وەرگیرا — قەرزی ماوە ${money(st, c.debt)}`);
    }],
    expense: [2, (st, u, p, now) => {
      const b = br(st, u, p), what = str(p.cat, 120), a = p.amt;
      if (!what) throw new Err('بنووسە چی مەسروف کراوە');
      if (!Number.isInteger(a) || !(a > 0)) throw new Err(AMT);
      const e = { t: now, cat: what, amt: a, note: str(p.note), by: u.name, branch: b };
      st.expenses.unshift(e); log(st, u.name, b, now, 'exp', `مەسروف: ${esc(e.cat)} ${money(st, a)}${e.note ? ' — ' + esc(e.note) : ''}`);
    }],
    jardSubmit: [1, (st, u, p, now) => { // the manager only watches the counts
      if (u.role === 'owner') throw new Err(DENIED);
      const b = br(st, u, p), cnt = p.counts && typeof p.counts === 'object' ? Object.entries(p.counts) : [], mv = moves(st, b, now);
      if (!cnt.length) throw new Err('لانی کەم یەک کاڵا بژمێرە');
      if (cnt.length > 2000 || new Set(cnt.map(([id]) => +id)).size !== cnt.length || cnt.some(([id]) => String(+id) !== id)) throw new Err(BAD);
      if (cnt.some(([, n]) => !Number.isInteger(n) || n < 0 || n > 10 * QMAX)) throw new Err(AMT);
      const rows = cnt.map(([id, n]) => { const it = item(st, +id), m = mv[id] || { sold: 0, ret: 0, exch: 0 }; if (!it || !Number.isInteger(n) || n < 0) throw new Err(BAD); return { id: +id, name: it.name, sys: it.s[b], counted: n, diff: n - it.s[b], ...m }; });
      const j = { id: st.nextId++, t: now, by: u.name, branch: b, rows, note: str(p.note), applied: false };
      st.jards.unshift(j); const dn = rows.filter(r => r.diff).length;
      log(st, u.name, b, now, 'jard', `جەردی ڕۆژانە نێردرا: <span class="num">${rows.length}</span> کاڵا، ${dn ? `<b class="num">${dn}</b> جیاوازی` : 'هەمووی ڕاستە'}`);
      return { id: j.id };
    }],
    jardApply: [3, (st, u, p, now) => {
      const j = st.jards.find(x => x.id === p.id); if (!j) throw new Err(BAD);
      const dn = j.rows.filter(r => r.diff).length;
      if (j.applied || !dn) throw new Err('ئەم جەردە پێشتر جێبەجێ کراوە یان جیاوازیی نییە');
      j.rows.filter(r => r.diff).forEach(r => { const it = item(st, r.id); if (it) it.s[j.branch] = Math.max(0, it.s[j.branch] + r.diff); });
      j.applied = true; st.jardAdj = (st.jardAdj || 0) + j.rows.reduce((a, r) => a + r.diff, 0);
      log(st, u.name, br(st, u, p), now, 'stock', `کۆگا بە پێی جەردی ${esc(j.by)} ڕاست کرایەوە: <span class="num">${dn}</span> کاڵا`);
    }],
    setPay: [3, (st, u, p, now) => {
      const t = person(st, p.name), pct = p.pct, sal = p.salary, cur = p.cur === 'IQD' ? 'IQD' : 'USD';
      if (typeof pct !== 'number' || !(pct >= 0) || pct > 100) throw new Err('ڕێژەکە دەبێت لە نێوان 0 و 100 بێت');
      if (!Number.isInteger(sal) || !(sal >= 0)) throw new Err('مووچەیەکی دروست بنووسە');
      const was = `${pctTxt(t.pct)} · ${t.salary != null ? fmtCur(t.salary, t.salaryCur) : 'دانەنراوە'}`;
      t.pct = pct; t.salary = sal; t.salaryCur = cur;
      log(st, u.name, br(st, u, p), now, 'msg', `مووچە و ڕێژەی سوودت نوێ کرایەوە: مووچەی مانگانە <b class="num">${fmtCur(sal, cur)}</b> و <b class="num">${pct}%</b> لە فرۆشی خۆت <span class="mute">(پێشتر: ${was})</span>`, 'owner', t.name);
    }],
    payOut: [3, (st, u, p, now) => { // extra money on a person's own account, in dollar or dinar, always with a reason
      const t = person(st, p.to), kind = p.kind, a = p.amount, cur = p.cur === 'IQD' ? 'IQD' : 'USD', note = str(p.note, 500);
      if (!has(LK, kind)) throw new Err(BAD);
      if (!Number.isInteger(a) || !(a > 0)) throw new Err(AMT);
      if (!note) throw new Err('هۆکارەکەی بنووسە');
      const e = { id: st.nextId++, t: now, d: /^\d{4}-\d\d-\d\d$/.test(p.d || '') ? p.d : isoD(st, now), to: t.name, kind, amount: kind === 'cut' ? -a : a, cur, note, by: u.name };
      st.ledger.unshift(e);
      log(st, u.name, br(st, u, p), now, 'msg', `${LK[kind]}: <b class="num">${fmtCur(e.amount, cur)}</b> بۆ حیسابەکەت — ${esc(note)}`, 'owner', t.name);
      return { id: e.id };
    }],
    note: [3, (st, u, p, now) => {
      const text = str(p.text, 1000), people = st.team.filter(t => t.role !== 'owner').map(t => t.name);
      if (!text) throw new Err('تێبینییەکە بنووسە');
      const to = p.to === 'all' ? 'all' : [...new Set(Array.isArray(p.to) ? p.to : [])].filter(n => people.includes(n));
      if (!to.length) throw new Err('دیاری بکە بۆ کێیە');
      const b = br(st, u, p);
      st.notes.unshift({ id: st.nextId++, t: now, by: u.name, text, to });
      if (to === 'all') log(st, u.name, b, now, 'msg', `تێبینی لە ${esc(u.name)} بۆ هەمووان: ${esc(text)}`, 'all'); // one entry everyone sees
      else to.forEach(n => log(st, u.name, b, now, 'msg', `تێبینی لە ${esc(u.name)}: ${esc(text)}`, 'owner', n)); // private: only the person named
    }],
    newAccount: [3, (st, u, p, now) => { // p.pw is already a hash; the caller hashes (and refuses short passwords by sending none)
      const name = str(p.name, 60), role = p.role, bn = p.home; // home = the account's own branch (-1: all)
      if (!name) throw new Err('ناو بنووسە');
      if (acct(st, name)) throw new Err('ئەم ناوە پێشتر هەیە');
      if (!p.pw || typeof p.pw !== 'string') throw new Err('پاسۆرد دەبێت لانی کەم 6 پیت بێت');
      if (!has(ROLE, role) || name in {} || !Number.isInteger(bn) || bn < -1 || bn >= st.branches.length) throw new Err(BAD);
      st.team.push({ name, role, branch: bn, pct: null, salary: null, salaryCur: 'USD', pw: p.pw });
      log(st, u.name, br(st, u, p), now, 'cust', `ئەکاونتی نوێ: ${esc(name)} — ${ROLE[role]}`);
    }],
    setPassword: [3, (st, u, p, now) => {
      const t = acct(st, p.name); if (!t) throw new Err(BAD);
      if (!p.pw || typeof p.pw !== 'string') throw new Err('پاسۆرد دەبێت لانی کەم 6 پیت بێت');
      t.pw = p.pw; log(st, u.name, br(st, u, p), now, 'cust', `پاسۆردی ${esc(t.name)} گۆڕدرا`);
    }],
    deleteAccount: [3, (st, u, p, now) => {
      const t = person(st, p.name);
      st.team = st.team.filter(x => x !== t); log(st, u.name, br(st, u, p), now, 'cust', `ئەکاونتی ${esc(t.name)} سڕایەوە`);
    }],
    setCurrency: [3, (st, u, p, now) => {
      if (p.cur !== 'USD' && p.cur !== 'IQD') throw new Err(BAD);
      if (st.cur === p.cur) return;
      st.cur = p.cur; log(st, u.name, br(st, u, p), now, 'cur', `دراوی سیستەم گۆڕدرا بۆ <b>${st.cur === 'IQD' ? 'دینار' : 'دۆلار'}</b>`, 'all');
    }],
    setRate: [3, (st, u, p, now) => { // p.v = dinars for 100 dollars
      const v = p.v; if (typeof v !== 'number' || !(v >= 10000 && v <= 1000000)) throw new Err('نرخەکە دروست نییە (بۆ نموونە 169000)');
      const old = st.rate; st.rate = v / 100;
      if (old !== st.rate) { st.rates.unshift({ t: now, rate: st.rate, by: u.name }); log(st, u.name, br(st, u, p), now, 'cur', `نرخی دۆلار گۆڕدرا: <span class="num">100$ = ${grp(Math.round(old * 100))} → ${grp(Math.round(v))} د.ع</span>`, 'all'); }
    }],
    fibVerify: [3, (st, u, p, now) => { // the manager saw this transfer in the FIB app
      const sale = st.sales.find(x => x.no === p.no);
      if (!sale || sale.pay !== 'fib') throw new Err(BAD);
      if (sale.fibChecked) throw new Err('ئەم مامەڵەیە پێشتر پشتڕاست کراوەتەوە');
      sale.fibChecked = { t: now, by: u.name };
      log(st, u.name, sale.branch, now, 'ok', `مامەڵەی FIB ی پسولەی <b class="num">#${sale.no}</b> پشتڕاست کرایەوە (${esc(sale.fibRef)})`);
    }],
    drawerClose: [1, (st, u, p, now) => { // blind cash count: the person types what is in the drawer, never sees what should be there
      const b = br(st, u, p), counted = p.counted;
      if (u.role === 'owner') throw new Err(DENIED);
      if (!Number.isInteger(counted) || counted < 0) throw new Err(AMT);
      const expected = cashExpected(st, b, now), c = { id: st.nextId++, t: now, by: u.name, branch: b, expected, counted, diff: counted - expected, note: str(p.note, 200) };
      (st.closes || (st.closes = [])).unshift(c); if (st.closes.length > 800) st.closes.length = 800;
      log(st, u.name, b, now, 'jard', `داخستنی قاصە: ژمێردراو ${money(st, counted)} — ${c.diff === 0 ? 'ڕاستە' : (c.diff < 0 ? 'کەمە ' : 'زیادە ') + money(st, Math.abs(c.diff))}`);
      return { id: c.id };
    }],
    setTarget: [1, (st, u, p) => {
      if (u.role !== 'owner') throw new Err('تەنها بەڕێوەبەر ئامانج دەگۆڕێت');
      if (!Number.isInteger(p.target) || !(p.target > 0)) throw new Err(AMT);
      st.target = p.target;
    }],
    markRead: [1, (st, u) => { st.unread[u.name] = 0; }]
  };
  const ACTIONS = {}; Object.keys(A).forEach(k => ACTIONS[k] = k === 'setTarget' ? 3 : A[k][0]); ACTIONS.jardSubmit = '1-2';

  /* ONE change. Throws Core.Err (state untouched) when a rule or a permission says no. */
  function apply(st, userName, action, payload, now) {
    const u = acct(st, userName), a = has(A, action) ? A[action] : null;
    if (!u || !a) throw new Err(BAD);
    if (LV[u.role] < a[0]) throw new Err(a[0] === 3 ? OWNER_ONLY : DENIED);
    const p = payload && typeof payload === 'object' ? payload : {};
    if (!sane(p, 0)) throw new Err(BAD);
    br(st, u, p);
    return a[1](st, u, p, now == null ? new Date(0) : now) || {};
  }

  /* the copy one person may receive: never a password hash, and only what their level may see */
  /* cash that should be in a branch drawer today: cash sales + cash debt payments - cash given back - expenses */
  function cashExpected(st, b, now) {
    const t0 = dayStart(st, now), td = x => ms(x.t) >= t0;
    let c = 0;
    st.sales.forEach(x => { if (x.branch === b && td(x) && x.pay === 'cash') c += x.total; (x.rets || []).forEach(r => { if (r.branch === b && td(r)) c -= r.cash; }); });
    st.payments.forEach(x => { if (x.branch === b && td(x) && x.method !== 'fib') c += x.amt; });
    st.expenses.forEach(x => { if (x.branch === b && td(x)) c -= x.amt; });
    return c;
  }
  /* start clean for real use: every test sale, log line, count and payment goes; items, customers, accounts and settings stay */
  function resetActivity(st, seedItems, seedCustomers) {
    ['sales', 'expenses', 'payments', 'purchases', 'exchanges', 'approvals', 'log', 'jards', 'ledger', 'notes', 'closes'].forEach(k => st[k] = []);
    st.unread = {}; st.nextNo = 20001; st.adjusted = 0; st.jardAdj = 0;
    const si = new Map((seedItems || []).map(x => [x.id, x])), sc = new Map((seedCustomers || []).map(x => [x.id, x]));
    st.items.forEach(i => { delete i.f; const x = si.get(i.id); if (x) { i.s = x.s.slice(); i.r = cents(x.r); i.w = cents(x.w); } });
    st.customers.forEach(c => { const x = sc.get(c.id); c.debt = x ? cents(x.debt) : 0; });
  }
  function project(st, userName) {
    const u = acct(st, userName); if (!u) throw new Err(BAD);
    const lv = LV[u.role], own = lv === 3, cut = (o, k) => { const c = { ...o }; delete c[k]; return c; };
    const out = {
      branches: st.branches, cur: st.cur, rate: st.rate, rates: st.rates, target: st.target, tz: st.tz == null ? 180 : st.tz, adjusted: st.adjusted || 0, jardAdj: st.jardAdj || 0,
      items: own ? st.items : st.items.map(i => cut(i, 'c')),
      customers: st.customers,
      team: st.team.map(t => { const o = { name: t.name, role: t.role, branch: t.branch }; if (t.role !== 'owner' && (own || t.name === u.name)) { o.pct = t.pct; o.salary = t.salary; o.salaryCur = t.salaryCur; } if (own) o.pw = !!t.pw; return o; }),
      sales: own ? st.sales : st.sales.map(s => ({ ...s, lines: s.lines.map(l => cut(l, 'cost')) })),
      expenses: lv > 1 ? st.expenses : [],
      payments: st.payments,
      purchases: own ? st.purchases : lv > 1 ? st.purchases.map(x => cut(x, 'cost')) : [],
      exchanges: st.exchanges,
      approvals: own ? st.approvals : st.approvals.filter(a => a.by === u.name),
      log: st.log.filter(e => e.toUser ? (own || e.toUser === u.name) : (e.to === 'all' || lv > 1)),
      unread: { [u.name]: st.unread[u.name] || 0 },
      jards: lv > 1 ? st.jards : st.jards.filter(j => j.by === u.name),
      ledger: own ? st.ledger : st.ledger.filter(x => x.to === u.name),
      notes: own ? st.notes : st.notes.filter(n => n.to === 'all' || (Array.isArray(n.to) && n.to.includes(u.name))),
      closes: lv > 1 ? (st.closes || []) : (st.closes || []).filter(c => c.by === u.name).map(c => ({ id: c.id, t: c.t, by: c.by, branch: c.branch, counted: c.counted, note: c.note })) // staff never learn what the system expected
    };
    return JSON.parse(JSON.stringify(out));
  }

  /* give an account a new name everywhere it is written: receipts, log, pay, notes, unread counters */
  function rename(st, from, to) {
    if (!from || !to || from === to || !st.team.some(u => u.name === from) || st.team.some(u => u.name === to)) return false;
    const walk = o => {
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { if (o[i] === from) o[i] = to; else if (o[i] && typeof o[i] === 'object') walk(o[i]); } return; }
      for (const k of Object.keys(o)) { const v = o[k]; if ((k === 'by' || k === 'toUser' || k === 'to' || k === 'name') && v === from && !(k === 'name' && o.price !== undefined)) o[k] = to; else if (v && typeof v === 'object') walk(v); }
    };
    st.team.find(u => u.name === from).name = to;
    ['sales', 'expenses', 'payments', 'purchases', 'exchanges', 'approvals', 'log', 'jards', 'ledger', 'notes', 'rates'].forEach(k => { if (st[k]) walk(st[k]); });
    if (st.unread && from in st.unread) { st.unread[to] = (st.unread[to] || 0) + st.unread[from]; delete st.unread[from]; }
    return true;
  }
  return { Err, LV, ROLE, TYPES, PAY, LK, SHARED, ACTIONS, init, apply, project, rename, resetActivity, cashExpected, log, moves, refundCalc, fmtMoney, fmtCur, iqd, esc, cents, ms, isoD, dayStart, pctTxt };
});

// online mode: public address + public (anon) key only. No secret belongs in this file.
window.KOGA_CONFIG = { url: "https://exayuyporjusmbxcwxzz.supabase.co", anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YXl1eXBvcmp1c21ieGN3eHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODA5MDcsImV4cCI6MjExMDI1NjkwN30.2l0ESALTYmhkezSzeZNeLK5SSh_treH_-Tx2O5Ifm3E" };

/* وەستا غەریب — نموونەی دیزاین. هەموو پارەکان بە سەنت (ژمارەی تەواو) هەژمار دەکرێن تا هیچ کەم و زیادێک ڕوو نەدات. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cents = n => Math.round(Number(n) * 100);
const money = c => `<span class="num">${fmtMoney(c)}</span>`;
const hm = d => `<span class="num">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span>`;
const IC = {
  dash: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  pos: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  returns: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  items: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  customers: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.8M16 3.2a3.5 3.5 0 0 1 0 6.6',
  expenses: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V6a2 2 0 0 1 2-2h11v3M17 13.5h.01',
  sales: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  log: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  jard: 'M9 4h6v3H9zM9 5H5v16h14V5h-4M9 13l2 2 4-4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.3-1.3L14 3h-4l-.3 2.5a7 7 0 0 0-2.3 1.3l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.3 1.3L10 21h4l.3-2.5a7 7 0 0 0 2.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 10v.01M17.5 14v.01',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14',
  alert: 'M12 8v5M12 17h.01M10.3 3.6 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'
};
const MO = () => !window.__noMotion && !matchMedia('(prefers-reduced-motion:reduce)').matches;
const iqd = c => Core.iqd(S, c); // dinar, rounded to the smallest note (250)
const fmtMoney = c => Core.fmtMoney(S, c);
const CUR = () => S.cur === 'IQD' ? 'دینار' : '$';
const toC = v => S.cur === 'IQD' ? Math.round(pn(v, true) / S.rate * 100) : Math.round(pn(v) * 100); // typed amount -> cents
const amtOut = c => S.cur === 'IQD' ? String(iqd(c)) : (c / 100).toFixed(2);
function countUp(el, to, f, from = 0, dur = 1100) {
  const put = v => el.textContent = f === 'int' ? Math.round(v).toLocaleString('en-US') : fmtMoney(Math.round(v));
  if (!MO() || from === to) return put(to);
  const tok = el._cu = {}; let t0 = null;
  const step = now => { if (el._cu !== tok) return; if (t0 === null) t0 = now; const k = Math.max(0, Math.min(1, (now - t0) / dur)), e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k); put(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { if (el._cu === tok) { el._cu = null; put(to); } }, dur + 120); // always land on the exact value
}
const cu = (c, id = '') => `<b class="num" ${id ? `id="${id}"` : ''} data-cu="${c}" data-f="money">${fmtMoney(c)}</b>`;
const cuInt = (n, id = '') => `<b class="num" ${id ? `id="${id}"` : ''} data-cu="${n}" data-f="int">${n.toLocaleString('en-US')}</b>`;
const runCU = root => root.querySelectorAll('[data-cu]').forEach(el => countUp(el, +el.dataset.cu, el.dataset.f));
const bat = st => {
  const l = st <= 0 ? 0 : st <= 5 ? 1 : st <= 20 ? 2 : st <= 60 ? 3 : st <= 150 ? 4 : 5, C = 43.98;
  if (!l) return `<span class="stk l0"><i></i>نەماوە</span>`;
  return `<span class="stk l${l}"><svg viewBox="0 0 18 18" width="18" height="18"><circle class="t" cx="9" cy="9" r="7"/><circle class="v" cx="9" cy="9" r="7" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - l / 5)).toFixed(2)}"/></svg><span class="num">${st}</span></span>`;
};
const ico = (k, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[k]}"/></svg>`;

/* config.js present = online mode (the server owns the data); without it everything stays on this device */
const REMOTE = window.KOGA_CONFIG && window.KOGA_CONFIG.url ? window.KOGA_CONFIG : null;
const net = { token: null, v: null, tick: null, chain: Promise.resolve(), busy: false, stale: false };
const S = Object.assign(Core.init(SEED_ITEMS, SEED_CUSTOMERS, new Date()), {
  session: null, count: {}, jardFilter: '', jardQ: '',
  me: null, branch: 0, dashBranch: -1, view: 'pos', q: '', cat: 'هەموو', itemFilter: 'all', cart: null
});
const EXP_CATS = ['ڕاتب', 'کرێی دوکان', 'خەرجی', 'پەرداخ', 'نایلۆن', 'هیتر'];
const TYPES = { retail: 'تاک', wholesale: 'جوملە', delivery: 'دلیڤەری' };
const newCart = () => ({ type: 'retail', lines: [], customer: null, pay: 'cash', fibRef: '', fibOk: false, disc: 0, req: null });
const PAY = { cash: ['g', 'کاش'], fib: ['b', 'FIB'], debt: ['a', 'قەرز'] };
const payTag = k => `<span class="tag ${PAY[k][0]}">${PAY[k][1]}</span>`;
S.cart = newCart();
/* پسولە ڕاستەقینەکانی ئەمڕۆ لە سیستەمە کۆنەکە (تەنها کۆی پارە؛ وردەکاریی کاڵاکانیان لەوێیە) */
if (!REMOTE) [[10939, '09:18', 2071], [10940, '09:21', 2959], [10941, '09:23', 888], [10942, '09:27', 2071], [10943, '09:45', 888], [10944, '10:06', 2959], [10945, '10:17', 11800, 'wholesale'], [10946, '10:58', 888], [10955, '13:59', 3254], [10960, '16:02', 5338], [10961, '16:05', 4438]].forEach(([no, hm, total, type]) => {
  const t = new Date(); t.setHours(+hm.slice(0, 2), +hm.slice(3), 0, 0);
  S.sales.unshift({ no, t, branch: 0, by: 'qara', type: type || 'retail', pay: 'cash', customer: null, lines: [], sub: total, disc: 0, total, refunded: 0, legacy: true });
  S.log.unshift({ t, kind: 'sale', text: `پسولەی <b class="num">#${no}</b> بە <span class="num">${fmtMoney(total)}</span> <span class="tag n">سیستەمی کۆن</span>`, by: 'qara', branch: 0, to: 'owner' });
});
const ROLE = { owner: 'بەڕێوەبەر', sup: 'سوپەرڤایزەر', staff: 'کارمەند' }, LV = { owner: 3, sup: 2, staff: 1 };
const acct = n => S.team.find(u => u.name === n);
const me = () => { const u = acct(S.me); return { name: u.name, role: u.role, lvl: LV[u.role], branch: u.branch, label: ROLE[u.role] + (u.branch >= 0 ? ' · ' + S.branches[u.branch] : '') }; };
const isOwner = () => me().role === 'owner';
const lvl = () => me().lvl;
/* numbers typed with a Kurdish/Arabic keyboard (0123 or ۰۱۲۳) must work everywhere */
const latin = s => String(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/٫/g, '.');
const pn = (v, dinar) => { let x = latin(v ?? '').replace(/[\s,،]/g, ''); if (dinar && /^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, ''); return Number(x); };
document.addEventListener('input', e => { const el = e.target; if (!el.matches || !el.matches('input.num,#q,#jQ,#cQ') || el.type === 'date') return; const v = latin(el.value); if (v !== el.value) { const c = el.selectionStart; el.value = v; try { el.setSelectionRange(c, c); } catch (x) {} } }, true);
/* the sample remembers everything on this device */
const KEY = 'koga_sample_v3';
function save() { if (window.__noSave || REMOTE) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function load() { if (window.__noSave) return; try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S, JSON.parse(raw, (k, v) => k === 't' && typeof v === 'string' ? new Date(v) : v)); } catch (e) {} }
let saveT; ['click', 'change', 'input'].forEach(ev => document.addEventListener(ev, () => { clearTimeout(saveT); saveT = setTimeout(save, 400); }));
const hash = x => { let a = 0xdeadbeef, b = 0x41c6ce57; for (let i = 0; i < x.length; i++) { const c = x.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); } a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909); return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36); };
const pwHash = (name, pw) => hash('koga|' + name + '|' + pw);
const item = id => S.items.find(i => i.id === id);
const cust = id => S.customers.find(c => c.id === id);
const priceOf = it => S.cart.type === 'wholesale' ? it.w : it.r;

/* ---------- log + notifications ---------- */
function announce(n) { // n new entries on top of S.log: bell + phone-style notice
  save(); drawBell(); if (!(n > 0)) return;
  for (let i = n - 1; i >= 0; i--) push(S.log[i]);
  const b = $('#bell'); b.classList.remove('rung'); void b.offsetWidth; b.classList.add('rung');
}
/* ---------- one door for every change ---------- */
function run(action, payload, onOk) {
  payload = Object.assign({ branch: S.branch }, payload);
  if (REMOTE) return void runRemote(action, payload, onOk);
  const n0 = S.log.length; let r;
  try { r = Core.apply(S, S.me, action, payload, new Date()); } catch (e) { if (e instanceof Core.Err) return void toast(e.message, 1); throw e; }
  announce(S.log.length - n0); if (onOk) onOk(r);
}
function quiet(action, payload) { // small housekeeping that must never block the screen (read mark, voided request)
  payload = Object.assign({ branch: S.branch }, payload);
  if (REMOTE && S.me !== S.session) return;
  try { Core.apply(S, S.me, action, payload, new Date()); } catch (e) { if (e instanceof Core.Err) return; throw e; }
  if (REMOTE) call(action, payload).then(j => { if (takeSnap(j)) net.stale = true; }).catch(() => {}); else save();
  drawBell();
}
/* ---------- online mode: the server keeps the data, this screen only shows its own copy ---------- */
const TOK = 'koga_token_v1', revive = (k, v) => k === 't' && typeof v === 'string' ? new Date(v) : v;
const srv = () => REMOTE.url.replace(/\/+$/, ''), keyH = () => ({ apikey: REMOTE.anon, Authorization: 'Bearer ' + REMOTE.anon });
function call(action, payload, as) { // one request at a time, in order
  const body = JSON.stringify({ token: net.token, action, payload: payload || {}, as: as || undefined, space: REMOTE.space || undefined }); // space 'test' = the separate practice shop
  const p = net.chain.then(() => api(body)); net.chain = p.catch(() => {}); return p;
}
async function api(body) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000); let txt = '';
  try { const r = await fetch(srv() + '/functions/v1/koga', { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, keyH()), body }); txt = await r.text(); }
  catch (e) { throw new Error('پەیوەندی لەگەڵ سێرڤەر نەکرا؛ ئینتەرنێتەکەت بپشکنە'); }
  finally { clearTimeout(tm); }
  let j = null; try { j = JSON.parse(txt, revive); } catch (e) {}
  if (!j || !j.ok) { const e = new Error((j && j.error) || 'سێرڤەر وەڵامی نەدایەوە؛ دووبارە هەوڵ بدەوە'); e.code = j && j.code; throw e; }
  return j;
}
function takeSnap(j) { // replace the shared part of S with the server's copy; screen state stays
  if (!j.state || (net.v != null && j.v != null && j.v < net.v)) return false;
  Core.SHARED.forEach(k => { if (k in j.state) S[k] = j.state[k]; });
  net.v = j.v; S.session = j.me.name;
  if (!acct(S.me)) S.me = S.session;
  if (S.branch >= S.branches.length) S.branch = 0;
  if (S.cart) { S.cart.lines = S.cart.lines.filter(l => item(l.id)); if (S.cart.customer && !cust(S.cart.customer)) S.cart.customer = null; }
  return true;
}
const logTop = () => S.log.length ? Core.ms(S.log[0].t) : 0;
const newOnTop = top => { let n = 0; while (n < S.log.length && n < 3 && Core.ms(S.log[n].t) > top) n++; return n; };
const viewAs = () => S.me && S.me !== S.session ? S.me : null;
function dropSession() { net.token = null; net.v = null; try { localStorage.removeItem(TOK); } catch (e) {} S.session = S.me = null; }
function netFail(e) { if (e.code === 'auth') { dropSession(); closeModal(); showLogin(e.message); } else toast(e.message, 1); }
async function runRemote(action, payload, onOk) {
  if (viewAs()) return toast('لە «بینین وەک» تەنها سەیر دەکرێت؛ بۆ گۆڕانکاری بگەڕێوە سەر ئەکاونتی خۆت', 1);
  if (net.busy) return; // no double submit while the server is answering
  net.busy = true; document.documentElement.style.cursor = 'progress';
  let j = null, err = null;
  try { j = await call(action, payload); } catch (e) { err = e; }
  net.busy = false; document.documentElement.style.cursor = '';
  if (err) return netFail(err);
  const top = logTop(); takeSnap(j); announce(newOnTop(top)); if (onOk) onOk(j.result || {});
}
function signIn(action, payload, fail) {
  if (net.busy) return; net.busy = true;
  call(action, payload).then(j => { net.busy = false; net.token = j.result.token; try { localStorage.setItem(TOK, net.token); } catch (e) {} net.v = null; takeSnap(j); enter(j.me.name); }, e => { net.busy = false; fail(e.message); });
}
function softRefresh() { // new data arrived: redraw without touching an open sheet, a field being typed in, or the basket
  const a = document.activeElement, typing = !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !(a.id === 'q' && S.view === 'pos');
  drawBell();
  if (!S.me || $('#login').className || $('#modal').classList.contains('on') || $('#drawer').classList.contains('on') || $('#charge').className) return;
  if (typing && !(S.view === 'pos' && a.closest('#cart'))) return;
  if (!NAV.some(n => n[0] === S.view && lvl() >= n[3])) S.view = lvl() > 1 ? 'dash' : 'pos';
  if (S.view === 'pos' && $('#grid')) { drawGrid(); if (typing) return; shell(); drawCart(); net.stale = false; return; }
  net.stale = false; shell();
  if (S.view === 'returns' && retNo) V.returns(retNo); else if (S.view === 'customers' && $('#cQ')) V.customers($('#cQ').value); else drawView();
}
async function poll() { // a tiny number tells every screen that something changed
  if (!net.token || !S.session || net.busy || document.hidden) return;
  try {
    const r = await fetch(srv() + '/rest/v1/koga_tick?id=eq.' + (REMOTE.space === 'test' ? 2 : 1) + '&select=v', { headers: keyH() }), a = await r.json(), v = a && a[0] ? a[0].v : null;
    if (v != null && v !== net.tick && net.token && !net.busy) { // sync once per new number, even if a tick was lost
      if (v !== net.v) { const top = logTop(), j = await call('sync', {}, viewAs()); if (takeSnap(j)) { net.stale = true; announce(newOnTop(top)); } }
      net.tick = v;
    }
  } catch (e) { if (e.code === 'auth') return netFail(e); }
  if (net.stale) softRefresh();
}
function boot() { // online start: an old session token, or the login screen
  try { net.token = localStorage.getItem(TOK); } catch (e) {}
  if (!net.token) return showLogin();
  loginCard('<p class="mute">پەیوەندی بە سێرڤەرەوە دەکرێت…</p>');
  call('sync').then(j => { takeSnap(j); enter(j.me.name); }, e => { if (e.code === 'auth') { dropSession(); showLogin(); } else loginCard(`<p class="lerr">${esc(e.message)}</p><button class="btn volt big" id="lre">دووبارە هەوڵدان</button>`); });
}
const LHEAD = '<span class="bolt"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.8z"/></svg></span><h1>وەستا غەریب</h1>';
function loginCard(html) { const L = $('#login'); L.className = 'on'; L.onkeydown = null; L.innerHTML = `<div class="lcard">${LHEAD}${html}</div>`; if ($('#lre')) $('#lre').onclick = boot; }
if (REMOTE) ['click', 'keydown', 'change'].forEach(ev => document.addEventListener(ev, e => { if (net.busy) { e.stopPropagation(); e.preventDefault(); } }, true));
const pwArg = (name, v) => REMOTE ? { password: v } : { pw: v.length < 6 ? null : pwHash(name, v) }; // online the server hashes
function push(e) {
  if (!MO()) return;
  const d = document.createElement('div'); d.className = 'push';
  d.innerHTML = `<div class="dot ${KIND[e.kind][0]}">${ico(KIND[e.kind][1], 17)}</div><div><small>${e.toUser ? 'پەیام بۆ ' + esc(e.toUser) : e.to === 'all' ? 'ئاگەداری بۆ هەمووان' : 'ئاگەداری بۆ مۆبایلی بەڕێوەبەر'}</small><p>${e.text}</p></div>`;
  $('#push').prepend(d); setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 4200);
}
const KIND = { sale: ['g', 'pos'], ret: ['r', 'returns'], swap: ['b', 'returns'], stock: ['b', 'items'], req: ['a', 'alert'], ok: ['g', 'check'], no: ['r', 'x'], pay: ['g', 'expenses'], msg: ['b', 'trophy'], jard: ['b', 'jard'], cur: ['a', 'gear'], exp: ['n', 'expenses'], price: ['a', 'items'], cust: ['n', 'customers'] };
const feedRow = (e, i = 0) => `<div class="item" style="--i:${i}"><div class="dot ${KIND[e.kind][0]}">${ico(KIND[e.kind][1], 17)}</div><div class="grow"><p>${e.text}</p><small>${esc(e.by)} · ${esc(S.branches[e.branch])} · ${hm(e.t)}</small></div></div>`;
const myFeed = () => S.log.filter(e => e.toUser ? (isOwner() || e.toUser === S.me) : (e.to === 'all' || lvl() > 1));
function drawBell() { const n = S.unread[S.me] || 0, b = $('#bellN'); if (b.textContent !== String(n)) { b.classList.remove('show'); void b.offsetWidth; } b.textContent = n; b.classList.toggle('show', n > 0); }
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => t.className = 'toast', 2600); }
const DESK = () => matchMedia('(hover:hover) and (pointer:fine)').matches && innerWidth > 760;   // a computer with a mouse
const autoFocus = el => { if (el && DESK()) el.focus(); };
/* while a sheet is open the page behind it must not move (phones scroll the page under a finger otherwise) */
let lockY = 0;
function lockPage(on) {
  const b = document.body, h = document.documentElement;
  if (on && !h.classList.contains('locked')) { lockY = scrollY; h.classList.add('locked'); b.style.top = -lockY + 'px'; }
  else if (!on && h.classList.contains('locked')) { h.classList.remove('locked'); b.style.top = ''; scrollTo(0, lockY); }
}
function modal(html) { $('#sheet').innerHTML = html; $('#modal').classList.add('on'); $('#sheet').scrollTop = 0; lockPage(true); autoFocus($('#sheet input:not([type=hidden]),#sheet textarea')); }
function closeModal() { $('#modal').classList.remove('on'); if (!$('#drawer').classList.contains('on')) lockPage(false); }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
$('#bell').onclick = () => { $('#feed').innerHTML = myFeed().map(feedRow).join('') || `<div class="empty"><b>هیچ ئاگەدارییەک نییە</b>هەر فرۆشتن و گەڕاندنەوەیەک لێرە دەردەکەوێت</div>`; $('#drawer').classList.add('on'); lockPage(true); if (S.unread[S.me]) quiet('markRead'); drawBell(); };
$('#drawerX').onclick = () => { $('#drawer').classList.remove('on'); if (!$('#modal').classList.contains('on')) lockPage(false); };

/* ---------- shell ---------- */
const NAV = [ // [view, title, icon, minimum level]
  ['dash', 'داشبۆرد', 'dash', 2], ['pos', 'فرۆشتن', 'pos', 1], ['returns', 'گەڕاندنەوە', 'returns', 2],
  ['items', 'کاڵا و کۆگا', 'items', 2], ['customers', 'کڕیار و قەرز', 'customers', 1, 'کڕیار'], ['expenses', 'مەسروفات', 'expenses', 2],
  ['sales', 'پسولەکان', 'sales', 2], ['jard', 'جەردی ڕۆژانە', 'jard', 1, 'جەرد'], ['perf', 'مووچە', 'cash', 1], ['team', 'ئەکاونتەکان', 'customers', 3], ['log', 'تۆماری کارەکان', 'log', 3], ['settings', 'ڕێکخستنەکان', 'gear', 3]
];
const navItems = () => NAV.filter(n => lvl() >= n[3]);
function acctBox() {
  const boss = acct(S.session) && acct(S.session).role === 'owner';
  return `${boss ? `<label class="f" style="margin:0;font-size:11px">بینین وەک (تەنها بەڕێوەبەر)<select class="inp va" style="padding:8px 10px">${S.team.map(u => `<option value="${esc(u.name)}" ${u.name === S.me ? 'selected' : ''}>${esc(u.name)} — ${ROLE[u.role]}</option>`).join('')}</select></label>` : ''}<button class="ghost sm lo">چوونەدەرەوە</button>`;
}
function bindAcct(root) { const v = root.querySelector('.va'); if (v) v.onchange = e => { closeModal(); setRole(v.value, e); }; root.querySelector('.lo').onclick = () => { closeModal(); logout(); }; }
function moreSheet() {
  modal(`<h2>هەموو بەشەکان</h2><div class="more">${navItems().map(n => `<button data-mv="${n[0]}" class="${S.view === n[0] ? 'on' : ''}">${ico(n[2], 22)}<span>${n[1]}</span></button>`).join('')}</div><div style="display:grid;gap:10px;margin-top:16px">${acctBox()}</div>`);
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { closeModal(); go(b.dataset.mv); }); bindAcct($('#sheet'));
}
function shell() {
  const pend = S.approvals.filter(a => a.status === 'wait').length, all = navItems(), phone = innerWidth <= 760;
  const main = phone && all.length > 5 ? all.filter(n => ['dash', 'pos', 'jard', 'perf'].includes(n[0])).slice(0, 4) : all;
  $('#nav').innerHTML = main.map(n => `<a data-nav="${n[0]}" class="${S.view === n[0] ? 'on' : ''}">${ico(n[2], 19)}<span>${phone && n[4] ? n[4] : n[1]}</span>${n[0] === 'dash' && pend && isOwner() ? `<em class="num">${pend}</em>` : ''}</a>`).join('') + (phone ? `<a data-nav="__more" class="${main.some(n => n[0] === S.view) ? '' : 'on'}">${ico('dash', 19)}<span>زیاتر</span></a>` : '');
  $('#nav').querySelectorAll('a').forEach(a => a.onclick = () => a.dataset.nav === '__more' ? moreSheet() : go(a.dataset.nav));
  $('#whoAv').textContent = me().name[0].toUpperCase(); $('#whoName').textContent = me().name; $('#whoRole').textContent = me().label + (S.me !== S.session ? ' · بینین' : '');
  $('#acctBox').innerHTML = acctBox(); bindAcct($('#acctBox'));
  $('#title').textContent = NAV.find(n => n[0] === S.view)[1];
  const seg = $('#branchSeg');
  if (lvl() > 1) {
    const opts = S.view === 'dash' ? [[-1, innerWidth < 760 ? 'هەموو' : 'هەموو لقەکان'], ...S.branches.map((b, i) => [i, b])] : S.branches.map((b, i) => [i, b]);
    const cur = S.view === 'dash' ? S.dashBranch : S.branch;
    seg.innerHTML = opts.map(o => `<button data-br="${o[0]}" class="${cur === o[0] ? 'on' : ''}">${esc(o[1])}</button>`).join('');
    seg.querySelectorAll('[data-br]').forEach(b => b.onclick = () => { const v = +b.dataset.br; if (S.view === 'dash') S.dashBranch = v; else { if (S.cart.lines.length && v !== S.branch) { toast('سەرەتا سەبەتەکە بەتاڵ بکە', 1); return; } S.branch = v; } render(true); });
  } else seg.innerHTML = `<button class="on">${esc(S.branches[S.branch])}</button>`;
  $('#rateChip').textContent = '100$ = ' + (S.rate * 100).toLocaleString('en-US') + ' د.ع';
  drawBell();
  const place = () => { const on = $('#nav a.on'), ind = $('#navInd'); if (on) { ind.style.transform = `translateY(${on.offsetTop}px)`; if (on.scrollIntoView && innerWidth > 760) on.scrollIntoView({ block: 'nearest' }); } };
  place(); requestAnimationFrame(place);
}
function go(v) { S.view = v; render(true); window.scrollTo(0, 0); }
function setRole(who, ev) { // "view as": open another account's screen (by name, or first account of a level)
  const u = acct(who) || S.team.find(t => t.role === who);
  if (!u || u.name === S.me) return;
  const act = () => {
    S.me = u.name;
    if (lvl() === 1 && me().branch >= 0) S.branch = me().branch;
    if (lvl() < NAV.find(n => n[0] === S.view)[3] || S.view === 'pos' || S.view === 'dash') S.view = lvl() > 1 ? 'dash' : 'pos';
    render(true);
  };
  const show = () => {
    if (MO() && document.startViewTransition) {
      const r = ((ev && ev.currentTarget) || $('#acctBox')).getBoundingClientRect(), st = document.documentElement.style;
      st.setProperty('--vx', (r.left + r.width / 2) + 'px'); st.setProperty('--vy', (r.top + r.height / 2) + 'px');
      document.startViewTransition(act);
    } else act();
    toast('ئێستا وەک «' + u.name + '» (' + ROLE[u.role] + ') دەیبینیت');
  };
  if (!REMOTE) return show();
  if (net.busy) return; net.busy = true; // online: ask the server for that person's own copy (read-only)
  call('sync', {}, u.name === S.session ? null : u.name).then(j => { net.busy = false; net.v = null; takeSnap(j); show(); }, e => { net.busy = false; netFail(e); });
}
function showLogin(msg, info) {
  if (REMOTE && !info) { // online: the server says who can log in
    loginCard(`<p class="mute">پەیوەندی بە سێرڤەرەوە دەکرێت…</p><p class="lerr" id="lerr">${msg || ''}</p>`);
    call('hello').then(j => showLogin(msg, j.result), e => loginCard(`<p class="lerr">${esc(e.message)}</p><button class="btn volt big" id="lre">دووبارە هەوڵدان</button>`));
    return;
  }
  const boss = info ? { name: info.owner, pw: !info.first } : S.team.find(u => u.role === 'owner'), first = !boss.pw, L = $('#login'), ready = info ? info.accounts : S.team.filter(u => u.pw);
  L.className = 'on';
  L.innerHTML = `<div class="lcard">${LHEAD}
    <p class="mute">${first ? 'یەکەم جارە: وشەی نهێنیی بەڕێوەبەر (' + esc(boss.name) + ') دابنێ. دواتر تەنها تۆ ئەکاونت بۆ کارمەندەکان دروست دەکەیت.' : 'بۆ چوونەژوورەوە ئەکاونتەکەت هەڵبژێرە و وشەی نهێنی بنووسە.'}</p>
    ${first ? `<label class="f">وشەی نهێنیی نوێ (لانی کەم 6 پیت)<input class="inp" id="lp1" type="password" autocomplete="new-password"></label><label class="f">دووبارەی بنووسەوە<input class="inp" id="lp2" type="password" autocomplete="new-password"></label>${info && info.needCode ? '<label class="f">کۆدی دامەزراندن (یەک جار)<input class="inp num" id="lcode" type="text" autocomplete="off"></label>' : ''}`
      : `<label class="f">ئەکاونت<select class="inp" id="lu">${ready.map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('')}</select></label><label class="f">وشەی نهێنی<input class="inp" id="lp" type="password" autocomplete="current-password"></label>`}
    <button class="btn volt big" id="lgo">${first ? 'دانان و چوونەژوورەوە' : 'چوونەژوورەوە'}</button><p class="lerr" id="lerr">${msg || ''}</p></div>`;
  const fail = m => { $('#lerr').textContent = m; const c = L.querySelector('.lcard'); c.classList.remove('shk'); void c.offsetWidth; c.classList.add('shk'); };
  $('#lgo').onclick = () => {
    if (first) { const a = $('#lp1').value, b = $('#lp2').value; if (a.length < 6) return fail('وشەی نهێنی دەبێت لانی کەم 6 پیت بێت'); if (a !== b) return fail('دوو وشەکە وەک یەک نین'); if (REMOTE) return signIn('setup', { password: a, code: $('#lcode') ? $('#lcode').value.trim() : '' }, fail); boss.pw = pwHash(boss.name, a); return enter(boss.name); }
    if (REMOTE) return signIn('login', { name: $('#lu').value, password: $('#lp').value }, fail);
    const u = acct($('#lu').value); if (!u || u.pw !== pwHash(u.name, $('#lp').value)) return fail('وشەی نهێنی هەڵەیە'); enter(u.name);
  };
  L.onkeydown = e => { if (e.key === 'Enter') $('#lgo').click(); };
  const f = L.querySelector('input'); if (f) f.focus();
}
function enter(name) { S.session = S.me = name; if (me().branch >= 0) S.branch = me().branch; S.view = lvl() > 1 ? 'dash' : 'pos'; S.cart = newCart(); $('#login').className = ''; $('#login').innerHTML = ''; render(true); save(); }
function logout() { if (REMOTE) { if (net.token) call('logout').catch(() => {}); dropSession(); return showLogin(); } S.session = S.me = null; save(); showLogin(); }
const REVEAL = '#view>*:not(.pos):not(.hero):not(.two):not(.kgrid):not(.kpis):not(.brs):not(.cartbar),.pos>*,.hero>*,.kgrid>*,.kpis>*,.brs>*,.two>*>.card,.two>.card';
function render(enter) {
  if (!$('#modal').classList.contains('on') && !$('#drawer').classList.contains('on')) lockPage(false);
  shell(); drawView(); save();
  if (!enter) return;
  const vw = $('#view');
  vw.querySelectorAll(REVEAL).forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--i', i); });
  vw.querySelectorAll('.prod').forEach((el, i) => el.style.setProperty('--i', i));
  vw.querySelectorAll('table tr').forEach((el, i) => el.style.setProperty('--i', i));
  vw.classList.remove('enter'); void vw.offsetWidth; vw.classList.add('enter'); runCU(vw);
  clearTimeout(render.h); render.h = setTimeout(() => vw.classList.remove('enter'), 1900);
}
setInterval(() => { const c = $('#clock'); if (c) c.textContent = new Date().toTimeString().slice(0, 8); }, 1000);
document.addEventListener('mousemove', e => { const p = e.target.closest && e.target.closest('.prod'); if (!p) return; const r = p.getBoundingClientRect(); p.style.setProperty('--mx', (e.clientX - r.left) + 'px'); p.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
document.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); if (S.view !== 'pos') go('pos'); $('#q').focus(); } if (e.key === 'Escape') { $('#drawer').classList.remove('on'); closeModal(); } });

/* ---------- POS ---------- */
const V = {};
V.pos = () => {
  const cats = ['هەموو', ...new Set(S.items.map(i => i.cat))];
  $('#view').innerHTML = `<div class="pos"><div>
    <div class="search">${ico('search', 22)}<input class="inp" id="q" placeholder="بارکۆد سکان بکە یان ناوی کاڵا بنووسە…" autocomplete="off" value="${esc(S.q)}"><kbd><span class="scan"></span>F2</kbd></div>
    <div class="chips">${cats.map(c => `<button class="chip ${S.cat === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="grid" id="grid"></div></div>
    <div class="card cart" id="cart"></div></div><button class="cartbar" id="cartbar"></button>`;
  $('#cartbar').onclick = () => { $('#cart').classList.add('open'); lockPage(true); };
  const q = $('#q');
  q.oninput = () => { S.q = q.value; $('#view').classList.remove('enter'); drawGrid(); };
  q.onkeydown = e => { if (e.key !== 'Enter') return; const hit = S.items.filter(i => i.bc && i.bc === S.q.trim()); if (hit.length === 1) { addLine(hit[0].id); S.q = q.value = ''; drawGrid(); } else if (hit.length > 1) toast('ئەم بارکۆدە بۆ ' + hit.length + ' کاڵا بەکارهاتووە، یەکێکیان هەڵبژێرە', 1); else toast('هیچ کاڵایەک بەم بارکۆدە نییە', 1); };
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => { S.cat = c.dataset.c; V.pos(); });
  drawGrid(); drawCart(); autoFocus(q);
};
function drawGrid() {
  const t = S.q.trim().toLowerCase();
  const list = S.items.filter(i => (S.cat === 'هەموو' || i.cat === S.cat) && (!t || i.name.toLowerCase().includes(t) || i.bc.includes(t)));
  $('#grid').innerHTML = list.map(i => {
    const st = i.s[S.branch], p = priceOf(i), bad = st <= 0 || p <= 0;
    return `<button class="prod ${bad ? 'out' : ''}" data-id="${i.id}"><div class="nm">${esc(i.name)}</div><div class="bc num">${esc(i.bc) || '— بێ بارکۆد'}</div>
      <div class="row sp"><span class="pr">${p > 0 ? money(p) : '<span class="tag r">نرخی نییە</span>'}</span>${bat(st)}</div></button>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1"><b>هیچ کاڵایەک نەدۆزرایەوە</b>ناو یان بارکۆدێکی تر تاقی بکەوە</div>`;
  document.querySelectorAll('.prod').forEach(b => b.onclick = () => addLine(+b.dataset.id, 1, b));
}
function voidReq() { const c = S.cart; if (c.req) { quiet('voidRequest', { id: c.req }); c.req = null; c.disc = 0; toast('سەبەتەکە گۆڕا؛ داشکاندنەکە هەڵوەشایەوە', 1); } else if (c.disc) { c.disc = 0; } }
function fly(from, label) {
  if (!MO() || !from) return;
  const wide = innerWidth > 760, to = (wide ? $('#cart .cart-count') : $('#cartbar'));
  if (!to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), f = document.createElement('div');
  f.className = 'fly'; f.textContent = label; document.body.appendChild(f);
  const x0 = a.left + a.width / 2 - 30, y0 = a.top + a.height / 2 - 14, x1 = b.left + b.width / 2 - 30, y1 = b.top + b.height / 2 - 14;
  from.classList.remove('hit'); void from.offsetWidth; from.classList.add('hit');
  f.animate([{ transform: `translate(${x0}px,${y0}px) scale(1.15)`, opacity: 1 }, { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 90}px) scale(1)`, opacity: 1, offset: .45 }, { transform: `translate(${x1}px,${y1}px) scale(.35)`, opacity: .3 }], { duration: 560, easing: 'cubic-bezier(.3,.7,.3,1)' })
    .onfinish = () => { f.remove(); const c = $('#cart .cart-count'); if (c) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } };
}
function addLine(id, d = 1, from) {
  const it = item(id), c = S.cart, p = priceOf(it);
  if (p <= 0) return toast('ئەم کاڵایە نرخی ' + TYPES[c.type] + 'ی بۆ دانەنراوە', 1);
  let l = c.lines.find(x => x.id === id);
  const want = (l ? l.qty : 0) + d;
  if (want > it.s[S.branch]) return toast('لە ' + S.branches[S.branch] + ' تەنها ' + it.s[S.branch] + ' دانە ماوە', 1);
  voidReq();
  S.lastAdd = l ? null : id;
  if (!l) c.lines.push({ id, qty: 1 }); else { l.qty = want; if (l.qty <= 0) c.lines = c.lines.filter(x => x !== l); }
  drawCart(); if (d > 0) fly(from, fmtMoney(p));
}
const subTotal = () => S.cart.lines.reduce((a, l) => a + l.qty * priceOf(item(l.id)), 0);
function drawCart() {
  const c = S.cart, sub = subTotal(), req = c.req && S.approvals.find(a => a.id === c.req);
  if (req && req.status === 'ok') c.disc = req.amt;
  if (req && req.status === 'no') { c.req = null; c.disc = 0; }
  const disc = Math.min(c.disc, sub), total = sub - disc, waiting = req && req.status === 'wait';
  const needCust = c.type !== 'retail' || c.pay === 'debt';
  $('#cart').innerHTML = `<div class="cart-h"><div class="row sp"><h2>سەبەتە</h2><div class="row"><span class="tag n cart-count"><span class="num">${c.lines.reduce((a, l) => a + l.qty, 0)}</span> دانە</span><button class="ghost sm mclose" id="cartX">داخستن</button></div></div>
      <div class="seg" style="margin-top:12px">${Object.entries(TYPES).map(([k, v]) => `<button data-t="${k}" class="grow ${c.type === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${needCust ? `<select class="inp" id="cust" style="margin-top:10px"><option value="">— کڕیار هەڵبژێرە —</option>${S.customers.map(x => `<option value="${x.id}" ${c.customer === x.id ? 'selected' : ''}>${esc(x.name)}${x.phone ? ' · ' + esc(x.phone) : ''}</option>`).join('')}</select>` : ''}</div>
    <div class="cart-lines">${c.lines.map(l => { const it = item(l.id), p = priceOf(it); return `<div class="line ${S.lastAdd === l.id ? 'new' : ''}"><div class="nm">${esc(it.name)}</div><b>${money(l.qty * p)}</b><div class="qty"><button data-m="${l.id}">−</button><b class="num">${l.qty}</b><button data-p="${l.id}">+</button><small class="mute">× ${money(p)}</small></div><button class="mute sm" data-x="${l.id}">لابردن</button></div>`; }).join('') || `<div class="empty"><b>سەبەتەکە بەتاڵە</b>کاڵایەک سکان بکە یان لەسەری دابگرە</div>`}</div>
    <div class="cart-f">
      ${disc || waiting ? `<div class="row sp"><span>کۆی پێش داشکاندن</span>${money(sub)}</div><div class="row sp"><span>داشکاندن ${waiting ? '<span class="tag a">چاوەڕوانی ڕەزامەندیی بەڕێوەبەر</span>' : '<span class="tag g">ڕەزامەندی دراوە</span>'}</span><span>− ${money(waiting ? req.amt : disc)}</span></div>` : ''}
      <div class="tot"><span>کۆی گشتی</span><b class="num" id="totB">${fmtMoney(total)}</b></div>
      <div class="pay">${Object.keys(PAY).map(k => `<button data-pay="${k}" class="${c.pay === k ? 'on' : ''}">${PAY[k][1]}</button>`).join('')}</div>
      ${c.pay === 'fib' ? `<div class="fibbox"><input class="inp num" id="fibRef" placeholder="ژمارەی مامەڵەی FIB (پێویستە)" value="${esc(c.fibRef)}" autocomplete="off"><label class="chk"><input type="checkbox" id="fibOk" ${c.fibOk ? 'checked' : ''}><span>پارەکەم لە ئەپی FIB بینی و گەیشتووە</span></label></div>` : ''}
      <div class="row"><button class="ghost grow" id="discBtn" ${!c.lines.length || waiting ? 'disabled' : ''}>${isOwner() ? 'داشکاندن' : 'داواکاریی داشکاندن'}</button><button class="ghost" id="clearBtn" ${!c.lines.length ? 'disabled' : ''}>بەتاڵکردن</button></div>
      <button class="btn volt big" id="sellBtn" ${!c.lines.length || waiting ? 'disabled' : ''}>${waiting ? 'چاوەڕوانی ڕەزامەندی…' : 'فرۆشتن'}</button></div>`;
  const C = $('#cart'), tb = $('#totB'), prev = S.prevTotal || 0; S.lastAdd = null;
  if (prev !== total) { countUp(tb, total, 'money', prev, 420); if (MO()) tb.classList.add('flash'); } S.prevTotal = total;
  $('#cartX').onclick = () => { C.classList.remove('open'); lockPage(false); };
  const n = c.lines.reduce((a, l) => a + l.qty, 0); $('#cartbar').innerHTML = `<span>سەبەتە · <span class="num">${n}</span> دانە</span><b class="num">${fmtMoney(total)}</b>`; $('#cartbar').style.display = n ? '' : 'none';
  C.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (c.type === b.dataset.t) return; voidReq(); c.type = b.dataset.t; const bad = c.lines.filter(l => priceOf(item(l.id)) <= 0); if (bad.length) { c.lines = c.lines.filter(l => !bad.includes(l)); toast('کاڵای بێ نرخی ' + TYPES[c.type] + ' لابرا', 1); } drawGrid(); drawCart(); });
  C.querySelectorAll('[data-p]').forEach(b => b.onclick = () => addLine(+b.dataset.p, 1));
  C.querySelectorAll('[data-m]').forEach(b => b.onclick = () => addLine(+b.dataset.m, -1));
  C.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { voidReq(); c.lines = c.lines.filter(l => l.id !== +b.dataset.x); drawCart(); });
  C.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { c.pay = b.dataset.pay; if (c.pay !== 'fib') { c.fibOk = false; c.fibRef = ''; } drawCart(); });
  if ($('#fibRef')) { $('#fibRef').oninput = e => c.fibRef = e.target.value.trim(); $('#fibOk').onchange = e => c.fibOk = e.target.checked; }
  if ($('#cust')) $('#cust').onchange = e => c.customer = +e.target.value || null;
  $('#clearBtn').onclick = () => { voidReq(); S.cart = newCart(); drawGrid(); drawCart(); };
  $('#discBtn').onclick = () => askDiscount(sub);
  $('#sellBtn').onclick = () => sell(needCust);
}
function askDiscount(sub) {
  modal(`<h2>${isOwner() ? 'داشکاندن' : 'داواکاریی داشکاندن'}</h2>
    ${isOwner() ? '' : '<p class="mute" style="margin-bottom:12px">تەنها بەڕێوەبەر دەتوانێت داشکاندن بکات. داواکارییەکە دەچێتە مۆبایلی بەڕێوەبەر و تا ڕەزامەندی نەدات فرۆشتنەکە تەواو نابێت.</p>'}
    <label class="f">بڕی داشکاندن بە ${CUR()} (کۆی سەبەتە ${money(sub)})<input class="inp num" id="dAmt" type="text" inputmode="decimal" min="0.01" step="0.01" inputmode="decimal"></label>
    ${isOwner() ? '' : '<label class="f">هۆکار<input class="inp" id="dWhy" placeholder="بۆ نموونە: کڕیاری هەمیشەیی"></label>'}
    <div class="acts"><button class="btn" id="dOk">${isOwner() ? 'جێبەجێکردن' : 'ناردنی داواکاری'}</button><button class="ghost" id="dNo">پاشگەزبوونەوە</button></div>`);
  $('#dNo').onclick = closeModal;
  $('#dOk').onclick = () => {
    const amt = toC($('#dAmt').value), c = S.cart;
    if (isOwner()) { // the manager's own discount stays in the basket until the sale
      if (!(amt > 0)) return toast('بڕێکی دروست بنووسە', 1);
      if (amt >= sub) return toast('داشکاندن دەبێت لە کۆی سەبەتە کەمتر بێت', 1);
      c.disc = amt; closeModal(); drawCart(); shell(); return;
    }
    run('discountRequest', { type: c.type, lines: c.lines.map(l => ({ id: l.id, qty: l.qty })), amt, why: $('#dWhy').value.trim() }, r => { S.cart.req = r.id; closeModal(); drawCart(); shell(); });
  };
}
function sell(needCust) {
  const c = S.cart; if (!c.lines.length) return;
  run('sell', { type: c.type, pay: c.pay, fibRef: c.fibRef, fibOk: c.fibOk, customer: c.customer, lines: c.lines.map(l => ({ id: l.id, qty: l.qty })), disc: c.req ? 0 : c.disc, req: c.req }, r => {
    const sale = S.sales.find(s => s.no === r.no);
    S.cart = newCart(); S.q = ''; S.prevTotal = 0; render(); charge(sale, () => receipt(sale));
  });
}
function charge(sale, then) {
  if (!MO()) return then();
  const c = $('#charge'); let done = false;
  const sparks = [...Array(10)].map((_, i) => { const a = i * Math.PI / 5 + .3, r1 = 150, r2 = 205; return `<line class="sp" x1="${150 + Math.cos(a) * r1}" y1="${150 + Math.sin(a) * r1}" x2="${150 + Math.cos(a) * r2}" y2="${150 + Math.sin(a) * r2}"/>`; }).join('');
  c.innerHTML = `<div class="chg"><div class="wave"></div><svg viewBox="0 0 300 300"><circle class="c1" cx="150" cy="150" r="135"/><circle class="c2" cx="150" cy="150" r="135"/>${sparks}<path class="bz" d="M163 72 100 160h42l-11 68 68-94h-44z"/></svg><div class="chgt"><span>فرۆشرا · پسولەی <span class="num">#${sale.no}</span></span>${cu(sale.total)}</div></div>`;
  c.className = 'on'; setTimeout(() => runCU(c), 700);
  const end = () => { if (done) return; done = true; c.classList.add('bye'); setTimeout(() => { c.className = ''; c.innerHTML = ''; then(); }, 330); };
  c.onclick = end; if (!window.__holdCharge) setTimeout(end, 1750);
}
function receipt(s) {
  const cu = s.customer && cust(s.customer);
  modal(`<h2>پسولەی <span class="num">#${s.no}</span></h2><div class="rc">
    <div class="row sp"><span class="mute">${esc(S.branches[s.branch])} · ${esc(s.by)}</span><span class="mute num">${s.t.toLocaleDateString('en-GB')} ${s.t.toTimeString().slice(0, 5)}</span></div>
    ${cu ? `<div class="row sp"><span>کڕیار</span><b>${esc(cu.name)}</b></div>` : ''}<hr>
    ${s.legacy ? '<p class="mute">ئەم پسولەیە لە سیستەمە کۆنەکە تۆمار کراوە؛ وردەکاریی کاڵاکانی لەوێیە.</p>' : ''}${s.lines.map(l => `<div class="row sp"><span class="en">${esc(l.name)} <span class="mute num">×${l.qty}</span>${l.ret ? ` <span class="tag r">گەڕاوە ${l.ret}</span>` : ''}</span><b>${money(l.qty * l.price)}</b></div>`).join('')}<hr>
    ${s.disc ? `<div class="row sp"><span>داشکاندن</span><span>− ${money(s.disc)}</span></div>` : ''}
    <div class="row sp"><b>کۆی گشتی</b><b style="font-size:20px">${money(s.total)}</b></div>
    ${s.legacy ? '' : `<div class="row sp"><span>زەمانەت</span><span class="num">${(d => (d.setFullYear(d.getFullYear() + 1), d.toLocaleDateString('en-GB')))(new Date(s.t))}</span></div>`}
    <div class="row sp"><span>شێوازی پارەدان</span>${payTag(s.pay)}</div>${s.fibRef ? `<div class="row sp"><span>ژمارەی مامەڵەی FIB</span><span class="num">${esc(s.fibRef)}</span></div>` : ''}
    ${s.refunded ? `<div class="row sp"><span>گەڕێنراوەتەوە</span><span>${money(s.refunded)}</span></div>` : ''}</div>
    <div class="acts"><button class="btn" id="rcP">چاپکردن</button><button class="ghost" id="rcX">داخستن</button></div>`);
  $('#rcX').onclick = closeModal; $('#rcP').onclick = () => window.print();
}

/* ---------- returns ---------- */
let retNo = null; // the receipt open on the returns screen
V.returns = (no) => {
  const sale = no && S.sales.find(s => s.no === +no); retNo = sale ? sale.no : null;
  $('#view').innerHTML = `<div class="card pad" style="max-width:1040px">
    <h2>گەڕاندنەوە و گۆڕینی کاڵا</h2><p class="mute" style="margin:4px 0 14px">بە ژمارەی پسولە. <b>گەڕاندنەوە</b>: پارە دەدرێتەوە و کاڵاکە دەچێتەوە کۆگا. <b>گۆڕین</b>: کاڵای خراپ لە ماوەی زەمانەتی یەک ساڵدا بە دانەیەکی نوێ دەگۆڕدرێت، بێ پارە.</p>
    <div class="row"><input class="inp num grow" id="rNo" placeholder="ژمارەی پسولە" inputmode="numeric" value="${no || ''}"><button class="btn" id="rGo">گەڕان</button></div>
    <div id="rBody" style="margin-top:16px">${no && !sale ? `<div class="empty"><b>پسولەی <span class="num">#${esc(no)}</span> نەدۆزرایەوە</b></div>` : ''}</div></div>
    ${!sale && S.sales.length ? `<div class="card pad" style="max-width:1040px;margin-top:16px"><h3>دوایین پسولەکان</h3>${S.sales.slice(0, 6).map(s => `<div class="item"><div class="grow"><p><b class="num">#${s.no}</b> · ${money(s.total)}</p><small>${esc(s.by)} · ${hm(s.t)}</small></div><button class="ghost sm" data-r="${s.no}">هەڵبژاردن</button></div>`).join('')}</div>` : ''}`;
  $('#rGo').onclick = () => V.returns($('#rNo').value.trim());
  $('#rNo').onkeydown = e => { if (e.key === 'Enter') $('#rGo').click(); };
  $('#view').querySelectorAll('[data-r]').forEach(b => b.onclick = () => V.returns(b.dataset.r));
  if (!sale) return;
  if (sale.legacy) { $('#rBody').innerHTML = `<div class="empty"><b>پسولەی <span class="num">#${sale.no}</span> هی سیستەمە کۆنەکەیە</b>وردەکاریی کاڵاکانی لێرە نییە؛ دوای گواستنەوەی تەواوی داتاکان لێرەوە دەگەڕێنرێتەوە</div>`; return; }
  const left = sale.lines.some(l => l.qty - l.ret > 0), wEnd = new Date(sale.t); wEnd.setFullYear(wEnd.getFullYear() + 1); const inW = new Date() <= wEnd;
  $('#rBody').innerHTML = `<div class="scroll"><table><tr><th>کاڵا</th><th>نرخ</th><th>فرۆشراو</th><th>پێشتر گەڕاوە</th><th>ئێستا دەگەڕێتەوە</th><th>زەمانەت</th></tr>
    ${sale.lines.map((l, i) => `<tr><td class="en">${esc(l.name)}</td><td>${money(l.price)}</td><td class="num">${l.qty}</td><td class="num">${l.ret}</td><td>${l.qty - l.ret > 0 ? `<input class="inp num rq" data-i="${i}" type="text" inputmode="decimal" min="0" max="${l.qty - l.ret}" value="0" style="width:90px">` : '<span class="tag n">تەواو گەڕاوە</span>'}</td><td><div class="row"><span class="tag ${inW ? 'g' : 'r'}">${inW ? 'تا <span class="num">' + wEnd.toLocaleDateString('en-GB') + '</span>' : 'بەسەرچووە'}</span>${inW && l.qty - l.ret > 0 ? `<button class="ghost sm" data-w="${i}">گۆڕین</button>` : ''}${l.exch ? `<span class="tag b">گۆڕدراوە <span class="num">${l.exch}</span></span>` : ''}</div></td></tr>`).join('')}</table></div>
    ${left ? `<div class="row sp" style="margin-top:16px"><div>پارەی گەڕاوە: <b id="rSum" style="font-size:20px">${money(0)}</b>${sale.disc ? ' <span class="mute">(داشکاندنی پسولەکە لێی کەم دەکرێتەوە)</span>' : ''}</div><div class="row" style="flex-wrap:wrap"><input class="inp" id="rWhy" placeholder="هۆکاری گەڕاندنەوە (پێویستە)" style="width:260px;max-width:100%" maxlength="200"><button class="btn red" id="rDo">گەڕاندنەوە</button></div></div>` : `<div class="empty"><b>هەموو کاڵاکانی ئەم پسولەیە گەڕاونەتەوە</b></div>`}`;
  $('#view').querySelectorAll('[data-w]').forEach(b => b.onclick = () => exchange(sale, sale.lines[+b.dataset.w]));
  if (!left) return;
  const qtys = () => { const q = {}; document.querySelectorAll('.rq').forEach(x => q[+x.dataset.i] = Math.floor(+x.value || 0)); return q; };
  const calc = () => Core.refundCalc(sale, qtys());
  document.querySelectorAll('.rq').forEach(x => x.oninput = () => { const r = calc(); $('#rSum').innerHTML = r ? money(r.refund) : '<span class="tag r">بڕەکە لە فرۆشراو زیاترە</span>'; });
  $('#rDo').onclick = () => run('return', { no: sale.no, qty: qtys(), why: $('#rWhy').value.trim() }, () => { toast('گەڕایەوە؛ کۆگا نوێ کرایەوە'); V.returns(sale.no); shell(); });
};

function exchange(sale, l) {
  const can = l.qty - l.ret, it = item(l.id);
  modal(`<h2>گۆڕینی زەمانەت</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:4px">${esc(l.name)}</p><p class="mute" style="margin-bottom:12px">دانە خراپەکە وەردەگیرێتەوە و دانەیەکی نوێ لە کۆگای ${esc(S.branches[S.branch])} دەدرێت. پارە ناگۆڕێت. ئێستا <span class="num">${it.s[S.branch]}</span> دانە لە کۆگا هەیە.</p>
    <label class="f">چەند دانە (زۆرترین <span class="num">${can}</span>)<input class="inp num" id="wQ" type="text" inputmode="decimal" min="1" max="${can}" step="1" value="1"></label><label class="f">کێشەی کاڵاکە<input class="inp" id="wW" placeholder="بۆ نموونە: شەحن ناکات"></label>
    <div class="acts"><button class="btn volt" id="wOk">گۆڕین</button><button class="ghost" id="wNo">پاشگەزبوونەوە</button></div>`);
  $('#wNo').onclick = closeModal;
  $('#wOk').onclick = () => run('exchange', { no: sale.no, line: sale.lines.indexOf(l), qty: +$('#wQ').value, why: $('#wW').value.trim() }, () => { closeModal(); toast('گۆڕدرا؛ دانە خراپەکە جیا تۆمار کرا'); V.returns(sale.no); });
}

/* ---------- items & stock ---------- */
V.items = () => {
  const noBc = S.items.filter(i => !i.bc).length, low = S.items.filter(i => i.s[S.branch] <= 5).length, own = isOwner();
  const f = S.itemFilter, list = S.items.filter(i => f === 'nobc' ? !i.bc : f === 'low' ? i.s[S.branch] <= 5 : true);
  // what the whole stock (all branches) is worth
  const q = i => i.s.reduce((a, n) => a + n, 0), units = S.items.reduce((a, i) => a + q(i), 0);
  const vR = S.items.reduce((a, i) => a + q(i) * i.r, 0), vW = S.items.reduce((a, i) => a + q(i) * i.w, 0);
  const withC = S.items.filter(i => i.c != null), vC = withC.reduce((a, i) => a + q(i) * i.c, 0), vRk = withC.reduce((a, i) => a + q(i) * i.r, 0), noC = S.items.filter(i => i.c == null && q(i) > 0).length;
  const P = S.purchases, pQty = P.reduce((a, x) => a + x.qty, 0), pRet = P.reduce((a, x) => a + x.qty * x.retail, 0), pCost = P.reduce((a, x) => a + (x.cost != null ? x.qty * x.cost : 0), 0);
  const itemsTable = `<div class="card scroll"><table><tr><th>کاڵا</th><th>بارکۆد</th><th>پۆل</th>${own ? '<th>کڕین</th>' : ''}<th>تاک</th><th>جوملە</th><th>${esc(S.branches[0])}</th><th>${esc(S.branches[1])}</th><th></th></tr>
    ${list.map(i => `<tr><td class="en">${esc(i.name)}${i.f ? ` <span class="tag r">خراپ <span class="num">${i.f}</span></span>` : ''}</td><td class="num">${esc(i.bc) || '<span class="tag r">بێ بارکۆد</span>'}</td><td><span class="tag n">${esc(i.cat)}</span></td>${own ? `<td>${i.c != null ? money(i.c) : '<span class="mute">—</span>'}</td>` : ''}<td>${money(i.r)}</td><td>${i.w > 0 ? money(i.w) + (i.w > i.r ? ' <span class="tag r" title="نرخی جوملە لە تاک زیاترە">گرانترە</span>' : '') : '<span class="tag r">دانەنراوە</span>'}</td>
      ${i.s.map(n => `<td>${bat(n)}</td>`).join('')}
      <td><div class="row">${own ? `<button class="ghost sm" data-e="${i.id}">نرخ</button>` : ''}<button class="ghost sm" data-adj="${i.id}">کەمکردن</button>${!i.bc ? `<button class="ghost sm" data-b="${i.id}">بارکۆد</button>` : ''}</div></td></tr>`).join('')}</table></div>`;
  const inTable = `<div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))"><div class="card kpi"><small>دانەی داخیلکراو</small>${cuInt(pQty)}</div><div class="card kpi"><small>بەهای فرۆشتنیان</small>${cu(pRet)}</div>${own ? `<div class="card kpi"><small>کۆی کڕین</small>${cu(pCost, 'pCostAll')}</div><div class="card kpi"><small>قازانجی چاوەڕوانکراو</small>${cu(P.reduce((a, x) => a + (x.cost != null ? x.qty * (x.retail - x.cost) : 0), 0))}</div>` : ''}</div>
    <div class="card scroll">${P.length ? `<table><tr><th>کات</th><th>کاڵا</th><th>بڕ</th><th>نرخی فرۆشتن</th><th>بەهای فرۆشتن</th>${own ? '<th>نرخی کڕین</th><th>کۆی کڕین</th><th>قازانج</th>' : ''}<th>کێ</th><th>لق</th></tr>${P.map(x => `<tr><td>${hm(x.t)}</td><td class="en">${esc(x.name)}</td><td class="num"><b>${x.qty}</b></td><td>${money(x.retail)}</td><td>${money(x.qty * x.retail)}</td>${own ? (x.cost != null ? `<td>${money(x.cost)}</td><td><b>${money(x.qty * x.cost)}</b></td><td><span class="tag g">${money(x.qty * (x.retail - x.cost))}</span></td>` : '<td colspan="3"><span class="tag a">نرخی کڕین دانەنراوە</span></td>') : ''}<td class="en">${esc(x.by)}</td><td>${esc(S.branches[x.branch])}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ کاڵایەک داخیل نەکراوە</b>هەر داخیلکردنێک بە بڕ، نرخ و کۆی گشتییەوە لێرە تۆمار دەبێت</div>'}</div>`;
  $('#view').innerHTML = `<div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="card kpi"><small><span class="ic">${ico('items', 15)}</span>دانەی ناو هەموو لقەکان</small>${cuInt(units)}</div>
      <div class="card kpi"><small><span class="ic">${ico('pos', 15)}</span>بەهای کۆگا بە نرخی تاک</small>${cu(vR, 'valRetail')}</div>
      <div class="card kpi"><small><span class="ic">${ico('customers', 15)}</span>بە نرخی جوملە</small>${cu(vW)}</div>
      ${own ? `<div class="card kpi"><small><span class="ic">${ico('expenses', 15)}</span>بە پارەی خۆی (نرخی کڕین)</small>${withC.length ? cu(vC, 'valCost') : '<b id="valCost" class="mute" style="font-size:17px">نرخی کڕین دانەنراوە</b>'}${noC && withC.length ? `<small style="margin-top:6px"><span class="tag a">تەنها بۆ <span class="num">${withC.length}</span> کاڵا · <span class="num">${noC}</span> کاڵا نرخی کڕینیان نییە</span></small>` : noC ? `<small style="margin-top:6px"><span class="tag a"><span class="num">${noC}</span> کاڵا نرخی کڕینیان نییە</span></small>` : ''}</div>
      <div class="card kpi"><small><span class="ic">${ico('check', 15)}</span>قازانج ئەگەر هەمووی بفرۆشرێت</small>${withC.length ? cu(vRk - vC, 'valProfit') : '<b class="mute" style="font-size:17px">—</b>'}${noC && withC.length ? `<small style="margin-top:6px"><span class="tag a">تەنها بۆ <span class="num">${withC.length}</span> کاڵا</span></small>` : ''}</div>` : ''}</div>
    <div class="row sp" style="margin-bottom:14px;flex-wrap:wrap">
    <div class="chips" style="margin:0"><button class="chip ${f === 'all' ? 'on' : ''}" data-f="all">هەموو <span class="num">${S.items.length}</span></button><button class="chip ${f === 'nobc' ? 'on' : ''}" data-f="nobc">بێ بارکۆد <span class="num">${noBc}</span></button><button class="chip ${f === 'low' ? 'on' : ''}" data-f="low">کەمبوو <span class="num">${low}</span></button><button class="chip ${f === 'in' ? 'on' : ''}" data-f="in">مێژووی داخیلکردن <span class="num">${P.length}</span></button></div>
    <div class="row">${own ? '<button class="ghost" id="newItem">کاڵای نوێ</button>' : ''}<button class="btn volt" id="recv">داخیلکردنی کاڵا</button></div></div>
    ${noBc && f !== 'in' ? `<div class="card pad row wait" style="margin-bottom:14px"><div class="dot a">${ico('alert')}</div><div class="grow"><b><span class="num">${noBc}</span> کاڵا بارکۆدیان نییە</b><div class="mute" style="font-size:13px">لە سیستەمە کۆنەکە بە «0» یان بەتاڵ تۆمار کراون. تا بارکۆدیان بۆ دانەنرێت، کەس ناتوانێت داخیلیان بکات.</div></div></div>` : ''}
    ${f === 'in' ? inTable : itemsTable}`;
  $('#view').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.itemFilter = b.dataset.f; V.items(); });
  $('#recv').onclick = receive;
  $('#view').querySelectorAll('[data-adj]').forEach(b => b.onclick = () => adjust(item(+b.dataset.adj)));
  $('#view').querySelectorAll('[data-b]').forEach(b => b.onclick = () => setBarcode(item(+b.dataset.b)));
  if (own) {
    $('#newItem').onclick = newItem;
    $('#view').querySelectorAll('[data-e]').forEach(b => b.onclick = () => editPrice(item(+b.dataset.e)));
  }
};
function adjust(it) {
  modal(`<h2>کەمکردنەوەی کۆگا — ${esc(S.branches[S.branch])}</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:4px">${esc(it.name)}</p><p class="mute" style="margin-bottom:12px">بۆ کاڵای شکاو، ونبوو یان هەڵەی ژماردن. ئێستا <span class="num">${it.s[S.branch]}</span> دانە هەیە. هۆکار پێویستە و بە ناوی تۆ تۆمار دەکرێت.</p>
    <label class="f">چەند دانە کەم بکرێتەوە<input class="inp num" id="aQ" type="text" inputmode="decimal" min="1" step="1" inputmode="numeric"></label><label class="f">هۆکار<input class="inp" id="aW" placeholder="بۆ نموونە: شکاوە"></label>
    <div class="acts"><button class="btn red" id="aOk">کەمکردنەوە</button><button class="ghost" id="aNo">پاشگەزبوونەوە</button></div>`);
  $('#aNo').onclick = closeModal;
  $('#aOk').onclick = () => run('stockReduce', { id: it.id, qty: +$('#aQ').value, why: $('#aW').value.trim() }, () => { closeModal(); toast('کەم کرایەوە'); V.items(); });
}
function receive() {
  const own = isOwner();
  modal(`<h2>داخیلکردنی کاڵا — ${esc(S.branches[S.branch])}</h2><p class="mute" style="margin-bottom:12px">بێ بارکۆد هیچ شتێک داخیل نابێت.</p>
    <label class="f">بارکۆد<input class="inp num" id="vBc" placeholder="سکان بکە" autocomplete="off"></label><div id="vHit" style="margin-bottom:12px"></div>
    <div class="row"><label class="f grow">بڕ (دانە)<input class="inp num" id="vQty" type="text" inputmode="decimal" min="1" step="1" inputmode="numeric"></label>${own ? `<label class="f grow">نرخی کڕینی یەک دانە ${CUR()}<input class="inp num" id="vCost" type="text" inputmode="decimal" min="0" step="0.01" inputmode="decimal"></label>` : ''}</div>
    <div id="vSum"></div>
    <div class="acts"><button class="btn volt" id="vOk">داخیلکردن</button><button class="ghost" id="vNo">پاشگەزبوونەوە</button></div>`);
  let pick = null;
  const sum = () => { const n = +$('#vQty').value; if (!pick || !(n > 0)) return $('#vSum').innerHTML = '';
    const c = own && $('#vCost').value.trim() !== '' ? toC($('#vCost').value) : null;
    $('#vSum').innerHTML = `<div class="card pad rc" style="margin-top:4px"><div class="row sp"><span>نرخی فرۆشتنی یەک دانە</span>${money(pick.r)}</div><div class="row sp"><span>بەهای فرۆشتنی هەمووی</span><b>${money(n * pick.r)}</b></div>${c != null ? `<hr><div class="row sp"><span>کۆی کڕین</span><b style="font-size:18px">${money(n * c)}</b></div><div class="row sp"><span>قازانجی چاوەڕوانکراو</span><span class="tag ${pick.r >= c ? 'g' : 'r'}">${money(n * (pick.r - c))}</span></div>` : ''}<div class="row sp"><span>کۆگا دوای داخیلکردن</span><span class="num">${pick.s[S.branch]} → <b>${pick.s[S.branch] + n}</b></span></div></div>`; };
  const find = () => { const hits = S.items.filter(i => i.bc && i.bc === $('#vBc').value.trim()); pick = hits.length === 1 ? hits[0] : null;
    $('#vHit').innerHTML = !$('#vBc').value.trim() ? '' : !hits.length ? '<span class="tag r">هیچ کاڵایەک بەم بارکۆدە نییە — تەنها بەڕێوەبەر دەتوانێت کاڵای نوێ دروست بکات</span>' : hits.length === 1 ? `<span class="tag g">${esc(hits[0].name)} · ئێستا ${hits[0].s[S.branch]} دانە</span>` : `<select class="inp" id="vPick"><option value="">ئەم بارکۆدە بۆ ${hits.length} کاڵایە — یەکێک هەڵبژێرە</option>${hits.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select>`;
    if ($('#vPick')) $('#vPick').onchange = e => { pick = item(+e.target.value) || null; preset(); sum(); };
    preset(); sum(); };
  const preset = () => { if (own && pick && pick.c != null && $('#vCost').value === '') $('#vCost').value = amtOut(pick.c); };
  $('#vBc').oninput = find; $('#vQty').oninput = sum; if (own) $('#vCost').oninput = sum; $('#vNo').onclick = closeModal;
  $('#vOk').onclick = () => { const p = { id: pick ? pick.id : null, qty: +$('#vQty').value };
    if (own && $('#vCost').value.trim() !== '') p.cost = toC($('#vCost').value);
    run('receive', p, () => { closeModal(); toast('داخیل کرا'); V.items(); }); };
}
function newItem() {
  modal(`<h2>کاڵای نوێ</h2><label class="f">ناو<input class="inp" id="nName" style="direction:ltr"></label><label class="f">بارکۆد (پێویستە)<input class="inp num" id="nBc"></label>
    <label class="f">پۆل<select class="inp" id="nCat">${[...new Set(S.items.map(i => i.cat))].map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
    <div class="row"><label class="f grow">نرخی تاک ${CUR()}<input class="inp num" id="nR" type="text" inputmode="decimal" step="0.01" min="0"></label><label class="f grow">نرخی جوملە ${CUR()}<input class="inp num" id="nW" type="text" inputmode="decimal" step="0.01" min="0"></label></div>
    <div class="acts"><button class="btn" id="nOk">دروستکردن</button><button class="ghost" id="nNo">پاشگەزبوونەوە</button></div>`);
  $('#nNo').onclick = closeModal;
  $('#nOk').onclick = () => run('newItem', { name: $('#nName').value.trim(), bc: $('#nBc').value.trim(), cat: $('#nCat').value, r: toC($('#nR').value), w: toC($('#nW').value) }, () => { closeModal(); V.items(); });
}
function editPrice(it) {
  modal(`<h2>گۆڕینی نرخ</h2><p style="direction:ltr;text-align:left;font-weight:700;margin-bottom:12px">${esc(it.name)}</p>
    <label class="f">نرخی کڕین ${CUR()} (تەنها بەڕێوەبەر دەیبینێت — بۆ هەژماری قازانج)<input class="inp num" id="pC" type="text" inputmode="decimal" step="0.01" min="0" value="${it.c != null ? amtOut(it.c) : ''}" placeholder="هێشتا دانەنراوە"></label><div class="row"><label class="f grow">تاک ${CUR()}<input class="inp num" id="pR" type="text" inputmode="decimal" step="0.01" value="${amtOut(it.r)}"></label><label class="f grow">جوملە ${CUR()}<input class="inp num" id="pW" type="text" inputmode="decimal" step="0.01" value="${amtOut(it.w)}"></label></div>
    <div class="acts"><button class="btn" id="pOk">هەڵگرتن</button><button class="ghost" id="pNo">پاشگەزبوونەوە</button></div>`);
  $('#pNo').onclick = closeModal;
  $('#pOk').onclick = () => { const cv = $('#pC').value.trim(), p = { id: it.id, r: toC($('#pR').value), w: toC($('#pW').value) };
    if (cv !== '') p.c = toC(cv);
    run('editPrice', p, () => { closeModal(); V.items(); }); };
}
function setBarcode(it) {
  modal(`<h2>دانانی بارکۆد</h2><p style="direction:ltr;text-align:left;font-weight:700;margin-bottom:12px">${esc(it.name)}</p>
    <label class="f">بارکۆدی سەر کاڵاکە سکان بکە<input class="inp num" id="bBc"></label>
    <button class="ghost sm" id="bGen">بارکۆدی نییە؟ یەکێکی ناوخۆیی بۆ دروست بکە</button>
    <div class="acts"><button class="btn" id="bOk">هەڵگرتن</button><button class="ghost" id="bNo">پاشگەزبوونەوە</button></div>`);
  $('#bGen').onclick = () => $('#bBc').value = 'WG' + String(it.id).padStart(6, '0'); $('#bNo').onclick = closeModal;
  $('#bOk').onclick = () => run('setBarcode', { id: it.id, bc: $('#bBc').value.trim() }, () => { closeModal(); V.items(); });
}

/* ---------- customers & debts ---------- */
V.customers = (q = '') => {
  const debtors = S.customers.filter(c => c.debt > 0), total = debtors.reduce((a, c) => a + c.debt, 0);
  const t = q.toLowerCase(), list = S.customers.filter(c => !t || c.name.toLowerCase().includes(t) || c.phone.includes(t)).sort((a, b) => b.debt - a.debt);
  $('#view').innerHTML = `<div class="kgrid"><div class="card kpi"><small>کڕیاران</small><b class="num">${S.customers.length}</b></div><div class="card kpi"><small>قەرزداران</small><b class="num">${debtors.length}</b></div><div class="card kpi hero"><small>کۆی قەرز</small><b>${money(total)}</b></div></div>
    <div class="row" style="margin-bottom:14px"><input class="inp grow" id="cQ" placeholder="گەڕان بە ناو یان مۆبایل" value="${esc(q)}"><button class="btn" id="cNew">کڕیاری نوێ</button></div>
    <div class="card scroll"><table><tr><th>ناو</th><th>مۆبایل</th><th>ناونیشان</th><th>قەرز</th><th></th></tr>${list.map(c => `<tr><td class="en">${esc(c.name)}</td><td class="num">${esc(c.phone) || '—'}</td><td class="en">${esc(c.addr) || '—'}</td><td>${c.debt > 0 ? `<span class="tag r">${money(c.debt)}</span>` : '<span class="tag g">قەرزدار نییە</span>'}</td><td>${c.debt > 0 ? `<button class="ghost sm" data-p="${c.id}">پارەدانەوە</button>` : ''}</td></tr>`).join('')}</table></div>`;
  const i = $('#cQ'); i.oninput = () => { V.customers(i.value); const n = $('#cQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('#view').querySelectorAll('[data-p]').forEach(b => b.onclick = () => payDebt(cust(+b.dataset.p)));
  $('#cNew').onclick = () => { modal(`<h2>کڕیاری نوێ</h2><label class="f">ناو<input class="inp" id="kN"></label><label class="f">مۆبایل<input class="inp num" id="kP" inputmode="tel"></label><label class="f">ناونیشان<input class="inp" id="kA"></label><div class="acts"><button class="btn" id="kOk">دروستکردن</button><button class="ghost" id="kNo">پاشگەزبوونەوە</button></div>`);
    $('#kNo').onclick = closeModal; $('#kOk').onclick = () => run('newCustomer', { name: $('#kN').value.trim(), phone: $('#kP').value.trim(), addr: $('#kA').value.trim() }, () => { closeModal(); V.customers(); }); };
};
function payDebt(c) {
  modal(`<h2>پارەدانەوەی قەرز</h2><p style="margin-bottom:12px"><b>${esc(c.name)}</b> — قەرزی ئێستا ${money(c.debt)}</p><label class="f">بڕی وەرگیراو ${CUR()}<input class="inp num" id="yA" type="text" inputmode="decimal" step="0.01" min="0.01" value="${amtOut(c.debt)}"></label><label class="f">چۆن وەرگیرا<select class="inp" id="yM"><option value="cash">کاش</option><option value="fib">FIB</option></select></label><div class="acts"><button class="btn green" id="yOk">وەرگرتن</button><button class="ghost" id="yNo">پاشگەزبوونەوە</button></div>`);
  $('#yNo').onclick = closeModal;
  $('#yOk').onclick = () => { // dinar is rounded to 250: paying the shown full amount must clear the debt exactly
    const typed = $('#yA').value, full = pn(typed, S.cur === 'IQD') === pn(amtOut(c.debt), S.cur === 'IQD');
    let amt = full ? c.debt : toC(typed);
    if (S.cur === 'IQD' && amt > c.debt && amt - c.debt <= Math.ceil(25000 / S.rate)) amt = c.debt;
    run('payDebt', { customer: c.id, amt, method: $('#yM').value }, () => { closeModal(); toast('وەرگیرا'); V.customers(); });
  };
}

/* ---------- expenses ---------- */
V.expenses = () => {
  const t0 = Core.dayStart(S, new Date()), mine = S.expenses.filter(e => (lvl() > 1 || e.branch === S.branch) && Core.ms(e.t) >= t0);
  $('#view').innerHTML = `<div class="two"><div class="card pad"><h2 style="margin-bottom:14px">مەسروفی نوێ — ${esc(S.branches[S.branch])}</h2>
    <label class="f">چی مەسروف کراوە؟ (بە دەستی خۆت بینووسە)<input class="inp" id="eC" placeholder="بۆ نموونە: چاککردنی کارەبای دوکان" autocomplete="off" maxlength="120"></label>
    <div class="chips" style="margin:-4px 0 14px">${EXP_CATS.filter(c => c !== 'هیتر').map(c => `<button class="chip" data-ec="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="f">بڕ ${CUR()}<input class="inp num" id="eA" type="text" inputmode="decimal" step="0.01" min="0.01" inputmode="decimal"></label><label class="f">تێبینی (ئارەزوومەندانە)<input class="inp" id="eN"></label><button class="btn volt" id="eOk">تۆمارکردن</button></div>
    <div class="card pad"><div class="row sp"><h2>مەسروفەکانی ئەمڕۆ</h2><b>${money(mine.reduce((a, e) => a + e.amt, 0))}</b></div>${mine.map(e => `<div class="item"><div class="dot n">${ico('expenses', 17)}</div><div class="grow"><p><b>${esc(e.cat)}</b>${e.note ? ' — ' + esc(e.note) : ''}</p><small>${esc(e.by)} · ${esc(S.branches[e.branch])} · ${hm(e.t)}</small></div><b>${money(e.amt)}</b></div>`).join('') || '<div class="empty"><b>هیچ مەسروفێک تۆمار نەکراوە</b></div>'}</div></div>`;
  $('#view').querySelectorAll('[data-ec]').forEach(b => b.onclick = () => { $('#eC').value = b.dataset.ec; $('#eA').focus(); });
  $('#eOk').onclick = () => run('expense', { cat: $('#eC').value.trim(), amt: toC($('#eA').value), note: $('#eN').value.trim() }, () => { toast('تۆمار کرا'); V.expenses(); });
};

/* ---------- owner: dashboard, sales, log ---------- */
/* daily sales as one smooth line; the best day is marked */
function dayLine() {
  const n = S.chartDays || 14, b = S.dashBranch, inB = x => b < 0 || x.branch === b, D = 864e5, start = Core.dayStart(S, new Date()) - (n - 1) * D, v = Array(n).fill(0);
  const slot = t => Math.floor((Core.ms(t) - start) / D);
  S.sales.forEach(x => { if (inB(x)) { const k = slot(x.t); if (k >= 0 && k < n) v[k] += x.total; } (x.rets || []).forEach(r => { if (inB(r)) { const k = slot(r.t); if (k >= 0 && k < n) v[k] -= r.amt; } }); if (!x.rets && x.refunded && inB(x)) { const k = slot(x.t); if (k >= 0 && k < n) v[k] -= x.refunded; } });
  const mx = Math.max(...v, 1), top = Math.max(...v), best = top > 0 ? v.indexOf(top) : -1, days = v.filter(x => x > 0), avg = days.length ? Math.round(days.reduce((a, x) => a + x, 0) / days.length) : 0;
  const W = 1000, H = 230, px = 26, pt = 30, pb = 34, X = i => W - px - i * (W - 2 * px) / (n - 1), Y = y => pt + (1 - Math.max(0, y) / mx) * (H - pt - pb);   // newest day on the left, like the rest of the page
  const P = v.map((y, i) => [X(i), Y(y)]); let d = `M${P[0][0]},${P[0][1]}`;
  for (let i = 0; i < n - 1; i++) { const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2, c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(H - pb, Math.max(pt, p1[1] + (p2[1] - p0[1]) / 6))], c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(H - pb, Math.max(pt, p2[1] - (p3[1] - p1[1]) / 6))]; d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  const dt = i => new Date(start + i * D + 12 * 36e5), lab = i => { const x = dt(i); return x.getDate() + '/' + (x.getMonth() + 1); }, every = n <= 7 ? 1 : n <= 14 ? 2 : 5;
  return `<div class="card pad linec"><div class="row sp" style="flex-wrap:wrap;gap:8px"><h2>فرۆشی ڕۆژانە</h2><div class="row" style="flex-wrap:wrap;gap:6px">${best >= 0 ? `<span class="tag g" id="bestDay">باشترین ڕۆژ: <span class="num">${lab(best)}</span> · <span class="num">${fmtMoney(top)}</span></span><span class="tag n">تێکڕای ڕۆژ: <span class="num">${fmtMoney(avg)}</span></span>` : ''}<div class="seg" style="padding:3px">${[7, 14, 30].map(k => `<button data-days="${k}" class="${n === k ? 'on' : ''}" style="padding:5px 12px"><span class="num">${k}</span> ڕۆژ</button>`).join('')}</div></div></div>
    ${best < 0 ? '<div class="empty"><b>هێشتا فرۆشتن نییە</b>لەگەڵ یەکەم فرۆشتن هێڵەکە دەست پێدەکات</div>' : `<div class="lnwrap"><svg class="lnsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9FF2F" stop-opacity=".32"/><stop offset="1" stop-color="#C9FF2F" stop-opacity="0"/></linearGradient><linearGradient id="ls" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C9FF2F"/><stop offset="1" stop-color="#3FE0FF"/></linearGradient></defs>
      ${[0, .5, 1].map(f => `<line x1="${px}" x2="${W - px}" y1="${Y(mx * f)}" y2="${Y(mx * f)}" class="gl"/>`).join('')}
      <path class="ar" d="${d} L${X(n - 1)},${H - pb} L${X(0)},${H - pb} Z" fill="url(#lg)"/><path class="ln" d="${d}" pathLength="1" fill="none" stroke="url(#ls)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line x1="${X(best)}" x2="${X(best)}" y1="${Y(top)}" y2="${H - pb}" class="bl"/></svg>
      <div class="lnx">${v.map((y, i) => `<span style="right:${(px + i * (W - 2 * px) / (n - 1)) / W * 100}%" class="${i === best ? 'bst' : ''}">${i % every === 0 || i === best || i === n - 1 ? lab(i) : ''}</span>`).join('')}<i class="bdot" style="right:${(px + best * (W - 2 * px) / (n - 1)) / W * 100}%;top:${Y(top) / H * 100}%"></i></div></div>`}</div>`;
}
/* what the manager should look at today: everything where money or stock could go missing */
function watchCard(t0) {
  const td = x => Core.ms(x.t) >= t0, F = [], staffNames = new Set(S.team.filter(u => u.role === 'staff').map(u => u.name));
  S.sales.forEach(x => {
    if (x.pay === 'fib' && !x.fibChecked && !x.legacy) F.push({ c: 'b', i: 'check', h: `FIB پشتڕاست نەکراوە: پسولەی <b class="num">#${x.no}</b> · ${money(x.total)} · ژمارەی مامەڵە <b class="num">${esc(x.fibRef) || '—'}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}`, b: `<button class="btn green sm" data-fv="${x.no}">بینیم لە FIB</button>` });
    (x.rets || []).forEach(r => { if (td(r)) F.push({ c: 'r', i: 'returns', h: `گەڕاندنەوەی ${money(r.amt)} لە پسولەی <b class="num">#${x.no}</b> — ${esc(r.why || '')}`, s: `${esc(r.by || '')} · ${esc(S.branches[r.branch])} · ${hm(r.t)}` }); });
    if (td(x) && x.pay === 'debt') F.push({ c: 'a', i: 'customers', h: `فرۆشتن بە قەرز: ${money(x.total)} بۆ ${esc((cust(x.customer) || {}).name || '')} · پسولەی <b class="num">#${x.no}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
    if (td(x) && !x.legacy && x.type === 'wholesale' && staffNames.has(x.by)) F.push({ c: 'a', i: 'pos', h: `کارمەند بە نرخی جوملە فرۆشتی: ${money(x.total)} · پسولەی <b class="num">#${x.no}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
    if (td(x) && x.disc) F.push({ c: 'a', i: 'alert', h: `داشکاندنی ${money(x.disc)} لە پسولەی <b class="num">#${x.no}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
  });
  S.exchanges.forEach(x => { if (td(x)) F.push({ c: 'b', i: 'returns', h: `گۆڕینی زەمانەت: <span class="num">${x.qty}</span> دانە لە پسولەی <b class="num">#${x.no}</b> — ${esc(x.why)}`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` }); });
  S.log.forEach(e => { if (td(e) && e.kind === 'stock' && /^کەمکردنەوەی/.test(e.text)) F.push({ c: 'r', i: 'items', h: e.text, s: `${esc(e.by)} · ${esc(S.branches[e.branch])} · ${hm(e.t)}` }); });
  (S.closes || []).forEach(c => { if (td(c) && c.diff) F.push({ c: c.diff < 0 ? 'r' : 'a', i: 'expenses', h: `قاصە ${c.diff < 0 ? 'کەمە' : 'زیادە'} ${money(Math.abs(c.diff))} — ژمێردراو ${money(c.counted)}، دەبوو ${money(c.expected)} بێت`, s: `${esc(c.by)} · ${esc(S.branches[c.branch])} · ${hm(c.t)}` }); });
  S.jards.forEach(j => { if (td(j)) { const miss = j.rows.reduce((a, r) => a + Math.max(0, -r.diff), 0); if (miss) F.push({ c: 'r', i: 'jard', h: `جەرد: <span class="num">${miss}</span> دانە کەمە`, s: `${esc(j.by)} · ${esc(S.branches[j.branch])} · ${hm(j.t)}` }); } });
  return `<div class="card pad ${F.some(f => f.c === 'r') ? 'wait' : ''}" id="watch"><div class="row sp"><h2>چاودێریی ئەمڕۆ</h2>${F.length ? `<span class="tag ${F.some(f => f.c === 'r') ? 'r' : 'a'} num" id="watchN">${F.length}</span>` : ''}</div><p class="mute" style="font-size:13px;margin-bottom:4px">هەر شوێنێک کە پارە یان کاڵا دەتوانێت تێیدا ون ببێت.</p>
    ${F.slice(0, 14).map(f => `<div class="item" style="align-items:center"><div class="dot ${f.c}">${ico(f.i, 17)}</div><div class="grow"><p>${f.h}</p><small>${f.s}</small></div>${f.b || ''}</div>`).join('') || '<div class="empty"><b>هیچ شتێک نییە بۆ سەیرکردن</b>گەڕاندنەوە، قەرز، داشکاندن، FIB، کەمیی قاصە و کەمیی جەرد لێرە دەردەکەون</div>'}</div>`;
}
function todayRets(t0) {
  const out = [];
  S.sales.forEach(x => {
    if (x.rets && x.rets.length) x.rets.forEach(r => { if (Core.ms(r.t) >= t0) out.push(r); });
    else if (x.refunded && Core.ms(x.t) >= t0) out.push({ t: x.t, amt: x.refunded, cash: x.pay === 'fib' ? 0 : (x.cashBack || 0), fib: x.pay === 'fib' ? x.refunded : 0, branch: x.branch });
  });
  return out;
}
V.dash = () => {
  const b = S.dashBranch, inB = x => b < 0 || x.branch === b, own = isOwner();
  const t0 = Core.dayStart(S, new Date()), today = x => Core.ms(x.t) >= t0;
  const sales = S.sales.filter(x => inB(x) && today(x)), sold = sales.reduce((a, s) => a + s.total, 0);
  const rets = todayRets(t0).filter(inB), refunded = rets.reduce((a, r) => a + r.amt, 0), net = sold - refunded;
  const pays = S.payments.filter(x => inB(x) && today(x)), exps = S.expenses.filter(x => inB(x) && today(x));
  const cashIn = sales.filter(s => s.pay === 'cash').reduce((a, s) => a + s.total, 0) + pays.filter(p => p.method !== 'fib').reduce((a, p) => a + p.amt, 0);
  const fibNet = sales.filter(s => s.pay === 'fib').reduce((a, s) => a + s.total, 0) - rets.reduce((a, r) => a + r.fib, 0) + pays.filter(p => p.method === 'fib').reduce((a, p) => a + p.amt, 0);
  const cashOut = rets.reduce((a, r) => a + r.cash, 0) + exps.reduce((a, e) => a + e.amt, 0);
  const wait = own ? S.approvals.filter(a => a.status === 'wait') : [];
  const pcs = list => list.reduce((a, x) => a + (x.lines || []).reduce((b, l) => b + l.qty - l.ret, 0), 0), units = pcs(sales);
  const staff = {}; sales.forEach(s => { staff[s.by] = staff[s.by] || { n: 0, sum: 0, u: 0 }; staff[s.by].n++; staff[s.by].sum += s.total - s.refunded; staff[s.by].u += pcs([s]); });
  const low = S.items.filter(i => (b < 0 ? Math.min(...i.s) : i.s[b]) <= 5).slice(0, 7);
  // profit: only lines whose buying price is known
  let profit = 0, known = 0, unknown = 0;
  sales.forEach(s => { if (s.legacy || s.lines.some(l => l.cost == null)) { unknown++; return; } known++; profit += (s.total - s.refunded) - s.lines.reduce((a, l) => a + (l.qty - l.ret) * l.cost, 0); });
  const pct = Math.min(1, net / S.target), R = 104, C = 2 * Math.PI * R, hrs = [...Array(15)].map((_, i) => i + 9), by = hrs.map(h => sales.filter(s => s.t.getHours() === h).reduce((a, s) => a + s.total, 0)), mx = Math.max(...by, 1), nowH = new Date().getHours();
  const maxStaff = Math.max(...Object.values(staff).map(v => v.sum), 1);
  const brs = S.branches.map((nm, k) => { const ss = S.sales.filter(x => x.branch === k && today(x)); const by = k2 => ss.filter(x => x.pay === k2).reduce((a, x) => a + x.total, 0); return { k, u: pcs(ss), nm, n: ss.length, cash: by('cash'), fib: by('fib'), debt: by('debt'), v: ss.reduce((a, x) => a + x.total, 0) - todayRets(t0).filter(r => r.branch === k).reduce((a, r) => a + r.amt, 0), ex: S.expenses.filter(e => e.branch === k && today(e)).reduce((a, e) => a + e.amt, 0), act: S.log.filter(e => e.branch === k && today(e)).length }; }), brMax = Math.max(...brs.map(x => x.v), 1);
  $('#view').innerHTML = `<div class="hero">
    <div class="card ringc"><div class="ring"><svg viewBox="0 0 250 250" width="250" height="250"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3FE0FF"/><stop offset="1" stop-color="#C9FF2F"/></linearGradient></defs>
        <circle class="ticks" cx="125" cy="125" r="121" fill="none" stroke-width="5" stroke-dasharray="1.5 11.17"/><circle class="trk" cx="125" cy="125" r="${R}" fill="none" stroke-width="13"/>
        <circle class="arc" id="arc" cx="125" cy="125" r="${R}" fill="none" stroke-width="13" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - pct)}"/></svg>
      <div class="mid"><small>فرۆشی ئەمڕۆ</small>${cu(net, 'kSold')}<em class="units"><span class="num" id="kUnits">${units.toLocaleString('en-US')}</span> دانە فرۆشراوە</em><span><span class="num">${Math.round(net / S.target * 100)}%</span> لە ئامانج</span></div></div>
      <button class="ghost sm" id="tgt" style="margin-top:10px">ئامانجی ڕۆژانە: <span class="num">${fmtMoney(S.target)}</span></button></div>
    <div><div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="card kpi"><small><span class="ic">${ico('sales', 15)}</span>پسولە</small>${cuInt(sales.length, 'kCount')}</div>
        <div class="card kpi"><small><span class="ic">${ico('returns', 15)}</span>گەڕاوە</small>${cu(refunded, 'kRef')}</div>
        <div class="card kpi"><small><span class="ic">${ico('expenses', 15)}</span>کاشی ناو قاصە</small>${cu(cashIn - cashOut, 'kDrawer')}</div>
        <div class="card kpi"><small><span class="ic">${ico('check', 15)}</span>وەرگیراو بە FIB</small>${cu(fibNet, 'kFib')}</div></div>
      <div class="card pad"><div class="row sp"><h2>فرۆشتن بە پێی کاتژمێر</h2>${own ? `<span class="tag ${known ? 'g' : 'n'}" id="kProfit" title="قازانج تەنها بۆ بەڕێوەبەر دەردەکەوێت">قازانج: ${known ? `<span class="num">${fmtMoney(profit)}</span>${unknown ? ' (بەشێک)' : ''}` : 'نرخی کڕین دانەنراوە'}</span>` : ''}</div>
        <div class="bars">${hrs.map((h, i) => `<div><i class="${by[i] ? '' : 'z'} ${h === nowH ? 'now' : ''}" style="--i:${i};height:${Math.max(3, by[i] / mx * 100)}%" title="${fmtMoney(by[i])}"></i><s>${h}</s></div>`).join('')}</div></div></div></div>
    <div class="brs">${brs.map(x => `<div class="card pad"><div class="row sp"><h2>${esc(x.nm)}</h2><span class="tag ${x.n ? 'g' : 'n'}">${x.n ? `<span class="num">${x.n}</span> پسولە` : 'هێشتا فرۆشتن نییە'}</span></div><div class="row sp" style="margin-top:10px;align-items:flex-end"><div><small class="mute">فرۆشی ئەمڕۆ</small><div class="bv">${cu(x.v)}</div><small class="units"><span class="num" data-bu="${x.k}">${x.u.toLocaleString('en-US')}</span> دانە</small></div><div style="text-align:left"><small class="mute">مەسروف ${money(x.ex)}</small><br><small class="mute"><span class="num">${x.act}</span> جموجۆڵ</small></div></div><div class="duel"><div class="bar"><i style="width:${x.v / brMax * 100}%"></i></div></div><div class="row" style="margin-top:12px;flex-wrap:wrap;gap:6px"><span class="tag g">کاش ${money(x.cash)}</span><span class="tag b">FIB ${money(x.fib)}</span><span class="tag a">قەرز ${money(x.debt)}</span></div></div>`).join('')}</div>
    ${dayLine()}
    <div class="two"><div style="display:grid;gap:18px">
      ${own ? watchCard(t0) : ''}
      ${own ? `<div class="card pad ${wait.length ? 'wait' : ''}"><div class="row sp"><h2>چاوەڕوانی ڕەزامەندیی تۆ</h2>${wait.length ? `<span class="tag a num">${wait.length}</span>` : ''}</div>${wait.map(a => `<div class="item"><div class="dot a">${ico('alert', 17)}</div><div class="grow"><p><b>${esc(a.by)}</b> داوای داشکاندنی ${money(a.amt)} دەکات لەسەر ${money(a.sub)}</p><small>${a.why ? esc(a.why) + ' · ' : ''}${esc(S.branches[a.branch])} · ${hm(a.t)}</small></div><div class="row"><button class="btn green sm" data-ok="${a.id}">ڕازیم</button><button class="ghost sm" data-no="${a.id}">نا</button></div></div>`).join('') || '<div class="empty"><b>هیچ داواکارییەک نییە</b>داواکاریی داشکاندنی کارمەندەکان لێرە دەردەکەوێت</div>'}</div>` : ''}
      <div class="card pad"><h2>دوایین کارەکان</h2>${S.log.filter(inB).slice(0, 7).map(feedRow).join('') || '<div class="empty"><b>هێشتا هیچ شتێک ڕووی نەداوە</b></div>'}</div></div>
    <div style="display:grid;gap:18px">
      <div class="card pad"><h2>فرۆشی کارمەندەکان</h2><div class="duel">${Object.entries(staff).map(([n, v]) => `<div><div class="row sp"><span class="row"><span class="av" style="width:30px;height:30px;border-radius:9px;font-size:13px">${esc(n[0].toUpperCase())}</span><b class="en">${esc(n)}</b><small class="mute"><span class="num">${v.n}</span> پسولە · <span class="num">${v.u}</span> دانە</small></span><b class="num">${fmtMoney(v.sum)}</b></div><div class="bar" style="margin-top:8px"><i style="width:${v.sum / maxStaff * 100}%"></i></div></div>`).join('') || '<div class="empty">هێشتا فرۆشتن نییە</div>'}</div></div>
      <div class="card pad"><h2>کاڵای کەمبوو</h2>${low.map(i => `<div class="item" style="align-items:center"><div class="grow"><p class="en" style="text-align:left;font-weight:600">${esc(i.name)}</p></div>${i.s.map((n, k) => b < 0 || b === k ? `<span class="row" style="gap:6px"><small>${esc(S.branches[k])}</small>${bat(n)}</span>` : '').join('')}</div>`).join('') || '<div class="empty">هەموو کاڵاکان بە بڕی باش هەن</div>'}</div></div></div>`;
  $('#view').querySelectorAll('[data-days]').forEach(x => x.onclick = () => { S.chartDays = +x.dataset.days; render(true); });
  $('#view').querySelectorAll('[data-fv]').forEach(x => x.onclick = () => run('fibVerify', { no: +x.dataset.fv }, () => { toast('پشتڕاست کرایەوە'); render(); }));
  const arc = $('#arc'); if (MO()) requestAnimationFrame(() => requestAnimationFrame(() => arc.style.strokeDashoffset = arc.dataset.off)); else arc.style.strokeDashoffset = arc.dataset.off;
  $('#tgt').onclick = () => { if (!own) return toast('تەنها بەڕێوەبەر ئامانج دەگۆڕێت', 1); modal(`<h2>ئامانجی ڕۆژانە</h2><label class="f">بڕ بە ${CUR()}<input class="inp num" id="tA" type="text" inputmode="decimal" min="1" step="1" value="${amtOut(S.target)}"></label><div class="acts"><button class="btn volt" id="tOk">هەڵگرتن</button><button class="ghost" id="tNo">پاشگەزبوونەوە</button></div>`); $('#tNo').onclick = closeModal; $('#tOk').onclick = () => run('setTarget', { target: toC($('#tA').value) }, () => { closeModal(); render(true); }); };
  const decide = (id, ok) => run('decideRequest', { id, ok }, () => { render(); $('#arc').style.strokeDashoffset = $('#arc').dataset.off; });
  $('#view').querySelectorAll('[data-ok]').forEach(x => x.onclick = () => decide(+x.dataset.ok, true));
  $('#view').querySelectorAll('[data-no]').forEach(x => x.onclick = () => decide(+x.dataset.no, false));
};
const isoD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGES = { day: 'ئەمڕۆ', week: 'ئەم هەفتەیە', month: 'ئەم مانگە' };
function setRange(k) { const to = new Date(), from = new Date(); if (k === 'week') from.setDate(from.getDate() - ((from.getDay() + 1) % 7)); if (k === 'month') from.setDate(1); S.range = { key: k, from: isoD(from), to: isoD(to) }; }
setRange('month');
function perfRows() {
  const a = new Date(S.range.from + 'T00:00:00'), b = new Date(S.range.to + 'T23:59:59.999');
  return S.team.filter(u => u.role !== 'owner').map(u => { const ss = S.sales.filter(x => x.by === u.name && x.t >= a && x.t <= b), net = ss.reduce((t, x) => t + x.total - x.refunded, 0); return { u, n: ss.length, net, com: Math.round(net * (u.pct || 0) / 100) }; }).sort((x, y) => y.net - x.net || y.n - x.n);
}
const pctTxt = v => v == null ? 'دانەنراوە' : `${+v}%`;
V.perf = () => {
  const own = isOwner(), rows = perfRows(), mx = Math.max(...rows.map(r => r.net), 1), meRow = rows.find(r => r.u.name === me().name), myRank = rows.indexOf(meRow) + 1;
  const top = rows.filter(r => r.net > 0).slice(0, 3), order = top.length === 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
  const podium = top.length && top[0].net > 0 ? `<div class="card pad podium">${order.map(i => { const r = top[i]; return `<div class="pd p${i + 1}"><div class="av">${esc(r.u.name[0].toUpperCase())}</div><b class="en">${esc(r.u.name)}</b>${cu(r.net)}<div class="blk"><span class="num">${i + 1}</span></div></div>`; }).join('')}</div>` : '';
  const mine = !own && meRow ? `<div class="card pad mycard"><div class="rk"><small>پلەی تۆ</small><b class="num">${meRow.net > 0 ? '#' + myRank : '—'}</b><span>لە <span class="num">${rows.length}</span> کەس</span></div>
      <div class="grow"><div class="kgrid" style="margin:0;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="card kpi"><small>فرۆشی من</small>${cu(meRow.net, 'mySales')}</div>
        <div class="card kpi"><small>ڕێژەی سوودم</small><b class="num" id="myPct">${pctTxt(meRow.u.pct)}</b></div>
        <div class="card kpi"><small>سوودی ئەم ماوەیە</small>${cu(meRow.com, 'myCom')}</div>
        <div class="card kpi"><small>مووچەی مانگانەم</small>${meRow.u.salary != null ? `<b class="num" id="mySalary">${fmtCur(meRow.u.salary, meRow.u.salaryCur)}</b>` : '<b id="mySalary" class="mute" style="font-size:17px">دانەنراوە</b>'}</div></div>
        ${rows[0] && rows[0] !== meRow && rows[0].net > meRow.net ? `<p class="mute" style="margin-top:12px">بۆ گەیشتن بە پلەی یەکەم ${money(rows[0].net - meRow.net + 1)}ی تر پێویستە.</p>` : meRow.net > 0 ? '<p style="margin-top:12px;color:var(--volt);font-weight:800">تۆ لە پێشەوەیت — بەردەوام بە!</p>' : ''}</div></div>` : '';
  $('#view').innerHTML = `<div class="row sp" style="margin-bottom:14px;flex-wrap:wrap">
      <div class="chips" style="margin:0">${Object.entries(RANGES).map(([k, v]) => `<button class="chip ${S.range.key === k ? 'on' : ''}" data-rg="${k}">${v}</button>`).join('')}</div>
      <div class="row"><span class="mute">لە</span><input class="inp num" type="date" id="pFrom" value="${S.range.from}" style="width:auto"><span class="mute">تا</span><input class="inp num" type="date" id="pTo" value="${S.range.to}" style="width:auto"></div></div>
    ${mine}${podium}
    <div class="card scroll"><table><tr><th>پلە</th><th>ناو</th><th>ئاست</th><th>پسولە</th><th style="min-width:230px">فرۆش</th>${own ? '<th>ڕێژە</th><th>سوود</th><th>مووچە</th><th>کۆی پارەدان</th><th></th>' : ''}</tr>
    ${rows.map((r, i) => `<tr class="${r.u.name === me().name ? 'me' : ''}"><td><span class="medal m${r.net > 0 ? Math.min(i + 1, 4) : 4} num">${i + 1}</span></td><td><b class="en">${esc(r.u.name)}</b></td><td><span class="tag ${r.u.role === 'sup' ? 'b' : 'n'}">${ROLE[r.u.role]}</span></td><td class="num">${r.n}</td>
      <td><div class="row"><b class="num" style="min-width:86px" data-net="${esc(r.u.name)}">${fmtMoney(r.net)}</b><div class="duel grow" style="margin:0"><div class="bar"><i style="width:${r.net / mx * 100}%"></i></div></div></div></td>
      ${own ? `<td><span class="tag ${r.u.pct != null ? 'g' : 'n'} num">${pctTxt(r.u.pct)}</span></td><td><b class="num" data-com="${esc(r.u.name)}">${fmtMoney(r.com)}</b></td><td class="num">${r.u.salary != null ? fmtCur(r.u.salary, r.u.salaryCur) : '<span class="mute">—</span>'}</td><td><b class="num" style="color:var(--volt)">${fmtMoney(salC(r.u) + r.com)}</b></td><td><div class="row"><button class="ghost sm" data-pe="${esc(r.u.name)}">دانان</button><button class="ghost sm" data-po="${esc(r.u.name)}">پارەدان</button></div></td>` : ''}</tr>`).join('')}</table></div>
    ${own ? `<div class="row sp card pad" style="margin-top:14px"><span>کۆی ئەوەی بۆ ئەم ماوەیە دەبێت بیدەیت (مووچە + سوود)</span><b class="num" id="payAll" style="font-size:22px;color:var(--volt)">${fmtMoney(rows.reduce((a, r) => a + salC(r.u) + r.com, 0))}</b></div>` : ''}${ledgerHtml()}`;
  $('#view').querySelectorAll('[data-rg]').forEach(b => b.onclick = () => { setRange(b.dataset.rg); render(true); });
  const rg = () => { let f = $('#pFrom').value, t = $('#pTo').value; if (!f || !t) return; if (f > t) [f, t] = [t, f]; S.range = { key: '', from: f, to: t }; render(true); };
  $('#pFrom').onchange = rg; $('#pTo').onchange = rg;
  $('#view').querySelectorAll('[data-pe]').forEach(b => b.onclick = () => payEdit(acct(b.dataset.pe)));
  $('#view').querySelectorAll('[data-po]').forEach(b => b.onclick = () => payOut(acct(b.dataset.po)));
  if ($('#nNew')) $('#nNew').onclick = noteNew;
};
const LK = { dayoff: 'دەوامی ڕۆژی پشوو', salary: 'مووچە', bonus: 'پاداشت', cut: 'بڕین', other: 'هیتر' };
const fmtCur = Core.fmtCur;
const minor = (v, c) => c === 'IQD' ? Math.round(pn(v, true)) : Math.round(pn(v) * 100); // typed amount in its own currency
const salC = u => u.salary == null ? 0 : u.salaryCur === 'IQD' ? Math.round(u.salary / S.rate * 100) : u.salary; // salary in cents for totals
const curPick = (id, cur) => `<div class="pick" id="${id}">${[['USD', 'دۆلار $'], ['IQD', 'دینار د.ع']].map(([k, v]) => `<button data-c="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('')}</div>`;
const onPick = (id, fn) => document.querySelectorAll('#' + id + ' button').forEach(b => b.onclick = () => { document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); fn(b); });
function payEdit(u) {
  const net = (perfRows().find(r => r.u === u) || { net: 0 }).net; let cur = u.salaryCur || 'USD';
  modal(`<h2>مووچە و ڕێژەی سوود — <span class="en">${esc(u.name)}</span></h2><p class="mute" style="margin-bottom:12px">ڕێژەکە لەسەر فرۆشی خۆی هەژمار دەکرێت (دوای کەمکردنەوەی گەڕاوە). کاتێک هەڵیدەگریت وەک پەیام بۆی دەچێت.</p>
    <label class="f">ڕێژەی سوود %<input class="inp num" id="cP" type="text" inputmode="decimal" value="${u.pct ?? ''}"></label>
    <div class="chips" style="margin:-4px 0 14px">${[1, 2, 3, 4, 5, 10].map(n => `<button class="chip" data-pc="${n}"><span class="num">${n}%</span></button>`).join('')}</div>
    <label class="f">مووچەی مانگانە<input class="inp num" id="cS" type="text" inputmode="decimal" value="${u.salary != null ? (cur === 'IQD' ? u.salary : (u.salary / 100).toFixed(2)) : ''}"></label>
    <div style="margin:-4px 0 14px">${curPick('cCur', cur)}</div>
    <div class="card pad rc" id="cPrev"></div>
    <div class="acts"><button class="btn volt" id="cOk">هەڵگرتن و ناردنی پەیام</button><button class="ghost" id="cNo">پاشگەزبوونەوە</button></div>`);
  const prev = () => { const p = pn($('#cP').value) || 0, sal = minor($('#cS').value || 0, cur) || 0, com = Math.round(net * p / 100); $('#cPrev').innerHTML = `<div class="row sp"><span>فرۆشی ئەم ماوەیە</span>${money(net)}</div><div class="row sp"><span>سوود بە <span class="num">${p}%</span></span><b>${money(com)}</b></div><div class="row sp"><span>مووچە</span><b class="num">${fmtCur(sal, cur)}</b></div>`; };
  document.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { $('#cP').value = b.dataset.pc; prev(); });
  onPick('cCur', b => { cur = b.dataset.c; prev(); });
  $('#cP').oninput = prev; $('#cS').oninput = prev; prev(); $('#cNo').onclick = closeModal;
  $('#cOk').onclick = () => { const pv = $('#cP').value.trim(), sv = $('#cS').value.trim();
    run('setPay', { name: u.name, pct: pv === '' ? null : pn(pv), salary: sv === '' ? null : minor(sv, cur), cur }, () => { closeModal(); toast('هەڵگیرا و پەیامەکە بۆ ' + u.name + ' چوو'); V[S.view](); }); };
}
function payOut(u) { // extra money on a person's own account: day-off work, bonus, salary paid... in dollar or dinar, always with a reason
  let kind = 'dayoff', cur = u.salaryCur || 'USD';
  modal(`<h2>پارەدان بۆ <span class="en">${esc(u.name)}</span></h2><p class="mute" style="margin-bottom:12px">دەچێتە سەر حیسابی خۆی و لەگەڵ تێبینییەکەت وەک پەیام بۆی دەچێت.</p>
    <label class="f" style="margin-bottom:6px">جۆر</label><div class="pick" id="oK" style="margin-bottom:14px">${Object.entries(LK).map(([k, v]) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${v}</button>`).join('')}</div>
    <label class="f">بڕ<input class="inp num" id="oA" type="text" inputmode="decimal"></label><div style="margin:-4px 0 14px">${curPick('oC', cur)}</div>
    <label class="f">بەروار<input class="inp num" id="oD" type="date" value="${isoD(new Date())}"></label>
    <label class="f">تێبینی — هۆکاری ئەم پارەدانە<textarea class="inp" id="oN" placeholder="بۆ نموونە: ڕۆژی هەینی کە پشووی بوو دەوامی کرد"></textarea></label>
    <div class="acts"><button class="btn volt" id="oOk">تۆمارکردن و ناردنی پەیام</button><button class="ghost" id="oNo">پاشگەزبوونەوە</button></div>`);
  onPick('oK', b => kind = b.dataset.k); onPick('oC', b => cur = b.dataset.c); $('#oNo').onclick = closeModal;
  $('#oOk').onclick = () => run('payOut', { to: u.name, kind, amount: minor($('#oA').value, cur), cur, d: $('#oD').value, note: $('#oN').value.trim() }, () => { closeModal(); toast('تۆمار کرا و پەیامەکە بۆ ' + u.name + ' چوو'); V[S.view](); });
}
function noteNew() {
  const sel = new Set(), people = S.team.filter(u => u.role !== 'owner');
  modal(`<h2>تێبینیی نوێ</h2><label class="f">تێبینی<textarea class="inp" id="tT" placeholder="هەر شتێک کە دەتەوێت بیزانن"></textarea></label>
    <label class="f" style="margin-bottom:6px">ئاماژە بۆ کێ؟</label><div class="pick" id="tP"><button data-m="all">هەمووان</button>${people.map(u => `<button data-m="${esc(u.name)}">@${esc(u.name)}</button>`).join('')}</div>
    <div class="acts"><button class="btn volt" id="tOk">ناردن</button><button class="ghost" id="tNo">پاشگەزبوونەوە</button></div>`);
  document.querySelectorAll('#tP button').forEach(b => b.onclick = () => { const m = b.dataset.m; if (m === 'all') { sel.clear(); sel.add('all'); } else { sel.delete('all'); sel.has(m) ? sel.delete(m) : sel.add(m); } document.querySelectorAll('#tP button').forEach(x => x.classList.toggle('on', sel.has(x.dataset.m))); });
  $('#tNo').onclick = closeModal;
  $('#tOk').onclick = () => run('note', { text: $('#tT').value.trim(), to: sel.has('all') ? 'all' : [...sel] }, () => { closeModal(); toast('تێبینییەکە نێردرا'); V[S.view](); });
}
function ledgerHtml() {
  const own = isOwner(), L = S.ledger.filter(x => own || x.to === S.me), N = S.notes.filter(n => own || n.to === 'all' || n.to.includes(S.me)), sum = c => L.filter(x => x.cur === c).reduce((a, x) => a + x.amount, 0);
  return `<div class="two" style="margin-top:14px"><div class="card pad ldg"><div class="row sp" style="flex-wrap:wrap"><h2>${own ? 'پارەدان و پاداشتەکان' : 'حیسابی من'}</h2><div class="row"><span class="tag g num" id="ldUSD">${fmtCur(sum('USD'), 'USD')}</span><span class="tag b num" id="ldIQD">${fmtCur(sum('IQD'), 'IQD')}</span></div></div>
      ${L.map(x => `<div class="item"><div class="dot ${x.amount < 0 ? 'r' : 'g'}">${ico('expenses', 17)}</div><div class="grow"><p>${own ? `<b>${esc(x.to)}</b> · ` : ''}<span class="tag n">${LK[x.kind]}</span> <b class="num">${fmtCur(x.amount, x.cur)}</b></p><div class="note" style="margin-top:6px"><p>${esc(x.note)}</p></div><small><span class="num">${esc(x.d)}</span> · ${esc(x.by)}</small></div></div>`).join('') || '<div class="empty"><b>هێشتا هیچ پارەدانێک تۆمار نەکراوە</b>دەوامی ڕۆژی پشوو، پاداشت و مووچەی دراو لێرە دەردەکەون</div>'}</div>
    <div class="card pad"><div class="row sp"><h2>${own ? 'تێبینییەکان' : 'تێبینی بۆ من'}</h2>${own ? '<button class="ghost sm" id="nNew">تێبینیی نوێ</button>' : ''}</div>
      ${N.map(n => `<div class="note"><p>${esc(n.text)}</p><div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">${(n.to === 'all' ? ['هەمووان'] : n.to).map(x => `<span class="tag b">@${esc(x)}</span>`).join('')}<small class="mute"><span class="num">${n.t.toLocaleDateString('en-GB')}</span> ${hm(n.t)} · ${esc(n.by)}</small></div></div>`).join('') || '<div class="empty"><b>هیچ تێبینییەک نییە</b></div>'}</div></div>`;
}
V.settings = () => {
  const ex = S.items.slice(0, 4);
  $('#view').innerHTML = `<div class="two"><div style="display:grid;gap:18px">
    <div class="card pad"><h2>دراوی سیستەم</h2><p class="mute" style="margin:4px 0 14px">تەنها بەڕێوەبەر دەیگۆڕێت. کاتێک دەیگۆڕیت، لای هەموو کارمەند و سوپەرڤایزەرەکان و لە هەموو لقەکان دەگۆڕێت.</p>
      <div class="seg" style="display:inline-flex"><button data-cur="USD" class="${S.cur === 'USD' ? 'on' : ''}">دۆلار $</button><button data-cur="IQD" class="${S.cur === 'IQD' ? 'on' : ''}">دینار د.ع</button></div></div>
    <div class="card pad"><h2>نرخی دۆلاری ئەمڕۆ</h2><p class="mute" style="margin:4px 0 14px">هەر ڕۆژێک نرخ گۆڕا، لێرە بیگۆڕە. نرخی کاڵاکان بە دۆلار وەک خۆیان دەمێننەوە و بە دینار بەم نرخە هەژمار دەکرێن.</p>
      <div class="row raterow"><b class="num" style="font-size:22px">100$ =</b><input class="inp num grow" id="rate100" type="text" inputmode="decimal" min="1" step="250" value="${S.rate * 100}" style="font-size:20px;font-weight:800"><b>دینار</b><button class="btn volt" id="rateOk">هەڵگرتن</button></div>
      <p class="mute" style="margin-top:10px;font-size:13px">بڕی دینار بۆ نزیکترین <span class="num">250</span> دینار خڕ دەکرێتەوە، چونکە بچووکترین پارە ئەوەیە.</p></div>
    <div class="card pad"><h2>ئامانجی فرۆشی ڕۆژانە</h2><p class="mute" style="margin:4px 0 14px">بازنەی داشبۆرد بەم بڕە پڕ دەبێتەوە. هەر کاتێک بتەوێت بیگۆڕە.</p><div class="row raterow"><input class="inp num grow" id="tgA" type="text" inputmode="decimal" value="${amtOut(S.target)}" style="font-size:20px;font-weight:800"><b>${CUR()}</b><button class="btn volt" id="tgOk">هەڵگرتن</button></div></div>
    ${REMOTE ? '' : '<div class="card pad"><h2>داتای ئەم نموونەیە</h2><p class="mute" style="margin:4px 0 14px">ئەم نموونەیە هەموو شتێک تەنها لەسەر ئەم ئامێرە هەڵدەگرێت. بە سڕینەوە دەگەڕێتەوە سەرەتا.</p><button class="ghost" id="wipe">سڕینەوە و دەستپێکردنەوە</button></div>'}</div>
    <div style="display:grid;gap:18px"><div class="card pad"><h2>نموونە بەم نرخە</h2>${ex.map(i => `<div class="item" style="align-items:center"><div class="grow"><p class="en" style="text-align:left;font-weight:600">${esc(i.name)}</p></div><span class="num mute">$${(i.r / 100).toFixed(2)}</span><b class="num" style="min-width:110px;text-align:left">${iqd(i.r).toLocaleString('en-US')} د.ع</b></div>`).join('')}</div>
    <div class="card pad"><h2>مێژووی نرخ</h2>${S.rates.map(r => `<div class="item"><div class="dot a">${ico('gear', 17)}</div><div class="grow"><p><span class="num">100$ = ${(r.rate * 100).toLocaleString('en-US')} د.ع</span></p><small>${esc(r.by)} · <span class="num">${r.t.toLocaleDateString('en-GB')}</span> ${hm(r.t)}</small></div></div>`).join('')}</div></div></div>`;
  $('#view').querySelectorAll('[data-cur]').forEach(b => b.onclick = () => { if (S.cur === b.dataset.cur) return; run('setCurrency', { cur: b.dataset.cur }, () => render(true)); });
  if ($('#wipe')) $('#wipe').onclick = () => { modal(`<h2>سڕینەوەی داتای نموونە</h2><p class="mute">هەموو فرۆشتن، ئەکاونت و پاسۆردەکانی ئەم نموونەیە دەسڕێنەوە.</p><div class="acts"><button class="btn red" id="wY">بەڵێ، بیسڕەوە</button><button class="ghost" id="wN">نەخێر</button></div>`); $('#wN').onclick = closeModal; $('#wY').onclick = () => { window.__noSave = true; try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }; };
  $('#tgOk').onclick = () => run('setTarget', { target: toC($('#tgA').value) }, () => { toast('ئامانج هەڵگیرا'); render(true); });
  $('#rateOk').onclick = () => run('setRate', { v: pn($('#rate100').value, true) }, () => { toast('هەڵگیرا'); render(true); });
};
const moves = b => Core.moves(S, b, new Date()); // today's movement per item in one branch
function jardOwner() { // the manager only watches: who counted, when, which branch, what they found
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const today = S.jards.filter(j => j.t >= t0), people = S.team.filter(u => u.role !== 'owner');
  const dItems = today.reduce((a, j) => a + j.rows.filter(r => r.diff).length, 0), short = today.reduce((a, j) => a + j.rows.reduce((x, r) => x + Math.max(0, -r.diff), 0), 0), extra = today.reduce((a, j) => a + j.rows.reduce((x, r) => x + Math.max(0, r.diff), 0), 0);
  const doneBy = new Set(today.map(j => j.by));
  const sum = j => { const dn = j.rows.filter(r => r.diff).length, miss = j.rows.reduce((a, r) => a + Math.max(0, -r.diff), 0), over = j.rows.reduce((a, r) => a + Math.max(0, r.diff), 0); return { dn, miss, over }; };
  $('#view').innerHTML = `<div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="card kpi"><small>جەردی ئەمڕۆ</small>${cuInt(today.length, 'oJ')}</div>
      <div class="card kpi"><small>جەردیان کردووە</small><b class="num" id="oDone">${doneBy.size} / ${people.length}</b></div>
      <div class="card kpi"><small>کاڵای جیاواز</small>${cuInt(dItems, 'oDiff')}</div>
      <div class="card kpi"><small>دانەی کەم</small>${cuInt(short, 'oShort')}</div>
      <div class="card kpi"><small>دانەی زیاد</small>${cuInt(extra)}</div></div>
    <div class="brs">${S.branches.map((nm, b) => { const mv = moves(b), t = Object.values(mv).reduce((a, x) => ({ sold: a.sold + x.sold, ret: a.ret + x.ret, exch: a.exch + x.exch }), { sold: 0, ret: 0, exch: 0 }), last = today.find(j => j.branch === b), bad = S.exchanges.filter(x => x.branch === b).reduce((a, x) => a + x.qty, 0);
      return `<div class="card pad ${last ? '' : 'wait'}"><div class="row sp"><h2>${esc(nm)}</h2>${last ? `<span class="tag g">جەرد کراوە · ${hm(last.t)} · ${esc(last.by)}</span>` : '<span class="tag a">ئەمڕۆ جەرد نەکراوە</span>'}</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:6px"><span class="tag n">فرۆشراو <span class="num">${t.sold}</span></span><span class="tag n">گەڕاوە <span class="num">${t.ret}</span></span><span class="tag n">گۆڕاو <span class="num">${t.exch}</span></span><span class="tag n">خراپ <span class="num">${bad}</span></span><span class="tag b">ماوە <span class="num">${S.items.reduce((a, i) => a + i.s[b], 0).toLocaleString('en-US')}</span></span></div></div>`; }).join('')}</div>
    <div class="two"><div class="card pad"><h2>جەردەکان</h2><p class="mute" style="font-size:13px;margin-bottom:6px">هەموو ئەو جەردانەی کارمەند و سوپەرڤایزەرەکان ناردوویانە، نوێترین لە سەرەوە.</p>
      ${S.jards.map(j => { const x = sum(j); return `<div class="item" style="align-items:center"><div class="dot ${x.dn ? 'r' : 'g'}">${ico('jard', 17)}</div><div class="grow">
          <p><b>${esc(j.by)}</b> <span class="tag n">${ROLE[(S.team.find(u => u.name === j.by) || {}).role] || ''}</span> <span class="tag b">${esc(S.branches[j.branch])}</span></p>
          <small><span class="num">${j.t.toLocaleDateString('en-GB')}</span> · کاتژمێر ${hm(j.t)} · <span class="num">${j.rows.length}</span> کاڵا ژمێردراوە${j.note ? ' · ' + esc(j.note) : ''}</small>
          <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px">${x.dn ? `<span class="tag r"><span class="num">${x.dn}</span> جیاوازی</span>${x.miss ? `<span class="tag r">کەمە <span class="num">${x.miss}</span> دانە</span>` : ''}${x.over ? `<span class="tag a">زیادە <span class="num">${x.over}</span> دانە</span>` : ''}` : '<span class="tag g">هەمووی ڕاستە</span>'}${j.applied ? '<span class="tag b">کۆگا ڕاست کراوەتەوە</span>' : ''}</div></div>
          <button class="ghost sm" data-jv="${j.id}">وردەکاری</button></div>`; }).join('') || '<div class="empty"><b>هێشتا هیچ جەردێک نەنێردراوە</b>کاتێک کارمەندێک جەرد دەنێرێت، لێرە دەردەکەوێت و ئاگەداریت بۆ دێت</div>'}</div>
    <div class="card pad"><h2>کێ ئەمڕۆ جەردی کرد؟</h2>${people.map(u => { const mine = today.filter(j => j.by === u.name), l = mine[0]; return `<div class="item" style="align-items:center"><div class="av" style="width:34px;height:34px;border-radius:10px;font-size:14px">${esc(u.name[0].toUpperCase())}</div><div class="grow"><p><b>${esc(u.name)}</b></p><small>${ROLE[u.role]} · ${u.branch < 0 ? 'هەموو لقەکان' : esc(S.branches[u.branch])}</small></div>${l ? `<span class="tag g" data-dn="${esc(u.name)}">${hm(l.t)} · <span class="num">${mine.length}</span> جەرد</span>` : `<span class="tag r" data-nc="${esc(u.name)}">نەیکردووە</span>`}</div>`; }).join('')}</div></div>`;
  $('#view').insertAdjacentHTML('beforeend', `<div class="card pad" style="margin-top:18px" id="closes"><h2>داخستنی قاصەکان</h2><p class="mute" style="font-size:13px;margin-bottom:6px">کارمەند تەنها ئەوە دەنووسێت کە ژماردوویەتی؛ نازانێت سیستەم چەندی چاوەڕێ دەکرد.</p>${(S.closes || []).slice(0, 30).map(c => `<div class="item" style="align-items:center"><div class="dot ${c.diff ? (c.diff < 0 ? 'r' : 'a') : 'g'}">${ico('expenses', 17)}</div><div class="grow"><p><b>${esc(c.by)}</b> <span class="tag b">${esc(S.branches[c.branch])}</span> ژمێردراو <b class="num">${fmtMoney(c.counted)}</b> · دەبوو <span class="num">${fmtMoney(c.expected)}</span> بێت</p><small><span class="num">${c.t.toLocaleDateString('en-GB')}</span> · کاتژمێر ${hm(c.t)}${c.note ? ' · ' + esc(c.note) : ''}</small></div><span class="tag ${c.diff ? (c.diff < 0 ? 'r' : 'a') : 'g'}">${c.diff ? (c.diff < 0 ? 'کەمە ' : 'زیادە ') + `<span class="num">${fmtMoney(Math.abs(c.diff))}</span>` : 'ڕاستە'}</span></div>`).join('') || '<div class="empty"><b>هێشتا هیچ قاصەیەک دانەخراوە</b></div>'}</div>`);
  $('#view').querySelectorAll('[data-jv]').forEach(x => x.onclick = () => jardView(S.jards.find(j => j.id === +x.dataset.jv)));
}
V.jard = () => {
  if (isOwner()) return jardOwner();
  const b = S.branch, mv = moves(b), own = isOwner(), cnt = S.count[b] || (S.count[b] = {});
  const tot = Object.values(mv).reduce((a, x) => ({ sold: a.sold + x.sold, ret: a.ret + x.ret, exch: a.exch + x.exch }), { sold: 0, ret: 0, exch: 0 });
  const left = S.items.reduce((a, i) => a + i.s[b], 0), faulty = S.exchanges.filter(x => x.branch === b).reduce((a, x) => a + x.qty, 0);
  const moved = S.items.filter(i => mv[i.id]), f = S.jardFilter || (moved.length ? 'moved' : 'all'), q = S.jardQ.toLowerCase();
  const list = (f === 'moved' ? moved : S.items.filter(i => i.s[b] > 0 || mv[i.id])).filter(i => !q || i.name.toLowerCase().includes(q) || i.bc.includes(q));
  const done = Object.keys(cnt).length, diffs = Object.entries(cnt).filter(([id, n]) => n !== item(+id).s[b]).length;
  const subs = S.jards.filter(j => lvl() > 1 || j.by === me().name), d0 = Core.dayStart(S, new Date()), myCloses = (S.closes || []).filter(c => c.by === S.me && c.branch === b && Core.ms(c.t) >= d0);
  $('#view').innerHTML = `<div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <div class="card kpi"><small>ئەمڕۆ فرۆشراو</small>${cuInt(tot.sold, 'jSold')}</div><div class="card kpi"><small>گەڕاوە</small>${cuInt(tot.ret, 'jRet')}</div><div class="card kpi"><small>گۆڕاو (زەمانەت)</small>${cuInt(tot.exch, 'jExch')}</div><div class="card kpi"><small>خراپ</small>${cuInt(faulty, 'jBad')}</div><div class="card kpi"><small>ماوە لە ${esc(S.branches[b])}</small>${cuInt(left, 'jLeft')}</div></div>
    <div class="card pad" style="margin-bottom:14px"><h2>داخستنی قاصە — ${esc(S.branches[b])}</h2><p class="mute" style="font-size:13px;margin:2px 0 12px">پارەی کاشی ناو قاصە بژمێرە و بینووسە. بەڕێوەبەر بەراوردی دەکات لەگەڵ فرۆشتنەکان.</p>
      <div class="row raterow"><input class="inp num grow" id="dcA" type="text" inputmode="decimal" placeholder="بڕی کاشی ژمێردراو" style="font-size:18px;font-weight:800"><b>${CUR()}</b><input class="inp grow" id="dcN" placeholder="تێبینی (ئارەزوومەندانە)" maxlength="200"><button class="btn volt" id="dcOk">ناردن</button></div>
      ${myCloses.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px">${myCloses.map(c => `<span class="tag g">${hm(c.t)} · نێردرا: <span class="num">${fmtMoney(c.counted)}</span></span>`).join('')}</div>` : ''}</div>
    <div class="card pad" style="margin-bottom:14px"><div class="row sp" style="flex-wrap:wrap"><div><h2>ژماردنی ئەمڕۆ — ${esc(S.branches[b])}</h2><p class="mute" style="font-size:13px">تەنها ئەوە بنووسە کە بە دەست ژماردووتە. فرۆشراو، گەڕاوە و گۆڕاو سیستەمەکە خۆی دەیزانێت.</p></div>
        <div class="chips" style="margin:0"><button class="chip ${f === 'moved' ? 'on' : ''}" data-jf="moved">جووڵاوەکانی ئەمڕۆ <span class="num">${moved.length}</span></button><button class="chip ${f === 'all' ? 'on' : ''}" data-jf="all">هەموو کاڵاکان</button></div></div>
      <input class="inp" id="jQ" placeholder="گەڕان بە ناو یان بارکۆد" value="${esc(S.jardQ)}" style="margin:12px 0 4px">
      ${list.map(i => { const m = mv[i.id] || { sold: 0, ret: 0, exch: 0 }, sys = i.s[b], has = cnt[i.id] != null, d = has ? cnt[i.id] - sys : 0;
        return `<div class="jrow"><div class="grow"><p class="en" style="text-align:left;font-weight:700">${esc(i.name)}</p><small class="mute">فرۆشراو <span class="num">${m.sold}</span> · گەڕاوە <span class="num">${m.ret}</span> · گۆڕاو <span class="num">${m.exch}</span> · دەبێت <b class="num" style="color:var(--ink)">${sys}</b> مابێت</small></div>
          <div class="row">${has ? `<span class="tag ${d === 0 ? 'g' : 'r'}">${d === 0 ? 'ڕاستە' : (d < 0 ? 'کەمە ' : 'زیادە ') + `<span class="num">${Math.abs(d)}</span>`}</span>` : ''}
          <div class="qty"><button data-jm="${i.id}">−</button><input class="inp num jc" data-id="${i.id}" type="text" inputmode="decimal" min="0" step="1" inputmode="numeric" placeholder="ژماردم" value="${has ? cnt[i.id] : ''}"><button data-jp="${i.id}">+</button></div><button class="ghost sm" data-jok="${i.id}">ڕاستە</button></div></div>`; }).join('') || '<div class="empty"><b>ئەمڕۆ هیچ کاڵایەک نەجووڵاوە</b>«هەموو کاڵاکان» هەڵبژێرە بۆ ژماردنی تەواو</div>'}
      <div class="jfoot"><div class="grow"><b><span class="num">${done}</span> کاڵا ژمێردراوە</b> · <span class="${diffs ? 'tag r' : 'mute'}"><span class="num">${diffs}</span> جیاوازی</span><input class="inp" id="jNote" placeholder="تێبینی (ئارەزوومەندانە)" style="margin-top:8px"></div><button class="btn volt" id="jSend" ${done ? '' : 'disabled'}>ناردنی جەرد بۆ بەڕێوەبەر</button></div></div>
    <div class="card pad"><h2>${lvl() > 1 ? 'جەردە نێردراوەکان' : 'جەردەکانی من'}</h2>${subs.map(j => { const dn = j.rows.filter(r => r.diff).length, miss = j.rows.reduce((a, r) => a + Math.min(0, r.diff), 0); return `<div class="item" style="align-items:center"><div class="dot ${dn ? 'r' : 'g'}">${ico('jard', 17)}</div><div class="grow"><p><b>${esc(j.by)}</b> · ${esc(S.branches[j.branch])} · <span class="num">${j.rows.length}</span> کاڵا ${dn ? `<span class="tag r"><span class="num">${dn}</span> جیاوازی${miss ? ` · کەمیی <span class="num">${-miss}</span> دانە` : ''}</span>` : '<span class="tag g">هەمووی ڕاستە</span>'}${j.applied ? ' <span class="tag b">جێبەجێ کراوە</span>' : ''}</p><small><span class="num">${j.t.toLocaleDateString('en-GB')}</span> ${hm(j.t)}${j.note ? ' · ' + esc(j.note) : ''}</small></div><button class="ghost sm" data-jv="${j.id}">بینین</button></div>`; }).join('') || '<div class="empty"><b>هێشتا هیچ جەردێک نەنێردراوە</b></div>'}</div>`;
  const set = (id, n) => { if (n == null || n < 0 || !Number.isInteger(n)) delete cnt[id]; else cnt[id] = n; V.jard(); };
  document.querySelectorAll('.jc').forEach(x => x.onchange = () => set(+x.dataset.id, x.value === '' ? null : Math.floor(+x.value)));
  $('#view').querySelectorAll('[data-jp]').forEach(x => x.onclick = () => { const id = +x.dataset.jp; set(id, (cnt[id] ?? item(id).s[b]) + 1); });
  $('#view').querySelectorAll('[data-jm]').forEach(x => x.onclick = () => { const id = +x.dataset.jm; set(id, Math.max(0, (cnt[id] ?? item(id).s[b]) - 1)); });
  $('#view').querySelectorAll('[data-jok]').forEach(x => x.onclick = () => set(+x.dataset.jok, item(+x.dataset.jok).s[b]));
  $('#view').querySelectorAll('[data-jf]').forEach(x => x.onclick = () => { S.jardFilter = x.dataset.jf; V.jard(); });
  $('#jQ').onchange = () => { S.jardQ = $('#jQ').value.trim(); V.jard(); };
  $('#view').querySelectorAll('[data-jv]').forEach(x => x.onclick = () => jardView(S.jards.find(j => j.id === +x.dataset.jv)));
  $('#dcOk').onclick = () => { const raw = $('#dcA').value.trim(); if (raw === '') return toast('بڕی کاشی ژمێردراو بنووسە', 1); run('drawerClose', { branch: b, counted: toC(raw), note: $('#dcN').value.trim() }, () => { toast('قاصەکە نێردرا بۆ بەڕێوەبەر'); V.jard(); }); };
  $('#jSend').onclick = () => run('jardSubmit', { branch: b, counts: cnt, note: $('#jNote').value.trim() }, () => { S.count[b] = {}; toast('جەردەکە نێردرا'); V.jard(); });
};
function jardView(j) {
  const dn = j.rows.filter(r => r.diff).length;
  modal(`<h2>جەردی ${esc(j.by)} — ${esc(S.branches[j.branch])}</h2><p class="mute" style="margin-bottom:10px"><span class="num">${j.t.toLocaleDateString('en-GB')}</span> ${hm(j.t)}${j.note ? ' · ' + esc(j.note) : ''}</p>
    <div class="scroll"><table><tr><th>کاڵا</th><th>فرۆشراو</th><th>گەڕاوە</th><th>گۆڕاو</th><th>سیستەم</th><th>ژمێردراو</th><th>جیاوازی</th></tr>${j.rows.map(r => `<tr><td class="en">${esc(r.name)}</td><td class="num">${r.sold}</td><td class="num">${r.ret}</td><td class="num">${r.exch}</td><td class="num">${r.sys}</td><td class="num"><b>${r.counted}</b></td><td>${r.diff ? `<span class="tag r num">${r.diff > 0 ? '+' : ''}${r.diff}</span>` : '<span class="tag g">ڕاستە</span>'}</td></tr>`).join('')}</table></div>
    <div class="acts">${isOwner() && dn && !j.applied ? '<button class="btn volt" id="jApply">ڕاستکردنەوەی کۆگا بەم ژمارانە</button>' : ''}<button class="ghost" id="jX">داخستن</button></div>`);
  $('#sheet').style.width = '760px'; $('#jX').onclick = () => { $('#sheet').style.width = ''; closeModal(); };
  if ($('#jApply')) $('#jApply').onclick = () => run('jardApply', { id: j.id }, () => { $('#sheet').style.width = ''; closeModal(); toast('کۆگا ڕاست کرایەوە'); render(true); });
}
V.team = () => {
  const CAN = { owner: 'هەموو شتێک: قازانج، نرخ، داشکاندن، ئەکاونتەکان، ڕێکخستنەکان', sup: 'داخیلکردن، گەڕاندنەوە، کەمکردنەوەی کۆگا، مەسروفات، پسولەکان — بێ قازانج و نرخی کڕین', staff: 'تەنها فرۆشتن، کڕیار، جەرد و حیسابی خۆی' };
  $('#view').innerHTML = `<div class="row sp" style="margin-bottom:14px;flex-wrap:wrap"><p class="mute">تەنها تۆ دەتوانیت ئەکاونت دروست بکەیت، پاسۆرد دابنێیت یان بیسڕیتەوە.</p><button class="btn volt" id="uNew">ئەکاونتی نوێ</button></div>
    <div class="card scroll"><table><tr><th>ناو</th><th>ئاست</th><th>لق</th><th>چوونەژوورەوە</th><th>ڕێژە</th><th>مووچە</th><th>دەسەڵات</th><th></th></tr>${S.team.map(u => `<tr><td><b>${esc(u.name)}</b></td><td><span class="tag ${u.role === 'owner' ? 'a' : u.role === 'sup' ? 'b' : 'n'}">${ROLE[u.role]}</span></td><td>${u.branch < 0 ? 'هەموو لقەکان' : esc(S.branches[u.branch])}</td>
      <td><span class="tag ${u.pw ? 'g' : 'r'}" data-has="${esc(u.name)}">${u.pw ? 'پاسۆردی هەیە' : 'پاسۆردی نییە'}</span></td><td class="num">${u.role === 'owner' ? '—' : pctTxt(u.pct)}</td><td class="num">${u.role === 'owner' ? '—' : u.salary != null ? fmtCur(u.salary, u.salaryCur) : 'دانەنراوە'}</td><td class="mute" style="font-size:13px;min-width:220px">${CAN[u.role]}</td>
      <td><div class="row"><button class="ghost sm" data-pw="${esc(u.name)}">پاسۆرد</button>${u.role !== 'owner' ? `<button class="ghost sm" data-pe="${esc(u.name)}">مووچە</button><button class="ghost sm" data-del="${esc(u.name)}">سڕینەوە</button>` : ''}</div></td></tr>`).join('')}</table></div>`;
  $('#view').querySelectorAll('[data-pe]').forEach(b => b.onclick = () => payEdit(acct(b.dataset.pe)));
  $('#view').querySelectorAll('[data-pw]').forEach(b => b.onclick = () => { const u = acct(b.dataset.pw);
    modal(`<h2>پاسۆردی <span class="en">${esc(u.name)}</span></h2><p class="mute" style="margin-bottom:12px">پاسۆردێکی نوێ دابنێ و بیدە بە خۆی. پاسۆردە کۆنەکە ئیتر کار ناکات.</p><label class="f">پاسۆردی نوێ (لانی کەم 6 پیت)<input class="inp" id="wP" type="password" autocomplete="new-password"></label><div class="acts"><button class="btn volt" id="wOk2">هەڵگرتن</button><button class="ghost" id="wNo2">پاشگەزبوونەوە</button></div>`);
    $('#wNo2').onclick = closeModal; $('#wOk2').onclick = () => run('setPassword', Object.assign({ name: u.name }, pwArg(u.name, $('#wP').value)), () => { closeModal(); toast('پاسۆرد دانرا'); V.team(); }); });
  $('#view').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const u = acct(b.dataset.del);
    modal(`<h2>سڕینەوەی ئەکاونت</h2><p style="margin-bottom:6px"><b>${esc(u.name)}</b> ئیتر ناتوانێت بچێتە ژوورەوە.</p><p class="mute">فرۆشتن و کارە کۆنەکانی بە ناوی خۆیەوە دەمێننەوە.</p><div class="acts"><button class="btn red" id="dOk2">سڕینەوە</button><button class="ghost" id="dNo2">پاشگەزبوونەوە</button></div>`);
    $('#dNo2').onclick = closeModal; $('#dOk2').onclick = () => run('deleteAccount', { name: u.name }, () => { closeModal(); V.team(); }); });
  $('#uNew').onclick = () => { modal(`<h2>ئەکاونتی نوێ</h2><label class="f">ناو<input class="inp" id="uN" autocomplete="off"></label><label class="f">پاسۆرد (لانی کەم 6 پیت)<input class="inp" id="uPw" type="password" autocomplete="new-password"></label><label class="f">ئاست<select class="inp" id="uR"><option value="staff">کارمەند</option><option value="sup">سوپەرڤایزەر</option><option value="owner">بەڕێوەبەر</option></select></label><label class="f">لق<select class="inp" id="uB">${S.branches.map((b, i) => `<option value="${i}">${esc(b)}</option>`).join('')}<option value="-1">هەموو لقەکان</option></select></label><div class="acts"><button class="btn volt" id="uOk">دروستکردن</button><button class="ghost" id="uNo">پاشگەزبوونەوە</button></div>`);
    $('#uNo').onclick = closeModal; $('#uOk').onclick = () => { const name = $('#uN').value.trim();
      run('newAccount', Object.assign({ name, role: $('#uR').value, home: +$('#uB').value }, pwArg(name, $('#uPw').value)), () => { closeModal(); toast('ئەکاونتەکە دروست کرا'); V.team(); }); }; };
};

V.sales = () => {
  $('#view').innerHTML = `<div class="card scroll">${S.sales.length ? `<table><tr><th>پسولە</th><th>بەروار</th><th>کات</th><th>لق</th><th>فرۆشیار</th><th>جۆر</th><th>پارەدان</th><th>کۆ</th><th>گەڕاوە</th><th></th></tr>${S.sales.map(x => `<tr><td class="num"><b>#${x.no}</b>${x.legacy ? ' <span class="tag n">سیستەمی کۆن</span>' : ''}</td><td class="num">${x.t.toLocaleDateString('en-GB')}</td><td>${hm(x.t)}</td><td>${esc(S.branches[x.branch])}</td><td class="en">${esc(x.by)}</td><td><span class="tag n">${TYPES[x.type]}</span></td><td>${payTag(x.pay)}</td><td>${money(x.total)}</td><td>${x.refunded ? money(x.refunded) : '—'}</td><td><div class="row"><button class="ghost sm" data-v="${x.no}">بینین</button>${x.legacy ? '' : `<button class="ghost sm" data-r="${x.no}">گەڕاندنەوە</button>`}</div></td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ پسولەیەک نییە</b></div>'}</div>`;
  $('#view').querySelectorAll('[data-v]').forEach(b => b.onclick = () => receipt(S.sales.find(x => x.no === +b.dataset.v)));
  $('#view').querySelectorAll('[data-r]').forEach(b => b.onclick = () => { S.view = 'returns'; render(true); V.returns(b.dataset.r); });
};
V.log = () => { $('#view').innerHTML = `<div class="card pad" style="max-width:940px"><p class="mute" style="margin-bottom:6px">هەموو کارێک بە ناوی ئەو کەسەی کردوویەتی تۆمار دەکرێت و ناسڕدرێتەوە.</p>${S.log.map(feedRow).join('') || '<div class="empty"><b>تۆمارەکە بەتاڵە</b></div>'}</div>`; };
/* a section that fails to draw must never leave the old section on screen */
const drawView = () => { try { V[S.view](); } catch (e) { console.error(e); $('#view').innerHTML = `<div class="card pad empty"><b>ئەم بەشە نەکرایەوە</b>تکایە پەڕەکە نوێ بکەرەوە. ئەگەر دووبارە بووەوە، ئەم دێڕە بنێرە: <span class="num">${esc(S.view)} — ${esc(e.message)}</span></div>`; } };
let rsT; addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S.me) shell(); }, 200); });
if (REMOTE) { boot(); setInterval(poll, 5000); document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); }); }
else {
  load(); S.tz = -new Date().getTimezoneOffset(); // offline "today" follows this device's clock
  if (S.session && acct(S.session)) { if (!acct(S.me)) S.me = S.session; render(true); } else showLogin();
}
