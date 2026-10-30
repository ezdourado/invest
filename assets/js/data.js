/* Painel Executivo de Valuation · leitor e controlador principal (./data/valuation.json)
 * Somente leitura e apresentação: nenhum cálculo de valuation é refeito no cliente.
 */

const STORAGE_KEY_PAINEL_TICKERS = 'painel_valuation_selected_tickers';
const STORAGE_KEY_PAINEL_SORT = 'painel_valuation_sort';
const STORAGE_KEY_PAINEL_DENSITY = 'painel_valuation_density';
const STORAGE_KEY_THEME = 'painel_valuation_theme';
const DIAS_BASE_DESATUALIZADA = 3;

const CARTEIRA_EXECUTIVA_PADRAO = [
  'BBAS3', 'ITUB4', 'TAEE11', 'CPFE3', 'EGIE3', 'SBSP3',
  'BBSE3', 'CXSE3', 'VIVT3', 'ISAE4', 'SAPR11', 'CMIG4',
  'VALE3', 'PETR4', 'WEGE3'
];

const SETORES_BESST = [
  { id: 'bancos', letra: 'B', nome: 'Bancos' },
  { id: 'energia', letra: 'E', nome: 'Energia' },
  { id: 'saneamento', letra: 'S', nome: 'Saneamento' },
  { id: 'seguros', letra: 'S', nome: 'Seguros' },
  { id: 'telecom', letra: 'T', nome: 'Telecom' }
];

const CATEGORIAS_EXTRAS = [
  { id: 'dividendos', letra: 'D', nome: 'Outras Dividendos', desc: 'Commodities, indústria e finanças fora do BESST' },
  { id: 'demais', letra: '+', nome: 'Demais papéis', desc: 'Crescimento, consumo, saúde, tecnologia e outros setores' }
];

const ORDEM_VEREDITO = { verde: 0, amarelo: 1, vermelho: 2 };
const ROTULO_VEREDITO = {
  verde: 'Abaixo do teto',
  amarelo: 'Próximo do teto',
  vermelho: 'Acima do teto'
};
const ICONE_VEREDITO = {
  verde: '▲',
  amarelo: '●',
  vermelho: '▼'
};

const OPCOES_ORDENACAO = [
  { key: 'margem', dir: 'desc', label: 'Maior margem Bazin' },
  { key: 'faltateto', dir: 'desc', label: 'Maior folga até o teto (R$)' },
  { key: 'sustentabilidade', dir: 'desc', label: 'Maior Score Anti-Cilada' },
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
  densidade: 'confortavel',
  detalheTicker: null,
  ultimoGatilhoFoco: null,
  modoApresentacao: false
};

/* ---------- Folha de Estilo Dinâmica (Zero Inline Styles no DOM) ---------- */

const dynamicStyleEl = document.createElement('style');
dynamicStyleEl.id = 'painel-dynamic-rules';
document.head.appendChild(dynamicStyleEl);
const dynamicRulesMap = new Map();

function definirRegraCssDinamica(seletor, declaracoes) {
  dynamicRulesMap.set(seletor, declaracoes);
  let cssTexto = '';
  dynamicRulesMap.forEach((decl, sel) => {
    cssTexto += `${sel} { ${decl} }\n`;
  });
  dynamicStyleEl.textContent = cssTexto;
}
window.definirRegraCssDinamica = definirRegraCssDinamica;

/* ---------- Utilidades de Formatação e Datas (America/Sao_Paulo) ---------- */

const $ = (sel) => document.querySelector(sel);

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function valido(v) {
  return v !== null && v !== undefined && typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
}

function fmtReal(v) {
  if (!valido(v)) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRealSinal(v) {
  if (!valido(v)) return '—';
  const sinal = v > 0 ? '+' : (v < 0 ? '−' : '');
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sinal}R$ ${abs}`;
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

function debounce(fn, espera = 150) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), espera);
  };
}
window.debounce = debounce;

/* Parser local seguro para 'YYYY-MM-DD' sem deslocamento de fuso UTC */
function parseDataLocalIso(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

function fmtDataIso(iso) {
  const p = parseDataLocalIso(iso);
  if (!p) return iso || '—';
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

function fmtDataCurtaBr(strData) {
  if (!strData || typeof strData !== 'string') return '';
  const mIso = strData.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return `${mIso[3]}/${mIso[2]}`;
  const mBr = strData.trim().match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/);
  if (mBr) return `${mBr[1]}/${mBr[2]}`;
  return strData;
}

function formatarDataHoraSaoPaulo(isoUtc) {
  if (!isoUtc) return { dataCurta: '—', dataCompleta: '—', hora: '—', dateObj: null };
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) {
    return { dataCurta: String(isoUtc), dataCompleta: String(isoUtc), hora: '', dateObj: null };
  }
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(dt);
    const map = {};
    partes.forEach(p => { map[p.type] = p.value; });
    return {
      dataCurta: `${map.day}/${map.month}`,
      dataCompleta: `${map.day}/${map.month}/${map.year}`,
      hora: `${map.hour}:${map.minute}`,
      dateObj: dt
    };
  } catch (_) {
    return {
      dataCurta: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      dataCompleta: dt.toLocaleDateString('pt-BR'),
      hora: dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      dateObj: dt
    };
  }
}
window.formatarDataHoraSaoPaulo = formatarDataHoraSaoPaulo;

function obterDataRealUltimaCotacao(universo) {
  if (!Array.isArray(universo) || !universo.length) return '';
  const freq = new Map();
  universo.forEach(a => {
    const d = a.data_ult_cot || a.fundamentos?.data_ult_cot;
    if (d) freq.set(d, (freq.get(d) || 0) + 1);
  });
  let melhor = '';
  let maxCount = 0;
  freq.forEach((cnt, dtStr) => {
    if (cnt > maxCount) {
      maxCount = cnt;
      melhor = dtStr;
    }
  });
  return melhor;
}
window.obterDataRealUltimaCotacao = obterDataRealUltimaCotacao;

function hojeIsoSaoPaulo() {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    partes.forEach(p => { map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_) {
    return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
}
window.hojeIsoSaoPaulo = hojeIsoSaoPaulo;

function diasAteDataIsoB3(isoAlvo) {
  const pAlvo = parseDataLocalIso(isoAlvo);
  const pHoje = parseDataLocalIso(hojeIsoSaoPaulo());
  if (!pAlvo || !pHoje) return null;
  const tAlvo = Date.UTC(pAlvo.ano, pAlvo.mes - 1, pAlvo.dia);
  const tHoje = Date.UTC(pHoje.ano, pHoje.mes - 1, pHoje.dia);
  return Math.round((tAlvo - tHoje) / 86400000);
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

function categoriaDoAtivo(a) {
  if (!a) return 'dividendos';
  if (a.categoria === 'demais') return 'demais';
  if (a.besst || mapearSetorBesst(a.setor)) return 'besst';
  return 'dividendos';
}

function nomeSetor(id) {
  if (id === 'besst') return 'Somente BESST';
  if (id === 'dividendos') return 'Outras Dividendos';
  if (id === 'demais') return 'Demais papéis';
  if (id === 'outros') return 'Fora do BESST';
  return SETORES_BESST.find(s => s.id === id)?.nome || id;
}

function mediana(lista) {
  const v = lista.filter(valido).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function razaoDpaPreco(a) {
  const dpa = a.bazin?.dpa_sem_extra;
  return valido(dpa) && a.preco > 0 ? dpa / a.preco : null;
}

function diferencaAteTeto(a) {
  const teto = a?.bazin?.teto;
  if (!valido(teto) || teto <= 0 || !valido(a?.preco)) return null;
  return teto - a.preco;
}

/* ---------- Persistência & Tema ---------- */

function lerStorage(chave, padrao) {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch (_) {
    return padrao;
  }
}

function gravarStorage(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (_) { /* modo privado */ }
}

function inicializarTema() {
  let tema = 'dark';
  try {
    const salvo = localStorage.getItem(STORAGE_KEY_THEME);
    if (salvo === 'light' || salvo === 'dark') {
      tema = salvo;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      tema = 'light';
    }
  } catch (_) {
    tema = 'dark';
  }
  aplicarTema(tema, false);
}

function aplicarTema(tema, persistir = true) {
  const ehLight = tema === 'light';
  if (ehLight) {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const btn = $('#btn-toggle-theme');
  if (btn) {
    btn.setAttribute('aria-pressed', String(ehLight));
    btn.setAttribute('data-tip', ehLight ? 'Alternar para tema escuro' : 'Alternar para tema claro');
  }
  if (persistir) {
    try { localStorage.setItem(STORAGE_KEY_THEME, ehLight ? 'light' : 'dark'); } catch (_) { /* modo privado */ }
  }
}

function alternarTema() {
  const atual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  aplicarTema(atual === 'light' ? 'dark' : 'light', true);
}

function salvarSelecionados(lista) {
  painelState.selecionados = lista;
  gravarStorage(STORAGE_KEY_PAINEL_TICKERS, lista);
}

/* ---------- Seleção, Filtros e Ordenação ---------- */

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
  if (f === 'besst') return categoriaDoAtivo(a) === 'besst';
  if (f === 'dividendos') return categoriaDoAtivo(a) === 'dividendos';
  if (f === 'demais') return categoriaDoAtivo(a) === 'demais';
  if (f === 'outros') return categoriaDoAtivo(a) !== 'besst';
  return mapearSetorBesst(a.setor) === f;
}

function valorOrdenacao(a, key) {
  switch (key) {
    case 'ticker': return a.ticker;
    case 'preco': return a.preco;
    case 'dpa': return a.bazin?.dpa_sem_extra;
    case 'teto': return a.bazin?.teto > 0 ? a.bazin.teto : null;
    case 'faltateto': return diferencaAteTeto(a);
    case 'margem': return a.bazin?.teto > 0 ? a.bazin?.margem_seguranca : null;
    case 'veredito': return ORDEM_VEREDITO[a.bazin?.veredito] ?? 9;
    case 'sustentabilidade': return a.sustentabilidade?.nivel === 'sem_dividendo' ? -1 : a.sustentabilidade?.nota;
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
    if (na) return 1;
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
    if (q && !a.ticker.toLowerCase().includes(q) && !a.setor.toLowerCase().includes(q) && !(a.empresa || '').toLowerCase().includes(q)) return false;
    return true;
  });
  return ordenar(lista);
}

/* ---------- Render: Status & Rodapé ---------- */

function renderizarStatus(estado, htmlTexto) {
  const pill = $('#status-pill');
  if (!pill) return;
  pill.classList.remove('is-ok', 'is-stale', 'is-error');
  pill.classList.add(estado);
  const elTxt = $('#status-text');
  if (elTxt) elTxt.innerHTML = htmlTexto;
}

function atualizarStatusBase() {
  const p = painelState.payload;
  if (!p?.gerado_em) return;

  const infoGerado = formatarDataHoraSaoPaulo(p.gerado_em);
  const dataUltCotRaw = obterDataRealUltimaCotacao(painelState.universo);
  const dataCotCurta = fmtDataCurtaBr(dataUltCotRaw) || infoGerado.dataCurta;

  const dias = infoGerado.dateObj ? (Date.now() - infoGerado.dateObj.getTime()) / 86400000 : 0;
  const estado = dias > DIAS_BASE_DESATUALIZADA ? 'is-stale' : 'is-ok';

  renderizarStatus(
    estado,
    `Cotações de <strong class="mono">${esc(dataCotCurta)}</strong> (fechamento)<span class="status-sep">·</span>Base gerada em <span class="mono">${esc(infoGerado.dataCurta)} ${esc(infoGerado.hora)}</span>`
  );

  const foot = $('#main-footer');
  if (foot) {
    const dataCompleta = dataUltCotRaw && dataUltCotRaw.includes('/') ? dataUltCotRaw : infoGerado.dataCompleta;
    foot.textContent = `Dados de mercado e proventos · Base atualizada em ${dataCompleta} · Conteúdo informativo, não constitui recomendação de investimento.`;
  }
}

/* ---------- Render: Faixa de Resumo Executivo (4 Indicadores) ---------- */

function renderizarKpis() {
  const el = $('#kpi-grid');
  if (!el) return;
  const sel = ativosSelecionados();
  const total = sel.length;
  const cont = { verde: 0, amarelo: 0, vermelho: 0 };
  sel.forEach(a => {
    if (cont[a.bazin?.veredito] !== undefined) cont[a.bazin.veredito] += 1;
  });

  const comBazin = sel.filter(a => valido(a.bazin?.margem_seguranca) && a.bazin?.teto > 0);
  const medMargem = mediana(comBazin.map(a => a.bazin.margem_seguranca));
  const ordenadosMargem = [...comBazin].sort((a, b) => b.bazin.margem_seguranca - a.bazin.margem_seguranca);
  const melhor = ordenadosMargem[0] || null;
  const pior = ordenadosMargem.length ? ordenadosMargem[ordenadosMargem.length - 1] : null;
  const pctCompra = total ? Math.round((cont.verde / total) * 100) : 0;

  el.innerHTML = `
    <div class="kpi is-clickable" data-kpi-verdict="verde" data-tip="Clique para filtrar apenas os papéis negociados abaixo do preço-teto Bazin">
      <div class="kpi-label">
        <span>Em zona de compra</span>
        <span class="verdict verdict-verde"><span class="verdict-icon" aria-hidden="true">▲</span>${pctCompra}%</span>
      </div>
      <div class="kpi-value t-green">${cont.verde}<span class="kpi-value-sub">de ${total} papéis</span></div>
      <div class="kpi-foot">${cont.amarelo} próximos do teto · ${cont.vermelho} acima do teto</div>
    </div>

    <div class="kpi ${melhor ? 'is-clickable' : ''}" ${melhor ? `data-kpi-detail="${esc(melhor.ticker)}"` : ''} data-tip="Ativo selecionado com a maior margem de segurança Bazin. Clique para abrir o Raio-X.">
      <div class="kpi-label">
        <span>Melhor oportunidade</span>
        ${melhor ? `<span class="mono t-green">${fmtPct(melhor.bazin.margem_seguranca)}</span>` : ''}
      </div>
      <div class="kpi-value">${melhor ? esc(melhor.ticker) : '—'}</div>
      <div class="kpi-foot">${melhor ? `Preço ${fmtReal(melhor.preco)} vs. Teto ${fmtReal(melhor.bazin.teto)}` : 'Selecione ativos para comparar'}</div>
    </div>

    <div class="kpi" data-tip="Mediana da margem de segurança Bazin = (Teto − Preço) ÷ Teto entre os papéis com teto Bazin calculado">
      <div class="kpi-label"><span>Margem Bazin mediana</span></div>
      <div class="kpi-value ${classeMargem(medMargem)}">${fmtPct(medMargem)}</div>
      <div class="kpi-foot">${comBazin.length} de ${total} papéis com DPA 5a recorrente</div>
    </div>

    <div class="kpi ${pior ? 'is-clickable' : ''}" ${pior ? `data-kpi-detail="${esc(pior.ticker)}"` : ''} data-tip="Ativo selecionado mais distante acima do preço-teto Bazin. Clique para abrir o Raio-X.">
      <div class="kpi-label">
        <span>Maior risco / mais caro</span>
        ${pior ? `<span class="mono ${classeMargem(pior.bazin.margem_seguranca)}">${fmtPct(pior.bazin.margem_seguranca)}</span>` : ''}
      </div>
      <div class="kpi-value">${pior ? esc(pior.ticker) : '—'}</div>
      <div class="kpi-foot">${pior ? `Preço ${fmtReal(pior.preco)} vs. Teto ${fmtReal(pior.bazin.teto)}` : 'Sem dados no painel'}</div>
    </div>
  `;
}

/* ---------- Render: Faixa Fina de Chips Setoriais (BESST & Categorias) ---------- */

function classePontoPredominante(itens) {
  if (!itens.length) return 'dot-dim';
  const cont = { verde: 0, amarelo: 0, vermelho: 0 };
  itens.forEach(a => {
    if (cont[a.bazin?.veredito] !== undefined) cont[a.bazin.veredito] += 1;
  });
  if (cont.verde >= cont.amarelo && cont.verde >= cont.vermelho && cont.verde > 0) return 'dot-green';
  if (cont.amarelo >= cont.vermelho && cont.amarelo > 0) return 'dot-yellow';
  return 'dot-red';
}

function renderizarBesst() {
  const el = $('#besst-coverage-grid');
  const elExtra = $('#extra-categories-grid');
  const sel = ativosSelecionados();

  if (el) {
    el.innerHTML = SETORES_BESST.map(setor => {
      const itens = sel.filter(a => mapearSetorBesst(a.setor) === setor.id && categoriaDoAtivo(a) === 'besst');
      const n = itens.length;
      const dotCls = classePontoPredominante(itens);
      const ativo = painelState.filtroSetor === setor.id;
      const tip = n
        ? `${setor.nome}: ${itens.map(a => a.ticker).join(', ')}`
        : `${setor.nome}: nenhum papel selecionado no painel`;

      return `
        <button type="button" class="besst-item ${n ? '' : 'is-empty'} ${ativo ? 'is-active' : ''}" data-sector="${setor.id}" data-tip="${esc(tip)}" aria-pressed="${ativo}">
          <span class="dot ${dotCls}" aria-hidden="true"></span>
          <span class="besst-name">${esc(setor.nome)}</span>
          <span class="besst-count">${n}</span>
        </button>
      `;
    }).join('');
  }

  if (elExtra) {
    elExtra.innerHTML = CATEGORIAS_EXTRAS.map(cat => {
      const itens = sel.filter(a => categoriaDoAtivo(a) === cat.id);
      const n = itens.length;
      const dotCls = classePontoPredominante(itens);
      const ativo = painelState.filtroSetor === cat.id;
      const tip = n
        ? `${cat.nome}: ${itens.slice(0, 12).map(a => a.ticker).join(', ')}${itens.length > 12 ? '…' : ''}`
        : `${cat.nome}: nenhum papel selecionado no painel`;

      return `
        <button type="button" class="besst-item ${n ? '' : 'is-empty'} ${ativo ? 'is-active' : ''}" data-sector="${cat.id}" data-tip="${esc(tip)}" aria-pressed="${ativo}">
          <span class="dot ${dotCls}" aria-hidden="true"></span>
          <span class="besst-name">${esc(cat.nome)}</span>
          <span class="besst-count">${n}</span>
        </button>
      `;
    }).join('');
  }
}

/* ---------- Render: Tabela Principal de Valuation (11 Colunas) ---------- */

const MESES_ABREV_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function fmtRealProvento(v) {
  if (!valido(v)) return '—';
  const casas = v < 0.1 ? 4 : 2;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
}

function rotuloTipoProvento(tipo) {
  if (tipo === 'jcp') return 'JCP';
  if (tipo === 'dividendo') return 'Dividendo';
  if (tipo === 'misto') return 'Dividendo + JCP';
  if (tipo === 'extraordinario') return 'Extraordinário';
  return 'Provento';
}

/* Selo compacto usado em cabeçalhos e cards secundários */
function htmlSustentabilidade(a, compacto = false) {
  const s = a?.sustentabilidade;
  if (!s || s.nivel === 'sem_dividendo') {
    return `<span class="sust-badge sust-nd" data-tip="Sem proventos recorrentes nos últimos 5 anos fechados">Sem Divid.</span>`;
  }
  const ehRisco = s.nivel === 'alerta' || s.nota < 50;
  const cls = ehRisco ? 'sust-alerta' : '';
  const resumoPilares = Array.isArray(s.pilares)
    ? s.pilares.map(p => `${p.nome}: ${p.detalhe}`).join(' · ')
    : '';
  const tip = `Score Anti-Cilada: ${s.nota}/100 (${s.rotulo}) — ${resumoPilares}`;
  const icone = ehRisco ? '⚠ ' : '';
  const label = compacto
    ? `${icone}${s.nota}/100`
    : (ehRisco ? `⚠ ${s.nota} · Risco Cilada` : `${s.nota}/100 · ${s.rotulo}`);
  return `<span class="sust-badge ${cls}" data-tip="${esc(tip)}">${esc(label)}</span>`;
}

/* Coluna 4A da Tabela: número + mini-barra (0–100) em escala neutra; cor semântica só p/ <50 */
function htmlSustentabilidadeTabela(a) {
  const s = a?.sustentabilidade;
  if (!s || s.nivel === 'sem_dividendo') {
    return `<span class="sust-badge sust-nd" data-tip="Sem proventos recorrentes nos últimos 5 anos fechados">Sem Divid.</span>`;
  }
  const nota = Math.max(0, Math.min(100, Number(s.nota) || 0));
  const ehRisco = s.nivel === 'alerta' || nota < 50;
  const corFill = ehRisco ? 'var(--red)' : 'var(--accent)';
  const wFill = Math.max(2, Math.round((nota / 100) * 96));
  const resumoPilares = Array.isArray(s.pilares)
    ? s.pilares.map(p => `${p.nome}: ${p.detalhe}`).join(' · ')
    : '';
  const tip = `Score Anti-Cilada: ${nota}/100 (${s.rotulo}) — ${resumoPilares}`;

  return `
    <div class="sust-cell" data-tip="${esc(tip)}">
      <div class="sust-top">
        <span class="sust-score-num">${nota}<span class="t-dim">/100</span></span>
        ${ehRisco
          ? `<span class="sust-risk-flag"><span aria-hidden="true">⚠</span>Risco</span>`
          : `<span class="sust-neutral-label">${esc(s.rotulo)}</span>`}
      </div>
      <svg class="inline-bar-svg" width="96" height="5" viewBox="0 0 96 5" aria-hidden="true">
        <rect x="0" y="0" width="96" height="5" rx="2.5" fill="var(--surface-2)" />
        <rect x="0" y="0" width="${wFill}" height="5" rx="2.5" fill="${corFill}" />
      </svg>
    </div>
  `;
}

window.htmlSustentabilidade = htmlSustentabilidade;
window.htmlSustentabilidadeTabela = htmlSustentabilidadeTabela;
window.esc = esc;
window.categoriaDoAtivo = categoriaDoAtivo;
window.htmlVeredito = htmlVeredito;
window.urlInvestidor10 = urlInvestidor10;

function htmlVeredito(v) {
  const k = ORDEM_VEREDITO[v] !== undefined ? v : 'vermelho';
  return `<span class="verdict verdict-${k}"><span class="verdict-icon" aria-hidden="true">${ICONE_VEREDITO[k]}</span><span>${ROTULO_VEREDITO[k]}</span></span>`;
}

/* Barra divergente centrada no zero via SVG (sem style inline) */
function htmlBarraMargem(m) {
  if (!valido(m)) return '';
  const c = Math.max(-1, Math.min(1, m));
  const largura = Math.max(2, Math.round(Math.abs(c) * 50));
  const cor = m >= 0 ? 'var(--green)' : (m >= -0.05 ? 'var(--yellow)' : 'var(--red)');
  const x = m >= 0 ? 52 : (52 - largura);

  return `
    <svg class="mbar-svg" width="104" height="6" viewBox="0 0 104 6" aria-hidden="true">
      <rect x="0" y="1" width="104" height="4" rx="2" fill="var(--surface-2)" />
      <rect x="${x}" y="1" width="${largura}" height="4" rx="2" fill="${cor}" />
      <line x1="52" y1="0" x2="52" y2="6" stroke="var(--border-strong)" stroke-width="1.2" />
    </svg>
  `;
}

/* Mini-sparkline de 12 meses (~52 semanas) derivado de historico_precos */
function htmlSparkline12m(a) {
  const hist = Array.isArray(a?.historico_precos) ? a.historico_precos : [];
  const ultimos52 = hist.slice(-53).filter(v => valido(v) && v > 0);
  if (ultimos52.length < 4) return '';

  const min = Math.min(...ultimos52);
  const max = Math.max(...ultimos52);
  const amp = (max - min) || 1;
  const W = 58;
  const H = 22;
  const pts = ultimos52.map((v, idx) => {
    const x = (idx / (ultimos52.length - 1)) * (W - 4) + 2;
    const y = (H - 3) - ((v - min) / amp) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const var12m = (ultimos52[ultimos52.length - 1] - ultimos52[0]) / ultimos52[0];
  const tip = `Tendência 12m: ${fmtPct(var12m)} (mín ${fmtReal(min)} · máx ${fmtReal(max)})`;

  return `
    <svg class="spark-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
      <polyline points="${pts}" fill="none" stroke="var(--series-price)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function htmlOutrosMetodos(a) {
  const temGraham = valido(a.graham);
  const temGordon = valido(a.gordon);
  if (!temGraham && !temGordon) {
    return `<span class="t-dim" data-tip="Graham e Gordon não se aplicam a este ativo (dados ausentes ou negativos)">—</span>`;
  }
  const bloco = (rotulo, valor, margemMod) => {
    if (!valido(valor)) {
      return `<div class="other-method-col"><span class="other-method-tag">${rotulo}</span><span class="t-dim">—</span></div>`;
    }
    return `
      <div class="other-method-col" data-tip="${rotulo}: valor justo ${fmtReal(valor)} (${fmtPct(margemMod)})">
        <span class="mono">${fmtReal(valor)}</span>
        <span class="cell-sub ${classeMargem(margemMod)}">${rotulo.slice(0, 3)} ${fmtPct(margemMod)}</span>
      </div>
    `;
  };
  return `
    <div class="other-methods-cell">
      ${bloco('Graham', a.graham, a.margem_graham)}
      ${bloco('Gordon', a.gordon, a.margem_gordon)}
    </div>
  `;
}

function htmlGreenblatt(a) {
  if (valido(a.rank_greenblatt)) {
    return `<span class="rank ${a.rank_greenblatt <= 10 ? 'rank-top' : ''}">#${a.rank_greenblatt}</span>`;
  }
  const motivo = a.motivo_exclusao_greenblatt || 'Fora do ranking Greenblatt (bancos e financeiras não usam EBIT/EV)';
  return `
    <span class="rank-out">
      <span>Fora</span>
      <button type="button" class="info-trigger" data-tip="${esc(motivo)}" aria-label="Motivo de exclusão do ranking Greenblatt: ${esc(motivo)}">ⓘ</button>
    </span>
    <span class="cell-sub rank-reason">${esc(motivo)}</span>
  `;
}

function renderizarCabecalho() {
  document.querySelectorAll('.vt thead [data-sort]').forEach(el => {
    const ativo = el.dataset.sort === painelState.sort.key;
    el.classList.toggle('is-sorted', ativo);
    el.classList.toggle('asc', ativo && painelState.sort.dir === 'asc');
    el.classList.toggle('desc', ativo && painelState.sort.dir === 'desc');
    if (el.tagName === 'TH') {
      el.setAttribute('aria-sort', ativo ? (painelState.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  });
  const sel = $('#select-sort-mobile');
  if (sel) {
    const idx = OPCOES_ORDENACAO.findIndex(o => o.key === painelState.sort.key && o.dir === painelState.sort.dir);
    sel.value = idx >= 0 ? String(idx) : '';
  }
  const tableEl = $('#engine-valuation-table');
  if (tableEl) {
    tableEl.classList.toggle('is-compact', painelState.densidade === 'compacta');
  }
  document.querySelectorAll('#table-density-group .seg-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.density === painelState.densidade);
  });
}

function renderizarChipsFiltro() {
  const el = $('#active-filters');
  if (!el) return;
  const chips = [];
  if (painelState.filtroSetor !== 'todos') chips.push({ tipo: 'setor', label: `Setor: ${nomeSetor(painelState.filtroSetor)}` });
  if (painelState.filtroVeredito !== 'todos') chips.push({ tipo: 'veredito', label: `Situação: ${ROTULO_VEREDITO[painelState.filtroVeredito]}` });
  if (painelState.termo.trim()) chips.push({ tipo: 'termo', label: `Busca: "${painelState.termo.trim()}"` });
  el.innerHTML = chips.map(c => `
    <span class="filter-chip">${esc(c.label)}
      <button type="button" data-clear-filter="${c.tipo}" aria-label="Remover filtro ${esc(c.label)}">
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
      ? `${lista.length} ${lista.length === 1 ? 'ativo monitorado' : 'ativos monitorados'} · ordenados por ${OPCOES_ORDENACAO.find(o => o.key === painelState.sort.key && o.dir === painelState.sort.dir)?.label || painelState.sort.key}`
      : `${lista.length} de ${totalSel} ativos exibidos (filtros ativos)`;
  }

  if (totalSel === 0) {
    tbody.innerHTML = `
      <tr class="row-empty"><td colspan="11" class="empty">
        <strong>Nenhum ativo selecionado no seu painel</strong>
        Escolha as ações que deseja monitorar (setores BESST, pagadoras de dividendos ou Demais papéis).
        <div class="empty-actions">
          <button type="button" class="btn btn-primary" data-empty-action="open">Gerenciar ativos</button>
          <button type="button" class="btn btn-ghost" data-empty-action="padrao">Restaurar seleção executiva</button>
          <button type="button" class="btn btn-ghost" data-empty-action="besst">Carregar setores BESST</button>
          <button type="button" class="btn btn-ghost" data-empty-action="todos">Carregar todos (${painelState.universo.length})</button>
        </div>
      </td></tr>`;
    return;
  }

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr class="row-empty"><td colspan="11" class="empty">
        <strong>Nenhum ativo corresponde ao filtro selecionado</strong>
        Ajuste o termo de busca, o setor ou a situação frente ao teto.
        <div class="empty-actions"><button type="button" class="btn btn-primary" data-empty-action="limpar-filtros">Limpar filtros</button></div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const b = a.bazin || {};
    const m = b.teto > 0 ? b.margem_seguranca : null;
    const falta = diferencaAteTeto(a);
    const cat = categoriaDoAtivo(a);
    const extra = b.tem_extraordinario
      ? `<span class="tag tag-extra" data-tip="Há dividendos extraordinários nos 5 anos. DPA c/ extra: ${fmtReal(b.dpa)} · s/ extra: ${fmtReal(b.dpa_sem_extra)}">Extra</span>`
      : '';
    const catTag = cat === 'demais' ? `<span class="tag tag-demais">Demais</span>` : '';
    const dpaCell = b.tem_extraordinario
      ? `<div class="cell-stack"><span>${fmtReal(b.dpa_sem_extra)}</span><span class="cell-sub">c/ extra ${fmtReal(b.dpa)}</span></div>`
      : fmtReal(b.dpa_sem_extra);
    const faltaCell = valido(falta)
      ? `<span class="${falta >= 0 ? 't-green' : 't-red'}">${fmtRealSinal(falta)}</span>`
      : `<span class="t-dim">—</span>`;

    return `
      <tr class="row" data-ticker="${esc(a.ticker)}" tabindex="0">
        <td class="c-ticker" data-label="Ativo">
          <div class="asset-cell-wrap">
            <div class="asset">
              <span class="asset-ticker" ${a.empresa ? `data-tip="${esc(a.empresa)}"` : ''}>${esc(a.ticker)} ${extra}</span>
              <span class="asset-sector">${esc(a.empresa || a.setor)} ${catTag}</span>
            </div>
            ${htmlSparkline12m(a)}
          </div>
        </td>
        <td class="num c-preco" data-label="Preço">${fmtReal(a.preco)}</td>
        <td class="num c-dpa" data-label="DPA 5a">${dpaCell}</td>
        <td class="num c-teto" data-label="Teto Bazin">${b.teto > 0 ? fmtReal(b.teto) : '<span class="t-dim" data-tip="Sem DPA recorrente nos últimos 5 anos fechados">—</span>'}</td>
        <td class="num c-falta" data-label="Falta até o teto">${faltaCell}</td>
        <td class="num c-margem" data-label="Margem Bazin">
          <div class="margin-cell" data-tip="Preço ${fmtReal(a.preco)} vs. Teto Bazin ${fmtReal(b.teto)}">
            <span class="margin-val ${classeMargem(m)}">${fmtPct(m)}</span>
            ${htmlBarraMargem(m)}
          </div>
        </td>
        <td class="c-verdict" data-label="Situação">${b.teto > 0 ? htmlVeredito(b.veredito) : '<span class="tag">Sem teto Bazin</span>'}</td>
        <td class="c-sustent" data-label="Anti-Cilada">${htmlSustentabilidadeTabela(a)}</td>
        <td class="num c-graham" data-label="Outros métodos">${htmlOutrosMetodos(a)}</td>
        <td class="num c-gb" data-label="Greenblatt">${htmlGreenblatt(a)}</td>
        <td class="c-actions">
          <button type="button" class="btn-inline-link mobile-only" data-row-action="expand" aria-label="Expandir detalhes do cartão de ${esc(a.ticker)}">Mais dados</button>
          <div class="row-actions">
            <button type="button" class="icon-btn" data-row-action="chart" data-tip="Abrir em Gráficos &amp; Simulador" aria-label="Abrir gráfico e simulador de ${esc(a.ticker)}">
              <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/></svg>
            </button>
            <a href="${urlInvestidor10(a.ticker)}" target="_blank" rel="noopener noreferrer" class="icon-btn" data-row-action="ext" data-tip="Abrir ${esc(a.ticker)} no Investidor10" aria-label="Abrir ${esc(a.ticker)} no Investidor10">
              <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <button type="button" class="icon-btn" data-row-action="detail" data-tip="Abrir Raio-X de ${esc(a.ticker)}" aria-label="Abrir Raio-X de ${esc(a.ticker)}">
              <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button type="button" class="icon-btn remove" data-row-action="remove" data-tip="Ocultar ${esc(a.ticker)} do painel" aria-label="Ocultar ${esc(a.ticker)} do painel">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ---------- Render: Gaveta de Seleção de Ativos ---------- */

function renderizarUniverso() {
  const el = $('#universe-chips-list');
  const badge = $('#universe-total-badge');
  if (badge) badge.textContent = `${painelState.universo.length} disponíveis na base · ${painelState.selecionados.length} selecionados`;
  if (!el) return;

  const q = ($('#input-search-universe')?.value || '').trim().toLowerCase();
  const sel = new Set(painelState.selecionados.map(t => t.toUpperCase()));
  const grupos = [
    ...SETORES_BESST.map(s => ({ id: s.id, titulo: `${s.nome} (BESST)`, filtro: a => categoriaDoAtivo(a) === 'besst' && mapearSetorBesst(a.setor) === s.id })),
    { id: 'dividendos', titulo: 'Outras pagadoras de dividendos', filtro: a => categoriaDoAtivo(a) === 'dividendos' },
    { id: 'demais', titulo: 'Demais papéis (crescimento, consumo, saúde e outros)', filtro: a => categoriaDoAtivo(a) === 'demais' }
  ];
  const classeDotVeredito = { verde: 'dot-green', amarelo: 'dot-yellow', vermelho: 'dot-red' };

  const html = grupos.map(g => {
    const itens = painelState.universo
      .filter(g.filtro)
      .filter(a => !q || a.ticker.toLowerCase().includes(q) || a.setor.toLowerCase().includes(q) || (a.empresa || '').toLowerCase().includes(q))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    if (!itens.length) return '';
    const todosOn = itens.every(a => sel.has(a.ticker.toUpperCase()));
    return `
      <div>
        <div class="u-group-title">
          <span>${esc(g.titulo)} · ${itens.length}</span>
          <button type="button" data-group-toggle="${g.id}" data-on="${todosOn ? '1' : '0'}">${todosOn ? 'Remover grupo' : 'Adicionar grupo'}</button>
        </div>
        <div class="u-chips">
          ${itens.map(a => `
            <button type="button" class="chip is-mono ${sel.has(a.ticker.toUpperCase()) ? 'is-on' : ''}" data-toggle-ticker="${esc(a.ticker)}"
              data-tip="${esc(a.empresa ? a.empresa + ' · ' : '')}${esc(a.setor)} · ${fmtReal(a.preco)} · Teto Bazin ${fmtReal(a.bazin?.teto)} · Graham ${fmtReal(a.graham)}">
              <span class="dot ${classeDotVeredito[a.bazin?.veredito] || 'dot-dim'}" aria-hidden="true"></span>${esc(a.ticker)}
            </button>`).join('')}
        </div>
      </div>`;
  }).join('');

  el.innerHTML = html || `<p class="t-muted">Nenhum ativo encontrado para "${esc(q)}".</p>`;
}

/* ---------- Render: Gaveta de Detalhe (Raio-X) sem Inline Styles ---------- */

function htmlComparativoModelos(a) {
  const modelos = [
    { nome: 'Teto Bazin', valor: a.bazin?.teto > 0 ? a.bazin.teto : null, cor: 'var(--series-bazin)' },
    { nome: 'Graham', valor: a.graham, cor: 'var(--series-graham)' },
    { nome: 'Gordon', valor: a.gordon, cor: 'var(--series-gordon)' }
  ];
  const valores = [a.preco, ...modelos.map(m => m.valor)].filter(valido);
  const max = Math.max(...valores, 1) * 1.12;
  const xBase = 88;
  const wMax = 240;
  const xPreco = xBase + Math.round((a.preco / max) * wMax);

  const linhasSvg = modelos.map((m, idx) => {
    const y = 14 + idx * 26;
    const w = valido(m.valor) ? Math.max(3, Math.round((m.valor / max) * wMax)) : 0;
    const txtVal = valido(m.valor) ? fmtReal(m.valor) : '—';
    return `
      <text x="0" y="${y + 9}" fill="var(--muted)" font-family="var(--sans)" font-size="12" font-weight="500">${esc(m.nome)}</text>
      <rect x="${xBase}" y="${y}" width="${wMax}" height="10" rx="5" fill="var(--surface)" />
      ${w > 0 ? `<rect x="${xBase}" y="${y}" width="${w}" height="10" rx="5" fill="${m.cor}" />` : ''}
      <text x="418" y="${y + 9}" text-anchor="end" fill="var(--text-strong)" font-family="var(--mono)" font-size="12" font-weight="600">${esc(txtVal)}</text>
    `;
  }).join('');

  return `
    <div class="d-block">
      <div class="d-section-title">Preço vs. valor justo por modelo</div>
      <svg class="vsvg" viewBox="0 0 420 92" width="420" height="92" role="img" aria-label="Comparativo entre preço atual e preços-teto">
        ${linhasSvg}
        <line x1="${xPreco}" y1="6" x2="${xPreco}" y2="84" stroke="var(--text-strong)" stroke-width="2" stroke-dasharray="3 2" />
      </svg>
      <p class="d-note">Linha tracejada vertical = preço atual (${fmtReal(a.preco)}). Barras à direita da linha indicam preço-teto acima da cotação.</p>
    </div>`;
}

function htmlHistoricoDpaAnual(porAno) {
  if (!porAno || typeof porAno !== 'object') return '';
  const entradas = Object.entries(porAno).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!entradas.length) return '';
  const maxVal = Math.max(...entradas.map(([, v]) => Number(v) || 0), 0.01);

  const colW = 80;
  const svgW = entradas.length * colW;
  const colsSvg = entradas.map(([ano, val], idx) => {
    const num = Number(val) || 0;
    const h = Math.max(4, Math.round((num / maxVal) * 44));
    const x = idx * colW + 14;
    const y = 62 - h;
    return `
      <g data-tip="${esc(ano)}: ${esc(fmtReal(num))} por ação">
        <text x="${x + 26}" y="12" text-anchor="middle" fill="var(--text)" font-family="var(--mono)" font-size="12">${esc(fmtReal(num).replace('R$ ', ''))}</text>
        <rect x="${x}" y="18" width="52" height="44" rx="4" fill="var(--surface)" />
        <rect x="${x}" y="${y}" width="52" height="${h}" rx="4" fill="var(--accent)" />
        <text x="${x + 26}" y="78" text-anchor="middle" fill="var(--muted)" font-family="var(--mono)" font-size="12">${esc(ano)}</text>
      </g>
    `;
  }).join('');

  return `
    <div class="d-sub-chart">
      <div class="d-sub-title">Proventos recorrentes por ano civil da data-com (R$)</div>
      <svg class="vsvg" viewBox="0 0 ${svgW} 84" width="${svgW}" height="84" role="img" aria-label="Histórico de proventos por ano civil">
        ${colsSvg}
      </svg>
    </div>`;
}

function htmlBlocoAgendaProventos(a) {
  const prox = a.proxima_data_com;
  const ult = a.ultimo_provento_pago;
  const pgtoPend = a.proximo_pagamento;
  const habituais = Array.isArray(a.meses_habituais_dividendo)
    ? a.meses_habituais_dividendo.map(m => MESES_ABREV_PT[m - 1]).filter(Boolean)
    : [];

  let htmlProx = '';
  if (prox) {
    const dias = diasAteDataIsoB3(prox.data_com);
    const prazoTxt = dias === 0 ? 'Hoje!' : (dias === 1 ? 'Amanhã' : (dias !== null && dias > 1 ? `Em ${dias} dias` : 'Em aberto'));
    const dyEv = a.preco > 0 ? prox.valor / a.preco : null;
    htmlProx = `
      <div class="d-agenda-card is-open">
        <div class="d-agenda-head">
          <span class="d-agenda-label">Próxima Data-Com</span>
          <span class="d-agenda-pill is-green">${esc(prazoTxt)}</span>
        </div>
        <div class="d-agenda-main mono">${fmtDataIso(prox.data_com)}</div>
        <div class="d-agenda-meta">
          <strong class="t-green mono">${fmtRealProvento(prox.valor)}</strong> (${esc(rotuloTipoProvento(prox.tipo))}${valido(dyEv) ? ` · ${fmtPctSimples(dyEv, 2)}` : ''})
        </div>
        <div class="d-agenda-foot">Pagamento: <strong class="mono">${prox.data_pagamento ? fmtDataIso(prox.data_pagamento) : 'A definir'}</strong></div>
      </div>`;
  } else {
    htmlProx = `
      <div class="d-agenda-card">
        <div class="d-agenda-head">
          <span class="d-agenda-label">Próxima Data-Com</span>
          <span class="d-agenda-pill">Aguardando anúncio</span>
        </div>
        <div class="d-agenda-main is-empty-msg">Nenhuma data-com em aberto</div>
        <div class="d-agenda-foot">${habituais.length ? `Meses habituais (5a): <strong class="mono t-strong">${esc(habituais.join(', '))}</strong>` : 'Sem sazonalidade recorrente nos 5a'}</div>
      </div>`;
  }

  let htmlUlt = '';
  if (ult) {
    const dyUlt = a.preco > 0 ? ult.valor / a.preco : null;
    const textoPgto = ult.data_pagamento
      ? `Pago em <strong class="mono">${fmtDataIso(ult.data_pagamento)}</strong>`
      : `Ex-dividendo (data de pgto não informada)`;
    htmlUlt = `
      <div class="d-agenda-card">
        <div class="d-agenda-head">
          <span class="d-agenda-label">Último Dividendo / JCP Pago</span>
          <span class="d-agenda-pill">${esc(rotuloTipoProvento(ult.tipo))}</span>
        </div>
        <div class="d-agenda-main mono">${fmtRealProvento(ult.valor)} <span class="t-muted">${valido(dyUlt) ? `(${fmtPctSimples(dyUlt, 2)})` : ''}</span></div>
        <div class="d-agenda-meta">${textoPgto}</div>
        <div class="d-agenda-foot">Data-com: <span class="mono">${fmtDataIso(ult.data_com)}</span></div>
      </div>`;
  } else {
    htmlUlt = `
      <div class="d-agenda-card">
        <div class="d-agenda-head"><span class="d-agenda-label">Último Dividendo / JCP Pago</span></div>
        <div class="d-agenda-main is-empty-msg">Sem registro de pagamento</div>
        <div class="d-agenda-foot">Ativo sem proventos históricos em caixa</div>
      </div>`;
  }

  const htmlPendente = pgtoPend ? `
    <div class="d-agenda-pending">
      <span>Pagamento já aprovado a caminho (ex-dividendo em <span class="mono">${fmtDataIso(pgtoPend.data_com)}</span>):</span>
      <strong class="mono t-accent">${fmtRealProvento(pgtoPend.valor)} (${esc(rotuloTipoProvento(pgtoPend.tipo))}) em ${fmtDataIso(pgtoPend.data_pagamento)}</strong>
    </div>` : '';

  return `
    <div class="d-block">
      <div class="d-section-head-row">
        <div class="d-section-title">Agenda de Dividendos &amp; JCP</div>
        <button type="button" class="btn-inline-link" data-detail-calendar="${esc(a.ticker)}">Abrir Calendário →</button>
      </div>
      <div class="d-agenda-grid">
        ${htmlProx}
        ${htmlUlt}
      </div>
      ${htmlPendente}
    </div>`;
}

/* Raio-X: 4 pilares como 4 barras de 0-25 com rótulos claros (Seção 4A) */
function htmlBlocoSustentabilidade(a) {
  const s = a.sustentabilidade;
  if (!s) return '';

  return `
    <div class="d-block">
      <div class="d-section-head-row">
        <div class="d-section-title">Score de Sustentabilidade Anti-Cilada</div>
        ${htmlSustentabilidade(a)}
      </div>
      <div class="d-pilar-list">
        ${(s.pilares || []).map(p => {
          const maxP = Number(p.max_pontos) || 25;
          const pts = Math.max(0, Math.min(maxP, Number(p.pontos) || 0));
          const wBar = Math.round((pts / maxP) * 240);
          const corPilar = p.status === 'risco' ? 'var(--red)' : 'var(--accent)';
          return `
            <div class="d-pilar-row">
              <div class="d-pilar-head">
                <strong>${esc(p.nome)}</strong>
                <span class="d-pilar-pts mono">${pts} / ${maxP} pts</span>
              </div>
              <svg class="inline-bar-svg" width="100%" height="6" viewBox="0 0 240 6" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width="240" height="6" rx="3" fill="var(--bg-elev)" />
                ${wBar > 0 ? `<rect x="0" y="0" width="${wBar}" height="6" rx="3" fill="${corPilar}" />` : ''}
              </svg>
              <span class="d-pilar-det">${esc(p.detalhe)}</span>
            </div>
          `;
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
  const cat = categoriaDoAtivo(a);
  const rotuloCat = cat === 'besst' ? 'BESST' : (cat === 'demais' ? 'Demais papéis' : 'Dividendos');

  $('#detail-title').textContent = a.empresa ? `${a.ticker} · ${a.empresa}` : a.ticker;
  $('#detail-sub').innerHTML = `${esc(a.setor)} · ${esc(rotuloCat)} · ${b.teto > 0 ? htmlVeredito(b.veredito) : '<span class="tag">Sem teto Bazin</span>'}`;

  const noPainel = painelState.selecionados.some(t => t.toUpperCase() === a.ticker.toUpperCase());
  const greenblatt = valido(a.rank_greenblatt)
    ? `#${a.rank_greenblatt}`
    : (a.motivo_exclusao_greenblatt || 'Fora do ranking');

  const infoGerado = formatarDataHoraSaoPaulo(painelState.payload?.gerado_em);
  const geradoStr = `${infoGerado.dataCompleta} ${infoGerado.hora} (horário de Brasília)`;
  const linkInv10 = urlInvestidor10(a.ticker);

  $('#detail-body').innerHTML = `
    <div class="d-hero">
      <div class="d-stat"><div class="d-stat-label">Preço</div><div class="d-stat-value">${fmtReal(a.preco)}</div></div>
      <div class="d-stat"><div class="d-stat-label">Teto Bazin</div><div class="d-stat-value">${b.teto > 0 ? fmtReal(b.teto) : '—'}</div></div>
      <div class="d-stat"><div class="d-stat-label">Margem</div><div class="d-stat-value ${classeMargem(b.margem_seguranca)}">${fmtPct(b.margem_seguranca)}</div></div>
    </div>

    <div class="d-ext-bar">
      <button type="button" class="btn btn-ghost" data-detail-chart="${esc(a.ticker)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/></svg>
        <span>Gráfico &amp; Simulador</span>
      </button>
      <a class="btn btn-primary" href="${linkInv10}" target="_blank" rel="noopener noreferrer">
        <span>Investidor10</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </div>

    ${htmlComparativoModelos(a)}

    ${htmlBlocoAgendaProventos(a)}

    ${htmlBlocoSustentabilidade(a)}

    <div class="d-block">
      <div class="d-section-title">Bazin · K = 6%</div>
      <dl class="kv">
        <dt>DPA 5a sem extraordinários</dt><dd>${fmtReal(b.dpa_sem_extra)}</dd>
        <dt>DPA 5a com extraordinários</dt><dd>${fmtReal(b.dpa)}</dd>
        <dt>Yield implícito (DPA 5a / Preço)</dt><dd class="${razaoDpaPreco(a) >= 0.06 ? 't-green' : ''}">${fmtPctSimples(razaoDpaPreco(a), 2)}</dd>
        <div class="sep"></div>
        <dt>Teto (DPA ÷ 6%)</dt><dd>${b.teto > 0 ? fmtReal(b.teto) : '—'}</dd>
        <dt>Falta até o teto (R$)</dt><dd class="${valido(diferencaAteTeto(a)) ? (diferencaAteTeto(a) >= 0 ? 't-green' : 't-red') : ''}">${fmtRealSinal(diferencaAteTeto(a))}</dd>
        <dt>Margem de segurança</dt><dd class="${classeMargem(b.margem_seguranca)}">${fmtPct(b.margem_seguranca)}</dd>
        <dt>Tempo abaixo do Teto (5a)</dt><dd>${valido(a.pct_abaixo_teto_5a) ? fmtPctSimples(a.pct_abaixo_teto_5a, 0) : '—'}</dd>
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
      <div class="d-section-title">Endividamento &amp; Liquidez</div>
      ${ehBanco ? `
        <p class="d-note">Instituições bancárias captam depósitos como parte da operação; múltiplos de Dívida Líquida/EBITDA não se aplicam.</p>
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
      <div class="d-section-title">Outros métodos &amp; Datas de referência</div>
      <dl class="kv">
        <dt>Graham (valor intrínseco)</dt><dd>${fmtReal(a.graham)} (${fmtPct(a.margem_graham)})</dd>
        <dt>Gordon (preço justo)</dt><dd>${fmtReal(a.gordon)} (${fmtPct(a.margem_gordon)})</dd>
        <dt>Greenblatt</dt><dd>${esc(greenblatt)}</dd>
        <div class="sep"></div>
        <dt>Data da última cotação (B3)</dt><dd>${esc(a.data_ult_cot || f.data_ult_cot || '—')}</dd>
        <dt>Último balanço processado (CVM)</dt><dd>${esc(a.ult_balanco || f.ult_balanco || '—')}</dd>
        <dt>Sincronização da base</dt><dd>${esc(geradoStr)}</dd>
      </dl>
    </div>

    <div class="d-actions">
      <button type="button" class="btn btn-primary" data-detail-chart="${esc(a.ticker)}">Gráfico &amp; Simulador</button>
      <button type="button" class="btn ${noPainel ? 'btn-ghost btn-danger' : 'btn-ghost'}" data-detail-toggle="${esc(a.ticker)}">
        ${noPainel ? 'Remover do painel' : 'Adicionar ao painel'}
      </button>
    </div>
  `;
}

/* ---------- Gavetas Modais com Focus Trap e Devolução de Foco ---------- */

function abrirGaveta(id) {
  painelState.ultimoGatilhoFoco = document.activeElement;
  $('#overlay')?.classList.remove('is-hidden');
  document.querySelectorAll('.drawer').forEach(d => d.classList.add('is-hidden'));
  const el = $(id);
  if (el) {
    el.classList.remove('is-hidden');
    const fecharBtn = el.querySelector('[data-close-drawer]');
    if (fecharBtn) fecharBtn.focus();
  }
  document.body.classList.add('no-scroll');
  esconderTooltip();
}

function fecharGavetas() {
  const algumaAberta = Array.from(document.querySelectorAll('.drawer')).some(d => !d.classList.contains('is-hidden'));
  $('#overlay')?.classList.add('is-hidden');
  document.querySelectorAll('.drawer').forEach(d => d.classList.add('is-hidden'));
  document.body.classList.remove('no-scroll');
  painelState.detalheTicker = null;
  if (algumaAberta && painelState.ultimoGatilhoFoco && typeof painelState.ultimoGatilhoFoco.focus === 'function') {
    painelState.ultimoGatilhoFoco.focus();
    painelState.ultimoGatilhoFoco = null;
  }
}

function abrirSeletor() {
  renderizarUniverso();
  abrirGaveta('#selector-drawer');
  if (window.matchMedia('(hover: hover)').matches) {
    setTimeout(() => $('#input-search-universe')?.focus(), 40);
  }
}

function abrirDetalhe(ticker) {
  renderizarDetalhe(ticker);
  abrirGaveta('#detail-drawer');
}
window.abrirDetalhe = abrirDetalhe;
window.abrirDetalheAtivo = abrirDetalhe;
window.obterTickersPainelAtivo = () => [...painelState.selecionados];

function sincronizarEstadoUrl() {
  if (!painelState.payload) return;
  const params = new URLSearchParams();
  const estVis = typeof window.obterEstadoVisaoGrafica === 'function' ? window.obterEstadoVisaoGrafica() : null;
  const estMC = typeof window.obterEstadoMatrizCalendario === 'function' ? window.obterEstadoMatrizCalendario() : null;
  const aba = estVis?.aba || 'tabela';
  if (aba !== 'tabela') params.set('aba', aba);
  if (aba === 'tabela') {
    if (painelState.filtroSetor !== 'todos') params.set('setor', painelState.filtroSetor);
    if (painelState.filtroVeredito !== 'todos') params.set('veredito', painelState.filtroVeredito);
  } else if (aba === 'visual' && estVis) {
    if (estVis.ativo) params.set('ativo', estVis.ativo);
    if (estVis.periodo) {
      const pStr = String(estVis.periodo);
      params.set('periodo', (pStr.endsWith('y') || pStr.endsWith('m')) ? pStr : `${pStr}y`);
    }
    if (estVis.modo && estVis.modo !== 'preco' && estVis.modo !== 'price') params.set('modo', estVis.modo);
    if (Array.isArray(estVis.comparar) && estVis.comparar.length) params.set('comparar', estVis.comparar.join(','));
  } else if (aba === 'matriz' && estMC) {
    if (estMC.matrizX) params.set('x', estMC.matrizX);
    if (estMC.matrizY) params.set('y', estMC.matrizY);
    if (estMC.matrizEscopo && estMC.matrizEscopo !== 'painel') params.set('escopo', estMC.matrizEscopo);
    if (estMC.matrizQuadrante && estMC.matrizQuadrante !== 'todos') params.set('quad', estMC.matrizQuadrante);
  } else if (aba === 'calendario' && estMC) {
    if (estMC.calEscopo && estMC.calEscopo !== 'painel') params.set('escopo', estMC.calEscopo);
    if (estMC.calMes > 0) params.set('mes', String(estMC.calMes));
  }
  const str = params.toString();
  const novoHash = str ? `#${str}` : location.pathname + location.search;
  try { history.replaceState(null, '', novoHash); } catch (_) { /* ignore */ }
}
window.sincronizarEstadoUrl = sincronizarEstadoUrl;

function aplicarEstadoUrl() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return;
  const hash = new URLSearchParams(raw);
  const obj = {};
  hash.forEach((v, k) => { obj[k] = v; });
  if (obj.tab && !obj.aba) obj.aba = obj.tab;
  if (obj.p && !obj.ativo) obj.ativo = obj.p;
  if (obj.setor) painelState.filtroSetor = obj.setor;
  if (obj.veredito && ['todos', 'verde', 'amarelo', 'vermelho'].includes(obj.veredito)) {
    painelState.filtroVeredito = obj.veredito;
    document.querySelectorAll('#verdict-filter .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.verdict === obj.veredito));
  }
  if (typeof window.aplicarEstadoMatrizCalendario === 'function') {
    window.aplicarEstadoMatrizCalendario(obj);
  }
  if (typeof window.aplicarEstadoVisaoGrafica === 'function') {
    window.aplicarEstadoVisaoGrafica(obj);
  }
  renderizarBesst();
  renderizarTabela();
}
window.aplicarEstadoUrl = aplicarEstadoUrl;
window.addEventListener('hashchange', aplicarEstadoUrl);

/* ---------- Tooltip & Popover Acessível (sem inline style) ---------- */

let tooltipAlvo = null;

function mostrarTooltip(alvo) {
  const tip = $('#tooltip');
  const texto = alvo?.getAttribute('data-tip');
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
  definirRegraCssDinamica('#tooltip.is-visible', `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`);
}

function esconderTooltip() {
  tooltipAlvo = null;
  $('#tooltip')?.classList.remove('is-visible');
}

/* ---------- Exportação CSV e PNG (SVG -> Canvas sem biblioteca) ---------- */

function baixarArquivoTexto(nomeArquivo, conteudo, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
window.baixarArquivoTexto = baixarArquivoTexto;

function exportarTabelaCsv() {
  const lista = ativosVisiveis();
  if (!lista.length) return;
  const cabecalho = [
    'Ticker', 'Empresa', 'Setor', 'Categoria', 'Preco_RS', 'DPA_5a_RS',
    'Teto_Bazin_RS', 'Falta_Ate_Teto_RS', 'Margem_Bazin_Pct', 'Situacao',
    'Score_Anti_Cilada', 'Nivel_Anti_Cilada', 'Graham_RS', 'Margem_Graham_Pct',
    'Gordon_RS', 'Margem_Gordon_Pct', 'Rank_Greenblatt'
  ];
  const linhas = lista.map(a => {
    const b = a.bazin || {};
    const falta = diferencaAteTeto(a);
    return [
      a.ticker,
      `"${String(a.empresa || '').replace(/"/g, '""')}"`,
      `"${String(a.setor || '').replace(/"/g, '""')}"`,
      categoriaDoAtivo(a),
      valido(a.preco) ? a.preco.toFixed(2) : '',
      valido(b.dpa_sem_extra) ? b.dpa_sem_extra.toFixed(4) : '',
      valido(b.teto) && b.teto > 0 ? b.teto.toFixed(2) : '',
      valido(falta) ? falta.toFixed(2) : '',
      valido(b.margem_seguranca) && b.teto > 0 ? (b.margem_seguranca * 100).toFixed(2) : '',
      b.teto > 0 ? (ROTULO_VEREDITO[b.veredito] || '') : 'Sem teto Bazin',
      valido(a.sustentabilidade?.nota) ? a.sustentabilidade.nota : '',
      a.sustentabilidade?.rotulo || '',
      valido(a.graham) ? a.graham.toFixed(2) : '',
      valido(a.margem_graham) ? (a.margem_graham * 100).toFixed(2) : '',
      valido(a.gordon) ? a.gordon.toFixed(2) : '',
      valido(a.margem_gordon) ? (a.margem_gordon * 100).toFixed(2) : '',
      valido(a.rank_greenblatt) ? a.rank_greenblatt : 'Fora'
    ].join(';');
  });
  const dataHoje = hojeIsoSaoPaulo();
  baixarArquivoTexto(`valuation_b3_${dataHoje}.csv`, [cabecalho.join(';'), ...linhas].join('\r\n'));
}

function exportarSvgComoPng(svgEl, nomeArquivo) {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  const cs = getComputedStyle(document.documentElement);
  const vars = [
    '--bg', '--surface', '--bg-elev', '--surface-2', '--border', '--border-strong',
    '--text-strong', '--text', '--muted', '--dim', '--accent', '--green', '--yellow', '--red',
    '--series-price', '--series-bazin', '--series-graham', '--series-gordon',
    '--svg-plot-bg', '--svg-grid', '--svg-axis', '--svg-pill-bg', '--sans', '--mono'
  ];
  let xml = new XMLSerializer().serializeToString(clone);
  vars.forEach(v => {
    const val = cs.getPropertyValue(v).trim();
    if (val) {
      xml = xml.split(`var(${v})`).join(val);
    }
  });

  const w = Number(svgEl.getAttribute('width')) || svgEl.clientWidth || 960;
  const h = Number(svgEl.getAttribute('height')) || svgEl.clientHeight || 460;
  const canvas = document.createElement('canvas');
  const escala = 2;
  canvas.width = w * escala;
  canvas.height = h * escala;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    ctx.fillStyle = cs.getPropertyValue('--surface').trim() || '#101622';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1500);
    }, 'image/png');
  };
  img.src = url;
}
window.exportarSvgComoPng = exportarSvgComoPng;

/* ---------- Modo Apresentação ---------- */

function alternarModoApresentacao(forcar) {
  painelState.modoApresentacao = typeof forcar === 'boolean' ? forcar : !painelState.modoApresentacao;
  document.body.classList.toggle('is-presentation', painelState.modoApresentacao);
  const btn = $('#btn-toggle-presentation');
  if (btn) {
    btn.classList.toggle('is-active', painelState.modoApresentacao);
    btn.setAttribute('aria-pressed', String(painelState.modoApresentacao));
  }
  if (painelState.modoApresentacao) {
    fecharGavetas();
  }
  if (typeof window.atualizarVisaoGrafica === 'function') window.atualizarVisaoGrafica();
  if (!$('#view-matriz')?.classList.contains('is-hidden') && typeof window.renderizarMatrizValuation === 'function') {
    window.renderizarMatrizValuation();
  }
}
window.alternarModoApresentacao = alternarModoApresentacao;

/* ---------- Orquestração e Ações ---------- */

function renderizarTudo() {
  renderizarKpis();
  renderizarBesst();
  renderizarTabela();
  if (!$('#selector-drawer')?.classList.contains('is-hidden')) renderizarUniverso();
  if (painelState.detalheTicker) renderizarDetalhe(painelState.detalheTicker);
  if (typeof window.atualizarVisaoGrafica === 'function') window.atualizarVisaoGrafica();
  if (!$('#view-matriz')?.classList.contains('is-hidden') && typeof window.renderizarMatrizValuation === 'function') window.renderizarMatrizValuation();
  if (!$('#view-calendario')?.classList.contains('is-hidden') && typeof window.renderizarCalendarioDividendos === 'function') window.renderizarCalendarioDividendos();
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
    feedback(`"${val}" não consta na base de ativos.`, true);
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
  let filtro;
  if (grupoId === 'dividendos') filtro = a => categoriaDoAtivo(a) === 'dividendos';
  else if (grupoId === 'demais') filtro = a => categoriaDoAtivo(a) === 'demais';
  else if (grupoId === 'outros') filtro = a => categoriaDoAtivo(a) !== 'besst';
  else filtro = a => categoriaDoAtivo(a) === 'besst' && mapearSetorBesst(a.setor) === grupoId;

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

/* ---------- Erro e Carga da Base ---------- */

function exibirErro(msg) {
  const banner = $('#engine-error-banner');
  if (banner) {
    banner.textContent = `Não foi possível carregar os dados de valuation: ${msg}. Verifique sua conexão e tente novamente.`;
    banner.classList.remove('is-hidden');
  }
  renderizarStatus('is-error', 'Base indisponível · Clique para tentar novamente');
  const tbody = $('#engine-valuation-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr class="row-empty"><td colspan="11" class="empty"><strong>Dados temporariamente indisponíveis</strong>${esc(msg)}</td></tr>`;
  }
}

const URL_VALUATION_REMOTO = 'https://raw.githubusercontent.com/ezdourado/invest/main/data/valuation.json';

async function buscarJsonComCacheBust(urlBase) {
  const sep = urlBase.includes('?') ? '&' : '?';
  const resp = await fetch(`${urlBase}${sep}t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json || !Array.isArray(json.ativos)) throw new Error('formato inválido');
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
    throw primeiroErro || new Error('Nenhuma fonte respondeu');
  }

  validos.sort((a, b) => {
    const ha = Array.isArray(a.historico_datas) && a.historico_datas.length > 0 ? 1 : 0;
    const hb = Array.isArray(b.historico_datas) && b.historico_datas.length > 0 ? 1 : 0;
    if (hb !== ha) return hb - ha;
    const sa = a.ativos?.[0]?.sustentabilidade ? 1 : 0;
    const sb = b.ativos?.[0]?.sustentabilidade ? 1 : 0;
    if (sb !== sa) return sb - sa;
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
    window.VALUATION_DATA = payload;
    painelState.universo = payload.ativos;
    const mapa = mapaUniverso();

    let temSalvo = false;
    try {
      temSalvo = localStorage.getItem(STORAGE_KEY_PAINEL_TICKERS) !== null;
    } catch (_) {
      temSalvo = false;
    }

    if (temSalvo) {
      painelState.selecionados = lerStorage(STORAGE_KEY_PAINEL_TICKERS, [])
        .filter(t => typeof t === 'string' && mapa.has(t.toUpperCase()));
    } else {
      painelState.selecionados = CARTEIRA_EXECUTIVA_PADRAO.filter(t => mapa.has(t));
      gravarStorage(STORAGE_KEY_PAINEL_TICKERS, painelState.selecionados);
    }

    if (!silencioso) {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (hash.get('t')) {
        const doLink = hash.get('t').split(',').map(t => t.trim().toUpperCase()).filter(t => mapa.has(t));
        if (doLink.length) salvarSelecionados(doLink);
      }
      atualizarStatusBase();
      renderizarTudo();
      aplicarEstadoUrl();

      const abaHash = hash.get('aba') || hash.get('tab');
      const ativoHash = hash.get('ativo') || hash.get('p') || undefined;
      if (['tabela', 'visual', 'matriz', 'calendario'].includes(abaHash) && typeof window.definirAbaPainel === 'function') {
        window.definirAbaPainel(abaHash, ativoHash);
      }
      if (hash.get('d') && mapa.has(hash.get('d').toUpperCase())) {
        abrirDetalhe(hash.get('d'));
      }
    } else {
      atualizarStatusBase();
      renderizarTudo();
      aplicarEstadoUrl();
    }
  } catch (err) {
    if (!silencioso) {
      const msg = err instanceof TypeError ? 'falha de rede' : (err.message || 'erro desconhecido');
      exibirErro(msg);
    }
  }
}

/* ---------- Eventos Globais, Modais e Atalhos de Teclado ---------- */

function abrirModal(id) {
  painelState.ultimoGatilhoFoco = document.activeElement;
  const m = $(`#${id}`);
  if (!m) return;
  m.classList.remove('is-hidden');
  m.querySelector('button')?.focus();
}

function fecharModais() {
  document.querySelectorAll('.popover-modal').forEach(m => m.classList.add('is-hidden'));
  if (painelState.ultimoGatilhoFoco && typeof painelState.ultimoGatilhoFoco.focus === 'function') {
    painelState.ultimoGatilhoFoco.focus();
    painelState.ultimoGatilhoFoco = null;
  }
}

function focarBuscaAbaAtiva() {
  if (!$('#view-tabela')?.classList.contains('is-hidden')) {
    $('#input-filter-table')?.focus();
  } else if (!$('#view-visual')?.classList.contains('is-hidden')) {
    $('#visual-search-input')?.focus();
  } else if (!$('#view-matriz')?.classList.contains('is-hidden')) {
    $('#matriz-search-input')?.focus();
  } else if (!$('#view-calendario')?.classList.contains('is-hidden')) {
    $('#cal-search-input')?.focus();
  }
}

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
  $('#btn-toggle-theme')?.addEventListener('click', alternarTema);
  $('#btn-toggle-presentation')?.addEventListener('click', () => alternarModoApresentacao());
  $('#btn-open-methodology')?.addEventListener('click', () => abrirModal('methodology-modal'));
  $('#btn-open-shortcuts')?.addEventListener('click', () => abrirModal('shortcuts-modal'));
  $('#btn-export-table-csv')?.addEventListener('click', exportarTabelaCsv);

  $('#table-density-group')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-density]');
    if (!b) return;
    painelState.densidade = b.dataset.density === 'compacta' ? 'compacta' : 'confortavel';
    gravarStorage(STORAGE_KEY_PAINEL_DENSITY, painelState.densidade);
    renderizarCabecalho();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-drawer]')) {
      fecharGavetas();
      return;
    }
    const closeModalBtn = e.target.closest('[data-close-modal]');
    if (closeModalBtn) {
      fecharModais();
      return;
    }
    if (e.target.classList.contains('popover-modal')) {
      fecharModais();
      return;
    }
    const infoBtn = e.target.closest('.info-trigger[data-tip]');
    if (infoBtn) {
      e.stopPropagation();
      mostrarTooltip(infoBtn);
    }
  });

  document.addEventListener('keydown', (e) => {
    // Trap de foco dentro de gaveta modal aberta
    const gavetaAberta = Array.from(document.querySelectorAll('.drawer')).find(d => !d.classList.contains('is-hidden'));
    if (gavetaAberta && e.key === 'Tab') {
      const focaveis = Array.from(gavetaAberta.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focaveis.length) {
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo.focus();
          return;
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro.focus();
          return;
        }
      }
    }

    if (e.key === 'Escape') {
      const modalAberto = Array.from(document.querySelectorAll('.popover-modal')).some(m => !m.classList.contains('is-hidden'));
      if (modalAberto) {
        fecharModais();
        return;
      }
      if (gavetaAberta) {
        fecharGavetas();
        return;
      }
      if (painelState.modoApresentacao) {
        alternarModoApresentacao(false);
        return;
      }
      esconderTooltip();
      return;
    }

    const digitando = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      focarBuscaAbaAtiva();
      return;
    }
    if (digitando) return;

    if (e.key === '/') {
      e.preventDefault();
      focarBuscaAbaAtiva();
    } else if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      alternarModoApresentacao();
    } else if (e.key === '?') {
      e.preventDefault();
      abrirModal('shortcuts-modal');
    } else if (['1', '2', '3', '4'].includes(e.key) && typeof window.definirAbaPainel === 'function') {
      const mapaAbas = { '1': 'tabela', '2': 'visual', '3': 'matriz', '4': 'calendario' };
      window.definirAbaPainel(mapaAbas[e.key]);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (painelState.modoApresentacao || document.activeElement?.classList.contains('view-tab'))) {
      e.preventDefault();
      const ordem = ['tabela', 'visual', 'matriz', 'calendario'];
      const btnAtivo = document.querySelector('#main-view-tabs .view-tab.is-active');
      const idxAtual = Math.max(0, ordem.indexOf(btnAtivo?.dataset.viewTab || 'tabela'));
      const proxIdx = e.key === 'ArrowRight' ? (idxAtual + 1) % 4 : (idxAtual + 3) % 4;
      if (typeof window.definirAbaPainel === 'function') {
        window.definirAbaPainel(ordem[proxIdx]);
        $(`#tab-btn-${ordem[proxIdx]}`)?.focus();
      }
    }
  });

  const filtrarTabelaDebounced = debounce((valor) => {
    painelState.termo = valor;
    renderizarTabela();
  }, 150);

  $('#input-filter-table')?.addEventListener('input', (e) => {
    filtrarTabelaDebounced(e.target.value || '');
  });

  $('#verdict-filter')?.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) definirFiltroVeredito(b.dataset.verdict);
  });

  $('#besst-coverage-grid')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sector]');
    if (b) definirFiltroSetor(b.dataset.sector);
  });

  $('#extra-categories-grid')?.addEventListener('click', (e) => {
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
    const sortEl = e.target.closest('[data-sort]');
    if (sortEl) {
      e.stopPropagation();
      definirOrdenacao(sortEl.dataset.sort);
    }
  });

  const tbody = $('#engine-valuation-tbody');
  tbody?.addEventListener('click', (e) => {
    if (e.target.closest('.info-trigger')) return;
    const acao = e.target.closest('[data-row-action]');
    const linha = e.target.closest('tr.row');
    const vazio = e.target.closest('[data-empty-action]');
    if (vazio) {
      const t = vazio.dataset.emptyAction;
      if (t === 'open') abrirSeletor();
      if (t === 'padrao') {
        const mapa = mapaUniverso();
        salvarSelecionados(CARTEIRA_EXECUTIVA_PADRAO.filter(tk => mapa.has(tk)));
        renderizarTudo();
      }
      if (t === 'besst') selecionarPor(a => categoriaDoAtivo(a) === 'besst');
      if (t === 'demais') selecionarPor(a => categoriaDoAtivo(a) === 'demais');
      if (t === 'todos') selecionarPor(() => true);
      if (t === 'limpar-filtros') limparFiltros();
      return;
    }
    if (!linha) return;
    if (acao?.dataset.rowAction === 'expand') {
      e.stopPropagation();
      linha.classList.toggle('is-expanded');
      acao.textContent = linha.classList.contains('is-expanded') ? 'Menos dados' : 'Mais dados';
      return;
    }
    if (acao?.dataset.rowAction === 'ext') return;
    if (acao?.dataset.rowAction === 'chart') {
      if (typeof window.abrirNaVisaoGrafica === 'function') window.abrirNaVisaoGrafica(linha.dataset.ticker);
      return;
    }
    if (acao?.dataset.rowAction === 'remove') { alternarTicker(linha.dataset.ticker); return; }
    abrirDetalhe(linha.dataset.ticker);
  });

  tbody?.addEventListener('keydown', (e) => {
    const linha = e.target.closest('tr.row');
    if (linha && e.target === linha && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      abrirDetalhe(linha.dataset.ticker);
    }
  });

  const busca = $('#input-search-universe');
  const renderizarUniversoDebounced = debounce(renderizarUniverso, 150);
  busca?.addEventListener('input', renderizarUniversoDebounced);
  busca?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarPorBusca(); }
  });

  $('#btn-select-besst-universe')?.addEventListener('click', () => selecionarPor(a => categoriaDoAtivo(a) === 'besst'));
  $('#btn-select-dividendos-universe')?.addEventListener('click', () => selecionarPor(a => categoriaDoAtivo(a) === 'dividendos'));
  $('#btn-select-demais-universe')?.addEventListener('click', () => selecionarPor(a => categoriaDoAtivo(a) === 'demais'));
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
    const bCal = e.target.closest('[data-detail-calendar]');
    if (bCal) {
      fecharGavetas();
      if (typeof window.definirAbaPainel === 'function') window.definirAbaPainel('calendario');
      return;
    }
    const bChart = e.target.closest('[data-detail-chart]');
    if (bChart) {
      const t = bChart.dataset.detailChart;
      fecharGavetas();
      if (typeof window.abrirNaVisaoGrafica === 'function') window.abrirNaVisaoGrafica(t);
      return;
    }
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
  document.addEventListener('focusin', (e) => {
    const alvo = e.target.closest('[data-tip]');
    if (alvo) mostrarTooltip(alvo);
  });
  document.addEventListener('focusout', () => {
    esconderTooltip();
  });
  window.addEventListener('scroll', esconderTooltip, { passive: true });
}

window.addEventListener('DOMContentLoaded', () => {
  inicializarTema();
  const sortSalvo = lerStorage(STORAGE_KEY_PAINEL_SORT, null);
  if (sortSalvo?.key && sortSalvo?.dir) painelState.sort = sortSalvo;
  const densSalva = lerStorage(STORAGE_KEY_PAINEL_DENSITY, 'confortavel');
  painelState.densidade = densSalva === 'compacta' ? 'compacta' : 'confortavel';
  bindEventos();
  carregarValuationJson();
  setInterval(() => {
    if (!document.hidden) carregarValuationJson(true);
  }, 60000);
  setInterval(() => {
    if (!document.hidden && painelState.payload) atualizarStatusBase();
  }, 30000);
});
