/* Carregamento e renderização do painel alimentado por ./data/valuation.json */

const SETORES_BESST_ORDEM = [
  { id: 'bancos', letra: 'B', nome: 'Bancos' },
  { id: 'energia', letra: 'E', nome: 'Energia' },
  { id: 'saneamento', letra: 'S', nome: 'Saneamento' },
  { id: 'seguros', letra: 'S', nome: 'Seguros' },
  { id: 'telecom', letra: 'T', nome: 'Telecom' }
];

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

function renderizarCoberturaBesst(ativos) {
  const container = document.getElementById('besst-coverage-grid');
  if (!container) return;

  const agrupado = {
    bancos: [],
    energia: [],
    saneamento: [],
    seguros: [],
    telecom: []
  };

  (ativos || []).forEach(a => {
    const chave = mapearSetorBesst(a.setor);
    if (chave && agrupado[chave]) {
      agrupado[chave].push(a.ticker);
    }
  });

  container.innerHTML = SETORES_BESST_ORDEM.map(setor => {
    const tickers = agrupado[setor.id];
    const coberto = tickers.length > 0;
    const statusClasse = coberto ? 'besst-card-covered' : 'besst-card-empty';
    const badgeClasse = coberto ? 'badge-green' : 'badge-neutral';
    const badgeTexto = coberto ? `${tickers.length} ativo${tickers.length > 1 ? 's' : ''}` : 'Vazio';
    const listaTickers = coberto ? tickers.join(', ') : 'Sem cobertura';

    return `
      <div class="besst-card ${statusClasse}">
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

function renderizarTabelaMotor(payload) {
  const tbody = document.getElementById('engine-valuation-tbody');
  const metaEl = document.getElementById('engine-valuation-meta');
  const countBadge = document.getElementById('engine-count-badge');
  const errorBanner = document.getElementById('engine-error-banner');

  if (errorBanner) errorBanner.classList.add('is-hidden');

  const ativos = payload?.ativos || [];
  if (countBadge) {
    countBadge.textContent = `${ativos.length} ${ativos.length === 1 ? 'ativo' : 'ativos'}`;
  }

  if (metaEl && payload?.gerado_em) {
    const dt = new Date(payload.gerado_em);
    const dtStr = isNaN(dt.getTime()) ? payload.gerado_em : dt.toLocaleString('pt-BR');
    metaEl.textContent = `Schema v${payload.schema_version || '1.0'} · Gerado em: ${dtStr}`;
  }

  renderizarCoberturaBesst(ativos);

  if (!tbody) return;

  if (ativos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="radar-empty-state">
          Nenhum ativo encontrado em ./data/valuation.json.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = ativos.map(item => {
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

    return `
      <tr>
        <td class="td-ticker-badge">${item.ticker} ${extraTag}</td>
        <td><span class="setor-tag">${item.setor}</span></td>
        <td>${fmtReal(item.preco)}</td>
        <td class="td-yield-val">${fmtReal(bazin.teto)}</td>
        <td class="td-yield-margin ${margemClass}">${formatarMargemDecimal(margemVal)}</td>
        <td>${vereditoBadge}</td>
      </tr>
    `;
  }).join('');
}

function exibirErroMotor(mensagem) {
  const errorBanner = document.getElementById('engine-error-banner');
  const tbody = document.getElementById('engine-valuation-tbody');

  renderizarCoberturaBesst([]);

  if (errorBanner) {
    errorBanner.textContent = `✕ Erro ao carregar ./data/valuation.json: ${mensagem}`;
    errorBanner.classList.remove('is-hidden');
  }

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="radar-empty-state text-red">
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

    renderizarTabelaMotor(payload);
  } catch (err) {
    exibirErroMotor(err.message || 'Falha de rede ao buscar ./data/valuation.json');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  carregarValuationJson();
});
