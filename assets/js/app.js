/* Eventos, estado de UI, persistência local e renderização no DOM */

let state = {
  activeTab: 'bazin',
  ticker: '',
  dpaMode: 'direct',
  dpa: 0,
  price: 0,
  dyMedio: 0,
  k: 6.0,
  debtEbitda: 0,
  isBank: false,
  vpa: 0,
  lpa: 0,
  payout: 0,
  tetoBazin: 0,
  margemBazin: 0,
  viGraham: 0,
  farolStatus: 'neutro',
  farolTitle: 'AGUARDANDO DADOS'
};

const BRAPI_TOKEN = (typeof process !== 'undefined' && process?.env?.BRAPI_TOKEN) || window.BRAPI_TOKEN || 'xkbBiwNYnwJ4pvmPBpTGYB';

let inMemoryRadar = [];

function getRadarData() {
  try {
    const data = localStorage.getItem('radar_bazin_data');
    if (data) return JSON.parse(data);
  } catch (e) {
    console.warn('localStorage inacessível, utilizando armazenamento em memória.', e);
  }
  return inMemoryRadar;
}

function saveRadarData(arr) {
  inMemoryRadar = arr;
  try {
    localStorage.setItem('radar_bazin_data', JSON.stringify(arr));
  } catch (e) {
    console.warn('Falha ao salvar no localStorage:', e);
  }
}

let inMemoryTerminal = [
  { ticker: 'BBAS3', price: 27.50, dpa: 2.32, lpa: 5.80, vpa: 31.20, evEbit: 0, roic: 0, roe: 18.2, payout: 40.0, isFinancial: true },
  { ticker: 'PETR4', price: 38.20, dpa: 4.55, lpa: 9.10, vpa: 29.50, evEbit: 3.1, roic: 22.4, roe: 28.5, payout: 50.0, isFinancial: false },
  { ticker: 'VALE3', price: 61.00, dpa: 5.60, lpa: 11.20, vpa: 42.00, evEbit: 4.8, roic: 18.0, roe: 21.0, payout: 50.0, isFinancial: false },
  { ticker: 'CMIG4', price: 11.20, dpa: 1.05, lpa: 2.10, vpa: 9.80, evEbit: 5.1, roic: 17.2, roe: 19.5, payout: 50.0, isFinancial: false },
  { ticker: 'WEGE3', price: 44.50, dpa: 0.675, lpa: 1.35, vpa: 5.20, evEbit: 21.5, roic: 26.8, roe: 29.0, payout: 50.0, isFinancial: false }
];

function getTerminalData() {
  try {
    const data = localStorage.getItem('valuation_multimetodos_data');
    if (data) return JSON.parse(data);
  } catch (e) {
    console.warn('localStorage inacessível para o Terminal.', e);
  }
  return inMemoryTerminal;
}

function saveTerminalData(arr) {
  inMemoryTerminal = arr;
  try {
    localStorage.setItem('valuation_multimetodos_data', JSON.stringify(arr));
  } catch (e) {
    console.warn('Falha ao salvar Terminal no localStorage:', e);
  }
}

async function fetchBrapiQuote(symbol) {
  if (!symbol || !symbol.trim()) {
    showQuoteStatus('error', 'Digite um código de ativo válido (ex: VALE3).');
    return;
  }

  const cleanSymbol = symbol.trim().toUpperCase();
  showQuoteStatus('loading', `Buscando cotação de ${cleanSymbol}...`);

  try {
    const apiUrl = `https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(cleanSymbol)}&token=${encodeURIComponent(BRAPI_TOKEN)}`;
    const response = await fetch(apiUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });

    if (!response.ok) {
      if (response.status === 404) throw new Error(`Ativo "${cleanSymbol}" não localizado na B3.`);
      else if (response.status === 401 || response.status === 403) throw new Error('Chave da API Brapi expirada ou inválida.');
      else throw new Error(`Erro de resposta na API (Código ${response.status}).`);
    }

    const json = await response.json();
    if (!json.results || !Array.isArray(json.results) || json.results.length === 0) {
      throw new Error(`Cotação para "${cleanSymbol}" não encontrada.`);
    }

    const item = json.results[0];
    const data = item.data || item;
    const price = parseFloat(data.regularMarketPrice ?? data.close ?? data.price ?? 0);

    if (isNaN(price) || price <= 0) throw new Error('Preço de mercado indisponível no momento.');

    onPriceInput(price.toFixed(2));
    showQuoteStatus('success', `✓ ${cleanSymbol}: Cotação R$ ${price.toFixed(2)} atualizada!`);
  } catch (err) {
    showQuoteStatus('error', `✕ ${err.message || 'Falha ao buscar cotação.'}`);
  }
}

function showQuoteStatus(type, msg) {
  const statusBazin = document.getElementById('status-bazin');
  const statusGraham = document.getElementById('status-graham');
  const spinnerBazin = document.getElementById('spinner-bazin');
  const spinnerGraham = document.getElementById('spinner-graham');
  const btnBazin = document.getElementById('btn-fetch-bazin');
  const btnGraham = document.getElementById('btn-fetch-graham');

  const isLoading = type === 'loading';

  if (spinnerBazin) spinnerBazin.classList.toggle('is-hidden', !isLoading);
  if (spinnerGraham) spinnerGraham.classList.toggle('is-hidden', !isLoading);
  if (btnBazin) btnBazin.disabled = isLoading;
  if (btnGraham) btnGraham.disabled = isLoading;

  [statusBazin, statusGraham].forEach(el => {
    if (el) {
      el.className = `fetch-quote-status ${type}`;
      el.textContent = msg;
    }
  });

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      if (statusBazin) statusBazin.textContent = '';
      if (statusGraham) statusGraham.textContent = '';
    }, 5000);
  }
}

function onTickerInput(val) {
  state.ticker = val;
  document.getElementById('input-ticker').value = val;
  document.getElementById('input-graham-ticker').value = val;
  calculate();
}

function onPriceInput(val) {
  state.price = parseFloat(val) || 0;
  document.getElementById('input-price').value = val;
  document.getElementById('input-graham-price').value = val;
  calculate();
}

function onDpaDirectInput(val) {
  state.dpa = parseFloat(val) || 0;
  calculate();
}

function onGrahamProfitInput() {
  const lpa = parseFloat(document.getElementById('input-lpa').value) || 0;
  const payout = parseFloat(document.getElementById('input-payout').value) || 0;
  state.lpa = lpa;
  state.payout = payout;

  const implicitDpa = lpa * (payout / 100);
  document.getElementById('graham-implicit-dpa').textContent = fmtReal(implicitDpa);

  calculate();
}

function switchMainTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-bazin').classList.toggle('active', tab === 'bazin');
  document.getElementById('tab-graham').classList.toggle('active', tab === 'graham');
  document.getElementById('tab-terminal').classList.toggle('active', tab === 'terminal');

  const classicGrid = document.getElementById('workspace-grid-classic');
  const terminalGrid = document.getElementById('workspace-grid-terminal');
  const classicRadar = document.getElementById('radar-section-classic');

  if (tab === 'terminal') {
    classicGrid.classList.add('is-hidden');
    classicRadar.classList.add('is-hidden');
    terminalGrid.classList.remove('is-hidden');
  } else {
    classicGrid.classList.remove('is-hidden');
    classicRadar.classList.remove('is-hidden');
    terminalGrid.classList.add('is-hidden');

    document.getElementById('inputs-tab-bazin').classList.toggle('is-hidden', tab !== 'bazin');
    document.getElementById('inputs-tab-graham').classList.toggle('is-hidden', tab !== 'graham');
    document.getElementById('grid-metrics-bazin').classList.toggle('is-hidden', tab !== 'bazin');
    document.getElementById('grid-metrics-graham').classList.toggle('is-hidden', tab !== 'graham');
  }

  const root = document.documentElement;
  const badgeEl = document.getElementById('info-k-badge');
  const infoTextEl = document.getElementById('info-k-text');

  if (tab === 'bazin') {
    root.style.setProperty('--accent', '#4f8ef7');
    root.style.setProperty('--accent-rgb', '79, 142, 247');
    if (badgeEl) badgeEl.textContent = 'K = 6.0% de Bazin';
    if (infoTextEl) infoTextEl.innerHTML = 'Esta ferramenta utiliza a taxa de desconto imutável de <strong>6,0% ao ano</strong> estabelecida pelo método clássico de Décio Bazin para garantir a margem de retorno em dividendos.';
    calculate();
  } else if (tab === 'graham') {
    root.style.setProperty('--accent', '#a78bfa');
    root.style.setProperty('--accent-rgb', '167, 139, 250');
    if (badgeEl) badgeEl.textContent = 'Fórmula de Graham + Bazin';
    if (infoTextEl) infoTextEl.innerHTML = 'Esta aba integra o modelo estático de valor intrínseco de ativos de <strong>Benjamin Graham</strong> com a perpetuidade de caixa de dividendos de <strong>Décio Bazin</strong>.';
    calculate();
  } else if (tab === 'terminal') {
    root.style.setProperty('--accent', '#f59e0b');
    root.style.setProperty('--accent-rgb', '245, 158, 11');
    if (badgeEl) badgeEl.textContent = 'Greenblatt + Gordon + Bazin + Graham';
    if (infoTextEl) infoTextEl.innerHTML = 'Terminal multi-modelo integrado: rastreie o ranking da <strong>Magic Formula (EV/EBIT + ROIC)</strong> combinada à margem de segurança de Bazin, Graham e ao crescimento perpétuo do <strong>Modelo de Gordon</strong>.';
    renderTerminalTable();
  }
}

function setDpaMode(mode) {
  state.dpaMode = mode;
  document.getElementById('toggle-dpa-direct').classList.toggle('active', mode === 'direct');
  document.getElementById('toggle-dpa-years').classList.toggle('active', mode === 'years');

  document.getElementById('dpa-direct-wrapper').classList.toggle('is-hidden', mode !== 'direct');
  document.getElementById('dpa-years-wrapper').classList.toggle('is-hidden', mode !== 'years');

  calculate();
}

function toggleBankMode(checked) {
  state.isBank = checked;
  const container = document.getElementById('debt-slider-container');
  const badge = document.getElementById('lbl-debt');
  const title = document.getElementById('lbl-debt-title');

  if (checked) {
    container.classList.add('disabled-panel');
    badge.textContent = 'N/A (Banco)';
    badge.className = 'slider-val-badge text-dim';
    title.innerHTML = 'Dívida Líquida / EBITDA <span class="bank-incompatible-note">(Incompatível com Bancos)</span>';
  } else {
    container.classList.remove('disabled-panel');
    title.textContent = 'Dívida Líquida / EBITDA';
    onDebtChange(document.getElementById('slider-debt').value);
  }

  calculate();
}

function onDebtChange(val) {
  state.debtEbitda = parseFloat(val) || 0;
  const badge = document.getElementById('lbl-debt');

  if (state.isBank) {
    badge.textContent = 'N/A (Banco)';
    badge.className = 'slider-val-badge text-dim';
    return;
  }

  badge.textContent = state.debtEbitda.toFixed(2) + 'x';

  if (state.debtEbitda <= 2.5) badge.className = 'slider-val-badge text-green';
  else if (state.debtEbitda <= 3.5) badge.className = 'slider-val-badge text-yellow';
  else badge.className = 'slider-val-badge text-red';

  calculate();
}

function updateMultiMarkerRuler(price, tetoBazin, viGraham = 0) {
  const pinPrice = document.getElementById('ruler-pin-price');
  const pinTeto = document.getElementById('ruler-pin-teto');
  const pinGraham = document.getElementById('ruler-pin-graham');

  const lblPrice = document.getElementById('ruler-val-price');
  const lblTeto = document.getElementById('ruler-val-teto');
  const lblGraham = document.getElementById('ruler-val-graham');

  lblPrice.textContent = price > 0 ? fmtReal(price) : 'R$ 0,00';
  lblTeto.textContent = tetoBazin > 0 ? fmtReal(tetoBazin) : 'R$ 0,00';
  lblGraham.textContent = viGraham > 0 ? fmtReal(viGraham) : 'N/A';

  const pos = computeRulerPositions(price, tetoBazin, viGraham);
  if (!pos.valid) {
    if (pinPrice) pinPrice.classList.add('is-hidden');
    if (pinTeto) pinTeto.classList.add('is-hidden');
    if (pinGraham) pinGraham.classList.add('is-hidden');
    return;
  }

  if (pos.pctPrice !== null && pinPrice) {
    pinPrice.classList.remove('is-hidden');
    pinPrice.style.left = pos.pctPrice.toFixed(1) + '%';
  } else if (pinPrice) pinPrice.classList.add('is-hidden');

  if (pos.pctTeto !== null && pinTeto) {
    pinTeto.classList.remove('is-hidden');
    pinTeto.style.left = pos.pctTeto.toFixed(1) + '%';
  } else if (pinTeto) pinTeto.classList.add('is-hidden');

  if (pos.pctGraham !== null && pinGraham) {
    pinGraham.classList.remove('is-hidden');
    pinGraham.style.left = pos.pctGraham.toFixed(1) + '%';
  } else if (pinGraham) pinGraham.classList.add('is-hidden');
}

function updateYieldLadder(price, dpa) {
  const tbody = document.getElementById('yield-ladder-tbody');
  if (!tbody) return;

  const rows = computeYieldLadder(price, dpa);
  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="ladder-empty-cell">
          Preencha o DPA para visualizar a Matriz de Sensibilidade.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const margemClass = price > 0 ? (r.margem >= 0 ? 'text-green' : 'text-red') : '';
    const rowClass = r.isBazin ? 'yield-row-bazin' : '';
    return `
      <tr class="${rowClass}">
        <td class="td-yield-label">${r.label}</td>
        <td class="td-yield-val">${fmtReal(r.teto)}</td>
        <td class="td-yield-margin ${margemClass}">${price > 0 ? fmtPct(r.margem) : '---'}</td>
        <td><span class="ladder-badge badge-${r.badgeType}">${r.badgeText}</span></td>
      </tr>
    `;
  }).join('');
}

function calculate() {
  if (state.activeTab === 'bazin') calculateBazinClassic();
  else if (state.activeTab === 'graham') calculateGrahamBazin();
}

function calculateBazinClassic() {
  const rawPrice = document.getElementById('input-price').value;
  const price = (rawPrice !== '' && !isNaN(parseFloat(rawPrice)) && parseFloat(rawPrice) > 0) ? parseFloat(rawPrice) : 0;

  const rawDyMedio = document.getElementById('input-dy-medio').value;
  const hasDyMedio = rawDyMedio !== '' && !isNaN(parseFloat(rawDyMedio)) && parseFloat(rawDyMedio) >= 0;
  const dyMedioInput = hasDyMedio ? parseFloat(rawDyMedio) : 0;

  const rawDpa = document.getElementById('input-dpa').value;
  const directDpa = (rawDpa !== '' && !isNaN(parseFloat(rawDpa))) ? parseFloat(rawDpa) : 0;

  const yearsDpa = [1, 2, 3, 4, 5].map(i => parseFloat(document.getElementById(`dpa-y${i}`).value));

  const res = evaluateBazinClassic({
    dpaMode: state.dpaMode,
    directDpa,
    yearsDpa,
    price,
    hasDyMedio,
    dyMedioInput,
    isBank: state.isBank,
    debtEbitda: state.debtEbitda
  });

  if (state.dpaMode === 'years') {
    document.getElementById('avg-computed-dpa').textContent = res.avgYearsDpa > 0 ? fmtReal(res.avgYearsDpa) : 'R$ 0,00';
  }

  if (!res.valid) {
    setEmptyState();
    return;
  }

  state.dpa = res.dpa;
  state.price = res.price;
  state.dyMedio = hasDyMedio ? dyMedioInput : 0;
  state.tetoBazin = res.precoTeto;
  state.margemBazin = res.margemSeguranca;
  state.viGraham = 0;
  state.farolStatus = res.status;
  state.farolTitle = res.statusTitle;

  document.getElementById('res-teto').textContent = fmtReal(res.precoTeto);
  const resMargemElement = document.getElementById('res-margem');
  resMargemElement.textContent = fmtPct(res.margemSeguranca);

  if (res.margemSeguranca >= 0) resMargemElement.className = 'calc-value text-green';
  else if (res.margemSeguranca >= -10) resMargemElement.className = 'calc-value text-yellow';
  else resMargemElement.className = 'calc-value text-red';

  updateMultiMarkerRuler(res.price, res.precoTeto, 0);
  updateYieldLadder(res.price, res.dpa);

  setFarolBanner(res.status, res.statusTitle);

  const fallbackVpa = parseFloat(document.getElementById('input-vpa')?.value) || state.vpa || 0;
  const fallbackLpa = parseFloat(document.getElementById('input-lpa')?.value) || state.lpa || 0;
  document.getElementById('summary-textarea').value = buildSummaryText({
    ticker: state.ticker,
    price: res.price,
    dpa: res.dpa,
    tetoBazin: res.precoTeto,
    margemBazin: res.margemSeguranca,
    status: res.status,
    statusTitle: res.statusTitle,
    viGraham: 0,
    margemGraham: 0,
    fallbackVpa,
    fallbackLpa
  });
}

function calculateGrahamBazin() {
  const vpa = parseFloat(document.getElementById('input-vpa').value) || 0;
  const lpa = parseFloat(document.getElementById('input-lpa').value) || 0;
  const payout = parseFloat(document.getElementById('input-payout').value) || 0;
  const price = parseFloat(document.getElementById('input-graham-price').value) || 0;

  state.vpa = vpa;
  state.lpa = lpa;
  state.payout = payout;

  const res = evaluateGrahamBazin({ vpa, lpa, payout, price });

  document.getElementById('graham-implicit-dpa').textContent = fmtReal(res.dpaImplicit);

  if (!res.valid) {
    setEmptyState();
    return;
  }

  state.dpa = res.dpaImplicit;
  state.price = res.price;
  state.tetoBazin = res.precoTetoBazin;
  state.margemBazin = res.margemBazin;
  state.viGraham = res.vi;
  state.farolStatus = res.status;
  state.farolTitle = res.statusTitle;

  document.getElementById('res-graham-vi').textContent = fmtReal(res.vi);
  document.getElementById('res-graham-dpa').textContent = fmtReal(res.dpaImplicit);
  document.getElementById('res-graham-teto').textContent = fmtReal(res.precoTetoBazin);
  document.getElementById('res-graham-bazin-margem').textContent = fmtPct(res.margemBazin);
  document.getElementById('res-graham-margem').textContent = fmtPct(res.margemGraham);
  document.getElementById('res-graham-conv').textContent = fmtPct(res.convGraham);

  const resGrahamMargemEl = document.getElementById('res-graham-margem');
  if (res.margemGraham >= 30.0) resGrahamMargemEl.className = 'calc-value text-green';
  else if (res.margemGraham >= 0.0) resGrahamMargemEl.className = 'calc-value text-yellow';
  else resGrahamMargemEl.className = 'calc-value text-red';

  updateMultiMarkerRuler(res.price, res.precoTetoBazin, res.vi);
  updateYieldLadder(res.price, res.dpaImplicit);

  setFarolBanner(res.status, res.statusTitle);
  document.getElementById('summary-textarea').value = buildSummaryText({
    ticker: state.ticker,
    price: res.price,
    dpa: res.dpaImplicit,
    tetoBazin: res.precoTetoBazin,
    margemBazin: res.margemBazin,
    status: res.status,
    statusTitle: res.statusTitle,
    viGraham: res.vi,
    margemGraham: res.margemGraham
  });
}

function setFarolBanner(status, title) {
  const banner = document.getElementById('farol-banner');
  banner.className = `farol-banner status-${status}`;
  document.getElementById('farol-status-title').textContent = title;
}

function setEmptyState() {
  setFarolBanner('neutro', 'AGUARDANDO DADOS');
  document.getElementById('farol-status-label').textContent = 'Farol de Entrada';
  document.getElementById('res-teto').textContent = 'R$ 0,00';
  const resMargem = document.getElementById('res-margem');
  resMargem.textContent = '0,0%';
  resMargem.className = 'calc-value text-dim';
  document.getElementById('res-graham-vi').textContent = 'R$ 0,00';
  document.getElementById('res-graham-dpa').textContent = 'R$ 0,00';
  document.getElementById('res-graham-teto').textContent = 'R$ 0,00';
  document.getElementById('res-graham-bazin-margem').textContent = '0,0%';
  const resGrahamMargem = document.getElementById('res-graham-margem');
  resGrahamMargem.textContent = '0,0%';
  resGrahamMargem.className = 'calc-value';
  document.getElementById('res-graham-conv').textContent = '0,0%';

  updateMultiMarkerRuler(0, 0, 0);
  updateYieldLadder(0, 0);

  document.getElementById('summary-textarea').value = 'Insira os dados da ação para gerar o resumo...';
}

function copyTextareaWithFeedback(textareaId, iconId, textId, toastId, defaultText) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return;
  textarea.select();
  textarea.setSelectionRange(0, 99999);

  try {
    document.execCommand('copy');
    const btnIcon = document.getElementById(iconId);
    const btnText = document.getElementById(textId);
    const toast = document.getElementById(toastId);

    if (btnIcon) btnIcon.textContent = '✓';
    if (btnText) btnText.textContent = 'Copiado!';
    if (toast) toast.classList.remove('is-hidden');

    setTimeout(() => {
      if (btnIcon) btnIcon.textContent = '📋';
      if (btnText) btnText.textContent = defaultText;
      if (toast) toast.classList.add('is-hidden');
    }, 2500);
  } catch (err) {
    console.error('Falha ao copiar:', err);
  }
}

function copySummaryText() {
  copyTextareaWithFeedback('summary-textarea', 'copy-btn-icon', 'copy-btn-text', 'copy-toast', 'Copiar');
}

let editingTerminalId = null;

function autoCalcTerminalDPA() {
  const lpa = parseFloat(document.getElementById('term-lpa').value) || 0;
  const payout = parseFloat(document.getElementById('term-payout').value) || 0;
  if (lpa > 0 && payout >= 0) {
    const calcDpa = lpa * (payout / 100);
    document.getElementById('term-dpa').value = calcDpa.toFixed(2);
  }
}

function updateTerminalSummaryText() {
  const textarea = document.getElementById('terminal-summary-textarea');
  if (textarea) {
    const globalK = parseFloat(document.getElementById('terminal-k-global')?.value) || 10.0;
    textarea.value = buildTerminalTextSummary(getTerminalData(), globalK);
  }
}

function copyTerminalTextSummary() {
  updateTerminalSummaryText();
  copyTextareaWithFeedback('terminal-summary-textarea', 'copy-terminal-btn-icon', 'copy-terminal-btn-text', 'copy-terminal-toast', 'Copiar Ranking');
}

function renderTerminalTable() {
  const tbody = document.getElementById('terminal-tbody');
  const badge = document.getElementById('terminal-count-badge');
  const globalKInput = document.getElementById('terminal-k-global');
  const globalK = parseFloat(globalKInput?.value) || 10.0;

  const list = getTerminalData();
  const rankedList = rankTerminalList(list, globalK);

  if (badge) badge.textContent = `${rankedList.length} ${rankedList.length === 1 ? 'ativo' : 'ativos'}`;

  updateTerminalSummaryText();

  if (!tbody) return;

  if (rankedList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="radar-empty-state">
          Nenhum ativo cadastrado no Terminal. Preencha o formulário e clique em "+ Adicionar Ativo ao Terminal".
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rankedList.map(item => {
    const c = item.calc;
    let rankBadge = '';

    if (item.isFinancial) {
      rankBadge = `<span class="rank-badge rank-financial" title="Setor Financeiro / Holding (Isento da Magic Formula)">🏦</span>`;
    } else if (item.magicRank === 1) {
      rankBadge = `<span class="rank-badge rank-top1">🥇 Top 1</span>`;
    } else if (item.magicRank === 2) {
      rankBadge = `<span class="rank-badge rank-top2">🥈 Top 2</span>`;
    } else if (item.magicRank === 3) {
      rankBadge = `<span class="rank-badge rank-top3">🥉 Top 3</span>`;
    } else {
      rankBadge = `<span class="rank-badge rank-normal">${item.magicRank}º</span>`;
    }

    const margemBazinClass = c.marginBazin >= 0 ? 'text-green' : 'text-red';
    const margemGrahamClass = c.viGraham > 0 ? (c.marginGraham >= 0 ? 'text-green' : 'text-red') : 'text-dim';
    const margemGordonClass = c.marginGordon >= 0 ? 'text-green' : 'text-red';

    const viGrahamStr = c.viGraham > 0 ? fmtReal(c.viGraham) : 'N/A';
    const marginGrahamStr = c.viGraham > 0 ? fmtPct(c.marginGraham) : 'N/A';

    let gordonStr = 'N/A';
    if (c.gordonValid && c.priceGordon > 0) {
      gordonStr = `${fmtReal(c.priceGordon)} <span class="term-cell-sub ${margemGordonClass}">(${fmtPct(c.marginGordon)})</span>`;
    } else {
      gordonStr = `<span class="term-gordon-warn" title="Taxa K inferior ao crescimento g ou sem DPA">⚠️ g ≥ K</span>`;
    }

    const multiplesStr = item.isFinancial 
      ? `<div class="term-mult-dim">EV/EBIT: N/A</div><div class="term-mult-accent">ROE: <strong>${item.roe ? item.roe.toFixed(1) + '%' : 'N/A'}</strong></div>`
      : `<div>EV/EBIT: <strong>${c.evEbit > 0 ? c.evEbit.toFixed(1) + 'x' : 'N/A'}</strong></div><div class="term-mult-accent">ROIC: <strong>${c.roic.toFixed(1)}%</strong></div>`;

    return `
      <tr>
        <td>${rankBadge}</td>
        <td>
          <div class="term-cell-ticker">${item.ticker}</div>
          <div class="term-cell-sub">${fmtReal(item.price)}</div>
        </td>
        <td>
          <div>${fmtReal(c.ptBazin)}</div>
          <div class="term-cell-sub ${margemBazinClass}">${fmtPct(c.marginBazin)}</div>
        </td>
        <td>
          <div>${viGrahamStr}</div>
          <div class="term-cell-sub ${margemGrahamClass}">${marginGrahamStr}</div>
        </td>
        <td>
          <div>${gordonStr}</div>
          <div class="term-cell-sub-sm">g: ${c.gCalculated.toFixed(1)}%</div>
        </td>
        <td>
          ${multiplesStr}
        </td>
        <td class="text-right">
          <div class="radar-actions justify-end">
            <button type="button" class="btn-action-load" data-action="edit-terminal" data-ticker="${item.ticker}">✏️ Editar</button>
            <button type="button" class="btn-action-delete" title="Excluir" data-action="delete-terminal" data-ticker="${item.ticker}">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function saveTerminalItem() {
  const ticker = document.getElementById('term-ticker').value.trim().toUpperCase();
  if (!ticker) return;

  const lpa = parseFloat(document.getElementById('term-lpa').value) || 0;
  const payout = parseFloat(document.getElementById('term-payout').value) || 0;
  let dpa = parseFloat(document.getElementById('term-dpa').value) || 0;

  if (lpa > 0 && payout >= 0) {
    dpa = lpa * (payout / 100);
  }

  const item = {
    ticker: ticker,
    price: parseFloat(document.getElementById('term-price').value) || 0,
    dpa: parseFloat(dpa.toFixed(2)),
    lpa: lpa,
    vpa: parseFloat(document.getElementById('term-vpa').value) || 0,
    payout: payout,
    evEbit: parseFloat(document.getElementById('term-ev-ebit').value) || 0,
    roic: parseFloat(document.getElementById('term-roic').value) || 0,
    roe: parseFloat(document.getElementById('term-roe').value) || 0,
    isFinancial: document.getElementById('term-is-financial').checked
  };

  let list = getTerminalData();

  if (editingTerminalId) {
    const idx = list.findIndex(x => x.ticker === editingTerminalId);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
  } else {
    const idx = list.findIndex(x => x.ticker === ticker);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
  }

  saveTerminalData(list);
  resetTerminalForm();
  renderTerminalTable();
}

function editTerminalItem(ticker) {
  const list = getTerminalData();
  const item = list.find(x => x.ticker === ticker);
  if (!item) return;

  editingTerminalId = ticker;
  document.getElementById('term-ticker').value = item.ticker;
  document.getElementById('term-price').value = item.price;
  document.getElementById('term-lpa').value = item.lpa;
  document.getElementById('term-vpa').value = item.vpa;
  document.getElementById('term-payout').value = item.payout;
  document.getElementById('term-ev-ebit').value = item.evEbit;
  document.getElementById('term-roic').value = item.roic;
  document.getElementById('term-roe').value = item.roe;
  document.getElementById('term-is-financial').checked = !!item.isFinancial;

  autoCalcTerminalDPA();
  if (!document.getElementById('term-dpa').value) {
    document.getElementById('term-dpa').value = item.dpa;
  }

  document.getElementById('terminal-form-title').textContent = `✏️ Editando Ativo [${ticker}]`;
  document.getElementById('btn-save-terminal').innerHTML = `<span>💾 Salvar Alterações [${ticker}]</span>`;
  document.getElementById('btn-cancel-edit-terminal').classList.remove('is-hidden');

  window.scrollTo({ top: 120, behavior: 'smooth' });
}

function resetTerminalForm() {
  editingTerminalId = null;
  document.getElementById('form-terminal').reset();
  document.getElementById('term-is-financial').checked = false;
  document.getElementById('terminal-form-title').textContent = `⚡ Cadastrar Novo Ativo no Terminal`;
  document.getElementById('btn-save-terminal').innerHTML = `<span>+ Adicionar Ativo ao Terminal</span>`;
  document.getElementById('btn-cancel-edit-terminal').classList.add('is-hidden');
}

function deleteTerminalItem(ticker) {
  let list = getTerminalData();
  list = list.filter(x => x.ticker !== ticker);
  saveTerminalData(list);
  renderTerminalTable();
}

function exportTerminalJSON() {
  const list = getTerminalData();
  const jsonStr = JSON.stringify(list, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `valuation_radar.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleImportJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed)) {
        saveTerminalData(parsed);
        renderTerminalTable();
      } else {
        console.warn('O arquivo JSON não contém um formato de lista válido.');
      }
    } catch (err) {
      console.error('Erro ao ler arquivo JSON:', err);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function addToRadar() {
  const paperName = state.ticker && state.ticker.trim() !== '' ? state.ticker.trim().toUpperCase() : '';
  if (!paperName) {
    showQuoteStatus('error', 'Digite o Ticker do papel antes de adicionar ao Radar.');
    return;
  }

  const item = {
    id: paperName,
    ticker: paperName,
    price: state.price,
    dpa: state.dpa,
    tetoBazin: state.tetoBazin,
    margemBazin: state.margemBazin,
    viGraham: state.viGraham,
    farolStatus: state.farolStatus,
    farolTitle: state.farolTitle,
    isBank: state.isBank,
    dpaMode: state.dpaMode,
    dyMedio: state.dyMedio,
    debtEbitda: state.debtEbitda,
    vpa: state.vpa,
    lpa: state.lpa,
    payout: state.payout,
    activeTab: state.activeTab,
    updatedAt: new Date().toISOString()
  };

  let list = getRadarData();
  const existingIndex = list.findIndex(x => x.ticker === paperName);
  if (existingIndex >= 0) list[existingIndex] = item;
  else list.push(item);

  list.sort((a, b) => b.margemBazin - a.margemBazin);

  saveRadarData(list);
  renderRadarTable();

  const btn = document.getElementById('btn-add-radar');
  if (btn) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = `<span>✓</span> <span>${paperName} adicionado ao Radar!</span>`;
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => {
      btn.innerHTML = origHTML;
      btn.style.borderColor = '';
    }, 2000);
  }
}

function renderRadarTable() {
  const tbody = document.getElementById('radar-tbody');
  const badge = document.getElementById('radar-count-badge');
  const list = getRadarData();

  if (badge) badge.textContent = `${list.length} ${list.length === 1 ? 'papel' : 'papéis'}`;
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="radar-empty-state">
          Nenhum ativo adicionado ao Radar ainda. Preencha os dados de um papel e clique em "+ Adicionar ao Radar".
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(item => {
    let emoji = '🟡';
    if (item.farolStatus === 'compra') emoji = '🟢';
    if (item.farolStatus === 'reprovado') emoji = '🔴';

    const margemClass = item.margemBazin >= 0 ? 'text-green' : 'text-red';

    return `
      <tr data-action="load-radar" data-ticker="${item.ticker}">
        <td class="td-ticker-badge">${item.ticker}</td>
        <td>${fmtReal(item.price)}</td>
        <td>${fmtReal(item.tetoBazin)}</td>
        <td class="td-yield-margin ${margemClass}">${fmtPct(item.margemBazin)}</td>
        <td>
          <span class="radar-status-badge status-${item.farolStatus}">
            ${emoji} ${item.farolStatus}
          </span>
        </td>
        <td class="text-right">
          <div class="radar-actions justify-end">
            <button type="button" class="btn-action-load" data-action="load-radar" data-ticker="${item.ticker}">Carregar</button>
            <button type="button" class="btn-action-delete" title="Excluir" data-action="delete-radar" data-ticker="${item.ticker}">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function loadRadarItem(ticker) {
  const list = getRadarData();
  const item = list.find(x => x.ticker === ticker);
  if (!item) return;

  state.ticker = item.ticker;
  document.getElementById('input-ticker').value = item.ticker;
  document.getElementById('input-graham-ticker').value = item.ticker;

  if (item.price) onPriceInput(item.price.toFixed(2));
  if (item.dpa) {
    state.dpa = item.dpa;
    document.getElementById('input-dpa').value = item.dpa.toFixed(2);
  }
  if (item.dyMedio !== undefined && item.dyMedio > 0) {
    document.getElementById('input-dy-medio').value = item.dyMedio;
  } else {
    document.getElementById('input-dy-medio').value = '';
  }
  if (item.isBank !== undefined) {
    document.getElementById('input-is-bank').checked = item.isBank;
    toggleBankMode(item.isBank);
  }
  if (item.debtEbitda !== undefined) {
    document.getElementById('slider-debt').value = item.debtEbitda;
    onDebtChange(item.debtEbitda);
  }
  if (item.vpa) document.getElementById('input-vpa').value = item.vpa;
  if (item.lpa) document.getElementById('input-lpa').value = item.lpa;
  if (item.payout) document.getElementById('input-payout').value = item.payout;

  if (item.activeTab && item.activeTab !== state.activeTab) switchMainTab(item.activeTab);
  else calculate();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteRadarItem(ticker) {
  let list = getRadarData();
  list = list.filter(x => x.ticker !== ticker);
  saveRadarData(list);
  renderRadarTable();
}

function showClearRadarModal() {
  const modal = document.getElementById('modal-clear-radar');
  if (modal) modal.classList.add('active');
}

function hideClearRadarModal() {
  const modal = document.getElementById('modal-clear-radar');
  if (modal) modal.classList.remove('active');
}

function clearRadarConfirmed() {
  saveRadarData([]);
  renderRadarTable();
  hideClearRadarModal();
}

function bindEvents() {
  document.getElementById('tab-bazin')?.addEventListener('click', () => switchMainTab('bazin'));
  document.getElementById('tab-graham')?.addEventListener('click', () => switchMainTab('graham'));
  document.getElementById('tab-terminal')?.addEventListener('click', () => switchMainTab('terminal'));

  const inputTicker = document.getElementById('input-ticker');
  inputTicker?.addEventListener('input', (e) => onTickerInput(e.target.value));
  inputTicker?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBrapiQuote(e.target.value);
  });
  document.getElementById('btn-fetch-bazin')?.addEventListener('click', () => {
    fetchBrapiQuote(document.getElementById('input-ticker').value);
  });

  document.getElementById('input-is-bank')?.addEventListener('change', (e) => toggleBankMode(e.target.checked));
  document.getElementById('toggle-dpa-direct')?.addEventListener('click', () => setDpaMode('direct'));
  document.getElementById('toggle-dpa-years')?.addEventListener('click', () => setDpaMode('years'));

  document.getElementById('input-dpa')?.addEventListener('input', (e) => onDpaDirectInput(e.target.value));
  [1, 2, 3, 4, 5].forEach(i => {
    document.getElementById(`dpa-y${i}`)?.addEventListener('input', () => calculate());
  });

  document.getElementById('input-price')?.addEventListener('input', (e) => onPriceInput(e.target.value));
  document.getElementById('input-dy-medio')?.addEventListener('input', () => calculate());
  document.getElementById('slider-debt')?.addEventListener('input', (e) => onDebtChange(e.target.value));

  const inputGrahamTicker = document.getElementById('input-graham-ticker');
  inputGrahamTicker?.addEventListener('input', (e) => onTickerInput(e.target.value));
  inputGrahamTicker?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBrapiQuote(e.target.value);
  });
  document.getElementById('btn-fetch-graham')?.addEventListener('click', () => {
    fetchBrapiQuote(document.getElementById('input-graham-ticker').value);
  });

  document.getElementById('input-vpa')?.addEventListener('input', () => calculate());
  document.getElementById('input-lpa')?.addEventListener('input', () => onGrahamProfitInput());
  document.getElementById('input-payout')?.addEventListener('input', () => onGrahamProfitInput());
  document.getElementById('input-graham-price')?.addEventListener('input', (e) => onPriceInput(e.target.value));

  document.getElementById('btn-add-radar')?.addEventListener('click', () => addToRadar());
  document.getElementById('btn-copy-summary')?.addEventListener('click', () => copySummaryText());

  document.getElementById('terminal-k-global')?.addEventListener('input', () => renderTerminalTable());
  document.getElementById('btn-terminal-copy-top')?.addEventListener('click', () => copyTerminalTextSummary());
  document.getElementById('btn-terminal-export')?.addEventListener('click', () => exportTerminalJSON());
  document.getElementById('btn-terminal-import')?.addEventListener('click', () => {
    document.getElementById('import-json-file')?.click();
  });
  document.getElementById('import-json-file')?.addEventListener('change', (e) => handleImportJSON(e));

  document.getElementById('form-terminal')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTerminalItem();
  });
  document.getElementById('term-ticker')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
  document.getElementById('term-lpa')?.addEventListener('input', () => autoCalcTerminalDPA());
  document.getElementById('term-payout')?.addEventListener('input', () => autoCalcTerminalDPA());
  document.getElementById('btn-cancel-edit-terminal')?.addEventListener('click', () => resetTerminalForm());
  document.getElementById('btn-copy-terminal')?.addEventListener('click', () => copyTerminalTextSummary());

  document.getElementById('terminal-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const ticker = btn.getAttribute('data-ticker');
    if (action === 'edit-terminal') editTerminalItem(ticker);
    else if (action === 'delete-terminal') deleteTerminalItem(ticker);
  });

  document.getElementById('btn-clear-radar')?.addEventListener('click', () => showClearRadarModal());
  document.getElementById('btn-modal-cancel-radar')?.addEventListener('click', () => hideClearRadarModal());
  document.getElementById('btn-modal-confirm-radar')?.addEventListener('click', () => clearRadarConfirmed());

  document.getElementById('radar-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const ticker = btn.getAttribute('data-ticker');
      if (action === 'load-radar') loadRadarItem(ticker);
      else if (action === 'delete-radar') deleteRadarItem(ticker);
      return;
    }
    const row = e.target.closest('tr[data-action="load-radar"]');
    if (row) {
      loadRadarItem(row.getAttribute('data-ticker'));
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  state.isBank = document.getElementById('input-is-bank').checked;
  state.dpaMode = 'direct';
  toggleBankMode(state.isBank);
  calculate();
  renderRadarTable();
  renderTerminalTable();
});
