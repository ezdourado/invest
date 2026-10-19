/* Painel de Valuation · leitor de ./data/valuation.json
 * Somente leitura e apresentação: nenhum valuation é recalculado aqui.
 * Todos os números exibidos vêm do motor Python (engine/build.py).
 */

const STORAGE_KEY_PAINEL_TICKERS = 'painel_valuation_selected_tickers';
const STORAGE_KEY_PAINEL_SORT = 'painel_valuation_sort';
const DIAS_BASE_DESATUALIZADA = 3;

const SETORES_BESST = [
  { id: 'bancos', letra: 'B', nome: 'Bancos' },
  { id: 'energia', letra: 'E', nome: 'Energia' },
  { id: 'saneamento', letra: 'S', nome: 'Saneamento' },
  { id: 'seguros', letra: 'S', nome: 'Seguros' },
  { id: 'telecom', letra: 'T', nome: 'Telecom' }
];

const ORDEM_VEREDITO = { verde: 0, amarelo: 1, vermelho: 2 };
const ROTULO_VEREDITO = { verde: 'Compra', amarelo: 'Atenção', vermelho: 'Caro' };

const OPCOES_ORDENACAO = [
  { key: 'margem', dir: 'desc', label: 'Maior margem Bazin' },
  { key: 'margem', dir: 'asc', label: 'Menor margem Bazin' },
  { key: 'dy', dir: 'desc', label: 'Maior DPA / preço' },
  { key: 'greenblatt', dir: 'asc', label: 'Melhor Greenblatt' },
  { key: 'graham', dir: 'desc', label: 'Maior margem Graham' },
  { key: 'gordon', dir: 'desc', label: 'Maior margem Gordon' },
  { key: 'ticker', dir: 'asc', label: 'Ticker (A–Z)' },
  { key: 'preco', dir: 'desc', label: 'Maior preço' }
];

const painelState = {
  payload: null,
  universo: [],
  selecionados: [],
  filtroSetor: 'todos',
  filtroVeredito: 'todos',
  termo: '',
  sort: { key: 'margem', dir: 'desc' },
  detalheTicker: null
};

/* ---------- Utilidades ---------- */

const $ = (sel) => document.querySelector(sel);

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function valido(v) {
  return v !== null && v !== undefined && !Number.isNaN(v) && Number.isFinite(v);
}

function fmtReal(v) {
  if (!valido(v)) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v, casas = 1) {
  if (!valido(v)) return '—';
  const pct = v * 100;
  const sinal = pct > 0 ? '+' : '';
  return sinal + pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

function fmtPctSimples(v, casas = 1) {
  if (!valido(v)) return '—';
  const pct = v * 100;
  return pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

function fmtMult(v, sufixo = 'x') {
  if (!valido(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + sufixo;
}

function fmtMoedaCompacta(v) {
  if (!valido(v) || v <= 0) return '—';
  if (v >= 1e9) return 'R$ ' + (v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' bi';
  if (v >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mi';
  if (v >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' mil';
  return fmtReal(v);
}

function urlInvestidor10(ticker) {
  const clean = String(ticker || '').trim().toLowerCase();
  return `https://investidor10.com.br/acoes/${encodeURIComponent(clean)}/`;
}

function tempoRelativoStr(dt) {
  const diffMin = Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

function classeMargem(v) {
  if (!valido(v)) return 't-dim';
  if (v >= 0) return 't-green';
  if (v >= -0.05) return 't-yellow';
  return 't-red';
}

function classeRoe(v) {
  if (!valido(v)) return 't-dim';
  if (v >= 0.15) return 't-green';
  if (v >= 0.08) return 't-yellow';
  return 't-red';
}

function classeRoic(v) {
  if (!valido(v)) return 't-dim';
  if (v >= 0.12) return 't-green';
  if (v >= 0.07) return 't-yellow';
  return 't-red';
}

function classeAlavancagem(v, limiteBom = 2.5, limiteAlerta = 3.5) {
  if (!valido(v)) return 't-dim';
  if (v <= limiteBom) return 't-green';
  if (v <= limiteAlerta) return 't-yellow';
  return 't-red';
}

function classePl(v) {
  if (!valido(v)) return 't-dim';
  if (v <= 0) return 't-red';
  if (v <= 10) return 't-green';
  if (v <= 15) return '';
  return 't-yellow';
}

function classePvp(v) {
  if (!valido(v)) return 't-dim';
  if (v <= 0) return 't-red';
  if (v <= 1.05) return 't-green';
  if (v <= 2.0) return '';
  return 't-yellow';
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

function nomeSetor(id) {
  if (id === 'besst') return 'Somente BESST';
  if (id === 'outros') return 'Fora do BESST';
  return SETORES_BESST.find(s => s.id === id)?.nome || id;
}

function mediana(lista) {
  const v = lista.filter(valido).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* Razão DPA/preço apenas para ordenação/exibição (não altera teto, margem nem veredito). */
function razaoDpaPreco(a) {
  const dpa = a.bazin?.dpa_sem_extra;
  return valido(dpa) && a.preco > 0 ? dpa / a.preco : null;
}

/* ---------- Persistência ---------- */

function lerStorage(chave, padrao) {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch (e) {
    return padrao;
  }
}

function gravarStorage(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
}

function salvarSelecionados(lista) {
  painelState.selecionados = lista;
  gravarStorage(STORAGE_KEY_PAINEL_TICKERS, lista);
}

/* ---------- Seleção e filtros ---------- */

function mapaUniverso() {
  return new Map(painelState.universo.map(a => [a.ticker.toUpperCase(), a]));
}

function ativosSelecionados() {
  const mapa = mapaUniverso();
  return painelState.selecionados.map(t => mapa.get(t.toUpperCase())).filter(Boolean);
}

function passaFiltroSetor(a) {
  const f = painelState.filtroSetor;
  if (f === 'todos') return true;
  if (f === 'besst') return !!a.besst;
  if (f === 'outros') return !mapearSetorBesst(a.setor);
  return mapearSetorBesst(a.setor) === f;
}

function valorOrdenacao(a, key) {
  switch (key) {
    case 'ticker': return a.ticker;
    case 'preco': return a.preco;
    case 'dpa': return a.bazin?.dpa_sem_extra;
    case 'teto': return a.bazin?.teto;
    case 'margem': return a.bazin?.margem_seguranca;
    case 'veredito': return ORDEM_VEREDITO[a.bazin?.veredito] ?? 9;
    case 'graham': return a.margem_graham;
    case 'gordon': return a.margem_gordon;
    case 'greenblatt': return a.rank_greenblatt;
    case 'dy': return razaoDpaPreco(a);
    default: return null;
  }
}

function ordenar(lista) {
  const { key, dir } = painelState.sort;
  const fator = dir === 'asc' ? 1 : -1;
  return [...lista].sort((a, b) => {
    const va = valorOrdenacao(a, key);
    const vb = valorOrdenacao(b, key);
    const na = va === null || va === undefined;
    const nb = vb === null || vb === undefined;
    if (na && nb) return 0;
    if (na) return 1; // nulos sempre ao final
    if (nb) return -1;
    if (typeof va === 'string') return va.localeCompare(vb) * fator;
    return (va - vb) * fator;
  });
}

function ativosVisiveis() {
  const q = painelState.termo.trim().toLowerCase();
  const lista = ativosSelecionados().filter(a => {
    if (!passaFiltroSetor(a)) return false;
    if (painelState.filtroVeredito !== 'todos' && a.bazin?.veredito !== painelState.filtroVeredito) return false;
    if (q && !a.ticker.toLowerCase().includes(q) && !a.setor.toLowerCase().includes(q)) return false;
    return true;
  });
  return ordenar(lista);
}

/* ---------- Render: status ---------- */

function renderizarStatus(estado, texto) {
  const pill = $('#status-pill');
  if (!pill) return;
  pill.classList.remove('is-ok', 'is-stale', 'is-error');
  pill.classList.add(estado);
  $('#status-text').textContent = texto;
}

function atualizarStatusBase() {
  const p = painelState.payload;
  if (!p?.gerado_em) return;
  const dt = new Date(p.gerado_em);
  if (Number.isNaN(dt.getTime())) {
    renderizarStatus('is-ok', `Últ. atualização: ${p.gerado_em}`);
    return;
  }
  const dias = (Date.now() - dt.getTime()) / 86400000;
  const quando = dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rel = tempoRelativoStr(dt);
  renderizarStatus(dias > DIAS_BASE_DESATUALIZADA ? 'is-stale' : 'is-ok', `Últ. atualização: ${quando} (${rel}) · ${painelState.universo.length} ativos`);
}

/* ---------- Render: KPIs ---------- */

function renderizarKpis() {
  const el = $('#kpi-grid');
  if (!el) return;
  const sel = ativosSelecionados();
  const total = sel.length;
  const cont = { verde: 0, amarelo: 0, vermelho: 0 };
  sel.forEach(a => { if (cont[a.bazin?.veredito] !== undefined) cont[a.bazin.veredito] += 1; });
  const pct = (n) => total ? (n / total) * 100 : 0;

  const medMargem = mediana(sel.map(a => a.bazin?.margem_seguranca));
  const melhor = sel
    .filter(a => valido(a.bazin?.margem_seguranca))
    .sort((a, b) => b.bazin.margem_seguranca - a.bazin.margem_seguranca)[0];
  const cobertos = SETORES_BESST.filter(s => sel.some(a => mapearSetorBesst(a.setor) === s.id)).length;
  const melhorGb = sel.filter(a => valido(a.rank_greenblatt)).sort((a, b) => a.rank_greenblatt - b.rank_greenblatt)[0];

  el.innerHTML = `
    <div class="kpi" style="--kpi-color: var(--accent)" data-tip="Ativos escolhidos por você dentre os disponíveis na base">
      <div class="kpi-label">Ativos no painel</div>
      <div class="kpi-value">${total}<span class="t-dim" style="font-size:14px"> / ${painelState.universo.length}</span></div>
      <div class="kpi-bar" aria-hidden="true">
        <span style="width:${pct(cont.verde)}%;background:var(--green)"></span>
        <span style="width:${pct(cont.amarelo)}%;background:var(--yellow)"></span>
        <span style="width:${pct(cont.vermelho)}%;background:var(--red)"></span>
      </div>
    </div>
    <div class="kpi is-clickable" style="--kpi-color: var(--green)" data-kpi-verdict="verde" data-tip="Clique para filtrar apenas os ativos com veredito verde">
      <div class="kpi-label">Zona de compra</div>
      <div class="kpi-value t-green">${cont.verde}</div>
      <div class="kpi-foot">${total ? pct(cont.verde).toFixed(0) : 0}% · ${cont.amarelo} atenção · ${cont.vermelho} caros</div>
    </div>
    <div class="kpi" style="--kpi-color: var(--yellow)" data-tip="Mediana da margem de segurança Bazin dos ativos do painel">
      <div class="kpi-label">Margem Bazin mediana</div>
      <div class="kpi-value ${classeMargem(medMargem)}">${fmtPct(medMargem)}</div>
      <div class="kpi-foot">(Teto − Preço) ÷ Teto</div>
    </div>
    <div class="kpi ${melhor ? 'is-clickable' : ''}" style="--kpi-color: var(--green)" ${melhor ? `data-kpi-detail="${esc(melhor.ticker)}"` : ''} data-tip="Maior margem de segurança Bazin do painel. Clique para ver o detalhe.">
      <div class="kpi-label">Maior desconto Bazin</div>
      <div class="kpi-value">${melhor ? esc(melhor.ticker) : '—'}</div>
      <div class="kpi-foot ${melhor ? classeMargem(melhor.bazin.margem_seguranca) : ''}">${melhor ? `${fmtPct(melhor.bazin.margem_seguranca)} · teto ${fmtReal(melhor.bazin.teto)}` : 'Sem dados'}</div>
    </div>
    <div class="kpi ${melhorGb ? 'is-clickable' : ''}" style="--kpi-color: var(--accent)" ${melhorGb ? `data-kpi-detail="${esc(melhorGb.ticker)}"` : ''} data-tip="Cobertura dos 5 setores BESST e o melhor colocado no ranking Greenblatt dentro do painel">
      <div class="kpi-label">Cobertura BESST</div>
      <div class="kpi-value">${cobertos}<span class="t-dim" style="font-size:14px"> / 5</span></div>
      <div class="kpi-foot">${melhorGb ? `Top Greenblatt: ${esc(melhorGb.ticker)} (#${melhorGb.rank_greenblatt})` : 'Sem ranking Greenblatt'}</div>
    </div>
  `;
}

/* ---------- Render: BESST ---------- */

function renderizarBesst() {
  const el = $('#besst-coverage-grid');
  if (!el) return;
  const sel = ativosSelecionados();

  el.innerHTML = SETORES_BESST.map(setor => {
    const itens = sel.filter(a => mapearSetorBesst(a.setor) === setor.id);
    const n = itens.length;
    const cont = { verde: 0, amarelo: 0, vermelho: 0 };
    itens.forEach(a => { if (cont[a.bazin?.veredito] !== undefined) cont[a.bazin.veredito] += 1; });
    const med = mediana(itens.map(a => a.bazin?.margem_seguranca));
    const ativo = painelState.filtroSetor === setor.id;
    const w = (k) => n ? (cont[k] / n) * 100 : 0;
    const tip = n ? `${itens.map(a => a.ticker).join(', ')}` : `Nenhum ativo de ${setor.nome} no painel`;

    return `
      <button type="button" class="besst-item ${n ? '' : 'is-empty'} ${ativo ? 'is-active' : ''}" data-sector="${setor.id}" data-tip="${esc(tip)}">
        <div class="besst-top">
          <span class="besst-name"><span class="besst-letter">${setor.letra}</span>${setor.nome}</span>
          <span class="besst-count">${n}</span>
        </div>
        <div class="besst-mix" aria-hidden="true">
          <span style="width:${w('verde')}%;background:var(--green)"></span>
          <span style="width:${w('amarelo')}%;background:var(--yellow)"></span>
          <span style="width:${w('vermelho')}%;background:var(--red)"></span>
        </div>
        <div class="besst-meta">
          <span>${n ? `${cont.verde} em compra` : 'Sem cobertura'}</span>
          <span class="mono ${classeMargem(med)}">${n ? fmtPct(med) : ''}</span>
        </div>
      </button>
    `;
  }).join('');
}

/* ---------- Render: tabela ---------- */

function htmlVeredito(v) {
  const k = ORDEM_VEREDITO[v] !== undefined ? v : 'vermelho';
  return `<span class="verdict verdict-${k}">${ROTULO_VEREDITO[k]}</span>`;
}

function htmlBarraMargem(m) {
  if (!valido(m)) return '';
  const c = Math.max(-1, Math.min(1, m));
  const largura = Math.abs(c) * 50;
  const cor = m >= 0 ? 'var(--green)' : (m >= -0.05 ? 'var(--yellow)' : 'var(--red)');
  const pos = m >= 0 ? `left:50%;width:${largura}%` : `right:50%;width:${largura}%`;
  return `<div class="mbar" aria-hidden="true"><span style="${pos};background:${cor}"></span></div>`;
}

function htmlModelo(valor, margemModelo, nomeModelo) {
  if (!valido(valor)) return `<span class="t-dim" data-tip="${nomeModelo} não se aplica a este ativo (dados ausentes ou negativos)">—</span>`;
  return `
    <div class="cell-stack">
      <span>${fmtReal(valor)}</span>
      <span class="cell-sub ${classeMargem(margemModelo)}">${fmtPct(margemModelo)}</span>
    </div>`;
}

function htmlGreenblatt(a) {
  if (valido(a.rank_greenblatt)) {
    return `<span class="rank ${a.rank_greenblatt <= 5 ? 'rank-top' : ''}">#${a.rank_greenblatt}</span>`;
  }
  const motivo = a.motivo_exclusao_greenblatt || 'Fora do ranking Greenblatt';
  return `<span class="rank-out" data-tip="${esc(motivo)}">Fora</span><span class="cell-sub rank-reason">${esc(motivo)}</span>`;
}

function renderizarCabecalho() {
  document.querySelectorAll('.vt thead th[data-sort]').forEach(th => {
    const ativo = th.dataset.sort === painelState.sort.key;
    th.classList.toggle('is-sorted', ativo);
    th.classList.toggle('asc', ativo && painelState.sort.dir === 'asc');
    th.classList.toggle('desc', ativo && painelState.sort.dir === 'desc');
    th.setAttribute('aria-sort', ativo ? (painelState.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
  const sel = $('#select-sort-mobile');
  if (sel) {
    const idx = OPCOES_ORDENACAO.findIndex(o => o.key === painelState.sort.key && o.dir === painelState.sort.dir);
    sel.value = idx >= 0 ? String(idx) : '';
  }
}

function renderizarChipsFiltro() {
  const el = $('#active-filters');
  if (!el) return;
  const chips = [];
  if (painelState.filtroSetor !== 'todos') chips.push({ tipo: 'setor', label: `Setor: ${nomeSetor(painelState.filtroSetor)}` });
  if (painelState.filtroVeredito !== 'todos') chips.push({ tipo: 'veredito', label: `Veredito: ${ROTULO_VEREDITO[painelState.filtroVeredito]}` });
  if (painelState.termo.trim()) chips.push({ tipo: 'termo', label: `Busca: "${painelState.termo.trim()}"` });
  el.innerHTML = chips.map(c => `
    <span class="filter-chip">${esc(c.label)}
      <button type="button" data-clear-filter="${c.tipo}" aria-label="Remover filtro">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </span>`).join('');
}

function renderizarTabela() {
  const tbody = $('#engine-valuation-tbody');
  const contador = $('#engine-count-badge');
  if (!tbody) return;

  renderizarCabecalho();
  renderizarChipsFiltro();

  const lista = ativosVisiveis();
  const totalSel = painelState.selecionados.length;
  if (contador) {
    contador.textContent = lista.length === totalSel
      ? `${lista.length} ${lista.length === 1 ? 'ativo exibido' : 'ativos exibidos'}`
      : `${lista.length} de ${totalSel} ativos exibidos (filtros ativos)`;
  }

  if (totalSel === 0) {
    tbody.innerHTML = `
      <tr class="row-empty"><td colspan="10" class="empty">
        <strong>Seu painel está vazio</strong>
        Escolha os ativos que deseja acompanhar. A seleção fica salva neste navegador.
        <div class="empty-actions">
          <button type="button" class="btn btn-primary" data-empty-action="open">Gerenciar ativos</button>
          <button type="button" class="btn btn-ghost" data-empty-action="besst">Carregar setores BESST</button>
          <button type="button" class="btn btn-ghost" data-empty-action="todos">Carregar todos</button>
        </div>
      </td></tr>`;
    return;
  }

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr class="row-empty"><td colspan="10" class="empty">
        <strong>Nenhum ativo com os filtros atuais</strong>
        Ajuste a busca, o setor ou o veredito.
        <div class="empty-actions"><button type="button" class="btn btn-ghost" data-empty-action="limpar-filtros">Limpar filtros</button></div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const b = a.bazin || {};
    const m = b.margem_seguranca;
    const extra = b.tem_extraordinario
      ? `<span class="tag tag-extra" data-tip="Há dividendos extraordinários na janela de 5 anos. DPA c/ extra: ${fmtReal(b.dpa)} · s/ extra: ${fmtReal(b.dpa_sem_extra)}">Extra</span>`
      : '';
    const besst = a.besst ? `<span class="tag tag-besst">BESST</span>` : '';
    const dpaCell = b.tem_extraordinario
      ? `<div class="cell-stack"><span>${fmtReal(b.dpa_sem_extra)}</span><span class="cell-sub">c/ extra ${fmtReal(b.dpa)}</span></div>`
      : fmtReal(b.dpa_sem_extra);

    return `
      <tr class="row" data-ticker="${esc(a.ticker)}" tabindex="0">
        <td class="c-ticker" data-label="Ativo">
          <div class="asset">
            <span class="asset-ticker" ${a.empresa ? `data-tip="${esc(a.empresa)}"` : ''}>${esc(a.ticker)} ${extra}</span>
            <span class="asset-sector">${esc(a.setor)} ${besst}</span>
          </div>
        </td>
        <td class="num c-preco" data-label="Preço">${fmtReal(a.preco)}</td>
        <td class="num c-dpa" data-label="DPA 5a">${dpaCell}</td>
        <td class="num c-teto" data-label="Teto Bazin">${fmtReal(b.teto)}</td>
        <td class="num c-margem" data-label="Margem Bazin">
          <div class="margin-cell" data-tip="Preço ${fmtReal(a.preco)} vs teto ${fmtReal(b.teto)}">
            <span class="margin-val ${classeMargem(m)}">${fmtPct(m)}</span>
            ${htmlBarraMargem(m)}
          </div>
        </td>
        <td class="c-verdict" data-label="Veredito">${htmlVeredito(b.veredito)}</td>
        <td class="num c-graham" data-label="Graham">${htmlModelo(a.graham, a.margem_graham, 'Graham')}</td>
        <td class="num c-gordon" data-label="Gordon">${htmlModelo(a.gordon, a.margem_gordon, 'Gordon')}</td>
        <td class="num c-gb" data-label="Greenblatt">${htmlGreenblatt(a)}</td>
        <td class="c-actions">
          <div class="row-actions">
            <a href="${urlInvestidor10(a.ticker)}" target="_blank" rel="noopener noreferrer" class="icon-btn" data-row-action="ext" data-tip="Abrir ${esc(a.ticker)} no Investidor10" aria-label="Abrir ${esc(a.ticker)} no Investidor10">
              <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <button type="button" class="icon-btn" data-row-action="detail" data-tip="Abrir Raio-X do ativo" aria-label="Ver detalhes de ${esc(a.ticker)}">
              <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button type="button" class="icon-btn remove" data-row-action="remove" data-tip="Remover do painel" aria-label="Remover ${esc(a.ticker)} do painel">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ---------- Render: gaveta de seleção ---------- */

function renderizarUniverso() {
  const el = $('#universe-chips-list');
  const badge = $('#universe-total-badge');
  if (badge) badge.textContent = `${painelState.universo.length} disponíveis na base · ${painelState.selecionados.length} selecionados`;
  if (!el) return;

  const q = ($('#input-search-universe')?.value || '').trim().toLowerCase();
  const sel = new Set(painelState.selecionados.map(t => t.toUpperCase()));
  const grupos = [
    ...SETORES_BESST.map(s => ({ id: s.id, titulo: s.nome, filtro: a => mapearSetorBesst(a.setor) === s.id })),
    { id: 'outros', titulo: 'Outras pagadoras de dividendos', filtro: a => !mapearSetorBesst(a.setor) }
  ];
  const corVeredito = { verde: 'var(--green)', amarelo: 'var(--yellow)', vermelho: 'var(--red)' };

  const html = grupos.map(g => {
    const itens = painelState.universo
      .filter(g.filtro)
      .filter(a => !q || a.ticker.toLowerCase().includes(q) || a.setor.toLowerCase().includes(q))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    if (!itens.length) return '';
    const todosOn = itens.every(a => sel.has(a.ticker.toUpperCase()));
    return `
      <div>
        <div class="u-group-title">
          <span>${g.titulo} · ${itens.length}</span>
          <button type="button" data-group-toggle="${g.id}" data-on="${todosOn ? '1' : '0'}">${todosOn ? 'Remover grupo' : 'Adicionar grupo'}</button>
        </div>
        <div class="u-chips">
          ${itens.map(a => `
            <button type="button" class="chip ${sel.has(a.ticker.toUpperCase()) ? 'is-on' : ''}" data-toggle-ticker="${esc(a.ticker)}"
              data-tip="${esc(a.setor)} · ${fmtReal(a.preco)} · Teto ${fmtReal(a.bazin?.teto)} · Margem ${fmtPct(a.bazin?.margem_seguranca)}">
              <i style="background:${corVeredito[a.bazin?.veredito] || 'var(--dim)'}"></i>${esc(a.ticker)}
            </button>`).join('')}
        </div>
      </div>`;
  }).join('');

  el.innerHTML = html || `<p class="t-muted">Nenhum ativo encontrado para "${esc(q)}".</p>`;
}

/* ---------- Render: detalhe ---------- */

function htmlComparativoModelos(a) {
  const modelos = [
    { nome: 'Teto Bazin', valor: a.bazin?.teto, cor: 'var(--green)' },
    { nome: 'Graham', valor: a.graham, cor: 'var(--accent)' },
    { nome: 'Gordon', valor: a.gordon, cor: '#9b8cf0' }
  ];
  const valores = [a.preco, ...modelos.map(m => m.valor)].filter(valido);
  const max = Math.max(...valores) * 1.08;
  const posPreco = (a.preco / max) * 100;

  return `
    <div class="d-block">
      <div class="d-section-title">Preço vs. valor justo por modelo</div>
      <div style="position:relative;display:flex;flex-direction:column;gap:12px;padding-top:4px">
        <div style="position:absolute;top:0;bottom:0;left:calc(84px + (100% - 84px - 78px) * ${posPreco / 100});width:2px;background:var(--text-strong);opacity:.7;border-radius:1px" data-tip="Preço atual ${fmtReal(a.preco)}"></div>
        ${modelos.map(m => {
          const w = valido(m.valor) ? (m.valor / max) * 100 : 0;
          return `
            <div style="display:flex;align-items:center;gap:0">
              <span style="width:84px;font-size:12px;color:var(--muted)">${m.nome}</span>
              <div style="flex:1;height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden">
                <div style="width:${w}%;height:100%;background:${m.cor};opacity:.85;border-radius:4px"></div>
              </div>
              <span class="mono" style="width:78px;text-align:right;font-size:12px;color:var(--text-strong)">${valido(m.valor) ? fmtReal(m.valor) : '—'}</span>
            </div>`;
        }).join('')}
      </div>
      <p class="d-note" style="margin-top:10px">Linha vertical = preço atual (${fmtReal(a.preco)}). Barras à direita da linha indicam valor justo acima do preço.</p>
    </div>`;
}

function htmlHistoricoDpaAnual(porAno) {
  if (!porAno || typeof porAno !== 'object') return '';
  const entradas = Object.entries(porAno).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!entradas.length) return '';
  const maxVal = Math.max(...entradas.map(([, v]) => Number(v) || 0), 0.01);

  return `
    <div class="d-sub-chart">
      <div class="d-sub-title">Proventos recorrentes por ano civil da data-com</div>
      <div class="d-bars-5y">
        ${entradas.map(([ano, val]) => {
          const num = Number(val) || 0;
          const h = Math.max(4, Math.round((num / maxVal) * 46));
          return `
            <div class="d-bar-col" data-tip="${ano}: ${fmtReal(num)} por ação">
              <span class="d-bar-val mono">${fmtReal(num).replace('R$ ', '')}</span>
              <div class="d-bar-track"><div class="d-bar-fill" style="height:${h}px"></div></div>
              <span class="d-bar-year mono">${ano}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderizarDetalhe(ticker) {
  const a = mapaUniverso().get(String(ticker).toUpperCase());
  if (!a) return;
  painelState.detalheTicker = a.ticker;
  const b = a.bazin || {};
  const f = a.fundamentos || {};
  const ehBanco = mapearSetorBesst(a.setor) === 'bancos';

  $('#detail-title').textContent = a.empresa ? `${a.ticker} · ${a.empresa}` : a.ticker;
  $('#detail-sub').innerHTML = `${esc(a.setor)}${a.besst ? ' · BESST' : ''} · ${htmlVeredito(b.veredito)}`;

  const noPainel = painelState.selecionados.some(t => t.toUpperCase() === a.ticker.toUpperCase());
  const greenblatt = valido(a.rank_greenblatt)
    ? `#${a.rank_greenblatt}`
    : (a.motivo_exclusao_greenblatt || 'Fora do ranking');

  const dtGerado = painelState.payload?.gerado_em ? new Date(painelState.payload.gerado_em) : null;
  const geradoStr = dtGerado && !Number.isNaN(dtGerado.getTime())
    ? `${dtGerado.toLocaleString('pt-BR')} (${tempoRelativoStr(dtGerado)})`
    : (painelState.payload?.gerado_em || '—');

  const linkInv10 = urlInvestidor10(a.ticker);

  $('#detail-body').innerHTML = `
    <div class="d-hero">
      <div class="d-stat"><div class="d-stat-label">Preço</div><div class="d-stat-value">${fmtReal(a.preco)}</div></div>
      <div class="d-stat"><div class="d-stat-label">Teto Bazin</div><div class="d-stat-value">${fmtReal(b.teto)}</div></div>
      <div class="d-stat"><div class="d-stat-label">Margem</div><div class="d-stat-value ${classeMargem(b.margem_seguranca)}">${fmtPct(b.margem_seguranca)}</div></div>
    </div>

    <div class="d-ext-bar">
      <a class="btn btn-primary btn-inv10" href="${linkInv10}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">
        <span>Analisar ${esc(a.ticker)} no Investidor10</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </div>

    ${htmlComparativoModelos(a)}

    <div class="d-block">
      <div class="d-section-title">Bazin · K = 6%</div>
      <dl class="kv">
        <dt>DPA 5a sem extraordinários</dt><dd>${fmtReal(b.dpa_sem_extra)}</dd>
        <dt>DPA 5a com extraordinários</dt><dd>${fmtReal(b.dpa)}</dd>
        <dt>Yield implícito (DPA 5a / Preço)</dt><dd class="${razaoDpaPreco(a) >= 0.06 ? 't-green' : ''}">${fmtPctSimples(razaoDpaPreco(a), 2)}</dd>
        <div class="sep"></div>
        <dt>Teto (DPA ÷ 6%)</dt><dd>${fmtReal(b.teto)}</dd>
        ${valido(b.teto_sem_extra) && b.teto_sem_extra !== b.teto ? `<dt>Teto sem extraordinários</dt><dd>${fmtReal(b.teto_sem_extra)}</dd>` : ''}
        <dt>Margem de segurança</dt><dd class="${classeMargem(b.margem_seguranca)}">${fmtPct(b.margem_seguranca)}</dd>
        <dt>Dividendos extraordinários</dt><dd>${b.tem_extraordinario ? '<span class="t-yellow">Sim</span>' : 'Não'}</dd>
      </dl>
      ${htmlHistoricoDpaAnual(b.por_ano)}
    </div>

    <div class="d-block">
      <div class="d-section-title">Análise de Múltiplos (Valuation Relativo)</div>
      <div class="d-mult-grid">
        <div class="d-mult-card" data-tip="Preço dividido pelo Lucro por Ação (12m). Abaixo de 10x costuma indicar desconto.">
          <span class="d-mult-label">P/L</span>
          <span class="d-mult-val ${classePl(f.pl)}">${fmtMult(f.pl)}</span>
          <span class="d-mult-sub">LPA: ${fmtReal(f.lpa)}</span>
        </div>
        <div class="d-mult-card" data-tip="Preço dividido pelo Valor Patrimonial por Ação. Abaixo de 1,0x negocia abaixo do patrimônio contábil.">
          <span class="d-mult-label">P/VP</span>
          <span class="d-mult-val ${classePvp(f.pvp)}">${fmtMult(f.pvp)}</span>
          <span class="d-mult-sub">VPA: ${fmtReal(f.vpa)}</span>
        </div>
        <div class="d-mult-card" data-tip="Valor da Firma (EV) dividido pelo EBITDA de 12 meses (não aplicável a bancos).">
          <span class="d-mult-label">EV/EBITDA</span>
          <span class="d-mult-val ${valido(f.ev_ebitda) ? (f.ev_ebitda <= 8 ? 't-green' : (f.ev_ebitda > 12 ? 't-yellow' : '')) : 't-dim'}">${ehBanco ? 'N/A' : fmtMult(f.ev_ebitda)}</span>
          <span class="d-mult-sub">EV/EBIT: ${ehBanco ? 'N/A' : fmtMult(f.ev_ebit)}</span>
        </div>
        <div class="d-mult-card" data-tip="Dividend Yield dos últimos 12 meses e Payout estimado (DPA 5a ÷ LPA).">
          <span class="d-mult-label">DY (12m)</span>
          <span class="d-mult-val ${valido(f.dy_12m) && f.dy_12m >= 0.06 ? 't-green' : ''}">${fmtPctSimples(f.dy_12m)}</span>
          <span class="d-mult-sub">Payout: ${fmtPctSimples(f.payout, 0)}</span>
        </div>
      </div>
    </div>

    <div class="d-block">
      <div class="d-section-title">Qualidade &amp; Rentabilidade</div>
      <dl class="kv">
        <dt data-tip="Retorno sobre o Patrimônio Líquido (Lucro Líquido ÷ PL). Acima de 15% destaca alta rentabilidade.">ROE (Retorno s/ Patrimônio)</dt>
        <dd class="${classeRoe(f.roe)}">${fmtPctSimples(f.roe)}</dd>
        <dt data-tip="Retorno sobre o Capital Investido (EBIT ÷ Capital Investido). Não aplicável a bancos.">ROIC (Retorno s/ Cap. Investido)</dt>
        <dd class="${ehBanco ? 't-dim' : classeRoic(f.roic)}">${ehBanco ? 'N/A (Banco)' : fmtPctSimples(f.roic)}</dd>
        <div class="sep"></div>
        <dt>Margem EBIT (Operacional)</dt>
        <dd>${ehBanco ? 'N/A (Banco)' : fmtPctSimples(f.margem_ebit)}</dd>
        <dt>Margem Líquida</dt>
        <dd>${ehBanco ? 'N/A (Banco)' : fmtPctSimples(f.margem_liquida)}</dd>
        <dt>Crescimento de Receita (5a)</dt>
        <dd class="${valido(f.cresc_receita_5a) ? (f.cresc_receita_5a > 0 ? 't-green' : 't-red') : 't-dim'}">${fmtPct(f.cresc_receita_5a)}</dd>
      </dl>
    </div>

    <div class="d-block">
      <div class="d-section-title">Endividamento &amp; Liquidez (Saúde Financeira)</div>
      ${ehBanco ? `
        <p class="d-note" style="margin-bottom:10px">Instituições bancárias captam depósitos como parte da operação; por isso múltiplos de Dívida Líquida/EBITDA não se aplicam.</p>
        <dl class="kv">
          <dt>Liquidez Diária Média (2m)</dt><dd>${fmtMoedaCompacta(f.liquidez_diaria)}</dd>
        </dl>
      ` : `
        <dl class="kv">
          <dt data-tip="Quantos anos de geração de caixa operacional (EBITDA) seriam necessários para quitar a dívida líquida. Até 2,5x é considerado saudável.">Dívida Líquida / EBITDA</dt>
          <dd class="${classeAlavancagem(f.div_liq_ebitda, 2.5, 3.5)}">${valido(f.div_liq_ebitda) ? (f.div_liq_ebitda < 0 ? `${fmtMult(f.div_liq_ebitda)} (Caixa Líq.)` : fmtMult(f.div_liq_ebitda)) : '—'}</dd>
          <dt data-tip="Dívida Líquida dividida pelo EBIT de 12 meses.">Dívida Líquida / EBIT</dt>
          <dd class="${classeAlavancagem(f.div_liq_ebit, 3.0, 4.0)}">${fmtMult(f.div_liq_ebit)}</dd>
          <dt data-tip="Dívida Líquida sobre o Patrimônio Líquido.">Dívida Líquida / Patrimônio</dt>
          <dd class="${classeAlavancagem(f.div_liq_patrim, 1.0, 2.0)}">${fmtMult(f.div_liq_patrim)}</dd>
          <div class="sep"></div>
          <dt data-tip="Ativo Circulante dividido pelo Passivo Circulante. Acima de 1,0x indica folga de caixa no curto prazo.">Liquidez Corrente</dt>
          <dd class="${valido(f.liquidez_corrente) ? (f.liquidez_corrente >= 1.2 ? 't-green' : (f.liquidez_corrente >= 1.0 ? 't-yellow' : 't-red')) : 't-dim'}">${fmtMult(f.liquidez_corrente)}</dd>
          <dt data-tip="Volume financeiro médio negociado por dia nos últimos 2 meses.">Liquidez Diária Média (2m)</dt>
          <dd>${fmtMoedaCompacta(f.liquidez_diaria)}</dd>
        </dl>
      `}
    </div>

    <div class="d-block">
      <div class="d-section-title">Modelos complementares</div>
      <dl class="kv">
        <dt>Graham (valor intrínseco)</dt><dd>${fmtReal(a.graham)}</dd>
        <dt>Margem Graham</dt><dd class="${classeMargem(a.margem_graham)}">${fmtPct(a.margem_graham)}</dd>
        <div class="sep"></div>
        <dt>Gordon (preço justo)</dt><dd>${fmtReal(a.gordon)}</dd>
        <dt>Margem Gordon</dt><dd class="${classeMargem(a.margem_gordon)}">${fmtPct(a.margem_gordon)}</dd>
        <div class="sep"></div>
        <dt>Greenblatt</dt><dd style="white-space:normal;max-width:220px">${esc(greenblatt)}</dd>
      </dl>
    </div>

    <div class="d-block">
      <div class="d-section-title">Datas de Referência dos Dados</div>
      <dl class="kv">
        <dt>Última atualização do painel</dt><dd>${esc(geradoStr)}</dd>
        <dt>Data da última cotação (B3)</dt><dd>${esc(a.data_ult_cot || f.data_ult_cot || '—')}</dd>
        <dt>Último balanço processado (CVM)</dt><dd>${esc(a.ult_balanco || f.ult_balanco || '—')}</dd>
      </dl>
    </div>

    <p class="d-note">Graham é referência secundária para financeiras e holdings. O veredito considera somente a margem Bazin, calculada pelo motor com o teto no denominador.</p>

    <div class="d-actions">
      <a class="btn btn-primary" href="${linkInv10}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">
        Investidor10 ↗
      </a>
      <button type="button" class="btn ${noPainel ? 'btn-ghost btn-danger' : 'btn-ghost'}" data-detail-toggle="${esc(a.ticker)}">
        ${noPainel ? 'Remover do painel' : 'Adicionar ao painel'}
      </button>
      <a class="btn btn-ghost" href="./CalculadoraBazin.html" style="text-decoration:none">Abrir calculadora</a>
    </div>
  `;
}

/* ---------- Gavetas ---------- */

function abrirGaveta(id) {
  fecharGavetas();
  $('#overlay').classList.remove('is-hidden');
  $(id).classList.remove('is-hidden');
  document.body.classList.add('no-scroll');
  esconderTooltip();
}

function fecharGavetas() {
  $('#overlay')?.classList.add('is-hidden');
  document.querySelectorAll('.drawer').forEach(d => d.classList.add('is-hidden'));
  document.body.classList.remove('no-scroll');
  painelState.detalheTicker = null;
}

function abrirSeletor() {
  renderizarUniverso();
  abrirGaveta('#selector-drawer');
  if (window.matchMedia('(hover: hover)').matches) setTimeout(() => $('#input-search-universe')?.focus(), 50);
}

function abrirDetalhe(ticker) {
  renderizarDetalhe(ticker);
  abrirGaveta('#detail-drawer');
}

/* ---------- Tooltip ---------- */

let tooltipAlvo = null;

function mostrarTooltip(alvo) {
  const tip = $('#tooltip');
  const texto = alvo.getAttribute('data-tip');
  if (!tip || !texto) return;
  tooltipAlvo = alvo;
  tip.textContent = texto;
  tip.classList.add('is-visible');
  const r = alvo.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let top = r.top - t.height - 8;
  if (top < 8) top = r.bottom + 8;
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

function esconderTooltip() {
  tooltipAlvo = null;
  $('#tooltip')?.classList.remove('is-visible');
}

/* ---------- Ações ---------- */

function renderizarTudo() {
  renderizarKpis();
  renderizarBesst();
  renderizarTabela();
  if (!$('#selector-drawer').classList.contains('is-hidden')) renderizarUniverso();
  if (painelState.detalheTicker) renderizarDetalhe(painelState.detalheTicker);
}

function alternarTicker(ticker) {
  const clean = String(ticker || '').trim().toUpperCase();
  if (!clean) return;
  const lista = [...painelState.selecionados];
  const idx = lista.findIndex(t => t.toUpperCase() === clean);
  if (idx >= 0) lista.splice(idx, 1); else lista.push(clean);
  salvarSelecionados(lista);
  renderizarTudo();
}

function adicionarPorBusca() {
  const input = $('#input-search-universe');
  const val = (input?.value || '').trim().toUpperCase();
  if (!val) return;
  if (!mapaUniverso().has(val)) {
    feedback(`"${val}" não consta em ./data/valuation.json.`, true);
    return;
  }
  if (painelState.selecionados.some(t => t.toUpperCase() === val)) {
    feedback(`${val} já está no painel.`, false);
  } else {
    salvarSelecionados([...painelState.selecionados, val]);
    feedback(`${val} adicionado ao painel.`, false);
  }
  input.value = '';
  renderizarTudo();
}

function feedback(msg, erro) {
  const el = $('#search-universe-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `feedback ${erro ? 'err' : 'ok'}`;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3500);
}

function selecionarPor(filtro) {
  salvarSelecionados(painelState.universo.filter(filtro).map(a => a.ticker.toUpperCase()));
  renderizarTudo();
}

function alternarGrupo(grupoId, remover) {
  const filtro = grupoId === 'outros' ? (a => !mapearSetorBesst(a.setor)) : (a => mapearSetorBesst(a.setor) === grupoId);
  const tickers = painelState.universo.filter(filtro).map(a => a.ticker.toUpperCase());
  const atual = new Set(painelState.selecionados.map(t => t.toUpperCase()));
  tickers.forEach(t => remover ? atual.delete(t) : atual.add(t));
  salvarSelecionados([...atual]);
  renderizarTudo();
}

function definirFiltroSetor(id) {
  painelState.filtroSetor = painelState.filtroSetor === id ? 'todos' : id;
  renderizarBesst();
  renderizarTabela();
}

function definirFiltroVeredito(v) {
  painelState.filtroVeredito = v;
  document.querySelectorAll('#verdict-filter .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.verdict === v));
  renderizarTabela();
}

function definirOrdenacao(key, dir) {
  if (!dir) {
    const mesmo = painelState.sort.key === key;
    const padraoAsc = key === 'ticker' || key === 'greenblatt' || key === 'veredito';
    dir = mesmo ? (painelState.sort.dir === 'asc' ? 'desc' : 'asc') : (padraoAsc ? 'asc' : 'desc');
  }
  painelState.sort = { key, dir };
  gravarStorage(STORAGE_KEY_PAINEL_SORT, painelState.sort);
  renderizarTabela();
}

function limparFiltros() {
  painelState.filtroSetor = 'todos';
  painelState.termo = '';
  const input = $('#input-filter-table');
  if (input) input.value = '';
  definirFiltroVeredito('todos');
  renderizarBesst();
}

/* ---------- Erro e carga ---------- */

function exibirErro(msg) {
  const banner = $('#engine-error-banner');
  if (banner) {
    banner.textContent = `Não foi possível carregar ./data/valuation.json: ${msg}. Verifique sua conexão ou gere a base com "python -m engine.build".`;
    banner.classList.remove('is-hidden');
  }
  renderizarStatus('is-error', 'Base indisponível');
  const tbody = $('#engine-valuation-tbody');
  if (tbody) tbody.innerHTML = `<tr class="row-empty"><td colspan="10" class="empty"><strong>Dados indisponíveis</strong>${esc(msg)}</td></tr>`;
}

const URL_VALUATION_REMOTO = 'https://raw.githubusercontent.com/ezdourado/invest/main/data/valuation.json';

async function buscarJsonComCacheBust(urlBase) {
  const sep = urlBase.includes('?') ? '&' : '?';
  const resp = await fetch(`${urlBase}${sep}t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}`);
  const json = await resp.json();
  if (!json || !Array.isArray(json.ativos)) throw new Error('formato inválido (lista "ativos" ausente)');
  return json;
}

async function obterPayloadMaisRecente() {
  const resultados = await Promise.allSettled([
    buscarJsonComCacheBust('./data/valuation.json'),
    buscarJsonComCacheBust(URL_VALUATION_REMOTO)
  ]);

  const validos = resultados
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (!validos.length) {
    const primeiroErro = resultados.find(r => r.status === 'rejected')?.reason;
    throw primeiroErro || new Error('Nenhuma fonte de valuation respondeu');
  }

  validos.sort((a, b) => {
    const ta = new Date(a.gerado_em || 0).getTime() || 0;
    const tb = new Date(b.gerado_em || 0).getTime() || 0;
    return tb - ta;
  });

  return validos[0];
}

async function carregarValuationJson(silencioso = false) {
  try {
    const payload = await obterPayloadMaisRecente();

    painelState.payload = payload;
    painelState.universo = payload.ativos;
    const mapa = mapaUniverso();
    painelState.selecionados = lerStorage(STORAGE_KEY_PAINEL_TICKERS, [])
      .filter(t => typeof t === 'string' && mapa.has(t.toUpperCase()));

    if (!silencioso) {
      // Link compartilhável: index.html#t=BBAS3,TAEE4 substitui a seleção salva
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (hash.get('t')) {
        const doLink = hash.get('t').split(',').map(t => t.trim().toUpperCase()).filter(t => mapa.has(t));
        if (doLink.length) salvarSelecionados(doLink);
      }
      atualizarStatusBase();
      renderizarTudo();
      if (hash.get('d') && mapa.has(hash.get('d').toUpperCase())) abrirDetalhe(hash.get('d'));
    } else {
      atualizarStatusBase();
      renderizarTudo();
    }
  } catch (err) {
    if (!silencioso) {
      const msg = err instanceof TypeError ? 'falha de rede' : (err.message || 'erro desconhecido');
      exibirErro(msg);
    }
  }
}

/* ---------- Eventos ---------- */

function bindEventos() {
  const sortSel = $('#select-sort-mobile');
  if (sortSel) {
    sortSel.innerHTML = OPCOES_ORDENACAO.map((o, i) => `<option value="${i}">${o.label}</option>`).join('');
    sortSel.addEventListener('change', () => {
      const o = OPCOES_ORDENACAO[Number(sortSel.value)];
      if (o) definirOrdenacao(o.key, o.dir);
    });
  }

  $('#btn-open-selector')?.addEventListener('click', abrirSeletor);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-drawer]')) fecharGavetas();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharGavetas();
  });

  $('#input-filter-table')?.addEventListener('input', (e) => {
    painelState.termo = e.target.value;
    renderizarTabela();
  });

  $('#verdict-filter')?.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) definirFiltroVeredito(b.dataset.verdict);
  });

  $('#besst-coverage-grid')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sector]');
    if (b) definirFiltroSetor(b.dataset.sector);
  });

  $('#kpi-grid')?.addEventListener('click', (e) => {
    const v = e.target.closest('[data-kpi-verdict]');
    if (v) {
      const alvo = v.dataset.kpiVerdict;
      definirFiltroVeredito(painelState.filtroVeredito === alvo ? 'todos' : alvo);
      return;
    }
    const d = e.target.closest('[data-kpi-detail]');
    if (d) abrirDetalhe(d.dataset.kpiDetail);
  });

  $('#active-filters')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear-filter]');
    if (!b) return;
    const tipo = b.dataset.clearFilter;
    if (tipo === 'setor') { painelState.filtroSetor = 'todos'; renderizarBesst(); renderizarTabela(); }
    if (tipo === 'veredito') definirFiltroVeredito('todos');
    if (tipo === 'termo') { painelState.termo = ''; $('#input-filter-table').value = ''; renderizarTabela(); }
  });

  document.querySelector('.vt thead')?.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) definirOrdenacao(th.dataset.sort);
  });

  const tbody = $('#engine-valuation-tbody');
  tbody?.addEventListener('click', (e) => {
    const acao = e.target.closest('[data-row-action]');
    const linha = e.target.closest('tr.row');
    const vazio = e.target.closest('[data-empty-action]');
    if (vazio) {
      const t = vazio.dataset.emptyAction;
      if (t === 'open') abrirSeletor();
      if (t === 'besst') selecionarPor(a => !!a.besst);
      if (t === 'todos') selecionarPor(() => true);
      if (t === 'limpar-filtros') limparFiltros();
      return;
    }
    if (!linha) return;
    if (acao?.dataset.rowAction === 'ext') return;
    if (acao?.dataset.rowAction === 'remove') { alternarTicker(linha.dataset.ticker); return; }
    abrirDetalhe(linha.dataset.ticker);
  });
  tbody?.addEventListener('keydown', (e) => {
    const linha = e.target.closest('tr.row');
    if (linha && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirDetalhe(linha.dataset.ticker); }
  });

  const busca = $('#input-search-universe');
  busca?.addEventListener('input', renderizarUniverso);
  busca?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarPorBusca(); }
  });
  $('#btn-select-besst-universe')?.addEventListener('click', () => selecionarPor(a => !!a.besst));
  $('#btn-select-green-universe')?.addEventListener('click', () => selecionarPor(a => a.bazin?.veredito === 'verde'));
  $('#btn-select-all-universe')?.addEventListener('click', () => selecionarPor(() => true));
  $('#btn-clear-universe')?.addEventListener('click', () => { salvarSelecionados([]); renderizarTudo(); });
  $('#universe-chips-list')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-toggle-ticker]');
    if (chip) { alternarTicker(chip.dataset.toggleTicker); return; }
    const grupo = e.target.closest('[data-group-toggle]');
    if (grupo) alternarGrupo(grupo.dataset.groupToggle, grupo.dataset.on === '1');
  });

  $('#detail-body')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-detail-toggle]');
    if (b) alternarTicker(b.dataset.detailToggle);
  });

  $('#status-pill')?.addEventListener('click', () => {
    const el = $('#status-text');
    if (el) el.textContent = 'Sincronizando base…';
    carregarValuationJson(true);
  });

  document.addEventListener('mouseover', (e) => {
    const alvo = e.target.closest('[data-tip]');
    if (alvo && alvo !== tooltipAlvo) mostrarTooltip(alvo);
    else if (!alvo && tooltipAlvo) esconderTooltip();
  });
  window.addEventListener('scroll', esconderTooltip, { passive: true });
}

window.addEventListener('DOMContentLoaded', () => {
  const sortSalvo = lerStorage(STORAGE_KEY_PAINEL_SORT, null);
  if (sortSalvo?.key && sortSalvo?.dir) painelState.sort = sortSalvo;
  bindEventos();
  carregarValuationJson();
  // Consulta silenciosamente a base a cada 60 segundos enquanto o painel estiver aberto
  setInterval(() => {
    if (!document.hidden) carregarValuationJson(true);
  }, 60000);
  // Atualiza o contador relativo ("há X min") a cada 30 segundos
  setInterval(() => {
    if (!document.hidden && painelState.payload) atualizarStatusBase();
  }, 30000);
});
