/* ==========================================================================
   PAY2B — Totem Interativo
   Jornada vinculada: o estado criado no Checkout alimenta Notificações,
   Portal do Merchant e Portal de Cobrança.
   ========================================================================== */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const BRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const hms = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  /* ---------- Dados da demonstração ---------- */
  const DEMO = {
    customer: 'Lucas Mendonça Silva',
    first: 'Lucas',
    initials: 'LM',
    policy: 'AP-982410',
    product: 'Atlas Auto · Proteção Prime',
    insurerName: 'Atlas Seguradora',
    brokerName: 'Vértice Corretora',
    amount: 1840,
    installments: 10,
    insurerShare: 1692.8,
    brokerShare: 147.2,
    nextInstallment: 184,
  };

  const OVERDUE = [
    { name: 'Beatriz Nogueira Faria', init: 'BN', policy: 'AP-771203', parc: '03/12', days: 12, value: 312.5, reason: 'Cartão expirado', outcome: 'pix' },
    { name: 'Rodrigo Neves Tavares', init: 'RN', policy: 'VD-440917', parc: '07/12', days: 5, value: 189.9, reason: 'Saldo insuficiente', outcome: 'card' },
    { name: 'Camila Albuquerque Lima', init: 'CA', policy: 'RS-208855', parc: '02/10', days: 21, value: 428.0, reason: 'Cartão cancelado', outcome: 'opened' },
    { name: 'Felipe Augusto Ramos', init: 'FR', policy: 'AP-663021', parc: '05/12', days: 8, value: 254.3, reason: 'Não autorizado pelo emissor', outcome: 'pix' },
  ];

  const freshState = () => ({
    quoted: false,
    paid: false,
    method: 'card',
    tx: null,
    seen: { notify: false, portal: false },
    collect: { rows: {}, prevPct: 0 },
  });
  let S = freshState();
  let cur = 'menu';

  /* ---------- Escala do canvas 1080x1920 ---------- */
  const stage = $('#stage');
  function fit() {
    const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- Relógio ---------- */
  function tickClock() {
    const d = new Date();
    $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  tickClock();
  setInterval(tickClock, 15000);

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }

  /* ---------- Navegação ---------- */
  function go(name) {
    if (cur === 'quote' && name !== 'quote') stopQuote();
    if (cur === 'checkout' && name !== 'checkout') stopCheckout();
    hideSuccess();
    cur = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    if (name === 'menu') renderMenu();
    if (name === 'quote') startQuote(600);
    if (name === 'checkout') startCheckout(800);
    if (name === 'notify') { S.seen.notify = true; renderNotify(); }
    if (name === 'portal') { S.seen.portal = true; renderPortal(); }
    if (name === 'collect') renderCollect(true);
    if (name === 'menu') resetDemo();
    stage.dataset.screen = name;
    document.dispatchEvent(new CustomEvent('pay2b:screen', { detail: { name, paid: S.paid } }));
    resetIdle();
  }

  function resetDemo() {
    stopQuote();
    stopCheckout();
    S = freshState();
    clearQuoteFields();
    clearCheckoutFields();
    renderMenu();
  }

  // API consumida pela camada guiada (js/totem.js)
  window.Pay2B = {
    go: (name) => go(name),
    state: () => ({ quoted: S.quoted, paid: S.paid, current: cur }),
  };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (t) go(t.dataset.go);
  });

  /* ---------- Menu: Status e Jornada Conectada ---------- */
  function setStatus(id, text, done, fresh) {
    const st = $('#st-' + id);
    if (st) {
      const b = st.querySelector('b');
      if (b) b.textContent = text;
    }
    const node = $('#node-' + id);
    if (node) {
      node.classList.toggle('done', !!done);
      node.classList.toggle('fresh', !!fresh);
      const stepEl = node.closest('.step');
      if (stepEl) stepEl.classList.toggle('done', !!done);
    }
  }

  function renderMenu() {
    const c = S.collect.rows;
    const recovered = Object.values(c).filter((r) => r.state === 'paid').length;
    const started = Object.keys(c).length > 0;

    // 01. Geração da cobrança
    if (!S.quoted) {
      setStatus('quote', 'Toque para iniciar', false, true);
      $('#node-quote').classList.add('attract');
    } else {
      setStatus('quote', 'Cotação enviada · WhatsApp e E-mail', true, false);
      $('#node-quote').classList.remove('attract');
    }

    // 02. Checkout
    if (!S.quoted) {
      setStatus('checkout', 'Aguardando cotação', false, false);
      $('#node-checkout').classList.remove('attract');
    } else if (!S.paid) {
      setStatus('checkout', 'Link recebido · Toque para pagar', false, true);
      $('#node-checkout').classList.add('attract');
    } else {
      setStatus('checkout', `Pago · ${BRL(DEMO.amount)}`, true, false);
      $('#node-checkout').classList.remove('attract');
    }

    // 03. Notificações
    if (!S.paid) {
      setStatus('notify', 'Aguardando pagamento', false, false);
    } else {
      setStatus('notify', '4 mensagens entregues', true, !S.seen.notify);
    }

    // 04. Portal do Merchant
    if (!S.paid) {
      setStatus('portal', 'Aguardando transação', false, false);
    } else {
      setStatus('portal', S.seen.portal ? '1 transação conciliada' : '1 nova transação', true, !S.seen.portal);
    }

    // 05. Cobrança
    if (recovered > 0) {
      setStatus('collect', `${recovered} recuperada${recovered > 1 ? 's' : ''} agora`, true, false);
    } else if (started) {
      setStatus('collect', 'Cobrança em andamento', true, false);
    } else {
      setStatus('collect', 'Pronto para cobrar', false, false);
    }
  }

  $('#btn-reset').addEventListener('click', () => {
    stopQuote();
    stopCheckout();
    S = freshState();
    clearQuoteFields();
    clearCheckoutFields();
    renderMenu();
    toast('Demonstração reiniciada');
  });

  /* ---------- Helpers de meio de pagamento ---------- */
  function methodShort() {
    return { card: 'Cartão Mastercard 10x', pix: 'Pix Automático 10x', boleto: 'Boleto 10x' }[S.method];
  }
  function methodTable() {
    return { card: 'Cartão 10x', pix: 'Pix 10x', boleto: 'Boleto 10x' }[S.method];
  }
  function methodLong() {
    return {
      card: `Cartão Mastercard final 8492 · ${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}`,
      pix: `Pix Automático · ${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}`,
      boleto: `Boleto Bancário · ${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}`,
    }[S.method];
  }

  /* ---------- Helpers compartilhados de formulário ---------- */
  const val = (box) => (box ? box.querySelector('.val') : null);

  function setActive(box) {
    $$('.input.active').forEach((b) => b.classList.remove('active'));
    if (box) box.classList.add('active');
  }

  async function typeInto(box, text, ms, isCancel, onTick) {
    if (!box) return false;
    const el = val(box);
    if (!el) return false;
    setActive(box);
    el.textContent = '';
    for (let i = 1; i <= text.length; i++) {
      if (typeof isCancel === 'function' ? isCancel() : isCancel) return false;
      el.textContent = text.slice(0, i);
      if (onTick) onTick(el.textContent);
      await sleep(ms);
    }
    return true;
  }

  // Simula a abertura de um combo e a escolha de uma opção (sem digitação)
  async function selectInto(box, options, chosen, isCancel) {
    if (!box) return false;
    const cancel = () => (typeof isCancel === 'function' ? isCancel() : isCancel);
    const close = () => { box.querySelectorAll('.select-list').forEach((l) => l.remove()); box.classList.remove('select-open'); };
    setActive(box);
    close();
    box.classList.add('select-open');
    const list = document.createElement('ul');
    list.className = 'select-list';
    list.setAttribute('role', 'listbox');
    options.forEach((o) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = o;
      list.appendChild(li);
    });
    box.appendChild(list);
    const items = Array.from(list.children);
    await sleep(450);
    for (let i = 0; i <= chosen; i++) {
      if (cancel()) { close(); return false; }
      items.forEach((li, k) => li.classList.toggle('hover', k === i));
      await sleep(240);
    }
    items[chosen].classList.add('picked');
    await sleep(320);
    if (cancel()) { close(); return false; }
    val(box).textContent = options[chosen];
    close();
    return true;
  }

  // Valor gerado pelo sistema: aparece pronto, com destaque breve
  function setSystem(box, text) {
    const el = val(box);
    if (!el) return;
    el.textContent = text;
    box.classList.remove('sys');
    void box.offsetWidth;
    box.classList.add('sys');
  }

  /* ==========================================================================
     01. COTADOR DO CORRETOR
     ========================================================================== */
  let quoteRun = 0;
  let quoteReady = false;
  let quoteSending = false;

  const QF = {
    name: $('#q-name'),
    tel: $('#q-tel'),
    mail: $('#q-mail'),
    car: $('#q-car'),
    cov: $('#q-cov'),
  };

  function clearQuoteFields() {
    Object.values(QF).forEach((b) => {
      if (b) {
        val(b).textContent = '';
        b.classList.remove('active');
      }
    });
    $('#q-form').hidden = false;
    $('#q-result').hidden = true;
  }

  function setQuoteButton(enabled, label) {
    const b = $('#btn-quote');
    if (!b) return;
    b.disabled = !enabled;
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = label;
  }

  function stopQuote() {
    quoteRun++;
    quoteSending = false;
  }

  function startQuote(delay) {
    stopQuote();
    const run = quoteRun;
    quoteReady = false;
    $('#btn-quote').classList.remove('loading');

    if (S.quoted) {
      $('#q-form').hidden = true;
      $('#q-result').hidden = false;
      setQuoteButton(true, 'Avançar para o Checkout →');
      return;
    }

    clearQuoteFields();
    setQuoteButton(false, 'Preenchendo cotação…');
    sleep(delay).then(() => {
      if (run === quoteRun) autofillQuote(run);
    });
  }

  async function autofillQuote(run) {
    const cancel = () => run !== quoteRun;
    if (!(await typeInto(QF.name, 'Lucas Mendonça Silva', 30, cancel))) return;
    await sleep(140);
    if (!(await typeInto(QF.tel, '(11) 98765-4321', 34, cancel))) return;
    await sleep(140);
    if (!(await typeInto(QF.mail, 'lucas.mendonca@exemplo.com.br', 22, cancel))) return;
    await sleep(140);
    if (!(await typeInto(QF.car, 'Jeep Compass Longitude 2024', 28, cancel))) return;
    await sleep(140);
    if (!(await typeInto(QF.cov, 'Completa 100% FIPE + Vidros', 22, cancel))) return;

    setActive(null);
    quoteReady = true;
    setQuoteButton(true, 'Gerar Cobrança e Enviar Link');
  }

  $('#btn-quote').addEventListener('click', async () => {
    if (S.quoted) {
      go('checkout');
      return;
    }
    if (!quoteReady || quoteSending) return;
    quoteSending = true;

    const btn = $('#btn-quote');
    btn.classList.add('loading');
    btn.disabled = true;

    const steps = [
      'Calculando prêmio…',
      'Gerando cobrança Pay2B…',
      'Disparando via WhatsApp…',
      'Enviando por E-mail…',
    ];

    for (let i = 0; i < steps.length; i++) {
      btn.querySelector('.lbl').textContent = steps[i];
      await sleep(650);
    }

    btn.classList.remove('loading');
    S.quoted = true;
    quoteSending = false;

    $('#q-form').hidden = true;
    $('#q-result').hidden = false;

    setQuoteButton(true, 'Avançar para o Checkout →');
    toast('Cobrança gerada! Link de checkout enviado ao cliente.');
  });

  /* ==========================================================================
     02. CHECKOUT DO CLIENTE
     ========================================================================== */
  let fillRun = 0;
  let ready = false;
  let paying = false;
  let pixTimer = null;

  const F = {
    name: $('#f-name'), num: $('#f-num'), exp: $('#f-exp'), cvv: $('#f-cvv'),
    cpf: $('#f-cpf'), nasc: $('#f-nasc'), inst: $('#f-inst'),
    pixInst: $('#f-pix-inst'), pix: $('#f-pix'),
    boletoInst: $('#f-boleto-inst'), linha: $('#f-linha'), venc: $('#f-venc'), benef: $('#f-benef'),
  };

  function clearCheckoutFields() {
    Object.values(F).forEach((b) => {
      if (b) {
        const v = val(b);
        if (v) v.textContent = '';
        b.classList.remove('active', 'sys', 'select-open');
        b.querySelectorAll('.select-list').forEach((l) => l.remove());
      }
    });
    const vcNum = $('#vc-num'); if (vcNum) vcNum.textContent = '•••• •••• •••• ••••';
    const vcName = $('#vc-name'); if (vcName) vcName.textContent = 'NOME NO CARTÃO';
    const vcExp = $('#vc-exp'); if (vcExp) vcExp.textContent = 'MM/AA';
    const vcTok = $('#vc-token'); if (vcTok) vcTok.classList.remove('on');
  }

  function setPayButton(enabled, label) {
    const b = $('#btn-pay');
    if (!b) return;
    b.disabled = !enabled;
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = label;
  }

  function payLabel() {
    const verb = {
      card: `Autorizar · ${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}`,
      pix: `Confirmar Pix · ${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}`,
      boleto: `Confirmar Boleto · ${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}`
    }[S.method];
    return verb;
  }

  function stopCheckout() {
    fillRun++;
    clearInterval(pixTimer);
    paying = false;
  }

  function startCheckout(delay) {
    stopCheckout();
    S.quoted = true;
    const run = fillRun;
    ready = false;
    clearCheckoutFields();
    const btnPay = $('#btn-pay');
    if (btnPay) btnPay.classList.remove('loading');
    setPayButton(false, 'Preenchendo dados…');
    $$('.method-w, .method').forEach((m) => m.classList.toggle('active', m.dataset.method === S.method));
    $$('.pp').forEach((p) => p.classList.toggle('active', p.id === 'pp-' + S.method));
    const pixSt = $('#pix-status');
    if (pixSt) {
      pixSt.className = 'pill warn';
      pixSt.innerHTML = '<i class="dot"></i>Aguardando pagamento';
    }
    sleep(delay).then(() => { if (run === fillRun) autofill(S.method, run); });
  }

  async function autofill(method, run) {
    const cancel = () => run !== fillRun;
    if (method === 'card') {
      if (!(await typeInto(F.num, '5502 4410 8392 8492', 32, cancel))) return;
      await sleep(140);
      if (cancel()) return;
      val(F.num).textContent = '5502 •••• •••• 8492';
      const vcTok = $('#vc-token'); if (vcTok) vcTok.classList.add('on');
      await sleep(150);
      if (!(await typeInto(F.name, 'LUCAS MENDONÇA SILVA', 28, cancel))) return;
      await sleep(130);
      if (!(await typeInto(F.exp, '08/31', 40, cancel))) return;
      await sleep(110);
      if (!(await typeInto(F.cvv, '482', 45, cancel))) return;
      await sleep(90);
      val(F.cvv).textContent = '•••';
      if (!(await typeInto(F.cpf, '252.457.158-05', 26, cancel))) return;
      await sleep(110);
      if (!(await typeInto(F.nasc, '14/07/1988', 28, cancel))) return;
      await sleep(160);
      const opts = [1, 3, 6, 10].map((n) => `${n}x de ${BRL(DEMO.amount / n)}${n === 1 ? ' à vista' : ' sem juros'}`);
      if (!(await selectInto(F.inst, opts, 3, cancel))) return;
    } else if (method === 'pix') {
      const qrEl = $('#qr');
      if (qrEl) qrEl.innerHTML = qrSvg(29, 70418);
      startPixTimer();
      await sleep(250);
      if (cancel()) return;
      const opts = [1, 3, 6, 10].map((n) => `${n}x de ${BRL(DEMO.amount / n)}${n === 1 ? ' à vista' : ' sem juros (Pix Automático)'}`);
      if (!(await selectInto(F.pixInst, opts, 3, cancel))) return;
      await sleep(150);
      if (cancel()) return;
      setSystem(F.pix, '00020126580014br.gov.bcb.pix0136a8f1c2d4-7041-4b3e-9a21-pay2b520400005303986540418405802BR5909PAY2B SEG6009SAO PAULO62070503***6304B7E1');
    } else {
      const barEl = $('#barcode');
      if (barEl) barEl.innerHTML = barcodeSvg(2310);
      await sleep(250);
      if (cancel()) return;
      const opts = [1, 3, 6, 10].map((n) => `${n}x de ${BRL(DEMO.amount / n)}${n === 1 ? ' à vista' : ' sem juros'}`);
      if (!(await selectInto(F.boletoInst, opts, 3, cancel))) return;
      await sleep(150);
      if (cancel()) return;
      const d = new Date(); d.setDate(d.getDate() + 3);
      setSystem(F.linha, '23793.38128 60000.000003 12345.678901 4 98760000184000');
      setSystem(F.venc, `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`);
      setSystem(F.benef, 'Atlas Seguradora S.A.');
    }
    setActive(null);
    ready = true;
    setPayButton(true, payLabel());
  }

  function startPixTimer() {
    clearInterval(pixTimer);
    let left = 29 * 60 + 59;
    const el = $('#pix-timer');
    if (!el) return;
    el.textContent = '29:59';
    pixTimer = setInterval(() => {
      left = Math.max(0, left - 1);
      el.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
    }, 1000);
  }

  $$('.method-w, .method').forEach((btn) => btn.addEventListener('click', () => {
    if (paying || btn.dataset.method === S.method) return;
    S.method = btn.dataset.method;
    startCheckout(250);
  }));

  $('#btn-pay').addEventListener('click', async () => {
    if (!ready || paying) return;
    paying = true;
    const steps = {
      card: ['Analisando antifraude…', 'Tokenizando cartão…', 'Roteando adquirente…', 'Autorizando cobrança…'],
      pix: ['Aguardando o banco…', 'Pix recebido…', 'Conciliando transação…'],
      boleto: ['Registrando boleto…', 'Compensação confirmada…', 'Conciliando transação…'],
    }[S.method];
    const btn = $('#btn-pay');
    btn.classList.add('loading');
    btn.disabled = true;
    for (let i = 0; i < steps.length; i++) {
      const lbl = btn.querySelector('.lbl');
      if (lbl) lbl.textContent = steps[i];
      if (S.method === 'pix' && i === 1) {
        const pixSt = $('#pix-status');
        if (pixSt) {
          pixSt.className = 'pill ok';
          pixSt.innerHTML = '<i class="dot"></i>Pix recebido';
        }
      }
      await sleep(700);
    }
    btn.classList.remove('loading');
    S.paid = true;
    S.seen = { notify: false, portal: false };
    S.tx = { id: 'PAY-70418', auth: 'AUT-518203', time: new Date() };
    paying = false;
    showSuccess();
  });

  /* ---------- Sucesso ---------- */
  let okTimer;
  function showSuccess() {
    $('#ok-amount').textContent = BRL(DEMO.amount);
    $('#ok-sub').textContent = methodLong();
    $('#ok-auth').textContent = S.tx.auth;
    $('#success').classList.add('active');
    let left = 8;
    const upd = () => ($('#ok-count').textContent = `Avançando em ${left} s`);
    upd();
    clearInterval(okTimer);
    okTimer = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(okTimer); go('notify'); } else upd();
    }, 1000);
  }
  function hideSuccess() {
    clearInterval(okTimer);
    $('#success').classList.remove('active');
  }
  $('#btn-ok-menu').addEventListener('click', () => go('notify'));

  /* ---------- Geradores visuais (QR e código de barras) ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function qrSvg(n, seed) {
    const r = rng(seed);
    const g = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[y][x] = r() > 0.5 ? 1 : 0;
    const finder = (ox, oy) => {
      for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
        const gx = ox + x, gy = oy + y;
        if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
        const edge = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        g[gy][gx] = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (edge || core) ? 1 : 0;
      }
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x]) d += `M${x} ${y}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}"/></svg>`;
  }
  function barcodeSvg(seed) {
    const r = rng(seed);
    let x = 0, d = '', i = 0;
    while (x < 620) {
      const w = 1 + Math.floor(r() * 4);
      if (i % 2 === 0) d += `M${x} 0h${w}v100h-${w}z`;
      x += w + (i % 2 === 0 ? 0 : 0);
      i++;
    }
    return `<svg viewBox="0 0 ${x} 100" preserveAspectRatio="none"><path d="${d}"/></svg>`;
  }

  /* ==========================================================================
     NOTIFICAÇÕES
     ========================================================================== */
  const ICON = {
    wa: '<svg viewBox="0 0 24 24"><path d="M4 20l1.4-4.2A8 8 0 1 1 8.2 18.6z"/></svg>',
    sms: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    hook: '<svg viewBox="0 0 24 24"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7zM14 3v5h5"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
    tabl: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 13h4M8 16h8"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>',
  };

  function emptyState(title, text, btn, to) {
    return `<div class="empty solo" data-reveal style="--i:2">
      <span class="ico">${ICON.card}</span>
      <h4>${title}</h4><p>${text}</p>
      <button data-go="${to}">${btn}</button></div>`;
  }

  function renderNotify() {
    const root = $('#notify-content');
    if (!S.paid) {
      root.innerHTML = `<div class="card-white" style="text-align: center; padding: 60px 40px; margin-top: 14px;">
        <span class="ico" style="margin: 0 auto 16px; background: #F1F5F9; color: #64748B;">${ICON.card}</span>
        <h3 style="font-size: 28px; font-weight: 600; color: #0F172A;">Nenhum evento disparado ainda</h3>
        <p style="font-size: 20px; color: #64748B; margin: 8px 0 24px;">Conclua a autorização no Checkout para visualizar as confirmações instantâneas.</p>
        <button class="btn-pay2b" data-go="checkout" style="max-width: 380px; margin: 0 auto;">Ir para o Checkout</button>
      </div>`;
      return;
    }

    const t0 = S.tx.time;
    const at = (s) => hms(new Date(t0.getTime() + s * 1000));
    const meio = { card: 'cartao_credito_recorrente', pix: 'pix_dinamico', boleto: 'bolepix' }[S.method];

    root.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px; margin-top: 12px;">
        <!-- Canal 1: WhatsApp Notificação Oficial -->
        <div class="whatsapp-chat-box">
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 18px; color: #4B5563; font-weight: 500;">
            <span style="display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" style="width:22px;height:22px;color:#16A34A;"><path d="M4 20l1.4-4.2A8 8 0 1 1 8.2 18.6z"/></svg>
              Pay2B Notificações · Canal Oficial
            </span>
            <span class="mono">${at(0.3)}</span>
          </div>
          <div class="wa-bubble">
            <p>Olá, <b>${DEMO.customer}</b>! 🎉</p>
            <p style="margin-top: 8px;">Confirmamos com sucesso a autorização da sua apólice <b>${DEMO.product}</b> (${DEMO.policy}).</p>
            <p style="margin-top: 6px;">Cobrança mensal configurada: <b>${DEMO.installments}x de ${BRL(DEMO.amount / DEMO.installments)}</b>.</p>
            <div class="wa-link-cta" style="cursor: pointer;" onclick="document.querySelector('[data-go=portal]').click();">
              <svg viewBox="0 0 24 24" style="width: 22px; height: 22px;"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 13h4M8 16h8"/></svg>
              Acessar minha apólice no Portal
            </div>
            <div class="wa-meta">
              <span>${at(0.3)}</span>
              <svg viewBox="0 0 24 24" style="width:18px;height:18px;color:#3B82F6;"><path d="M18 6L7 17l-5-5M22 10l-7.5 7.5"/></svg>
            </div>
          </div>
        </div>

        <!-- Canal 2: E-mail Transacional & Comprovante Tracejado (Réplica confirmação pagamento.htm) -->
        <div class="card-white" style="padding: 28px 32px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #E2E8F0; padding-bottom: 18px; margin-bottom: 20px;">
            <img src="assets/pay2b_logo_gray.png" alt="Pay2B" style="height: 38px;">
            <span class="pill ok" style="background:#DCFCE7; color:#15803D; font-size:18px; height:42px;"><i class="dot" style="background:#16A34A;"></i>Pagamento confirmado com sucesso</span>
          </div>

          <h3 style="font-size: 26px; font-weight: 600; color: #0F172A;">Olá, ${DEMO.first}</h3>
          <p style="font-size: 20px; color: #64748B; margin: 8px 0 20px; line-height: 1.5;">Ótima notícia! Confirmamos o recebimento e o agendamento das parcelas do seu <b>Seguro Automóvel</b>. Seja muito bem-vindo(a)!</p>

          <!-- Comprovante com borda tracejada -->
          <div class="dashed-receipt-card">
            <div class="receipt-header">
              <p>COMPROVANTE DE PAGAMENTO</p>
              <h4>Pay2B Recorrência & Seguros</h4>
              <span class="mono" style="font-size: 16px; color: #64748B;">ID da transação: ${S.tx.id}</span>
            </div>
            <div class="receipt-val-box">
              <span>VALOR DA 1ª PARCELA</span>
              <b class="mono">${BRL(DEMO.amount / DEMO.installments)}</b>
              <span style="font-size: 16px; color: #16A34A; font-weight: 500;">Plano Total: ${BRL(DEMO.amount)} (${DEMO.installments}x)</span>
            </div>
            <div class="receipt-rows">
              <div class="receipt-row"><span>PRODUTO:</span><b>${DEMO.product}</b></div>
              <div class="receipt-row"><span>Nª PROPOSTA:</span><b class="mono">${DEMO.policy}-2026</b></div>
              <div class="receipt-row"><span>FORMA:</span><b>Cartão de Crédito (Recorrência)</b></div>
              <div class="receipt-row"><span>AUTORIZAÇÃO:</span><b class="mono">${S.tx.auth}</b></div>
              <div class="receipt-row"><span>STATUS:</span><b style="color: #16A34A;">APROVADO & ATIVO</b></div>
            </div>
          </div>
        </div>

        <!-- Canal 3: Webhook ERP da Seguradora -->
        <div class="card-white" style="padding: 24px 28px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="ico" style="width: 44px; height: 44px; border-radius: 12px; background: #F1F5F9; color: #16A34A;">${ICON.hook}</span>
              <h4 style="font-size: 22px; font-weight: 600; color: #0F172A;">Webhook ERP Seguradora & Corretora</h4>
            </div>
            <span class="pill ok" style="font-size: 17px; height: 38px;"><i class="dot"></i>HTTP 200 · 118ms</span>
          </div>
          <pre class="json" style="background: #F8FAFC; border: 1px solid #E2E8F0; color: #334155; font-size: 19px;">{
  "evento": "assinatura.ativada",
  "transacao_id": "${S.tx.id}",
  "autorizacao": "${S.tx.auth}",
  "segurado": "${DEMO.customer}",
  "valor_total": ${DEMO.amount.toFixed(2)},
  "split": {
    "seguradora_liquido": ${(DEMO.amount * 0.92).toFixed(2)},
    "corretora_comissao": ${(DEMO.amount * 0.08).toFixed(2)}
  }
}</pre>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     PORTAL DA SEGURADORA (portal.pay2b.io)
     ========================================================================== */
  function countTo(el, from, to, fmt, ms) {
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      if (el) el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderPortal() {
    const baseVol = 131644.76;
    const baseTx = 46;
    const currentVol = S.paid ? baseVol + DEMO.amount : baseVol;
    const currentTx = S.paid ? baseTx + 1 : baseTx;

    $('#portal-content').innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px; margin-top: 14px;">
        <!-- Seletor de Período -->
        <div style="display: flex; align-items: center; justify-content: space-between; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 14px 20px;">
          <span style="font-size: 20px; font-weight: 600; color: #0F172A; display: flex; align-items: center; gap: 10px;">
            <svg viewBox="0 0 24 24" style="width: 22px; height: 22px; color: #64748B;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            02/10/26 - 08/10/26
          </span>
          <span style="font-size: 18px; color: #76B82A; font-weight: 600;">Tempo Real</span>
        </div>

        <!-- Visão Executiva: 3 KPIs com borda superior verde (Réplica 9dcacee1) -->
        <div>
          <div style="font-size: 24px; font-weight: 600; color: #0F172A; margin-bottom: 12px;">Visão Executiva</div>
          <div class="portal-kpi-grid">
            <div class="portal-kpi-card">
              <span>Valor transacionado</span>
              <b class="mono" id="kpi-vol">${BRL(currentVol)}</b>
              <span class="portal-sub-badge">
                <svg viewBox="0 0 24 24" style="width:18px;height:18px;"><path d="M7 17l10-10M17 17V7H7"/></svg>
                +14,2%
              </span>
            </div>
            <div class="portal-kpi-card">
              <span>Total de transações</span>
              <b class="mono" id="kpi-tx">${currentTx}</b>
              <span class="portal-sub-badge">
                <svg viewBox="0 0 24 24" style="width:18px;height:18px;"><path d="M7 17l10-10M17 17V7H7"/></svg>
                +1 hoje
              </span>
            </div>
            <div class="portal-kpi-card">
              <span>Aprovação na 1ª tentativa</span>
              <b class="mono">95,4%</b>
              <span class="portal-sub-badge">
                <svg viewBox="0 0 24 24" style="width:18px;height:18px;"><path d="M7 17l10-10M17 17V7H7"/></svg>
                Alta
              </span>
            </div>
          </div>
        </div>

        <!-- Lista de Assinaturas (Réplica Exata da Imagem Real 1aced1c1) -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
            <h3 style="font-size: 26px; font-weight: 600; color: #0F172A;">Lista de assinaturas</h3>
            <span style="font-size: 19px; color: #64748B; background: #FFFFFF; border: 1px solid #E2E8F0; padding: 6px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Filtros
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 16px;">
            <!-- Card 1: Assinatura da Sessão Atual -->
            <div class="card-white" style="border-left: 6px solid #76B82A; padding: 24px 28px;">
              <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1F5F9; padding-bottom: 14px; margin-bottom: 14px;">
                <div>
                  <b style="font-size: 22px; color: #0F172A;">MAP-1377956</b>
                  <span style="font-size: 17px; color: #94A3B8; margin-left: 8px;">08/10/2026</span>
                </div>
                <span style="background: ${S.paid ? '#DCFCE7' : '#DBEAFE'}; color: ${S.paid ? '#15803D' : '#1E40AF'}; padding: 6px 16px; border-radius: 20px; font-size: 17px; font-weight: 600;">
                  ${S.paid ? 'Confirmado' : 'Criado'}
                </span>
              </div>
              <p class="mono" style="font-size: 16px; color: #94A3B8; margin-bottom: 12px;">ID: SUB-d52fd2f7-6ffc-44c5-8dda-9838b2903a7b</p>

              <div style="display: flex; align-items: center; gap: 14px; background: #F8FAFC; border-radius: 16px; padding: 14px 18px; margin-bottom: 16px;">
                <span style="width: 46px; height: 46px; border-radius: 50%; background: #DCFCE7; color: #16A34A; display: grid; place-items: center; font-size: 20px; font-weight: 700;">LM</span>
                <div>
                  <h4 style="font-size: 20px; font-weight: 600; color: #0F172A;">${DEMO.customer}</h4>
                  <p style="font-size: 16px; color: #64748B;">252.457.158-05 · (11) 98765-4321</p>
                </div>
              </div>

              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <span style="font-size: 19px; color: #64748B;">Mensal · <b>10 Ciclos</b></span>
                <b class="mono" style="font-size: 28px; color: #76B82A;">R$ 1.840,00</b>
              </div>

              <button class="btn-pay2b" style="height: 64px; font-size: 20px; border-radius: 32px;" onclick="toast('Visualizando detalhes da assinatura MAP-1377956')">
                <svg viewBox="0 0 24 24" style="width: 22px; height: 22px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
                Ver detalhes
              </button>
            </div>

            <!-- Card 2: Exemplo anterior consolidado (Biunia Macarini) -->
            <div class="card-white" style="opacity: 0.9; padding: 22px 28px;">
              <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1F5F9; padding-bottom: 12px; margin-bottom: 12px;">
                <div>
                  <b style="font-size: 20px; color: #0F172A;">MAP-1377955</b>
                  <span style="font-size: 16px; color: #94A3B8; margin-left: 8px;">08/10/2026</span>
                </div>
                <span style="background: #DCFCE7; color: #15803D; padding: 4px 14px; border-radius: 20px; font-size: 16px; font-weight: 600;">Ativo</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 18px; color: #64748B;">Biunia Macarini · 10 Ciclos</span>
                <b class="mono" style="font-size: 24px; color: #0F172A;">R$ 2.034,17</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (S.paid) {
      countTo($('#kpi-vol'), baseVol, currentVol, BRL, 1400);
    }
  }

  /* ==========================================================================
     PORTAL DE COBRANÇA
     ========================================================================== */
  function debtList() {
    const list = OVERDUE.map((d, i) => ({ ...d, id: 'o' + i }));
    list.unshift({
      name: DEMO.customer,
      init: DEMO.initials,
      policy: DEMO.policy,
      parc: '02/10',
      days: 3,
      value: DEMO.nextInstallment,
      reason: 'Recorrência não cobrada · Saldo/Cartão',
      outcome: 'pix',
      id: 'me',
      mine: true,
    });
    return list;
  }

  function renderCollect(animate) {
    const list = debtList();
    const rows = S.collect.rows;
    const total = list.reduce((s, d) => s + d.value, 0);
    const rec = list.filter((d) => rows[d.id] && rows[d.id].state === 'paid').reduce((s, d) => s + d.value, 0);
    const open = total - rec;
    const pct = total ? Math.round((rec / total) * 100) : 0;
    const pending = list.filter((d) => !rows[d.id]).length;

    const btnFor = (d) => {
      const st = rows[d.id] && rows[d.id].state;
      if (!st) {
        return `<button class="btn-cobrar" data-send="${d.id}" aria-label="Cobrar ${d.name}">
          <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          Cobrar
        </button>`;
      }
      if (st === 'sending') {
        return `<span class="status-pill sending">
          <i class="dot" style="background:#64748B;animation:breathe 1s infinite;"></i>
          Enviando…
        </span>`;
      }
      if (st === 'sent') {
        return `<span class="status-pill sent">
          <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Link enviado
        </span>`;
      }
      if (st === 'opened') {
        return `<span class="status-pill opened">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          Link aberto
        </span>`;
      }
      return `<span class="status-pill paid">
        <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
        Pago · ${rows[d.id].via}
      </span>`;
    };

    $('#collect-content').innerHTML = `
      <div style="display:flex; flex-direction:column; gap:18px; margin-top:14px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="card-white" style="padding:20px 24px;">
            <span style="font-size:18px;color:#64748B;">Em atraso</span>
            <b class="mono" style="display:block;font-size:34px;color:#DC2626;margin-top:6px;">${BRL(open)}</b>
          </div>
          <div class="card-white" style="padding:20px 24px; border-top:4px solid #76B82A;">
            <span style="font-size:18px;color:#64748B;">Recuperado na sessão</span>
            <b class="mono" style="display:block;font-size:34px;color:#76B82A;margin-top:6px;">${BRL(rec)}</b>
          </div>
        </div>

        <div class="card-white" style="padding:20px 24px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:20px;color:#475569;">
            <span>Taxa de Recuperação</span>
            <b class="mono" style="color:#76B82A;font-weight:700;">${pct}%</b>
          </div>
          <div style="height:14px;border-radius:7px;background:#E2E8F0;overflow:hidden;">
            <div id="prog-i" style="height:100%;width:${S.collect.prevPct}%;background:#76B82A;transition:width 1s var(--ease);"></div>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;">
          <h4 style="font-size:24px;font-weight:600;color:#0F172A;">Parcelas em Atraso (${list.length})</h4>
          <button id="btn-all" class="btn-pay2b" style="height:52px;padding:0 24px;width:auto;font-size:18px;border-radius:26px;" ${pending ? '' : 'disabled'}>
            ${ICON.send} Cobrar todos
          </button>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;">
          ${list.map((d) => `
            <div class="card-white" style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;gap:20px;">
              <div style="display:flex;align-items:center;gap:16px;min-width:0;flex:1;">
                <span style="width:52px;height:52px;border-radius:50%;background:#F1F5F9;color:#334155;display:grid;place-items:center;font-weight:700;font-size:18px;flex:none;">${d.init}</span>
                <div style="min-width:0;">
                  <h5 style="font-size:20px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${d.name} ${d.mine ? '<span style="font-size:13px;background:#FEF3C7;color:#B45309;padding:2px 10px;border-radius:12px;margin-left:8px;font-weight:600;border:1px solid #FDE68A;">Sua Apólice</span>' : ''}
                  </h5>
                  <p style="font-size:15px;color:#64748B;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.policy} · Parcela ${d.parc}</p>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:22px;flex:none;">
                <div style="text-align:right;">
                  <b class="mono" style="font-size:22px;color:#0F172A;display:block;letter-spacing:-0.02em;">${BRL(d.value)}</b>
                  <span style="display:block;font-size:14px;color:${d.days > 10 ? '#DC2626' : '#D97706'};font-weight:600;margin-top:2px;">${d.days} dias</span>
                </div>
                ${btnFor(d)}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="card-white" style="background:#F0FDF4;border:1px solid #BBF7D0;display:flex;align-items:center;gap:16px;padding:16px 20px;">
          <span style="color:#16A34A;flex:none;"><svg viewBox="0 0 24 24" style="width:28px;height:28px;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
          <p style="font-size:16px;color:#166534;line-height:1.4;margin:0;">
            A retentativa inteligente (Repic) e o Portal de Cobrança acionam o cliente com link inteligente para regularizar via Pix ou novo cartão.
          </p>
        </div>
      </div>
    `;

    requestAnimationFrame(() => { const i = $('#prog-i'); if (i) i.style.width = pct + '%'; });
    S.collect.prevPct = pct;
  }

  function sendCharge(id) {
    const d = debtList().find((x) => x.id === id);
    if (!d || S.collect.rows[id]) return;
    S.collect.rows[id] = { state: 'sending' };
    if (cur === 'collect') renderCollect();
    setTimeout(() => { S.collect.rows[id] = { state: 'sent' }; if (cur === 'collect') renderCollect(); }, 900);
    setTimeout(() => {
      if (d.outcome === 'opened') {
        S.collect.rows[id] = { state: 'opened' };
      } else {
        const via = d.outcome === 'pix' ? 'Pix' : 'Cartão';
        S.collect.rows[id] = { state: 'paid', via };
        toast(`${d.name.split(' ')[0]} pagou ${BRL(d.value)} via ${via}`);
      }
      if (cur === 'collect') renderCollect();
    }, 2700 + Math.random() * 600);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-send]');
    if (b) sendCharge(b.dataset.send);
    if (e.target.closest('#btn-all')) {
      debtList().filter((d) => !S.collect.rows[d.id]).forEach((d, i) => setTimeout(() => sendCharge(d.id), i * 450));
    }
  });

  /* ==========================================================================
     OCIOSIDADE (modo feira)
     ========================================================================== */
  let idle = 0;
  function resetIdle() { idle = 0; }
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, resetIdle, { passive: true }));
  setInterval(() => {
    idle++;
    if (cur !== 'menu' && idle > 45) go('menu');
  }, 1000);

  renderMenu();
})();
