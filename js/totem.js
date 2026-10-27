/* ==========================================================================
   PAY2B — Camada guiada do totem
   Conduz o visitante pelas telas reais (app.js) em sequência linear.
   Atalhos do apresentador (teclado): 1–8 pulam etapas · ←/→ navegam · R reinicia.
   ========================================================================== */
(() => {
  'use strict';

  if (!window.Pay2B) {
    console.error('[totem] app.js não expôs window.Pay2B; camada guiada desativada.');
    return;
  }

  const CONFIG = {
    hookNumber: '1 em 5',     // ajustar com dado real
    autoCollectMs: 2200,      // dispara "cobrar todos" sozinho no Portal de Cobrança
  };

  /** Roteiro: tela → pilar (índice), legenda e comportamento do CTA */
  const FLOW = [
    { name: 'menu' },
    { name: 'hook',     pillar: -1, caption: '' },
    { name: 'quote',    pillar: 0,  caption: 'O corretor gera a cobrança.', proxy: '#btn-quote', after: 'Ver o checkout do cliente' },
    { name: 'checkout', pillar: 0,  caption: 'O cliente paga pelo link.',   proxy: '#btn-pay' },
    { name: 'notify',   pillar: 1,  caption: 'Todos avisados na hora.' },
    { name: 'portal',   pillar: 2,  caption: 'Sua operação em tempo real.' },
    { name: 'collect',  pillar: 3,  caption: 'Parcela recusada? Recuperada.', label: 'Concluir' },
    { name: 'end',      pillar: 4,  caption: '', label: 'Recomeçar' },
  ];
  const STEPS_TOTAL = FLOW.filter((f) => f.pillar >= 0 && f.pillar < 4).length;

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const caption = $('#tour-caption');
  const count = $('#tour-count');
  const next = $('#tour-next');
  const nextLbl = $('#tour-next-lbl');
  const pillars = [...document.querySelectorAll('.tour-pillars li')];
  const success = $('#success');

  $('#hook-num').textContent = CONFIG.hookNumber;

  let idx = 0;
  let syncTimer = null;
  let autoTimer = null;

  const indexOf = (name) => FLOW.findIndex((f) => f.name === name);
  const go = (name) => window.Pay2B.go(name);

  /* ---------- CTA espelhando o botão real da tela (cotador/checkout) ---------- */
  function syncProxy(step) {
    const src = $(step.proxy);
    if (!src) return;
    const st = window.Pay2B.state();
    if (step.name === 'quote' && st.quoted) {
      setNext(step.after, false, true);
      return;
    }
    const lbl = (src.querySelector('.lbl') || src).textContent.trim();
    setNext(lbl, src.disabled, !src.disabled);
    next.classList.toggle('busy', src.classList.contains('loading') || src.disabled);
  }

  function setNext(label, disabled, ready) {
    if (nextLbl.textContent !== label) nextLbl.textContent = label;
    const len = label ? label.length : 0;
    if (len > 32) next.dataset.size = 'xs';
    else if (len > 24) next.dataset.size = 'sm';
    else if (len > 18) next.dataset.size = 'md';
    else delete next.dataset.size;

    next.disabled = !!disabled;
    next.classList.toggle('ready', !!ready && !disabled);
    if (!disabled) next.classList.remove('busy');
  }

  /* ---------- Atualização ao trocar de tela ---------- */
  function onScreen(name) {
    clearInterval(syncTimer);
    clearTimeout(autoTimer);
    const i = indexOf(name);
    if (i < 0) return;
    idx = i;
    const step = FLOW[i];

    pillars.forEach((p, k) => {
      p.classList.toggle('done', k < step.pillar);
      p.classList.toggle('current', k === step.pillar);
    });
    const n = Math.min(Math.max(step.pillar + 1, 1), STEPS_TOTAL);
    count.textContent = `${n}/${STEPS_TOTAL}`;

    caption.textContent = step.caption || '';
    caption.classList.remove('swap');
    void caption.offsetWidth;
    caption.classList.add('swap');

    next.classList.remove('busy');
    if (step.proxy) {
      syncProxy(step);
      syncTimer = setInterval(() => syncProxy(step), 200);
    } else {
      setNext(step.label || 'Próximo', false, name === 'end');
    }

    if (name === 'collect') {
      autoTimer = setTimeout(() => {
        const all = $('#btn-all');
        if (all && !all.disabled) all.click();
        next.classList.add('ready');
      }, CONFIG.autoCollectMs);
    }
  }

  document.addEventListener('pay2b:screen', (e) => onScreen(e.detail.name));

  /* ---------- Ações ---------- */
  next.addEventListener('click', () => {
    const step = FLOW[idx];
    if (step.proxy) {
      const st = window.Pay2B.state();
      if (step.name === 'quote' && st.quoted) { go('checkout'); return; }
      const src = $(step.proxy);
      if (src && !src.disabled) src.click();
      return;
    }
    go(FLOW[(idx + 1) % FLOW.length].name);
  });

  $('#tour-restart').addEventListener('click', () => go('menu'));

  // Attract: toque em qualquer ponto inicia a jornada
  $('#screen-menu').addEventListener('click', () => go('hook'));

  // Oculta a camada guiada enquanto o modal "Pagamento aprovado" está aberto
  new MutationObserver(() => stage.classList.toggle('ok-open', success.classList.contains('active')))
    .observe(success, { attributes: true, attributeFilter: ['class'] });

  // Modo apresentador
  window.addEventListener('keydown', (e) => {
    if (/^[1-8]$/.test(e.key)) go(FLOW[+e.key - 1].name);
    else if (e.key === 'ArrowRight') next.click();
    else if (e.key === 'ArrowLeft' && idx > 0) go(FLOW[idx - 1].name);
    else if (e.key.toLowerCase() === 'r') go('menu');
  });

  onScreen('menu');
})();
