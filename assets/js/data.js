/* Painel Executivo de Valuation · leitor e controlador principal (./data/valuation.json)
 * Somente leitura e apresentação: nenhum cálculo de valuation é refeito no cliente.
 */

const STORAGE_KEY_PAINEL_TICKERS = 'painel_valuation_selected_tickers';
const STORAGE_KEY_PAINEL_SORT = 'painel_valuation_sort';
const STORAGE_KEY_PAINEL_DENSITY = 'painel_valuation_density';
const STORAGE_KEY_THEME = 'painel_valuation_theme';
const STORAGE_KEY_COLUNAS = 'painel_valuation_colunas_ajustes';
const STORAGE_KEY_TRIAGEM = 'painel_valuation_triagem';
const COLUNAS_OPCIONAIS = ['dpa', 'falta', 'sustent', 'tend', 'alt', 'tec', 'graham', 'gordon', 'gb'];
const DIAS_BASE_DESATUALIZADA = 3;
const PREGAO_INICIO_MIN = 10 * 60;            // 10h00 BRT
const PREGAO_FIM_MIN = 18 * 60;               // 18h00 BRT
const MINUTOS_BASE_ATRASADA_PREGAO = 25;      // motor roda a cada 10 min; > 25 min = atraso real

const CARTEIRA_EXECUTIVA_PADRAO = [
  'BBAS3', 'ITUB4', 'TAEE11', 'CPFE3', 'EGIE3', 'SBSP3',
  'BBSE3', 'CXSE3', 'VIVT3', 'ISAE4', 'SAPR11', 'CMIG4',
  'VALE3', 'PETR4', 'WEGE3'
];

/* ---------- Análise Técnica (MMA 21, MMA 50, MMA 200, IFR 14 & Score de Tendência) ---------- */

window.calcularAnaliseTecnica = calcularAnaliseTecnica;

function htmlBadgeTecnico(a) {
  const tech = calcularAnaliseTecnica(a);
  if (!tech) return '';
  const tip = `Análise Técnica: ${tech.rotulo} (Score ${tech.score}/100 · IFR ${tech.ifr14 ?? '—'}${tech.sinais.length ? ' · ' + tech.sinais[0] : ''})`;
  const iconeSvg = tech.status === 'bullish'
    ? '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>'
    : (tech.status === 'bearish'
      ? '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>');
  const txt = tech.status === 'bullish' ? 'Bullish' : (tech.status === 'bearish' ? 'Bearish' : 'Neutro');
  return `<span class="badge-tech badge-tech-${tech.status}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span class="badge-tech-icon" aria-hidden="true">${iconeSvg}</span><span>${txt}</span></span>`;
}

const ICONE_VEREDITO = {
  verde: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  amarelo: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>',
  vermelho: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
};

const OPCOES_ORDENACAO = [
  { key: 'margem', dir: 'desc', label: 'Maior margem Bazin' },
  { key: 'margem_consenso', dir: 'desc', label: 'Maior margem Consenso (referência)' },
  { key: 'margem_barsi', dir: 'desc', label: 'Maior margem pelo lucro (LPA × payout médio)' },
  { key: 'faltateto', dir: 'desc', label: 'Menor Preço / Teto' },
  { key: 'tendencia', dir: 'asc', label: 'Maior queda do dividendo (12m / 5a)' },
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
  filtroTech: 'todos',
  triagem: 'todas',
  termo: '',
  sort: { key: 'margem', dir: 'desc' },
  densidade: 'confortavel',
  detalheTicker: null,
  ativoSelecionado: null,
  visaoSalva: 'padrao',
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

window.debounce = debounce;

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

window.hojeIsoSaoPaulo = hojeIsoSaoPaulo;

/* ---------- Persistência & Tema ---------- */

function inicializarTema() {
  let tema = 'dark';
  try {
    if (window.location.search.includes('tema=light') || window.location.hash.includes('tema=light')) {
      tema = 'light';
    } else {
      const salvo = localStorage.getItem(STORAGE_KEY_THEME);
      if (salvo === 'light' || salvo === 'dark') {
        tema = salvo;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        tema = 'light';
      }
    }
  } catch (_) {
    tema = 'dark';
  }
  aplicarTema(tema, false);
}

function aplicarTema(tema, persistir = true) {
  const ehLight = tema === 'light';
  document.documentElement.setAttribute('data-theme', ehLight ? 'light' : 'dark');
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', ehLight ? '#F6F7F9' : '#0F1217');
  }
  const btn = $('#btn-toggle-theme');
  if (btn) {
    btn.setAttribute('aria-pressed', String(ehLight));
    btn.setAttribute('data-tip', ehLight ? 'Alternar para tema escuro' : 'Alternar para tema claro');
    btn.innerHTML = ehLight
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  }
  if (persistir) {
    try { localStorage.setItem(STORAGE_KEY_THEME, ehLight ? 'light' : 'dark'); } catch (_) { /* modo privado */ }
  }
}

function alternarTema() {
  const attr = document.documentElement.getAttribute('data-theme');
  let atual = attr === 'light' || attr === 'dark' ? attr : null;
  if (!atual) {
    atual = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
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
    // Ordem decrescente = mais barato frente ao teto primeiro (menor Preço/Teto).
    case 'faltateto': return a.bazin?.teto > 0 && a.preco > 0 ? -(a.preco / a.bazin.teto) : null;
    case 'tendencia': return a.bazin?.razao_12m_5a;
    case 'margem': return a.bazin?.teto > 0 ? a.bazin?.margem_seguranca : null;
    case 'margem_consenso': return a.margem_consenso ?? a.bazin?.margem_projetada_consenso;
    case 'margem_barsi': return a.margem_barsi ?? a.bazin?.margem_projetada_barsi;
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

/* ---------- Triagens prontas (fluxo Bazin) ---------- */

function definirTriagem(id) {
  painelState.triagem = TRIAGENS[id] ? id : 'todas';
  gravarStorage(STORAGE_KEY_TRIAGEM, painelState.triagem);
  const sel = $('#select-triagem');
  if (sel) sel.value = painelState.triagem;
  renderizarTabela();
}

function ativosVisiveis() {
  const q = painelState.termo.trim().toLowerCase();
  const fv = painelState.filtroVeredito;
  const ft = painelState.filtroTech || 'todos';
  const triagem = TRIAGENS[painelState.triagem] || TRIAGENS.todas;
  const lista = ativosSelecionados().filter(a => {
    if (!passaFiltroSetor(a)) return false;
    if (!triagem.filtro(a)) return false;
    if (fv !== 'todos') {
      if (fv === 'bullish' || fv === 'bearish') {
        const t = calcularAnaliseTecnica(a);
        if (!t || t.status !== fv) return false;
      } else if (a.bazin?.veredito !== fv) {
        return false;
      }
    }
    if (ft !== 'todos') {
      const t = calcularAnaliseTecnica(a);
      if (!t || t.status !== ft) return false;
    }
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
  const minutosBase = infoGerado.dateObj ? Math.max(0, Math.round((Date.now() - infoGerado.dateObj.getTime()) / 60000)) : null;

  // Identifica se a base foi gerada hoje
  const hojeBr = hojeIsoSaoPaulo(); // 'YYYY-MM-DD'
  const partesHoje = hojeBr.split('-');
  const hojeCurta = `${partesHoje[2]}/${partesHoje[1]}`;
  const ehHoje = infoGerado.dataCurta === hojeCurta;

  // Estado do pregão avaliado AGORA (não no momento da geração da base)
  const agoraSp = agoraSaoPaulo();
  const pregaoAberto = agoraSp.diaUtil && agoraSp.minutosDia >= PREGAO_INICIO_MIN && agoraSp.minutosDia < PREGAO_FIM_MIN;
  const atrasada = pregaoAberto && minutosBase !== null && minutosBase > MINUTOS_BASE_ATRASADA_PREGAO;
  const estado = (dias > DIAS_BASE_DESATUALIZADA || atrasada) ? 'is-stale' : 'is-ok';
  const idade = minutosBase !== null ? fmtIdadeBase(minutosBase) : '';

  const pill = $('#status-pill');
  if (pill) {
    pill.classList.remove('is-ok', 'is-stale', 'is-error', 'is-live');
    pill.classList.add(estado);
    if (pregaoAberto && !atrasada) pill.classList.add('is-live');

    const tipStatus = pregaoAberto
      ? (atrasada
        ? `Pregão B3 aberto, mas a base não é atualizada há ${idade} (última sincronização: ${infoGerado.dataCompleta} às ${infoGerado.hora}). O motor deveria atualizar a cada 10 min — verifique a aba Actions do repositório. Clique para buscar de novo.`
        : `Pregão B3 em andamento: cotações (delay de ~15 min da fonte) sincronizadas às ${infoGerado.hora}, há ${idade}. O motor atualiza a cada 10 min; proventos e fundamentos são recalculados a cada hora.`)
      : `Pregão fechado. Base sincronizada em ${infoGerado.dataCompleta} às ${infoGerado.hora} (há ${idade}); última cotação: ${dataUltCotRaw || dataCotCurta}. Atualizações automáticas a cada 10 min nos dias úteis, das 10h às 18h.`;
    pill.setAttribute('data-tip', tipStatus);
  }

  const dataExibir = ehHoje ? infoGerado.hora : `${infoGerado.dataCurta} ${infoGerado.hora}`;
  let statusHtml;
  if (pregaoAberto && !atrasada) {
    statusHtml = `<span class="status-live-dot" aria-hidden="true"></span><span class="status-text-full"><span class="t-green" style="font-weight:600">Pregão B3</span> · <span class="mono">${esc(dataExibir)}</span> · há ${esc(idade)}</span><span class="status-text-mobile mono">${esc(dataExibir)}</span>`;
  } else if (atrasada) {
    statusHtml = `<span class="status-text-full">Base atrasada · <span class="mono">${esc(dataExibir)}</span> · há ${esc(idade)}</span><span class="status-text-mobile">Atrasada</span>`;
  } else {
    statusHtml = `<span class="status-text-full">Cotações B3 · <span class="mono">${esc(dataExibir)}</span></span><span class="status-text-mobile mono">${esc(infoGerado.dataCurta)}</span>`;
  }

  renderizarStatus(estado, statusHtml);

  const footerSinc = $('#footer-data-sinc');
  if (footerSinc) {
    footerSinc.textContent = `Sincronizada em ${infoGerado.dataCompleta} às ${infoGerado.hora}`;
  }
  verificarDadosDefasados();
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
  // Melhor oportunidade = maior margem entre os que passam no filtro de qualidade do dividendo:
  // abaixo do teto, score Forte/Moderado e dividendo recente sem queda (12m ≥ 70% da média 5a).
  const qualificados = ordenadosMargem.filter(passaFiltroQualidade);
  const melhor = qualificados[0] || null;
  const pior = ordenadosMargem.length ? ordenadosMargem[ordenadosMargem.length - 1] : null;
  const pctCompra = total ? Math.round((cont.verde / total) * 100) : 0;
  const mud = mudancasDesdePregao(sel);
  const temSnapshot = !!mud.dataRef;
  const qtdMud = mud.entraram.length + mud.sairam.length + mud.tetoMudou.length;
  const linhaMud = (rotulo, lista, cls) => lista.length
    ? `<span class="${cls}">${rotulo}: ${lista.slice(0, 4).map(esc).join(', ')}${lista.length > 4 ? ` +${lista.length - 4}` : ''}</span>`
    : '';

  el.innerHTML = `
    <div class="kpi is-clickable" data-kpi-verdict="verde" data-tip="Clique para filtrar apenas os papéis negociados abaixo do preço-teto Bazin">
      <div class="kpi-label">
        <span>Em zona de compra</span>
        <span class="verdict verdict-verde"><span class="verdict-icon" aria-hidden="true">▲</span>${pctCompra}%</span>
      </div>
      <div class="kpi-value t-green">${cont.verde}<span class="kpi-value-sub">de ${total} papéis</span></div>
      <div class="kpi-foot">${cont.amarelo} próximos · ${cont.vermelho} acima do teto · margem mediana <span class="mono ${classeMargem(medMargem)}">${fmtPct(medMargem)}</span></div>
    </div>

    <div class="kpi ${melhor ? 'is-clickable' : ''}" ${melhor ? `data-kpi-detail="${esc(melhor.ticker)}"` : ''} data-tip="Maior margem Bazin entre os papéis que passam no filtro de qualidade: abaixo do teto, Score Anti-Cilada Forte ou Moderado e dividendo dos últimos 12 meses ≥ 70% da média de 5 anos. Clique para abrir o Raio-X.">
      <div class="kpi-label">
        <span>Melhor oportunidade qualificada</span>
        ${melhor ? `<span class="mono t-green">${fmtPct(melhor.bazin.margem_seguranca)}</span>` : ''}
      </div>
      <div class="kpi-value">${melhor ? esc(melhor.ticker) : '—'}</div>
      <div class="kpi-foot">${melhor
        ? `Preço ${fmtReal(melhor.preco)} vs. Teto ${fmtReal(melhor.bazin.teto)} · score ${melhor.sustentabilidade?.nota ?? '—'}`
        : (comBazin.length ? 'Nenhum papel abaixo do teto passa no filtro de qualidade' : 'Selecione ativos para comparar')}</div>
    </div>

    <div class="kpi ${qtdMud ? 'is-clickable' : ''}" ${qtdMud ? 'data-kpi-triagem="mudou"' : ''} data-tip="${temSnapshot ? `Mudanças desde o fechamento do pregão de ${esc(fmtDataIso(mud.dataRef))}: papéis que entraram ou saíram da zona de compra e tetos recalculados (novo provento ou revisão). Clique para filtrar.` : 'A comparação com o pregão anterior aparece a partir do primeiro ciclo do próximo pregão.'}">
      <div class="kpi-label"><span>Mudou desde o último pregão</span>${temSnapshot ? `<span class="mono t-dim">${esc(fmtDataIso(mud.dataRef).slice(0, 5))}</span>` : ''}</div>
      <div class="kpi-value">${temSnapshot ? qtdMud : '—'}<span class="kpi-value-sub">${temSnapshot ? (qtdMud === 1 ? 'mudança' : 'mudanças') : ''}</span></div>
      <div class="kpi-foot kpi-foot-stack">${temSnapshot
        ? (qtdMud
          ? [linhaMud('Entraram', mud.entraram, 't-green'), linhaMud('Saíram', mud.sairam, 't-red'), linhaMud('Teto mudou', mud.tetoMudou, 't-yellow')].filter(Boolean).join('')
          : 'Nenhum papel mudou de faixa nem de teto')
        : 'Disponível a partir do próximo pregão'}</div>
    </div>

    <div class="kpi ${pior ? 'is-clickable' : ''}" ${pior ? `data-kpi-detail="${esc(pior.ticker)}"` : ''} data-tip="Papel do painel mais caro em relação ao próprio teto Bazin (maior Preço ÷ Teto). Não é medida de risco do negócio. Clique para abrir o Raio-X.">
      <div class="kpi-label">
        <span>Mais esticado</span>
        ${pior ? `<span class="mono ${classeMargem(pior.bazin.margem_seguranca)}">${fmtMultiplo(pior.preco / pior.bazin.teto)} o teto</span>` : ''}
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

/* Preço ÷ Teto com marcador: escala de 0 a 2× o teto, traço central = teto */
function htmlPrecoTeto(a, falta) {
  const teto = a.bazin?.teto;
  if (!(teto > 0) || !(a.preco > 0)) return '<span class="t-dim">—</span>';
  const r = a.preco / teto;
  const cls = r <= 1 ? 't-green' : (r <= 1.0526 ? 't-yellow' : 't-red');
  const faixa = r <= 1 ? 'is-verde' : (r <= 1.0526 ? 'is-amarelo' : 'is-vermelho');
  const W = 72;
  const x = Math.max(3, Math.min(W - 3, (Math.min(r, 2) / 2) * W));
  const tip = `Preço ${fmtReal(a.preco)} = ${fmtMultiplo(r)} o teto ${fmtReal(teto)} · ${valido(falta) ? (falta >= 0 ? `faltam ${fmtReal(falta)} de folga` : `${fmtReal(-falta)} acima do teto`) : ''}${r > 2 ? ' (fora da escala: acima de 2×)' : ''}`;
  return `
    <div class="pt-cell" data-tip="${esc(tip)}">
      <span class="mono ${cls}">${fmtMultiplo(r)}</span>
      <svg class="pt-svg" width="${W}" height="8" viewBox="0 0 ${W} 8" aria-hidden="true">
        <rect class="pt-trilho" x="0" y="3" width="${W}" height="2" rx="1" />
        <line class="pt-teto" x1="${W / 2}" y1="0" x2="${W / 2}" y2="8" />
        <circle class="pt-ponto ${faixa}" cx="${x}" cy="4" r="3" />
      </svg>
    </div>`;
}

/* DPA 12m ÷ DPA 5a: alerta de dividendo recente em queda */
function htmlTendenciaDividendo(a) {
  const r = a.bazin?.razao_12m_5a;
  if (!valido(r)) return '<span class="t-dim">—</span>';
  let cls = 't-green';
  let rotulo = 'estável';
  if (r < 0.7) { cls = 't-red'; rotulo = 'em queda'; }
  else if (r < 0.95) { cls = 't-yellow'; rotulo = 'oscilando'; }
  else if (r > 1.3) { cls = ''; rotulo = 'acima da média'; }
  const tip = `Últimos 12 meses: ${fmtReal(a.bazin.dpa_12m)} vs. média 5a ${fmtReal(a.bazin.dpa_sem_extra)} (${fmtPctSimples(r, 0)}): ${rotulo}`;
  return `<div class="cell-stack" data-tip="${esc(tip)}"><span class="mono ${cls}">${fmtPctSimples(r, 0)}</span><span class="cell-sub">${rotulo}</span></div>`;
}

function htmlTetosAlternativos(a) {
  const b = a.bazin || {};
  const tl = a.teto_barsi ?? b.teto_projetado_barsi;
  const linha = (rotulo, v, tip) => valido(v) && v > 0
    ? `<span class="alt-teto" data-tip="${esc(tip)}"><span class="cell-sub">${rotulo}</span> <span class="mono ${classeMargem((v - a.preco) / v)}">${fmtReal(v)}</span></span>`
    : '';
  const html = linha('12m', b.teto_12m, 'Teto 12 meses: DPA dos últimos 12 meses ÷ 6%') +
    linha('Lucro', tl, 'Teto pelo lucro: LPA atual × payout médio histórico ÷ 6% (direcional)');
  return html ? `<div class="cell-stack">${html}</div>` : '<span class="t-dim">—</span>';
}

/* Selo de mudança desde o fechamento do pregão anterior (veredito ou teto) */
function htmlMudancaPregao(a) {
  const ant = a.anterior;
  const b = a.bazin || {};
  if (!ant || !(b.teto > 0)) return '';
  if (ant.veredito !== b.veredito) {
    const entrou = b.veredito === 'verde';
    return `<span class="tag tag-mudou ${entrou ? 'is-entrou' : 'is-saiu'}" data-tip="Desde o pregão de ${esc(fmtDataIso(ant.data))}: ${esc(ROTULO_VEREDITO[ant.veredito] || ant.veredito)} → ${esc(ROTULO_VEREDITO[b.veredito] || b.veredito)} (preço ${fmtReal(ant.preco)} → ${fmtReal(a.preco)})">${entrou ? 'Entrou' : 'Mudou'}</span>`;
  }
  if (ant.teto > 0 && Math.abs(b.teto - ant.teto) / ant.teto > 0.005) {
    return `<span class="tag tag-mudou is-teto" data-tip="Teto mudou desde o pregão de ${esc(fmtDataIso(ant.data))}: ${fmtReal(ant.teto)} → ${fmtReal(b.teto)} (novo provento ou revisão do histórico)">Teto Δ</span>`;
  }
  return '';
}

/* Barra divergente centrada no zero via SVG (sem style inline) */
function htmlBarraMargem(m) {
  if (!valido(m) || m === null || m === undefined || isNaN(m)) return '';
  const c = Math.max(-1, Math.min(1, m));
  const largura = Math.max(3, Math.round(Math.abs(c) * 50));
  const cor = m >= 0 ? 'var(--green)' : (m >= -0.05 ? 'var(--yellow)' : 'var(--red)');
  const x = m >= 0 ? 52 : (52 - largura);

  return `
    <svg class="mbar-svg" width="104" height="5" viewBox="0 0 104 5" aria-hidden="true">
      <rect x="0" y="0.5" width="104" height="4" rx="2" fill="var(--bg-elev)" stroke="var(--border)" stroke-width="0.5" />
      <rect x="${x}" y="0.5" width="${largura}" height="4" rx="2" fill="${cor}" />
      <line x1="52" y1="0" x2="52" y2="5" stroke="var(--border-strong)" stroke-width="1" />
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
  if (painelState.triagem && painelState.triagem !== 'todas') chips.push({ tipo: 'triagem', label: `Triagem: ${TRIAGENS[painelState.triagem]?.rotulo || painelState.triagem}` });
  if (painelState.filtroSetor !== 'todos') chips.push({ tipo: 'setor', label: `Setor: ${nomeSetor(painelState.filtroSetor)}` });
  if (painelState.filtroVeredito !== 'todos') chips.push({ tipo: 'veredito', label: `Situação: ${ROTULO_VEREDITO[painelState.filtroVeredito]}` });
  if (painelState.filtroTech && painelState.filtroTech !== 'todos') chips.push({ tipo: 'tech', label: `Técnica: ${painelState.filtroTech === 'bullish' ? 'Bullish' : 'Bearish'}` });
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
      <tr class="row-empty"><td colspan="15" class="empty">
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
      <tr class="row-empty"><td colspan="15" class="empty">
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
      ? `<span class="tag tag-extra" data-tip="${anosAtipicosAtivo(b).length ? `Ano(s) atípico(s) removido(s) do teto: ${anosAtipicosAtivo(b).join(', ')} (pagamento acima de 2× o patamar recorrente). ` : 'Há dividendos extraordinários nos 5 anos. '}DPA c/ extra: ${fmtReal(b.dpa)} · s/ extra: ${fmtReal(b.dpa_sem_extra)}">Extra</span>`
      : '';
    const catTag = cat === 'demais' ? `<span class="tag tag-demais">Demais</span>` : '';
    const dpaCell = b.tem_extraordinario
      ? `<div class="cell-stack"><span>${fmtReal(b.dpa_sem_extra)}</span><span class="cell-sub">c/ extra ${fmtReal(b.dpa)}</span></div>`
      : fmtReal(b.dpa_sem_extra);
    const faltaCell = htmlPrecoTeto(a, falta);
    const textoMargem = valido(m) && m < -1 && a.preco > 0
      ? `${fmtMultiplo(a.preco / b.teto)} o teto`
      : fmtPct(m);
    const mudou = htmlMudancaPregao(a);

    const isSelected = painelState.ativoSelecionado === a.ticker;

    return `
      <tr class="row ${isSelected ? 'is-selected' : ''}" data-ticker="${esc(a.ticker)}" tabindex="0">
        <td class="c-ticker" data-label="Ativo">
          <div class="asset-cell-wrap">
            <div class="asset">
              <span class="asset-ticker" ${a.empresa ? `data-tip="${esc(a.empresa)}"` : ''}>${esc(a.ticker)} ${extra} ${mudou}</span>
              <span class="asset-sector">${esc(a.empresa || a.setor)} ${catTag}</span>
            </div>
            ${htmlSparkline12m(a)}
          </div>
        </td>
        <td class="num c-preco" data-label="Preço">${fmtReal(a.preco)}</td>
        <td class="num c-dpa" data-label="DPA 5a">${dpaCell}</td>
        <td class="num c-teto" data-label="Teto Bazin">
          <div class="c-teto-stack">
            <span class="teto-val-hist">${b.teto > 0 ? fmtReal(b.teto) : '<span class="t-dim" data-tip="Sem DPA recorrente nos últimos 5 anos fechados">—</span>'}</span>
          </div>
        </td>
        <td class="num c-falta" data-label="Preço / Teto">${faltaCell}</td>
        <td class="num c-margem" data-label="Margem Bazin">
          <div class="margin-cell" data-tip="Preço ${fmtReal(a.preco)} vs. Teto Bazin ${fmtReal(b.teto)}">
            <span class="margin-val ${classeMargem(m)}">${textoMargem}</span>
            ${htmlBarraMargem(m)}
          </div>
        </td>
        <td class="c-verdict" data-label="Situação">${b.teto > 0 ? htmlVeredito(b.veredito) : '<span class="tag">Sem teto Bazin</span>'}</td>
        <td class="c-sustent" data-label="Anti-Cilada">${htmlSustentabilidadeTabela(a)}</td>
        <td class="num c-tend" data-label="Div. 12m / 5a">${htmlTendenciaDividendo(a)}</td>
        <td class="num c-alt" data-label="Tetos alternativos">${htmlTetosAlternativos(a)}</td>
        <td class="c-tec" data-label="Técnica">${htmlBadgeTecnico(a) || '<span class="t-dim">—</span>'}</td>
        <td class="num c-graham" data-label="Graham">${valido(a.graham) ? fmtReal(a.graham) : '<span class="t-dim">—</span>'}</td>
        <td class="num c-gordon" data-label="Gordon">${valido(a.gordon) ? fmtReal(a.gordon) : '<span class="t-dim">—</span>'}</td>
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

  if (!painelState.ativoSelecionado && lista.length) {
    selecionarAtivoMasterDetail(lista[0].ticker, false);
  } else if (painelState.ativoSelecionado) {
    const selRow = tbody.querySelector(`tr.row[data-ticker="${painelState.ativoSelecionado}"]`);
    if (selRow) selRow.classList.add('is-selected');
    renderizarDetalhe(painelState.ativoSelecionado);
  }
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
  const tc = a.teto_consenso ?? a.bazin?.teto_projetado_consenso;
  const tb = a.teto_barsi ?? a.bazin?.teto_projetado_barsi;

  // Modelos principais para o método Bazin. Consenso (lucro projetado do Yahoo) e Gordon (k fixo)
  // ficam em "Outros modelos", como referência teórica.
  const modelos = [
    { nome: 'Teto Bazin (5a)', valor: a.bazin?.teto > 0 ? a.bazin.teto : null, cor: '#06b6d4' },
    { nome: 'Teto 12 meses', valor: a.bazin?.teto_12m > 0 ? a.bazin.teto_12m : null, cor: '#22d3ee' },
    { nome: 'Teto pelo lucro', valor: (tb && tb > 0) ? tb : null, cor: '#f97316' },
    { nome: 'Graham', valor: a.graham, cor: '#a855f7' }
  ];
  void tc;
  const valores = [a.preco, ...modelos.map(m => m.valor)].filter(valido);
  const max = Math.max(...valores, 1) * 1.12;
  const xBase = 110;
  const wMax = 220;
  const xPreco = xBase + Math.round((a.preco / max) * wMax);
  const totalH = 20 + modelos.length * 26;

  const linhasSvg = modelos.map((m, idx) => {
    const y = 14 + idx * 26;
    const w = valido(m.valor) ? Math.max(3, Math.round((m.valor / max) * wMax)) : 0;
    const txtVal = valido(m.valor) ? fmtReal(m.valor) : '—';
    return `
      <text x="0" y="${y + 9}" fill="var(--muted)" font-family="var(--sans)" font-size="11" font-weight="500">${esc(m.nome)}</text>
      <rect x="${xBase}" y="${y}" width="${wMax}" height="10" rx="5" fill="var(--surface)" />
      ${w > 0 ? `<rect x="${xBase}" y="${y}" width="${w}" height="10" rx="5" fill="${m.cor}" />` : ''}
      <text x="418" y="${y + 9}" text-anchor="end" fill="var(--text-strong)" font-family="var(--mono)" font-size="11" font-weight="600">${esc(txtVal)}</text>
    `;
  }).join('');

  return `
    <div class="d-block">
      <div class="d-section-title">Preço vs. valor justo por modelo</div>
      <svg class="vsvg" viewBox="0 0 420 ${totalH}" width="100%" height="${totalH}" style="max-width: 100%; height: auto; display: block;" role="img" aria-label="Comparativo entre preço atual e preços-teto">
        ${linhasSvg}
        <line x1="${xPreco}" y1="6" x2="${xPreco}" y2="${totalH - 8}" stroke="var(--text-strong)" stroke-width="2" stroke-dasharray="3 2" />
      </svg>
      <p class="d-note">Linha tracejada vertical = preço atual (${fmtReal(a.preco)}). Barras à direita da linha indicam preço-teto acima da cotação.</p>
    </div>`;
}

/* Modelos secundários: referência teórica, recolhidos por padrão. Nenhum entra no veredito. */
function htmlOutrosModelos(a) {
  const b = a.bazin || {};
  const f = a.fundamentos || {};
  const tc = a.teto_consenso ?? b.teto_projetado_consenso;
  const mc = a.margem_consenso ?? b.margem_projetada_consenso;
  const linha = (rotulo, valor, margemV, nota) => `
    <dt>${rotulo}</dt>
    <dd>${valido(valor) && valor > 0 ? `${fmtReal(valor)} <span class="${classeMargem(margemV)}">(${fmtPct(margemV)})</span>` : '—'}</dd>
    <dd class="d-outros-nota">${nota}</dd>`;
  const gb = valido(a.rank_greenblatt) ? `#${a.rank_greenblatt}` : (a.motivo_exclusao_greenblatt || 'Fora do ranking');
  return `
    <details class="d-block d-outros">
      <summary class="d-section-title">Outros modelos (referência teórica)</summary>
      <dl class="kv d-outros-kv">
        ${linha('Teto Consenso', tc, mc, `Lucro projetado pelo mercado (Yahoo, LPA ${f.forward_eps ? fmtReal(f.forward_eps) : '—'}) × payout médio ÷ 6%. A cobertura de analistas para a B3 nessa fonte é irregular.`)}
        ${linha('Preço justo Gordon', a.gordon, a.margem_gordon, `DPA 5a × (1 + g) ÷ (k − g), com k = 10% fixo e g = ${valido(f.g_perpetuidade) ? fmtPctSimples(f.g_perpetuidade, 1) : '—'}. Muito sensível a k: com a Selic em dois dígitos, k de 10% tende a superestimar.`)}
        <dt>Greenblatt</dt><dd>${esc(String(gb))}</dd>
        <dd class="d-outros-nota">Fórmula Mágica (EBIT/EV + ROIC) sobre o universo; é um ranking de qualidade e preço, não de dividendos.</dd>
      </dl>
    </details>`;
}

function htmlFichaRealidade(a) {
  const b = a.bazin || {};
  if (!(b.teto > 0) && !(b.dpa_12m > 0)) return '';

  const tetoLucro = a.teto_barsi ?? b.teto_projetado_barsi;
  const tetos = [
    { id: 'oficial', nome: 'Teto 5 anos', sub: 'Oficial (veredito)', tip: 'Média dos proventos recorrentes dos 5 anos fechados ÷ 6%. É o único que define o veredito.', valor: b.teto, m: b.margem_seguranca },
    { id: '12m', nome: 'Teto 12 meses', sub: `DPA ${valido(b.dpa_12m) ? fmtReal(b.dpa_12m) : '—'}`, tip: 'Proventos com data-com nos últimos 12 meses ÷ 6%. Mostra se o patamar recente sustenta o teto oficial.', valor: b.teto_12m, m: b.margem_12m },
    { id: 'lucro', nome: 'Teto pelo lucro', sub: 'LPA × payout médio', tip: 'Lucro por ação atual × payout médio histórico ÷ 6%. Indica o que o lucro de hoje comportaria pagar (direcional).', valor: tetoLucro, m: valido(tetoLucro) && tetoLucro > 0 && a.preco > 0 ? (tetoLucro - a.preco) / tetoLucro : null }
  ];
  const cards = tetos.map(t => `
    <div class="frd-teto ${t.id === 'oficial' ? 'is-oficial' : ''}" data-tip="${esc(t.tip)}">
      <div class="frd-teto-nome">${esc(t.nome)}</div>
      <div class="frd-teto-valor mono">${valido(t.valor) && t.valor > 0 ? fmtReal(t.valor) : '—'}</div>
      <div class="frd-teto-margem mono ${classeMargem(t.m)}">${valido(t.m) ? fmtPct(t.m) : '—'}</div>
      <div class="frd-teto-sub">${esc(t.sub)}</div>
    </div>`).join('');

  // Alertas: dividendo recente em queda e anos atípicos removidos do DPA.
  const alertas = [];
  const r = b.razao_12m_5a;
  if (valido(r) && b.dpa_sem_extra > 0) {
    if (r < 0.7) {
      alertas.push(`<div class="frd-alerta is-risco"><strong>Dividendo recente em queda.</strong> Os últimos 12 meses pagaram ${fmtPctSimples(r, 0)} da média de 5 anos. O teto oficial se apoia em um patamar que a empresa não está repetindo; confirme se é corte ou só calendário (data-com que ainda não saiu).</div>`);
    } else if (r > 1.3) {
      alertas.push(`<div class="frd-alerta is-info"><strong>Dividendo recente acima da média.</strong> Os últimos 12 meses pagaram ${fmtPctSimples(r, 0)} da média de 5 anos (verifique se há pagamento pontual).</div>`);
    }
  }
  const atip = anosAtipicosAtivo(b);
  if (atip.length) {
    const lista = atip.map(ano => `${ano} (${fmtReal(b.anos_atipicos[String(ano)])} acima do patamar)`).join(', ');
    alertas.push(`<div class="frd-alerta is-aviso"><strong>Ano atípico removido do teto:</strong> ${esc(lista)}. O excedente sobre a mediana dos anos pagos foi tratado como extraordinário. Teto incluindo tudo: ${fmtReal(b.teto_com_extra)}.</div>`);
  }

  return `
    <div class="d-block frd">
      <div class="d-section-title">Realidade do dividendo</div>
      <div class="frd-tetos">${cards}</div>
      ${alertas.join('')}
      ${htmlBarrasDpaAnual(a)}
    </div>`;
}

function htmlBarrasDpaAnual(a) {
  const b = a.bazin || {};
  const provs = Array.isArray(a.proventos_historico) ? a.proventos_historico : [];
  if (!provs.length) return '';

  const anoAtual = Number(hojeIsoSaoPaulo().slice(0, 4));
  const atipicos = b.anos_atipicos || {};
  const janela = new Set(Object.keys(b.por_ano || {}).map(Number));
  const porAno = new Map();
  provs.forEach(p => {
    const ano = Number(String(p.data_com).slice(0, 4));
    if (!ano || !(p.valor > 0)) return;
    const reg = porAno.get(ano) || { total: 0, extra: 0 };
    reg.total += p.valor;
    if (p.tipo === 'extraordinario') reg.extra += p.valor;
    porAno.set(ano, reg);
  });
  Object.entries(atipicos).forEach(([ano, exc]) => {
    const reg = porAno.get(Number(ano));
    if (reg) reg.extra = Math.min(reg.total, reg.extra + exc);
  });
  const anos = [...porAno.keys()].sort((x, y) => x - y).slice(-11);
  if (!anos.length) return '';

  const maxVal = Math.max(...anos.map(an => porAno.get(an).total), b.dpa_sem_extra || 0, 0.01) * 1.1;
  const W = 420, H = 150, base = 120, topo = 14, alt = base - topo;
  const passo = W / anos.length;
  const larg = Math.min(26, passo * 0.62);
  const yDe = v => base - (v / maxVal) * alt;

  const barras = anos.map((ano, i) => {
    const reg = porAno.get(ano);
    const rec = Math.max(0, reg.total - reg.extra);
    const x = i * passo + (passo - larg) / 2;
    const parcial = ano === anoAtual;
    const hRec = (rec / maxVal) * alt;
    const hExt = (reg.extra / maxVal) * alt;
    const classeRec = parcial ? 'frd-bar-parcial' : (janela.has(ano) ? 'frd-bar-janela' : 'frd-bar-rec');
    const tip = `${ano}${parcial ? ' (ano em curso)' : ''}: ${fmtReal(reg.total)} pagos${reg.extra > 0 ? ` · ${fmtReal(reg.extra)} extraordinário/atípico` : ''}`;
    return `
      <g data-tip="${esc(tip)}">
        <rect x="${x}" y="${topo}" width="${larg}" height="${alt}" fill="transparent" />
        <rect class="${classeRec}" x="${x}" y="${base - hRec}" width="${larg}" height="${Math.max(hRec, 0.5)}" rx="2" />
        ${hExt > 0 ? `<rect class="frd-bar-extra" x="${x}" y="${base - hRec - hExt}" width="${larg}" height="${hExt}" rx="2" />` : ''}
        <text x="${x + larg / 2}" y="${base + 14}" text-anchor="middle" class="frd-eixo">${parcial ? `${String(ano).slice(2)}*` : String(ano).slice(2)}</text>
      </g>`;
  }).join('');

  const linhas = [];
  if (b.dpa_sem_extra > 0) {
    const y = yDe(b.dpa_sem_extra);
    linhas.push(`<line class="frd-linha-5a" x1="0" x2="${W}" y1="${y}" y2="${y}" /><text class="frd-rotulo-5a" x="${W}" y="${y - 4}" text-anchor="end">média 5a ${esc(fmtReal(b.dpa_sem_extra))}</text>`);
  }
  if (b.dpa_12m > 0) {
    const y = yDe(b.dpa_12m);
    linhas.push(`<line class="frd-linha-12m" x1="0" x2="${W}" y1="${y}" y2="${y}" /><text class="frd-rotulo-12m" x="2" y="${y - 4}">12 meses ${esc(fmtReal(b.dpa_12m))}</text>`);
  }

  return `
    <div class="d-sub-chart">
      <div class="d-sub-title">Proventos por ano da data-com (R$ por ação)</div>
      <svg class="vsvg frd-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Proventos por ano, com parcela extraordinária destacada e médias de 5 anos e 12 meses">
        <line class="frd-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />
        ${barras}
        ${linhas.join('')}
      </svg>
      <div class="frd-legenda">
        <span><i class="frd-sw frd-bar-janela"></i>Recorrente (janela do teto)</span>
        <span><i class="frd-sw frd-bar-rec"></i>Recorrente (anos anteriores)</span>
        <span><i class="frd-sw frd-bar-extra"></i>Extraordinário / atípico</span>
        <span><i class="frd-sw frd-bar-parcial"></i>Ano em curso*</span>
      </div>
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

function htmlBlocoAnaliseTecnicaEFluxoCaixa(a) {
  const tech = calcularAnaliseTecnica(a);
  const f = a.fundamentos || {};
  const ehBanco = a.setor && String(a.setor).toLowerCase().includes('banco');

  let blocoTech = '';
  if (tech) {
    const sinaisHtml = tech.sinais.length
      ? tech.sinais.map(s => `<li class="d-tech-signal-item">${esc(s)}</li>`).join('')
      : '<li class="d-tech-signal-item t-muted">Sem alertas técnicos atípicos no momento.</li>';

    const ifrClass = tech.ifr14 < 30 ? 't-green' : (tech.ifr14 > 70 ? 't-yellow' : '');
    const ifrDesc = tech.ifr14 < 30 ? ' (Sobrevendido)' : (tech.ifr14 > 70 ? ' (Sobrecomprado)' : ' (Neutro)');

    blocoTech = `
      <div class="d-block">
        <div class="d-section-title">Análise Técnica &amp; Momentum (Semanal)</div>
        <div class="d-tech-hero">
          <div class="d-tech-score-wrap">
            <span class="d-tech-badge badge-tech-${tech.status}">${tech.status === 'bullish' ? '▲ Bullish' : (tech.status === 'bearish' ? '▼ Bearish' : '● Neutro')}</span>
            <div class="d-tech-meter-bar">
              <div class="d-tech-meter-fill fill-${tech.status}" style="width: ${tech.score}%"></div>
            </div>
            <span class="d-tech-score-text">Score Técnico: <strong>${tech.score}</strong>/100</span>
          </div>
          <div class="d-tech-kpis">
            <div class="d-mult-card">
              <span class="d-mult-label">IFR (14 Semanas)</span>
              <span class="d-mult-val ${ifrClass}">${tech.ifr14 !== null ? tech.ifr14 : '—'}<small>${tech.ifr14 !== null ? ifrDesc : ''}</small></span>
              <span class="d-mult-sub">&lt;30 Compra · &gt;70 Venda</span>
            </div>
            <div class="d-mult-card">
              <span class="d-mult-label">MMA 21 Semanas</span>
              <span class="d-mult-val ${tech.mma21 ? (a.preco >= tech.mma21 ? 't-green' : 't-red') : ''}">${tech.mma21 ? fmtReal(tech.mma21) : '—'}</span>
              <span class="d-mult-sub">Curto/Médio Prazo</span>
            </div>
            <div class="d-mult-card">
              <span class="d-mult-label">MMA 50 Semanas</span>
              <span class="d-mult-val ${tech.mma50 ? (a.preco >= tech.mma50 ? 't-green' : 't-red') : ''}">${tech.mma50 ? fmtReal(tech.mma50) : '—'}</span>
              <span class="d-mult-sub">Médio Prazo (~1 ano)</span>
            </div>
            <div class="d-mult-card">
              <span class="d-mult-label">MMA 200 Semanas</span>
              <span class="d-mult-val ${tech.mma200 ? (a.preco >= tech.mma200 ? 't-green' : 't-red') : ''}">${tech.mma200 ? fmtReal(tech.mma200) : '—'}</span>
              <span class="d-mult-sub">Longo Prazo (~4 anos)</span>
            </div>
          </div>
        </div>
        <div class="d-tech-signals">
          <span class="d-tech-signals-label">Diagnóstico de Tendência:</span>
          <ul class="d-tech-signals-list">${sinaisHtml}</ul>
        </div>
      </div>
    `;
  }

  const fcf12m = f.fcf_12m;
  const fco12m = f.fco_12m;
  const capex12m = f.capex_12m;
  const fcfYield = f.fcf_yield;
  const conv = f.conversao_fcf_lucro;

  const convClass = valido(conv) ? (conv >= 0.8 ? 't-green' : (conv >= 0.4 ? 't-yellow' : 't-red')) : 't-dim';
  const yieldClass = valido(fcfYield) ? (fcfYield >= 0.08 ? 't-green' : (fcfYield >= 0.04 ? 't-yellow' : '')) : 't-dim';

  const blocoCashflow = `
    <div class="d-block">
      <div class="d-section-title">Demonstração do Fluxo de Caixa (DFC &amp; FCF)</div>
      ${ehBanco ? `
        <p class="d-note">Bancos e instituições financeiras não possuem CAPEX industrial nem métrica padronizada de FCF livre; seu resultado é gerido pela intermediação financeira e provisões.</p>
      ` : `
        <div class="d-mult-grid">
          <div class="d-mult-card" data-tip="Fluxo de Caixa Livre (12m): Caixa operacional gerado subtraído dos investimentos em capital (Capex).">
            <span class="d-mult-label">FCF (Livre 12M)</span>
            <span class="d-mult-val ${valido(fcf12m) ? (fcf12m > 0 ? 't-green' : 't-red') : 't-dim'}">${fmtMoedaCompacta(fcf12m)}</span>
            <span class="d-mult-sub">FCO − CAPEX</span>
          </div>
          <div class="d-mult-card" data-tip="FCF Yield: Rendimento do Fluxo de Caixa Livre sobre o Valor de Mercado. Acima de 8% indica alta capacidade de remuneração.">
            <span class="d-mult-label">FCF Yield</span>
            <span class="d-mult-val ${yieldClass}">${fmtPctSimples(fcfYield)}</span>
            <span class="d-mult-sub">FCF ÷ Valor de Mercado</span>
          </div>
          <div class="d-mult-card" data-tip="Fluxo de Caixa Operacional (FCO 12m): Dinheiro efetivamente gerado pelas operações da empresa.">
            <span class="d-mult-label">FCO (Operacional 12M)</span>
            <span class="d-mult-val">${fmtMoedaCompacta(fco12m)}</span>
            <span class="d-mult-sub">Geração Bruta de Caixa</span>
          </div>
          <div class="d-mult-card" data-tip="Conversão de Lucro em Caixa: FCF dividido pelo Lucro Líquido. Quanto maior que 80%, maior a qualidade dos lucros (sem artifícios contábeis).">
            <span class="d-mult-label">Conversão Caixa/Lucro</span>
            <span class="d-mult-val ${convClass}">${fmtPctSimples(conv)}</span>
            <span class="d-mult-sub">Qualidade do Lucro</span>
          </div>
        </div>
        <dl class="kv" style="margin-top: 10px;">
          <dt>Capex 12M (Investimentos)</dt><dd>${fmtMoedaCompacta(capex12m)}</dd>
          <dt>Qualidade dos Lucros Contábeis</dt>
          <dd>${valido(conv) ? (conv >= 0.8 ? '<span class="t-green">Alta (Gera caixa real)</span>' : (conv >= 0.4 ? '<span class="t-yellow">Média (Consome capital)</span>' : '<span class="t-red">Alerta (Descolamento lucro/caixa)</span>')) : '—'}</dd>
        </dl>
      `}
    </div>
  `;

  return `${blocoTech}${blocoCashflow}`;
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

    ${htmlFichaRealidade(a)}

    ${htmlComparativoModelos(a)}

    ${htmlBlocoAnaliseTecnicaEFluxoCaixa(a)}

    ${htmlBlocoAgendaProventos(a)}

    ${htmlBlocoSustentabilidade(a)}

    ${htmlOutrosModelos(a)}

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
        <dt>Dividendos extraordinários</dt><dd>${b.tem_extraordinario ? `<span class="t-yellow">Sim${anosAtipicosAtivo(b).length ? ` (atípico: ${anosAtipicosAtivo(b).join(', ')})` : ''}</span>` : 'Não'}</dd>
        <dt>DPA últimos 12 meses</dt><dd>${valido(b.dpa_12m) ? fmtReal(b.dpa_12m) : '—'}</dd>
        <dt>DPA 12m ÷ DPA 5a</dt><dd class="${valido(b.razao_12m_5a) && b.razao_12m_5a < 0.7 ? 't-red' : ''}">${valido(b.razao_12m_5a) ? fmtPctSimples(b.razao_12m_5a, 0) : '—'}</dd>
      </dl>
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
          <dd class="${classeAlavancagem(f.div_liq_ebitda, 3.2, 4.2)}">${valido(f.div_liq_ebitda) ? (f.div_liq_ebitda < 0 ? `${fmtMult(f.div_liq_ebitda)} (Caixa Líq.)` : fmtMult(f.div_liq_ebitda)) : '—'}</dd>
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

function selecionarAtivoMasterDetail(ticker, abrirMobile = true) {
  if (!ticker) return;
  ticker = ticker.toUpperCase();
  painelState.ativoSelecionado = ticker;
  document.querySelectorAll('#engine-valuation-tbody tr.row').forEach(tr => {
    tr.classList.toggle('is-selected', tr.dataset.ticker === ticker);
  });
  renderizarDetalhe(ticker);

  if (abrirMobile && window.innerWidth <= 1100) {
    const pane = $('#master-detail-pane');
    if (pane) pane.classList.add('is-open');
    document.body.classList.add('no-scroll');
  }
}

function fecharPainelRaioXMobile() {
  const pane = $('#master-detail-pane');
  if (pane) pane.classList.remove('is-open');
  document.body.classList.remove('no-scroll');
}

function abrirDetalhe(ticker) {
  selecionarAtivoMasterDetail(ticker, true);
}
window.abrirDetalhe = abrirDetalhe;
window.abrirDetalheAtivo = abrirDetalhe;
window.selecionarAtivoMasterDetail = selecionarAtivoMasterDetail;
window.fecharPainelRaioXMobile = fecharPainelRaioXMobile;
window.obterTickersPainelAtivo = () => [...painelState.selecionados];

/* ---------- Sistema de Notificação Toast com Desfazer ---------- */

function mostrarToast(mensagem, rotuloAcao = null, onAcao = null) {
  const container = $('#app-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.setAttribute('role', 'alert');

  let acaoHtml = '';
  if (rotuloAcao && onAcao) {
    acaoHtml = `<button type="button" class="app-toast-undo">${esc(rotuloAcao)}</button>`;
  }
  toast.innerHTML = `<span>${esc(mensagem)}</span>${acaoHtml}`;

  if (rotuloAcao && onAcao) {
    toast.querySelector('.app-toast-undo').addEventListener('click', () => {
      onAcao();
      toast.remove();
    });
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 180ms ease';
    setTimeout(() => toast.remove(), 200);
  }, 4500);
}

function ocultarTickerComUndo(ticker) {
  if (!ticker) return;
  ticker = ticker.toUpperCase();
  const index = painelState.selecionados.indexOf(ticker);
  if (index === -1) return;
  painelState.selecionados.splice(index, 1);
  salvarSelecionados(painelState.selecionados);
  renderizarBesst();
  renderizarTabela();
  sincronizarEstadoUrl();
  mostrarToast(`Ativo ${ticker} ocultado do painel`, 'Desfazer', () => {
    if (!painelState.selecionados.includes(ticker)) {
      painelState.selecionados.splice(index, 0, ticker);
      salvarSelecionados(painelState.selecionados);
      renderizarBesst();
      renderizarTabela();
      sincronizarEstadoUrl();
    }
  });
}

/* ---------- Visões Salvas & Customização de Colunas ---------- */

function aplicarVisaoSalva(tipo) {
  painelState.visaoSalva = tipo;
  try { localStorage.setItem('painel_valuation_saved_view', tipo); } catch(e) {}
  const tabela = $('#engine-valuation-table');
  if (!tabela) return;
  COLUNAS_OPCIONAIS.forEach(c => tabela.classList.remove(`hide-col-${c}`));

  // Base de toda visão: tetos alternativos, sinal técnico e modelos de referência (Gordon,
  // Greenblatt) ficam ocultos. A visão "Valuation" reexibe os modelos para comparação.
  tabela.classList.add('hide-col-alt', 'hide-col-tec', 'hide-col-gordon', 'hide-col-gb');
  if (tipo === 'valuation') {
    tabela.classList.add('hide-col-dpa');
    tabela.classList.remove('hide-col-alt', 'hide-col-gordon', 'hide-col-gb');
  } else if (tipo === 'dividendos') {
    tabela.classList.add('hide-col-graham', 'hide-col-gordon', 'hide-col-gb');
  } else if (tipo === 'qualidade') {
    tabela.classList.add('hide-col-dpa', 'hide-col-falta');
  }
  // Ajustes manuais do menu "Colunas" valem sobre a visão até ela ser trocada.
  const ajustes = lerStorage(STORAGE_KEY_COLUNAS, {});
  Object.entries(ajustes || {}).forEach(([col, visivel]) => {
    if (COLUNAS_OPCIONAIS.includes(col)) tabela.classList.toggle(`hide-col-${col}`, !visivel);
  });
  sincronizarCheckboxesColunas();
}

function sincronizarCheckboxesColunas() {
  const tabela = $('#engine-valuation-table');
  if (!tabela) return;
  document.querySelectorAll('#cols-menu input[data-col]').forEach(chk => {
    const col = chk.dataset.col;
    chk.checked = !tabela.classList.contains(`hide-col-${col}`);
  });
}

function definirFiltroTech(tech) {
  painelState.filtroTech = tech;
  document.querySelectorAll('#tech-signal-filter .seg-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tech === tech);
  });
  renderizarTabela();
}

/* ---------- Paleta de Comandos (Ctrl+K) ---------- */

let cmdPaletteSelectedIndex = 0;
let cmdPaletteItems = [];

function abrirCommandPalette() {
  const modal = $('#cmd-palette-backdrop');
  if (!modal) return;
  modal.classList.remove('is-hidden');
  const input = $('#cmd-palette-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  renderizarResultadosComandos('');
  document.body.classList.add('no-scroll');
}

function fecharCommandPalette() {
  const modal = $('#cmd-palette-backdrop');
  if (!modal) return;
  modal.classList.add('is-hidden');
  document.body.classList.remove('no-scroll');
}

function renderizarResultadosComandos(termo) {
  const container = $('#cmd-palette-results');
  if (!container) return;
  const q = (termo || '').trim().toLowerCase();
  cmdPaletteItems = [];

  const tickers = painelState.universo
    .filter(a => !q || a.ticker.toLowerCase().includes(q) || (a.empresa || '').toLowerCase().includes(q) || a.setor.toLowerCase().includes(q))
    .slice(0, 8)
    .map(a => ({
      tipo: 'ticker',
      id: a.ticker,
      titulo: `${a.ticker} · ${a.empresa || a.setor}`,
      sub: `Preço: ${fmtReal(a.preco)} · Teto: ${fmtReal(a.bazin?.teto)} · Margem: ${fmtPct(a.bazin?.margem_seguranca)}`,
      executar: () => {
        if (typeof window.definirAbaPainel === 'function') window.definirAbaPainel('tabela');
        selecionarAtivoMasterDetail(a.ticker, true);
        const row = document.querySelector(`tr.row[data-ticker="${a.ticker}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }));

  const abas = [
    { id: 'tabela', titulo: 'Ir para Tabela & Triagem', sub: 'Visão executiva em lista com Raio-X' },
    { id: 'visual', titulo: 'Ir para Gráficos & Simulador', sub: 'Histórico de preços, tetos e rendimento acumulado' },
    { id: 'matriz', titulo: 'Ir para Matriz Desconto × Qualidade', sub: 'Gráfico de dispersão Margem vs. ROE/ROIC' },
    { id: 'calendario', titulo: 'Ir para Calendário de Proventos', sub: 'Datas-com abertas, pagamentos e sazonalidade' },
    { id: 'carteira', titulo: 'Ir para Carteira & Renda', sub: 'Posições, renda projetada, concentração por setor e aporte do mês' }
  ].filter(ab => !q || ab.titulo.toLowerCase().includes(q) || ab.sub.toLowerCase().includes(q))
    .map(ab => ({
      tipo: 'aba',
      id: ab.id,
      titulo: ab.titulo,
      sub: ab.sub,
      executar: () => {
        if (typeof window.definirAbaPainel === 'function') window.definirAbaPainel(ab.id);
      }
    }));

  const acoes = [
    { titulo: 'Alternar Tema Claro / Escuro', sub: 'Alterna entre o tema Dark e Light', executar: alternarTema },
    { titulo: 'Densidade: Confortável', sub: 'Espaçamento generoso para leitura executiva', executar: () => { painelState.densidade = 'confortavel'; gravarStorage(STORAGE_KEY_PAINEL_DENSITY, 'confortavel'); renderizarCabecalho(); } },
    { titulo: 'Densidade: Compacta', sub: 'Maior densidade de linhas por tela', executar: () => { painelState.densidade = 'compacta'; gravarStorage(STORAGE_KEY_PAINEL_DENSITY, 'compacta'); renderizarCabecalho(); } },
    { titulo: 'Filtro: Abaixo do Teto (Verde)', sub: 'Exibe apenas ações com margem de segurança positiva', executar: () => { if (typeof window.definirAbaPainel === 'function') window.definirAbaPainel('tabela'); definirFiltroVeredito('verde'); } },
    { titulo: 'Filtro: Próximo do Teto (Amarelo)', sub: 'Exibe ações com preço a até 5% do teto', executar: () => { if (typeof window.definirAbaPainel === 'function') window.definirAbaPainel('tabela'); definirFiltroVeredito('amarelo'); } },
    { titulo: 'Filtro: Limpar Filtros', sub: 'Restaura a visualização de todos os ativos', executar: limparFiltros },
    { titulo: 'Exportar Tabela em CSV', sub: 'Baixa arquivo CSV dos ativos visíveis', executar: exportarTabelaCsv },
    { titulo: 'Abrir Calculadora Bazin ↗', sub: 'Ferramenta para cálculo manual de tetos', executar: () => { window.open('./CalculadoraBazin.html', '_blank'); } }
  ].filter(ac => !q || ac.titulo.toLowerCase().includes(q) || ac.sub.toLowerCase().includes(q))
    .map(ac => ({ tipo: 'acao', ...ac }));

  cmdPaletteItems = [...tickers, ...abas, ...acoes];
  cmdPaletteSelectedIndex = 0;

  if (!cmdPaletteItems.length) {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">Nenhum resultado encontrado para "${esc(q)}".</div>`;
    return;
  }

  container.innerHTML = cmdPaletteItems.map((item, idx) => `
    <div class="cmd-item ${idx === 0 ? 'is-selected' : ''}" data-cmd-idx="${idx}" role="option" aria-selected="${idx === 0}">
      <div>
        <div style="font-weight:600;color:var(--text-strong)">${esc(item.titulo)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(item.sub)}</div>
      </div>
      <span style="font-size:11px;text-transform:uppercase;color:var(--dim);letter-spacing:0.04em">${item.tipo}</span>
    </div>
  `).join('');
}

function executarComandoSelecionado() {
  if (cmdPaletteItems[cmdPaletteSelectedIndex]) {
    cmdPaletteItems[cmdPaletteSelectedIndex].executar();
    fecharCommandPalette();
  }
}

function verificarDadosDefasados() {
  const geradoIso = painelState.payload?.gerado_em;
  if (!geradoIso) return;
  const gerado = new Date(geradoIso);
  const agora = new Date();
  const diffDias = (agora - gerado) / (1000 * 60 * 60 * 24);
  const banner = $('#engine-error-banner');
  if (diffDias > DIAS_BASE_DESATUALIZADA && banner) {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:8px">
        <span><strong>Aviso de dados:</strong> A base de cotações e proventos foi sincronizada pela última vez em ${fmtDataIso(geradoIso)} (há mais de 3 dias úteis). As cotações podem estar defasadas.</span>
        <button type="button" class="btn btn-ghost" id="btn-reload-stale" style="margin-left:auto">Atualizar base</button>
      </div>`;
    banner.classList.remove('is-hidden');
    $('#btn-reload-stale')?.addEventListener('click', () => carregarValuationJson(true));
  }
}

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
  if (obj.veredito && ['todos', 'verde', 'amarelo', 'vermelho', 'bullish', 'bearish'].includes(obj.veredito)) {
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
  if (typeof window.renderizarCarteira === 'function') window.renderizarCarteira();
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
  renderizarStatus(
    'is-error',
    '<span class="status-text-full">Base indisponível · Clique para tentar novamente</span><span class="status-text-mobile">Erro</span>'
  );
  const tbody = $('#engine-valuation-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr class="row-empty"><td colspan="15" class="empty"><strong>Dados temporariamente indisponíveis</strong>${esc(msg)}</td></tr>`;
  }
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
      if (['tabela', 'visual', 'matriz', 'calendario', 'carteira'].includes(abaHash) && typeof window.definirAbaPainel === 'function') {
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

  // Paleta de Comandos (Ctrl+K)
  $('#btn-open-cmd-palette')?.addEventListener('click', abrirCommandPalette);
  const cmdInput = $('#cmd-palette-input');
  cmdInput?.addEventListener('input', (e) => {
    renderizarResultadosComandos(e.target.value);
  });
  cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex + 1) % Math.max(1, cmdPaletteItems.length);
      document.querySelectorAll('#cmd-palette-results .cmd-item').forEach((el, idx) => {
        const isSel = idx === cmdPaletteSelectedIndex;
        el.classList.toggle('is-selected', isSel);
        el.setAttribute('aria-selected', isSel);
        if (isSel) el.scrollIntoView({ block: 'nearest' });
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex - 1 + cmdPaletteItems.length) % Math.max(1, cmdPaletteItems.length);
      document.querySelectorAll('#cmd-palette-results .cmd-item').forEach((el, idx) => {
        const isSel = idx === cmdPaletteSelectedIndex;
        el.classList.toggle('is-selected', isSel);
        el.setAttribute('aria-selected', isSel);
        if (isSel) el.scrollIntoView({ block: 'nearest' });
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executarComandoSelecionado();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fecharCommandPalette();
    }
  });
  $('#cmd-palette-results')?.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-item');
    if (item) {
      cmdPaletteSelectedIndex = Number(item.dataset.cmdIdx);
      executarComandoSelecionado();
    }
  });

  // Menu Mais
  $('#btn-open-more-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#more-menu-dropdown');
    if (dd) dd.classList.toggle('is-hidden');
  });
  $('#btn-more-methodology')?.addEventListener('click', () => {
    $('#more-menu-dropdown')?.classList.add('is-hidden');
    abrirModal('methodology-modal');
  });
  $('#btn-more-shortcuts')?.addEventListener('click', () => {
    $('#more-menu-dropdown')?.classList.add('is-hidden');
    abrirModal('shortcuts-modal');
  });
  $('#btn-more-theme')?.addEventListener('click', () => {
    $('#more-menu-dropdown')?.classList.add('is-hidden');
    alternarTema();
  });
  $('#btn-more-presentation')?.addEventListener('click', () => {
    $('#more-menu-dropdown')?.classList.add('is-hidden');
    alternarModoApresentacao();
  });

  // Visões Salvas & Colunas
  $('#select-saved-views')?.addEventListener('change', (e) => {
    gravarStorage(STORAGE_KEY_COLUNAS, {}); // trocar de visão descarta ajustes manuais
    aplicarVisaoSalva(e.target.value);
  });
  $('#btn-toggle-cols-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('#cols-menu')?.classList.toggle('is-hidden');
  });
  $('#cols-menu')?.addEventListener('change', (e) => {
    const chk = e.target.closest('input[data-col]');
    if (!chk) return;
    const col = chk.dataset.col;
    const tabela = $('#engine-valuation-table');
    if (!tabela) return;
    tabela.classList.toggle(`hide-col-${col}`, !chk.checked);
    const ajustes = lerStorage(STORAGE_KEY_COLUNAS, {}) || {};
    ajustes[col] = chk.checked;
    gravarStorage(STORAGE_KEY_COLUNAS, ajustes);
  });

  // Filtro de Análise Técnica
  $('#tech-signal-filter')?.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) definirFiltroTech(b.dataset.tech);
  });

  // Fechar Raio-X em telas pequenas
  $('#btn-close-detail-pane')?.addEventListener('click', fecharPainelRaioXMobile);

  // Link Metodologia Rodapé
  $('#footer-link-metodologia')?.addEventListener('click', (e) => {
    e.preventDefault();
    abrirModal('methodology-modal');
  });

  $('#table-density-group')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-density]');
    if (!b) return;
    painelState.densidade = b.dataset.density === 'compacta' ? 'compacta' : 'confortavel';
    gravarStorage(STORAGE_KEY_PAINEL_DENSITY, painelState.densidade);
    renderizarCabecalho();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.more-menu-wrap')) {
      $('#more-menu-dropdown')?.classList.add('is-hidden');
    }
    if (!e.target.closest('.cols-dropdown-wrap')) {
      $('#cols-menu')?.classList.add('is-hidden');
    }
    if (e.target.id === 'cmd-palette-backdrop') {
      fecharCommandPalette();
    }
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
      abrirCommandPalette();
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
    } else if (['1', '2', '3', '4', '5'].includes(e.key) && typeof window.definirAbaPainel === 'function') {
      const mapaAbas = { '1': 'tabela', '2': 'visual', '3': 'matriz', '4': 'calendario', '5': 'carteira' };
      window.definirAbaPainel(mapaAbas[e.key]);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (painelState.modoApresentacao || document.activeElement?.classList.contains('view-tab'))) {
      e.preventDefault();
      const ordem = ['tabela', 'visual', 'matriz', 'calendario', 'carteira'];
      const btnAtivo = document.querySelector('#main-view-tabs .view-tab.is-active');
      const idxAtual = Math.max(0, ordem.indexOf(btnAtivo?.dataset.viewTab || 'tabela'));
      const proxIdx = e.key === 'ArrowRight' ? (idxAtual + 1) % ordem.length : (idxAtual + ordem.length - 1) % ordem.length;
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
    const t = e.target.closest('[data-kpi-triagem]');
    if (t) {
      const alvo = t.dataset.kpiTriagem;
      definirTriagem(painelState.triagem === alvo ? 'todas' : alvo);
      return;
    }
    const d = e.target.closest('[data-kpi-detail]');
    if (d) abrirDetalhe(d.dataset.kpiDetail);
  });

  $('#select-triagem')?.addEventListener('change', (e) => definirTriagem(e.target.value));

  $('#active-filters')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear-filter]');
    if (!b) return;
    const tipo = b.dataset.clearFilter;
    if (tipo === 'triagem') definirTriagem('todas');
    if (tipo === 'tech') definirFiltroTech('todos');
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
    if (acao?.dataset.rowAction === 'remove') {
      ocultarTickerComUndo(linha.dataset.ticker);
      return;
    }
    selecionarAtivoMasterDetail(linha.dataset.ticker, true);
  });

  tbody?.addEventListener('keydown', (e) => {
    const linha = e.target.closest('tr.row');
    if (!linha) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = linha.nextElementSibling;
      if (next && next.classList.contains('row')) {
        next.focus();
        selecionarAtivoMasterDetail(next.dataset.ticker, false);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = linha.previousElementSibling;
      if (prev && prev.classList.contains('row')) {
        prev.focus();
        selecionarAtivoMasterDetail(prev.dataset.ticker, false);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selecionarAtivoMasterDetail(linha.dataset.ticker, true);
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
    if (el) el.innerHTML = '<span class="status-text-full">Sincronizando base…</span><span class="status-text-mobile">Sincronizando…</span>';
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
  const triagemSalva = lerStorage(STORAGE_KEY_TRIAGEM, 'todas');
  painelState.triagem = TRIAGENS[triagemSalva] ? triagemSalva : 'todas';
  const selTriagem = $('#select-triagem');
  if (selTriagem) {
    selTriagem.innerHTML = Object.entries(TRIAGENS)
      .map(([id, t]) => `<option value="${id}" ${t.tip ? `title="${esc(t.tip)}"` : ''}>${id === 'todas' ? 'Triagem: Todas' : esc(t.rotulo)}</option>`)
      .join('');
    selTriagem.value = painelState.triagem;
  }
  const densSalva = lerStorage(STORAGE_KEY_PAINEL_DENSITY, 'confortavel');
  painelState.densidade = densSalva === 'compacta' ? 'compacta' : 'confortavel';
  const visaoSalva = lerStorage('painel_valuation_saved_view', 'padrao');
  if (visaoSalva) {
    painelState.visaoSalva = visaoSalva;
    const sel = $('#select-saved-views');
    if (sel) sel.value = visaoSalva;
    aplicarVisaoSalva(visaoSalva);
  }
  bindEventos();
  carregarValuationJson();
  if (window.location.search.includes('cmd=1') || window.location.hash.includes('cmd=1')) {
    setTimeout(abrirCommandPalette, 600);
  }
  setInterval(() => {
    if (!document.hidden) carregarValuationJson(true);
  }, 60000);
  setInterval(() => {
    if (!document.hidden && painelState.payload) atualizarStatusBase();
  }, 30000);
});
