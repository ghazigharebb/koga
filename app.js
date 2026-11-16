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
  const TYPES = { retail: 'تاک', wholesale: 'جوملە', delivery: 'دلیڤەری', online: 'ئۆنلاین' };
  const PAY = { cash: 'کاش', fib: 'FIB', debt: 'قەرز' };
  const LK = { dayoff: 'دەوامی ڕۆژی پشوو', salary: 'مووچە', bonus: 'پاداشت', cut: 'بڕین', other: 'هیتر' };
  /* keys every device shares; everything else in the app's S is screen state */
  const SHARED = ['items', 'customers', 'branches', 'team', 'ledger', 'notes', 'cur', 'rate', 'rates', 'jards', 'target', 'sales', 'expenses', 'payments', 'purchases', 'exchanges', 'approvals', 'log', 'unread', 'nextNo', 'nextId', 'adjusted', 'jardAdj', 'tz', 'closes', 'shop', 'voids', 'hands', 'gifts', 'gone', 'myTill', 'adjs', 'jlines', 'arch'];
  /* messages that exist only because the server cannot trust the screen */
  const OWNER_ONLY = 'تەنها بەڕێوەبەر دەتوانێت ئەم کارە بکات', DENIED = 'دەسەڵاتی ئەم کارەت نییە', BAD = 'داواکارییەکە دروست نییە';
  const SHORT_MAX = 1000, OVER_MAX = 5000;                 // dinar: the most a cash sale may come in under / over its price
  const W_DEF = 12, W_MAX = 60;                             // warranty in months: what a line gets when nothing is chosen / the most allowed
  const lineW = l => l.w == null ? W_DEF : l.w;             // receipts from before this was chosen per line had one year
  /* the moment a sold line's warranty ends (ms); null = sold without warranty */
  const warrantyEnd = (sale, l) => { const w = lineW(l); if (!w) return null; const d = new Date(ms(sale.t)); d.setUTCMonth(d.getUTCMonth() + w); return d.getTime(); };
  const dprice = v => { if (v == null || v === '') return 0; if (!Number.isInteger(v) || v < 0 || v > 1e9) throw new Err('نرخی دینار دروست نییە'); return v; };
  const VOIDED = 'سەبەتەکە گۆڕا؛ داشکاندنەکە هەڵوەشایەوە', AMT = 'بڕێکی دروست بنووسە';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cents = n => Math.round(Number(n) * 100);
  const ms = t => t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : +t;
  const grp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const usd = c => { const p = (Math.abs(c) / 100).toFixed(2).split('.'); return grp(p[0]) + '.' + p[1]; };
  const iqd = (st, c) => Math.round(c * st.rate / 100 / 250) * 250; // dinar, rounded to the smallest note (250)
  const dinar = (rate, c) => Math.round(c * rate / 100);   // exact dinar (to the dinar) of an amount in cents
  /* the dinar a customer is asked for: the exact amount brought to the nearest 250 note (never 0 for something that costs) */
  const payDinar = (rate, c) => { const e = dinar(rate, c); return e <= 0 ? 0 : Math.max(250, Math.round(e / 250) * 250); };
  /* an item whose price is fixed in dinar (rd retail, wd wholesale): its dollar price is worked out from the day's rate */
  const centsOf = (rate, d) => Math.round(d * 100 / rate);
  function reprice(st) { st.items.forEach(i => { if (i.rd > 0) i.r = centsOf(st.rate, i.rd); if (i.wd > 0) i.w = centsOf(st.rate, i.wd); }); }
  const unitDinar = (it, type) => type === 'wholesale' ? (it.wd > 0 ? it.wd : null) : (it.rd > 0 ? it.rd : null);
  /* the dinar a basket costs: the sum of the fixed dinar prices when every line has one (and nothing was changed by hand), else the dollars at the rate, to the nearest 250 */
  function dueDinar(st, raw, type, disc) {
    let sum = 0, all = !disc, tot = 0;
    (raw || []).forEach(l => { const it = item(st, l.id); if (!it) return; const list = type === 'wholesale' ? it.w : it.r, c = l.price != null ? l.price : list, ud = l.price != null && l.price !== list ? null : unitDinar(it, type); tot += l.qty * c; if (ud == null) all = false; else sum += l.qty * ud; });
    return all && raw && raw.length ? sum : payDinar(st.rate, Math.max(0, tot - (disc || 0)));
  }
  const SN_OK = s => /^[A-Z0-9._\-\/]{4,40}$/.test(s);       // a unit's own serial number, as engraved on it
  const cleanSn = v => String(v == null ? '' : v).replace(/\s+/g, '').slice(0, 60).toUpperCase();
  /* what was taken for a cash sale against its price: got = { usd: cents, iqd: dinars }. Returns the difference in dinar and in cents. */
  function cashDiff(total, rate, got) {
    const usd = got && got.usd || 0, d = got && got.iqd || 0;
    if (!d) { const c = usd - total; return { d: dinar(rate, c), c }; }                       // paid in dollars only: exact in cents
    const dd = d + dinar(rate, usd) - dinar(rate, total); return { d: dd, c: Math.round(dd * 100 / rate) };
  }
  const fmtMoney = (st, c) => st.cur === 'IQD' ? (c < 0 ? '-' : '') + grp(iqd(st, Math.abs(c))) + ' د.ع' : (c < 0 ? '-$' : '$') + usd(c);
  const fmtCur = (a, c) => c === 'IQD' ? (a < 0 ? '-' : '') + grp(Math.abs(a)) + ' د.ع' : (a < 0 ? '-$' : '$') + usd(a);
  const money = (st, c) => `<span class="num">${fmtMoney(st, c)}</span>`;
  const gotTxt = g => [g.usd ? '$' + usd(g.usd) : '', g.iqd ? grp(g.iqd) + ' د.ع' : ''].filter(Boolean).join(' + ') || '0';
  const wTxt = w => w ? 'زەمان ' + w + ' مانگ' : 'بێ زەمان';
  const pctTxt = v => v == null ? 'دانەنراوە' : `${+v}%`;
  const tzMs = st => (st.tz == null ? 180 : st.tz) * 60000;
  const dayStart = (st, now) => Math.floor((ms(now) + tzMs(st)) / 864e5) * 864e5 - tzMs(st);
  const isoD = (st, now) => new Date(ms(now) + tzMs(st)).toISOString().slice(0, 10);
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
  const QMAX = 100000;                                   // the most pieces one line / one receive / one count may say
  const BC_OK = bc => /^[A-Za-z0-9._\-]{3,40}$/.test(bc) && !/^0+$/.test(bc);   // what a scanner or a printed label can carry
  const cleanBc = v => str(v, 60).replace(/\s+/g, '');
  const cleanPhone = v => String(v == null ? '' : v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, '').slice(0, 20);
  const UNDO_MS = 10 * 60000;                               // how long a sale can simply be taken back by the person who made it
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
    const st = {
      items: (seedItems || []).map(x => ({ ...x, r: cents(x.r), w: cents(x.w), s: [...x.s] })),
      customers: (seedCustomers || []).map(x => ({ ...x, debt: cents(x.debt) })),
      branches: ['لقی بازاڕ', 'لقی 60م'],
      team: [{ name: 'وەستا غەریب', role: 'owner', branch: -1, pw: null }, { name: 'سەرپەرشت', role: 'sup', branch: -1, pct: null, salary: null, salaryCur: 'USD', pw: null }, { name: 'qara', role: 'staff', branch: 0, pct: null, salary: null, salaryCur: 'USD', pw: null }],
      ledger: [], notes: [], closes: [], voids: [], hands: [], gifts: [], gone: [], shop: { note: '' }, cur: 'USD', rate: 1690, rates: [{ t: now == null ? new Date(0) : now, rate: 1690, by: 'وەستا غەریب' }], jards: [],
      target: 100000, sales: [], expenses: [], payments: [], purchases: [], exchanges: [], approvals: [], log: [], unread: {}, nextNo: 20001, nextId: 200, tz: 180
    };
    reprice(st);   // dinar-priced items get today's dollar price
    addPlatforms(st, ['ئایبازار', 'لەزوو', 'تەڵەبات']);   // where online orders come from (sold on credit to the platform)
    return st;
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
  function adj(st, now, id, b, d) { if (!d) return; (st.adjs || (st.adjs = [])).unshift({ t: now, id, b, d }); if (st.adjs.length > 20000) st.adjs.length = 20000; }
  function br(st, u, p) {
    let b = p.branch; if (b == null) b = u.branch >= 0 ? u.branch : 0;
    if (!Number.isInteger(b) || b < 0 || b >= st.branches.length) throw new Err(BAD);
    if (LV[u.role] === 1 && u.branch >= 0 && b !== u.branch) throw new Err('تەنها لە لقی خۆت دەتوانیت کار بکەیت');
    return b;
  }
  const cartSig = (raw, type) => type + ':' + (Array.isArray(raw) ? raw : []).map(l => (l && l.id) + 'x' + (l && l.qty)).sort().join(',');
  function cartLines(st, raw, type, u) {
    if (!has(TYPES, type) || !Array.isArray(raw)) throw new Err(BAD);
    const seen = new Set(), sns = new Set();
    return raw.map(l => {
      const it = l && item(st, l.id);
      if (!it || seen.has(it.id) || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > QMAX) throw new Err(BAD);
      seen.add(it.id); const list = type === 'wholesale' ? it.w : it.r, w = l.w == null ? W_DEF : l.w;
      if (!Number.isInteger(w) || w < 0 || w > W_MAX) throw new Err('ماوەی زەمان دەبێت لە نێوان 0 و ' + W_MAX + ' مانگ بێت');
      const o = { it, qty: l.qty, price: list, w, used: l.used === true, sn: [], pd: unitDinar(it, type) };
      if (l.sn != null) { // the serial of each piece handed over (not more of them than pieces)
        if (!Array.isArray(l.sn) || l.sn.length > l.qty) throw new Err(BAD);
        o.sn = l.sn.map(cleanSn);
        if (o.sn.some(x => !SN_OK(x) || sns.has(x)) || new Set(o.sn).size !== o.sn.length) throw new Err('سریاڵەکە دروست نییە یان دووبارەیە');
        o.sn.forEach(x => sns.add(x));
      }   // used = a unit a customer brought back, sold again
      if (l.price != null) { // a price for this one sale (0 = a gift): the manager's alone
        if (!u || u.role !== 'owner') throw new Err('تەنها بەڕێوەبەر دەتوانێت نرخی فرۆشتن بگۆڕێت');
        if (!Number.isInteger(l.price) || l.price < 0 || l.price > 1e9) throw new Err(AMT);
        if (l.price !== list) { o.price = l.price; o.list = list; o.pd = null; }
        return o;
      }
      if (!(list > 0)) throw new Err('ئەم کاڵایە نرخی ' + TYPES[type] + 'ی بۆ دانەنراوە');
      return o;
    });
  }
  /* what a return is worth; null when a quantity is more than what is left on the receipt */
  function refundCalc(sale, qty) {
    const q = sale.lines.map((l, i) => ({ l, n: Math.floor(+(qty && qty[i]) || 0) }));
    if (q.some(x => x.n < 0 || x.n > x.l.qty - x.l.ret)) return null;
    const value = q.reduce((a, x) => a + x.n * x.l.price, 0), all = q.every(x => x.l.ret + x.n === x.l.qty);
    return { q, value, n: q.reduce((a, x) => a + x.n, 0), refund: all ? sale.total - sale.refunded : value - (sale.sub ? Math.round(sale.disc * value / sale.sub) : 0) };
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
      const b = br(st, u, p), lines = cartLines(st, p.lines, p.type, u), type = p.type, pay = p.pay;
      if (!has(PAY, pay)) throw new Err(BAD);
      if (!lines.length) throw new Err('سەبەتەکە بەتاڵە');
      const needCust = type === 'wholesale' || type === 'online' || pay === 'debt', cu =   // delivery and online: the seller is known, the buyer is a phone number
       needCust ? st.customers.find(c => c.id === p.customer) : null;
      if (type === 'online' && (!cu || !cu.plat)) throw new Err('بۆ ئۆنلاین یەکێک لە شوێنەکان هەڵبژێرە (ئایبازار، لەزوو، تەڵەبات…)');
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
      let rawPh = p.phone == null ? '' : String(p.phone), rawBn = p.buyer == null ? '' : String(p.buyer);
      const isNum = s => /^[\s0-9٠-٩۰-۹+\-()]{7,}$/.test(s);
      if (rawPh.trim() && !/[0-9٠-٩۰-۹]/.test(rawPh)) { const nm = rawPh; rawPh = isNum(rawBn) ? rawBn : ''; rawBn = isNum(rawBn) || !rawBn.trim() ? nm : rawBn; }   // a name in the phone box (boxes swapped)
      else if (!rawPh.trim() && isNum(rawBn)) { rawPh = rawBn; rawBn = ''; }                                                   // a number in the name box
      const ph = cleanPhone(rawPh), bn = str(rawBn, 60);   // who bought, when the seller typed it
      if (ph && !(ph.length >= 7 && ph.length <= 15)) throw new Err('ژمارەی مۆبایلی کڕیار دروست نییە (دەبێت 7 تا 15 ژمارە بێت)');
      let got = null, df = null;
      if (pay === 'cash' && p.got != null) { // what the customer really handed over: every dinar over or short is written down with the seller's name
        const g = p.got; if (typeof g !== 'object' || ![g.usd || 0, g.iqd || 0].every(n => Number.isInteger(n) && n >= 0)) throw new Err(AMT);
        got = { usd: g.usd || 0, iqd: g.iqd || 0 };
        const fixed = !disc && lines.every(l => l.pd != null), dn = fixed ? lines.reduce((a, l) => a + l.qty * l.pd, 0) : payDinar(st.rate, total);
        df = got.iqd && fixed ? { d: got.iqd + dinar(st.rate, got.usd) - dn, c: Math.round((got.iqd + dinar(st.rate, got.usd) - dn) * 100 / st.rate) } : cashDiff(total, st.rate, got);   // a dinar-priced basket paid in its dinar is exact   // the amount is the system's, not the seller's: the price in dollars, or its dinar to the nearest 250
        if (!((!got.iqd && got.usd === total) || (!got.usd && got.iqd === dn))) throw new Err('پارەی وەرگیراو دەبێت یان ' + '$' + usd(total) + ' بێت یان ' + grp(dn) + ' د.ع');
        if (df.d < -SHORT_MAX) throw new Err('پارەی وەرگیراو ' + grp(-df.d) + ' دینار لە نرخەکە کەمترە؛ داشکاندن تەنها بەڕێوەبەر دەیکات');
        if (df.d > OVER_MAX) throw new Err('ئەمە ' + grp(df.d) + ' دینار لە نرخەکە زیاترە؛ تەنها ئەو بڕە بنووسە کە دوای باقی لە قاصە دەمێنێتەوە');
      }
      const sale = { no: st.nextNo++, t: now, branch: b, by: u.name, rate: st.rate, type, pay, fibRef: pay === 'fib' ? str(p.fibRef, 60) : '', customer: needCust ? cu.id : null, lines: lines.map(l => { const o = { id: l.it.id, name: l.it.name, qty: l.qty, price: l.price, cost: l.it.c == null ? null : l.it.c, ret: 0, w: l.w }; if (l.list != null) o.list = l.list; if (l.used) o.used = true; if (l.sn.length) o.sn = l.sn; if (l.pd != null) o.pd = l.pd; return o; }), sub, disc, total, refunded: 0 };
      if (got) { sale.got = got; sale.diffD = df.d; sale.diffC = df.c; }
      if (got && p.tend && typeof p.tend === 'object') {
        const tu = p.tend.usd || 0, td = p.tend.iqd || 0;
        if (![tu, td].every(n => Number.isInteger(n) && n >= 0 && n <= 1e9)) throw new Err(AMT);
        const dueD = got.iqd ? got.iqd + dinar(st.rate, got.usd) : null, tD = td + dinar(st.rate, tu);
        const chD = dueD != null ? tD - dueD : Math.round((tD - dinar(st.rate, total)) / 250) * 250, chC = Math.round((tu + td * 100 / st.rate) - total);
        if ((tu || td) && chC >= 0) { sale.tend = { usd: tu, iqd: td }; sale.chgC = Math.max(0, chC); sale.chgD = Math.max(0, chD); }
      }
      sale.dn = !disc && lines.every(l => l.pd != null) ? lines.reduce((a, l) => a + l.qty * l.pd, 0) : payDinar(st.rate, total);   // what it costs in dinar on this day
      if (ph) sale.phone = ph; if (bn) sale.buyer = bn;
      lines.forEach(l => l.it.s[b] -= l.qty);
      if (pay === 'debt') cu.debt += total;
      if (ap) ap.used = sale.no;
      st.sales.unshift(sale);
      log(st, u.name, b, now, 'sale', `فرۆشتنی ${TYPES[type]} — پسولەی <b class="num">#${sale.no}</b> بە ${money(st, total)} (${PAY[pay]}): ${sale.lines.map(l => esc(l.name) + ' ×' + l.qty + (l.list != null ? ` <span class="tag a">نرخی تایبەت ${money(st, l.price)} لەجیاتی ${money(st, l.list)}</span>` : '') + (l.used || l.w !== W_DEF ? ` <span class="tag n">${l.used ? 'گەڕاوە · ' : ''}${wTxt(l.w)}</span>` : '')).join('، ')}${got ? ` — وەرگیراو: <span class="num">${gotTxt(got)}</span>` + (df.d ? ` <span class="tag ${df.d < 0 ? 'r' : 'a'}">${df.d < 0 ? 'کەمە' : 'زیادە'} <span class="num">${grp(Math.abs(df.d))}</span> د.ع</span>` : '') : ''}`);
      return { no: sale.no, total };
    }],
    undoSale: [1, (st, u, p, now) => { // «پەشیمانبوونەوە»: within 10 minutes the whole sale is taken back as if it never happened (kept in voids, told to the manager)
      const sale = saleOf(st, p.no), b = br(st, u, p);
      if (LV[u.role] < 2 && sale.by !== u.name) throw new Err(DENIED);
      if (ms(now) - ms(sale.t) > UNDO_MS) throw new Err('ماوەی 10 خولەکی پەشیمانبوونەوە تەواو بووە؛ لە «گەڕاوە و زەمان» بیگەڕێنەوە');
      if (sale.refunded || sale.swapOf || sale.lines.some(l => l.ret || l.exch) || (sale.rets || []).length) throw new Err('ئەم پسولەیە گەڕاوە یان گۆڕینی لەسەرە');
      sale.lines.forEach(l => { const it = item(st, l.id); if (it) it.s[sale.branch] += l.qty; });
      if (sale.pay === 'debt') { const cu = st.customers.find(c => c.id === sale.customer); if (cu) cu.debt = Math.max(0, cu.debt - sale.total); }
      st.sales = st.sales.filter(x => x !== sale);
      (st.voids || (st.voids = [])).unshift(Object.assign({}, sale, { voidT: now, voidBy: u.name, why: str(p.why, 200) })); if (st.voids.length > 500) st.voids.length = 500;
      log(st, u.name, b, now, 'no', `پەشیمانبوونەوە لە پسولەی <b class="num">#${sale.no}</b> (${money(st, sale.total)}، ${PAY[sale.pay]}) — کاڵاکان گەڕانەوە کۆگا: ${sale.lines.map(l => esc(l.name) + ' ×' + l.qty).join('، ')}${p.why ? ' — ' + esc(str(p.why, 200)) : ''}`);
      return { no: sale.no };
    }],
    discountRequest: [1, (st, u, p, now) => {
      const b = br(st, u, p), sub = cartLines(st, p.lines, p.type, null).reduce((a, l) => a + l.qty * l.price, 0), amt = p.amt;
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
      if (!r.n) throw new Err('بڕی لانی کەم یەک کاڵا دیاری بکە');
      if (why.length < 2) throw new Err('هۆکاری گەڕاندنەوەکە بنووسە');
      const bad = p.faulty === true;   // a faulty piece (often never sent back from another city): money is settled, but it does not return to the pieces for sale
      r.q.forEach(x => { x.l.ret += x.n; const it = item(st, x.l.id); if (it) { if (bad) it.f = (it.f || 0) + x.n; else it.s[sale.branch] += x.n; } });
      sale.refunded += r.refund;
      let cash = r.refund, note = '';
      if (sale.pay === 'debt') { const cu = st.customers.find(c => c.id === sale.customer), off = cu ? Math.min(cu.debt, r.refund) : 0; if (cu) cu.debt -= off; cash = r.refund - off; note = ` — ${money(st, off)} لە قەرزی ${esc(cu ? cu.name : '')} کەم کرایەوە`; }
      if (sale.pay === 'fib') { cash = 0; sale.fibBack = (sale.fibBack || 0) + r.refund; note = ' — بە FIB دەگەڕێنرێتەوە'; } else if (sale.pay === 'cash') note = ' — بە کاش لە قاصە درایەوە';
      const cashD = cash && sale.got && sale.got.iqd ? payDinar(sale.rate || st.rate, cash) : null;   // paid in dinar: the dinar goes back at the dollar rate of the day it was bought
      if (cashD != null) note += ` (<span class="num">${grp(cashD)}</span> د.ع بە نرخی ڕۆژی کڕین)`;
      sale.cashBack = (sale.cashBack || 0) + cash;
      (sale.rets || (sale.rets = [])).push({ t: now, amt: r.refund, cash, fib: sale.pay === 'fib' ? r.refund : 0, branch: b, by: u.name, why, ...(bad ? { faulty: true } : {}), ...(cashD != null ? { cashD } : {}), items: r.q.filter(x => x.n).map(x => ({ id: x.l.id, name: x.l.name, qty: x.n })) });
      log(st, u.name, b, now, 'ret', `${bad ? 'دانەی عاتڵ — ' : ''}گەڕاندنەوە لە پسولەی <b class="num">#${sale.no}</b>: ${r.q.filter(x => x.n).map(x => esc(x.l.name) + ' ×' + x.n).join('، ')} — ${money(st, r.refund)}${note} — هۆکار: ${esc(why)}`);
      return { no: sale.no, refund: r.refund };
    }],
    exchange: [2, (st, u, p, now) => { // warranty: the faulty unit comes back, a new one goes out, no money moves
      const b = br(st, u, p), sale = saleOf(st, p.no), l = Number.isInteger(p.line) ? sale.lines[p.line] : null, it = l && item(st, l.id);
      if (!l || !it) throw new Err(BAD);
      const end = warrantyEnd(sale, l);
      if (end == null) throw new Err('ئەم کاڵایە بێ زەمان فرۆشراوە');
      if (ms(now) > end) throw new Err('زەمانی ئەم کاڵایە بەسەرچووە');
      const can = l.qty - l.ret, n = p.qty, why = str(p.why);
      if (!Number.isInteger(n) || n < 1 || n > can) throw new Err('بڕەکە دەبێت لە نێوان 1 و ' + can + ' بێت');
      if (n > it.s[b]) throw new Err('لە کۆگای ' + st.branches[b] + ' ئەوەندە نەماوە بۆ گۆڕین');
      if (!why) throw new Err('کێشەی کاڵاکە بنووسە');
      let sn = '';
      if (p.sn != null && p.sn !== '') { sn = cleanSn(p.sn); if (!SN_OK(sn)) throw new Err('سریاڵەکە دروست نییە یان دووبارەیە'); }
      it.s[b] -= n; it.f = (it.f || 0) + n; l.exch = (l.exch || 0) + n;
      const x = { t: now, by: u.name, branch: b, no: sale.no, id: l.id, qty: n, why };
      if (sn) { x.sn = sn; if (!(l.sn || []).includes(sn)) (l.sn || (l.sn = [])).push(sn); }   // the new piece's serial now belongs to this receipt too
      st.exchanges.unshift(x);
      log(st, u.name, b, now, 'swap', `گۆڕینی زەمانەت — پسولەی <b class="num">#${sale.no}</b>: ${esc(l.name)} ×${n} — ${esc(why)}`);
    }],
    swapOther: [2, (st, u, p, now) => { // the customer brings a piece back and leaves with a DIFFERENT item: one return + one new receipt, both or neither
      if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 20) throw new Err(BAD);
      const go = s => {
        const old = saleOf(s, p.no), r = A.return[1](s, u, { branch: p.branch, no: p.no, qty: p.qty, why: p.why }, now);
        const n = A.sell[1](s, u, { branch: p.branch, type: old.type, pay: old.pay === 'debt' ? 'debt' : 'cash', customer: old.customer, lines: p.lines.map(l => ({ id: l && l.id, qty: l && l.qty, sn: l && l.sn == null ? undefined : l && l.sn, w: l && l.w == null ? undefined : l && l.w })) }, now);
        const ns = s.sales.find(x => x.no === n.no); ns.swapOf = old.no; old.rets[old.rets.length - 1].swapTo = ns.no;
        log(s, u.name, ns.branch, now, 'swap', `گۆڕین بە کاڵایەکی تر — پسولەی <b class="num">#${old.no}</b> ← پسولەی نوێ <b class="num">#${ns.no}</b>: گەڕاوە ${money(s, r.refund)} · نوێ ${money(s, n.total)} · ${n.total >= r.refund ? 'کڕیار دەیدات' : 'بۆ کڕیار دەگەڕێتەوە'} ${money(s, Math.abs(n.total - r.refund))}`);
        return { no: ns.no, from: old.no, refund: r.refund, total: n.total };
      };
      go(JSON.parse(JSON.stringify(st)));   // rehearsal on a copy: if the new sale cannot happen, the return must not happen either
      return go(st);
    }],
    receive: [2, (st, u, p, now) => {
      const b = br(st, u, p), it = item(st, p.id), n = p.qty;
      if (!it) throw new Err('سەرەتا کاڵاکە هەڵبژێرە یان بارکۆدەکەی سکان بکە');
      const d = /^\d{4}-\d\d-\d\d$/.test(p.d || '') ? p.d : isoD(st, now);   // the day the goods came in (may be typed for an older delivery)
      if (!Number.isInteger(n) || n < 1 || n > QMAX) throw new Err(AMT);
      let cost = it.c == null ? null : it.c;
      if (p.cost !== undefined) { // the manager's and the supervisor's to write; only the manager ever sees it
        if (LV[u.role] < 2) throw new Err(OWNER_ONLY);
        if (!Number.isInteger(p.cost) || !(p.cost >= 0)) throw new Err('نرخی کڕین دروست نییە');
        cost = it.c = p.cost;
      }
      it.s[b] += n; st.purchases.unshift({ t: now, by: u.name, branch: b, id: it.id, name: it.name, qty: n, cost, retail: it.r, d });
      log(st, u.name, b, now, 'stock', `داخیلکردنی <b class="num">${n}</b> دانە «${esc(it.name)}» — بەهای فرۆشتن ${money(st, n * it.r)} — ئێستا <span class="num">${it.s[b]}</span> دانە`);
    }],
    stockReduce: [2, (st, u, p, now) => {
      const b = br(st, u, p), it = item(st, p.id), n = p.qty, why = str(p.why);
      if (!it) throw new Err(BAD);
      if (!Number.isInteger(n) || n < 1) throw new Err(AMT);
      if (n > it.s[b]) throw new Err('لە بڕی کۆگا زیاترە');
      if (!why) throw new Err('هۆکار بنووسە');
      it.s[b] -= n; st.adjusted = (st.adjusted || 0) + n; adj(st, now, it.id, b, -n);
      log(st, u.name, b, now, 'stock', `کەمکردنەوەی <b class="num">${n}</b> دانە «${esc(it.name)}» — ${esc(why)} — ماوە <span class="num">${it.s[b]}</span>`);
    }],
    newItem: [2, (st, u, p, now) => { // «داخیلکردنی بابەت»: by hand; a barcode is welcome but not needed
      const name = str(p.name, 120), bc = cleanBc(p.bc), rd0 = dprice(p.rd), wd0 = dprice(p.wd), r = rd0 > 0 ? centsOf(st.rate, rd0) : p.r, w = wd0 > 0 ? centsOf(st.rate, wd0) : p.w == null ? 0 : p.w, cats = [...new Set(st.items.map(i => i.cat))];
      if (!name) throw new Err('ناوی کاڵا بنووسە');
      if (st.items.some(i => i.name.toLowerCase() === name.toLowerCase())) throw new Err('کاڵایەک بەم ناوە پێشتر هەیە');
      if (bc && !BC_OK(bc)) throw new Err('بارکۆدێکی دروست بنووسە (تەنها ژمارە و پیتی ئینگلیزی، 3 تا 40)');
      if (bc && st.items.some(i => i.bc === bc)) throw new Err('ئەم بارکۆدە پێشتر بۆ کاڵایەکی تر بەکارهاتووە');
      if (!Number.isInteger(r) || !Number.isInteger(w) || !(r > 0) || w < 0) throw new Err('نرخی تاک بنووسە');
      if (w > r) throw new Err('نرخی جوملە نابێت لە تاک زیاتر بێت');
      const s0 = st.branches.map((x, k) => { const n = Array.isArray(p.s) ? p.s[k] || 0 : 0; if (!Number.isInteger(n) || n < 0 || n > QMAX) throw new Err(AMT); return n; });
      if (p.c != null) { if (LV[u.role] < 2) throw new Err(OWNER_ONLY); if (!Number.isInteger(p.c) || p.c < 0) throw new Err('نرخی کڕین دروست نییە'); }
      const it = { id: st.nextId++, name, bc, r, w, s: s0, cat: str(p.cat, 60) || cats[0] || '' }; if (p.c != null) it.c = p.c; if (rd0 > 0) it.rd = rd0; if (wd0 > 0) it.wd = wd0;
      st.items.unshift(it); const b = br(st, u, p), d = isoD(st, now);
      s0.forEach((n, k) => { if (n) st.purchases.unshift({ t: now, by: u.name, branch: k, id: it.id, name, qty: n, cost: it.c == null ? null : it.c, retail: r, d }); });
      log(st, u.name, b, now, 'price', `کاڵای نوێ «${esc(name)}» داخیل کرا — تاک ${money(st, r)}${w ? ' · جوملە ' + money(st, w) : ''}${s0.some(n => n) ? ' · ' + s0.map((n, k) => esc(st.branches[k]) + ' <span class="num">' + n + '</span>').join(' · ') : ''}`);
      return { id: it.id };
    }],
    editItem: [2, (st, u, p, now) => { // name, kind, barcode and selling prices; the buying price stays with editPrice (manager)
      const it = item(st, p.id), name = str(p.name, 120), bc = cleanBc(p.bc), rd0 = dprice(p.rd), wd0 = dprice(p.wd), r = rd0 > 0 ? centsOf(st.rate, rd0) : p.r, w = wd0 > 0 ? centsOf(st.rate, wd0) : p.w == null ? 0 : p.w;
      if (!it) throw new Err(BAD);
      if (!name) throw new Err('ناوی کاڵا بنووسە');
      if (st.items.some(i => i !== it && i.name.toLowerCase() === name.toLowerCase())) throw new Err('کاڵایەک بەم ناوە پێشتر هەیە');
      if (bc && !BC_OK(bc)) throw new Err('بارکۆدێکی دروست بنووسە (تەنها ژمارە و پیتی ئینگلیزی، 3 تا 40)');
      if (bc && bc !== it.bc && st.items.some(i => i !== it && i.bc === bc)) throw new Err('ئەم بارکۆدە پێشتر بۆ کاڵایەکی تر بەکارهاتووە');   // two old items share one barcode: leaving it as it is must stay possible
      if (!Number.isInteger(r) || !Number.isInteger(w) || !(r > 0) || w < 0) throw new Err('نرخی تاک بنووسە');
      if (w > r) throw new Err('نرخی جوملە نابێت لە تاک زیاتر بێت');
      const ch = []; if (name !== it.name) ch.push(`ناو: «${esc(it.name)}» ← «${esc(name)}»`); if (bc !== it.bc) ch.push(`بارکۆد: <span class="num">${esc(it.bc) || '—'} ← ${esc(bc) || '—'}</span>`);
      if (r !== it.r || w !== it.w) ch.push(`تاک ${money(st, it.r)} ← ${money(st, r)} · جوملە ${money(st, it.w)} ← ${money(st, w)}`);
      const cat = str(p.cat, 60) || it.cat; if (cat !== it.cat) ch.push(`پۆل: ${esc(it.cat)} ← ${esc(cat)}`);
      if (p.rd !== undefined && rd0 !== (it.rd || 0)) ch.push(`نرخی جێگیر بە دینار: <span class="num">${grp(it.rd || 0)} ← ${grp(rd0)}</span>`);
      it.name = name; it.bc = bc; it.r = r; it.w = w; it.cat = cat;
      if (p.rd !== undefined) { if (rd0 > 0) it.rd = rd0; else delete it.rd; } if (p.wd !== undefined) { if (wd0 > 0) it.wd = wd0; else delete it.wd; }
      if (ch.length) log(st, u.name, br(st, u, p), now, 'price', `دەستکاریی کاڵا «${esc(name)}» — ${ch.join(' · ')}`);
    }],
    setStock: [2, (st, u, p, now) => { // write the true number of pieces of one item in one branch (a correction, always with a reason)
      const b = br(st, u, p), it = item(st, p.id), n = p.qty, why = str(p.why);
      if (!it) throw new Err(BAD);
      if (!Number.isInteger(n) || n < 0 || n > 10 * QMAX) throw new Err(AMT);
      if (!why) throw new Err('هۆکار بنووسە');
      const was = it.s[b]; if (was === n) return;
      it.s[b] = n; st.adjusted = (st.adjusted || 0) + Math.abs(n - was); adj(st, now, it.id, b, n - was);
      log(st, u.name, b, now, 'stock', `ڕاستکردنەوەی کۆگا «${esc(it.name)}» لە ${esc(st.branches[b])}: <span class="num">${was}</span> ← <b class="num">${n}</b> — ${esc(why)}`);
    }],
    deleteItem: [2, (st, u, p, now) => { // «ڕەشکردنەوە»: the item leaves every list; it is kept aside so the manager can bring it back
      const it = item(st, p.id); if (!it) throw new Err(BAD);
      const left = it.s.reduce((a, n) => a + n, 0);
      st.items = st.items.filter(x => x !== it); (st.gone || (st.gone = [])).unshift(Object.assign({}, it, { goneT: now, goneBy: u.name, why: str(p.why, 200) })); if (st.gone.length > 500) st.gone.length = 500;
      log(st, u.name, br(st, u, p), now, 'no', `کاڵای «${esc(it.name)}» ڕەش کرایەوە${left ? ` (<b class="num">${left}</b> دانەی لە کۆگا بوو)` : ''}${p.why ? ' — ' + esc(str(p.why, 200)) : ''}`);
    }],
    restoreItem: [3, (st, u, p, now) => {
      const g = (st.gone || []).find(x => x.id === p.id); if (!g) throw new Err(BAD);
      if (st.items.some(i => i.name.toLowerCase() === g.name.toLowerCase() || (g.bc && i.bc === g.bc))) throw new Err('کاڵایەک بە هەمان ناو یان بارکۆد ئێستا هەیە');
      st.gone = st.gone.filter(x => x !== g); const it = Object.assign({}, g); delete it.goneT; delete it.goneBy; delete it.why; st.items.unshift(it);
      log(st, u.name, br(st, u, p), now, 'price', `کاڵای «${esc(it.name)}» گەڕێنرایەوە ناو لیست`);
    }],
    gift: [3, (st, u, p, now) => { // «خەڵات»: the manager gives pieces away; stock goes down and everyone is told
      const b = br(st, u, p), it = item(st, p.id), n = p.qty, note = str(p.note, 300);
      if (!it) throw new Err(BAD);
      if (!Number.isInteger(n) || n < 1) throw new Err(AMT);
      if (n > it.s[b]) throw new Err('لە ' + st.branches[b] + ' تەنها ' + it.s[b] + ' دانە ماوە');
      if (!note) throw new Err('بنووسە بۆ کێ یان بۆچی کراوە بە خەڵات');
      it.s[b] -= n; const g = { id: st.nextId++, t: now, by: u.name, branch: b, item: it.id, name: it.name, qty: n, note, value: n * it.r };
      (st.gifts || (st.gifts = [])).unshift(g);
      log(st, u.name, b, now, 'msg', `خەڵات: <b class="num">${n}</b> دانە «${esc(it.name)}» لە ${esc(st.branches[b])} کرا بە خەڵات — ${esc(note)}`, 'all');
      return { id: g.id };
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
      if (p.plat) { if (u.role !== 'owner') throw new Err(OWNER_ONLY); c.plat = true; }
      st.customers.unshift(c); log(st, u.name, b, now, 'cust', `کڕیاری نوێ: ${esc(name)}`);
      return { id: c.id };
    }],
    payDebt: [1, (st, u, p, now) => {
      const b = br(st, u, p), c = st.customers.find(x => x.id === p.customer), a = p.amt, m = p.method;
      if (!c || (m !== 'cash' && m !== 'fib')) throw new Err(BAD);
      if (!Number.isInteger(a) || !(a > 0)) throw new Err(AMT);
      if (a > c.debt) throw new Err('بڕەکە لە قەرزەکە زیاترە');
      c.debt -= a; st.payments.unshift({ t: now, amt: a, method: m, branch: b, by: u.name, customer: c.id, ...(p.cur === 'IQD' && m === 'cash' ? { amtD: payDinar(st.rate, a) } : {}) });
      log(st, u.name, b, now, 'pay', `${money(st, a)} بە ${PAY[m]} لە ${esc(c.name)} وەرگیرا — قەرزی ماوە ${money(st, c.debt)}`);
    }],
    expense: [1, (st, u, p, now) => {
      const b = br(st, u, p), what = str(p.cat, 120), a = p.amt;
      if (!what) throw new Err('بنووسە چی مەسروف کراوە');
      if (!Number.isInteger(a) || !(a > 0)) throw new Err(AMT);
      const e = { t: now, cat: what, amt: a, note: str(p.note), by: u.name, branch: b }; if (p.cur === 'IQD') e.amtD = Number.isInteger(p.amtD) && p.amtD > 0 && Math.abs(p.amtD - dinar(st.rate, a)) <= 250 ? p.amtD : payDinar(st.rate, a);
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
    jardCell: [1, (st, u, p, now) => { // one number of TODAY's sheet. A seller may write: pieces sold, discount, pieces returned. The supervisor and the manager: everything.
      const b = br(st, u, p), it = item(st, p.id), f = p.f, lv = LV[u.role], d = isoD(st, now), v = p.v;
      if (!it) throw new Err(BAD);
      if (p.d != null && p.d !== d) throw new Err('ئەو ڕۆژە تێپەڕیوە؛ تەنها جەردی ئەمڕۆ دەستکاری دەکرێت');
      if (!has({ sold: 1, disc: 1, ret: 1, bad: 1, left: 1, note: 1 }, f)) throw new Err(BAD);
      if (lv < 2 && !(f === 'sold' || f === 'disc' || f === 'ret')) throw new Err('تەنها سەرپەرشتیار یان بەڕێوەبەر دەتوانێت ئەمە بگۆڕێت');
      const row = daySheet(st, b, d).rows.find(r => r.id === it.id);
      const line = () => { let l = (st.jlines || (st.jlines = [])).find(x => x.d === d && x.b === b && x.id === it.id); if (!l) { l = { d, b, id: it.id, disc: 0, bad: 0, note: '' }; st.jlines.unshift(l); if (st.jlines.length > 40000) st.jlines.length = 40000; } l.t = now; l.by = u.name; return l; };
      if (f === 'note') { const s = str(v, 200); if (s === (row.note || '')) return; line().note = s; return; }
      if (!Number.isInteger(v) || v < 0 || v > 1e9) throw new Err(AMT);
      if (f === 'sold') { const n = v - row.sold; if (!n) return;
        if (n < 0) throw new Err('بۆ کەمکردنەوەی فرۆشراو «پەشیمانبوونەوە» یان «گەڕاوە» بەکاربهێنە');
        const due = dueDinar(st, [{ id: it.id, qty: n }], 'retail', 0), tot = n * it.r;
        const o = A.sell[1](st, u, { branch: b, type: 'retail', pay: 'cash', lines: [{ id: it.id, qty: n }], got: { usd: 0, iqd: due } }, now);   // cash in this shop is dinar unless the seller says dollars at the till
        const s = st.sales.find(x => x.no === o.no); if (s) s.hand = true; return { no: o.no }; }
      if (f === 'ret') { let n = v - row.ret; if (!n) return;
        if (n < 0) throw new Err('گەڕاوەی تۆمارکراو کەم ناکرێتەوە');
        if (st.sales.reduce((s0, s) => s0 + (s.branch === b && !s.legacy ? s.lines.reduce((q, l) => q + (l.id === it.id ? Math.max(0, l.qty - l.ret - (l.exch || 0)) : 0), 0) : 0), 0) < n) throw new Err('ئەوەندە فرۆشراوی ئەم کاڵایە نییە بۆ گەڕاندنەوە');
        for (const s of st.sales) { if (!n) break; if (s.branch !== b || s.legacy) continue;
          const q = s.lines.map(l => { if (l.id !== it.id || !n) return 0; const k = Math.min(n, l.qty - l.ret - (l.exch || 0)); if (k <= 0) return 0; n -= k; return k; });
          if (q.some(x => x)) A.return[1](st, u, { branch: b, no: s.no, qty: q, why: 'لە جەردی ڕۆژانە تۆمار کرا' }, now); }
        if (n) throw new Err('ئەوەندە فرۆشراوی ئەم کاڵایە نییە بۆ گەڕاندنەوە');
        return; }
      if (f === 'disc') { const l = line(), was = l.disc || 0; if (v === was) return; if (v > Math.max(0, row.sumD + was)) throw new Err('داشکان لە کۆی فرۆشی ئەم کاڵایە زیاترە');
        l.disc = v; log(st, u.name, b, now, 'alert', `داشکان لە جەردی ڕۆژانە: «${esc(it.name)}» <b class="num">${grp(v)}</b> د.ع${was ? ` <span class="mute">(پێشتر ${grp(was)})</span>` : ''}`); return; }
      if (f === 'bad') { const l = line(), was = l.bad || 0, sys = row.bad - was; if (v < sys) throw new Err('ئەو عاطڵانەی بە پسولە تۆمار کراون کەم ناکرێنەوە'); const n = v - sys - was; if (!n) return;
        if (n > it.s[b]) throw new Err('لە بڕی کۆگا زیاترە');
        it.s[b] -= n; it.f = Math.max(0, (it.f || 0) + n); l.bad = was + n; log(st, u.name, b, now, 'stock', `عاطڵ لە جەردی ڕۆژانە: «${esc(it.name)}» <b class="num">${n > 0 ? '+' + n : n}</b> دانە`); return; }
      if (f === 'left') { if (v === it.s[b]) return; A.setStock[1](st, u, { branch: b, id: it.id, qty: v, why: 'ڕاستکردنەوە لە جەردی ڕۆژانە' }, now); return; }
    }],
    jardApply: [3, (st, u, p, now) => {
      const j = st.jards.find(x => x.id === p.id); if (!j) throw new Err(BAD);
      const dn = j.rows.filter(r => r.diff).length;
      if (j.applied || !dn) throw new Err('ئەم جەردە پێشتر جێبەجێ کراوە یان جیاوازیی نییە');
      j.rows.filter(r => r.diff).forEach(r => { const it = item(st, r.id); if (it) { const was = it.s[j.branch]; it.s[j.branch] = Math.max(0, was + r.diff); adj(st, now, it.id, j.branch, it.s[j.branch] - was); } });
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
    setCurrency: [2, (st, u, p, now) => {
      if (p.cur !== 'USD' && p.cur !== 'IQD') throw new Err(BAD);
      if (st.cur === p.cur) return;
      st.cur = p.cur; log(st, u.name, br(st, u, p), now, 'cur', `دراوی سیستەم گۆڕدرا بۆ <b>${st.cur === 'IQD' ? 'دینار' : 'دۆلار'}</b>`, 'all');
    }],
    setRate: [2, (st, u, p, now) => { // p.v = dinars for 100 dollars
      const v = p.v; if (typeof v !== 'number' || !(v >= 10000 && v <= 1000000)) throw new Err('نرخەکە دروست نییە (بۆ نموونە 169000)');
      const old = st.rate; st.rate = v / 100; reprice(st);
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
    handOver: [1, (st, u, p, now) => { // «جەردی پارە»: money taken out of a branch till and given to the manager, in the money it really was
      const b = br(st, u, p), a = p.amount, cur = p.cur === 'IQD' ? 'IQD' : 'USD', note = str(p.note, 300);
      if (u.role === 'owner') throw new Err(DENIED);
      if (!Number.isInteger(a) || !(a > 0) || a > 1e11) throw new Err(AMT);
      if (note.length < 2) throw new Err('هۆکارەکەی بنووسە');
      const h = { id: st.nextId++, t: now, by: u.name, branch: b, cur, amount: a, note };
      (st.hands || (st.hands = [])).unshift(h); if (st.hands.length > 3000) st.hands.length = 3000;
      log(st, u.name, b, now, 'pay', `<b class="num">${fmtCur(a, cur)}</b> لە دەخیلی ${esc(st.branches[b])} درا بە بەڕێوەبەر — ${esc(note)}`);
      return { id: h.id };
    }],
    cashCur: [3, (st, u, p, now) => { // «بە دینار وەرگیراوە / بە دۆلار»: only where the money sits changes, never the price
      const nos = Array.isArray(p.nos) ? p.nos : [], cur = p.cur === 'USD' ? 'USD' : 'IQD';
      if (!nos.length || nos.length > 3000) throw new Err(BAD);
      const list = nos.map(no => st.sales.find(x => x.no === no)); if (list.some(x => !x || x.pay !== 'cash' || x.legacy)) throw new Err(BAD);
      let n = 0;
      list.forEach(s => { const dn = s.dn != null ? s.dn : payDinar(s.rate || st.rate, s.total), isD = !!(s.got && s.got.iqd), had = !!s.got; if (had && isD === (cur === 'IQD')) return;
        s.got = cur === 'IQD' ? { usd: 0, iqd: dn } : { usd: s.total, iqd: 0 }; s.diffD = 0; s.diffC = 0; delete s.tend; delete s.chgC; delete s.chgD; s.curBy = u.name; n++;
        (s.rets || []).forEach(r => { if (!r.cash) return; if (cur === 'IQD') r.cashD = payDinar(s.rate || st.rate, r.cash); else delete r.cashD; }); });
      if (n) log(st, u.name, br(st, u, p), now, 'pay', `<span class="num">${n}</span> پسولەی کاش وەک وەرگیراو بە <b>${cur === 'IQD' ? 'دینار' : 'دۆلار'}</b> تۆمار کرانەوە`);
      return { n };
    }],
    handEdit: [3, (st, u, p, now) => { // once written, only the manager changes it
      const h = (st.hands || []).find(x => x.id === p.id); if (!h) throw new Err(BAD);
      if (p.del) { st.hands = st.hands.filter(x => x !== h); log(st, u.name, h.branch, now, 'no', `تۆماری پارەی ${esc(h.by)} (<span class="num">${fmtCur(h.amount, h.cur)}</span>) سڕایەوە`, 'owner', h.by); return; }
      if (p.ok !== undefined) { if (p.ok) h.ok = { t: now, by: u.name }; else delete h.ok; return; }
      const a = p.amount, note = str(p.note, 300);
      if (!Number.isInteger(a) || !(a > 0) || a > 1e11) throw new Err(AMT);
      if (note.length < 2) throw new Err('هۆکارەکەی بنووسە');
      const was = fmtCur(h.amount, h.cur); h.amount = a; h.cur = p.cur === 'IQD' ? 'IQD' : 'USD'; h.note = note; h.edited = { t: now, by: u.name };
      log(st, u.name, h.branch, now, 'pay', `تۆماری پارەکەت ڕاست کرایەوە: <span class="num">${was}</span> ← <b class="num">${fmtCur(h.amount, h.cur)}</b>`, 'owner', h.by);
    }],
    setShop: [3, (st, u, p) => { // the line printed at the foot of every receipt (address, phone)
      st.shop = { note: str(p.note, 160) };
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
    st.sales.forEach(x => { if (x.branch === b && td(x) && x.pay === 'cash') c += x.total + (x.diffC || 0); (x.rets || []).forEach(r => { if (r.branch === b && td(r)) c -= r.cash; }); });
    st.payments.forEach(x => { if (x.branch === b && td(x) && x.method !== 'fib') c += x.amt; });
    st.expenses.forEach(x => { if (x.branch === b && td(x)) c -= x.amt; });
    return c;
  }
  /* a branch till in the money that is really in it — dollars (cents) and dinars apart, all time. No dollar rate is used, so a
     new rate tomorrow can never make yesterday's cash look over or short. in = cash sales + cash debt payments; out = cash given
     back + expenses; hand = given to the manager. */
  const TILL0 = () => ({ inU: 0, inD: 0, outU: 0, outD: 0, handU: 0, handD: 0, discD: 0 });
  /* adds what a bag of records (the live lists, or one archive month) puts into / takes out of one branch till.
     Records marked `arc` are archive copies shown on a screen: the archive total already holds them. */
  function tillAdd(st, o, b, bag, all) {
    const D = st.cur === 'IQD', live = x => all || !x.arc;
    const put = (kU, kD, cents, din, rate) => { if (din != null) o[kD] += din; else if (D) o[kD] += payDinar(rate || st.rate, cents); else o[kU] += cents; };   // no dinar written on an old record: it counts in the shop's own currency, never in the other one
    (bag.sales || []).forEach(x => { if (!live(x)) return;
      if (x.branch === b && x.pay === 'cash' && !x.legacy) { if (x.got && x.got.iqd) o.inD += x.got.iqd; else if (x.got && x.got.usd) o.inU += x.got.usd; else put('inU', 'inD', x.total, D && x.dn != null ? x.dn : null, x.rate); }
      (x.rets || []).forEach(r => { if (r.branch === b && r.cash) { if (r.cashD != null) o.outD += r.cashD; else if (x.got && x.got.usd && !x.got.iqd) o.outU += r.cash; else put('outU', 'outD', r.cash, null, x.rate); } });
    });
    (bag.payments || []).forEach(x => { if (live(x) && x.branch === b && x.method !== 'fib') put('inU', 'inD', x.amt, x.amtD); });
    (bag.expenses || []).forEach(x => { if (live(x) && x.branch === b) put('outU', 'outD', x.amt, x.amtD); });
    (bag.hands || []).forEach(h => { if (live(h) && h.branch === b) { if (h.cur === 'IQD') o.handD += h.amount; else o.handU += h.amount; } });
    (bag.jlines || []).forEach(l => { if (live(l) && l.b === b && l.disc) o.discD += l.disc; });   // discounts written in the daily sheet leave the till
    return o;
  }
  function till(st, b) {
    const o = TILL0(), base = st.arch && st.arch.till && st.arch.till[b];
    if (base) Object.keys(o).forEach(k => o[k] += base[k] || 0);                      // months that moved to the archive
    tillAdd(st, o, b, st);
    o.usd = o.inU - o.outU - o.handU; o.iqd = o.inD - o.outD - o.handD - o.discD;
    o.debt = st.customers.reduce((a, c) => a + (c.debt || 0), 0);                     // what customers still owe (not in the till)
    return o;
  }
  /* ---------- the archive: months older than ARCH_DAYS leave the working copy, so it never grows heavy ----------
     What goes: receipts (with their returns), cancelled receipts, the log, stock corrections, sheet lines, expenses, hand-overs,
     debt payments. What stays for ever: items, customers, accounts, deliveries, swaps, gifts, pay. What a month added to the tills
     and to each buyer's total is kept in st.arch, so every total stays exact. A receipt of a customer who still owes, and a FIB
     receipt the manager has not ticked yet, wait until that is settled. */
  const ARCH_DAYS = 92, ARCH_KEYS = ['sales', 'voids', 'log', 'adjs', 'jlines', 'expenses', 'hands', 'payments'];
  const monthOf = (st, x) => x.t == null ? String(x.d || '').slice(0, 7) : isoD(st, x.t).slice(0, 7);
  function buyKey(st, s) { const cu = s.customer && st.customers.find(c => c.id === s.customer); return s.phone || (cu && cleanPhone(cu.phone)) || (cu ? 'c' + cu.id : ''); }
  function buyAdd(st, A, s, sign) {
    const k = buyKey(st, s); if (!k || s.legacy) return;
    const o = A.buy[k] || (A.buy[k] = { t: 0, p: 0, n: 0, l: 0, nm: [] }), cu = s.customer && st.customers.find(c => c.id === s.customer);
    o.t += sign * (s.total - s.refunded); o.p += sign * s.lines.reduce((a, l) => a + l.qty - l.ret, 0); o.n += sign; o.l = Math.max(o.l, ms(s.t));
    [s.buyer, cu && cu.name].forEach(n => { if (n && sign > 0 && !o.nm.includes(n) && o.nm.length < 4) o.nm.push(n); });
    if (o.n <= 0) delete A.buy[k];
  }
  function archive(st, now, days, dry) { // one month per call, the oldest first; dry = only say what would go
    const lim = isoD(st, ms(now) - (days == null ? ARCH_DAYS : days) * 864e5).slice(0, 7);
    const owes = new Set(st.customers.filter(c => c.debt > 0).map(c => c.id));
    const stay = { sales: s => s.legacy || (s.pay === 'debt' && owes.has(s.customer)) || (s.pay === 'fib' && !s.fibChecked) || (s.back && ms(now) - s.back < 7 * 864e5), payments: x => owes.has(x.customer) };
    const goes = (key, x) => !(stay[key] && stay[key](x));
    let k = null; ARCH_KEYS.forEach(key => (st[key] || []).forEach(x => { if (!goes(key, x)) return; const m = monthOf(st, x); if (m && m < lim && (k === null || m < k)) k = m; }));
    if (!k) return null;
    const part = {}, keep = {};
    ARCH_KEYS.forEach(key => { part[key] = []; keep[key] = []; (st[key] || []).forEach(x => (monthOf(st, x) === k && goes(key, x) ? part[key] : keep[key]).push(x)); });
    if (dry) return { k, part: mark(JSON.parse(JSON.stringify(part))) };
    ARCH_KEYS.forEach(key => { st[key] = keep[key]; });
    const A = st.arch || (st.arch = { months: {}, till: [], buy: {} });
    st.branches.forEach((_, b) => { const o = tillAdd(st, TILL0(), b, part, true), B = A.till[b] || (A.till[b] = {}); Object.keys(o).forEach(key => { if (o[key]) B[key] = (B[key] || 0) + o[key]; }); });
    part.sales.forEach(s => buyAdd(st, A, s, 1));
    const M = A.months[k] || (A.months[k] = { n: 0 }); M.n += part.sales.length; M.w = ms(now);
    part.sales.forEach(s => { if (M.a == null || s.no < M.a) M.a = s.no; if (M.z == null || s.no > M.z) M.z = s.no; });
    return { k, part: mark(part) };
  }
  function mark(part) { ARCH_KEYS.forEach(key => (part[key] || []).forEach(x => { x.arc = 1; })); return part; }
  /* what is already in the archive month + what goes now (the same record never twice: a retried request sends it again) */
  function mergePart(old, part) {
    const out = {};
    ARCH_KEYS.forEach(key => { const a = (old && old[key]) || [], b = part[key] || [];
      if (key === 'sales' || key === 'voids') { const m = new Map(); a.concat(b).forEach(x => m.set(x.no, x)); out[key] = [...m.values()].sort((x, y) => ms(y.t) - ms(x.t)); }
      else { const seen = new Set(); out[key] = a.concat(b).filter(x => { const s = JSON.stringify(x); if (seen.has(s)) return false; seen.add(s); return true; }); } });
    return out;
  }
  /* a receipt comes back from the archive because something must still happen to it (a return, a swap, a correction) */
  function unarchive(st, sales, now) {
    const A = st.arch; let n = 0; if (!A) return 0;
    (sales || []).forEach(raw => { if (st.sales.some(x => x.no === raw.no)) return; const s = JSON.parse(JSON.stringify(raw)); delete s.arc; s.back = ms(now);
      st.branches.forEach((_, b) => { const o = tillAdd(st, TILL0(), b, { sales: [s] }, true), B = A.till[b] || (A.till[b] = {}); Object.keys(o).forEach(key => { if (o[key]) B[key] = (B[key] || 0) - o[key]; }); });
      buyAdd(st, A, s, -1); const M = A.months[monthOf(st, s)]; if (M && M.n > 0) M.n--;
      let i = st.sales.findIndex(x => ms(x.t) < ms(s.t)); if (i < 0) i = st.sales.length; st.sales.splice(i, 0, s); n++; });
    return n;
  }
  /* the part of an archive month one person may see: the same rules as the working copy */
  function projectPart(st, userName, part) {
    const tmp = Object.assign({}, st); ARCH_KEYS.forEach(k => { tmp[k] = (part && part[k]) || []; });
    const out = project(tmp, userName), r = {}; ARCH_KEYS.forEach(k => { r[k] = out[k] || []; }); return r;
  }
  /* ---------- «جەردی ڕۆژانە»: one sheet per day and branch, built from the records themselves ----------
     ژمارەی کۆگا (start of the day) + هاتوو − فرۆشتن − جوملە − عاطڵ + گەڕاوە = ماوە لە کۆگا. Money is what those pieces brought in. */
  function daySheet(st, b, d) { // d = 'YYYY-MM-DD' in the shop's own time
    const t0 = Date.parse(d + 'T00:00:00Z') - tzMs(st), t1 = t0 + 864e5, inDay = x => { const m = ms(x); return m >= t0 && m < t1; }, after = x => ms(x) >= t1;
    const R = new Map(), g = id => R.get(id) || (R.set(id, { sold: 0, whole: 0, ret: 0, bad: 0, inn: 0, fix: 0, disc: 0, sumC: 0, sumD: 0, later: 0, note: '', jd: 0, jb: 0 }), R.get(id));
    const lineD = (s, l) => l.pd != null ? l.pd : payDinar(s.rate || st.rate, l.price);   // an old line without its dinar price: the dinar of that day, to the nearest note
    st.sales.forEach(s => { if (s.legacy) return;
      if (s.branch === b) { const day = inDay(s.t), aft = after(s.t);
        if (day || aft) s.lines.forEach(l => { const r = g(l.id); if (aft) { r.later -= l.qty; return; }
          if (s.type === 'wholesale') r.whole += l.qty; else r.sold += l.qty;
          const share = s.sub ? s.disc * l.qty * l.price / s.sub : 0; r.sumC += l.qty * l.price - share; r.sumD += l.qty * lineD(s, l) - dinar(s.rate || st.rate, share); r.disc += dinar(s.rate || st.rate, share); }); }
      (s.rets || []).forEach(x => { const day = inDay(x.t), aft = after(x.t); if (!day && !aft) return; const n = (x.items || []).reduce((a, i) => a + i.qty, 0) || 1;
        (x.items || []).forEach(i => { const r = g(i.id), back = x.faulty ? 0 : i.qty;
          if (s.branch === b) { if (aft) r.later += back; else { if (x.faulty) r.bad += i.qty; else r.ret += i.qty; } }       // the piece goes back to the branch that sold it
          if (x.branch === b && day) { const part = x.amt * i.qty / n; r.sumC -= part; r.sumD -= x.cashD != null ? x.cashD * i.qty / n : payDinar(s.rate || st.rate, part); } }); }); });
    st.exchanges.forEach(x => { if (x.branch !== b) return; const r = g(x.id); if (after(x.t)) r.later -= x.qty; else if (inDay(x.t)) r.bad += x.qty; });
    (st.gifts || []).forEach(x => { if (x.branch !== b) return; const r = g(x.item); if (after(x.t)) r.later -= x.qty; else if (inDay(x.t)) r.fix -= x.qty; });
    st.purchases.forEach(x => { if (x.branch !== b) return; const r = g(x.id); if (after(x.t)) r.later += x.qty; else if (inDay(x.t)) r.inn += x.qty; });
    (st.adjs || []).forEach(x => { if (x.b !== b) return; const r = g(x.id); if (after(x.t)) r.later += x.d; else if (inDay(x.t)) r.fix += x.d; });
    (st.jlines || []).forEach(l => { if (l.b !== b) return; const r = g(l.id);
      if (l.d === d) { r.jd = l.disc || 0; r.jb = l.bad || 0; r.note = l.note || ''; r.disc += r.jd; r.bad += r.jb; r.sumD -= r.jd; r.sumC -= Math.round(r.jd * 100 / st.rate); }
      else if (l.d > d && l.bad) r.later -= l.bad; });
    const rows = st.items.map((it, k) => { const r = g(it.id), left = it.s[b] - r.later, open = left - r.inn - r.fix + r.sold + r.whole + r.bad - r.ret;
      return { id: it.id, no: k + 1, name: it.name, open, inn: r.inn + r.fix, r: it.r, rd: it.rd != null ? it.rd : payDinar(st.rate, it.r), w: it.w, sold: r.sold, whole: r.whole, ret: r.ret, bad: r.bad, left, disc: Math.round(r.disc), jd: r.jd, jb: r.jb, sumC: Math.round(r.sumC), sumD: Math.round(r.sumD), note: r.note }; });
    const T = rows.reduce((a, r) => { ['open', 'inn', 'sold', 'whole', 'ret', 'bad', 'left', 'disc', 'sumC', 'sumD'].forEach(k => a[k] += r[k]); return a; }, { open: 0, inn: 0, sold: 0, whole: 0, ret: 0, bad: 0, left: 0, disc: 0, sumC: 0, sumD: 0 });
    return { d, b, rows, tot: T, today: d === isoD(st, Date.now()) };
  }
  /* start clean for real use: every test sale, log line, count and payment goes; items, customers, accounts and settings stay */
  function resetActivity(st, seedItems, seedCustomers) {
    ['sales', 'expenses', 'payments', 'purchases', 'exchanges', 'approvals', 'log', 'jards', 'ledger', 'notes', 'closes', 'voids', 'hands', 'gifts', 'adjs', 'jlines'].forEach(k => st[k] = []);
    st.unread = {}; st.nextNo = 20001; st.adjusted = 0; st.jardAdj = 0; delete st.arch;
    const si = new Map((seedItems || []).map(x => [x.id, x])), sc = new Map((seedCustomers || []).map(x => [x.id, x]));
    st.items.forEach(i => { delete i.f; const x = si.get(i.id); if (x) { i.s = x.s.slice(); i.r = cents(x.r); i.w = cents(x.w); } });
    st.customers.forEach(c => { const x = sc.get(c.id); c.debt = x ? cents(x.debt) : 0; });
  }
  /* the first real day: every trial goes, the pieces of both branches, the wholesale and the buying prices come from the old system */
  function freshStart(st, rows, seedCustomers, now) {
    resetActivity(st, null, seedCustomers);
    const keep = new Set((seedCustomers || []).map(x => x.id));
    st.customers = st.customers.filter(c => c.plat || keep.has(c.id));   // customers made while trying the system go too
    let n = 0;
    (rows || []).forEach(x => { const it = st.items.find(i => i.name.trim().toLowerCase() === x.name.trim().toLowerCase()); if (!it) return;
      it.s = st.branches.map((_, k) => x.s[k] || 0); if (x.w > 0) it.w = cents(x.w); if (x.c > 0) it.c = cents(x.c); else delete it.c; n++; });
    reprice(st);
    log(st, (st.team.find(u => u.role === 'owner') || {}).name || '', 0, now, 'stock', `دەستپێکی نوێ: هەموو تاقیکردنەوەکان سڕانەوە، ژمارەی <b class="num">${n}</b> کاڵا لە هەردوو لق و نرخی کڕین و جوملە لە سیستەمە کۆنەکەوە هێنران`);
    return { n };
  }
  function addPlatforms(st, names) { let n = 0; (names || []).forEach(nm => { if (!st.customers.some(c => c.name === nm)) { st.customers.push({ id: st.nextId++, name: nm, phone: '', addr: '', debt: 0, plat: true }); n++; } else st.customers.find(c => c.name === nm).plat = true; }); return n; }
  function importOld(st, rows, now) {
    let add = 0, fix = 0;
    (rows || []).forEach(x => {
      let it = st.items.find(i => i.name.trim().toLowerCase() === x.name.trim().toLowerCase());
      if (!it) { it = { id: st.nextId++, name: x.name, bc: x.bc || '', r: cents(x.usd), w: 0, s: st.branches.map(() => 0), cat: x.cat || 'هیتر' }; st.items.push(it); add++; }
      if (x.rd > 0) it.rd = x.rd; else { delete it.rd; it.r = cents(x.usd); }
      if (Number.isInteger(x.s0) && it.s[0] !== x.s0) { it.s[0] = x.s0; fix++; }
    });
    reprice(st);
    log(st, (st.team.find(u => u.role === 'owner') || {}).name || '', 0, now, 'stock', `هاوتاکردن لەگەڵ سیستەمە کۆنەکە: <b class="num">${add}</b> کاڵای نوێ زیاد کرا، ژمارەی <b class="num">${fix}</b> کاڵا لە ${esc(st.branches[0])} ڕاست کرایەوە، نرخەکان بە دینار جێگیر کران`);
    return { add, fix };
  }
  function project(st, userName) {
    const u = acct(st, userName); if (!u) throw new Err(BAD);
    const lv = LV[u.role], own = lv === 3, cut = (o, k) => { const c = { ...o }; delete c[k]; return c; };
    const out = {
      gifts: lv > 1 ? (st.gifts || []) : [], gone: lv > 1 ? (st.gone || []).map(i => own ? i : cut(i, 'c')) : [],
      hands: lv > 1 ? (st.hands || []) : (st.hands || []).filter(h => h.by === u.name),
      voids: lv > 1 ? (st.voids || []).map(s => own ? s : ({ ...s, lines: s.lines.map(l => cut(l, 'cost')) })) : [],
      branches: st.branches, shop: st.shop || { note: '' }, cur: st.cur, rate: st.rate, rates: st.rates, target: st.target, tz: st.tz == null ? 180 : st.tz, adjusted: st.adjusted || 0, jardAdj: st.jardAdj || 0,
      items: own ? st.items : st.items.map(i => cut(i, 'c')),
      customers: st.customers,
      team: st.team.map(t => { const o = { name: t.name, role: t.role, branch: t.branch }; if (t.role !== 'owner' && (own || t.name === u.name || (lv === 2 && t.role === 'staff'))) { o.pct = t.pct; o.salary = t.salary; o.salaryCur = t.salaryCur; } if (own) o.pw = !!t.pw; return o; }),
      sales: own ? st.sales : st.sales.map(s => ({ ...s, lines: s.lines.map(l => cut(l, 'cost')) })),
      expenses: lv > 1 ? st.expenses : st.expenses.filter(e => e.by === u.name),   // a seller sees the expenses he wrote himself
      payments: st.payments,
      purchases: own ? st.purchases : lv > 1 ? st.purchases.map(x => cut(x, 'cost')) : [],
      exchanges: st.exchanges,
      approvals: own ? st.approvals : st.approvals.filter(a => a.by === u.name),
      log: st.log.filter(e => e.toUser ? (own || e.toUser === u.name) : (e.to === 'all' || lv > 1)),
      unread: { [u.name]: st.unread[u.name] || 0 },
      jards: lv > 1 ? st.jards : st.jards.filter(j => j.by === u.name),
      ledger: own ? st.ledger : st.ledger.filter(x => x.to === u.name || (lv === 2 && (acct(st, x.to) || {}).role === 'staff')),
      notes: own ? st.notes : st.notes.filter(n => n.to === 'all' || (Array.isArray(n.to) && n.to.includes(u.name))),
      adjs: st.adjs || [], jlines: st.jlines || [],
      arch: st.arch ? { months: st.arch.months, buy: st.arch.buy, till: lv > 1 ? st.arch.till : [] } : null,
      myTill: lv === 1 && u.branch >= 0 ? till(st, u.branch) : null, // a seller sees what should be in his own till (he cannot add it up himself: expenses and other hand-overs are not sent to him)
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
    ['sales', 'expenses', 'payments', 'purchases', 'exchanges', 'approvals', 'log', 'jards', 'ledger', 'notes', 'rates', 'voids', 'closes', 'hands', 'gifts'].forEach(k => { if (st[k]) walk(st[k]); });
    if (st.unread && from in st.unread) { st.unread[to] = (st.unread[to] || 0) + st.unread[from]; delete st.unread[from]; }
    return true;
  }
  return { Err, LV, ROLE, TYPES, PAY, LK, SHARED, ACTIONS, init, apply, project, rename, resetActivity, freshStart, cashExpected, till, daySheet, archive, mergePart, unarchive, projectPart, buyKey, ARCH_DAYS, ARCH_KEYS, cashDiff, dinar, payDinar, dueDinar, reprice, centsOf, importOld, addPlatforms, cleanPhone, UNDO_MS, SN_OK, cleanSn, gotTxt, SHORT_MAX, OVER_MAX, W_DEF, W_MAX, lineW, warrantyEnd, wTxt, log, moves, refundCalc, fmtMoney, fmtCur, iqd, esc, cents, ms, isoD, dayStart, pctTxt };
});

// online mode: public address + public (anon) key only. No secret belongs in this file.
window.KOGA_CONFIG = { url: "https://exayuyporjusmbxcwxzz.supabase.co", anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YXl1eXBvcmp1c21ieGN3eHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODA5MDcsImV4cCI6MjExMDI1NjkwN30.2l0ESALTYmhkezSzeZNeLK5SSh_treH_-Tx2O5Ifm3E" };

window.KOGA_IMGS={"9e6daa77":"5c440cf1fb.webp","f2a75d63":"5c440cf1fb.webp","eaf89388":"85553b05ce.webp","5bc088b0":"3a42c7bf0f.webp","3c399b70":"9f6cc88c3b.webp","f9fc1e53":"e29e8bf3bd.webp","ad615444":"e29e8bf3bd.webp","859cd31d":"5cbf669235.webp","027f03ef":"5cbf669235.webp","78f183da":"b35b9a7f3a.webp","91b003fd":"6d21238ab5.webp","3b2fb901":"6d21238ab5.webp","e185646a":"6d21238ab5.webp","91adc566":"78627ff110.webp","78a5ea0b":"759c35e2c6.webp","98acd830":"a1600e17bb.webp","75042f98":"a5dfb2a4fa.webp","94781638":"b43865b222.webp","b5d358f2":"08a9919fcc.webp","30e84810":"eceb799167.webp","a9a2f210":"c929da8307.webp","45d006e2":"c929da8307.webp","edd4a9d3":"4c4ceaeb3d.webp","c947085f":"a41a5acd53.webp","55595132":"f5f134866b.webp","39a5efe3":"f5f134866b.webp","2f75677c":"8338344519.webp","6f4dc8a1":"ee82aa5ae7.webp","e82aa564":"d11ce423d7.webp","18b92f0e":"ed36814f74.webp","f35ef78b":"7c3a437abc.webp","732c433a":"db137d0e88.webp","b59b69a0":"b8e318cbf2.webp","ccc06ef2":"52261d4cb3.webp","62007328":"03328004d7.webp","abf96cd6":"a2d5ecafcc.webp","396687bc":"89e0e5ea71.webp","9aecd216":"f94a59bde3.webp","1607725e":"cf51b425e7.webp","a97e4b74":"104a482b30.webp","de10a306":"c913725683.webp","a12a8653":"4011ca0122.webp","b2514b58":"785c28a08b.webp","b1bb0652":"785c28a08b.webp","60fa680f":"4af77bfee7.webp","1f625994":"04c7e56551.webp","ce080630":"9ce27dd02a.webp","f8e4c867":"fe7fc04b55.webp","c7ae2d9f":"95df7bf5ed.webp","8025e3c0":"78bd60e1cd.webp","fe26ffd1":"a7464a89c2.webp","ffb92cf9":"672d8d9a60.webp","1cf19664":"419175615b.webp","6a0f78c0":"4cc1849578.webp","54a1193a":"64156141fe.webp","ee3a40b7":"8d403d4b6a.webp","19486333":"afcfc8308d.webp","8ff92452":"1ce7549945.webp","adef9914":"321cc05214.webp","0e76a876":"664d15e7f1.webp","1e8a495e":"32bbb841c1.webp","8c4b3ffb":"1ddc3c9a7c.webp","740a075b":"5bb56e9252.webp","215f60b1":"8d48565c9c.webp","5a9b04cb":"8ae5144cba.webp"};

/* وەستا غەریب — نموونەی دیزاین. هەموو پارەکان بە سەنت (ژمارەی تەواو) هەژمار دەکرێن تا هیچ کەم و زیادێک ڕوو نەدات. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cents = n => Math.round(Number(n) * 100);
const money = c => `<span class="num">${fmtMoney(c)}</span>`;
const h12 = (d, sec) => { d = new Date(Core.ms(d)); const h = d.getHours(); return (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (sec ? ':' + String(d.getSeconds()).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm'); };   // 1–12 with am / pm, never 13…23
const hm = d => `<span class="num">${h12(d)}</span>`;
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';   // 2026-11-16 -> 16/11/2026
const dateBox = (id, v) => `<label class="dbox"><span class="num">${dmy(v)}</span><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><input type="date" id="${id}" value="${v}"></label>`;
document.addEventListener('change', e => { const x = e.target; if (x && x.matches && x.matches('.dbox input')) x.parentElement.querySelector('span').textContent = dmy(x.value); }, true);
document.addEventListener('click', e => { const x = e.target; if (x && x.matches && x.matches('.dbox input') && x.showPicker) { try { x.showPicker(); } catch (er) {} } }, true);
/* money boxes group the thousands by themselves while you type: 50000 -> 50,000 */
const MONEY_IN = '#cD,#cU,#dAmt,#lpA,#wmA,#xR,#xRd,#xW,#xWd,#dcA,#eA,#hA,#heA,#nC,#nR,#nRd,#nW,#nWd,#oA,#pC,#pR,#pW,#rate100,#rtV,#tA,#tgA,#vCost,#yA,.grp';
const grpTyped = v => { v = latin(String(v)).replace(/[^\d.]/g, ''); const k = v.indexOf('.'); let a = k < 0 ? v : v.slice(0, k), b = k < 0 ? '' : '.' + v.slice(k + 1).replace(/\./g, ''); a = a.replace(/^0+(?=\d)/, ''); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + b; };
document.addEventListener('input', e => { const x = e.target; if (!x || !x.matches || !x.matches(MONEY_IN)) return; const end = x.selectionStart === x.value.length, right = x.value.length - (x.selectionStart || 0), g = grpTyped(x.value); if (g === x.value) return; x.value = g; try { const pos = end ? g.length : Math.max(0, g.length - right); x.setSelectionRange(pos, pos); } catch (er) {} }, true);
const IC = {
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
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
  diff: 'M12 6.5v5M9.5 9h5M9.5 15.5h5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  print: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  buyers: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3M15.5 16.5h.01',
  plug: 'M9 2v5M15 2v5M7 7h10v4a5 5 0 0 1-10 0zM12 16v6',
  cable: 'M4 3v5a3 3 0 0 0 3 3h10a3 3 0 0 1 3 3v7M2.5 3h3M18.5 21h3',
  phones: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7zM12 7c1.5-3 5-3.5 5-1.5S14 7 12 7z',
  chart: 'M4 20V11M10 20V5M16 20v-6M3 20h18',
  key: 'M14.5 4a5.5 5.5 0 1 1-4.9 8L3 18.6V21h3v-2h2v-2h2l1.6-1.6A5.5 5.5 0 0 1 14.5 4zM16 8.5h.01',
  handcash: 'M2 14h3.5l5.5 2 6.5-2.6a1.6 1.6 0 0 0-1.1-3L12 12M5.5 14v6M15 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  contacts: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 16c.5-1.6 1.6-2.3 3-2.3s2.5.7 3 2.3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  calc: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8v3H8zM8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01',
  usd: 'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.8 7 7.2c0 5 10 2.6 10 7.6 0 2.4-2.2 3.7-5 3.7s-5-1.3-5-3.2',
  crown: 'M3 18h18M4 15 3 6l5.5 4L12 4l3.5 6L21 6l-1 9z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'
};
const MO = () => !window.__noMotion && !matchMedia('(prefers-reduced-motion:reduce)').matches;
const iqd = c => Core.iqd(S, c); // dinar, rounded to the smallest note (250)
const fmtMoney = c => Core.fmtMoney(S, c);
const CUR = () => S.cur === 'IQD' ? 'دینار' : '$';
const toC = v => S.cur === 'IQD' ? Math.round(pn(v, true) / S.rate * 100) : Math.round(pn(v) * 100); // typed amount -> cents
const USD = c => Core.fmtCur(c, 'USD'), DIN = d => Core.fmtCur(d, 'IQD');
const dinarOf = (c, rate) => Core.dinar(rate || S.rate, c);            // exact dinar (to the dinar, not rounded to a note)
const payDinar = (c, rate) => Core.payDinar(rate || S.rate, c);         // what a customer is asked for in dinar (nearest 250)
const otherCur = c => S.cur === 'IQD' ? USD(c) : DIN(payDinar(c));      // the same amount in the currency the screen is not showing
const diffTag = d => !d ? '<span class="tag g">تەواو</span>' : `<span class="tag ${d < 0 ? 'r' : 'a'}">${d < 0 ? 'کەمە' : 'زیادە'} <span class="num">${Math.abs(d).toLocaleString('en-US')}</span> د.ع</span>`;
const D8 = d => new Date(Core.ms(d)).toLocaleDateString('en-GB');
/* a sold line's warranty today: none (sold without), or its end date, days left and whether it still holds */
const wState = (sale, l) => { const e = Core.warrantyEnd(sale, l); if (e == null) return { none: true, ok: false }; return { end: new Date(e), left: Math.max(0, Math.ceil((e - Date.now()) / 864e5)), ok: Date.now() <= e }; };
const wTag = (sale, l) => { const w = wState(sale, l); return w.none ? '<span class="tag n">بێ زەمان</span>' : w.ok ? `<span class="tag g">ماوە <span class="num">${w.left.toLocaleString('en-US')}</span> ڕۆژ</span>` : '<span class="tag r">بەسەرچووە</span>'; };
const kindTag = l => l.used ? '<span class="tag a">گەڕاوە</span>' : '<span class="tag b">نوێ</span>';
const LOGO = window.KOGA_LOGO || 'logo-print.png';                      // his coin, prepared for a thermal printer
const amtOut = c => S.cur === 'IQD' ? String(iqd(c)) : (c / 100).toFixed(2);
const moneyHTML = c => fmtMoney(c).replace(' د.ع', '<i class="cy"> د.ع</i>');   // beside a big number the currency is written small
/* a number never leaves its box: when it is wider than the room it has, its type shrinks until it fits */
const FIT = '.kpi>b,.ring .mid>b,.bv>b,.tot>b,.tot2>b,.pd>b.num,.rk b,.vunits b,.vrow.vbig>b,.due b,.tillnow b,.chgt b,.tillc b.num,.gsum>b,[data-fit]';
function fitNum(el) {
  if (el._cu) return;                                   // while it counts up it keeps the size of its final value
  el.style.fontSize = ''; const cw = el.clientWidth; if (!cw) return;
  for (let i = 0; i < 3; i++) { const sw = el.scrollWidth; if (sw <= cw + .5) return; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs <= 12) return; el.style.fontSize = Math.max(12, Math.floor(fs * cw / sw * 10) / 10 - .3) + 'px'; }
}
const moreHint = el => el.classList.toggle('fadeL', el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft) > 6);   // more of the table lies to the left
const fitAll = (root = document) => { root.querySelectorAll(FIT).forEach(fitNum); root.querySelectorAll('.scroll').forEach(moreHint); };
document.addEventListener('scroll', e => { const el = e.target; if (el && el.classList && el.classList.contains('scroll')) moreHint(el); }, true);
function countUp(el, to, f, from = 0, dur = 1100) {
  const put = v => { if (f === 'int') el.textContent = Math.round(v).toLocaleString('en-US'); else el.innerHTML = moneyHTML(Math.round(v)); };
  el._cu = null; put(to); fitNum(el);
  if (!MO() || from === to) return;
  const tok = el._cu = {}; let t0 = null; put(from);
  const step = now => { if (el._cu !== tok) return; if (t0 === null) t0 = now; const k = Math.max(0, Math.min(1, (now - t0) / dur)), e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k); put(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { if (el._cu === tok) { el._cu = null; put(to); fitNum(el); } }, dur + 120); // always land on the exact value
}
const cu = (c, id = '') => `<b class="num" ${id ? `id="${id}"` : ''} data-cu="${c}" data-f="money">${moneyHTML(c)}</b>`;
const cuInt = (n, id = '') => `<b class="num" ${id ? `id="${id}"` : ''} data-cu="${n}" data-f="int">${n.toLocaleString('en-US')}</b>`;
const runCU = root => root.querySelectorAll('[data-cu]').forEach(el => countUp(el, +el.dataset.cu, el.dataset.f));
const bat = st => {
  const l = st <= 0 ? 0 : st <= 5 ? 1 : st <= 20 ? 2 : st <= 60 ? 3 : st <= 150 ? 4 : 5, C = 43.98;
  if (!l) return `<span class="stk l0"><i></i>نەماوە</span>`;
  return `<span class="stk l${l}"><svg viewBox="0 0 18 18" width="18" height="18"><circle class="t" cx="9" cy="9" r="7"/><circle class="v" cx="9" cy="9" r="7" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - l / 5)).toFixed(2)}"/></svg><span class="num">${st}</span></span>`;
};
const ico = (k, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[k]}"/></svg>`;

/* ---------- look: dark («ڕەش») or light («سپی») — kept on this device only ---------- */
const theme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
function setTheme(t, ev) {
  t = t === 'light' ? 'light' : 'dark'; if (t === theme()) return;
  const act = () => {
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#EDF0EA' : '#06070A');
    document.querySelectorAll('[data-th]').forEach(x => x.classList.toggle('on', x.dataset.th === t)); drawThBtn();
  };
  try { localStorage.setItem('koga_theme', t); } catch (e) {}
  if (MO() && document.startViewTransition && ev && ev.currentTarget) {
    const r = ev.currentTarget.getBoundingClientRect(), st = document.documentElement.style;
    st.setProperty('--vx', (r.left + r.width / 2) + 'px'); st.setProperty('--vy', (r.top + r.height / 2) + 'px');
    document.startViewTransition(act);
  } else act();
}
const themeSeg = () => `<div class="seg thseg"><button data-th="dark" class="${theme() === 'dark' ? 'on' : ''}">${ico('moon', 16)}ڕەش</button><button data-th="light" class="${theme() === 'light' ? 'on' : ''}">${ico('sun', 16)}سپی</button></div>`;
const bindTheme = root => root.querySelectorAll('[data-th]').forEach(b => b.onclick = e => setTheme(b.dataset.th, e));
function drawThBtn() { const b = document.getElementById('thBtn'); if (!b) return; b.innerHTML = ico(theme() === 'dark' ? 'sun' : 'moon', 18); b.onclick = e => setTheme(theme() === 'dark' ? 'light' : 'dark', e); }

/* config.js present = online mode (the server owns the data); without it everything stays on this device */
const REMOTE = window.KOGA_CONFIG && window.KOGA_CONFIG.url ? window.KOGA_CONFIG : null;
const net = { token: null, v: null, tick: null, chain: Promise.resolve(), busy: false, stale: false };
const S = Object.assign(Core.init(SEED_ITEMS, SEED_CUSTOMERS, new Date()), {
  session: null, count: {}, jardFilter: '', jardQ: '',
  me: null, branch: 0, dashBranch: -1, view: 'pos', q: '', cat: 'هەموو', itemFilter: 'all', cart: null
});
const EXP_CATS = ['ڕاتب', 'کرێی دوکان', 'خەرجی', 'پەرداخ', 'نایلۆن', 'هیتر'];
const TYPES = Core.TYPES;
const newCart = () => ({ type: 'retail', lines: [], customer: null, pay: 'cash', fibRef: '', fibOk: false, disc: 0, req: null, phone: '', buyer: '' });
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
const catIcon = c => c === 'هەموو' ? 'dash' : /ئەداپتەر|ئادابتەر|شەحن|adapter/i.test(c) ? 'plug' : /کێبڵ|کێبل|cable/i.test(c) ? 'cable' : /هێدفۆن|سماعە|ئێرپۆد|head|air/i.test(c) ? 'phones' : 'more';   // every category has its picture
/* every item's own photo: files are named by a short hash of the item's name (so no item name ships with the public site) */
const imgKey = n => { let h = 0x811c9dc5; const s = String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };
const imgOf = it => { const m = window.KOGA_IMGS || {}, f = it && m[imgKey(it.name)]; return f ? (window.KOGA_IMG_BASE || 'img/') + f : ''; };
/* a photo tile with the category icon behind it: if the photo is missing or fails, the icon stays */
const thumb = (it, s, cls = '') => { const ic = catIcon(it.cat), src = imgOf(it); return `<span class="gpic k-${ic} ${src ? 'has' : ''} ${cls}">${ico(ic, s)}${src ? `<img src="${src}" alt="" loading="lazy" decoding="async">` : ''}</span>`; };
document.addEventListener('error', e => { const im = e.target; if (im && im.tagName === 'IMG' && im.parentElement && im.parentElement.classList.contains('gpic')) { im.parentElement.classList.remove('has'); im.remove(); } }, true);
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
function run(action, payload, onOk, onFail) {
  payload = Object.assign({ branch: S.branch }, payload);
  if (REMOTE) return void runRemote(action, payload, onOk, onFail);
  const n0 = S.log.length; let r;
  try { r = Core.apply(S, S.me, action, payload, new Date()); } catch (e) { if (e instanceof Core.Err) { toast(e.message, 1); if (onFail) onFail(); return; } throw e; }
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
/* ---------- the archive: months older than about three months live apart on the server. A screen that needs them asks once,
   keeps them while the page is open and lays them beside the working copy (marked `arc`, so no total counts them twice). ---------- */
const ARC = { parts: {}, extra: new Map(), live: {}, asked: new Set(), busy: false, who: null };
const archMonths = () => S.arch && S.arch.months ? Object.keys(S.arch.months).sort() : [];
const archLeft = () => archMonths().filter(k => !ARC.parts[k]);
function mergeArch() {
  if (ARC.who !== S.me) { ARC.parts = {}; ARC.extra.clear(); ARC.asked.clear(); ARC.who = S.me; }      // another account looks: its own copy
  if (!S.arch) { ARC.parts = {}; ARC.extra.clear(); return; }
  Core.ARCH_KEYS.forEach(k => { const live = ARC.live[k] || []; let add = [];
    Object.values(ARC.parts).forEach(pt => { if (pt[k] && pt[k].length) add = add.concat(pt[k]); });
    if (k === 'sales') ARC.extra.forEach(s => add.push(s));
    if (k === 'sales' || k === 'voids') { const seen = new Set(live.map(s => s.no)); add = add.filter(s => !seen.has(s.no) && seen.add(s.no)); }
    S[k] = add.length ? live.concat(add).sort((a, b) => (b.t ? Core.ms(b.t) : 0) - (a.t ? Core.ms(a.t) : 0)) : live; });
}
async function archLoad(ks) {
  if (!REMOTE || ARC.busy || !ks.length) return false; ARC.busy = true; document.documentElement.style.cursor = 'progress';
  try { for (let i = 0; i < ks.length; i += 6) { const some = ks.slice(i, i + 6), j = await call('arch', { ks: some }, viewAs() || undefined);
      some.forEach(k => { ARC.parts[k] = (j.result.parts || {})[k] || {}; }); }
    mergeArch(); return true;
  } catch (e) { toast(e.message, 1); return false; } finally { ARC.busy = false; document.documentElement.style.cursor = ''; }
}
/* a screen shows days that already left for the archive: those months are fetched once, then the screen draws again */
function archWant(fromIso, redraw) {
  if (!REMOTE || !S.arch || ARC.busy) return; const ks = archLeft().filter(k => k >= String(fromIso).slice(0, 7)); if (!ks.length) return;
  toast('پسوڵە کۆنەکان لە ئەرشیف دەهێنرێن…'); archLoad(ks).then(ok => { if (ok && redraw) redraw(); });
}
/* one old receipt by its number, slip code, serial or the buyer's phone; true = the question was sent */
function archSeek(q, again) {
  q = latin(q == null ? '' : String(q)).trim().replace(/^#/, ''); if (!REMOTE || !S.arch || !archMonths().length || q.length < 3 || ARC.asked.has(q)) return false; ARC.asked.add(q);
  const slip = /^77(\d{6,9})$/.exec(q), dig = /^\d+$/.test(q), pay = slip ? { no: +slip[1] } : dig && q.length <= 6 ? { no: +q } : dig ? { phone: q } : { sn: Core.cleanSn(q) };
  call('archFind', pay, viewAs() || undefined).then(j => { const l = j.result.sales || []; if (!l.length) return; l.forEach(s => ARC.extra.set(s.no, s)); mergeArch(); toast('لە ئەرشیف دۆزرایەوە'); if (again) again(); }, () => {});
  return true;
}
const MON = k => k.slice(5) + '/' + k.slice(0, 4);
/* the line under long lists: what is still in the archive, and the buttons that bring it */
function archFoot(redraw) {
  const v = $('#view'), left = archLeft(); if (!v || !REMOTE || !left.length || v.querySelector('.archbar')) return;
  v.insertAdjacentHTML('beforeend', `<div class="archbar"><span>${ico('items', 16)}تۆمارەکانی مانگی <b class="num">${MON(left[left.length - 1])}</b> و کۆنتر لە ئەرشیفدان (<span class="num">${left.length}</span> مانگ) — هیچیان نەسڕاونەتەوە</span><span class="row"><button class="ghost sm" data-arc="1">مانگێکی کۆنتر بهێنە</button>${left.length > 1 ? '<button class="ghost sm" data-arc="all">هەموویان بهێنە</button>' : ''}</span></div>`);
  v.querySelectorAll('[data-arc]').forEach(b => b.onclick = () => { b.disabled = true; archLoad(b.dataset.arc === 'all' ? left : [left[left.length - 1]]).then(ok => { if (ok) redraw(); }); });
}
function takeSnap(j) { // replace the shared part of S with the server's copy; screen state stays
  if (!j.state || (net.v != null && j.v != null && j.v < net.v)) return false;
  Core.SHARED.forEach(k => { if (k in j.state) S[k] = j.state[k]; });
  Core.ARCH_KEYS.forEach(k => { ARC.live[k] = S[k] || []; }); mergeArch();
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
async function runRemote(action, payload, onOk, onFail) {
  if (viewAs()) { toast('لە «بینین وەک» تەنها سەیر دەکرێت؛ بۆ گۆڕانکاری بگەڕێوە سەر ئەکاونتی خۆت', 1); if (onFail) onFail(); return; }
  if (net.busy) { if (onFail) onFail('busy'); return; } // no double submit while the server is answering
  net.busy = true; document.documentElement.style.cursor = 'progress';
  let j = null, err = null;
  try { j = await call(action, payload); } catch (e) { err = e; }
  net.busy = false; document.documentElement.style.cursor = '';
  if (err) { netFail(err); if (onFail) onFail(); return; }
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
  if (S.view === 'returns' && retNo) V.returns(retNo); else if (S.view === 'warranty') V.warranty(); else if (S.view === 'customers' && $('#cQ')) V.customers($('#cQ').value); else drawView();
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
function closeModal() { const f = document.activeElement; if (f && f.blur && $('#sheet').contains(f)) f.blur(); /* a hidden box must not keep the keyboard (or swallow the next scan) */ $('#modal').classList.remove('on'); if (!$('#drawer').classList.contains('on')) lockPage(false); }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
$('#bell').onclick = () => { $('#feed').innerHTML = myFeed().map(feedRow).join('') || `<div class="empty"><b>هیچ ئاگەدارییەک نییە</b>هەر فرۆشتن و گەڕاندنەوەیەک لێرە دەردەکەوێت</div>`; $('#drawer').classList.add('on'); lockPage(true); if (S.unread[S.me]) quiet('markRead'); drawBell(); };
$('#drawerX').onclick = () => { $('#drawer').classList.remove('on'); if (!$('#modal').classList.contains('on')) lockPage(false); };

/* ---------- shell ---------- */
const NAV = [ // [view, title, icon, minimum level, short name, hidden from the menu, group] — the old returns screen now lives inside «گەڕاوە و زەمان»
  ['dash', 'داشبۆرد', 'dash', 2, null, false, ''],
  ['pos', 'فرۆشتن', 'pos', 1, null, false, 'فرۆشتن'], ['warranty', 'گەڕاوە و زەمان', 'shield', 2, null, false, 'فرۆشتن'], ['sales', 'پسولەکان', 'sales', 2, null, false, 'فرۆشتن'], ['mine', 'فرۆشتنەکانم', 'chart', 1, null, false, 'فرۆشتن'], ['returns', 'گەڕاندنەوە', 'returns', 2, null, true, 'فرۆشتن'],
  ['items', 'کاڵا و کۆگا', 'items', 2, null, false, 'کۆگا'], ['jard', 'جەردی ڕۆژانە', 'jard', 1, 'جەرد', false, 'کۆگا'], ['jardcount', 'ژماردنی کۆگا', 'jard', 1, null, true, 'کۆگا'], ['gifts', 'خەڵات', 'gift', 3, null, false, 'کۆگا'],
  ['customers', 'جوملە و قەرز', 'customers', 1, 'جوملە', false, 'کڕیار'], ['buyers', 'موشتەرییەکان', 'contacts', 1, null, false, 'کڕیار'],
  ['expenses', 'مەسروفات', 'expenses', 1, null, false, 'پارە'], ['cashjard', 'جەردی پارە', 'handcash', 1, null, false, 'پارە'], ['diffs', 'نەقس و زیادە', 'diff', 3, null, false, 'پارە'], ['perf', 'مووچە', 'cash', 1, null, false, 'پارە'],
  ['team', 'ئەکاونتەکان', 'key', 3, null, false, 'بەڕێوەبردن'], ['log', 'تۆماری کارەکان', 'log', 3, null, false, 'بەڕێوەبردن'], ['settings', 'ڕێکخستنەکان', 'gear', 3, null, false, 'بەڕێوەبردن']
];
const navItems = () => NAV.filter(n => lvl() >= n[3] && !n[5]);
function acctBox(sheet) {
  const boss = acct(S.session) && acct(S.session).role === 'owner';
  return `${sheet ? `<label class="f" style="margin:0">ڕووکار${themeSeg()}</label>` : ''}${boss ? `<label class="f" style="margin:0;font-size:12px">بینین وەک (تەنها بەڕێوەبەر)<select class="inp va" style="padding:8px 10px">${S.team.map(u => `<option value="${esc(u.name)}" ${u.name === S.me ? 'selected' : ''}>${esc(u.name)} — ${ROLE[u.role]}</option>`).join('')}</select></label>` : ''}${lvl() === 2 ? `<label class="f curlab" style="margin:0;font-size:12px">دراوی پیشاندان<div class="seg curseg"><button data-cur2="USD" class="grow ${S.cur === 'USD' ? 'on' : ''}">دۆلار $</button><button data-cur2="IQD" class="grow ${S.cur === 'IQD' ? 'on' : ''}">دینار د.ع</button></div></label>` : ''}${sheet ? '<button class="ghost sm lo">چوونەدەرەوە</button>' : `<div class="row lorow"><button class="ghost sm lo grow" title="چوونەدەرەوە">${ico('out', 16)}<span>چوونەدەرەوە</span></button>`+'<button class="thbtn" id="thBtn" aria-label="ڕووکاری ڕەش یان سپی" title="ڕووکاری ڕەش / سپی"></button></div>'}`;
}
function bindAcct(root) { bindTheme(root); root.querySelectorAll('[data-cur2]').forEach(b => b.onclick = e => { e.preventDefault(); if (S.cur === b.dataset.cur2) return; closeModal(); run('setCurrency', { cur: b.dataset.cur2 }, () => render(true)); }); const v = root.querySelector('.va'); if (v) v.onchange = e => { closeModal(); setRole(v.value, e); }; root.querySelector('.lo').onclick = () => { closeModal(); logout(); }; }
function moreSheet() {
  modal(`<h2>هەموو بەشەکان</h2><div class="more">${(g => navItems().map(n => `${navItems().length > 8 && n[6] !== g && (g = n[6]) ? `<div class="mgh">${esc(g)}</div>` : ''}<button data-mv="${n[0]}" class="${S.view === n[0] ? 'on' : ''}">${ico(n[2], 22)}<span>${n[1]}</span></button>`).join(''))(null)}</div><div style="display:grid;gap:12px;margin-top:16px">${acctBox(true)}</div>`);
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { closeModal(); go(b.dataset.mv); }); bindAcct($('#sheet'));
}
function shell() {
  const pend = S.approvals.filter(a => a.status === 'wait').length, all = navItems(), phone = innerWidth <= 760;
  const main = phone && all.length > 5 ? all.filter(n => ['dash', 'pos', 'jard', 'perf'].includes(n[0])).slice(0, 4) : all;
  const heads = !phone && all.length > 8; let grp = null;   // a long menu is split into named groups so the rows never run into each other
  $('#nav').innerHTML = main.map(n => `${heads && n[6] !== grp && (grp = n[6]) ? `<div class="ngh">${esc(grp)}</div>` : ''}<a data-nav="${n[0]}" class="${S.view === n[0] ? 'on' : ''}">${ico(n[2], 19)}<span>${phone && n[4] ? n[4] : n[1]}</span>${n[0] === 'dash' && pend && isOwner() ? `<em class="num">${pend}</em>` : ''}</a>`).join('') + (phone ? `<a data-nav="__more" class="${main.some(n => n[0] === S.view) ? '' : 'on'}">${ico('dash', 19)}<span>زیاتر</span></a>` : '');
  $('#nav').querySelectorAll('a').forEach(a => a.onclick = () => a.dataset.nav === '__more' ? moreSheet() : go(a.dataset.nav));
  $('#whoAv').textContent = me().name[0].toUpperCase(); $('#whoName').textContent = me().name; $('#whoRole').textContent = me().label + (S.me !== S.session ? ' · بینین' : '');
  $('#acctBox').innerHTML = acctBox(); bindAcct($('#acctBox')); drawThBtn();
  $('#title').textContent = NAV.find(n => n[0] === S.view)[1];
  const seg = $('#branchSeg');
  if (lvl() > 1) {
    const opts = S.view === 'dash' ? [[-1, innerWidth < 760 ? 'هەموو' : 'هەموو لقەکان'], ...S.branches.map((b, i) => [i, b])] : S.branches.map((b, i) => [i, b]);
    const cur = S.view === 'dash' ? S.dashBranch : S.branch;
    seg.innerHTML = opts.map(o => `<button data-br="${o[0]}" class="${cur === o[0] ? 'on' : ''}">${esc(o[1])}</button>`).join('');
    seg.querySelectorAll('[data-br]').forEach(b => b.onclick = () => { const v = +b.dataset.br; if (S.view === 'dash') S.dashBranch = v; else { if (S.cart.lines.length && v !== S.branch) { toast('سەرەتا سەبەتەکە بەتاڵ بکە', 1); return; } S.branch = v; } render(true); });
  } else seg.innerHTML = `<button class="on">${esc(S.branches[S.branch])}</button>`;
  $('#rateChip').textContent = '100$ = ' + (S.rate * 100).toLocaleString('en-US') + ' د.ع'; $('#rateChip').classList.toggle('tap', lvl() > 1); $('#rateChip').onclick = lvl() > 1 ? rateSheet : null;
  drawBell();
  fitNav();
  const place = () => { const on = $('#nav a.on'), ind = $('#navInd'); if (on) ind.style.transform = `translateY(${on.offsetTop}px)`; };
  place(); requestAnimationFrame(place);
}
function fitNav() { // every entry stays in view: the rows take the height there is; only a very short window scrolls (with a visible bar)
  const nav = document.querySelector('.side nav'); if (!nav) return; const side = nav.parentElement;
  side.classList.remove('tight', 'scrolls'); nav.style.removeProperty('--nh'); if (innerWidth <= 760) return;
  const rows = nav.querySelectorAll('a').length, heads = nav.querySelectorAll('.ngh').length, room = nav.clientHeight; if (!rows || !room) return;
  let h = Math.floor((room - heads * 26 - (rows + heads - 1) * 2) / rows);
  if (h < 36) { side.classList.add('tight'); h = Math.floor((nav.clientHeight - heads * 9) / rows); }   // tight: thin dividers for the group names, a one-line account box
  if (h < 28) { h = 32; side.classList.add('scrolls'); }
  nav.style.setProperty('--nh', Math.min(46, h) + 'px');
  if (side.classList.contains('scrolls')) { const on = nav.querySelector('a.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }); } else nav.scrollTop = 0;
}
function rateSheet() { // «نرخی دۆلار»: the manager and the supervisor; every change is kept with its day and hour
  modal(`<h2>نرخی دۆلار</h2><p class="mute" style="margin:4px 0 14px">هەر کاتێک نرخی دۆلار گۆڕا، لێرە بینووسە. نرخی کاڵاکان بە دینار وەک خۆیان دەمێننەوە؛ تەنها دۆلارەکەیان بەم نرخە هەژمار دەکرێت.</p>
    <div class="row raterow"><b class="num" style="font-size:21px">100$ =</b><input class="inp num grow" id="rtV" type="text" inputmode="numeric" value="${(S.rate * 100).toLocaleString('en-US')}" style="font-size:21px;font-weight:800"><b>دینار</b></div>
    <div class="acts"><button class="btn volt" id="rtOk">هەڵگرتن</button><button class="ghost" id="rtNo">داخستن</button></div>
    <h2 style="font-size:16px;margin:16px 0 6px">گۆڕانکارییەکانی پێشوو</h2><div class="scroll" style="max-height:230px"><table class="wt">${(S.rates || []).slice(0, 60).map(r => `<tr><td class="num">${D8(r.t)}</td><td>${hm(r.t)}</td><td class="num"><b>100$ = ${Math.round(r.rate * 100).toLocaleString('en-US')}</b></td><td class="en">${esc(r.by || '')}</td></tr>`).join('')}</table></div>`);
  $('#rtNo').onclick = closeModal; $('#rtOk').onclick = () => run('setRate', { v: pn($('#rtV').value, true) }, () => { closeModal(); toast('نرخی دۆلار هەڵگیرا'); render(true); });
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
setInterval(() => { const c = $('#clock'); if (c) c.textContent = h12(new Date(), true); }, 1000);
document.addEventListener('mousemove', e => { const p = e.target.closest && e.target.closest('.prod'); if (!p) return; const r = p.getBoundingClientRect(); p.style.setProperty('--mx', (e.clientX - r.left) + 'px'); p.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
document.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); if (S.view !== 'pos') go('pos'); $('#q').focus(); } if (e.key === 'Escape') { $('#drawer').classList.remove('on'); closeModal(); } });

/* ---------- POS ---------- */
const V = {};
V.pos = () => {
  const cats = ['هەموو', ...new Set(S.items.map(i => i.cat))];
  $('#view').innerHTML = `<div class="pos"><div>
    <div class="search">${ico('search', 22)}<input class="inp" id="q" placeholder="بارکۆد سکان بکە یان ناوی کاڵا بنووسە…" autocomplete="off" value="${esc(S.q)}"><kbd><span class="scan"></span>F2</kbd></div>
    <div class="chips">${cats.map(c => `<button class="chip ic ${S.cat === c ? 'on' : ''}" data-c="${esc(c)}">${ico(catIcon(c), 17)}<span>${esc(c)}</span></button>`).join('')}</div>
    <div class="grid" id="grid"></div></div>
    <div class="card cart" id="cart"></div></div><button class="cartbar" id="cartbar"></button>`;
  $('#cartbar').onclick = () => { $('#cart').classList.add('open'); lockPage(true); };
  const q = $('#q');
  q.oninput = () => { S.q = q.value; $('#view').classList.remove('enter'); drawGrid(); };
  q.onkeydown = e => { if (e.key === 'Enter' && S.q.trim()) onScan(S.q); };
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => { S.cat = c.dataset.c; V.pos(); });
  drawGrid(); drawCart(); autoFocus(q);
};
/* ---------- stock ring (manager only): how much of an item is left, measured against how many there were after its last delivery ----------
   The «full» mark is rebuilt from the records: walking back from today through sales, returns, swaps and gifts until the last delivery,
   the highest level on that way is what «full» meant for this item. Green = plenty, yellow = half gone, red = almost or fully finished. */
function stockRefs() {
  const tot = i => i.s.reduce((a, n) => a + Math.max(0, n), 0);
  const key = [S.sales.length, S.purchases.length, S.exchanges.length, (S.gifts || []).length, S.items.length, S.items.reduce((a, i) => a + tot(i), 0), S.sales.reduce((a, s) => a + (s.rets || []).length, 0)].join('/');
  if (stockRefs.k === key) return stockRefs.m;
  const ev = new Map(), add = (id, t, d, stop) => { if (!ev.has(id)) ev.set(id, []); ev.get(id).push({ t: Core.ms(t), d, stop }); };
  S.sales.forEach(s => { s.lines.forEach(l => add(l.id, s.t, -l.qty)); (s.rets || []).forEach(r => { if (!r.faulty) (r.items || []).forEach(x => add(x.id, r.t, x.qty)); }); });
  S.exchanges.forEach(x => add(x.id, x.t, -x.qty));
  (S.gifts || []).forEach(x => add(x.item, x.t, -x.qty));
  S.purchases.forEach(x => add(x.id, x.t, x.qty, true));
  const m = new Map();
  S.items.forEach(i => { let lv = tot(i), ref = lv; const e = (ev.get(i.id) || []).sort((a, b) => b.t - a.t);
    for (const x of e) { if (x.stop) { ref = Math.max(ref, lv); break; } lv -= x.d; ref = Math.max(ref, lv); }
    m.set(i.id, { n: tot(i), ref: Math.max(1, ref) }); });
  stockRefs.k = key; stockRefs.m = m; return m;
}
function stockRing(it, inner, size) { // the item's photo sits inside a ring that empties as the stock runs out (manager only)
  if (!isOwner()) return inner;
  const r = stockRefs().get(it.id); if (!r) return inner;
  const f = Math.max(0, Math.min(1, r.n / r.ref)), pc = Math.round(f * 100), lv = r.n <= 0 ? 'z' : f <= .2 || r.n <= 5 ? 'r' : f <= .5 ? 'y' : 'g';
  const R = 18, C = 2 * Math.PI * R, word = { g: 'زۆر ماوە', y: 'نزیکەی نیوەی ماوە', r: 'خەریکە تەواو دەبێت', z: 'نەماوە' }[lv];
  return `<span class="sring s${lv}" style="--rs:${size}px" data-pc="${pc}" title="${word}: ${r.n.toLocaleString('en-US')} لە ${r.ref.toLocaleString('en-US')} دانە ماوە (لە دوای دوایین داخیلکردن)"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="rt" cx="20" cy="20" r="${R}"/><circle class="ra" cx="20" cy="20" r="${R}" stroke-dasharray="${(C * f).toFixed(2)} ${C.toFixed(2)}"/></svg>${inner}<b class="num">${pc}%</b></span>`;
}
function drawGrid() { // the product list as ONE piece: a row per item with every detail (the look he chose, «C»)
  const t = S.q.trim().toLowerCase(), b = S.branch, mv = moves(b);
  const list = S.items.filter(i => (S.cat === 'هەموو' || i.cat === S.cat) && (!t || i.name.toLowerCase().includes(t) || i.bc.includes(t)));
  const G = $('#grid'); G.className = 'grid alt'; G.parentElement.classList.add('one');
  G.innerHTML = list.length ? `<div class="gr">${list.map(i => {
    const st = i.s[b], p = priceOf(i), bad = st <= 0 || p <= 0, ic = catIcon(i.cat), tot = i.s.reduce((a, n) => a + Math.max(0, n), 0), lv = st <= 0 ? 'z' : st <= 5 ? 'l' : 'k';
    const din = p > 0 ? DIN(Core.dueDinar(S, [{ id: i.id, qty: 1 }], S.cart.type, 0)) : '';
    return `<button class="prod gi s-${lv} ${bad ? 'out' : ''}" data-id="${i.id}">${stockRing(i, thumb(i, 28), 68)}
      <span class="gm"><b class="en nm">${esc(i.name)}</b><span class="num gbc bc">${esc(i.bc) || '— بێ بارکۆد'}</span>
        <small><span class="tag n">${esc(i.cat)}</span><span class="gtot">کۆ <b class="num">${tot.toLocaleString('en-US')}</b> دانە</span>${st <= 0 ? `<span class="tag r">${tot > 0 ? 'لەم لقە نەماوە' : 'نەماوە'}</span>` : st <= 5 ? `<span class="tag a">لەم لقە تەنها <span class="num">${st}</span> دانە</span>` : ''}</small></span>
      <span class="gp pr">${p > 0 ? `${money(p)}<small class="num">${S.cur === 'IQD' ? USD(p) : din}</small>` : '<span class="tag r">نرخی نییە</span>'}</span><span class="gadd">+</span></button>`;
  }).join('')}</div>` : `<div class="empty"><b>هیچ کاڵایەک نەدۆزرایەوە</b>ناو یان بارکۆدێکی تر تاقی بکەوە</div>`;
  document.querySelectorAll('#grid .prod').forEach(x => x.onclick = () => addLine(+x.dataset.id, 1, x));
}
/* ---------- barcode scanner: works on every screen, no click on the search box needed ----------
   A scanner is a very fast keyboard that ends with Enter. The physical key is read (not the letter), so a Kurdish or
   Arabic keyboard layout cannot garble the code. */
const SCAN_BOX = '#q,#rNo,#wrNo,#wSn,#soBc,#gfQ,#iQ,#csQ,#slQ,#vBc,#nBc,#bBc,#jQ,#myQ';                 // boxes that are meant to be scanned into
const slipCode = no => '77' + String(no).padStart(6, '0');     // the code printed as a barcode on every receipt
const slipNo = v => { const m = /^77(\d{6,9})$/.exec(latin(v == null ? '' : v).trim()); return m && (S.sales.some(x => x.no === +m[1]) || (S.arch && archMonths().some(k => +m[1] >= S.arch.months[k].a && +m[1] <= S.arch.months[k].z))) ? +m[1] : v; };
function openBought(sale, sn) { // a slip or a serial was scanned: straight to «گەڕاوە و زەمان» with that purchase (the seller only sees the receipt)
  if (S.view === 'returns') return V.returns(sale.no);
  if (lvl() < 2) return receipt(sale);
  warNo = sale.no; warSn = sn || ''; if (S.view !== 'warranty') go('warranty'); else V.warranty();
  if (sn) toast('سریاڵ ' + sn + ' — پسولەی #' + sale.no);
}
function onScan(raw) {
  const code = latin(raw).trim(); if (!code || !S.me) return;
  if (/^https?[:;]|github|ghazigharebb|lovable/i.test(code)) return toast('ئەمە کۆدی سەر وەسڵە بۆ کڕیار (واتسئاپ و ناونیشان)؛ بە مۆبایل سکان دەکرێت', 1);   // the customer's QR code read by the shop scanner
  let hit = S.items.filter(i => i.bc && i.bc === code);
  if (!hit.length) hit = S.items.filter(i => i.bc && i.bc.toLowerCase() === code.toLowerCase());
  const no = !hit.length && slipNo(code), sale = typeof no === 'number' && S.sales.find(x => x.no === no);
  if (typeof no === 'number' && !sale && archSeek(String(no), () => onScan(code))) return;      // an archived receipt: fetched, then opened
  if (sale) return openBought(sale);                                                             // a receipt's own barcode opens that purchase                    // a receipt's own barcode opens that receipt
  if (S.view === 'jard' && $('#jQ')) { const j = $('#jQ'); j.value = code; j.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (!hit.length) {
    const sn = Core.cleanSn(code), c = S.cart, armed = c.snFor != null && c.lines.find(l => l.id === c.snFor && (l.sn || []).length < l.qty);
    // a product barcode is digits only, so a code with letters can only be a serial; a digits-only serial needs the «سریاڵ» button first (an unknown product must never vanish into a serial)
    const open = S.view === 'pos' && Core.SN_OK(sn) && (armed || (/[A-Z]/.test(sn) && [...c.lines].reverse().find(l => (l.sn || []).length < l.qty)));
    if (open) { c.snFor = null;
      if (c.lines.some(l => (l.sn || []).includes(sn))) return toast('ئەم سریاڵە پێشتر لەم سەبەتەیەدایە', 1);
      (open.sn || (open.sn = [])).push(sn); drawCart(); const q = $('#q'); if (q) { S.q = q.value = ''; drawGrid(); }
      return toast('سریاڵ تۆمار کرا بۆ ' + item(open.id).name);
    }
    const own = S.sales.find(s => s.lines.some(l => (l.sn || []).includes(sn)));
    if (own) return openBought(own, sn);                                                          // the serial of a sold piece opens its purchase
    if (archSeek(code, () => onScan(code))) return;                                                // …or it was sold long ago: ask the archive, then try once more
    return toast('هیچ کاڵایەک بەم بارکۆدە نییە: ' + code, 1);
  }
  if (S.view !== 'pos') go('pos');
  const q = $('#q');
  if (hit.length > 1) { S.q = q.value = code; drawGrid(); return toast('ئەم بارکۆدە بۆ ' + hit.length + ' کاڵا بەکارهاتووە، یەکێکیان هەڵبژێرە', 1); }
  S.q = q.value = ''; drawGrid(); addLine(hit[0].id);
}
const scan = { buf: '', t0: 0, last: 0, el: null, val: '' };
const scanKey = e => {
  const c = e.code || '';
  if (/^Digit\d$/.test(c) && !e.shiftKey) return c[5];
  if (/^Numpad\d$/.test(c)) return c[6];
  if (/^Key[A-Z]$/.test(c)) return e.shiftKey !== !!(e.getModifierState && e.getModifierState('CapsLock')) ? c[3] : c[3].toLowerCase();
  if (c === 'Minus') return e.shiftKey ? '_' : '-';
  if (c === 'Period' || c === 'NumpadDecimal') return '.';
  return e.key && e.key.length === 1 ? latin(e.key) : '';
};
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || net.busy) return;
  const now = performance.now(), s = scan, el = document.activeElement, box = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? el : null;
  if (e.key !== 'Enter') {
    const ch = scanKey(e); if (!ch || /\s/.test(ch)) return;
    if (!s.buf || now - s.last > 90) { s.buf = ''; s.t0 = now; s.el = box; s.val = box && 'value' in box ? box.value : ''; }
    s.buf += ch; s.last = now; return;
  }
  const code = s.buf, n = code.length, fast = n >= 3 && now - s.last < 150 && (s.last - s.t0) / n < 50; s.buf = '';
  if (!fast || !S.me || $('#login').classList.contains('on')) return;                                  // a person typing, not a scanner
  if (box && box.matches(SCAN_BOX)) { if (box.value !== code) { box.value = code; box.dispatchEvent(new Event('input', { bubbles: true })); } return; } // its own Enter goes on, with the clean code
  if ($('#modal').classList.contains('on') || $('#drawer').classList.contains('on') || $('#charge').classList.contains('on')) return;   // a form is open: never sell behind it
  if (box && S.view !== 'pos') return;                                                                 // typing in a form on another screen
  e.preventDefault(); e.stopPropagation();
  if (box && s.el === box && 'value' in box && box.type !== 'checkbox') { box.value = s.val; box.dispatchEvent(new Event('input', { bubbles: true })); }
  onScan(code);
}, true);
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
  if (!l) c.lines.push({ id, qty: 1 }); else { l.qty = want; if (l.sn && l.sn.length > want) l.sn.length = Math.max(0, want); if (l.qty <= 0) c.lines = c.lines.filter(x => x !== l); }
  drawCart(); if (d > 0) fly(from, fmtMoney(p));
}
const cartDinar = () => { const c = S.cart, sub = subTotal(); return Core.dueDinar(S, c.lines, c.type, Math.min(c.disc, sub)); };   // fixed dinar prices add up exactly; anything else is the dollars at today's rate
const linePrice = l => l.price != null ? l.price : priceOf(item(l.id));   // l.price = the manager's price for this one sale
const subTotal = () => S.cart.lines.reduce((a, l) => a + l.qty * linePrice(l), 0);
function drawCart() {
  const c = S.cart, sub = subTotal(), req = c.req && S.approvals.find(a => a.id === c.req);
  if (req && req.status === 'ok') c.disc = req.amt;
  if (req && req.status === 'no') { c.req = null; c.disc = 0; }
  const disc = Math.min(c.disc, sub), total = sub - disc, waiting = req && req.status === 'wait';
  if (c.type === 'online') c.pay = 'debt';   // online orders are on credit to the platform
  const needCust = c.type === 'wholesale' || c.type === 'online', plats = S.customers.filter(x => x.plat);   // retail and delivery: a phone and a name, never a list (a sale on debt makes the customer from them)
  const cq = latin(c.custQ || '').trim().toLowerCase(), cands = S.customers.filter(x => !x.plat && (!cq || x.name.toLowerCase().includes(cq) || (x.phone || '').includes(cq) || Core.cleanPhone(x.phone || '').includes(cq)));
  $('#cart').innerHTML = `<div class="cart-h"><div class="row sp"><h2>سەبەتە</h2><div class="row"><span class="tag n cart-count"><span class="num">${c.lines.reduce((a, l) => a + l.qty, 0)}</span> دانە</span><button class="ghost sm mclose" id="cartX">داخستن</button></div></div>
      <div class="seg" style="margin-top:12px">${Object.entries(TYPES).map(([k, v]) => `<button data-t="${k}" class="grow ${c.type === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${c.type === 'online' ? `<div class="plats">${plats.map(x => `<button data-pl="${x.id}" class="${c.customer === x.id ? 'on' : ''}">${esc(x.name)}</button>`).join('') || '<span class="mute">هیچ شوێنێکی ئۆنلاین تۆمار نەکراوە</span>'}</div><p class="mute plnote">بە قەرز لەسەر ئەو شوێنە تۆمار دەکرێت</p>`
        : needCust ? `<div class="custfind">${ico('search', 17)}<input class="inp" id="custQ" placeholder="گەڕان بە ناو یان ژمارەی مۆبایل…" autocomplete="off" value="${esc(c.custQ || '')}"></div><div class="row custrow"><select class="inp grow" id="cust"><option value="">${cq ? `— ${cands.length} کڕیار دۆزرایەوە —` : '— کڕیار هەڵبژێرە —'}</option>${cands.concat(c.customer && !cands.some(x => x.id === c.customer) && cust(c.customer) && !cust(c.customer).plat ? [cust(c.customer)] : []).map(x => `<option value="${x.id}" ${c.customer === x.id ? 'selected' : ''}>${esc(x.name)}${x.phone ? ' · ' + esc(x.phone) : ''}</option>`).join('')}</select><button class="ghost sm" id="custNew" title="کڕیاری نوێ بە ناو و ژمارە">+ نوێ</button></div>` : ''}</div>
    <div class="cart-lines">${c.lines.map(l => { const it = item(l.id), p = linePrice(l), lp = priceOf(it), sp = p !== lp; return `<div class="line ${S.lastAdd === l.id ? 'new' : ''}"><div class="nm lnm">${thumb(it, 16, 'sm')}<span>${esc(it.name)}</span></div><b>${money(l.qty * p)}</b><div class="qty"><button data-m="${l.id}">−</button><b class="num">${l.qty}</b><button data-p="${l.id}">+</button>${isOwner() ? `<button class="lp ${sp ? 'on' : ''}" data-lp="${l.id}" title="گۆڕینی نرخی ئەم فرۆشتنە">× ${money(p)}${sp ? `<s>${money(lp)}</s>` : ''}${ico('edit', 13)}</button>` : `<small class="mute">× ${money(p)}</small>`}</div><button class="rm" data-x="${l.id}" title="لابردن" aria-label="لابردن">${ico('trash', 17)}</button><div class="lx"><button class="wchip ${l.used ? 'used' : ''} ${l.w != null && l.w !== Core.W_DEF ? 'set' : ''}" data-wl="${l.id}" title="نوێ یان گەڕاوە، و ماوەی زەمان">${ico('shield', 14)}<span>${l.used ? 'گەڕاوە' : 'نوێ'} · ${Core.wTxt(Core.lineW(l))}</span></button>${(l.sn || []).map((n, k) => `<button class="snchip" data-sn="${l.id}:${k}" title="لابردنی ئەم سریاڵە"><span class="num">S/N ${esc(n)}</span><i>×</i></button>`).join('')}${(l.sn || []).length < l.qty ? `<button class="snadd ${c.snFor === l.id ? 'on' : ''}" data-sa="${l.id}">${c.snFor === l.id ? 'ئێستا سریاڵی سەر کاڵاکە سکان بکە…' : '+ سریاڵ'}</button>` : ''}</div></div>`; }).join('') || `<div class="empty"><b>سەبەتەکە بەتاڵە</b>کاڵایەک سکان بکە یان لەسەری دابگرە</div>`}</div>
    <div class="cart-f">
      ${disc || waiting ? `<div class="row sp"><span>کۆی پێش داشکاندن</span>${money(sub)}</div><div class="row sp"><span>داشکاندن ${waiting ? '<span class="tag a">چاوەڕوانی ڕەزامەندیی بەڕێوەبەر</span>' : '<span class="tag g">ڕەزامەندی دراوە</span>'}</span><span>− ${money(waiting ? req.amt : disc)}</span></div>` : ''}
      <div class="tot"><span>کۆی گشتی</span><b class="num" id="totB">${fmtMoney(total)}</b></div>
      ${c.lines.length ? `<div class="tot2"><span>${S.cur === 'IQD' ? 'بە دۆلار' : 'بە دینار'}</span><b class="num" id="totO">${S.cur === 'IQD' ? USD(total) : DIN(cartDinar())}</b></div>` : ''}
      <div class="pay" ${c.type === 'online' ? 'hidden' : ''}>${Object.keys(PAY).map(k => `<button data-pay="${k}" class="${c.pay === k ? 'on' : ''}">${PAY[k][1]}</button>`).join('')}</div>
      ${c.pay === 'fib' ? `<div class="fibbox"><input class="inp num" id="fibRef" placeholder="ژمارەی مامەڵەی FIB (پێویستە)" value="${esc(c.fibRef)}" autocomplete="off"><label class="chk"><input type="checkbox" id="fibOk" ${c.fibOk ? 'checked' : ''}><span>پارەکەم لە ئەپی FIB بینی و گەیشتووە</span></label></div>` : ''}
      ${needCust ? '' : `<div class="row buyer"><input class="inp num grow" id="byPh" type="tel" inputmode="tel" autocomplete="off" placeholder="مۆبایلی کڕیار (ژمارە)" value="${esc(c.phone || '')}"><input class="inp grow" id="byNm" autocomplete="off" placeholder="ناوی کڕیار" value="${esc(c.buyer || '')}"></div>${c.pay === 'debt' ? '<p class="mute debtnote">بۆ قەرز ناو و ژمارەی مۆبایلی کڕیار بنووسە؛ خۆی دەچێتە «جوملە و قەرز».</p>' : ''}`}
      <div class="row acts2">${isOwner() ? `<button class="ghost grow" id="discBtn" ${!c.lines.length || waiting ? 'disabled' : ''}>داشکاندن</button>` : ''}<button class="ghost ${isOwner() ? '' : 'grow'}" id="clearBtn" ${!c.lines.length ? 'disabled' : ''}>بەتاڵکردن</button></div>
      <button class="btn volt big" id="sellBtn" ${!c.lines.length || waiting ? 'disabled' : ''}>${waiting ? 'چاوەڕوانی ڕەزامەندی…' : 'فرۆشتن'}</button></div>`;
  { const nl = $('#cart .line.new'), box = $('#cart .cart-lines'); if (nl && box && box.scrollHeight > box.clientHeight + 2) box.scrollTop = Math.max(0, nl.offsetTop - box.offsetTop - 6); }   // the line just added is brought into view
  const C = $('#cart'), tb = $('#totB'), prev = S.prevTotal || 0; S.lastAdd = null;
  if (prev !== total) { countUp(tb, total, 'money', prev, 420); if (MO()) tb.classList.add('flash'); } S.prevTotal = total;
  $('#cartX').onclick = () => { C.classList.remove('open'); lockPage(false); };
  const n = c.lines.reduce((a, l) => a + l.qty, 0); $('#cartbar').innerHTML = `<span>سەبەتە · <span class="num">${n}</span> دانە</span><b class="num">${fmtMoney(total)}</b>`; $('#cartbar').style.display = n ? '' : 'none';
  C.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (c.type === b.dataset.t) return; voidReq(); c.type = b.dataset.t; c.lines.forEach(l => delete l.price); const bad = c.lines.filter(l => priceOf(item(l.id)) <= 0); if (bad.length) { c.lines = c.lines.filter(l => !bad.includes(l)); toast('کاڵای بێ نرخی ' + TYPES[c.type] + ' لابرا', 1); } drawGrid(); drawCart(); });
  C.querySelectorAll('[data-p]').forEach(b => b.onclick = () => addLine(+b.dataset.p, 1));
  C.querySelectorAll('[data-m]').forEach(b => b.onclick = () => addLine(+b.dataset.m, -1));
  C.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { voidReq(); c.lines = c.lines.filter(l => l.id !== +b.dataset.x); drawCart(); });
  C.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { c.pay = b.dataset.pay; if (c.pay !== 'fib') { c.fibOk = false; c.fibRef = ''; } drawCart(); });
  if ($('#fibRef')) { $('#fibRef').oninput = e => c.fibRef = e.target.value.trim(); $('#fibOk').onchange = e => c.fibOk = e.target.checked; }
  if ($('#cust')) $('#cust').onchange = e => c.customer = +e.target.value || null;
  C.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { c.customer = +b.dataset.pl; drawCart(); });
  if ($('#custQ')) $('#custQ').oninput = e => { c.custQ = e.target.value; const q = latin(c.custQ).trim().toLowerCase(), m = S.customers.filter(x => !x.plat && q && (x.name.toLowerCase().includes(q) || (x.phone || '').includes(q) || Core.cleanPhone(x.phone || '').includes(q)));
    if (m.length === 1) c.customer = m[0].id; drawCart(); const n = $('#custQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
  if ($('#custNew')) $('#custNew').onclick = () => { modal(`<h2>کڕیاری نوێ</h2><label class="f">ناو<input class="inp" id="kN" autocomplete="off"></label><label class="f">مۆبایل<input class="inp num" id="kP" type="tel" inputmode="tel" autocomplete="off"></label><label class="f">ناونیشان<input class="inp" id="kA" autocomplete="off" placeholder="بۆ نموونە: هەولێر — شەقامی 60م"></label><div class="acts"><button class="btn" id="kOk">دروستکردن و هەڵبژاردن</button><button class="ghost" id="kNo">پاشگەزبوونەوە</button></div>`);
    $('#kNo').onclick = closeModal; $('#kOk').onclick = () => run('newCustomer', { name: $('#kN').value.trim(), phone: $('#kP').value.trim(), addr: $('#kA').value.trim() }, r => { closeModal(); c.customer = r.id; drawCart(); toast('کڕیار تۆمار کرا و هەڵبژێردرا'); }); };
  if ($('#byPh')) { $('#byPh').oninput = e => { c.phone = e.target.value.trim(); const k = buyerOf(c.phone); if (k && !c.buyer) { c.buyer = k; $('#byNm').value = k; } }; $('#byNm').oninput = e => c.buyer = e.target.value.trim(); }
  $('#clearBtn').onclick = () => { voidReq(); S.cart = newCart(); drawGrid(); drawCart(); };
  if ($('#discBtn')) $('#discBtn').onclick = () => askDiscount(sub);
  C.querySelectorAll('[data-sa]').forEach(b => b.onclick = () => { c.snFor = c.snFor === +b.dataset.sa ? null : +b.dataset.sa; drawCart(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  C.querySelectorAll('[data-sn]').forEach(b => b.onclick = () => { const [id, k] = b.dataset.sn.split(':'), l = c.lines.find(x => x.id === +id); if (l && l.sn) { l.sn.splice(+k, 1); drawCart(); } });
  C.querySelectorAll('[data-wl]').forEach(b => b.onclick = () => askWarranty(c.lines.find(l => l.id === +b.dataset.wl)));
  C.querySelectorAll('[data-lp]').forEach(b => b.onclick = () => askLinePrice(c.lines.find(l => l.id === +b.dataset.lp)));
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
function askLinePrice(l) { // the manager may sell one line at any price, down to 0 (a gift); the item's own price is not touched
  if (!l || !isOwner()) return;
  const it = item(l.id), lp = priceOf(it);
  modal(`<h2>نرخی ئەم فرۆشتنە</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:4px">${esc(it.name)}</p>
    <p class="mute" style="margin-bottom:12px">تەنها بۆ ئەم سەبەتەیە. نرخی ئاسایی کاڵاکە (${money(lp)}) وەک خۆی دەمێنێتەوە. سفر واتە بێ بەرامبەر.</p>
    <label class="f">نرخی یەک دانە ${CUR()}<input class="inp num" id="lpA" type="text" inputmode="decimal" autocomplete="off" value="${amtOut(linePrice(l))}"></label>
    <div class="acts" style="flex-wrap:wrap"><button class="btn" id="lpOk">جێبەجێکردن</button><button class="ghost" id="lpZero">بێ بەرامبەر (0)</button><button class="ghost" id="lpBack">نرخی ئاسایی</button></div>`);
  const set = v => { if (!Number.isFinite(v) || v < 0) return toast('نرخێکی دروست بنووسە', 1); voidReq(); if (v === lp) delete l.price; else l.price = v; closeModal(); drawCart(); };
  const a = $('#lpA'); if (DESK()) a.select();
  a.onkeydown = e => { if (e.key === 'Enter') $('#lpOk').click(); };
  $('#lpOk').onclick = () => set(a.value.trim() === '' ? NaN : toC(a.value)); $('#lpZero').onclick = () => set(0); $('#lpBack').onclick = () => set(lp);
}
/* every sold piece: new or «گەڕاوە» (a unit a customer brought back, sold again), and how many months of warranty it leaves with */
function askWarranty(l) {
  if (!l) return;
  const it = item(l.id), MS = [0, 1, 2, 3, 6, 12, 18, 24]; let used = !!l.used, w = Core.lineW(l);
  modal(`<h2>جۆر و زەمانی کاڵا</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:12px">${esc(it.name)}</p>
    <div class="fl">ئەم دانەیە</div><div class="seg wseg"><button data-wu="0" class="grow">نوێ</button><button data-wu="1" class="grow">گەڕاوە</button></div>
    <p class="mute" style="margin:8px 0 16px;font-size:14px">«گەڕاوە» واتە دانەیەک کە پێشتر کڕیارێک هێناویەتیەوە و ئێستا دووبارە دەفرۆشرێتەوە.</p>
    <div class="fl">ماوەی زەمان</div><div class="wms">${MS.map(m => `<button data-wm="${m}">${m ? `<span class="num">${m}</span> مانگ` : 'بێ زەمان'}</button>`).join('')}</div>
    <label class="f" style="margin-top:12px"><span>یان ژمارەی مانگ بنووسە (0 تا <span class="num">${Core.W_MAX}</span>)</span><input class="inp num" id="wmA" type="text" inputmode="numeric" autocomplete="off"></label>
    <div class="gsum" id="wEnd"></div>
    <div class="acts"><button class="btn" id="wmOk">جێبەجێکردن</button><button class="ghost" id="wmNo">پاشگەزبوونەوە</button></div>`);
  const a = $('#wmA'), ok = () => Number.isInteger(w) && w >= 0 && w <= Core.W_MAX;
  const show = () => {
    document.querySelectorAll('[data-wu]').forEach(b => b.classList.toggle('on', (b.dataset.wu === '1') === used));
    document.querySelectorAll('[data-wm]').forEach(b => b.classList.toggle('on', +b.dataset.wm === w && a.value.trim() === ''));
    $('#wmOk').disabled = !ok();
    $('#wEnd').innerHTML = !ok() ? '<span>ژمارەیەکی دروست بنووسە</span>' : !w ? '<span>بێ زەمان دەفرۆشرێت</span><span class="tag n">بێ زەمان</span>' : `<span>ئەگەر ئەمڕۆ بفرۆشرێت، زەمانەکەی تا</span><b class="num">${D8(Core.warrantyEnd({ t: new Date() }, { w }))}</b>`;
  };
  if (!MS.includes(w)) a.value = w;
  document.querySelectorAll('[data-wu]').forEach(b => b.onclick = () => { used = b.dataset.wu === '1'; show(); });
  document.querySelectorAll('[data-wm]').forEach(b => b.onclick = () => { w = +b.dataset.wm; a.value = ''; show(); });
  a.oninput = () => { const v = a.value.trim(); if (v !== '') w = /^\d+$/.test(latin(v)) ? +latin(v) : NaN; show(); };
  a.onkeydown = e => { if (e.key === 'Enter') $('#wmOk').click(); };
  $('#wmNo').onclick = closeModal;
  $('#wmOk').onclick = () => { if (!ok()) return; if (w === Core.W_DEF) delete l.w; else l.w = w; if (used) l.used = true; else delete l.used; closeModal(); drawCart(); };
  show(); if (a === document.activeElement && !a.value) a.blur();
}
/* the name last used with a phone number (so it need not be typed twice) */
const buyerOf = ph => { const k = Core.cleanPhone(ph); if (k.length < 7) return ''; const s = S.sales.find(x => x.phone === k && x.buyer), cu = S.customers.find(x => Core.cleanPhone(x.phone) === k); return s ? s.buyer : cu ? cu.name : ''; };
const canUndo = s => s && !s.legacy && Date.now() - Core.ms(s.t) <= Core.UNDO_MS && (lvl() > 1 || s.by === S.me) && !s.refunded && !s.swapOf && !(s.rets || []).length && !s.lines.some(l => l.ret || l.exch);
function undoSale(s) { // «پەشیمانبوونەوە»: for 10 minutes the sale can be taken back whole; the pieces go back into the basket to change and sell again
  const left = Math.max(1, Math.ceil((Core.UNDO_MS - (Date.now() - Core.ms(s.t))) / 60000));
  modal(`<h2>پەشیمانبوونەوە لە فرۆشتن</h2><p class="mute" style="margin-bottom:12px">پسولەی <span class="num">#${s.no}</span> (${money(s.total)}) هەڵدەوەشێتەوە: کاڵاکان دەگەڕێنەوە کۆگا${s.pay === 'cash' ? ' و پارەکە بدەرەوە بە کڕیار' : s.pay === 'debt' ? ' و قەرزەکە لادەچێت' : ' و پارەی FIB دەبێت بگەڕێنرێتەوە'}. کاڵاکان دەچنەوە سەبەتە بۆ ئەوەی ئەگەر ویستت بیگۆڕیت و دووبارە بیفرۆشیت. <b><span class="num">${left}</span> خولەکی ماوە.</b></p>
    <label class="f">هۆکار (ئارەزوومەندانە)<input class="inp" id="udW" maxlength="200" placeholder="بۆ نموونە: کڕیار پەشیمان بووەوە" autocomplete="off"></label>
    <div class="acts"><button class="btn red" id="udOk">هەڵوەشاندنەوەی فرۆشتن</button><button class="ghost" id="udNo">نەخێر</button></div>`);
  $('#udNo').onclick = () => receipt(s);
  $('#udOk').onclick = () => run('undoSale', { no: s.no, why: $('#udW').value.trim() }, () => {
    closeModal(); toast('فرۆشتنەکە هەڵوەشایەوە؛ کاڵاکان لە سەبەتەدان');
    if (!S.cart.lines.length) { S.cart = newCart(); S.cart.type = s.type; S.cart.pay = s.pay; S.cart.customer = s.customer; S.cart.phone = s.phone || ''; S.cart.buyer = s.buyer || ''; S.cart.lines = s.lines.filter(l => item(l.id)).map(l => { const o = { id: l.id, qty: l.qty }; if (l.w != null && l.w !== Core.W_DEF) o.w = l.w; if (l.used) o.used = true; if (l.sn) o.sn = l.sn.slice(); return o; }); }
    go('pos');
  });
}
function sell(needCust) {
  const c = S.cart; if (!c.lines.length) return;
  const sub = subTotal(), total = sub - Math.min(c.disc, sub);
  const send = (got, tend) => run('sell', { type: c.type, pay: c.pay, fibRef: c.fibRef, fibOk: c.fibOk, customer: c.customer, lines: c.lines.map(l => { const o = { id: l.id, qty: l.qty }; if (l.price != null) o.price = l.price; if (l.w != null) o.w = l.w; if (l.used) o.used = true; if (l.sn && l.sn.length) o.sn = l.sn; return o; }), disc: c.req ? 0 : c.disc, req: c.req, got, tend, phone: needCust ? '' : c.phone, buyer: needCust ? '' : c.buyer }, r => {
    const sale = S.sales.find(s => s.no === r.no);
    closeModal(); S.cart = newCart(); S.q = ''; S.prevTotal = 0; render(); charge(sale, () => receipt(sale));
  });
  if (!needCust && c.pay === 'debt') { const ph = Core.cleanPhone(c.phone || ''), nm = (c.buyer || '').trim();
    if (!nm || ph.length < 7) return toast('بۆ فرۆشتن بە قەرز ناو و ژمارەی مۆبایلی کڕیار بنووسە', 1);
    const old = S.customers.find(x => !x.plat && Core.cleanPhone(x.phone || '') === ph);
    if (old) { c.customer = old.id; return send(); }
    return run('newCustomer', { name: nm, phone: ph, addr: '' }, r => { c.customer = r.id; send(); }); }
  if (needCust && !c.customer) return toast(c.type === 'online' ? 'شوێنی ئۆنلاین هەڵبژێرە (ئایبازار، لەزوو، تەڵەبات…)' : 'بۆ ' + TYPES[c.type] + ' دەبێت کڕیار هەڵبژێریت', 1);
  if (c.pay !== 'cash') return send();

  if (total <= 0) return send({ usd: 0, iqd: 0 });
  takeCash(total, send, cartDinar());
}
/* cash: the seller only says HOW it was paid. The amounts are the system's: the price in dollars, or its dinar to the nearest 250.
   The few dinars that rounding leaves over or short are kept with the seller's name for the manager. */
function takeCash(total, send, dn) {
  if (dn == null) dn = payDinar(total);
  const D = S.cur === 'IQD';   // the shop's own currency leads in the big number; the till itself is counted in dinar unless only dollars were handed over
  const fD = `<label class="cbox cd"><span class="cic">د.ع</span><span class="cin"><small>دینار</small><input class="num" id="cD" type="text" inputmode="numeric" autocomplete="off" placeholder="0"></span></label>`;
  const fU = `<label class="cbox cu"><span class="cic">$</span><span class="cin"><small>دۆلار</small><input class="num" id="cU" type="text" inputmode="decimal" autocomplete="off" placeholder="0"></span></label>`;
  modal(`<h2>پارە وەرگرتن</h2>
    <div class="due"><small>کۆی گشتی</small><b class="num">${D ? DIN(dn) : USD(total)}</b><span class="num">${D ? USD(total) : DIN(dn)}</span></div>
    <div class="calc2"><div class="chead"><span class="chi">${ico('calc', 20)}</span><div><b>حاسیبەی باقی</b><small>کڕیار چەندی پێدایت؟ بینووسە، باقییەکەی خۆی دەردەچێت</small></div></div>
      <div class="cboxes">${fD}${fU}</div><div id="cOut" class="cout"><span class="mute">هیچ نەنووسراوە — پێویست نییە، تەنها بۆ حیسابی باقییە</span></div></div>
    <div class="cway" id="cWay"></div>
    <div class="acts"><button class="btn volt big" id="gOk">${ico('check', 20)}وەرگیرا — فرۆشتن</button><button class="ghost" id="gNo">پاشگەزبوونەوە</button></div>`);
  const G = { usd: { usd: total, iqd: 0 }, iqd: { usd: 0, iqd: dn } };
  const given = () => { const u = pn($('#cU').value), d = pn($('#cD').value, true), o = { usd: u > 0 ? Math.round(u * 100) : 0, iqd: d > 0 ? Math.round(d) : 0 }; return o.usd || o.iqd ? o : undefined; };
  const how = () => { const g = given(); return window.__payCur || (g && g.usd && !g.iqd ? 'usd' : 'iqd'); };   // dollars alone: dollars; anything else (or nothing typed): dinar, the money this shop's tills hold
  const way = () => { const k = how(); $('#cWay').innerHTML = `<span class="cwi ${k}">${k === 'usd' ? '$' : 'د.ع'}</span><span>لە دەخیل وەک <b>${k === 'usd' ? 'دۆلار' : 'دینار'}</b> تۆمار دەکرێت: <b class="num">${k === 'usd' ? USD(total) : DIN(dn)}</b></span>`; };
  $('#gOk').onclick = () => { const tnd = given(), k = how(); closeModal(); send(G[k], tnd); };
  $('#gNo').onclick = closeModal;
  const r250 = x => Math.round(x / 250) * 250;
  const calc = () => { const u = pn($('#cU').value), d = pn($('#cD').value, true), uc = u > 0 ? Math.round(u * 100) : 0, dd = d > 0 ? Math.round(d) : 0; way();
    $('.cbox.cd').classList.toggle('on', dd > 0); $('.cbox.cu').classList.toggle('on', uc > 0);
    if (!uc && !dd) return $('#cOut').innerHTML = '<span class="mute">هیچ نەنووسراوە — پێویست نییە، تەنها بۆ حیسابی باقییە</span>';
    let chC, chD;   // what goes back to the customer, in cents and in dinar (dinar paid is counted against the dinar total itself, never through the dollar price)
    if (!dd) { chC = uc - total; chD = Math.sign(chC) * r250(dinarOf(Math.abs(chC))); }
    else { chD = uc >= total ? dd + r250(dinarOf(uc - total)) : dd - (uc ? r250(dn * (total - uc) / total) : dn); chC = Math.sign(chD) * Math.round(Math.abs(chD) / S.rate * 100); }
    const short = dd ? chD < 0 : chC < 0 && dinarOf(-chC) >= 125, a = Math.abs(short ? chC : Math.max(0, chC)), b = Math.abs(short ? chD : Math.max(0, chD));
    $('#cOut').innerHTML = `<div class="gsum ${short ? 'bad' : 'cback'}"><span>${short ? 'هێشتا کەمە' : 'باقی بیدەرەوە'}</span><b class="num">${DIN(b)} <small>${short ? '' : 'یان '}${USD(a)}</small></b></div>`; };
  $('#cU').oninput = calc; $('#cD').oninput = calc; way();
  if (!DESK() && document.activeElement && document.activeElement.blur) document.activeElement.blur();
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
/* Code 128 (set C: pairs of digits) drawn as plain bars; the shop's own scanner reads it back */
const C128 = '212222222122222221121223121322131222122213122312132212221213221312231212112232122132122231113222123122123221223211221132221231213212223112312131311222321122321221312212322112322211212123212321232121111323131123131321112313132113132311211313231113231311112133112331132131113123113321133121313121211331231131213113213311213131311123311321331121312113312311332111314111221411431111111224111422121124121421141122141221112214112412122114122411142112142211241211221114413111241112134111111242121142121241114212124112124211411212421112421211212141214121412121111143111341131141114113114311411113411311113141114131311141411131211412211214211232';
function barcode(digits) {
  if (digits.length % 2) digits = '0' + digits;
  const v = [105]; for (let i = 0; i < digits.length; i += 2) v.push(+digits.substr(i, 2));
  v.push(v.reduce((a, x, i) => a + x * (i || 1), 0) % 103);
  const w = v.map(x => C128.substr(x * 6, 6)).join('') + '2331112'; let x = 10, out = '';
  for (let i = 0; i < w.length; i++) { if (i % 2 === 0) out += `<rect x="${x}" y="0" width="${w[i]}" height="1"/>`; x += +w[i]; }
  return `<svg class="bars" viewBox="0 0 ${x + 10} 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="width:${((x + 10) * .45).toFixed(2)}mm">${out}</svg>`;
}
const SHOP_QR = 'https://wasta-ghareb.lovable.app/';   // a page of its own on another host (Lovable project «wasta-ghareb»): nothing on it leads back to this system   // one page: our catalogue on WhatsApp, a message to us, both shops on the map, the way by video
/* QR code (byte mode, error level M, versions 1–6): returns the modules as rows of 0/1 */
function qrMatrix(text) {
  const bytes = [...unescape(encodeURIComponent(text))].map(c => c.charCodeAt(0));
  const CAP = [16, 28, 44, 64, 86, 108], ECB = [10, 16, 26, 18, 24, 16], NB = [1, 1, 1, 2, 2, 4];
  const v = CAP.findIndex(c => bytes.length + 2 <= c) + 1; if (!v) throw new Error('too long for a QR code');
  const n = 17 + 4 * v, dc = CAP[v - 1], ec = ECB[v - 1], nb = NB[v - 1];
  let bits = []; const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push(val >> i & 1); };
  push(4, 4); push(bytes.length, 8); bytes.forEach(b => push(b, 8)); push(0, Math.min(4, dc * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let k = 0; data.length < dc; k++) data.push(k % 2 ? 17 : 236);
  const EXP = [], LOG = []; for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 285; }
  const mul = (a, b) => a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0;
  let gen = [1]; for (let i = 0; i < ec; i++) { const g = gen.concat(0); for (let j = 0; j < gen.length; j++) g[j + 1] ^= mul(gen[j], EXP[i]); gen = g; }
  const rs = d => { const r = Array(ec).fill(0); d.forEach(b => { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < ec; i++) r[i] ^= mul(gen[i + 1], f); }); return r; };
  const per = Math.floor(dc / nb), blocks = []; for (let i = 0, o = 0; i < nb; i++) { const len = per + (i >= nb - dc % nb ? 1 : 0); blocks.push(data.slice(o, o + len)); o += len; }
  const ecs = blocks.map(rs), cw = [];
  for (let i = 0; i <= per; i++) blocks.forEach(b => { if (i < b.length) cw.push(b[i]); });
  for (let i = 0; i < ec; i++) ecs.forEach(e => cw.push(e[i]));
  const M = [...Array(n)].map(() => Array(n).fill(0)), F = [...Array(n)].map(() => Array(n).fill(0)), set = (r, c, val) => { M[r][c] = val ? 1 : 0; F[r][c] = 1; };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; set(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  if (v > 1) { const a = n - 7; for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(a + r, a + c, Math.max(Math.abs(r), Math.abs(c)) !== 1); }
  for (let i = 8; i < n - 8; i++) { if (!F[6][i]) set(6, i, i % 2 === 0); if (!F[i][6]) set(i, 6, i % 2 === 0); }
  set(n - 8, 8, 1);
  for (let i = 0; i < 9; i++) { if (!F[8][i]) F[8][i] = 2; if (!F[i][8]) F[i][8] = 2; } for (let i = 0; i < 8; i++) { if (!F[8][n - 1 - i]) F[8][n - 1 - i] = 2; if (!F[n - 1 - i][8]) F[n - 1 - i][8] = 2; }
  const all = []; cw.forEach(b => { for (let i = 7; i >= 0; i--) all.push(b >> i & 1); });
  let k = 0, up = true;
  for (let c = n - 1; c > 0; c -= 2) { if (c === 6) c--; for (let i = 0; i < n; i++) { const r = up ? n - 1 - i : i; for (const cc of [c, c - 1]) if (!F[r][cc]) M[r][cc] = k < all.length ? all[k++] : 0; } up = !up; }
  const MASK = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => r * c % 2 + r * c % 3 === 0, (r, c) => (r * c % 2 + r * c % 3) % 2 === 0, (r, c) => ((r + c) % 2 + r * c % 3) % 2 === 0];
  const build = m => { const Q = M.map(r => r.slice()); for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!F[r][c] && MASK[m](r, c)) Q[r][c] ^= 1;
    let f = (0 << 3 | m) << 10, d = f; for (let i = 14; i >= 10; i--) if (d >> i & 1) d ^= 1335 << (i - 10); f = (f | d) ^ 21522;   // level M = 00
    const bit = i => f >> i & 1;
    for (let i = 0; i <= 5; i++) Q[8][i] = bit(14 - i); Q[8][7] = bit(8); Q[8][8] = bit(7); Q[7][8] = bit(6); for (let i = 0; i <= 5; i++) Q[5 - i][8] = bit(5 - i);
    for (let i = 0; i < 7; i++) Q[n - 1 - i][8] = bit(14 - i); for (let i = 0; i < 8; i++) Q[8][n - 8 + i] = bit(7 - i);
    return Q; };
  const pen = Q => { let p = 0; const line = g => { let run = 1; for (let i = 1; i <= n; i++) { if (i < n && g(i) === g(i - 1)) run++; else { if (run >= 5) p += run - 2; run = 1; } }
      for (let i = 0; i + 10 < n; i++) { const s = [...Array(11)].map((_, j) => g(i + j)).join(''); if (s === '10111010000' || s === '00001011101') p += 40; } };
    for (let i = 0; i < n; i++) { line(j => Q[i][j]); line(j => Q[j][i]); }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (Q[r][c] === Q[r][c + 1] && Q[r][c] === Q[r + 1][c] && Q[r][c] === Q[r + 1][c + 1]) p += 3;
    const dark = Q.flat().reduce((a, b) => a + b, 0); p += Math.floor(Math.abs(dark * 20 / (n * n) - 10)) * 10; return p; };
  let best = null, bp = Infinity; for (let m = 0; m < 8; m++) { const Q = build(m), p = pen(Q); if (p < bp) { bp = p; best = Q; } }
  return best;
}
const qrSvg = text => { const m = qrMatrix(text), n = m.length; let d = ''; m.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c + 4} ${r + 4}h1v1h-1z`; })); return `<svg class="qr" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`; };
function slip(s) { // always black on white; the shop's own currency leads and the other one stands beside the total
  const cu = s.customer && cust(s.customer), d = new Date(s.t), Dn = S.cur === 'IQD';
  const D = x => x.toLocaleDateString('en-GB'), note = (S.shop && S.shop.note) || '';
  const row = (a, b) => `<div class="sr"><span>${a}</span><b>${b}</b></div>`;
  const lp = (l, c) => Dn ? DIN(l.pd != null && c === l.price ? l.pd : dinarOf(c, s.rate)) : USD(c), dn = s.dn != null ? s.dn : payDinar(s.total, s.rate), m = c => Dn ? DIN(Math.round(dinarOf(c, s.rate) / 250) * 250) : USD(c);
  return `<div class="slip">
    <div class="sh"><img src="${LOGO}" alt="" width="128" height="128"><h3>وەستا غەریب</h3><small>WASTA GHAREB</small><p>${esc(S.branches[s.branch])}</p>${note ? `<p class="sn">${esc(note)}</p>` : ''}</div>
    <div class="sno"><span>پسوڵەی فرۆشتن</span><b class="num">#${s.no}</b></div>
    <div class="smeta">${row('بەروار', `<span class="num">${D(d)}</span>`)}${row('کات', `<span class="num">${h12(d)}</span>`)}${row('فرۆشیار', `<span class="en">${esc(s.by)}</span>`)}${row('جۆری فرۆشتن', TYPES[s.type])}${cu ? row('کڕیار', `<span class="en">${esc(cu.name)}</span>`) : ''}${!cu && (s.buyer || s.phone) ? row('کڕیار', `<span class="en">${esc([s.buyer, s.phone].filter(Boolean).join(' · '))}</span>`) : ''}</div>
    ${s.legacy ? '<p class="sf">ئەم پسوڵەیە لە سیستەمە کۆنەکە تۆمار کراوە؛ وردەکاریی کاڵاکانی لەوێیە.</p>' : `<div class="sl"><div class="slh"><span>کاڵا</span><span>دانە × نرخ</span></div>
    ${s.lines.map(l => `<div class="si"><p><bdi>${esc(l.name)}</bdi></p><div><span class="num">${l.qty} × ${lp(l, l.price)}${l.list != null && l.list > l.price ? ` <s>${lp(l, l.list)}</s>` : ''}</span></div>${(l.sn || []).length ? `<i class="ssn">S/N ${l.sn.map(esc).join(' · ')}</i>` : ''}${l.ret ? `<i>گەڕێنراوەتەوە: <span class="num">${l.ret}</span> دانە</i>` : ''}</div>`).join('')}</div>`}
    ${s.disc ? `<div class="smeta sd">${row('کۆی پێش داشکاندن', `<span class="num">${m(s.sub)}</span>`)}${row('داشکاندن', `<span class="num">− ${m(s.disc)}</span>`)}</div>` : ''}
    <div class="st"><div><span>کۆی گشتی</span><b class="num">${Dn ? DIN(dn) : USD(s.total)}</b></div>${s.rate ? `<div><span>${Dn ? 'بە دۆلار' : 'بە دینار'}</span><b class="num">${Dn ? USD(s.total) : DIN(dn)}</b></div>` : ''}</div>
    <div class="smeta">${row('شێوازی پارەدان', PAY[s.pay][1])}${s.tend ? row('وەرگیراو', `<span class="num">${Core.gotTxt(s.tend)}</span>`) + row('باقی', `<span class="num">${s.got && s.got.iqd || s.tend.iqd ? DIN(s.chgD) : USD(s.chgC)}</span>`) : ''}${s.fibRef ? row('ژمارەی مامەڵەی FIB', `<span class="num">${esc(s.fibRef)}</span>`) : ''}${s.refunded ? row('گەڕێنراوەتەوە', `<span class="num">${m(s.refunded)}</span>`) : ''}</div>
    <div class="sq">${qrSvg(SHOP_QR)}<div><b>سکانم بکە</b><span>کاڵاکانمان لە واتسئاپ</span><span>نەخشەی هەردوو لق</span><span>ناونیشان بە ڤیدیۆ</span></div></div>
    <p class="sf">تکایە ئەم پسوڵەیە بپارێزە</p><p class="sf2">سوپاس بۆ کڕینەکەت</p></div>`;
}
function receipt(s) {
  modal(`<div class="row sp rch"><h2>پسولەی <span class="num">#${s.no}</span></h2>${payTag(s.pay)}</div>
    <div class="paper" id="paper">${slip(s)}</div>
    ${s.got && lvl() > 1 ? `<div class="row sp rcd"><span>پارەی وەرگیراو بەرامبەر نرخ</span>${diffTag(s.diffD)}</div>` : ''}
    <div class="acts" style="flex-wrap:wrap"><button class="btn" id="rcP">${ico('print', 18)}چاپکردن</button><button class="ghost" id="rcX">داخستن</button>${canUndo(s) ? `<button class="ghost undo" id="rcU">${ico('returns', 17)}پەشیمانبوونەوە <small>(تا 10 خولەک)</small></button>` : ''}${isOwner() && s.pay === 'cash' && !s.legacy && s.total > 0 ? `<button class="ghost" id="rcC">${s.got && s.got.iqd ? 'بە دۆلار وەرگیراوە' : 'بە دینار وەرگیراوە'}</button>` : ''}</div>
    ${isOwner() && s.pay === 'cash' && !s.legacy && s.total > 0 ? `<p class="mute rcw">ئێستا لە دەخیل وەک <b>${s.got && s.got.iqd ? 'دینار' : 'دۆلار'}</b> ژمێردراوە.</p>` : ''}`);
  $('#rcX').onclick = closeModal; $('#rcP').onclick = printSlip; if ($('#rcU')) $('#rcU').onclick = () => undoSale(s);
  if ($('#rcC')) $('#rcC').onclick = () => run('cashCur', { nos: [s.no], cur: s.got && s.got.iqd ? 'USD' : 'IQD' }, () => { toast('دراوی ئەم پسولەیە ڕاست کرایەوە'); const n = S.sales.find(x => x.no === s.no); if (n) receipt(n); if (S.view === 'cashjard') V.cashjard(); });
}
function printSlip() { // the page is made exactly as long as the slip, so the 80 mm printer does not feed blank paper
  const pap = $('#paper'), P = $('#print'); if (!pap || !P) return;
  P.innerHTML = pap.innerHTML;
  const mm = Math.max(70, Math.ceil(pap.firstElementChild.offsetHeight * 25.4 / 96) + 12);
  let st = $('#pgsz'); if (!st) { st = document.createElement('style'); st.id = 'pgsz'; document.head.appendChild(st); }
  st.textContent = `@page{size:80mm ${mm}mm;margin:0}`;
  const img = P.querySelector('img'), go = () => setTimeout(() => window.print(), 60);
  if (img && !img.complete) { img.onload = img.onerror = go; } else go();
}

/* ---------- returns ---------- */
let retNo = null; // the receipt open on the returns screen
V.returns = (no) => {
  no = slipNo(no);
  const sale = no && S.sales.find(s => s.no === +no); retNo = sale ? sale.no : null;
  if (!sale && no) archSeek(no, () => { if (S.view === 'returns') V.returns(no); });
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
  const left = sale.lines.some(l => l.qty - l.ret > 0);
  $('#rBody').innerHTML = `<div class="scroll"><table><tr><th>کاڵا</th><th>نرخ</th><th>فرۆشراو</th><th>پێشتر گەڕاوە</th><th>ئێستا دەگەڕێتەوە</th><th>زەمانەت</th></tr>
    ${sale.lines.map((l, i) => { const w = wState(sale, l), inW = w.ok; return `<tr><td class="en">${esc(l.name)}</td><td>${money(l.price)}</td><td class="num">${l.qty}</td><td class="num">${l.ret}</td><td>${l.qty - l.ret > 0 ? `<input class="inp num rq" data-i="${i}" type="text" inputmode="decimal" min="0" max="${l.qty - l.ret}" value="0" style="width:90px">` : '<span class="tag n">تەواو گەڕاوە</span>'}</td><td><div class="row"><span class="tag ${inW ? 'g' : w.none ? 'n' : 'r'}">${inW ? 'تا <span class="num">' + D8(w.end) + '</span>' : w.none ? 'بێ زەمان' : 'بەسەرچووە'}</span>${inW && l.qty - l.ret > 0 ? `<button class="ghost sm" data-w="${i}">گۆڕین</button>` : ''}${l.exch ? `<span class="tag b">گۆڕدراوە <span class="num">${l.exch}</span></span>` : ''}</div></td></tr>`; }).join('')}</table></div>
    ${left ? `<div class="row sp" style="margin-top:16px"><div>پارەی گەڕاوە: <b id="rSum" style="font-size:21px">${money(0)}</b>${sale.disc ? ' <span class="mute">(داشکاندنی پسولەکە لێی کەم دەکرێتەوە)</span>' : ''}</div><div class="row" style="flex-wrap:wrap"><input class="inp" id="rWhy" placeholder="هۆکاری گەڕاندنەوە (پێویستە)" style="width:260px;max-width:100%" maxlength="200"><button class="btn red" id="rDo">گەڕاندنەوە</button></div></div>` : `<div class="empty"><b>هەموو کاڵاکانی ئەم پسولەیە گەڕاونەتەوە</b></div>`}`;
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
    <label class="f"><span>چەند دانە (زۆرترین <span class="num">${can}</span>)</span><input class="inp num" id="wQ" type="text" inputmode="decimal" min="1" max="${can}" step="1" value="1"></label><label class="f">کێشەی کاڵاکە<input class="inp" id="wW" placeholder="بۆ نموونە: شەحن ناکات"></label><label class="f">سریاڵی دانە نوێیەکە (ئەگەر هەیەتی، سکانی بکە)<input class="inp num" id="wSn" autocomplete="off"></label>
    <div class="acts"><button class="btn volt" id="wOk">گۆڕین</button><button class="ghost" id="wNo">پاشگەزبوونەوە</button></div>`);
  $('#wNo').onclick = closeModal;
  $('#wOk').onclick = () => run('exchange', { no: sale.no, line: sale.lines.indexOf(l), qty: +$('#wQ').value, why: $('#wW').value.trim(), sn: $('#wSn').value.trim() }, () => { closeModal(); toast('گۆڕدرا؛ دانە خراپەکە جیا تۆمار کرا'); if (S.view === 'warranty') V.warranty(sale.no); else V.returns(sale.no); });
}

/* ---------- «گەڕاوە و زەمان»: look a purchase up, take it back or swap it for a new one, and see every return and warranty ---------- */
let warNo = null, warTab = 'sold', warQ = '', warSn = '';
V.warranty = (no) => {
  let miss = '';
  if (no !== undefined) { no = slipNo(no); warSn = ''; let f = no !== '' && no != null && S.sales.find(s => s.no === +no);
    if (!f && no) { const sn = Core.cleanSn(no); f = S.sales.find(s => s.lines.some(l => (l.sn || []).includes(sn))); if (f) warSn = sn; } /* …or the serial of a sold piece */ warNo = f ? f.no : null; if (!f && no !== '' && no != null) { miss = String(no); const q0 = no; archSeek(q0, () => { if (S.view === 'warranty') V.warranty(q0); }); } }
  const sale = warNo != null && S.sales.find(s => s.no === warNo); if (!sale) warNo = null;
  const T = x => new Date(Core.ms(x)), when = x => `${hm(T(x))}<small class="num">${D8(x)}</small>`, m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const rets = []; S.sales.forEach(s => (s.rets || []).forEach(r => rets.push({ s, r }))); rets.sort((a, b) => Core.ms(b.r.t) - Core.ms(a.r.t));
  const mRets = rets.filter(x => Core.ms(x.r.t) >= m0.getTime()), mEx = S.exchanges.filter(x => Core.ms(x.t) >= m0.getTime());
  const sold = []; S.sales.forEach(s => { if (!s.legacy) s.lines.forEach((l, i) => sold.push({ s, l, i })); });
  const live = sold.filter(x => x.l.qty - x.l.ret > 0 && wState(x.s, x.l).ok).length, faulty = S.items.reduce((a, i) => a + (i.f || 0), 0);
  const q = warQ.trim().toLowerCase(), cn = s => (s.customer && cust(s.customer) || {}).name || '';
  const rows = (q ? sold.filter(x => x.l.name.toLowerCase().includes(q) || (x.l.sn || []).some(n => n.toLowerCase().includes(q)) || String(x.s.no).includes(q) || cn(x.s).toLowerCase().includes(q) || x.s.by.toLowerCase().includes(q)) : sold);
  const nameOf = (s, id) => { const l = s && s.lines.find(x => x.id === id), it = item(id); return l ? l.name : it ? it.name : '—'; };
  const noBtn = n => `<button class="ghost sm num" data-wo="${n}" title="کردنەوەی ئەم پسولەیە">#${n}</button>`;
  const lineCard = (l, i) => { const w = wState(sale, l), can = l.qty - l.ret;
    return `<div class="wl ${warSn && (l.sn || []).includes(warSn) ? 'hit' : ''}"><div class="wl1"><b class="en">${esc(l.name)}</b><div class="row">${kindTag(l)}${wTag(sale, l)}</div></div>
      <div class="wl2"><span>فرۆشراو <b class="num">${l.qty}</b></span><span>گەڕاوەتەوە <b class="num">${l.ret}</b></span><span>گۆڕدراوە <b class="num">${l.exch || 0}</b></span><span>نرخ ${money(l.price)}</span><span>${w.none ? 'بێ زەمان فرۆشراوە' : `زەمان <b class="num">${Core.lineW(l)}</b> مانگ · تا <b class="num">${D8(w.end)}</b>`}</span>${(l.sn || []).length ? `<span>سریاڵ ${l.sn.map(n => `<b class="num sn ${n === warSn ? 'on' : ''}">${esc(n)}</b>`).join(' ')}</span>` : ''}</div>
      <div class="wl3">${can > 0 ? `<button class="wbtn r" data-tb="${i}"><b>گەڕاوە</b><small>کاڵاکە وەردەگیرێتەوە و پارەکەی دەدرێتەوە</small></button><button class="wbtn g" data-sw="${i}" ${w.ok ? '' : 'disabled'}><b>نوێ</b><small>${w.ok ? 'بە زەمان، دانەیەکی نوێی پێ دەدرێت' : w.none ? 'ئەم کاڵایە زەمانی نییە' : 'زەمانەکەی بەسەرچووە'}</small></button><button class="wbtn c" data-so="${i}"><b>کاڵایەکی تر</b><small>ئەمە وەردەگیرێتەوە و کاڵایەکی جیاوازی پێ دەدرێت</small></button>` : '<span class="tag n">هەموو دانەکانی گەڕاونەتەوە</span>'}</div></div>`; };
  const tabs = [['sold', 'کاڵا فرۆشراوەکان و زەمانیان', sold.length], ['ret', 'گەڕاوەکان', rets.length], ['swap', 'گۆڕین بە نوێ', S.exchanges.length]];
  const body = warTab === 'ret' ? (rets.length ? `<table class="wt"><tr><th>کات</th><th>پسولە</th><th>کاڵا</th><th>پارەی گەڕاوە</th><th>چۆن</th><th>کێ</th><th>لق</th><th>هۆکار</th></tr>${rets.slice(0, 150).map(({ s, r }) => `<tr><td>${when(r.t)}</td><td>${noBtn(s.no)}</td><td class="dfi">${r.items ? r.items.map(x => `<span class="num">${x.qty} ×</span> <span class="en">${esc(x.name)}</span>`).join('<br>') : '<span class="mute">—</span>'}</td><td>${money(r.amt)}${r.swapTo ? `<small>گۆڕدرا بە ${noBtn(r.swapTo)}</small>` : ''}</td><td>${r.fib ? payTag('fib') : s.pay === 'debt' && !r.cash ? payTag('debt') : payTag('cash')}</td><td class="en"><b>${esc(r.by || '')}</b></td><td>${esc(S.branches[r.branch] || '')}</td><td class="wwhy">${esc(r.why || '')}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ کاڵایەک نەگەڕاوەتەوە</b></div>')
    : warTab === 'swap' ? (S.exchanges.length ? `<table class="wt"><tr><th>کات</th><th>پسولە</th><th>کاڵا</th><th>دانە</th><th>کێ</th><th>لق</th><th>کێشەی کاڵاکە</th></tr>${S.exchanges.slice(0, 150).map(x => `<tr><td>${when(x.t)}</td><td>${noBtn(x.no)}</td><td class="dfi"><span class="en">${esc(nameOf(S.sales.find(s => s.no === x.no), x.id))}</span></td><td class="num"><b>${x.qty}</b></td><td class="en"><b>${esc(x.by)}</b></td><td>${esc(S.branches[x.branch] || '')}</td><td class="wwhy">${esc(x.why)}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ کاڵایەک بە زەمان نەگۆڕدراوە</b></div>')
    : (rows.length ? `<table class="wt"><tr><th>فرۆشتن</th><th>پسولە</th><th>کاڵا</th><th>جۆر</th><th>زەمان</th><th>تا کەی</th><th>دۆخ</th><th>کڕیار</th></tr>${rows.slice(0, 150).map(({ s, l }) => { const w = wState(s, l); return `<tr><td>${when(s.t)}</td><td>${noBtn(s.no)}</td><td class="dfi"><span class="num">${l.qty} ×</span> <span class="en">${esc(l.name)}</span>${(l.sn || []).length ? `<small class="num">S/N ${l.sn.map(esc).join(' · ')}</small>` : ''}${l.ret ? ` <span class="tag r">گەڕاوەتەوە <span class="num">${l.ret}</span></span>` : ''}${l.exch ? ` <span class="tag b">گۆڕدراوە <span class="num">${l.exch}</span></span>` : ''}</td><td>${kindTag(l)}</td><td>${w.none ? '—' : `<span class="num">${Core.lineW(l)}</span> مانگ`}</td><td class="num">${w.none ? '—' : D8(w.end)}</td><td>${wTag(s, l)}</td><td class="en">${esc(cn(s)) || '<span class="mute">—</span>'}</td></tr>`; }).join('')}</table>${rows.length > 150 ? `<p class="mute" style="padding:12px 16px">تەنها <span class="num">150</span> دوایین دانە پیشان دراون؛ بۆ کۆنتر بگەڕێ.</p>` : ''}` : `<div class="empty"><b>${q ? 'هیچ شتێک نەدۆزرایەوە' : 'هێشتا هیچ کاڵایەک نەفرۆشراوە'}</b></div>`);
  $('#view').innerHTML = `<div class="kgrid wk"><div class="card kpi"><small><span class="dot r">${ico('returns', 15)}</span>گەڕاوەی ئەم مانگە</small><b class="num" id="wkRet">${mRets.length}</b><em>${money(mRets.reduce((a, x) => a + x.r.amt, 0))} دراوەتەوە</em></div><div class="card kpi"><small><span class="dot b">${ico('shield', 15)}</span>گۆڕین بە نوێ (ئەم مانگە)</small><b class="num" id="wkSw">${mEx.reduce((a, x) => a + x.qty, 0)}</b><em>دانە بە زەمان گۆڕدراوە</em></div><div class="card kpi"><small><span class="dot g">${ico('check', 15)}</span>زەمانی چالاک</small><b class="num" id="wkLive">${live.toLocaleString('en-US')}</b><em>کاڵای فرۆشراو کە هێشتا زەمانی ماوە</em></div><div class="card kpi"><small><span class="dot a">${ico('alert', 15)}</span>دانەی خراپ</small><b class="num">${faulty.toLocaleString('en-US')}</b><em>بە زەمان وەرگیراونەتەوە</em></div></div>
    <div class="card pad" style="margin-bottom:14px"><h2>وەرگرتنەوە یان گۆڕینی کاڵا</h2><p class="mute" style="margin:4px 0 14px">بارکۆدی سەر پسوڵەکە یان سریاڵی سەر خودی کاڵاکە سکان بکە (یان بینووسە). بۆ هەر کاڵایەک دیارە کەی فرۆشراوە، نوێ بووە یان گەڕاوە، و زەمانەکەی تا کەیە.</p>
      <div class="row"><input class="inp num grow" id="wrNo" placeholder="بارکۆدی پسوڵە یان سریاڵی کاڵاکە" autocomplete="off" value="${sale ? esc(warSn || sale.no) : esc(miss)}"><button class="btn" id="wrGo">گەڕان</button>${sale ? '<button class="ghost" id="wrClr">داخستن</button>' : ''}</div>
      <div id="wBody" style="margin-top:14px">${miss ? `<div class="empty"><b><span class="num">${esc(miss)}</span> نەدۆزرایەوە</b>نە پسولەیەک بەم ژمارەیە هەیە، نە کاڵایەکی فرۆشراو بەم سریاڵە</div>` : !sale ? '' : sale.legacy ? `<div class="empty"><b>پسولەی <span class="num">#${sale.no}</span> هی سیستەمە کۆنەکەیە</b>وردەکاریی کاڵاکانی لێرە نییە</div>` : `<div class="whead"><b>پسولەی <span class="num">#${sale.no}</span></b><span>فرۆشراوە لە <b class="num">${D8(sale.t)}</b> ${hm(T(sale.t))}</span><span>فرۆشیار <b class="en">${esc(sale.by)}</b></span><span>${esc(S.branches[sale.branch])}</span>${cn(sale) ? `<span>کڕیار <b class="en">${esc(cn(sale))}</b></span>` : ''}${payTag(sale.pay)}<button class="ghost sm" id="wrSee">بینینی پسوڵە</button></div>${sale.lines.map(lineCard).join('')}`}</div></div>
    <div class="row sp wbar"><div class="seg">${tabs.map(o => `<button data-wt="${o[0]}" class="${warTab === o[0] ? 'on' : ''}">${o[1]} <span class="num">${o[2].toLocaleString('en-US')}</span></button>`).join('')}</div>${warTab === 'sold' ? `<input class="inp" id="wrQ" placeholder="گەڕان بە ناوی کاڵا، ژمارەی پسولە، کڕیار یان فرۆشیار" value="${esc(warQ)}" autocomplete="off">` : ''}</div>
    <div class="card scroll">${body}</div>`;
  const vw = $('#view');
  $('#wrGo').onclick = () => V.warranty($('#wrNo').value.trim()); $('#wrNo').onkeydown = e => { if (e.key === 'Enter') $('#wrGo').click(); };
  if ($('#wrClr')) $('#wrClr').onclick = () => V.warranty('');
  if ($('#wrSee')) $('#wrSee').onclick = () => receipt(sale);
  vw.querySelectorAll('[data-wt]').forEach(b => b.onclick = () => { warTab = b.dataset.wt; V.warranty(); });
  vw.querySelectorAll('[data-wo]').forEach(b => b.onclick = () => { V.warranty(b.dataset.wo); window.scrollTo(0, 0); });
  vw.querySelectorAll('[data-tb]').forEach(b => b.onclick = () => takeBack(sale, +b.dataset.tb));
  vw.querySelectorAll('[data-so]').forEach(b => b.onclick = () => swapOther(sale, +b.dataset.so));
  vw.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => exchange(sale, sale.lines[+b.dataset.sw]));
  const wq = $('#wrQ'); if (wq) wq.oninput = () => { warQ = wq.value; V.warranty(); const n = $('#wrQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
};
function takeBack(sale, i) { // «گەڕاوە»: the piece comes back into stock and its money goes back the way it was paid
  const l = sale.lines[i], can = l.qty - l.ret, how = sale.pay === 'fib' ? 'بە FIB بۆ کڕیار دەگەڕێنرێتەوە' : sale.pay === 'debt' ? 'لە قەرزی کڕیار کەم دەکرێتەوە' : 'بە کاش لە قاصە دەدرێتەوە';
  modal(`<h2>گەڕاوە — وەرگرتنەوەی کاڵا</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:4px">${esc(l.name)}</p>
    <p class="mute" style="margin-bottom:12px">پسولەی <span class="num">#${sale.no}</span> · فرۆشراوە لە <span class="num">${D8(sale.t)}</span>. کاڵاکە دەچێتەوە کۆگای ${esc(S.branches[sale.branch])}.</p>
    <label class="f"><span>چەند دانە (زۆرترین <span class="num">${can}</span>)</span><input class="inp num" id="tbQ" type="text" inputmode="numeric" value="1" autocomplete="off"></label>
    <label class="f">هۆکار (پێویستە)<input class="inp" id="tbW" maxlength="200" placeholder="بۆ نموونە: کڕیار پەشیمان بووەوە" autocomplete="off"></label>
    <label class="chk" style="margin-bottom:12px"><input type="checkbox" id="tbF"><span>دانەکە عاتڵە (کار ناکات) — ناچێتەوە ناو کاڵای فرۆشتن، وەک «خراپ» تۆمار دەبێت. بۆ جوملەچیی شارێکی تر کە دانەکە نانێرێتەوە.</span></label>
    <div class="gsum"><span>پارەی گەڕاوە — ${how}</span><b id="tbSum"></b></div>
    <div class="acts"><button class="btn red" id="tbOk">گەڕاندنەوە</button><button class="ghost" id="tbNo">پاشگەزبوونەوە</button></div>`);
  const qty = () => ({ [i]: Math.floor(pn($('#tbQ').value) || 0) });
  const sum = () => { const r = Core.refundCalc(sale, qty()); $('#tbSum').innerHTML = r ? money(r.refund) + (sale.rate ? ` <small class="num tbd">${DIN(payDinar(r.refund, sale.rate))} · بە نرخی ڕۆژی کڕین (100$ = ${(sale.rate * 100).toLocaleString('en-US')})</small>` : '') : '<span class="tag r">لە فرۆشراو زیاترە</span>'; $('#tbOk').disabled = !r || !r.n; };
  $('#tbQ').oninput = sum; sum(); $('#tbNo').onclick = closeModal;
  $('#tbOk').onclick = () => run('return', { no: sale.no, qty: qty(), why: $('#tbW').value.trim(), faulty: $('#tbF').checked }, () => { closeModal(); toast('وەرگیرایەوە؛ کۆگا نوێ کرایەوە'); V.warranty(sale.no); shell(); });
}
function swapOther(sale, i) { // «کاڵایەکی تر»: this piece comes back, a different item leaves on a new receipt; only the difference changes hands
  const l = sale.lines[i], can = l.qty - l.ret, b = S.branch, P = it => sale.type === 'wholesale' ? it.w : it.r; let pick = null;
  modal(`<h2>گۆڕین بە کاڵایەکی تر</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:4px">${esc(l.name)}</p>
    <p class="mute" style="margin-bottom:12px">پسولەی <span class="num">#${sale.no}</span>. ئەم کاڵایە دەچێتەوە کۆگا و کاڵا نوێیەکە لە ${esc(S.branches[b])} دەدرێت، بە پسولەیەکی نوێ.</p>
    <div class="row"><label class="f" style="width:160px"><span>چەند دانە (زۆرترین <span class="num">${can}</span>)</span><input class="inp num" id="soQ" type="text" inputmode="numeric" value="1" autocomplete="off"></label><label class="f grow">هۆکار (پێویستە)<input class="inp" id="soW" maxlength="200" placeholder="بۆ نموونە: جۆرێکی تری دەوێت" autocomplete="off"></label></div>
    <label class="f">کاڵا نوێیەکە — بارکۆدەکەی سکان بکە یان ناوەکەی بنووسە<input class="inp" id="soBc" autocomplete="off"></label>
    <div id="soHits"></div><div id="soSum"></div>
    <div class="acts"><button class="btn volt" id="soOk" disabled>گۆڕین</button><button class="ghost" id="soNo">پاشگەزبوونەوە</button></div>`);
  const n = () => Math.floor(pn($('#soQ').value) || 0), qty = () => ({ [i]: n() });
  const sum = () => { const r = Core.refundCalc(sale, qty()), k = n(), okQ = r && r.n > 0, np = pick ? P(pick) * k : 0, bad = pick && (!(P(pick) > 0) ? 'ئەم کاڵایە نرخی نییە' : k > pick.s[b] ? 'لە ' + S.branches[b] + ' تەنها ' + pick.s[b] + ' دانە ماوە' : pick.id === l.id ? 'ئەمە هەمان کاڵایە؛ بۆ هەمان کاڵا دوگمەی «نوێ» بەکاربهێنە' : '');
    $('#soOk').disabled = !okQ || !pick || !!bad;
    $('#soSum').innerHTML = !okQ ? '<div class="gsum bad"><span>بڕی دانەکان دروست نییە</span></div>' : !pick ? '' : bad ? `<p class="gwarn">${esc(bad)}</p>` : `<div class="rc sosum"><div class="row sp"><span>دەگەڕێتەوە (${esc(l.name)} <span class="num">×${k}</span>)</span><b>${money(r.refund)}</b></div><div class="row sp"><span>کاڵا نوێیەکە (${esc(pick.name)} <span class="num">×${k}</span>)</span><b>${money(np)}</b></div><hr><div class="row sp sonet"><b>${np >= r.refund ? 'کڕیار دەبێت بیدات' : 'بۆ کڕیار دەگەڕێتەوە'}</b><b class="num">${fmtMoney(Math.abs(np - r.refund))} <small>${otherCur(Math.abs(np - r.refund))}</small></b></div>${sale.pay === 'fib' ? '<p class="mute" style="font-size:13.5px;margin-top:6px">پسولە کۆنەکە بە FIB بووە: پارەی گەڕاوەکەی بە FIB دەگەڕێتەوە و کاڵا نوێیەکە بە کاش وەردەگیرێت.</p>' : sale.pay === 'debt' ? '<p class="mute" style="font-size:13.5px;margin-top:6px">پسولە کۆنەکە بە قەرز بووە: جیاوازییەکە لەسەر قەرزی کڕیار هەژمار دەکرێت.</p>' : ''}</div>`; };
  const find = () => { const v = $('#soBc').value.trim(), lo = v.toLowerCase(), ex = v && S.items.filter(x => x.bc && x.bc.toLowerCase() === lo), hits = !v ? [] : ex.length ? ex : S.items.filter(x => x.name.toLowerCase().includes(lo)).slice(0, 6);
    if (hits.length === 1 && ex.length === 1) pick = hits[0]; else if (pick && !hits.includes(pick)) pick = null;
    $('#soHits').innerHTML = hits.map(x => `<button class="sohit ${pick === x ? 'on' : ''}" data-sp="${x.id}"><span class="en">${esc(x.name)}</span><span>${money(P(x))} · <span class="num">${x.s[b]}</span> دانە</span></button>`).join('') || (v ? '<p class="gwarn">هیچ کاڵایەک نەدۆزرایەوە</p>' : '');
    document.querySelectorAll('[data-sp]').forEach(e => e.onclick = () => { pick = item(+e.dataset.sp); find(); }); sum(); };
  $('#soBc').oninput = find; $('#soQ').oninput = sum; $('#soNo').onclick = closeModal; sum();
  $('#soOk').onclick = () => run('swapOther', { no: sale.no, qty: qty(), why: $('#soW').value.trim(), lines: [{ id: pick.id, qty: n() }] }, r => { closeModal(); toast('گۆڕدرا؛ پسولەی نوێ #' + r.no); V.warranty(sale.no); shell(); const ns = S.sales.find(x => x.no === r.no); if (ns) receipt(ns); });
}

/* ---------- items & stock ---------- */
/* what the stock is worth: all branches and each branch, at retail, at wholesale and (manager only) at buying price.
   Exact integer cents; anything that cannot be priced is left out and said so, never guessed. */
function stockWorth(k) {
  const o = { kinds: 0, units: 0, r: 0, w: 0, wMissN: 0, wMissU: 0, c: 0, cU: 0, cMissN: 0, cMissU: 0, cR: 0, cWc: 0, cW: 0, out: 0, low: 0 };
  S.items.forEach(i => {
    const n = k < 0 ? i.s.reduce((a, x) => a + x, 0) : i.s[k];
    if (n <= 0) { o.out++; return; }
    if (n <= 5) o.low++;
    o.kinds++; o.units += n; o.r += n * i.r;
    if (i.w > 0) o.w += n * i.w; else { o.wMissN++; o.wMissU += n; }
    if (i.c != null) { o.c += n * i.c; o.cU += n; o.cR += n * i.r; if (i.w > 0) { o.cW += n * i.w; o.cWc += n * i.c; } } else { o.cMissN++; o.cMissU += n; }
  });
  return o;
}
function valueCard(own) {
  const cols = [{ k: -1, nm: 'هەموو لقەکان' }, ...S.branches.map((nm, k) => ({ k, nm }))], all = stockWorth(-1);
  const line = (lbl, val, id, note, cls) => `<div class="vrow ${cls || ''}"><span>${lbl}</span><b class="num" ${id}>${val}</b>${note ? `<small class="vnote">${note}</small>` : ''}</div>`;
  const col = c => { const o = c.k < 0 ? all : stockWorth(c.k), K = c.k < 0 ? 'all' : c.k, share = own ? (all.r ? Math.round(o.r / all.r * 100) : 0) : (all.units ? Math.round(o.units / all.units * 100) : 0);
    return `<div class="card pad vcol ${c.k < 0 ? 'vall' : ''}"><div class="row sp"><h2>${esc(c.nm)}</h2>${c.k < 0 ? '' : `<span class="tag b"><span class="num">${share}%</span> ی کۆگا</span>`}</div>
      <div class="vunits"><b class="num" data-vu="${K}">${o.units.toLocaleString('en-US')}</b><span>دانە · <span class="num">${o.kinds}</span> جۆر کاڵا${o.out ? ` · <span class="num">${o.out}</span> نەماوە` : ''}</span></div>
      ${own ? line('ئەگەر بە <b>تاک (موفرەد)</b> بیفرۆشیت', fmtMoney(o.r), `data-vr="${K}"${c.k < 0 ? ' id="valRetail"' : ''}`, '', 'vbig') : c.k < 0 ? '' : line('کەمبوو (5 دانە یان کەمتر)', o.low.toLocaleString('en-US'), `data-vlow="${K}"`)}
      ${!own ? '' : line('ئەگەر بە <b>جوملە</b> بیفرۆشیت', fmtMoney(o.w), `data-vw="${K}"`, o.wMissN ? `<span class="num">${o.wMissN}</span> کاڵا (<span class="num">${o.wMissU.toLocaleString('en-US')}</span> دانە) نرخی جوملەیان نییە و حیساب نەکراون` : '')}
      ${own ? line('<b>وەک خۆی</b> — بە نرخی کڕین', o.cU ? fmtMoney(o.c) : 'نرخی کڕین دانەنراوە', `data-vc="${K}"${c.k < 0 ? ' id="valCost"' : ''}`, o.cMissN && o.cU ? `تەنها بۆ <span class="num">${o.cU.toLocaleString('en-US')}</span> دانە؛ <span class="num">${o.cMissN}</span> کاڵا نرخی کڕینیان نییە` : o.cMissN ? `<span class="num">${o.cMissN}</span> کاڵا نرخی کڕینیان نییە — لە «نرخ» دایبنێ` : '', 'vcost') : ''}
      ${own ? line('قازانج ئەگەر بە تاک بفرۆشیت', o.cU ? fmtMoney(o.cR - o.c) : '—', `data-vpr="${K}"${c.k < 0 ? ' id="valProfit"' : ''}`, o.cU && o.cMissN ? 'تەنها کاڵاکانی خاوەن نرخی کڕین' : '', 'vgood') : ''}
      ${own ? line('قازانج ئەگەر بە جوملە بفرۆشیت', o.cWc ? fmtMoney(o.cW - o.cWc) : '—', `data-vpw="${K}"`, '', 'vgood') : ''}
      ${c.k < 0 ? '' : `<div class="bar vbar"><i style="width:${share}%"></i></div>`}</div>`; };
  const cats = [...new Set(S.items.map(i => i.cat))], br = S.branches.map((b, k) => k);
  const catRow = cat => { const its = S.items.filter(i => i.cat === cat), u = k => its.reduce((a, i) => a + Math.max(0, i.s[k]), 0), tot = br.reduce((a, k) => a + u(k), 0), r = its.reduce((a, i) => a + i.s.reduce((x, n) => x + Math.max(0, n), 0) * i.r, 0), w = its.reduce((a, i) => a + (i.w > 0 ? i.s.reduce((x, n) => x + Math.max(0, n), 0) * i.w : 0), 0), c = its.reduce((a, i) => a + (i.c != null ? i.s.reduce((x, n) => x + Math.max(0, n), 0) * i.c : 0), 0);
    return `<tr><td><span class="tag n">${esc(cat)}</span></td><td class="num">${its.length}</td>${br.map(k => `<td class="num">${u(k).toLocaleString('en-US')}</td>`).join('')}<td class="num"><b>${tot.toLocaleString('en-US')}</b></td>${own ? `<td>${money(r)}</td><td>${money(w)}</td><td>${its.some(i => i.c != null) ? money(c) : '<span class="mute">—</span>'}</td>` : ''}</tr>`; };
  return `<div class="vgrid">${cols.map(col).join('')}</div>
    <div class="card scroll" style="margin-bottom:14px"><table class="vcat"><tr><th>پۆل</th><th>جۆر</th>${br.map(k => `<th>دانە · ${esc(S.branches[k])}</th>`).join('')}<th>کۆی دانە</th>${own ? '<th>بە تاک</th><th>بە جوملە</th><th>بە نرخی کڕین</th>' : ''}</tr>${cats.map(catRow).join('')}
      <tr class="vtot"><td><b>کۆی گشتی</b></td><td class="num">${S.items.length}</td>${br.map(k => `<td class="num"><b>${stockWorth(k).units.toLocaleString('en-US')}</b></td>`).join('')}<td class="num"><b>${all.units.toLocaleString('en-US')}</b></td>${own ? `<td><b>${money(all.r)}</b></td><td><b>${money(all.w)}</b></td><td><b>${all.cU ? money(all.c) : '—'}</b></td>` : ''}</tr></table></div>`;
}
V.items = () => {
  const noBc = S.items.filter(i => !i.bc).length, low = S.items.filter(i => i.s[S.branch] <= 5).length, own = isOwner();
  const f = S.itemFilter, iq0 = (S.itemQ || '').trim().toLowerCase(), list = S.items.filter(i => (f === 'nobc' ? !i.bc : f === 'low' ? i.s[S.branch] <= 5 : true) && (!iq0 || i.name.toLowerCase().includes(iq0) || i.bc.toLowerCase().includes(iq0)));
  const goneT = `<div class="card scroll">${(S.gone || []).length ? `<table><tr><th>کاڵا</th><th>بارکۆد</th><th>دانەی هەبوو</th><th>کێ ڕەشی کردەوە</th><th>کەی</th><th>هۆکار</th><th></th></tr>${S.gone.map(g => `<tr><td class="en">${esc(g.name)}</td><td class="num">${esc(g.bc) || '—'}</td><td class="num">${g.s.reduce((a, n) => a + n, 0)}</td><td class="en">${esc(g.goneBy || '')}</td><td class="num">${g.goneT ? D8(g.goneT) : ''}</td><td>${esc(g.why || '')}</td><td>${own ? `<button class="ghost sm" data-rs="${g.id}">گەڕاندنەوە</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هیچ بابەتێک ڕەش نەکراوەتەوە</b></div>'}</div>`;
  // what the whole stock (all branches) is worth
  const q = i => i.s.reduce((a, n) => a + n, 0), units = S.items.reduce((a, i) => a + q(i), 0);
  const vR = S.items.reduce((a, i) => a + q(i) * i.r, 0), vW = S.items.reduce((a, i) => a + q(i) * i.w, 0);
  const withC = S.items.filter(i => i.c != null), vC = withC.reduce((a, i) => a + q(i) * i.c, 0), vRk = withC.reduce((a, i) => a + q(i) * i.r, 0), noC = S.items.filter(i => i.c == null && q(i) > 0).length;
  const P = S.purchases, pQty = P.reduce((a, x) => a + x.qty, 0), pRet = P.reduce((a, x) => a + x.qty * x.retail, 0), pCost = P.reduce((a, x) => a + (x.cost != null ? x.qty * x.cost : 0), 0);
  const itemsTable = `<div class="card scroll"><table class="itab"><tr><th>کاڵا</th><th>پۆل</th>${own ? '<th>کڕین</th>' : ''}<th>تاک</th><th>جوملە</th><th>${esc(S.branches[0])}</th><th>${esc(S.branches[1])}</th><th></th></tr>
    ${list.map(i => `<tr><td class="en"><span class="irow">${stockRing(i, thumb(i, 15, 'sm'), 46)}<span class="inm"><button class="ilink" data-ih="${i.id}" title="داتای تەواوی ئەم بابەتە">${esc(i.name)}</button><small class="num ibc">${esc(i.bc) || '<span class="tag r">بێ بارکۆد</span>'}${i.f ? ` <span class="tag r">خراپ <span class="num">${i.f}</span></span>` : ''}</small></span></span></td><td><span class="tag n">${esc(i.cat)}</span></td>${own ? `<td>${i.c != null ? money(i.c) : '<span class="mute">—</span>'}</td>` : ''}<td>${money(i.r)}</td><td>${i.w > 0 ? money(i.w) + (i.w > i.r ? ' <span class="tag r" title="نرخی جوملە لە تاک زیاترە">گرانترە</span>' : '') : '<span class="tag r">دانەنراوە</span>'}</td>
      ${i.s.map(n => `<td>${bat(n)}</td>`).join('')}
      <td><div class="row">${own ? `<button class="ghost sm" data-e="${i.id}">نرخ</button>` : ''}<button class="ghost sm" data-ed="${i.id}">دەستکاری</button><button class="ghost sm" data-adj="${i.id}">کەمکردن</button><button class="rm" data-del="${i.id}" title="ڕەشکردنەوە">${ico('trash', 16)}</button>${!i.bc ? `<button class="ghost sm" data-b="${i.id}">بارکۆد</button>` : ''}</div></td></tr>`).join('')}</table></div>`;
  const inTable = `<div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))"><div class="card kpi"><small>دانەی داخیلکراو</small>${cuInt(pQty)}</div>${own ? `<div class="card kpi"><small>بەهای فرۆشتنیان</small>${cu(pRet)}</div><div class="card kpi"><small>کۆی کڕین</small>${cu(pCost, 'pCostAll')}</div><div class="card kpi"><small>قازانجی چاوەڕوانکراو</small>${cu(P.reduce((a, x) => a + (x.cost != null ? x.qty * (x.retail - x.cost) : 0), 0))}</div>` : ''}</div>
    <div class="card scroll">${P.length ? `<table><tr><th>کات</th><th>کاڵا</th><th>بڕ</th><th>نرخی فرۆشتن</th><th>بەهای فرۆشتن</th>${own ? '<th>نرخی کڕین</th><th>کۆی کڕین</th><th>قازانج</th>' : ''}<th>کێ</th><th>لق</th></tr>${P.map(x => `<tr><td>${hm(x.t)}<small class="num" style="display:block;color:var(--mute)">${x.d ? dmy(x.d) : D8(x.t)}</small></td><td class="en">${esc(x.name)}</td><td class="num"><b>${x.qty}</b></td><td>${money(x.retail)}</td><td>${money(x.qty * x.retail)}</td>${own ? (x.cost != null ? `<td>${money(x.cost)}</td><td><b>${money(x.qty * x.cost)}</b></td><td><span class="tag g">${money(x.qty * (x.retail - x.cost))}</span></td>` : '<td colspan="3"><span class="tag a">نرخی کڕین دانەنراوە</span></td>') : ''}<td class="en">${esc(x.by)}</td><td>${esc(S.branches[x.branch])}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ کاڵایەک داخیل نەکراوە</b>هەر داخیلکردنێک بە بڕ، نرخ و کۆی گشتییەوە لێرە تۆمار دەبێت</div>'}</div>`;
  $('#view').innerHTML = `${valueCard(own)}
    <div class="row sp" style="margin-bottom:14px;flex-wrap:wrap">
    <div class="chips" style="margin:0"><button class="chip ${f === 'all' ? 'on' : ''}" data-f="all">هەموو <span class="num">${S.items.length}</span></button><button class="chip ${f === 'nobc' ? 'on' : ''}" data-f="nobc">بێ بارکۆد <span class="num">${noBc}</span></button><button class="chip ${f === 'low' ? 'on' : ''}" data-f="low">کەمبوو <span class="num">${low}</span></button><button class="chip ${f === 'in' ? 'on' : ''}" data-f="in">مێژووی داخیلکردن <span class="num">${P.length}</span></button>${(S.gone || []).length ? `<button class="chip ${f === 'gone' ? 'on' : ''}" data-f="gone">ڕەشکراوەکان <span class="num">${S.gone.length}</span></button>` : ''}</div>
    <div class="row"><input class="inp" id="iQ" placeholder="گەڕان بە ناو یان بارکۆد" autocomplete="off" value="${esc(S.itemQ || '')}" style="width:240px"><button class="ghost" id="newItem">داخیلکردنی بابەتی نوێ</button><button class="btn volt" id="recv">زیادکردنی دانە</button></div></div>
    ${noBc && f !== 'in' ? `<div class="card pad row wait" style="margin-bottom:14px"><div class="dot a">${ico('alert')}</div><div class="grow"><b><span class="num">${noBc}</span> کاڵا بارکۆدیان نییە</b><div class="mute" style="font-size:14px">لە سیستەمە کۆنەکە بە «0» یان بەتاڵ تۆمار کراون. بە ناو دەفرۆشرێن و دانەیان زیاد دەکرێت؛ بۆ ئەوەی سکان بکرێن بارکۆدیان بۆ دابنێ.</div></div></div>` : ''}
    ${f === 'in' ? inTable : f === 'gone' ? goneT : itemsTable}`;
  $('#view').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.itemFilter = b.dataset.f; V.items(); });
  $('#recv').onclick = receive;
  $('#view').querySelectorAll('[data-adj]').forEach(b => b.onclick = () => adjust(item(+b.dataset.adj)));
  $('#view').querySelectorAll('[data-b]').forEach(b => b.onclick = () => setBarcode(item(+b.dataset.b)));
  $('#newItem').onclick = newItem;
  $('#view').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editItem(item(+b.dataset.ed)));
  $('#view').querySelectorAll('[data-del]').forEach(b => b.onclick = () => delItem(item(+b.dataset.del)));
  $('#view').querySelectorAll('[data-ih]').forEach(b => b.onclick = () => itemHistory(item(+b.dataset.ih)));
  $('#view').querySelectorAll('[data-rs]').forEach(b => b.onclick = () => run('restoreItem', { id: +b.dataset.rs }, () => { toast('گەڕێنرایەوە'); V.items(); }));
  const iq = $('#iQ'); iq.oninput = () => { S.itemQ = iq.value; V.items(); const n = $('#iQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  if (own) $('#view').querySelectorAll('[data-e]').forEach(b => b.onclick = () => editPrice(item(+b.dataset.e)));
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
  modal(`<h2>داخیلکردنی کاڵا — ${esc(S.branches[S.branch])}</h2><p class="mute" style="margin-bottom:12px">بارکۆدەکەی سکان بکە، یان ناوی بابەتەکە بنووسە و هەڵیبژێرە.</p>
    <div class="row"><label class="f grow">بارکۆد یان ناوی بابەت<input class="inp" id="vBc" placeholder="سکان بکە یان بنووسە" autocomplete="off"></label><label class="f" style="width:170px">بەرواری هاتن${dateBox(`vD`, isoD(new Date()))}</label></div><div id="vHit" style="margin-bottom:12px"></div>
    <div class="row"><label class="f grow">بڕ (دانە)<input class="inp num" id="vQty" type="text" inputmode="decimal" min="1" step="1" inputmode="numeric"></label><label class="f grow"><span>نرخی کڕینی یەک دانە ${CUR()}</span><input class="inp num" id="vCost" type="text" inputmode="decimal" placeholder="${own ? '' : 'تەنها بەڕێوەبەر دەیبینێت'}"></label></div>
    <div id="vSum"></div>
    <div class="acts"><button class="btn volt" id="vOk">داخیلکردن</button><button class="ghost" id="vNo">پاشگەزبوونەوە</button></div>`);
  let pick = null;
  const sum = () => { const n = +$('#vQty').value; if (!pick || !(n > 0)) return $('#vSum').innerHTML = '';
    const c = own && $('#vCost').value.trim() !== '' ? toC($('#vCost').value) : null;
    $('#vSum').innerHTML = `<div class="card pad rc" style="margin-top:4px"><div class="row sp"><span>نرخی فرۆشتنی یەک دانە</span>${money(pick.r)}</div><div class="row sp"><span>بەهای فرۆشتنی هەمووی</span><b>${money(n * pick.r)}</b></div>${c != null ? `<hr><div class="row sp"><span>کۆی کڕین</span><b style="font-size:19px">${money(n * c)}</b></div><div class="row sp"><span>قازانجی چاوەڕوانکراو</span><span class="tag ${pick.r >= c ? 'g' : 'r'}">${money(n * (pick.r - c))}</span></div>` : ''}<div class="row sp"><span>کۆگا دوای داخیلکردن</span><span class="num">${pick.s[S.branch]} → <b>${pick.s[S.branch] + n}</b></span></div></div>`; };
  const find = () => { const v0 = $('#vBc').value.trim(), ex = S.items.filter(i => i.bc && i.bc === v0), hits = ex.length || v0.length < 2 ? ex : S.items.filter(i => i.name.toLowerCase().includes(v0.toLowerCase())).slice(0, 12); pick = hits.length === 1 ? hits[0] : null;
    $('#vHit').innerHTML = !$('#vBc').value.trim() ? '' : !hits.length ? '<span class="tag r">هیچ بابەتێک بەم بارکۆد یان ناوە نییە — سەرەتا لە «داخیلکردنی بابەتی نوێ» دروستی بکە</span>' : hits.length === 1 ? `<span class="tag g">${esc(hits[0].name)} · ئێستا ${hits[0].s[S.branch]} دانە</span>` : `<select class="inp" id="vPick"><option value="">${hits.length} بابەت دۆزرایەوە — یەکێک هەڵبژێرە</option>${hits.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select>`;
    if ($('#vPick')) $('#vPick').onchange = e => { pick = item(+e.target.value) || null; preset(); sum(); };
    preset(); sum(); };
  const preset = () => { if (own && pick && pick.c != null && $('#vCost').value === '') $('#vCost').value = amtOut(pick.c); };
  $('#vBc').oninput = find; $('#vQty').oninput = sum; $('#vCost').oninput = sum; $('#vNo').onclick = closeModal;
  $('#vOk').onclick = () => { const p = { id: pick ? pick.id : null, qty: +$('#vQty').value, d: $('#vD').value };
    if ($('#vCost').value.trim() !== '') p.cost = toC($('#vCost').value);
    run('receive', p, () => { closeModal(); toast('داخیل کرا'); V.items(); }); };
}
const catList = () => `<datalist id="cats">${[...new Set(S.items.map(i => i.cat))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
function newItem() { // «داخیلکردنی بابەت»: by hand, the barcode is optional
  const own = isOwner();
  modal(`<h2>داخیلکردنی بابەت</h2><p class="mute" style="margin-bottom:12px">ناو و نرخی تاک پێویستن. بارکۆد و نرخی جوملە ئەگەر هەبوون بیاننووسە.</p>
    <label class="f">ناوی بابەت<input class="inp" id="nName" style="direction:ltr" autocomplete="off"></label>
    <div class="row"><label class="f grow">پۆل<input class="inp" id="nCat" list="cats" autocomplete="off" placeholder="بۆ نموونە: کێبڵ">${catList()}</label><label class="f grow">بارکۆد (ئارەزوومەندانە)<input class="inp num" id="nBc" autocomplete="off"></label></div>
    <div class="row"><label class="f grow">نرخی تاک بە دینار (جێگیر)<input class="inp num" id="nRd" type="text" inputmode="numeric" placeholder="بۆ نموونە 35,000"></label><label class="f grow">نرخی جوملە بە دینار<input class="inp num" id="nWd" type="text" inputmode="numeric"></label></div>
    <p class="mute" style="margin:-6px 0 10px;font-size:13.5px">ئەگەر نرخەکە بە دینار بنووسیت، دۆلارەکەی هەموو ڕۆژێک بە نرخی دۆلار خۆی هەژمار دەکرێت. تەنها ئەگەر کاڵاکە بە دۆلار نرخی جێگیرە، خانەکانی خوارەوە پڕ بکەوە.</p>
    <div class="row"><label class="f grow">نرخی تاک ${CUR()}<input class="inp num" id="nR" type="text" inputmode="decimal"></label><label class="f grow">نرخی جوملە ${CUR()}<input class="inp num" id="nW" type="text" inputmode="decimal"></label><label class="f grow"><span>نرخی کڕین ${CUR()}</span><input class="inp num" id="nC" type="text" inputmode="decimal" placeholder="${own ? 'سعری هاتن' : 'تەنها بەڕێوەبەر دەیبینێت'}"></label></div>
    <label class="f nqty"><span>چەند دانە هاتووە؟</span><input class="inp num" id="nQ" type="text" inputmode="numeric" placeholder="0"></label>
    <div class="row nsplit">${S.branches.map((x, k) => `<label class="f grow"><span>بۆ ${esc(x)}</span><input class="inp num nS" data-k="${k}" type="text" inputmode="numeric" placeholder="0"></label>`).join('')}</div><p class="mute" id="nSplitNote" style="font-size:13.5px;margin:-4px 0 8px">هەمووی دەچێتە ${esc(S.branches[S.branch])}؛ ئەگەر دەتەوێت بەشێکی بۆ لقەکەی تر بێت، لێرە دابەشی بکە.</p>
    <div class="acts"><button class="btn volt" id="nOk">داخیلکردن</button><button class="ghost" id="nNo">پاشگەزبوونەوە</button></div>`);
  $('#nNo').onclick = closeModal;
  const nS = () => [...document.querySelectorAll('.nS')], nQ = () => Math.max(0, Math.floor(pn($('#nQ').value) || 0));
  const spread = changed => { const q = nQ(), b = S.branch, others = nS().filter(x => +x.dataset.k !== b), mineEl = nS().find(x => +x.dataset.k === b);   // the rest always lands in this branch
    if (changed === mineEl) { const rest = q - (Math.floor(pn(mineEl.value) || 0)); if (others.length === 1) others[0].value = Math.max(0, rest); }
    else { const given = others.reduce((a, x) => a + (Math.floor(pn(x.value) || 0)), 0); mineEl.value = Math.max(0, q - given); }
    const sum = nS().reduce((a, x) => a + (Math.floor(pn(x.value) || 0)), 0); $('#nSplitNote').innerHTML = sum === q ? `دابەشکراوە: ${S.branches.map((x, k) => esc(x) + ' <b class="num">' + (Math.floor(pn(nS()[k].value) || 0)) + '</b>').join(' · ')}` : `<span class="tag r">کۆی دابەشکراو (<span class="num">${sum}</span>) لەگەڵ ژمارەی هاتوو (<span class="num">${q}</span>) وەک یەک نییە</span>`; };
  $('#nQ').oninput = () => spread(null); nS().forEach(x => x.oninput = () => spread(x));
  $('#nOk').onclick = () => { if (nS().reduce((a, x) => a + (Math.floor(pn(x.value) || 0)), 0) !== nQ()) return toast('ژمارەی دابەشکراو لەگەڵ ژمارەی هاتوو وەک یەک نییە', 1); const dv = s => { const v = $(s).value.trim(); return v === '' ? 0 : Math.round(pn(v, true)); }, p = { name: $('#nName').value.trim(), bc: $('#nBc').value.trim(), cat: $('#nCat').value.trim(), rd: dv('#nRd'), wd: dv('#nWd'), r: $('#nR').value.trim() === '' ? 0 : toC($('#nR').value), w: $('#nW').value.trim() === '' ? 0 : toC($('#nW').value), s: [...document.querySelectorAll('.nS')].map(x => Math.floor(pn(x.value) || 0)) };
    if ($('#nC').value.trim() !== '') p.c = toC($('#nC').value);
    run('newItem', p, () => { closeModal(); toast('بابەتەکە داخیل کرا'); V.items(); }); };
}
function editItem(it) { // name, kind, barcode, selling prices and the true number of pieces — for the manager and the supervisor
  modal(`<h2>دەستکاریی بابەت</h2>
    <label class="f">ناوی بابەت<input class="inp" id="xName" style="direction:ltr" autocomplete="off" value="${esc(it.name)}"></label>
    <div class="row"><label class="f grow">پۆل<input class="inp" id="xCat" list="cats" autocomplete="off" value="${esc(it.cat)}">${catList()}</label><label class="f grow">بارکۆد<input class="inp num" id="xBc" autocomplete="off" value="${esc(it.bc)}"></label></div>
    <div class="row"><label class="f grow">نرخی تاک بە دینار (جێگیر)<input class="inp num" id="xRd" type="text" inputmode="numeric" value="${it.rd || ''}" placeholder="بەتاڵ = نرخی دۆلار"></label><label class="f grow">نرخی جوملە بە دینار<input class="inp num" id="xWd" type="text" inputmode="numeric" value="${it.wd || ''}" placeholder="بەتاڵ = نرخی دۆلار"></label></div>
    <div class="row"><label class="f grow">نرخی تاک ${CUR()}${it.rd ? ' (لە دینارەوە هەژمار دەکرێت)' : ''}<input class="inp num" id="xR" type="text" inputmode="decimal" value="${amtOut(it.r)}"></label><label class="f grow">نرخی جوملە ${CUR()}<input class="inp num" id="xW" type="text" inputmode="decimal" value="${it.w ? amtOut(it.w) : ''}"></label></div>
    <div class="row">${S.branches.map((x, k) => `<label class="f grow"><span>دانە لە ${esc(x)} (ئێستا <span class="num">${it.s[k]}</span>)</span><input class="inp num xS" data-k="${k}" type="text" inputmode="numeric" value="${it.s[k]}"></label>`).join('')}</div>
    <label class="f">هۆکاری گۆڕینی ژمارەی دانە (ئەگەر گۆڕیت)<input class="inp" id="xWhy" maxlength="200" placeholder="بۆ نموونە: ژماردنی دووبارە" autocomplete="off"></label>
    <div class="acts"><button class="btn" id="xOk">هەڵگرتن</button><button class="ghost" id="xNo">پاشگەزبوونەوە</button></div>`);
  $('#xNo').onclick = closeModal;
  $('#xOk').onclick = () => { const st = [...document.querySelectorAll('.xS')].map(x => Math.floor(pn(x.value))), ch = st.map((n, k) => n !== it.s[k] ? k : -1).filter(k => k >= 0), why = $('#xWhy').value.trim();
    if (st.some(n => !(n >= 0))) return toast('ژمارەی دانە دروست نییە', 1); if (ch.length && !why) return toast('هۆکاری گۆڕینی ژمارەی دانە بنووسە', 1);
    const same = pn($('#xR').value, S.cur === 'IQD') === pn(amtOut(it.r), S.cur === 'IQD'), sameW = $('#xW').value.trim() === (it.w ? amtOut(it.w) : '');   // an untouched dinar price must not drift by rounding
    const dv = s => { const v = $(s).value.trim(); return v === '' ? 0 : Math.round(pn(v, true)); };
    run('editItem', { id: it.id, name: $('#xName').value.trim(), cat: $('#xCat').value.trim(), bc: $('#xBc').value.trim(), rd: dv('#xRd'), wd: dv('#xWd'), r: same ? it.r : toC($('#xR').value), w: sameW ? it.w : $('#xW').value.trim() === '' ? 0 : toC($('#xW').value) }, () => {
      let k = 0; const next = () => { if (k >= ch.length) { closeModal(); toast('هەڵگیرا'); return V.items(); } const b = ch[k++]; run('setStock', { branch: b, id: it.id, qty: st[b], why }, next); }; next(); }); };
}
function delItem(it) {
  const left = it.s.reduce((a, n) => a + n, 0);
  modal(`<h2>ڕەشکردنەوەی بابەت</h2><p class="en" style="text-align:left;font-weight:700;margin-bottom:6px">${esc(it.name)}</p><p class="mute" style="margin-bottom:12px">لە هەموو لیستەکان لادەچێت و ئیتر نافرۆشرێت. ${left ? `<b>ئێستا <span class="num">${left}</span> دانەی لە کۆگایە.</b> ` : ''}پسولە کۆنەکانی وەک خۆیان دەمێنن و بەڕێوەبەر دەتوانێت بیگەڕێنێتەوە.</p>
    <label class="f">هۆکار<input class="inp" id="dlW" maxlength="200" placeholder="بۆ نموونە: بە هەڵە داخیل کرابوو" autocomplete="off"></label>
    <div class="acts"><button class="btn red" id="dlOk">ڕەشی بکەوە</button><button class="ghost" id="dlNo">نەخێر</button></div>`);
  $('#dlNo').onclick = closeModal; $('#dlOk').onclick = () => run('deleteItem', { id: it.id, why: $('#dlW').value.trim() }, () => { closeModal(); toast('ڕەش کرایەوە'); V.items(); });
}
function itemHistory(it) { // everything that ever happened to one item: sold, returned, swapped, received, given away — with dates
  const ev = [], T = x => Core.ms(x), own = isOwner();
  S.sales.forEach(s => s.lines.forEach(l => { if (l.id !== it.id) return; ev.push({ t: T(s.t), k: 'فرۆشتن', c: 'g', q: -l.qty, b: s.branch, by: s.by, x: `پسولەی #${s.no} · ${fmtMoney(l.price)}`, no: s.no }); }));
  S.sales.forEach(s => (s.rets || []).forEach(r => (r.items || []).forEach(x => { if (x.id === it.id) ev.push({ t: T(r.t), k: 'گەڕاوە', c: 'r', q: x.qty, b: s.branch, by: r.by, x: `پسولەی #${s.no} · ${r.why || ''}`, no: s.no }); })));
  S.exchanges.forEach(x => { if (x.id === it.id) ev.push({ t: T(x.t), k: 'گۆڕین بە نوێ', c: 'b', q: -x.qty, b: x.branch, by: x.by, x: `پسولەی #${x.no} · ${x.why}`, no: x.no }); });
  S.purchases.forEach(x => { if (x.id === it.id) ev.push({ t: T(x.t), k: 'داخیلکردن', c: 'b', q: x.qty, b: x.branch, by: x.by, x: x.d ? 'بەرواری هاتن ' + dmy(x.d) : '' }); });
  (S.gifts || []).forEach(x => { if (x.item === it.id) ev.push({ t: T(x.t), k: 'خەڵات', c: 'a', q: -x.qty, b: x.branch, by: x.by, x: x.note }); });
  ev.sort((a, b) => b.t - a.t);
  const sold = ev.filter(e => e.k === 'فرۆشتن').reduce((a, e) => a - e.q, 0), ret = ev.filter(e => e.k === 'گەڕاوە').reduce((a, e) => a + e.q, 0), inn = ev.filter(e => e.k === 'داخیلکردن').reduce((a, e) => a + e.q, 0), first = ev.length ? ev[ev.length - 1].t : 0;
  modal(`<h2>داتای تەواوی بابەت</h2><div class="ihead">${stockRing(it, thumb(it, 34, 'lg'), 92)}<p class="en" style="text-align:left;font-weight:800;font-size:17px;margin-bottom:4px">${esc(it.name)}</p></div><p class="mute num" style="margin-bottom:12px;text-align:left">${esc(it.bc) || '— بێ بارکۆد'} · ${esc(it.cat)}</p>
    <div class="ihk">${S.branches.map((x, k) => `<div><small>ماوە لە ${esc(x)}</small><b class="num">${it.s[k]}</b></div>`).join('')}<div><small>فرۆشراو</small><b class="num" id="ihSold">${sold}</b></div><div><small>گەڕاوە</small><b class="num">${ret}</b></div><div><small>داخیلکراو</small><b class="num">${inn}</b></div><div><small>نرخی تاک</small><b class="num">${fmtMoney(it.r)}</b></div>${own && it.c != null ? `<div><small>نرخی کڕین</small><b class="num">${fmtMoney(it.c)}</b></div>` : ''}</div>
    <div class="scroll ihs">${ev.length ? `<table class="wt"><tr><th>بەروار</th><th>چی</th><th>دانە</th><th>لق</th><th>کێ</th><th>وردەکاری</th></tr>${ev.slice(0, 300).map(e => `<tr><td>${hm(new Date(e.t))}<small class="num">${D8(e.t)}</small></td><td><span class="tag ${e.c}">${e.k}</span></td><td class="num"><b>${e.q > 0 ? '+' : '−'}${Math.abs(e.q)}</b></td><td>${esc(S.branches[e.b] || '')}</td><td class="en">${esc(e.by || '')}</td><td class="wwhy">${esc(e.x)}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ جموجۆڵێکی نییە</b></div>'}</div>
    <div class="acts"><button class="ghost" id="ihX">داخستن</button></div>`);
  $('#sheet').style.width = 'min(880px,100%)'; $('#ihX').onclick = () => { $('#sheet').style.width = ''; closeModal(); };
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
  $('#view').innerHTML = `<div class="kgrid"><div class="card kpi"><small>کڕیاران</small><b class="num">${S.customers.length}</b></div><div class="card kpi"><small>قەرزداران</small><b class="num">${debtors.length}</b></div><div class="card kpi"><small>کۆی قەرز</small><b id="debtAll">${money(total)}</b></div></div>
    <div class="row" style="margin-bottom:14px"><input class="inp grow" id="cQ" placeholder="گەڕان بە ناو یان مۆبایل" value="${esc(q)}"><button class="btn" id="cNew">کڕیاری نوێ</button></div>
    <div class="card scroll"><table><tr><th>ناو</th><th>مۆبایل</th><th>ناونیشان</th><th>قەرز</th><th></th></tr>${list.map(c => `<tr><td class="en">${esc(c.name)}</td><td class="num">${esc(c.phone) || '—'}</td><td class="en">${esc(c.addr) || '—'}</td><td>${c.debt > 0 ? `<span class="tag r">${money(c.debt)}</span>` : '<span class="tag g">قەرزدار نییە</span>'}</td><td><div class="row"><button class="ghost sm" data-cd="${c.id}">وردەکاری</button>${c.debt > 0 ? `<button class="ghost sm" data-p="${c.id}">پارەدانەوە</button>` : ''}</div></td></tr>`).join('')}</table></div>`;
  $('#view').querySelectorAll('[data-cd]').forEach(b => b.onclick = () => custSheet(cust(+b.dataset.cd)));
  const i = $('#cQ'); i.oninput = () => { V.customers(i.value); const n = $('#cQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('#view').querySelectorAll('[data-p]').forEach(b => b.onclick = () => payDebt(cust(+b.dataset.p)));
  $('#cNew').onclick = () => { modal(`<h2>کڕیاری نوێ</h2><label class="f">ناو<input class="inp" id="kN"></label><label class="f">مۆبایل<input class="inp num" id="kP" inputmode="tel"></label><label class="f">ناونیشان<input class="inp" id="kA"></label><div class="acts"><button class="btn" id="kOk">دروستکردن</button><button class="ghost" id="kNo">پاشگەزبوونەوە</button></div>`);
    $('#kNo').onclick = closeModal; $('#kOk').onclick = () => run('newCustomer', { name: $('#kN').value.trim(), phone: $('#kP').value.trim(), addr: $('#kA').value.trim() }, () => { closeModal(); V.customers(); }); };
};
function custSheet(c, q = '') { // a wholesaler: every receipt, every piece and every serial sold to him; from here a piece is swapped or settled
  const sales = S.sales.filter(s => s.customer === c.id), lines = []; sales.forEach(s => s.lines.forEach((l, i) => lines.push({ s, l, i })));
  const pcs = lines.reduce((a, x) => a + x.l.qty - x.l.ret, 0), tot = sales.reduce((a, s) => a + s.total - s.refunded, 0), sns = lines.reduce((a, x) => a + (x.l.sn || []).length, 0), bad = sales.reduce((a, s) => a + (s.rets || []).filter(r => r.faulty).reduce((b, r) => b + (r.items || []).reduce((d, i) => d + i.qty, 0), 0), 0);
  const lo = q.trim().toLowerCase(), rows = !lo ? lines : lines.filter(x => x.l.name.toLowerCase().includes(lo) || String(x.s.no).includes(lo) || (x.l.sn || []).some(n => n.toLowerCase().includes(lo)));
  modal(`<h2>${esc(c.name)}</h2><p class="mute num" style="margin-bottom:12px">${esc(c.phone) || '—'}${c.addr ? ' · ' + esc(c.addr) : ''}</p>
    <div class="ihk"><div><small>پسولە</small><b class="num">${sales.length}</b></div><div><small>دانەی کڕیوە</small><b class="num" id="csPcs">${pcs}</b></div><div><small>کۆی کڕین</small><b class="num">${fmtMoney(tot)}</b></div><div><small>قەرزی ئێستا</small><b class="num">${fmtMoney(c.debt)}</b></div><div><small>سریاڵی تۆمارکراو</small><b class="num">${sns}</b></div><div><small>دانەی عاتڵ</small><b class="num">${bad}</b></div></div>
    <input class="inp" id="csQ" placeholder="گەڕان بە ناوی کاڵا، ژمارەی پسولە یان سریاڵ (سکانی بکە)" autocomplete="off" value="${esc(q)}" style="margin-bottom:10px">
    <div class="scroll ihs">${rows.length ? `<table class="wt"><tr><th>کات</th><th>پسولە</th><th>کاڵا و سریاڵ</th><th>دانە</th><th>نرخ</th><th>زەمان</th><th></th></tr>${rows.slice(0, 300).map(({ s, l }) => `<tr><td>${hm(new Date(Core.ms(s.t)))}<small class="num">${D8(s.t)}</small></td><td class="num"><b>#${s.no}</b></td><td class="dfi"><span class="en">${esc(l.name)}</span>${(l.sn || []).length ? `<small class="num">S/N ${l.sn.map(esc).join(' · ')}</small>` : ''}${l.ret ? ` <span class="tag r">گەڕاوەتەوە <span class="num">${l.ret}</span></span>` : ''}${l.exch ? ` <span class="tag b">گۆڕدراوە <span class="num">${l.exch}</span></span>` : ''}</td><td class="num"><b>${l.qty}</b></td><td>${money(l.price)}</td><td>${wTag(s, l)}</td><td>${lvl() > 1 ? `<button class="ghost sm" data-co="${s.no}">گەڕاوە / گۆڕین</button>` : ''}</td></tr>`).join('')}</table>` : `<div class="empty"><b>${lo ? 'هیچ شتێک نەدۆزرایەوە' : 'هێشتا هیچی نەکڕیوە'}</b></div>`}</div>
    <div class="acts"><button class="ghost" id="csX">داخستن</button></div>`);
  $('#sheet').style.width = 'min(940px,100%)'; const shut = () => { $('#sheet').style.width = ''; closeModal(); };
  $('#csX').onclick = shut;
  const i = $('#csQ'); i.oninput = () => { custSheet(c, i.value); const n = $('#csQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  document.querySelectorAll('[data-co]').forEach(b => b.onclick = () => { shut(); warNo = +b.dataset.co; warSn = ''; go('warranty'); });
}
function payDebt(c) {
  modal(`<h2>پارەدانەوەی قەرز</h2><p style="margin-bottom:12px"><b>${esc(c.name)}</b> — قەرزی ئێستا ${money(c.debt)}</p><label class="f">بڕی وەرگیراو ${CUR()}<input class="inp num" id="yA" type="text" inputmode="decimal" step="0.01" min="0.01" value="${amtOut(c.debt)}"></label><label class="f">چۆن وەرگیرا<select class="inp" id="yM"><option value="cash">کاش</option><option value="fib">FIB</option></select></label><div class="acts"><button class="btn green" id="yOk">وەرگرتن</button><button class="ghost" id="yNo">پاشگەزبوونەوە</button></div>`);
  $('#yNo').onclick = closeModal;
  $('#yOk').onclick = () => { // dinar is rounded to 250: paying the shown full amount must clear the debt exactly
    const typed = $('#yA').value, full = pn(typed, S.cur === 'IQD') === pn(amtOut(c.debt), S.cur === 'IQD');
    let amt = full ? c.debt : toC(typed);
    if (S.cur === 'IQD' && amt > c.debt && amt - c.debt <= Math.ceil(25000 / S.rate)) amt = c.debt;
    run('payDebt', { customer: c.id, amt, method: $('#yM').value, cur: S.cur }, () => { closeModal(); toast('وەرگیرا'); V.customers(); });
  };
}

/* ---------- expenses ---------- */
V.expenses = () => {
  const t0 = Core.dayStart(S, new Date()), mine = S.expenses.filter(e => (lvl() > 1 || e.branch === S.branch) && Core.ms(e.t) >= t0);
  $('#view').innerHTML = `<div class="two"><div class="card pad"><h2 style="margin-bottom:14px">مەسروفی نوێ — ${esc(S.branches[S.branch])}</h2>
    <label class="f">چی مەسروف کراوە؟ (بە دەستی خۆت بینووسە)<input class="inp" id="eC" placeholder="بۆ نموونە: چاککردنی کارەبای دوکان" autocomplete="off" maxlength="120"></label>
    <div class="chips" style="margin:-4px 0 14px">${EXP_CATS.filter(c => c !== 'هیتر').map(c => `<button class="chip" data-ec="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="f" style="margin-bottom:6px">بڕی پارە</label><div class="row hform" style="margin-bottom:14px"><input class="inp num grow" id="eA" type="text" inputmode="decimal" autocomplete="off" placeholder="0"><div class="seg" id="eCur"><button data-ecur="IQD" class="on">دینار</button><button data-ecur="USD">دۆلار $</button></div></div><label class="f">تێبینی (ئارەزوومەندانە)<input class="inp" id="eN"></label><button class="btn volt" id="eOk">تۆمارکردن</button></div>
    <div class="card pad"><div class="row sp"><h2>مەسروفەکانی ئەمڕۆ</h2><b>${money(mine.reduce((a, e) => a + e.amt, 0))}</b></div>${mine.map(e => `<div class="item"><div class="dot n">${ico('expenses', 17)}</div><div class="grow"><p><b>${esc(e.cat)}</b>${e.note ? ' — ' + esc(e.note) : ''}</p><small>${esc(e.by)} · ${esc(S.branches[e.branch])} · ${hm(e.t)}</small></div><b class="num">${e.amtD != null ? DIN(e.amtD) : fmtMoney(e.amt)}</b></div>`).join('') || '<div class="empty"><b>هیچ مەسروفێک تۆمار نەکراوە</b></div>'}</div></div>`;
  $('#view').querySelectorAll('[data-ec]').forEach(b => b.onclick = () => { $('#eC').value = b.dataset.ec; $('#eA').focus(); });
  let ecur = 'IQD'; $('#view').querySelectorAll('[data-ecur]').forEach(x => x.onclick = () => { ecur = x.dataset.ecur; $('#view').querySelectorAll('[data-ecur]').forEach(y => y.classList.toggle('on', y === x)); });
  $('#eOk').onclick = () => { const raw = $('#eA').value, d = ecur === 'IQD' ? Math.round(pn(raw, true)) : 0, amt = ecur === 'IQD' ? Math.round(d / S.rate * 100) : Math.round(pn(raw) * 100);
    run('expense', { cat: $('#eC').value.trim(), amt, note: $('#eN').value.trim(), cur: ecur, ...(ecur === 'IQD' ? { amtD: d } : {}) }, () => { toast('تۆمار کرا'); V.expenses(); }); };
};

/* ---------- owner: dashboard, sales, log ---------- */
/* what sold most: this week (from Saturday) or this month, by pieces (net of pieces given back) */
function topItems() {
  const per = S.topPer || 'week', b = S.dashBranch, inB = x => b < 0 || x.branch === b, D = 864e5, t0 = Core.dayStart(S, new Date()), now = new Date();
  const from = per === 'week' ? t0 - ((now.getDay() + 1) % 7) * D : t0 - (now.getDate() - 1) * D, agg = {};
  S.sales.forEach(x => { if (!inB(x) || Core.ms(x.t) < from) return; (x.lines || []).forEach(l => { const n = l.qty - l.ret; if (n <= 0) return; const a = agg[l.id] || (agg[l.id] = { id: l.id, name: l.name, n: 0, v: 0 }); a.n += n; a.v += n * l.price; }); });
  const list = Object.values(agg).sort((a, c) => c.n - a.n || c.v - a.v).slice(0, 8), mx = list.length ? list[0].n : 1, total = Object.values(agg).reduce((a, x) => a + x.n, 0);
  return `<div class="card pad topc" id="topItems"><div class="row sp" style="flex-wrap:wrap;gap:8px"><h2>زۆرترین فرۆشراو</h2><div class="row" style="gap:6px;flex-wrap:wrap">${total ? `<span class="tag n">کۆی دانە: <span class="num">${total.toLocaleString('en-US')}</span></span>` : ''}<div class="seg" style="padding:3px">${[['week', 'ئەم هەفتەیە'], ['month', 'ئەم مانگە']].map(([k, v]) => `<button data-top="${k}" class="${per === k ? 'on' : ''}" style="padding:5px 12px">${v}</button>`).join('')}</div></div></div>
    ${list.map((x, i) => `<div class="topr" style="--i:${i}"><span class="medal m${Math.min(i + 1, 4)} num">${i + 1}</span><div class="grow"><div class="row sp" style="gap:10px"><b class="en" data-top-name="${i}">${esc(x.name)}</b><span class="row" style="gap:10px;flex:none"><b class="num" data-top-n="${i}">${x.n.toLocaleString('en-US')} دانە</b><span class="num mute">${fmtMoney(x.v)}</span></span></div><div class="bar"><i style="width:${x.n / mx * 100}%"></i></div></div></div>`).join('') || `<div class="empty"><b>${per === 'week' ? 'ئەم هەفتەیە' : 'ئەم مانگە'} هێشتا هیچ نەفرۆشراوە</b></div>`}</div>`;
}
/* daily sales as one smooth line; the best day is marked */
function dayLine() {
  const n = S.chartDays || 14, b = S.dashBranch, inB = x => b < 0 || x.branch === b, D = 864e5, start = Core.dayStart(S, new Date()) - (n - 1) * D, v = Array(n).fill(0);
  const slot = t => Math.floor((Core.ms(t) - start) / D);
  S.sales.forEach(x => { if (inB(x)) { const k = slot(x.t); if (k >= 0 && k < n) v[k] += x.total; } (x.rets || []).forEach(r => { if (inB(r)) { const k = slot(r.t); if (k >= 0 && k < n) v[k] -= r.amt; } }); if (!x.rets && x.refunded && inB(x)) { const k = slot(x.t); if (k >= 0 && k < n) v[k] -= x.refunded; } });
  const mx = Math.max(...v, 1), top = Math.max(...v), best = top > 0 ? v.indexOf(top) : -1, days = v.filter(x => x > 0), avg = days.length ? Math.round(days.reduce((a, x) => a + x, 0) / days.length) : 0;
  const W = 1000, H = 230, px = 26, pt = 30, pb = 34, X = i => W - px - i * (W - 2 * px) / (n - 1), Y = y => pt + (1 - Math.max(0, y) / mx) * (H - pt - pb);   // newest day on the left, like the rest of the page
  const P = v.map((y, i) => [X(i), Y(y)]); let d = `M${P[0][0]},${P[0][1]}`;
  for (let i = 0; i < n - 1; i++) { const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2, c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(H - pb, Math.max(pt, p1[1] + (p2[1] - p0[1]) / 6))], c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(H - pb, Math.max(pt, p2[1] - (p3[1] - p1[1]) / 6))]; d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  const dt = i => new Date(start + i * D + 12 * 36e5), lab = i => { const x = dt(i); return x.getDate() + '/' + (x.getMonth() + 1); }, every = Math.max(1, Math.ceil(n / (innerWidth <= 760 ? 5 : 10))), near = (i, j) => j >= 0 && i !== j && Math.abs(i - j) < every, show = i => i === best || (i === n - 1 && !near(i, best)) || (i % every === 0 && !near(i, best) && !near(i, n - 1));   // dates never run into each other
  return `<div class="card pad linec"><div class="row sp" style="flex-wrap:wrap;gap:8px"><h2>فرۆشی ڕۆژانە</h2><div class="row" style="flex-wrap:wrap;gap:6px">${best >= 0 ? `<span class="tag g" id="bestDay">باشترین ڕۆژ: <span class="num">${lab(best)}</span> · <span class="num">${fmtMoney(top)}</span></span><span class="tag n">تێکڕای ڕۆژ: <span class="num">${fmtMoney(avg)}</span></span>` : ''}<div class="seg" style="padding:3px">${[7, 14, 30].map(k => `<button data-days="${k}" class="${n === k ? 'on' : ''}" style="padding:5px 12px"><span class="num">${k}</span> ڕۆژ</button>`).join('')}</div></div></div>
    ${best < 0 ? '<div class="empty"><b>هێشتا فرۆشتن نییە</b>لەگەڵ یەکەم فرۆشتن هێڵەکە دەست پێدەکات</div>' : `<div class="lnwrap"><svg class="lnsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sv" stop-opacity=".32"/><stop offset="1" class="sv" stop-opacity="0"/></linearGradient><linearGradient id="ls" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="sv"/><stop offset="1" class="sc"/></linearGradient></defs>
      ${[0, .5, 1].map(f => `<line x1="${px}" x2="${W - px}" y1="${Y(mx * f)}" y2="${Y(mx * f)}" class="gl"/>`).join('')}
      <path class="ar" d="${d} L${X(n - 1)},${H - pb} L${X(0)},${H - pb} Z" fill="url(#lg)"/><path class="ln" d="${d}" pathLength="1" fill="none" stroke="url(#ls)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line x1="${X(best)}" x2="${X(best)}" y1="${Y(top)}" y2="${H - pb}" class="bl"/></svg>
      <div class="lnx">${v.map((y, i) => `<span style="right:${(px + i * (W - 2 * px) / (n - 1)) / W * 100}%" class="${i === best ? 'bst' : ''}">${show(i) ? lab(i) : ''}</span>`).join('')}<i class="bdot" style="right:${(px + best * (W - 2 * px) / (n - 1)) / W * 100}%;top:${Y(top) / H * 100}%"></i></div></div>`}</div>`;
}
/* what the manager should look at today: everything where money or stock could go missing */
function watchCard(t0) {
  const td = x => Core.ms(x.t) >= t0, F = [], staffNames = new Set(S.team.filter(u => u.role === 'staff').map(u => u.name));
  S.sales.forEach(x => {
    if (x.pay === 'fib' && !x.fibChecked && !x.legacy) F.push({ c: 'b', i: 'check', h: `FIB پشتڕاست نەکراوە: پسولەی <b class="num">#${x.no}</b> · ${money(x.total)} · ژمارەی مامەڵە <b class="num">${esc(x.fibRef) || '—'}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}`, b: `<button class="btn green sm" data-fv="${x.no}">بینیم لە FIB</button>` });
    (x.rets || []).forEach(r => { if (td(r)) F.push({ c: 'r', i: 'returns', h: `گەڕاندنەوەی ${money(r.amt)} لە پسولەی <b class="num">#${x.no}</b> — ${esc(r.why || '')}`, s: `${esc(r.by || '')} · ${esc(S.branches[r.branch])} · ${hm(r.t)}` }); });
    if (td(x) && x.pay === 'debt') F.push({ c: 'a', i: 'customers', h: `فرۆشتن بە قەرز: ${money(x.total)} بۆ ${esc((cust(x.customer) || {}).name || '')} · پسولەی <b class="num">#${x.no}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
    if (td(x) && !x.legacy && x.type === 'wholesale' && staffNames.has(x.by)) F.push({ c: 'a', i: 'pos', h: `کارمەند بە نرخی جوملە فرۆشتی: ${money(x.total)} · پسولەی <b class="num">#${x.no}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
    if (td(x) && Math.abs(x.diffD || 0) >= 100) F.push({ c: x.diffD < 0 ? 'r' : 'a', i: 'diff', h: `پارەی وەرگیراو <b>${x.diffD < 0 ? 'کەمە' : 'زیادە'} <span class="num">${Math.abs(x.diffD).toLocaleString('en-US')}</span> د.ع</b> · پسولەی <b class="num">#${x.no}</b> · ${money(x.total)}`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
    if (td(x) && x.disc) F.push({ c: 'a', i: 'alert', h: `داشکاندنی ${money(x.disc)} لە پسولەی <b class="num">#${x.no}</b>`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` });
  });
  S.exchanges.forEach(x => { if (td(x)) F.push({ c: 'b', i: 'returns', h: `گۆڕینی زەمانەت: <span class="num">${x.qty}</span> دانە لە پسولەی <b class="num">#${x.no}</b> — ${esc(x.why)}`, s: `${esc(x.by)} · ${esc(S.branches[x.branch])} · ${hm(x.t)}` }); });
  S.log.forEach(e => { if (td(e) && e.kind === 'stock' && /^کەمکردنەوەی/.test(e.text)) F.push({ c: 'r', i: 'items', h: e.text, s: `${esc(e.by)} · ${esc(S.branches[e.branch])} · ${hm(e.t)}` }); });
  (S.closes || []).forEach(c => { if (td(c) && c.diff) F.push({ c: c.diff < 0 ? 'r' : 'a', i: 'expenses', h: `قاصە ${c.diff < 0 ? 'کەمە' : 'زیادە'} ${money(Math.abs(c.diff))} — ژمێردراو ${money(c.counted)}، دەبوو ${money(c.expected)} بێت`, s: `${esc(c.by)} · ${esc(S.branches[c.branch])} · ${hm(c.t)}` }); });
  S.jards.forEach(j => { if (td(j)) { const miss = j.rows.reduce((a, r) => a + Math.max(0, -r.diff), 0); if (miss) F.push({ c: 'r', i: 'jard', h: `جەرد: <span class="num">${miss}</span> دانە کەمە`, s: `${esc(j.by)} · ${esc(S.branches[j.branch])} · ${hm(j.t)}` }); } });
  return `<div class="card pad ${F.some(f => f.c === 'r') ? 'wait' : ''}" id="watch"><div class="row sp"><h2>چاودێریی ئەمڕۆ</h2>${F.length ? `<span class="tag ${F.some(f => f.c === 'r') ? 'r' : 'a'} num" id="watchN">${F.length}</span>` : ''}</div><p class="mute" style="font-size:14px;margin-bottom:4px">هەر شوێنێک کە پارە یان کاڵا دەتوانێت تێیدا ون ببێت.</p>
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
    <div class="card ringc"><div class="ring"><svg viewBox="0 0 250 250" width="250" height="250"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="sc"/><stop offset="1" class="sv"/></linearGradient></defs>
        <circle class="ticks" cx="125" cy="125" r="121" fill="none" stroke-width="5" stroke-dasharray="1.5 11.17"/><circle class="trk" cx="125" cy="125" r="${R}" fill="none" stroke-width="13"/>
        <circle class="arc" id="arc" cx="125" cy="125" r="${R}" fill="none" stroke-width="13" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - pct)}"/></svg>
      <div class="mid"><small>فرۆشی ئەمڕۆ</small>${cu(net, 'kSold')}<em class="units"><span class="num" id="kUnits">${units.toLocaleString('en-US')}</span> دانە فرۆشراوە</em><span><span class="num">${Math.round(net / S.target * 100)}%</span> لە ئامانج</span></div></div>
      <button class="ghost sm" id="tgt" style="margin-top:10px">ئامانجی ڕۆژانە: <span class="num">${fmtMoney(S.target)}</span></button></div>
    <div class="kwrap"><div class="kgrid k4">
        <div class="card kpi"><small><span class="ic">${ico('sales', 15)}</span>پسولە</small>${cuInt(sales.length, 'kCount')}</div>
        <div class="card kpi"><small><span class="ic">${ico('returns', 15)}</span>گەڕاوە</small>${cu(refunded, 'kRef')}</div>
        <div class="card kpi"><small><span class="ic">${ico('expenses', 15)}</span>کاشی ناو قاصە</small>${cu(cashIn - cashOut, 'kDrawer')}</div>
        <div class="card kpi"><small><span class="ic">${ico('check', 15)}</span>وەرگیراو بە FIB</small>${cu(fibNet, 'kFib')}</div></div>
      <div class="card pad"><div class="row sp"><h2>فرۆشتن بە پێی کاتژمێر</h2>${own ? `<span class="tag ${known ? 'g' : 'n'}" id="kProfit" title="قازانج تەنها بۆ بەڕێوەبەر دەردەکەوێت">قازانج: ${known ? `<span class="num">${fmtMoney(profit)}</span>${unknown ? ' (بەشێک)' : ''}` : 'نرخی کڕین دانەنراوە'}</span>` : ''}</div>
        <div class="bars">${hrs.map((h, i) => `<div><i class="${by[i] ? '' : 'z'} ${h === nowH ? 'now' : ''}" style="--i:${i};height:${Math.max(3, by[i] / mx * 100)}%" title="${fmtMoney(by[i])}"></i><s>${h % 12 || 12}</s></div>`).join('')}</div></div></div></div>
    <div class="brs">${brs.map(x => `<div class="card pad"><div class="row sp"><h2>${esc(x.nm)}</h2><span class="tag ${x.n ? 'g' : 'n'}">${x.n ? `<span class="num">${x.n}</span> پسولە` : 'هێشتا فرۆشتن نییە'}</span></div><div class="row sp" style="margin-top:10px;align-items:flex-end"><div><small class="mute">فرۆشی ئەمڕۆ</small><div class="bv">${cu(x.v)}</div><small class="units"><span class="num" data-bu="${x.k}">${x.u.toLocaleString('en-US')}</span> دانە</small></div><div style="text-align:left"><small class="mute">مەسروف ${money(x.ex)}</small><br><small class="mute"><span class="num">${x.act}</span> جموجۆڵ</small></div></div><div class="duel"><div class="bar"><i style="width:${x.v / brMax * 100}%"></i></div></div><div class="row" style="margin-top:12px;flex-wrap:wrap;gap:6px"><span class="tag g">کاش ${money(x.cash)}</span><span class="tag b">FIB ${money(x.fib)}</span><span class="tag a">قەرز ${money(x.debt)}</span></div></div>`).join('')}</div>
    ${dayLine()}
    ${topItems()}
    <div class="two"><div style="display:grid;gap:18px">
      ${own ? watchCard(t0) : ''}
      ${own ? `<div class="card pad ${wait.length ? 'wait' : ''}"><div class="row sp"><h2>چاوەڕوانی ڕەزامەندیی تۆ</h2>${wait.length ? `<span class="tag a num">${wait.length}</span>` : ''}</div>${wait.map(a => `<div class="item"><div class="dot a">${ico('alert', 17)}</div><div class="grow"><p><b>${esc(a.by)}</b> داوای داشکاندنی ${money(a.amt)} دەکات لەسەر ${money(a.sub)}</p><small>${a.why ? esc(a.why) + ' · ' : ''}${esc(S.branches[a.branch])} · ${hm(a.t)}</small></div><div class="row"><button class="btn green sm" data-ok="${a.id}">ڕازیم</button><button class="ghost sm" data-no="${a.id}">نا</button></div></div>`).join('') || '<div class="empty"><b>هیچ داواکارییەک نییە</b>داواکاریی داشکاندنی کارمەندەکان لێرە دەردەکەوێت</div>'}</div>` : ''}
      <div class="card pad"><h2>دوایین کارەکان</h2>${S.log.filter(inB).slice(0, 7).map(feedRow).join('') || '<div class="empty"><b>هێشتا هیچ شتێک ڕووی نەداوە</b></div>'}</div></div>
    <div style="display:grid;gap:18px">
      <div class="card pad"><h2>فرۆشی کارمەندەکان</h2><div class="duel">${Object.entries(staff).map(([n, v]) => `<div><div class="row sp"><span class="row"><span class="av" style="width:30px;height:30px;border-radius:9px;font-size:14px">${esc(n[0].toUpperCase())}</span><b class="en">${esc(n)}</b><small class="mute"><span class="num">${v.n}</span> پسولە · <span class="num">${v.u}</span> دانە</small></span><b class="num">${fmtMoney(v.sum)}</b></div><div class="bar" style="margin-top:8px"><i style="width:${v.sum / maxStaff * 100}%"></i></div></div>`).join('') || '<div class="empty">هێشتا فرۆشتن نییە</div>'}</div></div>
      <div class="card pad"><h2>کاڵای کەمبوو</h2>${low.map(i => `<div class="item lowi" style="align-items:center"><div class="grow"><p class="en" style="text-align:left;font-weight:600">${esc(i.name)}</p></div>${i.s.map((n, k) => b < 0 || b === k ? `<span class="row" style="gap:6px"><small>${esc(S.branches[k])}</small>${bat(n)}</span>` : '').join('')}</div>`).join('') || '<div class="empty">هەموو کاڵاکان بە بڕی باش هەن</div>'}</div></div></div>`;
  $('#view').querySelectorAll('[data-days]').forEach(x => x.onclick = () => { S.chartDays = +x.dataset.days; render(true); });
  $('#view').querySelectorAll('[data-top]').forEach(x => x.onclick = () => { S.topPer = x.dataset.top; render(true); });
  $('#view').querySelectorAll('[data-fv]').forEach(x => x.onclick = () => run('fibVerify', { no: +x.dataset.fv }, () => { toast('پشتڕاست کرایەوە'); render(); }));
  const arc = $('#arc'); if (MO()) requestAnimationFrame(() => requestAnimationFrame(() => arc.style.strokeDashoffset = arc.dataset.off)); else arc.style.strokeDashoffset = arc.dataset.off;
  $('#tgt').onclick = () => { if (!own) return toast('تەنها بەڕێوەبەر ئامانج دەگۆڕێت', 1); modal(`<h2>ئامانجی ڕۆژانە</h2><label class="f">بڕ بە ${CUR()}<input class="inp num" id="tA" type="text" inputmode="decimal" min="1" step="1" value="${amtOut(S.target)}"></label><div class="acts"><button class="btn volt" id="tOk">هەڵگرتن</button><button class="ghost" id="tNo">پاشگەزبوونەوە</button></div>`); $('#tNo').onclick = closeModal; $('#tOk').onclick = () => run('setTarget', { target: toC($('#tA').value) }, () => { closeModal(); render(true); }); };
  const decide = (id, ok) => run('decideRequest', { id, ok }, () => { render(); $('#arc').style.strokeDashoffset = $('#arc').dataset.off; });
  $('#view').querySelectorAll('[data-ok]').forEach(x => x.onclick = () => decide(+x.dataset.ok, true));
  $('#view').querySelectorAll('[data-no]').forEach(x => x.onclick = () => decide(+x.dataset.no, false));
};
const isoD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGES = { day: 'ئەمڕۆ', week: 'ئەم هەفتەیە', month: 'ئەم مانگە' };
/* a «from – to» date bar for any screen: quick choices plus two date boxes */
const RG2 = { today: 'ئەمڕۆ', yday: 'دوێنێ', week: 'ئەم هەفتەیە', month: 'ئەم مانگە', last: 'مانگی پێشوو' };
function rangeOf(k) { const to = new Date(), from = new Date();
  if (k === 'yday') { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); }
  if (k === 'week') from.setDate(from.getDate() - ((from.getDay() + 1) % 7));
  if (k === 'month') from.setDate(1);
  if (k === 'last') { from.setDate(1); from.setMonth(from.getMonth() - 1); to.setDate(0); }
  return { key: k, from: isoD(from), to: isoD(to) }; }
const rangeBar = (r, id) => `<div class="rbar"><div class="chips">${Object.entries(RG2).map(([k, v]) => `<button class="chip ${r.key === k ? 'on' : ''}" data-${id}r="${k}">${v}</button>`).join('')}</div>
  <div class="row rdates"><span class="mute">لە ڕێکەوتی</span>${dateBox(`${id}From`, r.from)}<span class="mute">تا</span>${dateBox(`${id}To`, r.to)}</div></div>`;
function bindRange(id, get, set, redraw) {
  $('#view').querySelectorAll(`[data-${id}r]`).forEach(b => b.onclick = () => { set(rangeOf(b.getAttribute(`data-${id}r`))); redraw(); });
  const ch = () => { let f = $(`#${id}From`).value, to = $(`#${id}To`).value; if (!f || !to) return; if (f > to) [f, to] = [to, f]; set({ key: '', from: f, to }); redraw(); };
  $(`#${id}From`).onchange = ch; $(`#${id}To`).onchange = ch; }
const inRange = (r, t) => { const d = isoD(new Date(Core.ms(t))); return d >= r.from && d <= r.to; };
/* sales of one branch day by day: receipts, pieces, cash in dinar and in dollars, FIB, debt, returns, net (for «جەردی ڕۆژانە») */
function dayTable(b, r, fixed) {
  const days = new Map(), get = d => days.get(d) || (days.set(d, { d, n: 0, pcs: 0, cD: 0, cU: 0, fib: 0, debt: 0, ret: 0, tot: 0 }), days.get(d));
  S.sales.forEach(s => { if (s.branch === b && inRange(r, s.t)) { const o = get(isoD(new Date(Core.ms(s.t))));
      o.n++; o.pcs += s.lines.reduce((a, l) => a + l.qty, 0); o.tot += s.total;
      if (s.pay === 'cash') { if (s.got && s.got.iqd) o.cD += s.got.iqd; else if (s.got && s.got.usd) o.cU += s.got.usd; else if (S.cur === 'IQD') o.cD += s.dn != null ? s.dn : Math.round(dinarOf(s.total, s.rate) / 250) * 250; else o.cU += s.total; }
      else if (s.pay === 'fib') o.fib += s.total; else o.debt += s.total; }
    (s.rets || []).forEach(x => { if (x.branch === b && inRange(r, x.t)) get(isoD(new Date(Core.ms(x.t)))).ret += x.amt; }); });
  const L = [...days.values()].sort((x, y) => x.d < y.d ? 1 : -1), T = L.reduce((a, o) => { Object.keys(a).forEach(k => a[k] += o[k]); return a; }, { n: 0, pcs: 0, cD: 0, cU: 0, fib: 0, debt: 0, ret: 0, tot: 0 });
  const dm = d => d.split('-').reverse().join('/'), row = (o, lab, cls) => `<tr class="${cls || ''}"><td class="num"><b>${lab}</b></td><td class="num">${o.n}</td><td class="num">${o.pcs}</td><td class="num">${DIN(o.cD)}</td><td class="num">${USD(o.cU)}</td><td class="num">${fmtMoney(o.fib)}</td><td class="num">${fmtMoney(o.debt)}</td><td class="num">${o.ret ? fmtMoney(-o.ret) : '—'}</td><td><b class="num">${fmtMoney(o.tot - o.ret)}</b></td></tr>`;
  return `<div class="card pad dayt"><div class="row sp" style="flex-wrap:wrap;gap:8px"><h2>${fixed ? 'کۆی هەموو ڕۆژەکانی ئەم مانگە' : 'فرۆشتن بە ڕۆژ'} — ${esc(S.branches[b])}</h2><span class="tag g">کۆ: <span class="num">${fmtMoney(T.tot - T.ret)}</span></span></div>
    ${fixed ? '' : rangeBar(r, 'dt')}
    <div class="scroll">${L.length ? `<table class="xls"><tr><th>بەروار</th><th>پسولە</th><th>دانە</th><th>کاش بە دینار</th><th>کاش بە دۆلار</th><th>FIB</th><th>قەرز</th><th>گەڕاوە</th><th>کۆی فرۆشتن</th></tr>${L.map(o => row(o, dm(o.d))).join('')}${L.length > 1 ? row(T, 'کۆ', 'xtot') : ''}</table>` : '<div class="empty">لەم ماوەیەدا هیچ فرۆشتنێک نییە</div>'}</div></div>`;
}
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
        <div class="card kpi"><small>مووچەی مانگانەم</small>${meRow.u.salary != null ? `<b class="num" id="mySalary">${fmtCur(meRow.u.salary, meRow.u.salaryCur)}</b>` : '<b id="mySalary" class="mute" style="font-size:18px">دانەنراوە</b>'}</div></div>
        ${rows[0] && rows[0] !== meRow && rows[0].net > meRow.net ? `<p class="mute" style="margin-top:12px">بۆ گەیشتن بە پلەی یەکەم ${money(rows[0].net - meRow.net + 1)}ی تر پێویستە.</p>` : meRow.net > 0 ? '<p style="margin-top:12px;color:var(--vt);font-weight:800">تۆ لە پێشەوەیت — بەردەوام بە!</p>' : ''}</div></div>` : '';
  $('#view').innerHTML = `<div class="row sp" style="margin-bottom:14px;flex-wrap:wrap">
      <div class="chips" style="margin:0">${Object.entries(RANGES).map(([k, v]) => `<button class="chip ${S.range.key === k ? 'on' : ''}" data-rg="${k}">${v}</button>`).join('')}</div>
      <div class="row"><span class="mute">لە</span>${dateBox(`pFrom`, S.range.from)}<span class="mute">تا</span>${dateBox(`pTo`, S.range.to)}</div></div>
    ${mine}${podium}
    <div class="card scroll"><table><tr><th>پلە</th><th>ناو</th><th>ئاست</th><th>پسولە</th><th style="min-width:150px">فرۆش</th>${own || lvl() === 2 ? `<th>ڕێژە</th><th>سوود</th><th>مووچە</th><th>کۆی پارەدان</th>${own ? '<th></th>' : ''}` : ''}</tr>
    ${rows.map((r, i) => `<tr class="${r.u.name === me().name ? 'me' : ''}"><td><span class="medal m${r.net > 0 ? Math.min(i + 1, 4) : 4} num">${i + 1}</span></td><td><b class="en">${esc(r.u.name)}</b></td><td><span class="tag ${r.u.role === 'sup' ? 'b' : 'n'}">${ROLE[r.u.role]}</span></td><td class="num">${r.n}</td>
      <td><div class="row"><b class="num" style="min-width:86px" data-net="${esc(r.u.name)}">${fmtMoney(r.net)}</b><div class="duel grow" style="margin:0"><div class="bar"><i style="width:${r.net / mx * 100}%"></i></div></div></div></td>
      ${own || lvl() === 2 ? `<td><span class="tag ${r.u.pct != null ? 'g' : 'n'} num">${pctTxt(r.u.pct)}</span></td><td><b class="num" data-com="${esc(r.u.name)}">${fmtMoney(r.com)}</b></td><td class="num">${r.u.salary != null ? fmtCur(r.u.salary, r.u.salaryCur) : '<span class="mute">—</span>'}</td><td><b class="num" style="color:var(--vt)">${fmtMoney(salC(r.u) + r.com)}</b></td>${own ? `<td><div class="row"><button class="ghost sm" data-pe="${esc(r.u.name)}">دانان</button><button class="ghost sm" data-po="${esc(r.u.name)}">پارەدان</button></div></td>` : ''}` : ''}</tr>`).join('')}</table></div>
    ${own ? `<div class="row sp card pad" style="margin-top:14px"><span>کۆی ئەوەی بۆ ئەم ماوەیە دەبێت بیدەیت (مووچە + سوود)</span><b class="num" id="payAll" style="font-size:23px;color:var(--vt)">${fmtMoney(rows.reduce((a, r) => a + salC(r.u) + r.com, 0))}</b></div>` : ''}${ledgerHtml()}`;
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
    <label class="f">بەروار${dateBox(`oD`, isoD(new Date()))}</label>
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
      ${L.map(x => `<div class="item"><div class="dot ${x.amount < 0 ? 'r' : 'g'}">${ico('expenses', 17)}</div><div class="grow"><p>${own ? `<b>${esc(x.to)}</b> · ` : ''}<span class="tag n">${LK[x.kind]}</span> <b class="num">${fmtCur(x.amount, x.cur)}</b></p><div class="note" style="margin-top:6px"><p>${esc(x.note)}</p></div><small><span class="num">${dmy(x.d)}</span> · ${esc(x.by)}</small></div></div>`).join('') || '<div class="empty"><b>هێشتا هیچ پارەدانێک تۆمار نەکراوە</b>دەوامی ڕۆژی پشوو، پاداشت و مووچەی دراو لێرە دەردەکەون</div>'}</div>
    <div class="card pad"><div class="row sp"><h2>${own ? 'تێبینییەکان' : 'تێبینی بۆ من'}</h2>${own ? '<button class="ghost sm" id="nNew">تێبینیی نوێ</button>' : ''}</div>
      ${N.map(n => `<div class="note"><p>${esc(n.text)}</p><div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">${(n.to === 'all' ? ['هەمووان'] : n.to).map(x => `<span class="tag b">@${esc(x)}</span>`).join('')}<small class="mute"><span class="num">${n.t.toLocaleDateString('en-GB')}</span> ${hm(n.t)} · ${esc(n.by)}</small></div></div>`).join('') || '<div class="empty"><b>هیچ تێبینییەک نییە</b></div>'}</div></div>`;
}
V.settings = () => {
  const ex = S.items.slice(0, 4);
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('#view').innerHTML = `<div class="two"><div style="display:grid;gap:18px">
    <div class="card pad"><h2>ڕووکار</h2><p class="mute" style="margin:4px 0 14px">ڕەش یان سپی — تەنها لەسەر ئەم ئامێرەی خۆت دەگۆڕێت. هەر کەسێک بۆ خۆی هەڵیدەبژێرێت.</p>
      <div class="thpick"><button data-th="dark" class="${theme() === 'dark' ? 'on' : ''}"><i class="d"></i><span>${ico('moon', 17)}ڕەش</span></button><button data-th="light" class="${theme() === 'light' ? 'on' : ''}"><i class="l"></i><span>${ico('sun', 17)}سپی</span></button></div></div>
    ${app ? '' : `<div class="card pad"><div class="row"><div class="dot b">${ico('phone', 17)}</div><h2>وەک ئەپ لەسەر مۆبایل</h2></div><p class="mute" style="margin:10px 0 0"><b>ئایفۆن:</b> لە <bdi>Safari</bdi> دوگمەی <bdi>Share</bdi> دابگرە، پاشان <bdi>Add to Home Screen</bdi> هەڵبژێرە.</p><p class="mute" style="margin:6px 0 0"><b>ئەندرۆید:</b> لە <bdi>Chrome</bdi> سێ خاڵەکەی سەرەوە دابگرە، پاشان <bdi>Add to Home screen</bdi> هەڵبژێرە.</p><p class="mute" style="margin:6px 0 0">دوای ئەوە وەک ئەپێکی ئاسایی لە شاشەی مۆبایلەکەت دەیکەیتەوە.</p></div>`}
    <div class="card pad"><h2>دراوی سیستەم</h2><p class="mute" style="margin:4px 0 14px">بەڕێوەبەر و سوپەرڤایزەر دەیگۆڕن. کاتێک دەگۆڕدرێت، لای هەموو کەسێک و لە هەموو لقەکان دەگۆڕێت. نرخەکان هەمیشە بە هەردوو دراوەکە نیشان دەدرێن.</p>
      <div class="seg" style="display:inline-flex"><button data-cur="USD" class="${S.cur === 'USD' ? 'on' : ''}">دۆلار $</button><button data-cur="IQD" class="${S.cur === 'IQD' ? 'on' : ''}">دینار د.ع</button></div></div>
    <div class="card pad"><h2>نرخی دۆلاری ئەمڕۆ</h2><p class="mute" style="margin:4px 0 14px">هەر ڕۆژێک نرخ گۆڕا، لێرە بیگۆڕە. کاڵای نرخ بە دینار: دینارەکەی ناگۆڕێت و دۆلارەکەی بەم نرخە هەژمار دەکرێت. کاڵای نرخ بە دۆلار: دۆلارەکەی ناگۆڕێت و دینارەکەی بەم نرخە هەژمار دەکرێت.</p>
      <div class="row raterow"><b class="num" style="font-size:23px">100$ =</b><input class="inp num grow" id="rate100" type="text" inputmode="decimal" min="1" step="250" value="${S.rate * 100}" style="font-size:21px;font-weight:800"><b>دینار</b><button class="btn volt" id="rateOk">هەڵگرتن</button></div>
      <p class="mute" style="margin-top:10px;font-size:14px">بۆ کاڵای نرخ بە دۆلار، بڕی دینار بۆ نزیکترین <span class="num">250</span> دینار خڕ دەکرێتەوە، چونکە بچووکترین پارە ئەوەیە.</p></div>
    <div class="card pad"><h2>نووسینی سەر پسوڵە</h2><p class="mute" style="margin:4px 0 14px">ناونیشان و ژمارەی مۆبایلی دوکان. لەسەر هەموو پسوڵەیەکی چاپکراو، لە ژێر ناوی لقەکە دەنووسرێت.</p><div class="row raterow"><input class="inp grow" id="shN" maxlength="160" autocomplete="off" value="${esc((S.shop && S.shop.note) || '')}" placeholder="ناونیشان · ژمارەی مۆبایل"><button class="btn volt" id="shOk">هەڵگرتن</button></div></div>
    <div class="card pad"><h2>ئامانجی فرۆشی ڕۆژانە</h2><p class="mute" style="margin:4px 0 14px">بازنەی داشبۆرد بەم بڕە پڕ دەبێتەوە. هەر کاتێک بتەوێت بیگۆڕە.</p><div class="row raterow"><input class="inp num grow" id="tgA" type="text" inputmode="decimal" value="${amtOut(S.target)}" style="font-size:21px;font-weight:800"><b>${CUR()}</b><button class="btn volt" id="tgOk">هەڵگرتن</button></div></div>
    ${REMOTE ? '' : '<div class="card pad"><h2>داتای ئەم نموونەیە</h2><p class="mute" style="margin:4px 0 14px">ئەم نموونەیە هەموو شتێک تەنها لەسەر ئەم ئامێرە هەڵدەگرێت. بە سڕینەوە دەگەڕێتەوە سەرەتا.</p><button class="ghost" id="wipe">سڕینەوە و دەستپێکردنەوە</button></div>'}</div>
    <div style="display:grid;gap:18px"><div class="card pad"><h2>نموونە بەم نرخە</h2>${ex.map(i => `<div class="item" style="align-items:center"><div class="grow"><p class="en" style="text-align:left;font-weight:600">${esc(i.name)}</p></div><span class="num mute">$${(i.r / 100).toFixed(2)}</span><b class="num" style="min-width:110px;text-align:left">${iqd(i.r).toLocaleString('en-US')} د.ع</b></div>`).join('')}</div>
    <div class="card pad"><h2>مێژووی نرخ</h2>${S.rates.map(r => `<div class="item"><div class="dot a">${ico('gear', 17)}</div><div class="grow"><p><span class="num">100$ = ${(r.rate * 100).toLocaleString('en-US')} د.ع</span></p><small>${esc(r.by)} · <span class="num">${r.t.toLocaleDateString('en-GB')}</span> ${hm(r.t)}</small></div></div>`).join('')}</div></div></div>`;
  bindTheme($('#view'));
  $('#view').querySelectorAll('[data-cur]').forEach(b => b.onclick = () => { if (S.cur === b.dataset.cur) return; run('setCurrency', { cur: b.dataset.cur }, () => render(true)); });
  if ($('#wipe')) $('#wipe').onclick = () => { modal(`<h2>سڕینەوەی داتای نموونە</h2><p class="mute">هەموو فرۆشتن، ئەکاونت و پاسۆردەکانی ئەم نموونەیە دەسڕێنەوە.</p><div class="acts"><button class="btn red" id="wY">بەڵێ، بیسڕەوە</button><button class="ghost" id="wN">نەخێر</button></div>`); $('#wN').onclick = closeModal; $('#wY').onclick = () => { window.__noSave = true; try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }; };
  $('#shOk').onclick = () => run('setShop', { note: $('#shN').value.trim() }, () => toast('هەڵگیرا'));
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
    <div class="two"><div class="card pad"><h2>جەردەکان</h2><p class="mute" style="font-size:14px;margin-bottom:6px">هەموو ئەو جەردانەی کارمەند و سوپەرڤایزەرەکان ناردوویانە، نوێترین لە سەرەوە.</p>
      ${S.jards.map(j => { const x = sum(j); return `<div class="item" style="align-items:center"><div class="dot ${x.dn ? 'r' : 'g'}">${ico('jard', 17)}</div><div class="grow">
          <p><b>${esc(j.by)}</b> <span class="tag n">${ROLE[(S.team.find(u => u.name === j.by) || {}).role] || ''}</span> <span class="tag b">${esc(S.branches[j.branch])}</span></p>
          <small><span class="num">${j.t.toLocaleDateString('en-GB')}</span> · کاتژمێر ${hm(j.t)} · <span class="num">${j.rows.length}</span> کاڵا ژمێردراوە${j.note ? ' · ' + esc(j.note) : ''}</small>
          <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px">${x.dn ? `<span class="tag r"><span class="num">${x.dn}</span> جیاوازی</span>${x.miss ? `<span class="tag r">کەمە <span class="num">${x.miss}</span> دانە</span>` : ''}${x.over ? `<span class="tag a">زیادە <span class="num">${x.over}</span> دانە</span>` : ''}` : '<span class="tag g">هەمووی ڕاستە</span>'}${j.applied ? '<span class="tag b">کۆگا ڕاست کراوەتەوە</span>' : ''}</div></div>
          <button class="ghost sm" data-jv="${j.id}">وردەکاری</button></div>`; }).join('') || '<div class="empty"><b>هێشتا هیچ جەردێک نەنێردراوە</b>کاتێک کارمەندێک جەرد دەنێرێت، لێرە دەردەکەوێت و ئاگەداریت بۆ دێت</div>'}</div>
    <div class="card pad"><h2>کێ ئەمڕۆ جەردی کرد؟</h2>${people.map(u => { const mine = today.filter(j => j.by === u.name), l = mine[0]; return `<div class="item" style="align-items:center"><div class="av" style="width:34px;height:34px;border-radius:10px;font-size:15px">${esc(u.name[0].toUpperCase())}</div><div class="grow"><p><b>${esc(u.name)}</b></p><small>${ROLE[u.role]} · ${u.branch < 0 ? 'هەموو لقەکان' : esc(S.branches[u.branch])}</small></div>${l ? `<span class="tag g" data-dn="${esc(u.name)}">${hm(l.t)} · <span class="num">${mine.length}</span> جەرد</span>` : `<span class="tag r" data-nc="${esc(u.name)}">نەیکردووە</span>`}</div>`; }).join('')}</div></div>`;
  $('#view').insertAdjacentHTML('beforeend', `<div class="card pad" style="margin-top:18px" id="closes"><h2>داخستنی قاصەکان</h2><p class="mute" style="font-size:14px;margin-bottom:6px">کارمەند تەنها ئەوە دەنووسێت کە ژماردوویەتی؛ نازانێت سیستەم چەندی چاوەڕێ دەکرد.</p>${(S.closes || []).slice(0, 30).map(c => `<div class="item" style="align-items:center"><div class="dot ${c.diff ? (c.diff < 0 ? 'r' : 'a') : 'g'}">${ico('expenses', 17)}</div><div class="grow"><p><b>${esc(c.by)}</b> <span class="tag b">${esc(S.branches[c.branch])}</span> ژمێردراو <b class="num">${fmtMoney(c.counted)}</b> · دەبوو <span class="num">${fmtMoney(c.expected)}</span> بێت</p><small><span class="num">${c.t.toLocaleDateString('en-GB')}</span> · کاتژمێر ${hm(c.t)}${c.note ? ' · ' + esc(c.note) : ''}</small></div><span class="tag ${c.diff ? (c.diff < 0 ? 'r' : 'a') : 'g'}">${c.diff ? (c.diff < 0 ? 'کەمە ' : 'زیادە ') + `<span class="num">${fmtMoney(Math.abs(c.diff))}</span>` : 'ڕاستە'}</span></div>`).join('') || '<div class="empty"><b>هێشتا هیچ قاصەیەک دانەخراوە</b></div>'}</div>`);
  $('#view').querySelectorAll('[data-jv]').forEach(x => x.onclick = () => jardView(S.jards.find(j => j.id === +x.dataset.jv)));
}
V.jardcount = () => {
  if (isOwner()) { jardOwner(); $('#view').insertAdjacentHTML('afterbegin', dayTable(S.branch, S.dayR || (S.dayR = rangeOf('month')))); bindRange('dt', () => S.dayR, v => S.dayR = v, V.jardcount); return; }
  const b = S.branch, mv = moves(b), own = isOwner(), cnt = S.count[b] || (S.count[b] = {});
  const tot = Object.values(mv).reduce((a, x) => ({ sold: a.sold + x.sold, ret: a.ret + x.ret, exch: a.exch + x.exch }), { sold: 0, ret: 0, exch: 0 });
  const left = S.items.reduce((a, i) => a + i.s[b], 0), faulty = S.exchanges.filter(x => x.branch === b).reduce((a, x) => a + x.qty, 0);
  const moved = S.items.filter(i => mv[i.id]), f = S.jardFilter || (moved.length ? 'moved' : 'all'), q = S.jardQ.toLowerCase();
  const list = (f === 'moved' ? moved : S.items.filter(i => i.s[b] > 0 || mv[i.id])).filter(i => !q || i.name.toLowerCase().includes(q) || i.bc.includes(q));
  const lastSold = {}, jd0 = Core.dayStart(S, new Date()); S.sales.forEach(s => { if (s.branch === b && !s.legacy && Core.ms(s.t) >= jd0) s.lines.forEach(l => { lastSold[l.id] = Math.max(lastSold[l.id] || 0, Core.ms(s.t)); }); });
  const done = Object.keys(cnt).length, diffs = Object.entries(cnt).filter(([id, n]) => n !== item(+id).s[b]).length;
  const subs = S.jards.filter(j => lvl() > 1 || j.by === me().name), d0 = Core.dayStart(S, new Date()), myCloses = (S.closes || []).filter(c => c.by === S.me && c.branch === b && Core.ms(c.t) >= d0);
  $('#view').innerHTML = `<div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <div class="card kpi"><small>ئەمڕۆ فرۆشراو</small>${cuInt(tot.sold, 'jSold')}</div><div class="card kpi"><small>گەڕاوە</small>${cuInt(tot.ret, 'jRet')}</div><div class="card kpi"><small>گۆڕاو (زەمانەت)</small>${cuInt(tot.exch, 'jExch')}</div><div class="card kpi"><small>خراپ</small>${cuInt(faulty, 'jBad')}</div>${lvl() > 1 ? `<div class="card kpi"><small>ماوە لە ${esc(S.branches[b])}</small>${cuInt(left, 'jLeft')}</div>` : ''}</div>
    <div class="card pad" style="margin-bottom:14px"><h2>داخستنی قاصە — ${esc(S.branches[b])}</h2><p class="mute" style="font-size:14px;margin:2px 0 12px">لە کۆتایی ڕۆژ، پارەی ناو قاصەکە بە دەست بژمێرە و تەنها ئەو ژمارەیە لێرە بنووسە. هیچ هەژمارێکی تر پێویست نییە؛ سیستەم خۆی لەگەڵ فرۆشتنەکان بەراوردی دەکات و بۆ بەڕێوەبەری دەنێرێت.</p>
      <div class="row raterow"><input class="inp num grow" id="dcA" type="text" inputmode="decimal" placeholder="بڕی کاشی ژمێردراو" style="font-size:19px;font-weight:800"><b>${CUR()}</b><input class="inp grow" id="dcN" placeholder="تێبینی (ئارەزوومەندانە)" maxlength="200"><button class="btn volt" id="dcOk">ناردن</button></div>
      ${myCloses.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px">${myCloses.map(c => `<span class="tag g">${hm(c.t)} · نێردرا: <span class="num">${fmtMoney(c.counted)}</span></span>`).join('')}</div>` : ''}</div>
    <div class="card pad" style="margin-bottom:14px"><div class="row sp" style="flex-wrap:wrap"><div><h2>ژماردنی ئەمڕۆ — ${esc(S.branches[b])}</h2><p class="mute" style="font-size:14px">هەر کاڵایەک بژمێرە و ژمارەکەی لە خانەی «ژماردم» بنووسە. «دەبێت مابێت» ئەوەیە کە سیستەم دەڵێت. «جیاوازی» = ژماردنی تۆ − دەبێت مابێت: «ڕاستە» واتە وەک یەکن، «کەمە» واتە دانەیەک ون بووە، «زیادە» واتە زیاترە لە سیستەم.</p></div>
        <div class="chips" style="margin:0"><button class="chip ${f === 'moved' ? 'on' : ''}" data-jf="moved">جووڵاوەکانی ئەمڕۆ <span class="num">${moved.length}</span></button><button class="chip ${f === 'all' ? 'on' : ''}" data-jf="all">هەموو کاڵاکان</button></div></div>
      <input class="inp" id="jQ" placeholder="گەڕان بە ناو یان بارکۆد" value="${esc(S.jardQ)}" style="margin:12px 0 4px">
      ${list.length ? `<div class="row sp" style="margin:8px 0;flex-wrap:wrap;gap:8px"><span class="mute" style="font-size:14px"><span class="num">${list.length}</span> دێڕ · تەنها پێداچوونەوە بکە؛ هەر ژمارەیەک جیاواز بوو لە خانەی «ژماردم» بیگۆڕە</span><button class="ghost sm" id="jAll">${ico('check', 15)} هەمووی وەک سیستەم ڕاستە</button></div>
      <div class="scroll sheetw"><table class="jsheet"><tr><th>#</th><th>کاڵا</th><th>بارکۆد</th><th>فرۆشراو</th><th>دوایین فرۆشتن</th><th>گەڕاوە</th><th>گۆڕاو</th><th>دەبێت مابێت</th><th>ژماردم</th><th>جیاوازی</th><th></th></tr>
      ${list.map((i, k) => { const m = mv[i.id] || { sold: 0, ret: 0, exch: 0 }, sys = i.s[b], has = cnt[i.id] != null, d = has ? cnt[i.id] - sys : 0, ls = lastSold[i.id];
        return `<tr class="jrow ${has ? (d === 0 ? 'ok' : 'bad') : ''}"><td class="num mute">${k + 1}</td><td class="en"><b>${esc(i.name)}</b></td><td class="num mute">${esc(i.bc) || '—'}</td><td class="num">${m.sold || ''}</td><td>${ls ? hm(new Date(ls)) : ''}</td><td class="num">${m.ret || ''}</td><td class="num">${m.exch || ''}</td><td class="num"><b>${sys}</b></td>
          <td><div class="qty"><button data-jm="${i.id}">−</button><input class="inp num jc" data-id="${i.id}" type="text" inputmode="numeric" placeholder="${sys}" value="${has ? cnt[i.id] : ''}"><button data-jp="${i.id}">+</button></div></td>
          <td>${has ? `<span class="tag ${d === 0 ? 'g' : 'r'}">${d === 0 ? 'ڕاستە' : (d < 0 ? 'کەمە ' : 'زیادە ') + `<span class="num">${Math.abs(d)}</span>`}</span>` : ''}</td><td><button class="ghost sm jokb" data-jok="${i.id}" title="وەک سیستەم ڕاستە">${ico('check', 15)}</button></td></tr>`; }).join('')}</table></div>` : '<div class="empty"><b>ئەمڕۆ هیچ کاڵایەک نەجووڵاوە</b>«هەموو کاڵاکان» هەڵبژێرە بۆ ژماردنی تەواو</div>'}
      <div class="jfoot"><div class="grow"><b><span class="num">${done}</span> کاڵا ژمێردراوە</b> · <span class="${diffs ? 'tag r' : 'mute'}"><span class="num">${diffs}</span> جیاوازی</span><input class="inp" id="jNote" placeholder="تێبینی (ئارەزوومەندانە)" style="margin-top:8px"></div><button class="btn blue" id="jSend" ${done ? '' : 'disabled'}>${ico('check', 19)}تەواو</button></div></div>
    <div class="card pad"><h2>${lvl() > 1 ? 'جەردە نێردراوەکان' : 'جەردەکانی من'}</h2>${subs.map(j => { const dn = j.rows.filter(r => r.diff).length, miss = j.rows.reduce((a, r) => a + Math.min(0, r.diff), 0); return `<div class="item" style="align-items:center"><div class="dot ${dn ? 'r' : 'g'}">${ico('jard', 17)}</div><div class="grow"><p><b>${esc(j.by)}</b> · ${esc(S.branches[j.branch])} · <span class="num">${j.rows.length}</span> کاڵا ${dn ? `<span class="tag r"><span class="num">${dn}</span> جیاوازی${miss ? ` · کەمیی <span class="num">${-miss}</span> دانە` : ''}</span>` : '<span class="tag g">هەمووی ڕاستە</span>'}${j.applied ? ' <span class="tag b">جێبەجێ کراوە</span>' : ''}</p><small><span class="num">${j.t.toLocaleDateString('en-GB')}</span> ${hm(j.t)}${j.note ? ' · ' + esc(j.note) : ''}</small></div><button class="ghost sm" data-jv="${j.id}">بینین</button></div>`; }).join('') || '<div class="empty"><b>هێشتا هیچ جەردێک نەنێردراوە</b></div>'}</div>`;
  $('#view').insertAdjacentHTML('beforeend', dayTable(b, S.dayR || (S.dayR = rangeOf('month')))); bindRange('dt', () => S.dayR, v => S.dayR = v, V.jardcount);
  const set = (id, n) => { if (n == null || n < 0 || !Number.isInteger(n)) delete cnt[id]; else cnt[id] = n; V.jardcount(); };
  document.querySelectorAll('.jc').forEach(x => x.onchange = () => set(+x.dataset.id, x.value === '' ? null : Math.floor(+x.value)));
  $('#view').querySelectorAll('[data-jp]').forEach(x => x.onclick = () => { const id = +x.dataset.jp; set(id, (cnt[id] ?? item(id).s[b]) + 1); });
  $('#view').querySelectorAll('[data-jm]').forEach(x => x.onclick = () => { const id = +x.dataset.jm; set(id, Math.max(0, (cnt[id] ?? item(id).s[b]) - 1)); });
  $('#view').querySelectorAll('[data-jok]').forEach(x => x.onclick = () => set(+x.dataset.jok, item(+x.dataset.jok).s[b]));
  if ($('#jAll')) $('#jAll').onclick = () => { list.forEach(i => { if (cnt[i.id] == null) cnt[i.id] = i.s[b]; }); V.jardcount(); };
  $('#view').querySelectorAll('[data-jf]').forEach(x => x.onclick = () => { S.jardFilter = x.dataset.jf; V.jardcount(); });
  $('#jQ').onchange = () => { S.jardQ = $('#jQ').value.trim(); V.jardcount(); };
  $('#view').querySelectorAll('[data-jv]').forEach(x => x.onclick = () => jardView(S.jards.find(j => j.id === +x.dataset.jv)));
  $('#dcOk').onclick = () => { const raw = $('#dcA').value.trim(); if (raw === '') return toast('بڕی کاشی ژمێردراو بنووسە', 1); run('drawerClose', { branch: b, counted: toC(raw), note: $('#dcN').value.trim() }, () => { toast('قاصەکە نێردرا بۆ بەڕێوەبەر'); V.jardcount(); }); };
  $('#jSend').onclick = () => run('jardSubmit', { branch: b, counts: cnt, note: $('#jNote').value.trim() }, () => { S.count[b] = {}; toast('جەردەکە نێردرا'); V.jardcount(); });
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
  const CAN = { owner: 'هەموو شتێک: قازانج، نرخ، داشکاندن، ئەکاونتەکان، ڕێکخستنەکان', sup: 'داخیلکردن و دەستکاریی کاڵا، گەڕاوە و زەمان، مەسروفات، پسولەکان، موشتەرییەکان، گۆڕینی دراو — بێ قازانج و نرخی کڕین', staff: 'فرۆشتن، کڕیار، جەردی ڕۆژانە، جەردی پارە، فرۆشتنەکانی خۆی و مووچەی خۆی' };
  $('#view').innerHTML = `<div class="row sp" style="margin-bottom:14px;flex-wrap:wrap"><p class="mute">تەنها تۆ دەتوانیت ئەکاونت دروست بکەیت، پاسۆرد دابنێیت یان بیسڕیتەوە.</p><button class="btn volt" id="uNew">ئەکاونتی نوێ</button></div>
    <div class="card scroll"><table><tr><th>ناو</th><th>ئاست</th><th>لق</th><th>چوونەژوورەوە</th><th>ڕێژە</th><th>مووچە</th><th>دەسەڵات</th><th></th></tr>${S.team.map(u => `<tr><td><b>${esc(u.name)}</b></td><td><span class="tag ${u.role === 'owner' ? 'a' : u.role === 'sup' ? 'b' : 'n'}">${ROLE[u.role]}</span></td><td>${u.branch < 0 ? 'هەموو لقەکان' : esc(S.branches[u.branch])}</td>
      <td><span class="tag ${u.pw ? 'g' : 'r'}" data-has="${esc(u.name)}">${u.pw ? 'پاسۆردی هەیە' : 'پاسۆردی نییە'}</span></td><td class="num">${u.role === 'owner' ? '—' : pctTxt(u.pct)}</td><td class="num">${u.role === 'owner' ? '—' : u.salary != null ? fmtCur(u.salary, u.salaryCur) : 'دانەنراوە'}</td><td class="mute" style="font-size:13.5px;min-width:170px">${CAN[u.role]}</td>
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

let slQ = '';
V.sales = () => {
  const q = slQ.trim().toLowerCase(), qd = q.replace(/^#/, ''), list = !q ? S.sales : S.sales.filter(x => String(x.no).includes(qd) || slipCode(x.no) === qd || x.by.toLowerCase().includes(q) || (x.phone || '').includes(qd) || (x.buyer || '').toLowerCase().includes(q) || ((x.customer && cust(x.customer)) || { name: '' }).name.toLowerCase().includes(q) || x.lines.some(l => l.name.toLowerCase().includes(q) || (l.sn || []).some(n => n.toLowerCase().includes(q))));
  const pcs = q ? list.reduce((a, x) => a + x.lines.filter(l => l.name.toLowerCase().includes(q)).reduce((b, l) => b + l.qty - l.ret, 0), 0) : 0;
  if (q && /^(\d{3,}|[a-z0-9]{6,})$/i.test(qd)) archSeek(qd, () => { if (S.view === 'sales') V.sales(); });
  $('#view').innerHTML = `<div class="row sp slbar"><input class="inp grow" id="slQ" placeholder="گەڕان: ژمارەی پسولە، ناوی کاڵا (بۆ نموونە cable 1m)، سریاڵ، مۆبایلی کڕیار، فرۆشیار" value="${esc(slQ)}" autocomplete="off">${q ? `<span class="tag b"><span class="num">${list.length}</span> پسولە${pcs ? ` · <span class="num">${pcs}</span> دانە لەو کاڵایە` : ''}</span><button class="ghost sm" id="slX">پاککردنەوە</button>` : ''}</div>
  <div class="card scroll">${list.length ? `<table><tr><th>پسولە</th><th>کات</th><th>لق</th><th>فرۆشیار</th><th>جۆر</th><th>پارەدان</th><th>کۆ</th><th>گەڕاوە</th><th></th></tr>${list.slice(0, 400).map(x => `<tr><td class="num"><b>#${x.no}</b>${x.legacy ? ' <span class="tag n">سیستەمی کۆن</span>' : ''}</td><td>${hm(x.t)}<small class="num" style="display:block;color:var(--mute)">${x.t.toLocaleDateString('en-GB')}</small></td><td>${esc(S.branches[x.branch])}</td><td class="en">${esc(x.by)}</td><td><span class="tag n">${TYPES[x.type]}</span></td><td>${payTag(x.pay)}</td><td>${money(x.total)}${q && !x.legacy ? `<small class="slit">${x.lines.map(l => `<span class="num">${l.qty} ×</span> <button class="ilink" data-sq="${esc(l.name)}">${esc(l.name)}</button>`).join('<br>')}</small>` : ''}</td><td>${x.refunded ? money(x.refunded) : '—'}</td><td><div class="row"><button class="ghost sm" data-v="${x.no}">بینین</button>${x.legacy ? '' : `<button class="ghost sm" data-r="${x.no}">گەڕاندنەوە</button>`}</div></td></tr>`).join('')}</table>` : `<div class="empty"><b>${q ? 'هیچ پسولەیەک نەدۆزرایەوە' : 'هێشتا هیچ پسولەیەک نییە'}</b></div>`}</div>`;
  const sq = $('#slQ'); sq.oninput = () => { slQ = sq.value; V.sales(); const n = $('#slQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  if ($('#slX')) $('#slX').onclick = () => { slQ = ''; V.sales(); };
  $('#view').querySelectorAll('[data-sq]').forEach(b => b.onclick = () => { slQ = b.dataset.sq; V.sales(); });
  $('#view').querySelectorAll('[data-v]').forEach(b => b.onclick = () => receipt(S.sales.find(x => x.no === +b.dataset.v)));
  $('#view').querySelectorAll('[data-r]').forEach(b => b.onclick = () => { warNo = +b.dataset.r; warSn = ''; go('warranty'); });
};
/* ---------- «جەردی ڕۆژانە»: his Excel sheet, one page per day, filled by the system itself ----------
   ژمارەی کۆگا + هاتوو − فرۆشتن − جوملە − عاطڵ + گەڕاوە = ماوە لە کۆگا. Today's page can be written in; once the day is over it is closed for everyone. */
const MONTHS = ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەمموز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'];
V.jard = () => {
  const today = isoD(new Date()), d = S.jardD && S.jardD <= today ? S.jardD : (S.jardD = today), b = S.branch, sh = Core.daySheet(S, b, d), open = d === today, sup = lvl() > 1;
  archWant(d, V.jard);   // an old day needs every month from that day on (the pieces are counted back from today)
  const [Y, M, Dd] = d.split('-').map(Number), last = new Date(Y, M, 0).getDate(), iso = (y, m, x) => `${y}-${String(m).padStart(2, '0')}-${String(x).padStart(2, '0')}`;
  const q = (S.jardQ || '').trim().toLowerCase(), only = S.jardOnly, moved = r => r.sold || r.whole || r.ret || r.bad || r.inn || r.disc || r.note;
  const rows = sh.rows.filter(r => (!only || moved(r)) && (!q || r.name.toLowerCase().includes(q) || (item(r.id).bc || '').includes(q)));
  const look = !!(REMOTE && viewAs()), can = f => open && !look && (sup || f === 'sold' || f === 'disc' || f === 'ret');
  const cell = (r, f, v, cls = '') => can(f) ? `<td class="jx ${cls}"><input class="num ${f === 'disc' ? 'grp' : ''}" data-id="${r.id}" data-f="${f}" data-o="${v}" type="text" inputmode="numeric" value="${v ? (f === 'disc' ? v.toLocaleString('en-US') : v) : ''}" placeholder="${f === 'left' ? v : ''}" autocomplete="off"></td>` : `<td class="num ${cls}">${v ? v.toLocaleString('en-US') : ''}</td>`;
  const T = rows.reduce((a, r) => { ['open', 'inn', 'sold', 'whole', 'ret', 'bad', 'left', 'disc', 'sumC', 'sumD'].forEach(k => a[k] += r[k]); return a; }, { open: 0, inn: 0, sold: 0, whole: 0, ret: 0, bad: 0, left: 0, disc: 0, sumC: 0, sumD: 0 });
  const n0 = v => v ? v.toLocaleString('en-US') : '';
  $('#view').innerHTML = `<div class="card pad jhead">
      <div class="row sp jtop"><div class="row jmon"><button class="ghost sm" id="jPrev" title="مانگی پێشوو">›</button><b>${MONTHS[M - 1]} <span class="num">${Y}</span></b><button class="ghost sm" id="jNext" title="مانگی داهاتوو" ${iso(Y, M, last) >= today ? 'disabled' : ''}>‹</button></div>
        <div class="row jgo"><span class="mute">چوونە سەر ڕۆژێک</span>${dateBox('jDay', d)}${open ? '' : '<button class="btn sm" id="jToday">ئەمڕۆ</button>'}</div></div>
      <div class="jdays">${[...Array(last)].map((_, k) => { const x = iso(Y, M, k + 1); return `<button data-jd="${x}" class="num ${x === d ? 'on' : ''} ${x === today ? 'td' : ''}" ${x > today ? 'disabled' : ''}>${k + 1}</button>`; }).join('')}</div>
      <div class="row sp jinfo"><div><h2>جەردی ڕۆژی <span class="num">${dmy(d)}</span> — ${esc(S.branches[b])}</h2><small class="mute">${open ? (sup ? 'ئەمڕۆیە: هەموو خانە سپییەکان دەنووسرێن. سبەی ئەم لاپەڕەیە دادەخرێت.' : 'ئەمڕۆیە: دەتوانیت «ژمارەی فرۆشتن»، «گەڕاوە» و «داشکان» بنووسیت. سبەی ئەم لاپەڕەیە دادەخرێت.') : 'ئەم ڕۆژە تێپەڕیوە — تەنها بۆ بینینە و هیچ کەس ناتوانێت دەستکاریی بکات.'}${open && look ? ' <b style="color:var(--amber)">ئێستا لە «بینین وەک»دایت: تەنها سەیر دەکرێت.</b>' : ''}</small></div><span class="tag ${open ? 'g' : 'n'}">${open ? 'کراوەیە' : ico('shield', 14) + ' داخراوە'}</span></div></div>
    <div class="kgrid jk"><div class="card kpi"><small>ژمارەی فرۆشتن</small><b class="num">${n0(sh.tot.sold) || 0}</b></div><div class="card kpi"><small>جوملە</small><b class="num">${n0(sh.tot.whole) || 0}</b></div><div class="card kpi"><small>گەڕاوە</small><b class="num">${n0(sh.tot.ret) || 0}</b></div><div class="card kpi"><small>عاطڵ</small><b class="num">${n0(sh.tot.bad) || 0}</b></div><div class="card kpi"><small>مجموع دینار</small><b class="num" id="jSumD">${DIN(sh.tot.sumD)}</b></div><div class="card kpi"><small>مجموع دۆلار</small><b class="num" id="jSumU">${USD(sh.tot.sumC)}</b></div></div>
    <div class="card pad jbody"><div class="row jtools"><div class="search grow">${ico('search', 19)}<input class="inp" id="jQ" placeholder="گەڕان بە ناو یان بارکۆد…" value="${esc(S.jardQ || '')}" autocomplete="off"></div><div class="seg"><button data-jo="" class="${only ? '' : 'on'}">هەموو کاڵاکان <span class="num">${sh.rows.length}</span></button><button data-jo="1" class="${only ? 'on' : ''}">جووڵاوەکانی ئەو ڕۆژە <span class="num">${sh.rows.filter(moved).length}</span></button></div></div>
      <div class="scroll jscroll"><table class="jx2"><thead><tr><th>کۆد</th><th class="jn">جۆری کاڵا</th><th>ژمارەی کۆگا</th><th>هاتوو</th><th>نرخی فرۆشتن $</th><th>نرخی فرۆشتن IQD</th><th class="e">ژمارەی فرۆشتن</th><th>جوملە</th><th class="e">گەڕاوە</th><th class="${sup ? 'e' : ''}">عاطڵ</th><th class="${sup ? 'e' : ''} jl">ماوە لە کۆگا</th><th class="e">داشکان</th><th>مجموع دۆلار</th><th>مجموع دینار</th><th>سعری جوملە</th><th class="${sup ? 'e' : ''}">تێبینی</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="${moved(r) ? 'mv' : ''} ${r.left <= 0 ? 'z' : ''}"><td class="num mute">${r.no}</td><td class="en jn"><button class="ilink" data-ih="${r.id}">${esc(r.name)}</button></td><td class="num">${r.open.toLocaleString('en-US')}</td><td class="num ${r.inn > 0 ? 'up' : r.inn < 0 ? 'dn' : ''}">${r.inn ? (r.inn > 0 ? '+' : '') + r.inn.toLocaleString('en-US') : ''}</td><td class="num">${USD(r.r)}</td><td class="num">${r.rd.toLocaleString('en-US')}</td>${cell(r, 'sold', r.sold, 'b')}<td class="num">${n0(r.whole)}</td>${cell(r, 'ret', r.ret)}${cell(r, 'bad', r.bad)}${can('left') ? `<td class="jx jl"><input class="num" data-id="${r.id}" data-f="left" data-o="${r.left}" type="text" inputmode="numeric" value="${r.left}" autocomplete="off"></td>` : `<td class="num jl"><b>${r.left.toLocaleString('en-US')}</b></td>`}${cell(r, 'disc', r.jd || r.disc)}<td class="num">${r.sumC ? USD(r.sumC) : ''}</td><td class="num">${r.sumD ? '<b>' + r.sumD.toLocaleString('en-US') + '</b>' : ''}</td><td class="num">${r.w > 0 ? USD(r.w) : ''}</td>${can('note') ? `<td class="jx jnote"><input data-id="${r.id}" data-f="note" data-o="${esc(r.note)}" type="text" maxlength="200" value="${esc(r.note)}" autocomplete="off"></td>` : `<td class="jnote">${esc(r.note)}</td>`}</tr>`).join('') || '<tr><td colspan="16" class="empty">هیچ کاڵایەک نەدۆزرایەوە</td></tr>'}
        </tbody><tfoot><tr><td></td><td class="jn">مجموع</td><td class="num">${T.open.toLocaleString('en-US')}</td><td class="num">${T.inn ? (T.inn > 0 ? '+' : '') + T.inn.toLocaleString('en-US') : ''}</td><td></td><td></td><td class="num">${T.sold}</td><td class="num">${T.whole}</td><td class="num">${T.ret}</td><td class="num">${T.bad}</td><td class="num jl">${T.left.toLocaleString('en-US')}</td><td class="num">${n0(T.disc)}</td><td class="num">${USD(T.sumC)}</td><td class="num">${T.sumD.toLocaleString('en-US')}</td><td></td><td></td></tr></tfoot></table></div>
      <p class="mute jleg"><span class="jsw e"></span>خانەی سپی: دەنووسرێت${open ? '' : ' (تەنها لە ڕۆژی خۆیدا)'} · <span class="jsw"></span>خانەی خۆڵەمێشی: سیستەم خۆی پڕی دەکاتەوە لە فرۆشتن، گەڕاوە، داخیلکردن و جوملە. هەر ژمارەیەک بگۆڕیت، کۆگا و قاصەش لەگەڵی دەگۆڕێن.</p></div>
    ${dayTable(b, { key: '', from: iso(Y, M, 1), to: iso(Y, M, last) > today ? today : iso(Y, M, last) }, true)}`;
  const goD = x => { S.jardD = x > today ? today : x; V.jard(); };
  $('#jPrev').onclick = () => { const p0 = new Date(Y, M - 2, 1), l0 = new Date(Y, M - 1, 0).getDate(); goD(iso(p0.getFullYear(), p0.getMonth() + 1, Math.min(Dd, l0))); };
  $('#jNext').onclick = () => { const p1 = new Date(Y, M, 1), l1 = new Date(Y, M + 1, 0).getDate(); goD(iso(p1.getFullYear(), p1.getMonth() + 1, Math.min(Dd, l1))); };
  if ($('#jToday')) $('#jToday').onclick = () => goD(today);
  $('#jDay').onchange = e => { if (e.target.value) goD(e.target.value); };
  $('#view').querySelectorAll('[data-jd]').forEach(x => x.onclick = () => goD(x.dataset.jd));
  $('#view').querySelectorAll('[data-jo]').forEach(x => x.onclick = () => { S.jardOnly = !!x.dataset.jo; V.jard(); });
  $('#view').querySelectorAll('[data-ih]').forEach(x => x.onclick = () => itemHistory(item(+x.dataset.ih)));
  const jq = $('#jQ'); jq.oninput = () => { S.jardQ = jq.value; V.jard(); const n = $('#jQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  const on = $('.jdays .on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('#view').querySelectorAll('.jx input').forEach(x => { x.onfocus = () => x.select();
    x.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); x.blur(); } if (e.key === 'Escape') { x.value = x.dataset.o; x.blur(); } };
    x.onchange = () => { const f = x.dataset.f, id = +x.dataset.id, raw = x.value.trim(), v = f === 'note' ? raw : raw === '' ? (f === 'left' ? +x.dataset.o : 0) : pn(raw, true);
      if (f !== 'note' && (!Number.isInteger(v) || v < 0)) { toast('تەنها ژمارەی تەواو بنووسە', 1); x.value = x.dataset.o === '0' ? '' : x.dataset.o; return; }
      if (String(v) === x.dataset.o) return;
      const sy = scrollY, sx = $('.jscroll').scrollLeft, st = $('.jscroll').scrollTop;
      const back = () => { V.jard(); const s = $('.jscroll'); if (s) { s.scrollLeft = sx; s.scrollTop = st; } scrollTo(0, sy); };
      const send = tries => run('jardCell', { branch: b, id, f, v, d }, () => { back(); toast(f === 'sold' ? 'فرۆشتن تۆمار کرا و لە کۆگا کەم کرایەوە' : f === 'ret' ? 'گەڕاوە تۆمار کرا و چووەوە کۆگا' : 'هەڵگیرا'); },
        why => { if (why === 'busy' && tries < 40) return void setTimeout(() => send(tries + 1), 150); back(); });   // the server is still answering the last box: wait for it; refused: the true numbers come back
      send(0); }; x.oninput = () => { x.classList.toggle('lg', x.value.length > 4); }; x.classList.toggle('lg', x.value.length > 4); });
};
/* ---------- «فرۆشتنەکانم»: what I sold, day by day — pieces, money, my best day and my best hour ---------- */
let myOpen = '', myF = { q: '', type: '' };
V.mine = () => { // «فرۆشتنەکانم»: what I sold in any date range — totals, every item with its pieces, day by day, each receipt (and the undo of a fresh one)
  const r = S.myR || (S.myR = rangeOf('today')), q = latin(myF.q).trim().toLowerCase(), qn = (/^#?(\d{3,})$/.exec(q) || [])[1];
  archWant(r.from, V.mine);
  const hit = s => { if (myF.type && s.type !== myF.type) return false; if (!q) return true; if (qn && (String(s.no) === qn || slipCode(s.no) === qn)) return true;
    return s.lines.some(l => { const it = item(l.id); return l.name.toLowerCase().includes(q) || (it && it.bc && it.bc.includes(q)) || (l.sn || []).some(n => n.toLowerCase().includes(q)); }) || (s.phone || '').includes(q) || (s.buyer || '').toLowerCase().includes(q); };
  const my = S.sales.filter(s => s.by === S.me && !s.legacy && inRange(r, s.t) && hit(s)), days = new Map(), its = new Map();
  my.forEach(s => { const d = isoD(new Date(Core.ms(s.t))), o = days.get(d) || { d, n: 0, pcs: 0, tot: 0, sales: [] }; o.n++; o.pcs += s.lines.reduce((a, l) => a + l.qty - l.ret, 0); o.tot += s.total - s.refunded; o.sales.push(s); days.set(d, o);
    s.lines.forEach(l => { const k = its.get(l.id) || { id: l.id, name: l.name, q: 0, sum: 0 }; k.q += l.qty - l.ret; k.sum += (l.qty - l.ret) * l.price; its.set(l.id, k); }); });
  const sold = my.reduce((a, s) => a + s.total, 0), back = my.reduce((a, s) => a + s.refunded, 0), pcs = my.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.qty - l.ret, 0), 0);
  const list = [...days.values()].sort((a, b) => b.d < a.d ? -1 : 1), dm = d => d.split('-').reverse().join('/'), items = [...its.values()].filter(x => x.q > 0).sort((a, b) => b.q - a.q || b.sum - a.sum);
  const fresh = S.sales.find(x => x.by === S.me && !x.legacy), undoBtn = s => canUndo(s) ? `<button class="ghost sm undo" data-un="${s.no}">${ico('returns', 14)}پەشیمانبوونەوە</button>` : '';
  const det = o => `<tr class="bdet"><td colspan="5"><div class="scroll"><table class="wt"><tr><th>کات</th><th>پسولە</th><th>کاڵا</th><th>جۆر</th><th>پارەدان</th><th>کۆ</th><th></th></tr>${o.sales.map(s => `<tr><td>${hm(new Date(Core.ms(s.t)))}</td><td><button class="ghost sm num" data-v="${s.no}">#${s.no}</button></td><td class="dfi">${s.lines.map(l => `<span class="num">${l.qty} ×</span> <span class="en">${esc(l.name)}</span> <span class="num mute">${fmtMoney(l.price)}</span>${(l.sn || []).length ? ` <span class="num mute">S/N ${l.sn.map(esc).join('، ')}</span>` : ''}`).join('<br>')}</td><td><span class="tag n">${TYPES[s.type]}</span></td><td>${payTag(s.pay)}</td><td>${money(s.total - s.refunded)}</td><td>${undoBtn(s)}</td></tr>`).join('')}</table></div></td></tr>`;
  $('#view').innerHTML = `${canUndo(fresh) ? `<div class="card pad lastbar"><div class="grow"><b>دوایین فرۆشتنت: <span class="num">#${fresh.no}</span> · ${money(fresh.total)}</b><small class="mute">تا <span class="num">${Math.max(1, Math.ceil((Core.UNDO_MS - (Date.now() - Core.ms(fresh.t))) / 60000))}</span> خولەکی تر دەتوانیت پەشیمان ببیتەوە</small></div><button class="ghost sm" data-v="${fresh.no}">بینینی پسولە</button>${undoBtn(fresh)}</div>` : ''}
    ${rangeBar(r, 'my')}
    <div class="row myfil"><input class="inp grow" id="myQ" placeholder="ژمارەی پسولە، سریاڵ، بارکۆد یان ناوی کاڵا…" value="${esc(myF.q)}" autocomplete="off"><select class="inp" id="myTy"><option value="">هەموو جۆرەکان</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${myF.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>${myF.q || myF.type || r.key !== 'today' ? '<button class="ghost sm" id="myX">پاککردنەوەی فلتەرەکان</button>' : ''}</div>
    <div class="kgrid k3"><div class="card kpi"><small><span class="dot g"></span>نرخی فرۆشراو</small>${cu(sold)}<em class="kem"><span class="num">${my.length}</span> پسولە · <span class="num">${pcs}</span> دانە</em></div><div class="card kpi"><small><span class="dot a"></span>گەڕاوەکان</small>${cu(back)}<em class="kem">ئەوەی لەم پسولانە گەڕاوەتەوە</em></div><div class="card kpi"><small><span class="dot b"></span>صافی فرۆشتن</small>${cu(sold - back, 'myT')}<em class="kem">${r.from === r.to ? dm(r.from) : dm(r.from) + ' — ' + dm(r.to)}</em></div></div>
    ${items.length ? `<div class="card pad"><h2>کاڵا فرۆشراوەکان</h2><div class="scroll"><table class="myit"><tr><th>کاڵا</th><th>دانە</th><th>کۆ</th></tr>${items.map(x => { const it = item(x.id); return `<tr><td class="en"><span class="irow">${it ? thumb(it, 15, 'sm') : ''}<span>${esc(x.name)}</span></span></td><td class="num"><b>${x.q}</b></td><td>${money(x.sum)}</td></tr>`; }).join('')}</table></div></div>` : ''}
    <div class="card scroll">${list.length ? `<table class="byt"><tr><th>بەروار</th><th>پسولە</th><th>دانە</th><th>کۆی فرۆشتن</th><th></th></tr>${list.map(o => `<tr class="brow ${myOpen === o.d ? 'sel' : ''}" data-md="${o.d}"><td class="num"><b>${dm(o.d)}</b></td><td class="num">${o.n}</td><td class="num">${o.pcs}</td><td><b>${money(o.tot)}</b></td><td class="mute">${myOpen === o.d ? 'داخستن' : 'وردەکاری'}</td></tr>${myOpen === o.d || list.length === 1 ? det(o) : ''}`).join('')}</table>` : `<div class="empty"><b>${q || myF.type ? 'هیچ پسولەیەک بەم فلتەرە نەدۆزرایەوە' : 'لەم ماوەیەدا هیچت نەفرۆشتووە'}</b>بەروار یان فلتەرەکان بگۆڕە</div>`}</div>`;
  bindRange('my', () => S.myR, v => S.myR = v, V.mine);
  const mq = $('#myQ'); mq.oninput = () => { myF.q = mq.value; V.mine(); const n = $('#myQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('#myTy').onchange = e => { myF.type = e.target.value; V.mine(); };
  if ($('#myX')) $('#myX').onclick = () => { myF = { q: '', type: '' }; S.myR = rangeOf('today'); V.mine(); };
  $('#view').querySelectorAll('[data-md]').forEach(x => x.onclick = () => { myOpen = myOpen === x.dataset.md ? '' : x.dataset.md; V.mine(); });
  $('#view').querySelectorAll('[data-v]').forEach(b => b.onclick = e => { e.stopPropagation(); receipt(S.sales.find(x => x.no === +b.dataset.v)); });
  $('#view').querySelectorAll('[data-un]').forEach(b => b.onclick = e => { e.stopPropagation(); receipt(S.sales.find(x => x.no === +b.dataset.un)); const u = $('#rcU'); if (u) u.click(); });
};
/* ---------- «خەڵات»: pieces the manager gives away — out of the chosen branch, written down, everyone told ---------- */
let gfPick = null, gfB = 0;
V.gifts = () => {
  const G = S.gifts || [], it = gfPick && item(gfPick), pcs = G.reduce((a, g) => a + g.qty, 0), val = G.reduce((a, g) => a + (g.value || 0), 0);
  if (gfB >= S.branches.length) gfB = 0;
  $('#view').innerHTML = `<div class="two"><div class="card pad"><h2>خەڵاتی نوێ</h2><p class="mute" style="margin:4px 0 14px">بابەتەکە هەڵبژێرە، لقەکە دیاری بکە و بنووسە بۆ کێ یان بۆچی. لە کۆگای ئەو لقە کەم دەبێتەوە و ئاگەدارییەک دەنێردرێت.</p>
      <label class="f">بابەت — بارکۆد سکان بکە یان ناو بنووسە<input class="inp" id="gfQ" autocomplete="off" value="${it ? esc(it.name) : ''}"></label><div id="gfHits"></div>
      <div class="fl">لە کام لق</div><div class="seg" style="display:flex;margin-bottom:12px">${S.branches.map((x, k) => `<button data-gb="${k}" class="grow ${gfB === k ? 'on' : ''}">${esc(x)}${it ? ` · <span class="num">${it.s[k]}</span>` : ''}</button>`).join('')}</div>
      <div class="row"><label class="f" style="width:130px">چەند دانە<input class="inp num" id="gfN" type="text" inputmode="numeric" value="1"></label><label class="f grow">بۆ کێ / بۆچی (پێویستە)<input class="inp" id="gfW" maxlength="300" autocomplete="off" placeholder="بۆ نموونە: خەڵاتی کڕیارێکی هەمیشەیی"></label></div>
      <div class="acts"><button class="btn volt" id="gfOk" ${it ? '' : 'disabled'}>${ico('gift', 18)} کردنی بە خەڵات</button></div></div>
    <div style="display:grid;gap:14px;align-content:start"><div class="kgrid" style="grid-template-columns:1fr 1fr;margin:0"><div class="card kpi"><small>دانەی خەڵاتکراو</small><b class="num" id="gfPcs">${pcs}</b></div><div class="card kpi"><small>بەهایان بە نرخی تاک</small>${cu(val)}</div></div></div></div>
    <div class="card scroll" style="margin-top:14px">${G.length ? `<table class="wt"><tr><th>کات</th><th>بابەت</th><th>دانە</th><th>لق</th><th>بۆ کێ / بۆچی</th><th>بەها</th></tr>${G.map(g => `<tr><td>${hm(new Date(Core.ms(g.t)))}<small class="num">${D8(g.t)}</small></td><td class="dfi"><span class="en">${esc(g.name)}</span></td><td class="num"><b>${g.qty}</b></td><td>${esc(S.branches[g.branch] || '')}</td><td class="wwhy">${esc(g.note)}</td><td>${money(g.value || 0)}</td></tr>`).join('')}</table>` : '<div class="empty"><b>هێشتا هیچ شتێک نەکراوە بە خەڵات</b></div>'}</div>`;
  const q = $('#gfQ'), hits = () => { const v = q.value.trim(), lo = v.toLowerCase(), ex = v ? S.items.filter(x => x.bc && x.bc.toLowerCase() === lo) : [], hs = !v ? [] : ex.length ? ex : S.items.filter(x => x.name.toLowerCase().includes(lo)).slice(0, 6);
    if (ex.length === 1) { gfPick = ex[0].id; return V.gifts(); }
    $('#gfHits').innerHTML = hs.map(x => `<button class="sohit" data-gp="${x.id}"><span class="en">${esc(x.name)}</span><span>${S.branches.map((n, k) => esc(n) + ' <span class="num">' + x.s[k] + '</span>').join(' · ')}</span></button>`).join('');
    document.querySelectorAll('[data-gp]').forEach(e => e.onclick = () => { gfPick = +e.dataset.gp; V.gifts(); }); };
  q.oninput = () => { gfPick = null; $('#gfOk').disabled = true; hits(); };
  $('#view').querySelectorAll('[data-gb]').forEach(x => x.onclick = () => { gfB = +x.dataset.gb; const n = $('#gfN').value, w = $('#gfW').value; V.gifts(); $('#gfN').value = n; $('#gfW').value = w; });
  $('#gfOk').onclick = () => run('gift', { branch: gfB, id: gfPick, qty: Math.floor(pn($('#gfN').value) || 0), note: $('#gfW').value.trim() }, () => { gfPick = null; toast('کرا بە خەڵات و ئاگەداری نێردرا'); V.gifts(); });
};
/* ---------- «جەردی پارە»: money given to the manager out of a branch till, and what the till should hold (dollars and dinars apart) ---------- */
V.cashjard = () => {
  const b = S.branch, own = isOwner(), sees = lvl() > 1, H = (S.hands || []), mine = sees ? H : H.filter(h => h.by === S.me);
  const amt = (a, c) => `<b class="num">${Core.fmtCur(a, c)}</b>`, T = x => new Date(Core.ms(x));
  const allD = o => o.iqd + Math.round(dinarOf(Math.abs(o.usd)) / 250) * 250 * Math.sign(o.usd);
  const usdCash = k => S.sales.filter(s => s.branch === k && s.pay === 'cash' && !s.legacy && s.total > 0 && !(s.got && s.got.iqd));   // cash receipts sitting in the dollar till
  const tillCard = k => { const o = Core.till(S, k); return `<div class="card pad tillc"><div class="row sp"><h2>دەخیلی ${esc(S.branches[k])}</h2><span class="tag n">دەبێت ئێستا تێیدا بێت</span></div>
      <div class="tillnow"><div><small>دینار</small><b class="num" data-td="${k}">${DIN(o.iqd)}</b></div><div><small>دۆلار</small><b class="num" data-tu="${k}">${USD(o.usd)}</b></div></div>
      <div class="tillrows"><div><span>هاتووە (فرۆشتنی کاش + قەرزی وەرگیراو)</span><span class="num">${USD(o.inU)} · ${DIN(o.inD)}</span></div><div><span>ڕۆیشتووە (گەڕاوە + مەسروف)</span><span class="num">− ${USD(o.outU)} · ${DIN(o.outD)}</span></div><div><span>دراوە بە وەستا غەریب</span><span class="num">− ${USD(o.handU)} · ${DIN(o.handD)}</span></div>${o.discD ? `<div><span>داشکانی جەردی ڕۆژانە</span><span class="num">− ${DIN(o.discD)}</span></div>` : ''}<div class="tsum"><span>کۆی ئەم دەخیلە (دینار + دۆلار بە نرخی ئەمڕۆ)</span><b class="num">${DIN(allD(o))}</b></div></div>
      ${o.iqd < 0 || o.usd < 0 ? `<p class="twarn">${ico('alert', 15)}<span>${o.iqd < 0 ? 'دینار' : 'دۆلار'} کەوتۆتە ژێر سفر: واتە پارەیەک بە ${o.iqd < 0 ? 'دۆلار' : 'دینار'} تۆمار کراوە بەڵام بە ${o.iqd < 0 ? 'دینار' : 'دۆلار'} وەرگیراوە یان دراوە. ${own ? 'لە خوارەوە «ڕاستکردنەوەی دراوی پسولەکان» بەکاربهێنە.' : 'بە بەڕێوەبەر بڵێ.'}</span></p>` : ''}</div>`; };
  const sumU = mine.filter(h => h.cur === 'USD').reduce((a, h) => a + h.amount, 0), sumD = mine.filter(h => h.cur === 'IQD').reduce((a, h) => a + h.amount, 0);
  $('#view').innerHTML = `${sees ? `<div class="two tills">${S.branches.map((x, k) => tillCard(k)).join('')}</div>${(T => `<div class="card pad gtill"><div class="row sp" style="flex-wrap:wrap;gap:8px"><h2>دەخیلی گشتی — هەردوو لق</h2><span class="tag n">دەبێت ئێستا لە هەموو قاصەکاندا بێت</span></div><div class="tillnow"><div><small>دینار</small><b class="num" id="gTD">${DIN(T.reduce((a, o) => a + o.iqd, 0))}</b></div><div><small>دۆلار</small><b class="num" id="gTU">${USD(T.reduce((a, o) => a + o.usd, 0))}</b></div><div class="tall"><small>کۆی گشتی بە دینار</small><b class="num" id="gTA">${DIN(T.reduce((a, o) => a + allD(o), 0))}</b></div></div></div>`)(S.branches.map((x, k) => Core.till(S, k)))}
    ${own && S.branches.some((x, k) => usdCash(k).length) ? `<div class="card pad curfix"><h2>ڕاستکردنەوەی دراوی پسولەکان</h2><p class="mute" style="margin:4px 0 12px">ئەم پسولە کاشانە وەک «بە دۆلار وەرگیراو» تۆمار کراون. ئەگەر لە ڕاستیدا بە دینار وەرگیراون، بیانگۆڕە: نرخەکەیان ناگۆڕێت، تەنها لە دەخیلی دۆلارەوە دەچنە دەخیلی دینار.</p>${S.branches.map((x, k) => { const L = usdCash(k); return L.length ? `<div class="row sp cfrow"><span><b>${esc(x)}</b> · <span class="num">${L.length}</span> پسولە · <span class="num">${USD(L.reduce((a, s) => a + s.total, 0))}</span></span><button class="btn sm" data-cfix="${k}">هەموویان بە دینار وەرگیراون</button></div>` : ''; }).join('')}<p class="mute" style="font-size:13px;margin-top:8px">بۆ تەنها یەک پسولە: پسولەکە بکەرەوە و دوگمەی «بە دینار وەرگیراوە / بە دۆلار» دابگرە.</p></div>` : ''}
    <div class="card pad debtbar"><span>قەرز لای کڕیاران — هێشتا وەرنەگیراوە و لە هیچ قاصەیەکدا نییە</span><b class="num">${fmtMoney(Core.till(S, 0).debt)}</b></div><p class="mute" style="margin:-4px 0 14px;font-size:14px">دۆلار و دینار جیا هەژمار دەکرێن، بۆیە گۆڕانی نرخی دۆلار هیچ نەقس و زیادەیەک لە دەخیلدا دروست ناکات.</p>` : ''}
    ${own ? '' : `<div class="card pad" style="margin-bottom:14px"><h2>پارەدان بە وەستا غەریب — ${esc(S.branches[b])}</h2><p class="mute" style="margin:4px 0 14px">هەر پارەیەک لە دەخیل دەیدەیت بە وەستا غەریب، لێرە بینووسە. دوای «تەواو» تەنها بەڕێوەبەر دەتوانێت دەستکاریی بکات.</p>
      ${(o => `<div class="tillnow tilln"><div><small>ئێستا لە قاصەدایە — دینار</small><b class="num" id="hTD">${DIN(o.iqd)}</b></div><div><small>ئێستا لە قاصەدایە — دۆلار</small><b class="num" id="hTU">${USD(o.usd)}</b></div><div class="tdebt"><small>قەرز لای کڕیاران (لە قاصەدا نییە)</small><b class="num" id="hDebt">${fmtMoney(o.debt || 0)}</b></div></div><div class="tillrows tmini"><div><span>هاتووە (فرۆشتنی کاش + قەرزی وەرگیراو)</span><span class="num">${DIN(o.inD)}${o.inU ? ' · ' + USD(o.inU) : ''}</span></div><div><span>مەسروف و گەڕاوە</span><span class="num">− ${DIN(o.outD)}${o.outU ? ' · ' + USD(o.outU) : ''}</span></div><div><span>دراوە بە وەستا غەریب</span><span class="num">− ${DIN(o.handD)}${o.handU ? ' · ' + USD(o.handU) : ''}</span></div>${o.discD ? `<div><span>داشکانی جەردی ڕۆژانە</span><span class="num">− ${DIN(o.discD)}</span></div>` : ''}</div>`)(sees || !S.myTill ? Core.till(S, b) : S.myTill)}
      <div class="row hform"><input class="inp num grow" id="hA" type="text" inputmode="decimal" placeholder="بڕی پارە" autocomplete="off" style="font-size:19px;font-weight:800"><div class="seg" id="hCur"><button data-hc="IQD" class="on">دینار</button><button data-hc="USD">دۆلار $</button></div></div>
      <label class="f" style="margin-top:12px">هۆکار / تێبینی (پێویستە)<input class="inp" id="hN" maxlength="300" placeholder="بۆ نموونە: پارەی فرۆشی ئەمڕۆم دا بە وەستا غەریب" autocomplete="off"></label>
      <div class="acts"><button class="btn blue" id="hOk">${ico('check', 19)}تەواو</button></div></div>`}
    <div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"><div class="card kpi"><small>${sees ? 'کۆی دراو بە وەستا غەریب' : 'کۆی ئەوەی داومە'} — دۆلار</small><b class="num" id="hSumU">${USD(sumU)}</b></div><div class="card kpi"><small>${sees ? 'کۆی دراو بە وەستا غەریب' : 'کۆی ئەوەی داومە'} — دینار</small><b class="num" id="hSumD">${DIN(sumD)}</b></div><div class="card kpi"><small>ژمارەی تۆمار</small><b class="num">${mine.length}</b></div></div>
    <div class="card scroll">${mine.length ? `<table class="wt hands"><tr><th>کات</th><th>کێ</th><th>لق</th><th>بڕ</th><th>هۆکار</th><th>دۆخ</th>${own ? '<th></th>' : ''}</tr>${mine.slice(0, 300).map(h => `<tr><td>${hm(T(h.t))}<small class="num">${D8(h.t)}</small></td><td class="en"><b>${esc(h.by)}</b></td><td>${esc(S.branches[h.branch] || '')}</td><td>${amt(h.amount, h.cur)}${h.edited ? '<small>ڕاستکراوەتەوە</small>' : ''}</td><td class="wwhy">${esc(h.note)}</td><td>${h.ok ? '<span class="tag g">وەستا غەریب وەریگرت</span>' : '<span class="tag a">چاوەڕوانی پشتڕاستکردنەوە</span>'}</td>${own ? `<td><div class="row">${h.ok ? '' : `<button class="btn blue sm" data-hok="${h.id}">${ico('check', 15)}وەرمگرت</button>`}<button class="ghost sm" data-hed="${h.id}">دەستکاری</button><button class="rm" data-hdel="${h.id}" title="سڕینەوە">${ico('trash', 16)}</button></div></td>` : ''}</tr>`).join('')}</table>` : `<div class="empty"><b>هێشتا هیچ پارەیەک تۆمار نەکراوە</b></div>`}</div>`;
  let hc = 'IQD';
  document.querySelectorAll('[data-hc]').forEach(x => x.onclick = () => { hc = x.dataset.hc; document.querySelectorAll('[data-hc]').forEach(y => y.classList.toggle('on', y === x)); });
  if ($('#hOk')) $('#hOk').onclick = () => { const v = pn($('#hA').value, hc === 'IQD'); run('handOver', { amount: hc === 'IQD' ? Math.round(v) : Math.round(v * 100), cur: hc, note: $('#hN').value.trim() }, () => { toast('تۆمار کرا و بەڕێوەبەر ئاگەدار کرایەوە'); V.cashjard(); }); };
  $('#view').querySelectorAll('[data-cfix]').forEach(x => x.onclick = () => { const k = +x.dataset.cfix, L = usdCash(k);
    modal(`<h2>بە دینار وەرگیراون؟</h2><p class="mute" style="margin:6px 0 14px"><b class="num">${L.length}</b> پسولەی کاشی ${esc(S.branches[k])} (<span class="num">${USD(L.reduce((a, s) => a + s.total, 0))}</span>) وەک وەرگیراو بە دینار تۆمار دەکرێنەوە. نرخ و کۆگا ناگۆڕێن.</p><div class="acts"><button class="btn volt" id="cfOk">بەڵێ، بە دینار بوون</button><button class="ghost" id="cfNo">پاشگەزبوونەوە</button></div>`);
    $('#cfNo').onclick = closeModal; $('#cfOk').onclick = () => run('cashCur', { nos: L.map(s => s.no), cur: 'IQD' }, () => { closeModal(); toast('ڕاست کرایەوە'); V.cashjard(); }); });
  $('#view').querySelectorAll('[data-hok]').forEach(x => x.onclick = () => run('handEdit', { id: +x.dataset.hok, ok: true }, () => V.cashjard()));
  $('#view').querySelectorAll('[data-hdel]').forEach(x => x.onclick = () => { const h = H.find(y => y.id === +x.dataset.hdel); modal(`<h2>سڕینەوەی تۆمار</h2><p class="mute">تۆماری ${amt(h.amount, h.cur)} ی ${esc(h.by)} دەسڕێتەوە و پارەکە دەگەڕێتەوە ناو هەژماری دەخیل.</p><div class="acts"><button class="btn red" id="hdY">بیسڕەوە</button><button class="ghost" id="hdN">نەخێر</button></div>`); $('#hdN').onclick = closeModal; $('#hdY').onclick = () => run('handEdit', { id: h.id, del: true }, () => { closeModal(); V.cashjard(); }); });
  $('#view').querySelectorAll('[data-hed]').forEach(x => x.onclick = () => { const h = H.find(y => y.id === +x.dataset.hed); let c2 = h.cur;
    modal(`<h2>دەستکاریی تۆماری پارە</h2><p class="mute" style="margin-bottom:12px">${esc(h.by)} · ${esc(S.branches[h.branch] || '')} · <span class="num">${D8(h.t)}</span></p>
      <div class="row"><input class="inp num grow" id="heA" type="text" inputmode="decimal" value="${h.cur === 'IQD' ? h.amount : (h.amount / 100).toFixed(2)}"><div class="seg"><button data-hc2="IQD" class="${h.cur === 'IQD' ? 'on' : ''}">دینار</button><button data-hc2="USD" class="${h.cur === 'USD' ? 'on' : ''}">دۆلار $</button></div></div>
      <label class="f" style="margin-top:12px">هۆکار<input class="inp" id="heN" maxlength="300" value="${esc(h.note)}"></label><div class="acts"><button class="btn" id="heOk">هەڵگرتن</button><button class="ghost" id="heNo">پاشگەزبوونەوە</button></div>`);
    document.querySelectorAll('[data-hc2]').forEach(y => y.onclick = () => { c2 = y.dataset.hc2; document.querySelectorAll('[data-hc2]').forEach(z => z.classList.toggle('on', z === y)); });
    $('#heNo').onclick = closeModal; $('#heOk').onclick = () => { const v = pn($('#heA').value, c2 === 'IQD'); run('handEdit', { id: h.id, amount: c2 === 'IQD' ? Math.round(v) : Math.round(v * 100), cur: c2, note: $('#heN').value.trim() }, () => { closeModal(); V.cashjard(); }); }; });
};
/* ---------- «موشتەرییەکان»: everyone who bought, by phone number — what, how many, how much, when ---------- */
let byQ = '', byOpen = '';
let byS = 'top';
V.buyers = () => {
  const M = new Map(), key = s => { const cu = s.customer && cust(s.customer); return s.phone || (cu && Core.cleanPhone(cu.phone)) || (cu ? 'c' + cu.id : ''); };
  S.sales.forEach(s => { const k = key(s); if (!k) return; const cu = s.customer && cust(s.customer); let o = M.get(k);
    if (!o) M.set(k, o = { k, phone: /^c\d+$/.test(k) ? '' : k, names: new Set(), sales: [], total: 0, pcs: 0, last: 0, wh: !!cu, n: 0 });
    if (s.buyer) o.names.add(s.buyer); if (cu) o.names.add(cu.name); o.sales.push(s); if (s.arc) return; o.n++; o.total += s.total - s.refunded; o.pcs += s.lines.reduce((a, l) => a + l.qty - l.ret, 0); o.last = Math.max(o.last, Core.ms(s.t)); });
  Object.entries((S.arch && S.arch.buy) || {}).forEach(([k, x]) => { let o = M.get(k); if (!o) M.set(k, o = { k, phone: /^c\d+$/.test(k) ? '' : k, names: new Set(), sales: [], total: 0, pcs: 0, last: 0, wh: /^c\d+$/.test(k), n: 0 });
    o.total += x.t; o.pcs += x.p; o.n += x.n; o.last = Math.max(o.last, x.l); (x.nm || []).forEach(n => o.names.add(n)); });   // what the archived months added
  const top = [...M.values()].sort((a, b) => b.total - a.total || b.pcs - a.pcs), rank = new Map(top.map((o, i) => [o.k, i + 1])), best = top[0] && top[0].total > 0 ? top[0] : null;
  const all = byS === 'last' ? [...M.values()].sort((a, b) => b.last - a.last) : top, q = byQ.trim().toLowerCase(), qd = Core.cleanPhone(byQ);
  const list = !q ? all : all.filter(o => (qd.length >= 3 && o.phone.includes(qd)) || [...o.names].some(n => n.toLowerCase().includes(q)));
  const noPh = S.sales.filter(s => !key(s) && !s.legacy).length, nm = o => [...o.names].join('، ') || '—';
  const detail = o => `<tr class="bdet"><td colspan="7"><div class="scroll"><table class="wt"><tr><th>کات</th><th>پسولە</th><th>کاڵا</th><th>جۆر</th><th>پارەدان</th><th>کۆ</th><th>فرۆشیار</th></tr>${o.sales.map(s => `<tr><td>${hm(new Date(Core.ms(s.t)))}<small class="num">${D8(s.t)}</small></td><td><button class="ghost sm num" data-v="${s.no}">#${s.no}</button></td><td class="dfi">${s.lines.map(l => `<span class="num">${l.qty} ×</span> <span class="en">${esc(l.name)}</span>${l.ret ? ` <span class="tag r">گەڕاوەتەوە <span class="num">${l.ret}</span></span>` : ''}`).join('<br>')}</td><td><span class="tag n">${TYPES[s.type]}</span></td><td>${payTag(s.pay)}</td><td>${money(s.total - s.refunded)}</td><td class="en">${esc(s.by)}</td></tr>`).join('')}</table></div></td></tr>`;
  $('#view').innerHTML = `<div class="kgrid"><div class="card kpi"><small>موشتەری بە ژمارەی مۆبایل</small><b class="num" id="byN">${all.length}</b></div><div class="card kpi"><small>کۆی کڕینیان</small>${cu(all.reduce((a, o) => a + o.total, 0))}</div><div class="card kpi"><small>فرۆشتنی بێ ژمارە</small><b class="num">${noPh}</b></div></div>
    ${best ? `<div class="card pad bestb"><span class="bcrown">${ico('crown', 26)}</span><div class="grow"><small>زۆرترین کڕین تا ئێستا</small><b class="en">${esc(nm(best))}</b><span class="mute num">${esc(best.phone) || ''}</span></div><div class="bnum"><b class="num" id="byBest">${fmtMoney(best.total)}</b><small><span class="num">${best.pcs}</span> دانە · <span class="num">${best.n}</span> پسولە</small></div></div>` : ''}
    <div class="row byrow" style="margin-bottom:14px"><input class="inp grow" id="byQ" placeholder="گەڕان بە ناو یان ژمارەی مۆبایل" value="${esc(byQ)}" autocomplete="off"><div class="seg"><button data-bys="top" class="${byS === 'last' ? '' : 'on'}">زۆرترین کڕین</button><button data-bys="last" class="${byS === 'last' ? 'on' : ''}">دوایین کڕین</button></div></div>
    <div class="card scroll">${list.length ? `<table class="byt"><tr><th>پلە</th><th>مۆبایل</th><th>ناو</th><th>پسولە</th><th>دانە</th><th>کۆی کڕین</th><th>دوایین کڕین</th></tr>${list.slice(0, 200).map(o => `<tr class="brow ${byOpen === o.k ? 'sel' : ''} ${rank.get(o.k) === 1 && o.total > 0 ? 'top1' : ''}" data-bk="${esc(o.k)}"><td><span class="medal m${Math.min(rank.get(o.k), 4)} num">${rank.get(o.k)}</span></td><td class="num"><b>${esc(o.phone) || '—'}</b></td><td class="en">${esc(nm(o))}${o.wh ? ' <span class="tag b">جوملە</span>' : ''}${rank.get(o.k) === 1 && o.total > 0 ? ' <span class="tag g topt">زۆرترین کڕین</span>' : ''}</td><td class="num">${o.n}</td><td class="num">${o.pcs}</td><td><b>${money(o.total)}</b></td><td class="num">${D8(o.last)}</td></tr>${byOpen === o.k ? detail(o) : ''}`).join('')}</table>` : `<div class="empty"><b>${q ? 'هیچ موشتەرییەک نەدۆزرایەوە' : 'هێشتا هیچ موشتەرییەک بە ژمارەی مۆبایل تۆمار نەکراوە'}</b>لە کاتی فرۆشتن، ژمارەی مۆبایلی کڕیار لە سەبەتە بنووسە؛ هەموو کڕینەکانی لێرە کۆ دەبنەوە</div>`}</div>`;
  const i = $('#byQ'); i.oninput = () => { byQ = i.value; V.buyers(); const n = $('#byQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('#view').querySelectorAll('[data-bys]').forEach(x => x.onclick = () => { byS = x.dataset.bys; V.buyers(); });
  $('#view').querySelectorAll('[data-bk]').forEach(r => r.onclick = () => { byOpen = byOpen === r.dataset.bk ? '' : r.dataset.bk; V.buyers(); });
  $('#view').querySelectorAll('[data-v]').forEach(b => b.onclick = e => { e.stopPropagation(); receipt(S.sales.find(x => x.no === +b.dataset.v)); });
};
/* ---------- over / short: what was taken for every cash sale against its price ---------- */
let dfP = 'today', dfW = '';
V.diffs = () => {
  const now = new Date(), t0 = Core.dayStart(S, now), from = { today: t0, week: t0 - 6 * 864e5, month: Math.min(t0, new Date(now.getFullYear(), now.getMonth(), 1).getTime()), all: 0 }[dfP];
  const inP = S.sales.filter(x => x.got && Core.ms(x.t) >= from), all = inP.filter(x => x.diffD), list = all.filter(x => !dfW || x.by === dfW);
  const N = n => Math.abs(n).toLocaleString('en-US'), sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const over = sum(list, x => Math.max(0, x.diffD)), short = sum(list, x => Math.max(0, -x.diffD)), net = over - short, cashN = inP.filter(x => !dfW || x.by === dfW).length;
  const who = {}; all.forEach(x => { const o = who[x.by] || (who[x.by] = { n: 0, over: 0, short: 0 }); o.n++; if (x.diffD > 0) o.over += x.diffD; else o.short -= x.diffD; });
  const names = Object.keys(who).sort((a, b) => who[b].short - who[a].short || who[b].over - who[a].over);
  const netB = n => `<b class="num ${n < 0 ? 'dneg' : n > 0 ? 'dpos' : ''}">${n < 0 ? '−' : n > 0 ? '+' : ''}${N(n)} د.ع</b>`;
  $('#view').innerHTML = `<div class="row sp dfbar"><div class="seg">${[['today', 'ئەمڕۆ'], ['week', '7 ڕۆژ'], ['month', 'ئەم مانگە'], ['all', 'هەموو']].map(o => `<button data-dp="${o[0]}" class="${dfP === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>
      <select class="inp" id="dfWho"><option value="">هەموو کەسەکان</option>${S.team.map(u => `<option value="${esc(u.name)}" ${dfW === u.name ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
    <div class="kgrid dfk"><div class="card kpi"><small><span class="dot r">${ico('diff', 15)}</span>کۆی کەمی</small><b class="num dneg" id="dfShort">${N(short)} د.ع</b></div><div class="card kpi"><small><span class="dot a">${ico('diff', 15)}</span>کۆی زیادە</small><b class="num dpos" id="dfOver">${N(over)} د.ع</b></div><div class="card kpi"><small>پوختە (زیادە − کەمی)</small>${netB(net)}</div><div class="card kpi"><small>پسولەی جیاواز</small><b class="num" id="dfN">${list.length}</b><em class="num">لە ${cashN} فرۆشتنی کاش</em></div></div>
    ${names.length ? `<div class="card scroll" style="margin-bottom:14px"><table><tr><th>کێ</th><th>چەند جار</th><th>کەمی</th><th>زیادە</th><th>پوختە</th></tr>${names.map(n => { const o = who[n]; return `<tr class="${dfW === n ? 'sel' : ''}"><td class="en"><b>${esc(n)}</b></td><td class="num">${o.n}</td><td>${o.short ? `<span class="tag r"><span class="num">${N(o.short)}</span> د.ع</span>` : '—'}</td><td>${o.over ? `<span class="tag a"><span class="num">${N(o.over)}</span> د.ع</span>` : '—'}</td><td>${netB(o.over - o.short)}</td></tr>`; }).join('')}</table></div>` : ''}
    <div class="card scroll">${list.length ? `<table class="dft"><tr><th>کات</th><th>کێ</th><th>لق</th><th>پسولە</th><th>کاڵا</th><th>نرخ</th><th>وەرگیراو</th><th>جیاوازی</th></tr>${list.map(x => `<tr><td>${hm(x.t)}<small class="num">${x.t.toLocaleDateString('en-GB')}</small></td><td class="en"><b>${esc(x.by)}</b></td><td>${esc(S.branches[x.branch])}</td><td><button class="ghost sm num" data-v="${x.no}" title="بینینی پسولە">#${x.no}</button></td><td class="dfi">${x.lines.map(l => `<span class="num">${l.qty} ×</span> <span class="en">${esc(l.name)}</span>`).join('<br>')}</td><td><span class="num">${S.cur === 'IQD' ? DIN(dinarOf(x.total, x.rate)) : USD(x.total)}</span><small class="num">${S.cur === 'IQD' ? USD(x.total) : DIN(dinarOf(x.total, x.rate))}</small></td><td class="num">${Core.gotTxt(x.got)}</td><td>${diffTag(x.diffD)}</td></tr>`).join('')}</table>` : `<div class="empty"><b>لەم ماوەیەدا هیچ نەقس و زیادەیەک نییە</b>هەر فرۆشتنێکی کاش کە پارەی وەرگیراوی لەگەڵ نرخەکەی جیاواز بێت، بە ناوی فرۆشیارەکەی لێرە تۆمار دەبێت</div>`}</div>`;
  $('#view').querySelectorAll('[data-dp]').forEach(b => b.onclick = () => { dfP = b.dataset.dp; V.diffs(); });
  $('#dfWho').onchange = e => { dfW = e.target.value; V.diffs(); };
  $('#view').querySelectorAll('[data-v]').forEach(b => b.onclick = () => receipt(S.sales.find(x => x.no === +b.dataset.v)));
};
V.log = () => { $('#view').innerHTML = `<div class="card pad" style="max-width:940px"><p class="mute" style="margin-bottom:6px">هەموو کارێک بە ناوی ئەو کەسەی کردوویەتی تۆمار دەکرێت و ناسڕدرێتەوە.</p>${S.log.map(feedRow).join('') || '<div class="empty"><b>تۆمارەکە بەتاڵە</b></div>'}</div>`; };
/* a section that fails to draw must never leave the old section on screen */
['sales', 'log', 'expenses', 'cashjard', 'buyers', 'customers', 'diffs', 'warranty', 'returns', 'mine'].forEach(n => { const f = V[n]; V[n] = (...a) => { const r = f(...a); try { archFoot(() => V[n]()); } catch (e) {} return r; }; });
const drawView = () => { try { V[S.view](); fitAll(); } catch (e) { console.error(e); $('#view').innerHTML = `<div class="card pad empty"><b>ئەم بەشە نەکرایەوە</b>تکایە پەڕەکە نوێ بکەرەوە. ئەگەر دووبارە بووەوە، ئەم دێڕە بنێرە: <span class="num">${esc(S.view)} — ${esc(e.message)}</span></div>`; } };
let rsT; addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S.me) { shell(); fitAll(); } }, 200); });
{ let fT = 0; const later = () => { if (fT) return; fT = requestAnimationFrame(() => { fT = 0; fitAll(); }); };
  if (window.MutationObserver) ['#view', '#sheet', '#charge'].forEach(s => { const n = document.querySelector(s); if (n) new MutationObserver(later).observe(n, { childList: true, subtree: true }); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitAll(); if (S.me) fitNav(); });
  if (window.ResizeObserver) { let h0 = -1; const nav = document.querySelector('.side nav'); if (nav) new ResizeObserver(() => { if (nav.clientHeight !== h0) { h0 = nav.clientHeight; fitNav(); } }).observe(nav); } }
if (REMOTE) { boot(); setInterval(poll, 5000); document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); }); }
else {
  load(); S.tz = -new Date().getTimezoneOffset(); // offline "today" follows this device's clock
  if (S.session && acct(S.session)) { if (!acct(S.me)) S.me = S.session; render(true); } else showLogin();
}
