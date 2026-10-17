/* Leitor do Painel de Valuation (./data/valuation.json) com seleção customizada de ativos pelo usuário */

const STORAGE_KEY_PAINEL_TICKERS = 'painel_valuation_selected_tickers';

const SETORES_BESST_ORDEM = [
  { id: 'bancos', letra: 'B', nome: 'Bancos' },
  { id: 'energia', letra: 'E', nome: 'Energia' },
  { id: 'saneamento', letra: 'S', nome: 'Saneamento' },
  { id: 'seguros', letra: 'S', nome: 'Seguros' },
  { id: 'telecom', letra: 'T', nome: 'Telecom' }
];

let painelState = {
  payload: null,
  universo: [],
  selecionados: [],
  filtroSetor: 'todos'
};

function obterTickersSalvos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PAINEL_TICKERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('localStorage inacessível para seleção do Painel:', e);
  }
  return [];
}

function salvarTickersSelecionados(lista) {
  painelState.selecionados = lista;
  try {
    localStorage.setItem(STORAGE_KEY_PAINEL_TICKERS, JSON.stringify(lista));
  } catch (e) {
    console.warn('Falha ao salvar seleção do Painel no localStorage:', e);
  }
}

function formatarMargemDecimal(val) {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return 'N/A';
  const pct = val * 100;
  const prefix = pct > 0 ? '+' : '';
  return prefix + pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function mapearSetorBesst(setor) {
  if (!setor) return null;
  const s = setor.trim().toLowerCase();
  if (s.startsWith('banco')) return 'bancos';
  if (s.startsWith('energia') || s.startsWith('eletric') || s.startsWith('elétric')) return 'energia';
  if (s.startsWith('saneamento')) return 'saneamento';
  if (s.startsWith('segur')) return 'seguros';
  if (s.startsWith('telecom')) return 'telecom';
  return null;
}

function obterAtivosVisiveis() {
  const mapaUniverso = new Map(painelState.universo.map(a => [a.ticker.toUpperCase(), a]));
  const escolhidos = painelState.selecionados
    .map(t => mapaUniverso.get(t.toUpperCase()))
    .filter(Boolean);

  if (painelState.filtroSetor === 'todos') {
    return escolhidos;
  }
  if (painelState.filtroSetor === 'besst') {
    return escolhidos.filter(a => !!a.besst);
  }
  return escolhidos.filter(a => mapearSetorBesst(a.setor) === painelState.filtroSetor);
}

function renderizarCoberturaBesst() {
  const container = document.getElementById('besst-coverage-grid');
  if (!container) return;

  const mapaUniverso = new Map(painelState.universo.map(a => [a.ticker.toUpperCase(), a]));
  const ativosSelecionados = painelState.selecionados
    .map(t => mapaUniverso.get(t.toUpperCase()))
    .filter(Boolean);

  const agrupado = {
    bancos: [],
    energia: [],
    saneamento: [],
    seguros: [],
    telecom: []
  };

  ativosSelecionados.forEach(a => {
    const chave = mapearSetorBesst(a.setor);
    if (chave && agrupado[chave]) {
      agrupado[chave].push(a.ticker);
    }
  });

  container.innerHTML = SETORES_BESST_ORDEM.map(setor => {
    const tickers = agrupado[setor.id];
    const coberto = tickers.length > 0;
    const ativoFiltro = painelState.filtroSetor === setor.id ? 'besst-card-active-filter' : '';
    const statusClasse = coberto ? 'besst-card-covered' : 'besst-card-empty';
    const badgeClasse = coberto ? 'badge-green' : 'badge-neutral';
    const badgeTexto = coberto ? `${tickers.length} ativo${tickers.length > 1 ? 's' : ''}` : 'Vazio';
    const listaTickers = coberto ? tickers.join(', ') : 'Sem ativos selecionados';

    return `
      <div class="besst-card ${statusClasse} ${ativoFiltro}" data-action="filter-besst-sector" data-sector="${setor.id}" title="Clique para filtrar por ${setor.nome}">
        <div class="besst-card-header">
          <span class="besst-letter">${setor.letra}</span>
          <span class="besst-name">${setor.nome}</span>
          <span class="ladder-badge ${badgeClasse}">${badgeTexto}</span>
        </div>
        <div class="besst-tickers">${listaTickers}</div>
      </div>
    `;
  }).join('');
}

function renderizarSeletorUniverso() {
  const chipsContainer = document.getElementById('universe-chips-list');
  const datalist = document.getElementById('universe-tickers-datalist');
  const universeCountEl = document.getElementById('universe-total-badge');

  if (universeCountEl) {
    universeCountEl.textContent = `${painelState.universo.length} disponíveis na base`;
  }

  if (datalist) {
    datalist.innerHTML = painelState.universo
      .map(a => `<option value="${a.ticker}">${a.ticker} — ${a.setor.toUpperCase()} (${fmtReal(a.preco)})</option>`)
      .join('');
  }

  if (!chipsContainer) return;

  const setSelecionados = new Set(painelState.selecionados.map(t => t.toUpperCase()));

  chipsContainer.innerHTML = painelState.universo.map(item => {
    const ativo = setSelecionados.has(item.ticker.toUpperCase());
    const chipClass = ativo ? 'ticker-chip active' : 'ticker-chip';
    const icon = ativo ? '✓' : '+';
    return `
      <button type="button" class="${chipClass}" data-action="toggle-ticker" data-ticker="${item.ticker}" title="${item.setor.toUpperCase()} · ${fmtReal(item.preco)}">
        <span class="chip-icon">${icon}</span>
        <span class="chip-ticker">${item.ticker}</span>
        <span class="chip-sector">${item.setor}</span>
      </button>
    `;
  }).join('');
}

function renderizarTabelaMotor() {
  const tbody = document.getElementById('engine-valuation-tbody');
  const metaEl = document.getElementById('engine-valuation-meta');
  const countBadge = document.getElementById('engine-count-badge');
  const errorBanner = document.getElementById('engine-error-banner');

  if (errorBanner) errorBanner.classList.add('is-hidden');

  const payload = painelState.payload;
  if (metaEl && payload?.gerado_em) {
    const dt = new Date(payload.gerado_em);
    const dtStr = isNaN(dt.getTime()) ? payload.gerado_em : dt.toLocaleString('pt-BR');
    metaEl.textContent = `Schema v${payload.schema_version || '1.0'} · Atualizado em: ${dtStr}`;
  }

  renderizarSeletorUniverso();
  renderizarCoberturaBesst();

  const ativosVisiveis = obterAtivosVisiveis();

  if (countBadge) {
    countBadge.textContent = `${ativosVisiveis.length} ${ativosVisiveis.length === 1 ? 'ativo exibido' : 'ativos exibidos'}`;
  }

  if (!tbody) return;

  if (painelState.selecionados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="radar-empty-state">
          Sua seleção está vazia. Pesquise um ticker acima ou clique nos ativos disponíveis abaixo da busca para montar seu Painel de Valuation.
        </td>
      </tr>
    `;
    return;
  }

  if (ativosVisiveis.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="radar-empty-state">
          Nenhum dos seus ativos selecionados pertence ao filtro setorial ativo. Clique em "Todos" para ver sua seleção completa.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = ativosVisiveis.map(item => {
    const bazin = item.bazin || {};
    const veredito = bazin.veredito || 'vermelho';
    const margemVal = bazin.margem_seguranca;
    const margemClass = (margemVal !== null && margemVal !== undefined)
      ? (margemVal >= 0 ? 'text-green' : (margemVal >= -0.05 ? 'text-yellow' : 'text-red'))
      : 'text-dim';

    let vereditoBadge = '';
    if (veredito === 'verde') {
      vereditoBadge = `<span class="veredito-pill veredito-verde">🟢 VERDE</span>`;
    } else if (veredito === 'amarelo') {
      vereditoBadge = `<span class="veredito-pill veredito-amarelo">🟡 AMARELO</span>`;
    } else {
      vereditoBadge = `<span class="veredito-pill veredito-vermelho">🔴 VERMELHO</span>`;
    }

    const extraTag = bazin.tem_extraordinario
      ? `<span class="extra-dividend-flag" title="Possui dividendos extraordinários na janela de 5 anos (DPA c/ extra: ${fmtReal(bazin.dpa)} | s/ extra: ${fmtReal(bazin.dpa_sem_extra)})">⚠️ c/ Extra</span>`
      : '';

    const dpaSub = bazin.tem_extraordinario
      ? `<div class="term-cell-sub">s/ extra: ${fmtReal(bazin.dpa_sem_extra)}</div><div class="term-cell-sub-sm">c/ extra: ${fmtReal(bazin.dpa)}</div>`
      : `<div>${fmtReal(bazin.dpa_sem_extra)}</div>`;

    const grahamStr = item.graham !== null && item.graham !== undefined
      ? `<div>${fmtReal(item.graham)}</div><div class="term-cell-sub ${item.margem_graham >= 0 ? 'text-green' : 'text-red'}">${formatarMargemDecimal(item.margem_graham)}</div>`
      : `<span class="text-dim">N/A</span>`;

    const gordonStr = item.gordon !== null && item.gordon !== undefined
      ? `<div>${fmtReal(item.gordon)}</div><div class="term-cell-sub ${item.margem_gordon >= 0 ? 'text-green' : 'text-red'}">${formatarMargemDecimal(item.margem_gordon)}</div>`
      : `<span class="text-dim">N/A</span>`;

    let greenblattStr = '';
    if (item.rank_greenblatt !== null && item.rank_greenblatt !== undefined) {
      const rankClass = item.rank_greenblatt === 1 ? 'rank-top1' : (item.rank_greenblatt === 2 ? 'rank-top2' : (item.rank_greenblatt === 3 ? 'rank-top3' : 'rank-normal'));
      greenblattStr = `<span class="rank-badge ${rankClass}">#${item.rank_greenblatt}</span>`;
    } else {
      const motivo = item.motivo_exclusao_greenblatt || 'Fora do ranking Greenblatt';
      greenblattStr = `<span class="rank-badge rank-financial" title="${motivo}">🏦 Fora (Ver motivo)</span><div class="term-cell-sub-sm">${motivo}</div>`;
    }

    return `
      <tr>
        <td class="td-ticker-badge">${item.ticker} ${extraTag}</td>
        <td><span class="setor-tag">${item.setor}</span></td>
        <td>${fmtReal(item.preco)}</td>
        <td>${dpaSub}</td>
        <td class="td-yield-val">${fmtReal(bazin.teto)}</td>
        <td class="td-yield-margin ${margemClass}">${formatarMargemDecimal(margemVal)}</td>
        <td>${vereditoBadge}</td>
        <td>${grahamStr}</td>
        <td>${gordonStr}</td>
        <td class="text-right">
          <div class="radar-actions justify-end">
            ${greenblattStr}
            <button type="button" class="btn-action-delete" title="Remover ${item.ticker} do Painel" data-action="remove-ticker" data-ticker="${item.ticker}">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function alternarTickerSelecionado(ticker) {
  if (!ticker) return;
  const clean = ticker.trim().toUpperCase();
  const existeNoUniverso = painelState.universo.some(a => a.ticker.toUpperCase() === clean);
  if (!existeNoUniverso) {
    mostrarFeedbackBusca(`Ativo "${clean}" não consta na base ./data/valuation.json.`, true);
    return;
  }

  const listaAtual = [...painelState.selecionados];
  const idx = listaAtual.findIndex(t => t.toUpperCase() === clean);
  if (idx >= 0) {
    listaAtual.splice(idx, 1);
  } else {
    listaAtual.push(clean);
  }

  salvarTickersSelecionados(listaAtual);
  renderizarTabelaMotor();
}

function adicionarTickerPorInput() {
  const input = document.getElementById('input-search-universe');
  if (!input) return;
  const val = input.value.trim().toUpperCase();
  if (!val) return;

  const existeNoUniverso = painelState.universo.some(a => a.ticker.toUpperCase() === val);
  if (!existeNoUniverso) {
    mostrarFeedbackBusca(`Ativo "${val}" não encontrado em ./data/valuation.json.`, true);
    return;
  }

  if (!painelState.selecionados.some(t => t.toUpperCase() === val)) {
    salvarTickersSelecionados([...painelState.selecionados, val]);
    renderizarTabelaMotor();
    mostrarFeedbackBusca(`✓ ${val} adicionado ao seu Painel!`, false);
  } else {
    mostrarFeedbackBusca(`${val} já está selecionado no seu Painel.`, false);
  }

  input.value = '';
}

function mostrarFeedbackBusca(msg, isError) {
  const el = document.getElementById('search-universe-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `fetch-quote-status ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = '';
  }, 4000);
}

function selecionarTodosUniverso() {
  const todos = painelState.universo.map(a => a.ticker.toUpperCase());
  salvarTickersSelecionados(todos);
  renderizarTabelaMotor();
}

function selecionarApenasBesst() {
  const besst = painelState.universo.filter(a => !!a.besst).map(a => a.ticker.toUpperCase());
  salvarTickersSelecionados(besst);
  renderizarTabelaMotor();
}

function limparSelecaoPainel() {
  salvarTickersSelecionados([]);
  renderizarTabelaMotor();
}

function definirFiltroSetor(setorId) {
  if (painelState.filtroSetor === setorId && setorId !== 'todos') {
    painelState.filtroSetor = 'todos';
  } else {
    painelState.filtroSetor = setorId;
  }

  document.querySelectorAll('[data-action="filter-sector-btn"]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-sector') === painelState.filtroSetor);
  });

  renderizarTabelaMotor();
}

function exibirErroMotor(mensagem) {
  const errorBanner = document.getElementById('engine-error-banner');
  const tbody = document.getElementById('engine-valuation-tbody');

  if (errorBanner) {
    errorBanner.textContent = `✕ Erro ao carregar ./data/valuation.json: ${mensagem}`;
    errorBanner.classList.remove('is-hidden');
  }

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="radar-empty-state text-red">
          Não foi possível carregar os dados do motor (${mensagem}). Verifique se o arquivo ./data/valuation.json foi gerado com "python -m engine.build".
        </td>
      </tr>
    `;
  }
}

async function carregarValuationJson() {
  try {
    const response = await fetch('./data/valuation.json', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} (${response.statusText || 'Arquivo não encontrado'})`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.ativos)) {
      throw new Error('Formato de JSON inválido (lista "ativos" ausente).');
    }

    painelState.payload = payload;
    painelState.universo = payload.ativos;

    const salvos = obterTickersSalvos();
    const validosSalvos = salvos.filter(t =>
      painelState.universo.some(a => a.ticker.toUpperCase() === t.toUpperCase())
    );
    painelState.selecionados = validosSalvos;

    renderizarTabelaMotor();
  } catch (err) {
    exibirErroMotor(err.message || 'Falha de rede ao buscar ./data/valuation.json');
  }
}

function bindPainelEvents() {
  document.getElementById('btn-add-universe-ticker')?.addEventListener('click', () => adicionarTickerPorInput());
  document.getElementById('input-search-universe')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionarTickerPorInput();
    }
  });

  document.getElementById('btn-select-all-universe')?.addEventListener('click', () => selecionarTodosUniverso());
  document.getElementById('btn-select-besst-universe')?.addEventListener('click', () => selecionarApenasBesst());
  document.getElementById('btn-clear-universe')?.addEventListener('click', () => limparSelecaoPainel());

  document.getElementById('universe-chips-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="toggle-ticker"]');
    if (!btn) return;
    alternarTickerSelecionado(btn.getAttribute('data-ticker'));
  });

  document.getElementById('engine-valuation-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-ticker"]');
    if (!btn) return;
    alternarTickerSelecionado(btn.getAttribute('data-ticker'));
  });

  document.getElementById('besst-coverage-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-action="filter-besst-sector"]');
    if (!card) return;
    definirFiltroSetor(card.getAttribute('data-sector'));
  });

  document.querySelectorAll('[data-action="filter-sector-btn"]').forEach(btn => {
    btn.addEventListener('click', () => definirFiltroSetor(btn.getAttribute('data-sector')));
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindPainelEvents();
  carregarValuationJson();
});
