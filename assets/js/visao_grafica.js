/* Visão Gráfica & Simulador de Rendimento com Dividendos (index.html)
 * Somente leitura e apresentação dos dados de ./data/valuation.json:
 * - Os preços-teto Bazin (K=6%), Graham e Gordon vêm prontos do motor Python.
 * - O histórico de preços (ajustado apenas por splits) e os proventos por data-com
 *   alimentam o gráfico comparativo e o simulador de retorno total.
 * - Paleta das séries sem colisão com o veredito semântico:
 *   Preço (#60a5fa), Bazin (#06b6d4), Graham (#a855f7), Gordon (#f472b6).
 * - Zero atributos `style` inline (tudo via classes CSS e atributos SVG).
 */

(function () {
  'use strict';

  const STORAGE_KEY_VISUAL = 'painel_valuation_visual_prefs';

  const COR_PRINCIPAL = '#60a5fa';
  const PALETA_COMPARACAO = ['#38bdf8', '#c084fc', '#f472b6', '#818cf8'];

  const ESTILO_TETOS = {
    bazin: {
      chave: 'bazin',
      nome: 'Teto Bazin (K=6%)',
      curto: 'Bazin',
      cor: '#06b6d4',
      swatchCls: 'is-bazin',
      dash: '10 5',
      largura: 2.6,
      destaque: true
    },
    consenso: {
      chave: 'consenso',
      nome: 'Teto Consenso Mercado',
      curto: 'Consenso',
      cor: '#a3e635',
      swatchCls: 'is-consenso',
      dash: '8 4',
      largura: 2.4,
      destaque: false
    },
    barsi: {
      chave: 'barsi',
      nome: 'Teto pelo lucro (LPA × payout médio)',
      curto: 'Lucro',
      cor: '#f97316',
      swatchCls: 'is-barsi',
      dash: '4 3',
      largura: 2.4,
      destaque: false
    },
    graham: {
      chave: 'graham',
      nome: 'Teto Graham',
      curto: 'Graham',
      cor: '#a855f7',
      swatchCls: 'is-graham',
      dash: '6 5',
      largura: 2.0,
      destaque: false
    },
    gordon: {
      chave: 'gordon',
      nome: 'Teto Gordon',
      curto: 'Gordon',
      cor: '#f472b6',
      swatchCls: 'is-gordon',
      dash: '2.5 4',
      largura: 2.0,
      destaque: false
    }
  };

  const VERSAO_PREFS_TETOS = 2;

  const DIAS_PERIODO = {
    '6m': 183,
    '1y': 366,
    '2y': 731,
    '3y': 1096,
    '5y': 1860,
    '10y': 3660
  };

  const ROTULO_PERIODO = {
    '6m': '6 meses',
    '1y': '1 ano',
    '2y': '2 anos',
    '3y': '3 anos',
    '5y': '5 anos',
    '10y': '10 anos'
  };

  const ORDEM_BENCHMARKS = ['CDI', 'WRLD11', 'MUND11', 'B5P211', 'IPCA'];

  const ESTILO_BENCHMARKS = {
    CDI: {
      codigo: 'CDI',
      nome: '100% Taxa DI',
      curto: 'CDI',
      cor: '#f59e0b',
      dash: '6 3',
      dotCls: 'dot-bench-cdi',
      taxaAnualFallback: 0.101
    },
    WRLD11: {
      codigo: 'WRLD11',
      nome: 'ETF Global VT',
      curto: 'WRLD11',
      cor: '#10b981',
      dash: '8 4',
      dotCls: 'dot-bench-wrld11',
      taxaAnualFallback: 0.145
    },
    MUND11: {
      codigo: 'MUND11',
      nome: 'ETF Global',
      curto: 'MUND11',
      cor: '#a855f7',
      dash: '5 3',
      dotCls: 'dot-bench-mund11',
      taxaAnualFallback: 0.142
    },
    B5P211: {
      codigo: 'B5P211',
      nome: 'Tesouro IPCA+',
      curto: 'B5P211',
      cor: '#ec4899',
      dash: '9 3 2 3',
      dotCls: 'dot-bench-b5p211',
      taxaAnualFallback: 0.112
    },
    IPCA: {
      codigo: 'IPCA',
      nome: 'Inflação IBGE',
      curto: 'IPCA',
      cor: '#ef4444',
      dash: '3 3',
      dotCls: 'dot-bench-ipca',
      taxaAnualFallback: 0.056
    }
  };

  /* ---------- Helpers Defensivos Autossuficientes ---------- */

  const qSel = (sel) => document.querySelector(sel);

  function escHtml(str) {
    if (typeof window.esc === 'function') return window.esc(str);
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function ehValido(v) {
    return v !== null && v !== undefined && typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
  }

  function formataReal(v) {
    if (!ehValido(v)) return '—';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formataPct(v, casas = 1) {
    if (!ehValido(v)) return '—';
    const pct = v * 100;
    const sinal = pct > 0 ? '+' : '';
    return sinal + pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  }

  function formataPctSimples(v, casas = 1) {
    if (!ehValido(v)) return '—';
    const pct = v * 100;
    return pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  }

  function corClasseMargem(v) {
    if (!ehValido(v)) return 't-dim';
    if (v >= 0) return 't-green';
    if (v >= -0.05) return 't-yellow';
    return 't-red';
  }

  function inferirSetorBesstLocal(setor) {
    if (!setor) return null;
    const s = String(setor).trim().toLowerCase();
    if (s.startsWith('banco')) return 'bancos';
    if (s.startsWith('energia') || s.startsWith('eletric') || s.startsWith('elétric')) return 'energia';
    if (s.startsWith('saneamento')) return 'saneamento';
    if (s.startsWith('segur')) return 'seguros';
    if (s.startsWith('telecom')) return 'telecom';
    return null;
  }

  function obterCategoriaAtivo(a) {
    if (typeof window.categoriaDoAtivo === 'function') {
      try { return window.categoriaDoAtivo(a); } catch (_) { /* fallback local */ }
    }
    if (!a) return 'dividendos';
    if (a.categoria === 'demais') return 'demais';
    if (a.besst || inferirSetorBesstLocal(a.setor)) return 'besst';
    return 'dividendos';
  }

  function badgeVereditoHtml(v) {
    if (typeof window.htmlVeredito === 'function') {
      try { return window.htmlVeredito(v); } catch (_) { /* fallback local */ }
    }
    const rotulos = { verde: '▲ Abaixo do teto', amarelo: '● Próximo do teto', vermelho: '▼ Acima do teto' };
    const k = rotulos[v] ? v : 'vermelho';
    return `<span class="verdict verdict-${k}">${rotulos[k]}</span>`;
  }

  function obterUrlInvestidor10(ticker) {
    if (typeof window.urlInvestidor10 === 'function') {
      try { return window.urlInvestidor10(ticker); } catch (_) { /* fallback local */ }
    }
    const clean = String(ticker || '').trim().toLowerCase();
    return `https://investidor10.com.br/acoes/${encodeURIComponent(clean)}/`;
  }

  function lerPrefsLocal(chave, padrao) {
    try {
      const raw = localStorage.getItem(chave);
      return raw ? JSON.parse(raw) : padrao;
    } catch (_) {
      return padrao;
    }
  }

  function gravarPrefsLocal(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch (_) { /* modo privado */ }
  }

  function obterUniverso() {
    if (typeof painelState !== 'undefined' && Array.isArray(painelState.universo)) {
      return painelState.universo;
    }
    return [];
  }

  function obterSelecionadosPainel() {
    if (typeof painelState !== 'undefined' && Array.isArray(painelState.selecionados)) {
      return painelState.selecionados;
    }
    return [];
  }

  function obterPayload() {
    if (typeof painelState !== 'undefined' && painelState.payload) {
      return painelState.payload;
    }
    return null;
  }

  function construirMapaUniverso() {
    const lista = obterUniverso();
    return new Map(lista.map(a => [String(a.ticker).toUpperCase(), a]));
  }

  /* ---------- Estado da Visão Gráfica ---------- */

  const prefsSalvas = lerPrefsLocal(STORAGE_KEY_VISUAL, {}) || {};

  const visualState = {
    aba: 'tabela',
    tickerPrincipal: prefsSalvas.tickerPrincipal || '',
    comparados: Array.isArray(prefsSalvas.comparados) ? prefsSalvas.comparados.slice(0, 4) : [],
    periodo: DIAS_PERIODO[prefsSalvas.periodo] ? prefsSalvas.periodo : '5y',
    modoPreco: ['preco', 'lucro_cotacao', 'margem_bazin', 'variacao'].includes(prefsSalvas.modoPreco) ? prefsSalvas.modoPreco : 'preco',
    frequenciaLucro: ['trimestral', '12m', 'fcf', 'anual'].includes(prefsSalvas.frequenciaLucro) ? prefsSalvas.frequenciaLucro : 'trimestral',
    filtroLista: ['todos', 'painel', 'besst', 'dividendos', 'demais'].includes(prefsSalvas.filtroLista) ? prefsSalvas.filtroLista : 'todos',
    ordemLista: prefsSalvas.ordemLista === 'az' ? 'az' : 'margem',
    buscaLista: '',
    sidebarRecolhida: Boolean(prefsSalvas.sidebarRecolhida),
    tetosVisiveis: {
      bazin: prefsSalvas.tetosVisiveis?.bazin !== false,
      // Consenso e Gordon são referência teórica: desligados até o usuário ligar. Preferências
      // salvas antes da versão 2 tinham tudo ligado por padrão, então são ignoradas uma vez.
      consenso: prefsSalvas.versaoTetos === VERSAO_PREFS_TETOS && prefsSalvas.tetosVisiveis?.consenso === true,
      barsi: prefsSalvas.tetosVisiveis?.barsi !== false,
      graham: prefsSalvas.tetosVisiveis?.graham !== false,
      gordon: prefsSalvas.versaoTetos === VERSAO_PREFS_TETOS && prefsSalvas.tetosVisiveis?.gordon === true
    },
    mediasVisiveis: {
      mma21: Boolean(prefsSalvas.mediasVisiveis?.mma21),
      mma50: Boolean(prefsSalvas.mediasVisiveis?.mma50)
    },
    modoTetoBazin: prefsSalvas.modoTetoBazin === 'fixo' ? 'fixo' : 'dinamico',
    simCapital: Number(prefsSalvas.simCapital) >= 100 ? Number(prefsSalvas.simCapital) : 10000,
    simReinvestir: prefsSalvas.simReinvestir !== false,
    simLiquidoJcp: prefsSalvas.simLiquidoJcp !== false,
    simPeriodoPreset: prefsSalvas.simPeriodoPreset || '5y',
    simDataInicio: prefsSalvas.simDataInicio || '',
    simDataFim: prefsSalvas.simDataFim || '',
    simBenchmarks: {
      CDI: prefsSalvas.simBenchmarks?.CDI !== false,
      WRLD11: prefsSalvas.simBenchmarks?.WRLD11 !== false,
      MUND11: prefsSalvas.simBenchmarks?.MUND11 !== false,
      B5P211: prefsSalvas.simBenchmarks?.B5P211 !== false,
      IPCA: prefsSalvas.simBenchmarks?.IPCA !== false
    }
  };

  function salvarPrefsVisual() {
    gravarPrefsLocal(STORAGE_KEY_VISUAL, {
      tickerPrincipal: visualState.tickerPrincipal,
      comparados: visualState.comparados,
      periodo: visualState.periodo,
      modoPreco: visualState.modoPreco,
      frequenciaLucro: visualState.frequenciaLucro,
      filtroLista: visualState.filtroLista,
      ordemLista: visualState.ordemLista,
      sidebarRecolhida: visualState.sidebarRecolhida,
      tetosVisiveis: visualState.tetosVisiveis,
      versaoTetos: VERSAO_PREFS_TETOS,
      mediasVisiveis: visualState.mediasVisiveis,
      modoTetoBazin: visualState.modoTetoBazin,
      simCapital: visualState.simCapital,
      simReinvestir: visualState.simReinvestir,
      simLiquidoJcp: visualState.simLiquidoJcp,
      simPeriodoPreset: visualState.simPeriodoPreset,
      simDataInicio: visualState.simDataInicio,
      simDataFim: visualState.simDataFim,
      simBenchmarks: visualState.simBenchmarks
    });
  }

  function fmtDataBr(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '—';
    const limpo = isoStr.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(limpo)) return limpo;
    const partes = limpo.slice(0, 10).split('-');
    if (partes.length !== 3) return limpo;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  function fmtDataCurta(isoStr, mostrarAno = true) {
    if (!isoStr || typeof isoStr !== 'string') return '';
    const partes = isoStr.slice(0, 10).split('-');
    if (partes.length !== 3) return isoStr;
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const m = meses[Math.max(0, Math.min(11, Number(partes[1]) - 1))];
    return mostrarAno ? `${m}/${partes[0].slice(2)}` : `${partes[2]}/${m}`;
  }

  function fmtDuracaoDias(dias) {
    if (!ehValido(dias) || dias <= 0) return 'menos de 1 semana';
    if (dias < 30) {
      const sem = Math.max(1, Math.round(dias / 7));
      return `${sem} ${sem === 1 ? 'semana' : 'semanas'}`;
    }
    const mesesTotal = Math.round(dias / 30.44);
    if (mesesTotal < 12) return `${mesesTotal} ${mesesTotal === 1 ? 'mês' : 'meses'}`;
    const anos = Math.floor(mesesTotal / 12);
    const mesesRest = mesesTotal % 12;
    if (mesesRest === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
    return `${anos}a ${mesesRest}m`;
  }

  function garantirAtivosValidos() {
    const mapa = construirMapaUniverso();
    if (!mapa.size) return null;

    if (!visualState.tickerPrincipal || !mapa.has(visualState.tickerPrincipal.toUpperCase())) {
      const selPainel = obterSelecionadosPainel();
      const preferidoPainel = selPainel.find(t => mapa.has(String(t).toUpperCase()));
      const padraoBase = mapa.has('BBAS3') ? 'BBAS3' : obterUniverso()[0]?.ticker;
      visualState.tickerPrincipal = String(preferidoPainel || padraoBase || '').toUpperCase();
    } else {
      visualState.tickerPrincipal = visualState.tickerPrincipal.toUpperCase();
    }

    visualState.comparados = visualState.comparados
      .map(t => String(t).toUpperCase())
      .filter((t, idx, arr) => t !== visualState.tickerPrincipal && mapa.has(t) && arr.indexOf(t) === idx)
      .slice(0, 4);

    return mapa.get(visualState.tickerPrincipal) || null;
  }

  /* ---------- Extração de Série Histórica na Janela ---------- */

  function obterDatasJanela() {
    const payload = obterPayload();
    const todasDatas = Array.isArray(payload?.historico_datas) ? payload.historico_datas : [];
    if (!todasDatas.length) {
      const hoje = new Date().toISOString().slice(0, 10);
      const ant = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      return { indices: [0, 1], datas: [ant, hoje], sintetico: true };
    }

    const ultimaData = new Date(todasDatas[todasDatas.length - 1] + 'T12:00:00Z');
    const dias = DIAS_PERIODO[visualState.periodo] || 1860;
    const corteIso = new Date(ultimaData.getTime() - dias * 86400000).toISOString().slice(0, 10);

    const indices = [];
    const datas = [];
    for (let i = 0; i < todasDatas.length; i++) {
      if (todasDatas[i] >= corteIso) {
        indices.push(i);
        datas.push(todasDatas[i]);
      }
    }

    if (indices.length < 2 && todasDatas.length >= 2) {
      const ini = Math.max(0, todasDatas.length - 2);
      return {
        indices: [ini, todasDatas.length - 1],
        datas: [todasDatas[ini], todasDatas[todasDatas.length - 1]],
        sintetico: false
      };
    }

    return { indices, datas, sintetico: false };
  }

  function extrairSerieAtivo(ativo, janela) {
    if (!ativo) return [];
    if (janela.sintetico || !Array.isArray(ativo.historico_precos) || !ativo.historico_precos.length) {
      return janela.datas.map(d => ({ data: d, preco: ativo.preco }));
    }

    const pontos = [];
    for (let k = 0; k < janela.indices.length; k++) {
      const idx = janela.indices[k];
      const p = ativo.historico_precos[idx];
      pontos.push({
        data: janela.datas[k],
        preco: ehValido(p) && p > 0 ? p : null
      });
    }
    return pontos;
  }

  /* ---------- Série Dinâmica de Teto Bazin Histórico ---------- */

  function calcularSerieTetoBazinHistorico(ativo, datas) {
    if (!ativo || !Array.isArray(datas) || !datas.length) return [];
    const tetoAtualFixo = ehValido(ativo?.bazin?.teto) && ativo.bazin.teto > 0 ? ativo.bazin.teto : null;
    if (!tetoAtualFixo) {
      return datas.map(d => ({ data: d, teto: null }));
    }

    // Teto vigente em cada ano, calculado no motor com a MESMA regra do teto atual (média dos
    // 5 anos fechados anteriores, anos atípicos normalizados). O navegador não recalcula Bazin.
    // Anos sem histórico suficiente na fonte ficam sem teto (linha interrompida).
    const tetoPorAno = ativo.bazin?.teto_por_ano || {};
    return datas.map(dtIso => {
      const v = tetoPorAno[dtIso.slice(0, 4)];
      return { data: dtIso, teto: ehValido(v) && v > 0 ? Math.round(v * 100) / 100 : null };
    });
  }

  /* ---------- Série Histórica de Lucro Líquido e LPA (Peter Lynch) ---------- */

  function formatarLucroGrande(v) {
    if (!ehValido(v)) return '—';
    const abs = Math.abs(v);
    const sinal = v < 0 ? '-' : '';
    if (abs >= 1e9) {
      return `${sinal}R$ ${(abs / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} Bi`;
    }
    if (abs >= 1e6) {
      return `${sinal}R$ ${(abs / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mi`;
    }
    return `${sinal}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  }

  function formatarLucroCurto(v) {
    if (!ehValido(v)) return '';
    const abs = Math.abs(v);
    const sinal = v < 0 ? '-' : '';
    if (abs >= 1e9) {
      return `${sinal}R$ ${(abs / 1e9).toFixed(1).replace('.', ',')}B`;
    }
    if (abs >= 1e6) {
      return `${sinal}R$ ${(abs / 1e6).toFixed(0)}M`;
    }
    return `${sinal}R$ ${abs.toLocaleString('pt-BR')}`;
  }

  function extrairPontosLucro(ativo, freq = 'trimestral') {
    if (!ativo || !Array.isArray(ativo.historico_lucros) || !ativo.historico_lucros.length) return [];
    const todos = [...ativo.historico_lucros].sort((a, b) => (a.data || String(a.ano)).localeCompare(b.data || String(b.ano)));

    if (freq === 'anual') {
      const anuais = todos.filter(p => p.tipo === 'anual');
      if (anuais.length) return anuais;
      return todos;
    }

    const trimestrais = todos.filter(p => p.tipo === 'trimestral');
    if (!trimestrais.length) {
      return todos;
    }

    // Se temos anuais anteriores ao primeiro trimestre disponível,
    // sintetiza trimestres aproximados para anos anteriores (lucro_anual / 4)
    // para fornecer histórico contínuo em janelas longas (2y, 5y)
    const primeiroAnoTrim = trimestrais[0].ano;
    const anuaisAnteriores = todos.filter(p => p.tipo === 'anual' && p.ano < primeiroAnoTrim);

    const pontosSinteticos = [];
    anuaisAnteriores.forEach(pa => {
      const lq = pa.lucro_liquido / 4;
      const lpaQ = ehValido(pa.lpa) ? pa.lpa / 4 : null;
      const anoStr = String(pa.ano).slice(2);
      pontosSinteticos.push(
        { ano: pa.ano, data: `${pa.ano}-03-31`, periodo: `1T${anoStr}`, lucro_liquido: lq, lpa: lpaQ, tipo: 'trimestral', sintetico: true },
        { ano: pa.ano, data: `${pa.ano}-06-30`, periodo: `2T${anoStr}`, lucro_liquido: lq, lpa: lpaQ, tipo: 'trimestral', sintetico: true },
        { ano: pa.ano, data: `${pa.ano}-09-30`, periodo: `3T${anoStr}`, lucro_liquido: lq, lpa: lpaQ, tipo: 'trimestral', sintetico: true },
        { ano: pa.ano, data: `${pa.ano}-12-31`, periodo: `4T${anoStr}`, lucro_liquido: lq, lpa: lpaQ, tipo: 'trimestral', sintetico: true }
      );
    });

    const serieTrimCompleta = [...pontosSinteticos, ...trimestrais].sort((a, b) => (a.data || String(a.ano)).localeCompare(b.data || String(b.ano)));

    if (freq === 'fcf') {
      const pontosComFcf = serieTrimCompleta.filter(pt => ehValido(pt.fcf));
      if (!pontosComFcf.length) return [];
      return pontosComFcf.map(pt => ({
        ...pt,
        lucro_liquido: pt.fcf,
        periodo: `${pt.periodo} (FCF)`
      }));
    }

    if (freq === '12m') {
      return serieTrimCompleta.map((pt, idx) => {
        if (idx < 3) {
          return {
            ...pt,
            lucro_liquido: pt.lucro_liquido * 4,
            lpa: ehValido(pt.lpa) ? pt.lpa * 4 : null,
            periodo: `${pt.periodo} (12M)`
          };
        }
        const ultimos4 = serieTrimCompleta.slice(idx - 3, idx + 1);
        const somaLucro = ultimos4.reduce((acc, x) => acc + (x.lucro_liquido || 0), 0);
        const somaLpa = ultimos4.every(x => ehValido(x.lpa)) ? ultimos4.reduce((acc, x) => acc + x.lpa, 0) : null;
        return {
          ...pt,
          lucro_liquido: somaLucro,
          lpa: somaLpa,
          periodo: `${pt.periodo} (12M)`
        };
      });
    }

    return serieTrimCompleta;
  }

  function calcularSerieLucroHistorico(ativo, datas, freq = 'trimestral') {
    if (!ativo || !Array.isArray(datas) || !datas.length) return [];
    const lucros = extrairPontosLucro(ativo, freq);
    if (!lucros.length) {
      const arr = datas.map(d => ({ data: d, lucro: null, lpa: null, periodo: null, ano: null }));
      arr.marcos = [];
      return arr;
    }

    const timestamps = datas.map(d => new Date(d).getTime());
    const marcos = [];

    lucros.forEach(ponto => {
      const dtPonto = ponto.data || `${ponto.ano}-12-31`;
      const tPonto = new Date(dtPonto).getTime();
      let melhorIdx = 0;
      let menorDiff = Infinity;
      timestamps.forEach((t, i) => {
        const diff = Math.abs(t - tPonto);
        if (diff < menorDiff) {
          menorDiff = diff;
          melhorIdx = i;
        }
      });
      marcos.push({ index: melhorIdx, ponto });
    });

    const resultado = datas.map((dtIso, i) => {
      const t = timestamps[i];
      const pontoExato = lucros.find(l => (l.data || `${l.ano}-12-31`) === dtIso);
      if (pontoExato) {
        return {
          data: dtIso,
          lucro: pontoExato.lucro_liquido,
          lucroPeriodo: pontoExato.lucro_liquido,
          lpa: pontoExato.lpa,
          periodo: pontoExato.periodo || String(pontoExato.ano),
          ano: pontoExato.ano,
          tipo: pontoExato.tipo
        };
      }

      const t0 = new Date(lucros[0].data || `${lucros[0].ano}-12-31`).getTime();
      const tFim = new Date(lucros[lucros.length - 1].data || `${lucros[lucros.length - 1].ano}-12-31`).getTime();

      if (t <= t0) {
        const p = lucros[0];
        return {
          data: dtIso,
          lucro: p.lucro_liquido,
          lucroPeriodo: p.lucro_liquido,
          lpa: p.lpa,
          periodo: p.periodo || String(p.ano),
          ano: p.ano,
          tipo: p.tipo
        };
      }
      if (t >= tFim) {
        const p = lucros[lucros.length - 1];
        return {
          data: dtIso,
          lucro: p.lucro_liquido,
          lucroPeriodo: p.lucro_liquido,
          lpa: p.lpa,
          periodo: p.periodo || String(p.ano),
          ano: p.ano,
          tipo: p.tipo
        };
      }

      for (let k = 0; k < lucros.length - 1; k++) {
        const pA = lucros[k];
        const pB = lucros[k + 1];
        const tA = new Date(pA.data || `${pA.ano}-12-31`).getTime();
        const tB = new Date(pB.data || `${pB.ano}-12-31`).getTime();
        if (t >= tA && t <= tB) {
          const frac = (t - tA) / (tB - tA || 1);
          const lucroInterp = pA.lucro_liquido + frac * (pB.lucro_liquido - pA.lucro_liquido);
          const lpaInterp = (ehValido(pA.lpa) && ehValido(pB.lpa))
            ? pA.lpa + frac * (pB.lpa - pA.lpa)
            : (frac >= 0.5 ? pB.lpa : pA.lpa);
          const pRef = frac >= 0.5 ? pB : pA;
          return {
            data: dtIso,
            lucro: lucroInterp,
            lucroPeriodo: pRef.lucro_liquido,
            lpa: lpaInterp,
            periodo: pRef.periodo || String(pRef.ano),
            ano: pRef.ano,
            tipo: pRef.tipo
          };
        }
      }

      const pUlt = lucros[lucros.length - 1];
      return {
        data: dtIso,
        lucro: pUlt.lucro_liquido,
        lucroPeriodo: pUlt.lucro_liquido,
        lpa: pUlt.lpa,
        periodo: pUlt.periodo || String(pUlt.ano),
        ano: pUlt.ano,
        tipo: pUlt.tipo
      };
    });

    resultado.marcos = marcos;
    return resultado;
  }

  function diagnosticarPeterLynch(principal, seriePrecos, serieLucro, freq = 'trimestral') {
    const pontosTrim = (principal.historico_lucros || []).filter(p => p.tipo === 'trimestral').sort((a, b) => a.data.localeCompare(b.data));
    const validosPreco = (seriePrecos || []).filter(p => ehValido(p.preco) && p.preco > 0);
    const precoAtual = principal.preco || validosPreco[validosPreco.length - 1]?.preco || null;

    if (pontosTrim.length >= 2) {
      const pRecente = pontosTrim[pontosTrim.length - 1];
      const pAnterior = pontosTrim[pontosTrim.length - 2];

      // Busca o mesmo trimestre no ano anterior (ex: 2T26 vs 2T25) para base YoY comparável
      const anoAlvoYoY = pRecente.ano - 1;
      const prefixoYoY = pRecente.periodo.slice(0, 2); // ex: '2T'
      const pYoY = pontosTrim.find(p => p.ano === anoAlvoYoY && p.periodo.startsWith(prefixoYoY)) || pontosTrim[0];

      const varQoQ = Math.abs(pAnterior.lucro_liquido) > 0
        ? (pRecente.lucro_liquido - pAnterior.lucro_liquido) / Math.abs(pAnterior.lucro_liquido)
        : null;

      const varYoY = (pYoY && pYoY !== pRecente && Math.abs(pYoY.lucro_liquido) > 0)
        ? (pRecente.lucro_liquido - pYoY.lucro_liquido) / Math.abs(pYoY.lucro_liquido)
        : null;

      // Cotação na data do trimestre base YoY
      let precoRef = validosPreco[0]?.preco || null;
      if (pYoY?.data) {
        const ptMatch = validosPreco.find(p => p.data >= pYoY.data) || validosPreco[0];
        if (ptMatch) precoRef = ptMatch.preco;
      }
      const varPreco = (precoAtual && precoRef) ? (precoAtual - precoRef) / precoRef : null;

      // LPA Anualizado e P/L Atual
      const lpaAnualizado = ehValido(pRecente.lpa) ? pRecente.lpa * 4 : null;
      const plAtual = (precoAtual && lpaAnualizado && lpaAnualizado > 0)
        ? precoAtual / lpaAnualizado
        : principal.fundamentos?.pl || null;

      let tipo = 'convergencia';
      let titulo = `Convergência Trimestral de Resultados (${pRecente.periodo})`;
      let resumo = `A evolução da cotação (${formataPct(varPreco)}) acompanhou a dinâmica dos resultados trimestrais recentes (${formataPct(varYoY)} YoY), mantendo a correlação de valuation estável.`;
      let classeBox = 'is-neutral';

      if (varYoY !== null && varPreco !== null) {
        const delta = varYoY - varPreco;
        if (delta >= 0.25) {
          tipo = 'oportunidade';
          titulo = `Descolamento Recente Positivo (${pRecente.periodo})`;
          resumo = `Nos trimestres mais recentes (${pYoY.periodo} a ${pRecente.periodo}), o lucro trimestral acelerou ${formataPct(varYoY)} (de ${formatarLucroCurto(pYoY.lucro_liquido)} para ${formatarLucroCurto(pRecente.lucro_liquido)}), enquanto a cotação variou ${formataPct(varPreco)}. A expansão operacional recente supera com folga o preço de tela.`;
          classeBox = 'is-good';
        } else if (varPreco - varYoY >= 0.30) {
          tipo = 'alerta';
          titulo = `Expansão de Múltiplo Recente (${pRecente.periodo})`;
          resumo = `A cotação valorizou ${formataPct(varPreco)} superando o ritmo dos lucros trimestrais recentes (${formataPct(varYoY)}). O papel encareceu mais rápido que a geração de resultados recentes.`;
          classeBox = 'is-warn';
        } else if (varYoY < -0.10 && varPreco < -0.10) {
          tipo = 'deterioracao';
          titulo = `Compressão Trimestral de Resultados (${pRecente.periodo})`;
          resumo = `O lucro trimestral recuou ${formataPct(varYoY)} acompanhado por retração de ${formataPct(varPreco)} no preço das ações.`;
          classeBox = 'is-warn';
        }
      }

      return {
        tipo,
        titulo,
        resumo,
        classeBox,
        pRecente,
        pAnterior,
        pYoY,
        varQoQ,
        varYoY,
        varPreco,
        plAtual
      };
    }

    // Fallback anual se não houver 2+ trimestres
    const lucros = (principal.historico_lucros || []).sort((a, b) => (a.data || String(a.ano)).localeCompare(b.data || String(b.ano)));
    const lIni = lucros[0];
    const lFim = lucros[lucros.length - 1];
    const precoIni = validosPreco[0]?.preco || null;
    const varPreco = (precoIni && precoAtual) ? (precoAtual - precoIni) / precoIni : null;
    const varLucro = (lIni && lFim && Math.abs(lIni.lucro_liquido) > 0) ? (lFim.lucro_liquido - lIni.lucro_liquido) / Math.abs(lIni.lucro_liquido) : null;
    return {
      tipo: 'convergencia',
      titulo: 'Histórico Fundamentalista',
      resumo: `Acompanhamento histórico entre cotação (${formataPct(varPreco)}) e lucro (${formataPct(varLucro)}).`,
      classeBox: 'is-neutral',
      pRecente: lFim || { periodo: 'Atual', lucro_liquido: null, lpa: null },
      pAnterior: lIni || { periodo: 'Inicial', lucro_liquido: null, lpa: null },
      pYoY: lIni,
      varQoQ: null,
      varYoY: varLucro,
      varPreco,
      plAtual: principal.fundamentos?.pl || null
    };
  }

  /* ---------- Janela Dinâmica do Simulador ---------- */

  function obterJanelaSimulador(ativo) {
    const payload = obterPayload();
    const todasDatas = Array.isArray(payload?.historico_datas) ? payload.historico_datas : [];
    if (!todasDatas.length) {
      return { indices: [0, 1], datas: ['2021-11-01', '2026-11-02'], sintetico: true, dtIni: '2021-11-01', dtFim: '2026-11-02' };
    }

    const minDisponivel = todasDatas[0];
    const maxDisponivel = todasDatas[todasDatas.length - 1];
    const preset = visualState.simPeriodoPreset || '5y';

    let dtIni = minDisponivel;
    let dtFim = maxDisponivel;

    if (preset === '1y') {
      const t = new Date(maxDisponivel + 'T12:00:00Z').getTime() - 365.25 * 86400000;
      dtIni = new Date(t).toISOString().slice(0, 10);
    } else if (preset === '2y') {
      const t = new Date(maxDisponivel + 'T12:00:00Z').getTime() - 730.5 * 86400000;
      dtIni = new Date(t).toISOString().slice(0, 10);
    } else if (preset === '3y') {
      const t = new Date(maxDisponivel + 'T12:00:00Z').getTime() - 1095.75 * 86400000;
      dtIni = new Date(t).toISOString().slice(0, 10);
    } else if (preset === '5y') {
      const t = new Date(maxDisponivel + 'T12:00:00Z').getTime() - 1826.25 * 86400000;
      dtIni = new Date(t).toISOString().slice(0, 10);
    } else if (preset === '10y') {
      const t = new Date(maxDisponivel + 'T12:00:00Z').getTime() - 3652.5 * 86400000;
      dtIni = new Date(t).toISOString().slice(0, 10);
    } else if (preset === 'max') {
      dtIni = minDisponivel;
      dtFim = maxDisponivel;
    } else if (preset === 'custom') {
      dtIni = visualState.simDataInicio || minDisponivel;
      dtFim = visualState.simDataFim || maxDisponivel;
    }

    if (dtIni < minDisponivel) dtIni = minDisponivel;
    if (dtFim > maxDisponivel) dtFim = maxDisponivel;
    if (dtIni > dtFim) dtIni = minDisponivel;

    const indices = [];
    const datas = [];
    for (let i = 0; i < todasDatas.length; i++) {
      if (todasDatas[i] >= dtIni && todasDatas[i] <= dtFim) {
        indices.push(i);
        datas.push(todasDatas[i]);
      }
    }

    if (indices.length < 2 && todasDatas.length >= 2) {
      return {
        indices: [0, todasDatas.length - 1],
        datas: [todasDatas[0], todasDatas[todasDatas.length - 1]],
        sintetico: false,
        dtIni: todasDatas[0],
        dtFim: todasDatas[todasDatas.length - 1]
      };
    }

    return { indices, datas, sintetico: false, dtIni, dtFim };
  }

  /* ---------- Diagnóstico "Barato há muito tempo?" ---------- */

  function diagnosticarDescontoProlongado(ativo, serie, serieTeto) {
    const validos = serie.filter(p => ehValido(p.preco) && p.preco > 0);
    const tetoBazin = ativo?.bazin?.teto;
    const cat = obterCategoriaAtivo(ativo);

    if (!validos.length) {
      return {
        tipo: 'neutro',
        titulo: 'Histórico indisponível',
        resumo: 'Sem cotações suficientes na janela selecionada.',
        pctAbaixo: null,
        minPreco: null,
        maxPreco: null,
        medPreco: null,
        varPeriodo: null,
        diasStreak: 0
      };
    }

    const precos = validos.map(p => p.preco);
    const minPreco = Math.min(...precos);
    const maxPreco = Math.max(...precos);
    const medPreco = precos.reduce((acc, v) => acc + v, 0) / precos.length;
    const precoIni = validos[0].preco;
    const precoFim = validos[validos.length - 1].preco;
    const varPeriodo = precoIni > 0 ? (precoFim - precoIni) / precoIni : 0;
    const diasJanela = Math.max(1, (new Date(validos[validos.length - 1].data) - new Date(validos[0].data)) / 86400000);

    if (!ehValido(tetoBazin) || tetoBazin <= 0) {
      const refGraham = ehValido(ativo.graham)
        ? `Valor intrínseco Graham: ${formataReal(ativo.graham)} (${formataPct(ativo.margem_graham)}).`
        : 'Sem LPA/VPA positivos para cálculo de Graham.';
      return {
        tipo: 'sem-bazin',
        titulo: cat === 'demais' ? 'Perfil Demais papéis · sem teto Bazin aplicável' : 'Sem DPA recorrente p/ Teto Bazin',
        resumo: `${ativo.ticker} não distribuiu proventos recorrentes nos últimos 5 anos fechados para formar preço-teto Bazin. ${refGraham}`,
        pctAbaixo: null,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak: 0
      };
    }

    const mapaTeto = new Map((serieTeto || []).map(st => [st.data, st.teto]));
    const obterTetoNaData = (dt) => {
      if (visualState.modoTetoBazin === 'dinamico' && mapaTeto.has(dt) && ehValido(mapaTeto.get(dt))) {
        return mapaTeto.get(dt);
      }
      return tetoBazin;
    };

    const qtdAbaixo = validos.filter(p => p.preco <= obterTetoNaData(p.data)).length;
    const pctAbaixo = qtdAbaixo / validos.length;
    const estaAbaixoAgora = precoFim <= obterTetoNaData(validos[validos.length - 1].data);

    let idxQuebra = -1;
    if (estaAbaixoAgora) {
      for (let i = validos.length - 1; i >= 0; i--) {
        if (validos[i].preco > obterTetoNaData(validos[i].data)) {
          idxQuebra = i;
          break;
        }
      }
    }
    const dataInicioStreak = estaAbaixoAgora ? validos[Math.min(validos.length - 1, idxQuebra + 1)].data : null;
    const diasStreak = dataInicioStreak
      ? Math.max(7, (new Date(validos[validos.length - 1].data) - new Date(dataInicioStreak)) / 86400000)
      : 0;

    const notaSust = ehValido(ativo.sustentabilidade?.nota) ? ativo.sustentabilidade.nota : null;
    const rotuloSust = ativo.sustentabilidade?.rotulo || '';
    const sufixoSust = notaSust !== null
      ? ` Score Anti-Cilada: ${notaSust}/100 (${rotuloSust}).`
      : '';

    const labelModoTeto = visualState.modoTetoBazin === 'dinamico' ? 'Teto Bazin dinâmico da época' : `Teto Bazin atual (${formataReal(tetoBazin)})`;

    if (!estaAbaixoAgora) {
      return {
        tipo: 'acima',
        titulo: 'Negociando acima do Teto Bazin atualmente',
        resumo: pctAbaixo > 0
          ? `Acima do teto hoje (${formataReal(precoFim)} vs. teto ${formataReal(tetoBazin)}), mas esteve abaixo do ${labelModoTeto} em ${formataPctSimples(pctAbaixo, 0)} desta janela de ${ROTULO_PERIODO[visualState.periodo]}.${sufixoSust}`
          : `Permaneceu 100% dos últimos ${ROTULO_PERIODO[visualState.periodo]} acima do ${labelModoTeto}.${sufixoSust}`,
        pctAbaixo,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak: 0
      };
    }

    if (diasJanela >= 500 && (pctAbaixo >= 0.70 || diasStreak >= 540) && varPeriodo <= 0.05) {
      const diasAcum = Math.round(pctAbaixo * diasJanela);
      const trechoTempo = diasStreak >= 180
        ? `há ${fmtDuracaoDias(diasStreak)} ininterruptos`
        : `cerca de ${fmtDuracaoDias(diasAcum)} acumulados na janela`;
      return {
        tipo: 'alerta',
        titulo: 'Atenção · Barato há muito tempo sem reação na cotação',
        resumo: `Negociou abaixo do ${labelModoTeto} em ${formataPctSimples(pctAbaixo, 0)} do período (${trechoTempo}) com variação de cotação de ${formataPct(varPeriodo)}.${sufixoSust} Verifique os 4 pilares no Raio-X para descartar armadilha de valor.`,
        pctAbaixo,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak,
        diasAcum
      };
    }

    if (diasJanela >= 500 && (pctAbaixo >= 0.65 || diasStreak >= 450)) {
      const diasAcum = Math.round(pctAbaixo * diasJanela);
      const trechoTempo = diasStreak >= 180
        ? `há ${fmtDuracaoDias(diasStreak)} ininterruptos`
        : `cerca de ${fmtDuracaoDias(diasAcum)} acumulados`;
      return {
        tipo: 'estrutural',
        titulo: 'Desconto recorrente · Múltiplos historicamente abaixo do teto',
        resumo: `Ficou abaixo do ${labelModoTeto} em ${formataPctSimples(pctAbaixo, 0)} do período (${trechoTempo}), porém valorizando ${formataPct(varPeriodo)} na cotação.${sufixoSust}`,
        pctAbaixo,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak,
        diasAcum
      };
    }

    return {
      tipo: 'recente',
      titulo: 'Janela de desconto recente frente ao histórico',
      resumo: `Abaixo do ${labelModoTeto} há ${fmtDuracaoDias(diasStreak)} (${formataPctSimples(pctAbaixo, 0)} da janela de ${ROTULO_PERIODO[visualState.periodo]}). Não configura papel estagnado barato por anos.${sufixoSust}`,
      pctAbaixo,
      minPreco,
      maxPreco,
      medPreco,
      varPeriodo,
      diasStreak
    };
  }

  /* ---------- Simulador de Retorno com Dividendos ---------- */

  function simularRetornoAtivo(ativo, janela, capitalInicial, reinvestir, liquidoJcp) {
    const serieBruta = extrairSerieAtivo(ativo, janela);
    const validos = serieBruta.filter(p => ehValido(p.preco) && p.preco > 0);
    if (validos.length < 2) return null;

    const dataIni = validos[0].data;
    const dataFim = validos[validos.length - 1].data;
    const precoIni = validos[0].preco;
    const precoFim = validos[validos.length - 1].preco;

    const acoesIniciais = capitalInicial / precoIni;
    let acoes = acoesIniciais;
    let caixaAcumulado = 0;
    let proventosRecebidosRS = 0;
    let qtdEventos = 0;

    const proventos = Array.isArray(ativo.proventos_historico)
      ? ativo.proventos_historico
          .filter(ev => ev && ev.data_com > dataIni && ev.data_com <= dataFim && ehValido(ev.valor) && ev.valor > 0)
          .sort((a, b) => String(a.data_com).localeCompare(String(b.data_com)))
      : [];

    let ptrProv = 0;
    const curva = [];

    for (let i = 0; i < validos.length; i++) {
      const pt = validos[i];
      let provSemanaRS = 0;
      let provSemanaUnit = 0;

      while (ptrProv < proventos.length && proventos[ptrProv].data_com <= pt.data) {
        const ev = proventos[ptrProv];
        const fatorIr = (liquidoJcp && ev.tipo === 'jcp') ? 0.85 : 1.0;
        const unitLiq = ev.valor * fatorIr;
        const recebido = acoes * unitLiq;

        proventosRecebidosRS += recebido;
        provSemanaRS += recebido;
        provSemanaUnit += unitLiq;
        qtdEventos += 1;

        if (reinvestir) {
          acoes += recebido / pt.preco;
        } else {
          caixaAcumulado += recebido;
        }
        ptrProv += 1;
      }

      const patTotal = acoes * pt.preco + caixaAcumulado;
      const patCotacao = acoesIniciais * pt.preco;

      curva.push({
        data: pt.data,
        preco: pt.preco,
        acoes,
        patTotal,
        patCotacao,
        proventosAcumRS: proventosRecebidosRS,
        provSemanaRS,
        provSemanaUnit
      });
    }

    const ultimo = curva[curva.length - 1];
    const patrimonioFinal = ultimo.patTotal;
    const patrimonioCotacaoFinal = ultimo.patCotacao;
    const lucroTotal = patrimonioFinal - capitalInicial;
    const retornoTotal = (patrimonioFinal - capitalInicial) / capitalInicial;
    const retornoCotacao = (patrimonioCotacaoFinal - capitalInicial) / capitalInicial;
    const efeitoProventosRS = patrimonioFinal - patrimonioCotacaoFinal;
    const yocAcumulado = proventosRecebidosRS / capitalInicial;

    const diasDecorridos = Math.max(14, (new Date(dataFim) - new Date(dataIni)) / 86400000);
    const anos = diasDecorridos / 365.25;
    const cagr = anos >= 0.45 && patrimonioFinal > 0
      ? Math.pow(patrimonioFinal / capitalInicial, 1 / anos) - 1
      : null;

    return {
      ativo,
      dataIni,
      dataFim,
      precoIni,
      precoFim,
      acoesIniciais,
      acoesFinais: acoes,
      capitalInicial,
      patrimonioFinal,
      patrimonioCotacaoFinal,
      lucroTotal,
      retornoTotal,
      retornoCotacao,
      efeitoProventosRS,
      proventosRecebidosRS,
      yocAcumulado,
      qtdEventos,
      cagr,
      curva
    };
  }

  function simularBenchmark(codigo, janela, capitalInicial, datasRef) {
    const cfg = ESTILO_BENCHMARKS[codigo];
    if (!cfg || !janela || !Array.isArray(janela.datas) || janela.datas.length < 2) return null;

    const payload = obterPayload();
    const seriePayload = payload?.benchmarks_historico?.[codigo];
    const datasAlvo = Array.isArray(datasRef) && datasRef.length >= 2 ? datasRef : janela.datas;
    const todasDatas = Array.isArray(payload?.historico_datas) ? payload.historico_datas : [];
    const mapaIdxGlobal = new Map(todasDatas.map((d, i) => [d, i]));

    const pontos = [];
    let temDadosReais = Array.isArray(seriePayload) && seriePayload.length > 0;

    if (temDadosReais) {
      let ultVal = null;
      for (let k = 0; k < datasAlvo.length; k++) {
        const dt = datasAlvo[k];
        const idxG = mapaIdxGlobal.get(dt);
        const v = idxG !== undefined ? seriePayload[idxG] : null;
        if (ehValido(v) && v > 0) {
          ultVal = v;
        }
        pontos.push({ data: dt, preco: ultVal });
      }
      // Backfill inicial se os primeiros pontos forem nulos
      const primeiroValido = pontos.find(p => ehValido(p.preco) && p.preco > 0)?.preco;
      if (ehValido(primeiroValido)) {
        for (let k = 0; k < pontos.length; k++) {
          if (!ehValido(pontos[k].preco)) pontos[k].preco = primeiroValido;
          else break;
        }
      } else {
        temDadosReais = false;
      }
    }

    if (!temDadosReais) {
      // Fallback determinístico composto caso o JSON ainda não contenha a série
      const t0 = new Date(datasAlvo[0] + 'T12:00:00Z').getTime();
      const taxa = cfg.taxaAnualFallback || 0.10;
      for (let k = 0; k < datasAlvo.length; k++) {
        const tk = new Date(datasAlvo[k] + 'T12:00:00Z').getTime();
        const anos = Math.max(0, (tk - t0) / (365.25 * 86400000));
        pontos.push({ data: datasAlvo[k], preco: 100 * Math.pow(1 + taxa, anos) });
      }
    }

    const validos = pontos.filter(p => ehValido(p.preco) && p.preco > 0);
    if (validos.length < 2) return null;

    const dataIni = validos[0].data;
    const dataFim = validos[validos.length - 1].data;
    const precoIni = validos[0].preco;
    const precoFim = validos[validos.length - 1].preco;

    const curva = validos.map(pt => {
      const patTotal = capitalInicial * (pt.preco / precoIni);
      return {
        data: pt.data,
        preco: pt.preco,
        patTotal,
        patCotacao: patTotal
      };
    });

    const patrimonioFinal = curva[curva.length - 1].patTotal;
    const lucroTotal = patrimonioFinal - capitalInicial;
    const retornoTotal = (patrimonioFinal - capitalInicial) / capitalInicial;

    const diasDecorridos = Math.max(14, (new Date(dataFim) - new Date(dataIni)) / 86400000);
    const anos = diasDecorridos / 365.25;
    const cagr = anos >= 0.45 && patrimonioFinal > 0
      ? Math.pow(patrimonioFinal / capitalInicial, 1 / anos) - 1
      : null;

    return {
      ehBenchmark: true,
      codigo,
      nome: cfg.nome,
      curto: cfg.curto,
      cor: cfg.cor,
      dash: cfg.dash,
      dotCls: cfg.dotCls,
      dataIni,
      dataFim,
      precoIni,
      precoFim,
      capitalInicial,
      patrimonioFinal,
      lucroTotal,
      retornoTotal,
      cagr,
      curva
    };
  }

  /* ---------- Utilitários de Gráfico SVG Widescreen ---------- */

  function medirLarguraGrafico(containerEl) {
    const rectW = containerEl ? Math.round(containerEl.getBoundingClientRect().width) : 0;
    const clientW = containerEl ? containerEl.clientWidth : 0;
    const bruto = rectW || clientW;
    if (bruto > 140) return Math.max(280, bruto - 28);
    const winW = window.innerWidth || 1366;
    if (winW > 980) return Math.min(1040, Math.max(620, winW - 390));
    return Math.max(290, winW - 44);
  }

  function calcularTicksEixoY(minVal, maxVal, qtdDesejada = 5) {
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return { min: 0, max: 10, ticks: [0, 5, 10] };
    if (Math.abs(maxVal - minVal) < 1e-6) {
      const delta = Math.abs(maxVal) * 0.1 || 1;
      minVal -= delta;
      maxVal += delta;
    }
    const amplitude = maxVal - minVal;
    const passoBruto = amplitude / Math.max(2, qtdDesejada - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(passoBruto)));
    const norm = passoBruto / mag;
    let mult = 1;
    if (norm > 5) mult = 10;
    else if (norm > 2.5) mult = 5;
    else if (norm > 2) mult = 2.5;
    else if (norm > 1) mult = 2;
    const passo = mult * mag;

    const novoMin = Math.floor(minVal / passo) * passo;
    const novoMax = Math.ceil(maxVal / passo) * passo;
    const ticks = [];
    for (let v = novoMin; v <= novoMax + passo * 0.001; v += passo) {
      ticks.push(Number(v.toFixed(6)));
    }
    return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
  }

  function resolverColisaoVertical(itens, minTop, maxBottom, espacamento = 26) {
    if (!itens.length) return [];
    const ord = itens.map(x => ({ ...x, yLabel: Math.max(minTop, Math.min(maxBottom, x.y)) }))
      .sort((a, b) => a.yLabel - b.yLabel);

    for (let i = 1; i < ord.length; i++) {
      if (ord[i].yLabel - ord[i - 1].yLabel < espacamento) {
        ord[i].yLabel = ord[i - 1].yLabel + espacamento;
      }
    }
    if (ord[ord.length - 1].yLabel > maxBottom) {
      ord[ord.length - 1].yLabel = maxBottom;
      for (let i = ord.length - 2; i >= 0; i--) {
        if (ord[i + 1].yLabel - ord[i].yLabel < espacamento) {
          ord[i].yLabel = Math.max(minTop, ord[i + 1].yLabel - espacamento);
        }
      }
    }
    return ord;
  }

  function caminhoSvgLinha(pontosXY) {
    let d = '';
    let aberto = false;
    for (let i = 0; i < pontosXY.length; i++) {
      const pt = pontosXY[i];
      if (!pt || !Number.isFinite(pt.y)) {
        aberto = false;
        continue;
      }
      d += `${aberto ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)} `;
      aberto = true;
    }
    return d.trim();
  }

  function caminhoSvgArea(pontosXY, yBase) {
    const validos = pontosXY.filter(p => p && Number.isFinite(p.y));
    if (validos.length < 2) return '';
    const linha = caminhoSvgLinha(validos);
    const primeiro = validos[0];
    const ultimo = validos[validos.length - 1];
    return `${linha} L${ultimo.x.toFixed(1)},${yBase.toFixed(1)} L${primeiro.x.toFixed(1)},${yBase.toFixed(1)} Z`;
  }

  /* Crosshair com throttle via requestAnimationFrame */
  function anexarInteracaoCrosshair(svgEl, totalPontos, aoMover, aoSair) {
    const hitRect = svgEl.querySelector('.v-hit-area');
    if (!hitRect || totalPontos < 1) return;

    let rafId = null;
    let ultimoIdx = null;

    const processarEvento = (ev) => {
      const clientX = ev.clientX;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const rect = hitRect.getBoundingClientRect();
        if (!rect.width) return;
        const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const idx = Math.max(0, Math.min(totalPontos - 1, Math.round(relX * (totalPontos - 1))));
        if (idx !== ultimoIdx) {
          ultimoIdx = idx;
          aoMover(idx);
        }
      });
    };

    hitRect.addEventListener('pointerdown', processarEvento);
    hitRect.addEventListener('pointermove', processarEvento);
    hitRect.addEventListener('pointerleave', () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      ultimoIdx = null;
      aoSair();
    });
  }

  /* ---------- Renderização 1: Explorador Lateral (Desktop) & Seletor Mobile ---------- */

  function filtrarEOrdenarListaSidebar() {
    const universo = obterUniverso();
    const noPainelSet = new Set(obterSelecionadosPainel().map(t => String(t).toUpperCase()));
    const q = visualState.buscaLista.trim().toLowerCase();
    const cat = visualState.filtroLista;

    const filtrada = universo.filter(a => {
      const tUp = a.ticker.toUpperCase();
      if (cat === 'painel' && !noPainelSet.has(tUp)) return false;
      if (cat === 'besst' && obterCategoriaAtivo(a) !== 'besst') return false;
      if (cat === 'dividendos' && obterCategoriaAtivo(a) !== 'dividendos') return false;
      if (cat === 'demais' && obterCategoriaAtivo(a) !== 'demais') return false;

      if (q) {
        const matchTicker = a.ticker.toLowerCase().includes(q);
        const matchSetor = String(a.setor || '').toLowerCase().includes(q);
        const matchEmp = String(a.empresa || '').toLowerCase().includes(q);
        if (!matchTicker && !matchSetor && !matchEmp) return false;
      }
      return true;
    });

    if (visualState.ordemLista === 'az') {
      return filtrada.sort((a, b) => a.ticker.localeCompare(b.ticker));
    }

    return filtrada.sort((a, b) => {
      const ma = ehValido(a.bazin?.margem_seguranca) && a.bazin?.teto > 0 ? a.bazin.margem_seguranca : null;
      const mb = ehValido(b.bazin?.margem_seguranca) && b.bazin?.teto > 0 ? b.bazin.margem_seguranca : null;
      if (ma !== null && mb !== null) return mb - ma;
      if (ma !== null) return -1;
      if (mb !== null) return 1;
      const ga = ehValido(a.rank_greenblatt) ? a.rank_greenblatt : 9999;
      const gb = ehValido(b.rank_greenblatt) ? b.rank_greenblatt : 9999;
      if (ga !== gb) return ga - gb;
      return a.ticker.localeCompare(b.ticker);
    });
  }

  function renderizarChipsComparacaoHtml() {
    if (!visualState.comparados.length) return '';
    return visualState.comparados.map((t, idx) => {
      const dotCls = `dot-cmp-${idx % PALETA_COMPARACAO.length}`;
      return `
        <span class="vcompare-chip">
          <i class="dot ${dotCls}" aria-hidden="true"></i>
          <b>${escHtml(t)}</b>
          <button type="button" data-vremove-cmp="${escHtml(t)}" aria-label="Remover ${escHtml(t)} da comparação">×</button>
        </span>`;
    }).join('');
  }

  function renderizarExploradorEControles(principal) {
    const universo = obterUniverso();
    const universoOrd = [...universo].sort((a, b) => a.ticker.localeCompare(b.ticker));
    const noPainelSet = new Set(obterSelecionadosPainel().map(t => String(t).toUpperCase()));

    const ws = qSel('#visual-workspace');
    const btnSidebar = qSel('#btn-toggle-visual-sidebar');
    if (ws) ws.classList.toggle('is-sidebar-collapsed', visualState.sidebarRecolhida);
    if (btnSidebar) {
      btnSidebar.classList.toggle('is-active', visualState.sidebarRecolhida);
      btnSidebar.setAttribute('aria-pressed', String(visualState.sidebarRecolhida));
    }

    // 1. Selects mobile (#visual-main-select & #visual-compare-select)
    const gruposOpt = [
      { titulo: 'No seu painel', itens: universoOrd.filter(a => noPainelSet.has(a.ticker.toUpperCase())) },
      { titulo: 'Setores BESST', itens: universoOrd.filter(a => !noPainelSet.has(a.ticker.toUpperCase()) && obterCategoriaAtivo(a) === 'besst') },
      { titulo: 'Outras pagadoras de dividendos', itens: universoOrd.filter(a => !noPainelSet.has(a.ticker.toUpperCase()) && obterCategoriaAtivo(a) === 'dividendos') },
      { titulo: 'Demais papéis', itens: universoOrd.filter(a => !noPainelSet.has(a.ticker.toUpperCase()) && obterCategoriaAtivo(a) === 'demais') }
    ];

    const selMain = qSel('#visual-main-select');
    if (selMain) {
      selMain.innerHTML = gruposOpt
        .filter(g => g.itens.length)
        .map(g => `<optgroup label="${escHtml(g.titulo)}">${g.itens.map(a =>
          `<option value="${escHtml(a.ticker)}" ${a.ticker.toUpperCase() === principal.ticker.toUpperCase() ? 'selected' : ''}>${escHtml(a.ticker)} · ${escHtml(a.setor)} (${formataReal(a.preco)})</option>`
        ).join('')}</optgroup>`).join('');
    }

    const selCmp = qSel('#visual-compare-select');
    if (selCmp) {
      const jaUsados = new Set([principal.ticker.toUpperCase(), ...visualState.comparados]);
      const desabilitado = visualState.comparados.length >= 4;
      selCmp.disabled = desabilitado;
      selCmp.innerHTML = `<option value="">${desabilitado ? 'Limite (4/4)' : '+ Comparar…'}</option>` +
        gruposOpt
          .filter(g => g.itens.length)
          .map(g => {
            const disp = g.itens.filter(a => !jaUsados.has(a.ticker.toUpperCase()));
            if (!disp.length) return '';
            return `<optgroup label="${escHtml(g.titulo)}">${disp.map(a =>
              `<option value="${escHtml(a.ticker)}">${escHtml(a.ticker)} · ${escHtml(a.setor)}</option>`
            ).join('')}</optgroup>`;
          }).join('');
    }

    const mobileChipsEl = qSel('#visual-mobile-cmp-chips');
    if (mobileChipsEl) {
      mobileChipsEl.innerHTML = visualState.comparados.length
        ? `<span class="vctrl-mini-label">Comparando:</span>${renderizarChipsComparacaoHtml()}<button type="button" class="btn-link-dim" data-vclear-cmp="1">Limpar</button>`
        : '';
    }

    // 2. Controles da Sidebar Desktop
    const sortBtn = qSel('#visual-list-sort');
    if (sortBtn) {
      sortBtn.textContent = visualState.ordemLista === 'az' ? 'A–Z ↓' : 'Margem ↓';
    }

    document.querySelectorAll('#visual-cat-filter .vcat-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.vcat === visualState.filtroLista);
    });

    const chipsBox = qSel('#visual-compare-chips');
    if (chipsBox) {
      if (!visualState.comparados.length) {
        chipsBox.innerHTML = `
          <div class="vside-cmp-head"><span>Comparação (0/4)</span></div>
          <p class="vside-cmp-hint">Clique em <b>+</b> ao lado de qualquer ação abaixo para comparar no gráfico.</p>
        `;
      } else {
        chipsBox.innerHTML = `
          <div class="vside-cmp-head">
            <span>Comparando (${visualState.comparados.length}/4)</span>
            <button type="button" class="btn-link-dim" data-vclear-cmp="1">Limpar</button>
          </div>
          <div class="vcompare-chips">${renderizarChipsComparacaoHtml()}</div>
        `;
      }
    }

    // 3. Lista rolável de ações na Sidebar Desktop
    const listaEl = qSel('#visual-stock-list');
    const countBadge = qSel('#vside-count-badge');
    const listaFiltrada = filtrarEOrdenarListaSidebar();

    if (countBadge) countBadge.textContent = String(listaFiltrada.length);

    if (listaEl) {
      if (!listaFiltrada.length) {
        const msgVazio = visualState.filtroLista === 'painel' && !noPainelSet.size
          ? `Nenhum papel selecionado no seu painel.<br><button type="button" class="btn-inline-link" data-vreset-cat="todos">Ver todos os ${universo.length} ativos</button>`
          : `Nenhum papel encontrado para o filtro atual.`;
        listaEl.innerHTML = `<div class="vside-empty">${msgVazio}</div>`;
      } else {
        const cmpSet = new Set(visualState.comparados);
        const limiteAtingido = visualState.comparados.length >= 4;
        const esconderBadgeBesst = visualState.filtroLista === 'besst';

        listaEl.innerHTML = listaFiltrada.map(a => {
          const tUp = a.ticker.toUpperCase();
          const ehFoco = tUp === principal.ticker.toUpperCase();
          const ehCmp = cmpSet.has(tUp);
          const idxCmp = visualState.comparados.indexOf(tUp);
          const cat = obterCategoriaAtivo(a);
          const temBazin = ehValido(a.bazin?.teto) && a.bazin.teto > 0;
          const margem = temBazin ? a.bazin?.margem_seguranca : null;

          const clsDot = ehFoco
            ? 'dot-price'
            : (ehCmp
              ? `dot-cmp-${idxCmp % PALETA_COMPARACAO.length}`
              : (a.bazin?.veredito === 'verde' ? 'dot-green' : (a.bazin?.veredito === 'amarelo' ? 'dot-yellow' : (cat === 'demais' ? 'dot-graham' : 'dot-red'))));

          const catMini = cat === 'demais'
            ? `<span class="vstock-cat-mini is-demais">Demais</span>`
            : (cat === 'besst' && !esconderBadgeBesst ? `<span class="vstock-cat-mini">BESST</span>` : '');

          const subTexto = a.empresa ? `${a.setor} · ${a.empresa}` : a.setor;
          const metricaSecundaria = temBazin
            ? `<span class="vstock-margin ${corClasseMargem(margem)}">${formataPct(margem)}</span>`
            : (ehValido(a.rank_greenblatt)
              ? `<span class="vstock-margin t-accent">GB #${a.rank_greenblatt}</span>`
              : `<span class="vstock-margin t-dim">s/ Bazin</span>`);

          let btnCmpHtml = '';
          if (ehFoco) {
            btnCmpHtml = `<span class="vcmp-toggle is-on" title="Ativo principal em foco" aria-label="Ativo principal em foco">●</span>`;
          } else {
            const desab = !ehCmp && limiteAtingido;
            btnCmpHtml = `
              <button type="button" class="vcmp-toggle ${ehCmp ? 'is-on' : ''}" data-vtoggle-cmp="${escHtml(a.ticker)}"
                ${desab ? 'disabled' : ''}
                title="${ehCmp ? `Remover ${a.ticker} da comparação` : (desab ? 'Limite de 4 comparações atingido' : `Comparar com ${a.ticker}`)}"
                aria-label="${ehCmp ? `Remover ${a.ticker} da comparação` : `Comparar com ${a.ticker}`}">
                ${ehCmp ? '✓' : '+'}
              </button>`;
          }

          return `
            <div class="vstock-row ${ehFoco ? 'is-focused' : ''} ${ehCmp ? 'is-compared' : ''}"
              role="option" aria-selected="${ehFoco}" data-vselect-ticker="${escHtml(a.ticker)}">
              <div class="vstock-left">
                <div class="vstock-tline">
                  <i class="dot ${clsDot}" aria-hidden="true"></i>
                  <span class="vstock-ticker">${escHtml(a.ticker)}</span>
                  ${catMini}
                </div>
                <span class="vstock-sub">${escHtml(subTexto)}</span>
              </div>
              <div class="vstock-metrics">
                <span class="vstock-price">${formataReal(a.preco)}</span>
                ${metricaSecundaria}
              </div>
              ${btnCmpHtml}
            </div>
          `;
        }).join('');
      }
    }
  }

  /* ---------- Renderização 2: Cabeçalho Hero do Ativo & 4 Mini-KPIs ---------- */

  function renderizarHeroAtivo(principal, janela) {
    const headerEl = qSel('#visual-asset-header');
    const kpisEl = qSel('#visual-asset-kpis');
    const temBazin = ehValido(principal.bazin?.teto) && principal.bazin.teto > 0;
    const dataUltCot = fmtDataBr(principal.data_ult_cot || janela?.datas?.[janela.datas.length - 1]);

    if (headerEl) {
      const cat = obterCategoriaAtivo(principal);
      const catBadge = cat === 'besst'
        ? `<span class="tag tag-besst">BESST</span>`
        : (cat === 'demais' ? `<span class="tag tag-demais">Demais papéis</span>` : `<span class="tag tag-div">Dividendos</span>`);

      headerEl.innerHTML = `
        <div class="vhero-top">
          <span class="vhero-ticker">${escHtml(principal.ticker)}</span>
          <span class="vhero-price">${formataReal(principal.preco)}</span>
          ${catBadge}
          ${temBazin ? badgeVereditoHtml(principal.bazin?.veredito) : `<span class="tag">Sem teto Bazin</span>`}
          ${typeof window.htmlSustentabilidade === 'function' ? window.htmlSustentabilidade(principal) : ''}
        </div>
        <div class="vhero-meta">
          ${principal.empresa ? `<strong class="t-strong">${escHtml(principal.empresa)}</strong><span class="vhero-sep">·</span>` : ''}
          <span class="t-cap">Setor: <strong class="t-strong">${escHtml(principal.setor)}</strong></span>
          <span class="vhero-sep">·</span>
          <span>Última cotação: <strong class="mono t-strong">${escHtml(dataUltCot)}</strong></span>
          <span class="vhero-sep">·</span>
          <button type="button" class="btn-inline-link" data-vopen-detail="${escHtml(principal.ticker)}">Abrir Raio-X</button>
          <span class="vhero-sep">·</span>
          <a class="btn-inline-link" href="${obterUrlInvestidor10(principal.ticker)}" target="_blank" rel="noopener noreferrer">Investidor10 ↗</a>
        </div>
      `;
    }

    if (kpisEl) {
      const janelaAtual = janela || obterDatasJanela();
      const serie = extrairSerieAtivo(principal, janelaAtual);
      const serieTetoBazin = calcularSerieTetoBazinHistorico(principal, janelaAtual.datas);
      const diag = diagnosticarDescontoProlongado(principal, serie, serieTetoBazin);
      const mBaz = temBazin ? principal.bazin.margem_seguranca : null;
      const pctAbaixo = ehValido(diag.pctAbaixo)
        ? diag.pctAbaixo
        : (ehValido(principal.pct_abaixo_teto_5a) ? principal.pct_abaixo_teto_5a : null);
      const dpa5a = principal.bazin?.dpa_sem_extra;
      const dy12m = principal.fundamentos?.dy_12m;

      kpisEl.innerHTML = `
        <div class="kpi" data-tip="Margem de segurança Bazin = (Teto − Preço) ÷ Teto, considerando K = 6% fixo">
          <div class="kpi-label"><span>Margem Bazin atual</span></div>
          <div class="kpi-value ${corClasseMargem(mBaz)}">${temBazin ? formataPct(mBaz) : '—'}</div>
          <div class="kpi-foot">${temBazin ? `Teto Bazin (6%): ${formataReal(principal.bazin.teto)}` : 'Sem DPA 5a recorrente'}</div>
        </div>
        <div class="kpi" data-tip="Fração das semanas na janela selecionada em que a cotação fechou igual ou abaixo do Teto Bazin">
          <div class="kpi-label"><span>% do período abaixo do teto</span></div>
          <div class="kpi-value">${ehValido(pctAbaixo) ? formataPctSimples(pctAbaixo, 0) : '—'}</div>
          <div class="kpi-foot">${ehValido(pctAbaixo) ? `Janela analisada: ${ROTULO_PERIODO[visualState.periodo]}` : 'Teto Bazin não aplicável'}</div>
        </div>
        <div class="kpi" data-tip="Média anual de dividendos e JCP nos últimos 5 anos civis fechados (pela data-com, sem extraordinários)">
          <div class="kpi-label"><span>DPA 5a (média anual)</span></div>
          <div class="kpi-value">${ehValido(dpa5a) && dpa5a > 0 ? formataReal(dpa5a) : '—'}</div>
          <div class="kpi-foot">${principal.bazin?.tem_extraordinario ? `Com extra: ${formataReal(principal.bazin.dpa)}` : 'Base recorrente (sem extraordinários)'}</div>
        </div>
        <div class="kpi" data-tip="Dividend Yield acumulado nos últimos 12 meses sobre a cotação atual">
          <div class="kpi-label"><span>Dividend Yield (12m)</span></div>
          <div class="kpi-value">${ehValido(dy12m) ? formataPctSimples(dy12m, 1) : '—'}</div>
          <div class="kpi-foot">${ehValido(principal.ult_balanco) || principal.ult_balanco ? `Últ. balanço: ${fmtDataBr(principal.ult_balanco)}` : 'Proventos últimos 12 meses'}</div>
        </div>
      `;
    }

    document.querySelectorAll('#visual-period-group .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.vperiod === visualState.periodo);
    });
    document.querySelectorAll('#visual-chart-mode .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.vmode === visualState.modoPreco);
    });
  }

  /* ---------- Renderização 3: Gráfico de Preços vs. Preços-Teto Tracejados ---------- */

  function renderizarSecaoPrecosTetos(principal, ativosCmp, janela) {
    const legendEl = qSel('#visual-ceiling-legend');
    const peersEl = qSel('#visual-peer-suggestions');
    const hudEl = qSel('#visual-price-hud');
    const svgWrap = qSel('#visual-price-svg-wrap');
    const trapEl = qSel('#visual-valuetrap-box');
    const cmpTableWrap = qSel('#visual-compare-ceilings-wrap');
    if (!svgWrap) return;

    const todosAtivos = [principal, ...ativosCmp];
    const seriesPorTicker = new Map();
    todosAtivos.forEach(a => seriesPorTicker.set(a.ticker, extrairSerieAtivo(a, janela)));

    const modo = visualState.modoPreco;
    const tetoBazin = ehValido(principal.bazin?.teto) && principal.bazin.teto > 0 ? principal.bazin.teto : null;
    const tetoConsenso = ehValido(principal.teto_consenso) && principal.teto_consenso > 0
      ? principal.teto_consenso
      : (ehValido(principal.bazin?.teto_projetado_consenso) && principal.bazin.teto_projetado_consenso > 0 ? principal.bazin.teto_projetado_consenso : null);
    const margemConsenso = principal.margem_consenso ?? principal.bazin?.margem_projetada_consenso;

    const tetoBarsi = ehValido(principal.teto_barsi) && principal.teto_barsi > 0
      ? principal.teto_barsi
      : (ehValido(principal.bazin?.teto_projetado_barsi) && principal.bazin.teto_projetado_barsi > 0 ? principal.bazin.teto_projetado_barsi : null);
    const margemBarsi = principal.margem_barsi ?? principal.bazin?.margem_projetada_barsi;

    const tetoGraham = ehValido(principal.graham) && principal.graham > 0 ? principal.graham : null;
    const tetoGordon = ehValido(principal.gordon) && principal.gordon > 0 ? principal.gordon : null;
    const serieTetoBazin = calcularSerieTetoBazinHistorico(principal, janela.datas);
    const serieLucro = calcularSerieLucroHistorico(principal, janela.datas, visualState.frequenciaLucro);

    // 1. Legenda interativa de preços-teto e papéis (com aria-pressed e sem inline style)
    if (legendEl) {
      const seriesLegenda = todosAtivos.map((a, idx) => {
        const dotCls = idx === 0 ? 'dot-price' : `dot-cmp-${(idx - 1) % PALETA_COMPARACAO.length}`;
        return `<span class="vleg-item"><i class="dot ${dotCls}" aria-hidden="true"></i><b>${escHtml(a.ticker)}</b> <span class="mono t-muted">${formataReal(a.preco)}</span></span>`;
      }).join('');

      let tetosLegenda = '';
      if (modo === 'preco') {
        const modelos = [
          { cfg: ESTILO_TETOS.bazin, val: tetoBazin, m: principal.bazin?.margem_seguranca },
          { cfg: ESTILO_TETOS.consenso, val: tetoConsenso, m: margemConsenso },
          { cfg: ESTILO_TETOS.barsi, val: tetoBarsi, m: margemBarsi },
          { cfg: ESTILO_TETOS.graham, val: tetoGraham, m: principal.margem_graham },
          { cfg: ESTILO_TETOS.gordon, val: tetoGordon, m: principal.margem_gordon }
        ];
        tetosLegenda = modelos.map(({ cfg, val, m }) => {
          const ligado = visualState.tetosVisiveis[cfg.chave];
          const disp = ehValido(val);
          const ativo = Boolean(ligado && disp);
          const extraBazin = (cfg.chave === 'bazin' && disp)
            ? `<button type="button" class="vleg-mode-toggle ${visualState.modoTetoBazin === 'dinamico' ? 'is-active' : ''}" id="btn-toggle-teto-dinamico" title="Alternar entre Teto Bazin Dinâmico (recalculado ao longo do tempo) e Fixo (atual)" aria-label="Alternar modo do teto Bazin">
                ${visualState.modoTetoBazin === 'dinamico' ? 'Dinâmico' : 'Fixo'}
              </button>`
            : '';
          return `
            <div class="vleg-btn-wrap">
              <button type="button" class="vleg-btn ${ativo ? 'is-on' : 'is-off'} ${cfg.destaque ? 'is-primary-ceil' : ''}"
                data-vtoggle-ceil="${cfg.chave}" ${!disp ? 'disabled' : ''} aria-pressed="${String(ativo)}"
                data-tip="${disp ? `Mostrar ou ocultar a linha de ${cfg.nome} (${formataReal(val)})` : `${cfg.nome} não se aplica a ${principal.ticker}`}">
                <span class="vleg-swatch ${cfg.swatchCls}" aria-hidden="true"></span>
                <span>${cfg.curto}</span>
                ${cfg.destaque ? `<span class="vleg-badge-main">6%</span>` : ''}
                <strong class="mono">${disp ? formataReal(val) : 'N/A'}</strong>
                ${disp && ehValido(m) ? `<small class="mono ${corClasseMargem(m)}">(${formataPct(m)})</small>` : ''}
              </button>
              ${extraBazin}
            </div>`;
        }).join('');

        const toggleMediasHtml = `
          <div class="vleg-tech-toggles" role="group" aria-label="Médias Móveis Técnicas">
            <button type="button" class="vleg-tech-btn ${visualState.mediasVisiveis.mma21 ? 'is-active' : ''}" data-vmedia-toggle="mma21" data-tip="Média Móvel Aritmética de 21 semanas (curto/médio prazo)" aria-pressed="${visualState.mediasVisiveis.mma21}">
              <span class="vleg-swatch is-mma21" aria-hidden="true"></span>
              <span>MMA 21</span>
            </button>
            <button type="button" class="vleg-tech-btn ${visualState.mediasVisiveis.mma50 ? 'is-active' : ''}" data-vmedia-toggle="mma50" data-tip="Média Móvel Aritmética de 50 semanas (~1 ano)" aria-pressed="${visualState.mediasVisiveis.mma50}">
              <span class="vleg-swatch is-mma50" aria-hidden="true"></span>
              <span>MMA 50</span>
            </button>
          </div>
        `;
        tetosLegenda += toggleMediasHtml;
      } else if (modo === 'lucro_cotacao') {
        const pontosTrim = (principal.historico_lucros || []).filter(p => p.tipo === 'trimestral').sort((a, b) => (a.data || String(a.ano)).localeCompare(b.data || String(b.ano)));
        const ultPonto = visualState.frequenciaLucro === 'anual'
          ? (principal.historico_lucros?.filter(p => p.tipo === 'anual').pop() || principal.historico_lucros?.[principal.historico_lucros.length - 1])
          : (pontosTrim.length ? pontosTrim[pontosTrim.length - 1] : principal.historico_lucros?.[principal.historico_lucros.length - 1]);
        const rotPeriodo = ultPonto?.periodo || (ultPonto ? `${ultPonto.ano}` : '');
        const rotTipo = visualState.frequenciaLucro === 'trimestral' ? 'Trimestral' : (visualState.frequenciaLucro === '12m' ? '12M Móvel' : (visualState.frequenciaLucro === 'fcf' ? 'FCF Livre' : 'Anual'));
        const corLucroAtual = visualState.frequenciaLucro === 'fcf' ? '#10b981' : '#a855f7';
        const swatchLucroCls = visualState.frequenciaLucro === 'fcf' ? 'is-fcf' : 'is-lucro';
        const rotTituloSerie = visualState.frequenciaLucro === 'fcf' ? 'Fluxo de Caixa Livre (FCF)' : 'Lucro Líquido';
        const txtLucro = ultPonto ? `${formatarLucroGrande(ultPonto.lucro_liquido)} (${rotPeriodo})` : 'N/D';
        const txtLpa = (ultPonto && ehValido(ultPonto.lpa) && visualState.frequenciaLucro !== 'fcf') ? `LPA: R$ ${ultPonto.lpa.toFixed(2).replace('.', ',')}` : '';

        tetosLegenda = `
          <div class="vleg-lucro-wrap">
            <span class="vleg-item">
              <span class="vleg-swatch ${swatchLucroCls}" aria-hidden="true"></span>
              <span>${rotTituloSerie} <strong>${rotTipo}</strong>: <strong class="mono" style="color:${corLucroAtual};">${txtLucro}</strong> ${txtLpa ? `<small class="mono t-muted">(${txtLpa})</small>` : ''}</span>
            </span>
            <div class="segmented segmented-compact" id="visual-lucro-freq-group" role="group" aria-label="Frequência do Lucro">
              <button type="button" class="seg-btn ${visualState.frequenciaLucro === 'trimestral' ? 'is-active' : ''}" data-vlucro-freq="trimestral" data-tip="Exibe o lucro reportado a cada trimestre (3M) para avaliar descolamentos recentes">Trimestral (3M)</button>
              <button type="button" class="seg-btn ${visualState.frequenciaLucro === '12m' ? 'is-active' : ''}" data-vlucro-freq="12m" data-tip="Soma móvel dos últimos 4 trimestres (LTM/TTM)">12M Móvel</button>
              <button type="button" class="seg-btn ${visualState.frequenciaLucro === 'fcf' ? 'is-active' : ''}" data-vlucro-freq="fcf" data-tip="Fluxo de Caixa Livre (FCF = FCO − Capex) reportado a cada trimestre">FCF (Caixa Livre)</button>
              <button type="button" class="seg-btn ${visualState.frequenciaLucro === 'anual' ? 'is-active' : ''}" data-vlucro-freq="anual" data-tip="Exercícios contábeis anuais fechados">Anual</button>
            </div>
          </div>
          <span class="vleg-item t-muted">Eixo Esquerdo: Cotação (R$) · Eixo Direito: ${rotTituloSerie} (${rotTipo})</span>`;
      } else if (modo === 'margem_bazin') {
        tetosLegenda = `
          <span class="vleg-item">
            <span class="vleg-swatch is-bazin" aria-hidden="true"></span>
            <span>Linha <b>0%</b> = Teto Bazin de cada papel (acima de 0% = negociando abaixo do teto / margem positiva)</span>
          </span>`;
      } else {
        tetosLegenda = `<span class="vleg-item t-muted">Variação percentual acumulada da cotação (Base 0% no início de ${ROTULO_PERIODO[visualState.periodo]})</span>`;
      }

      legendEl.innerHTML = `<div class="vleg-group">${seriesLegenda}</div><div class="vleg-group">${tetosLegenda}</div>`;
    }

    // 2. Barra rápida de pares do mesmo setor + dica de normalização de escala ao comparar
    if (peersEl) {
      const jaUsados = new Set([principal.ticker.toUpperCase(), ...visualState.comparados]);
      const prefixoRaiz = principal.ticker.slice(0, 4);
      const pares = obterUniverso()
        .filter(a => !jaUsados.has(a.ticker.toUpperCase()) && a.setor === principal.setor && !a.ticker.startsWith(prefixoRaiz))
        .slice(0, 5);

      const htmlPares = pares.length && visualState.comparados.length < 4
        ? `<div class="vpeers-group"><span class="vctrl-mini-label">Comparar mesmo setor:</span>${pares.map(p =>
            `<button type="button" class="chip-mini" data-vadd-peer="${escHtml(p.ticker)}">+ ${escHtml(p.ticker)}</button>`
          ).join('')}</div>`
        : '';

      const htmlDicaEscala = ativosCmp.length > 0 && modo === 'preco'
        ? `<div class="vscale-tip">
            <span>Preços em faixas diferentes? Normalize:</span>
            <button type="button" class="chip-mini" data-vswitch-mode="margem_bazin">Margem vs. Bazin (%)</button>
            <button type="button" class="chip-mini" data-vswitch-mode="variacao">Variação (%)</button>
          </div>`
        : '';

      peersEl.innerHTML = htmlPares + htmlDicaEscala;
    }

    // 3. Construção das curvas numéricas
    const nPontos = janela.datas.length;
    const curvasPlot = [];

    todosAtivos.forEach((a, idx) => {
      const cor = idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length];
      const dotCls = idx === 0 ? 'dot-price' : `dot-cmp-${(idx - 1) % PALETA_COMPARACAO.length}`;
      const serie = seriesPorTicker.get(a.ticker) || [];
      const primeiroValido = serie.find(p => ehValido(p.preco) && p.preco > 0)?.preco || null;
      const tBazinAtivo = ehValido(a.bazin?.teto) && a.bazin.teto > 0 ? a.bazin.teto : null;

      const valores = serie.map(p => {
        if (!ehValido(p.preco) || p.preco <= 0) return null;
        if (modo === 'preco' || modo === 'lucro_cotacao') return p.preco;
        if (modo === 'margem_bazin') {
          if (!tBazinAtivo) return null;
          return ((tBazinAtivo - p.preco) / tBazinAtivo) * 100;
        }
        if (!primeiroValido) return null;
        return ((p.preco - primeiroValido) / primeiroValido) * 100;
      });

      curvasPlot.push({
        ativo: a,
        cor,
        dotCls,
        principal: idx === 0,
        serieOriginal: serie,
        valores
      });
    });

    const todosValoresY = [];
    curvasPlot.forEach(c => c.valores.forEach(v => { if (ehValido(v)) todosValoresY.push(v); }));

    // Médias Móveis Técnicas (MMA 21 e MMA 50)
    let serieMma21 = null;
    let serieMma50 = null;
    let xyMma21 = null;
    let xyMma50 = null;
    if (modo === 'preco' && principal && Array.isArray(principal.historico_precos)) {
      const histCompleto = principal.historico_precos;
      const calcularMmaJanela = (periodo) => {
        return janela.indices.map(idx => {
          if (idx === undefined || idx === null) return null;
          const ini = Math.max(0, idx - periodo + 1);
          const sub = histCompleto.slice(ini, idx + 1).filter(ehValido);
          if (sub.length < Math.min(periodo, 4)) return null;
          return sub.reduce((a, b) => a + b, 0) / sub.length;
        });
      };
      if (visualState.mediasVisiveis.mma21) {
        serieMma21 = calcularMmaJanela(21);
        serieMma21.forEach(v => { if (ehValido(v)) todosValoresY.push(v); });
      }
      if (visualState.mediasVisiveis.mma50) {
        serieMma50 = calcularMmaJanela(50);
        serieMma50.forEach(v => { if (ehValido(v)) todosValoresY.push(v); });
      }
    }

    const linhasTetoAtivas = [];
    let xyTetoBazin = null;
    if (modo === 'preco') {
      if (visualState.tetosVisiveis.bazin && ehValido(tetoBazin)) {
        if (visualState.modoTetoBazin === 'dinamico') {
          serieTetoBazin.forEach(st => {
            if (ehValido(st.teto)) todosValoresY.push(st.teto);
          });
          const ultimoTeto = serieTetoBazin[serieTetoBazin.length - 1]?.teto || tetoBazin;
          linhasTetoAtivas.push({ ...ESTILO_TETOS.bazin, valor: ultimoTeto, curto: 'Bazin (din.)', dinamico: true });
        } else {
          linhasTetoAtivas.push({ ...ESTILO_TETOS.bazin, valor: tetoBazin });
          todosValoresY.push(tetoBazin);
        }
      }
      if (visualState.tetosVisiveis.consenso && ehValido(tetoConsenso)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.consenso, valor: tetoConsenso });
        todosValoresY.push(tetoConsenso);
      }
      if (visualState.tetosVisiveis.barsi && ehValido(tetoBarsi)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.barsi, valor: tetoBarsi });
        todosValoresY.push(tetoBarsi);
      }
      if (visualState.tetosVisiveis.graham && ehValido(tetoGraham)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.graham, valor: tetoGraham });
        todosValoresY.push(tetoGraham);
      }
      if (visualState.tetosVisiveis.gordon && ehValido(tetoGordon)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.gordon, valor: tetoGordon });
        todosValoresY.push(tetoGordon);
      }
    } else if (modo === 'margem_bazin' || modo === 'variacao') {
      todosValoresY.push(0);
    }

    if (!todosValoresY.length) {
      svgWrap.innerHTML = `<div class="vchart-empty">Este ativo não possui dados para visualização no modo selecionado.</div>`;
    } else {
      const W = medirLarguraGrafico(svgWrap);
      const ehMobile = W < 580;
      const H = ehMobile ? 295 : 460;
      const padLeft = ehMobile ? 58 : 74;
      const padRight = modo === 'preco' && linhasTetoAtivas.length
        ? (ehMobile ? 108 : 158)
        : (modo === 'lucro_cotacao' ? (ehMobile ? 65 : 85) : (ehMobile ? 16 : 28));
      const padTop = 18;
      const padBottom = 32;
      const plotW = Math.max(120, W - padLeft - padRight);
      const plotH = H - padTop - padBottom;

      let yMinBruto = Math.min(...todosValoresY);
      let yMaxBruto = Math.max(...todosValoresY);
      const folga = (yMaxBruto - yMinBruto) * 0.09 || (Math.abs(yMaxBruto) * 0.09 || 1);
      if (modo === 'preco' || modo === 'lucro_cotacao') yMinBruto = Math.max(0, yMinBruto - folga);
      else yMinBruto -= folga;
      yMaxBruto += folga;

      const eixoY = calcularTicksEixoY(yMinBruto, yMaxBruto, ehMobile ? 5 : 6);
      const xDe = (i) => padLeft + (nPontos <= 1 ? plotW / 2 : (i / (nPontos - 1)) * plotW);
      const yDe = (v) => padTop + plotH - ((v - eixoY.min) / (eixoY.max - eixoY.min || 1)) * plotH;

      const fmtEixoY = (v) => {
        if (modo === 'preco' || modo === 'lucro_cotacao') return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: v < 10 ? 2 : 0 });
        return (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%';
      };

      const qtdTicksX = ehMobile ? 4 : 8;
      const ticksX = [];
      for (let t = 0; t < qtdTicksX; t++) {
        const idx = Math.round((t / (qtdTicksX - 1)) * (nPontos - 1));
        if (!ticksX.includes(idx)) ticksX.push(idx);
      }

      curvasPlot.forEach(c => {
        c.xy = c.valores.map((v, i) => ehValido(v) ? { x: xDe(i), y: yDe(v), v, data: janela.datas[i], preco: c.serieOriginal[i]?.preco } : null);
      });

      if (modo === 'preco' && visualState.modoTetoBazin === 'dinamico' && visualState.tetosVisiveis.bazin && ehValido(tetoBazin)) {
        xyTetoBazin = serieTetoBazin.map((st, i) => ehValido(st.teto) ? { x: xDe(i), y: yDe(st.teto), teto: st.teto } : null);
      }

      if (serieMma21) {
        xyMma21 = serieMma21.map((v, i) => ehValido(v) ? { x: xDe(i), y: yDe(v), v } : null);
      }
      if (serieMma50) {
        xyMma50 = serieMma50.map((v, i) => ehValido(v) ? { x: xDe(i), y: yDe(v), v } : null);
      }

      // Eixo Y e coordenadas para o Lucro Líquido (Peter Lynch)
      let eixoYLucro = null;
      let xyLucro = null;
      if (modo === 'lucro_cotacao') {
        const valsL = serieLucro.map(s => s.lucro).filter(ehValido);
        if (valsL.length) {
          let minL = Math.min(...valsL);
          let maxL = Math.max(...valsL);
          const folgaL = (maxL - minL) * 0.12 || (Math.abs(maxL) * 0.12 || 1e8);
          minL -= folgaL;
          maxL += folgaL;
          eixoYLucro = calcularTicksEixoY(minL, maxL, ehMobile ? 5 : 6);
          const yLucroDe = (v) => padTop + plotH - ((v - eixoYLucro.min) / (eixoYLucro.max - eixoYLucro.min || 1)) * plotH;
          xyLucro = serieLucro.map((s, i) => ehValido(s.lucro) ? {
            x: xDe(i),
            y: yLucroDe(s.lucro),
            lucro: s.lucro,
            lucroExercicio: s.lucroExercicio,
            lpa: s.lpa,
            ano: s.ano,
            data: s.data
          } : null);
        }
      }

      const curvaPrincipal = curvasPlot[0];
      const yBasePlot = padTop + plotH;

      // Curva tracejada do Teto Bazin Dinâmico
      let linhaTetoBazinDinamicoSvg = '';
      if (xyTetoBazin) {
        const dLinhaTeto = caminhoSvgLinha(xyTetoBazin);
        if (dLinhaTeto) {
          linhaTetoBazinDinamicoSvg = `<path d="${dLinhaTeto}" fill="none" stroke="${ESTILO_TETOS.bazin.cor}" stroke-width="2.2" stroke-dasharray="6 4" stroke-opacity="0.95" />`;
        }
      }

      // Zona sombreada quando negociou abaixo do Teto Bazin + rótulo discreto
      let zonaBazinSvg = '';
      if (modo === 'preco' && visualState.tetosVisiveis.bazin && ehValido(tetoBazin) && curvaPrincipal) {
        if (visualState.modoTetoBazin === 'fixo') {
          const yBazin = Math.max(padTop, Math.min(yBasePlot, yDe(tetoBazin)));
          const areaAbaixoTeto = caminhoSvgArea(curvaPrincipal.xy, yBazin);
          if (areaAbaixoTeto && yBazin < yBasePlot - 12) {
            const yLabelZona = Math.min(yBasePlot - 10, Math.max(padTop + 16, yBazin + 16));
            zonaBazinSvg = `
              <clipPath id="clip-bazin-zone">
                <rect x="${padLeft}" y="${yBazin.toFixed(1)}" width="${plotW}" height="${(yBasePlot - yBazin).toFixed(1)}" />
              </clipPath>
              <path d="${areaAbaixoTeto}" fill="rgba(6, 182, 212, 0.12)" clip-path="url(#clip-bazin-zone)" />
              <text x="${padLeft + 10}" y="${yLabelZona.toFixed(1)}" fill="var(--series-bazin)" font-family="var(--sans)" font-size="12" font-weight="600" opacity="0.88">Zona de compra (abaixo do teto Bazin fixo)</text>
            `;
          }
        } else {
          zonaBazinSvg = `
            <text x="${padLeft + 10}" y="${padTop + 16}" fill="var(--series-bazin)" font-family="var(--sans)" font-size="11" font-weight="600" opacity="0.9">Curva tracejada ciano: Teto Bazin Histórico Dinâmico</text>
          `;
        }
      } else if (modo === 'margem_bazin') {
        const yZero = Math.max(padTop, Math.min(yBasePlot, yDe(0)));
        if (yZero > padTop + 18) {
          zonaBazinSvg = `
            <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${(yZero - padTop).toFixed(1)}" fill="rgba(6, 182, 212, 0.08)" />
            <text x="${padLeft + 10}" y="${padTop + 16}" fill="var(--series-bazin)" font-family="var(--sans)" font-size="12" font-weight="600" opacity="0.88">Zona de compra (abaixo do teto Bazin)</text>
          `;
        }
      }

      const labelsTetos = resolverColisaoVertical(
        linhasTetoAtivas.map(lt => ({ ...lt, y: yDe(lt.valor) })),
        padTop + 14,
        yBasePlot - 14,
        28
      );

      const linhasGradeSvg = eixoY.ticks.map(tv => {
        const y = yDe(tv);
        return `
          <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" stroke="var(--svg-grid)" stroke-width="1" />
          <text x="${padLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="vsvg-axis-text">${escHtml(fmtEixoY(tv))}</text>
        `;
      }).join('');

      // Linhas e rótulos do eixo direito de Lucro Líquido
      let eixoDireitoLucroSvg = '';
      if (modo === 'lucro_cotacao' && eixoYLucro) {
        const xDir = padLeft + plotW;
        eixoDireitoLucroSvg = eixoYLucro.ticks.map(tv => {
          const y = padTop + plotH - ((tv - eixoYLucro.min) / (eixoYLucro.max - eixoYLucro.min || 1)) * plotH;
          return `
            <line x1="${xDir}" y1="${y.toFixed(1)}" x2="${xDir + 4}" y2="${y.toFixed(1)}" stroke="#a855f7" stroke-width="1.2" opacity="0.6" />
            <text x="${xDir + 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="start" class="vsvg-axis-text-right">${escHtml(formatarLucroCurto(tv))}</text>
          `;
        }).join('');
      }

      const ticksXSvg = ticksX.map(idx => {
        const x = xDe(idx);
        return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vsvg-axis-text">${escHtml(fmtDataCurta(janela.datas[idx], visualState.periodo !== '6m'))}</text>`;
      }).join('');

      let referenciasSvg = '';
      if (modo === 'preco') {
        referenciasSvg = labelsTetos.map(lt => {
          const xFim = padLeft + plotW;
          const textoValor = lt.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const linhaGuiaSvg = lt.dinamico
            ? ''
            : `<line x1="${padLeft}" y1="${lt.y.toFixed(1)}" x2="${xFim}" y2="${lt.y.toFixed(1)}"
                stroke="${lt.cor}" stroke-width="${lt.largura}" stroke-dasharray="${lt.dash}" />`;
          return `
            <g class="vsvg-ceil-group">
              ${linhaGuiaSvg}
              <path d="M${xFim},${lt.y.toFixed(1)} L${xFim + 7},${lt.yLabel.toFixed(1)}" stroke="${lt.cor}" stroke-width="1.2" opacity="0.75" fill="none" />
              <rect x="${xFim + 8}" y="${(lt.yLabel - 12).toFixed(1)}" width="${padRight - 12}" height="24" rx="6"
                fill="var(--svg-pill-bg)" stroke="${lt.cor}" stroke-opacity="${lt.destaque ? '0.9' : '0.55'}" stroke-width="${lt.destaque ? '1.4' : '1'}" />
              <text x="${xFim + 15}" y="${(lt.yLabel + 4.2).toFixed(1)}" class="vsvg-ceil-label"><tspan fill="var(--text)" font-weight="500">${escHtml(lt.curto)} </tspan><tspan fill="${lt.cor}" font-weight="700">${escHtml(ehMobile ? textoValor : 'R$ ' + textoValor)}</tspan></text>
            </g>
          `;
        }).join('');
      } else if (modo === 'margem_bazin') {
        const yZero = yDe(0);
        if (yZero >= padTop && yZero <= yBasePlot) {
          referenciasSvg = `
            <line x1="${padLeft}" y1="${yZero.toFixed(1)}" x2="${padLeft + plotW}" y2="${yZero.toFixed(1)}"
              stroke="${ESTILO_TETOS.bazin.cor}" stroke-width="2.4" stroke-dasharray="10 5" />
            <text x="${padLeft + plotW - 10}" y="${Math.max(padTop + 14, yZero - 7).toFixed(1)}" text-anchor="end" fill="${ESTILO_TETOS.bazin.cor}" class="vsvg-ceil-label">Teto Bazin (0% margem)</text>
          `;
        }
      } else if (modo === 'variacao') {
        const yZero = yDe(0);
        if (yZero >= padTop && yZero <= yBasePlot) {
          referenciasSvg = `<line x1="${padLeft}" y1="${yZero.toFixed(1)}" x2="${padLeft + plotW}" y2="${yZero.toFixed(1)}" stroke="var(--border-strong)" stroke-width="1.4" stroke-dasharray="4 4" />`;
        }
      }

      const areaPrincipalSvg = (modo === 'preco' || modo === 'lucro_cotacao') && ativosCmp.length === 0 && curvaPrincipal
        ? `<path d="${caminhoSvgArea(curvaPrincipal.xy, yBasePlot)}" fill="url(#grad-price-main)" />`
        : '';

      // Linhas de Médias Móveis Técnicas (MMA 21 e MMA 50)
      let linhasMmaSvg = '';
      if (xyMma21) {
        const d21 = caminhoSvgLinha(xyMma21);
        if (d21) linhasMmaSvg += `<path d="${d21}" fill="none" stroke="#f59e0b" stroke-width="2.0" opacity="0.9" stroke-linecap="round" stroke-linejoin="round" />`;
      }
      if (xyMma50) {
        const d50 = caminhoSvgLinha(xyMma50);
        if (d50) linhasMmaSvg += `<path d="${d50}" fill="none" stroke="#3b82f6" stroke-width="2.0" opacity="0.9" stroke-linecap="round" stroke-linejoin="round" />`;
      }

      // Curva de Lucro Líquido / FCF
      let curvaLucroSvg = '';
      const corCurvaLucro = visualState.frequenciaLucro === 'fcf' ? '#10b981' : '#a855f7';
      if (modo === 'lucro_cotacao' && xyLucro) {
        const dLucro = caminhoSvgLinha(xyLucro);
        if (dLucro) {
          curvaLucroSvg = `<path d="${dLucro}" fill="none" stroke="${corCurvaLucro}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />`;
          if (serieLucro.marcos && serieLucro.marcos.length) {
            const marcosSvg = serieLucro.marcos.map(m => {
              const pt = xyLucro[m.index];
              if (!pt) return '';
              const txtAno = m.ponto.periodo || String(m.ponto.ano);
              return `
                <g class="vsvg-lucro-marco">
                  <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" fill="${corCurvaLucro}" stroke="var(--surface,#18181b)" stroke-width="2" />
                  <text x="${pt.x.toFixed(1)}" y="${(pt.y - 8).toFixed(1)}" text-anchor="middle" fill="${corCurvaLucro}" font-family="var(--sans)" font-size="10" font-weight="700">${escHtml(txtAno)}</text>
                </g>
              `;
            }).join('');
            curvaLucroSvg += marcosSvg;
          }
        }
      }

      const linhasCurvasSvg = curvasPlot.map(c => {
        const d = caminhoSvgLinha(c.xy);
        if (!d) return '';
        const sw = c.principal ? 2.5 : 2.0;
        return `<path d="${d}" fill="none" stroke="${c.cor}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" />`;
      }).join('');

      const pontosCrosshairSvg = curvasPlot.map((c, idx) =>
        `<circle class="v-ch-dot is-hidden" data-ch-idx="${idx}" cx="0" cy="0" r="${c.principal ? 4.8 : 4}" fill="${c.cor}" stroke="var(--bg)" stroke-width="1.8" />`
      ).join('');

      const chDotLucroSvg = (modo === 'lucro_cotacao')
        ? `<circle class="v-ch-dot-lucro is-hidden" cx="0" cy="0" r="5" fill="${corCurvaLucro}" stroke="var(--bg)" stroke-width="2" />`
        : '';

      svgWrap.innerHTML = `
        <svg class="vsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gráfico histórico de preços e preços-teto de ${escHtml(principal.ticker)}">
          <defs>
            <linearGradient id="grad-price-main" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${COR_PRINCIPAL}" stop-opacity="0.22" />
              <stop offset="100%" stop-color="${COR_PRINCIPAL}" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          ${linhasGradeSvg}
          ${eixoDireitoLucroSvg}
          ${zonaBazinSvg}
          ${linhaTetoBazinDinamicoSvg}
          ${linhasMmaSvg}
          ${areaPrincipalSvg}
          ${referenciasSvg}
          ${curvaLucroSvg}
          ${linhasCurvasSvg}
          ${ticksXSvg}
          <line class="v-crosshair is-hidden" x1="0" y1="${padTop}" x2="0" y2="${yBasePlot}" stroke="var(--text-strong)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 3" />
          ${pontosCrosshairSvg}
          ${chDotLucroSvg}
          <rect class="v-hit-area" x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent" />
        </svg>
      `;

      const svgEl = svgWrap.querySelector('svg');
      const chLine = svgEl.querySelector('.v-crosshair');
      const chDots = svgEl.querySelectorAll('.v-ch-dot');
      const chDotLucro = svgEl.querySelector('.v-ch-dot-lucro');

      const atualizarHudPreco = (idx) => {
        const ehUltimo = idx === null || idx === undefined;
        const i = ehUltimo ? nPontos - 1 : idx;
        const dtReal = ehUltimo && principal.data_ult_cot
          ? fmtDataBr(principal.data_ult_cot)
          : fmtDataBr(janela.datas[i]);

        if (modo === 'lucro_cotacao') {
          const p = ehUltimo && ehValido(principal.preco) ? principal.preco : curvaPrincipal.serieOriginal[i]?.preco;
          const pontoL = (serieLucro && serieLucro[i]) ? serieLucro[i] : null;
          const lucroPonto = pontoL?.lucro;
          const lpaPonto = pontoL?.lpa;
          const perPonto = pontoL?.periodo || pontoL?.ano;
          const rotFreq = visualState.frequenciaLucro === 'trimestral' ? 'Trimestral' : (visualState.frequenciaLucro === '12m' ? '12M' : 'Anual');

          let plImpl = null;
          if (ehValido(p) && ehValido(lpaPonto) && lpaPonto > 0) {
            plImpl = visualState.frequenciaLucro === 'trimestral' ? (p / (lpaPonto * 4)) : (p / lpaPonto);
          }

          if (hudEl) {
            hudEl.innerHTML = `
              <span class="vhud-date mono">${ehUltimo ? `Última cotação (${dtReal})` : dtReal}</span>
              <span class="vhud-metric">Cotação: <strong class="mono">${formataReal(p)}</strong></span>
              <span class="vhud-metric"><i class="dot dot-lucro" style="background:${visualState.frequenciaLucro === 'fcf' ? '#10b981' : '#a855f7'};" aria-hidden="true"></i>${visualState.frequenciaLucro === 'fcf' ? 'FCF' : 'Lucro'} (${rotFreq}): <strong class="mono" style="color:${visualState.frequenciaLucro === 'fcf' ? '#10b981' : 'var(--series-lucro,#a855f7)'};">${formatarLucroGrande(lucroPonto)}</strong> ${perPonto ? `<small class="mono t-muted">(${perPonto})</small>` : ''}</span>
              ${ehValido(lpaPonto) ? `<span class="vhud-metric">LPA: <strong class="mono">R$ ${lpaPonto.toFixed(2).replace('.', ',')}</strong></span>` : ''}
              ${ehValido(plImpl) ? `<span class="vhud-metric">P/L Anualizado: <strong class="mono t-strong">${plImpl.toFixed(1).replace('.', ',')}x</strong></span>` : ''}
            `;
          }
        } else if (ativosCmp.length === 0) {
          const p = ehUltimo && ehValido(principal.preco) ? principal.preco : curvaPrincipal.serieOriginal[i]?.preco;
          const tetoBazinNaData = (visualState.modoTetoBazin === 'dinamico' && serieTetoBazin[i]?.teto)
            ? serieTetoBazin[i].teto
            : tetoBazin;
          const mBaz = ehValido(tetoBazinNaData) && ehValido(p) ? (tetoBazinNaData - p) / tetoBazinNaData : null;
          const mGra = ehValido(tetoGraham) && ehValido(p) ? (tetoGraham - p) / tetoGraham : null;
          const mGor = ehValido(tetoGordon) && ehValido(p) ? (tetoGordon - p) / tetoGordon : null;
          const mCons = ehValido(tetoConsenso) && ehValido(p) ? (tetoConsenso - p) / tetoConsenso : null;
          const mBars = ehValido(tetoBarsi) && ehValido(p) ? (tetoBarsi - p) / tetoBarsi : null;
          const labelBazinHud = visualState.modoTetoBazin === 'dinamico' ? `Bazin dinâmico (${formataReal(tetoBazinNaData)})` : 'Bazin';
          let infoMma = '';
          if (visualState.mediasVisiveis.mma21 && serieMma21 && ehValido(serieMma21[i])) {
            infoMma += `<span class="vhud-metric"><i class="dot" style="background:#f59e0b;" aria-hidden="true"></i>MMA 21: <strong class="mono" style="color:#f59e0b;">${formataReal(serieMma21[i])}</strong></span>`;
          }
          if (visualState.mediasVisiveis.mma50 && serieMma50 && ehValido(serieMma50[i])) {
            infoMma += `<span class="vhud-metric"><i class="dot" style="background:#3b82f6;" aria-hidden="true"></i>MMA 50: <strong class="mono" style="color:#3b82f6;">${formataReal(serieMma50[i])}</strong></span>`;
          }

          if (hudEl) {
            hudEl.innerHTML = `
              <span class="vhud-date mono">${ehUltimo ? `Última cotação (${dtReal})` : dtReal}</span>
              <span class="vhud-metric">Preço: <strong class="mono">${formataReal(p)}</strong></span>
              ${infoMma}
              ${ehValido(tetoBazinNaData) ? `<span class="vhud-metric">Margem vs. ${labelBazinHud}: <strong class="mono ${corClasseMargem(mBaz)}">${formataPct(mBaz)}</strong></span>` : ''}
              ${visualState.tetosVisiveis.consenso && ehValido(tetoConsenso) ? `<span class="vhud-metric"><i class="dot" style="background:#a3e635;" aria-hidden="true"></i>Consenso (${formataReal(tetoConsenso)}): <strong class="mono ${corClasseMargem(mCons)}">${formataPct(mCons)}</strong></span>` : ''}
              ${visualState.tetosVisiveis.barsi && ehValido(tetoBarsi) ? `<span class="vhud-metric"><i class="dot" style="background:#f97316;" aria-hidden="true"></i>Lucro (${formataReal(tetoBarsi)}): <strong class="mono ${corClasseMargem(mBars)}">${formataPct(mBars)}</strong></span>` : ''}
              ${ehValido(tetoGraham) ? `<span class="vhud-metric">Margem vs. Graham: <strong class="mono ${corClasseMargem(mGra)}">${formataPct(mGra)}</strong></span>` : ''}
              ${visualState.tetosVisiveis.gordon && ehValido(tetoGordon) ? `<span class="vhud-metric">Margem vs. Gordon: <strong class="mono ${corClasseMargem(mGor)}">${formataPct(mGor)}</strong></span>` : ''}
            `;
          }
        } else {
          const itens = curvasPlot.map(c => {
            const p = ehUltimo && ehValido(c.ativo.preco) ? c.ativo.preco : c.serieOriginal[i]?.preco;
            const valModo = c.valores[i];
            const txtVal = modo === 'preco'
              ? formataReal(p)
              : (ehValido(valModo) ? `${valModo > 0 ? '+' : ''}${valModo.toFixed(1)}% (${formataReal(p)})` : `s/ Bazin (${formataReal(p)})`);
            return `<span class="vhud-metric"><i class="dot ${c.dotCls}" aria-hidden="true"></i><b>${escHtml(c.ativo.ticker)}</b>: <strong class="mono">${txtVal}</strong></span>`;
          }).join('');
          if (hudEl) {
            hudEl.innerHTML = `<span class="vhud-date mono">${ehUltimo ? `Última cotação (${dtReal})` : dtReal}</span>${itens}`;
          }
        }
      };

      atualizarHudPreco(null);

      anexarInteracaoCrosshair(
        svgEl,
        nPontos,
        (idx) => {
          const x = xDe(idx);
          chLine.setAttribute('x1', x.toFixed(1));
          chLine.setAttribute('x2', x.toFixed(1));
          chLine.classList.remove('is-hidden');
          chDots.forEach((dot, cIdx) => {
            const pt = curvasPlot[cIdx]?.xy[idx];
            if (pt) {
              dot.setAttribute('cx', pt.x.toFixed(1));
              dot.setAttribute('cy', pt.y.toFixed(1));
              dot.classList.remove('is-hidden');
            } else {
              dot.classList.add('is-hidden');
            }
          });
          if (chDotLucro) {
            const ptL = xyLucro ? xyLucro[idx] : null;
            if (ptL) {
              chDotLucro.setAttribute('cx', ptL.x.toFixed(1));
              chDotLucro.setAttribute('cy', ptL.y.toFixed(1));
              chDotLucro.classList.remove('is-hidden');
            } else {
              chDotLucro.classList.add('is-hidden');
            }
          }
          atualizarHudPreco(idx);
        },
        () => {
          chLine.classList.add('is-hidden');
          chDots.forEach(d => d.classList.add('is-hidden'));
          if (chDotLucro) chDotLucro.classList.add('is-hidden');
          atualizarHudPreco(null);
        }
      );
    }

    // 4. Diagnóstico Peter Lynch ou Desconto Prolongado ("Barato há muito tempo?")
    if (modo === 'lucro_cotacao') {
      const diagLynch = diagnosticarPeterLynch(principal, seriesPorTicker.get(principal.ticker) || [], serieLucro, visualState.frequenciaLucro);
      if (trapEl) {
        const colMedidorLynch = `
          <div class="vtrap-meter-col">
            <div class="vtrap-meter-head">
              <span>Múltiplo P/L Atual</span>
              <strong class="mono">${ehValido(diagLynch.plAtual) ? `${diagLynch.plAtual.toFixed(1).replace('.', ',')}x` : '—'}</strong>
            </div>
            <div class="vtrap-streak">
              ${ehValido(diagLynch.pRecente?.lpa) ? `LPA (${diagLynch.pRecente.periodo}): <strong class="mono t-strong">R$ ${diagLynch.pRecente.lpa.toFixed(2).replace('.', ',')}</strong>` : ''}
              ${ehValido(diagLynch.varQoQ) ? ` · QoQ: <b class="${diagLynch.varQoQ >= 0 ? 't-green' : 't-red'}">${formataPct(diagLynch.varQoQ)}</b>` : ''}
            </div>
          </div>
        `;

        trapEl.innerHTML = `
          <div class="vtrap-card ${diagLynch.classeBox}">
            <div class="vtrap-main">
              <div class="vtrap-title">${escHtml(diagLynch.titulo)}</div>
              <p class="vtrap-desc">${escHtml(diagLynch.resumo)} <button type="button" class="btn-inline-link" data-vopen-detail="${escHtml(principal.ticker)}">Ver balanço no Raio-X →</button></p>
            </div>
            ${colMedidorLynch}
            <div class="vtrap-range-col">
              <div class="vtrap-range-item"><span>Var. Cotação Recente</span><b class="${ehValido(diagLynch.varPreco) ? (diagLynch.varPreco >= 0 ? 't-green' : 't-red') : ''}">${formataPct(diagLynch.varPreco)}</b></div>
              <div class="vtrap-range-item"><span>Var. Lucro (YoY)</span><b class="${ehValido(diagLynch.varYoY) ? (diagLynch.varYoY >= 0 ? 't-green' : 't-red') : ''}">${formataPct(diagLynch.varYoY)}</b></div>
              <div class="vtrap-range-item"><span>${escHtml(diagLynch.pYoY?.periodo || 'Base')}</span><b>${formatarLucroCurto(diagLynch.pYoY?.lucro_liquido)}</b></div>
              <div class="vtrap-range-item"><span>${escHtml(diagLynch.pRecente?.periodo || 'Atual')}</span><b style="color:var(--series-lucro,#a855f7);">${formatarLucroCurto(diagLynch.pRecente?.lucro_liquido)}</b></div>
            </div>
          </div>
        `;
      }
    } else {
      const diag = diagnosticarDescontoProlongado(principal, seriesPorTicker.get(principal.ticker) || [], serieTetoBazin);
      if (trapEl) {
        const classeBox = diag.tipo === 'alerta'
          ? 'is-warn'
          : (diag.tipo === 'recente' ? 'is-good' : (diag.tipo === 'estrutural' ? 'is-info' : 'is-neutral'));

        const wFillTrap = ehValido(diag.pctAbaixo) ? Math.max(2, Math.round(diag.pctAbaixo * 180)) : 0;
        const corFillTrap = diag.tipo === 'alerta' ? 'var(--yellow)' : 'var(--series-bazin)';

        const colMedidor = ehValido(diag.pctAbaixo)
          ? `
            <div class="vtrap-meter-col">
              <div class="vtrap-meter-head">
                <span>Tempo abaixo do Teto Bazin</span>
                <strong class="mono">${formataPctSimples(diag.pctAbaixo, 0)}</strong>
              </div>
              <svg class="inline-bar-svg" width="180" height="6" viewBox="0 0 180 6" aria-hidden="true">
                <rect x="0" y="0" width="180" height="6" rx="3" fill="var(--surface-2)" />
                <rect x="0" y="0" width="${wFillTrap}" height="6" rx="3" fill="${corFillTrap}" />
              </svg>
              <div class="vtrap-streak">
                ${diag.diasStreak >= 180
                  ? `Sequência ininterrupta: <strong class="t-strong">${fmtDuracaoDias(diag.diasStreak)}</strong>`
                  : (diag.diasStreak > 0
                    ? `${ehValido(diag.diasAcum) ? `Acumulado: <strong class="t-strong">~${fmtDuracaoDias(diag.diasAcum)}</strong> · ` : ''}Atual: <strong class="t-strong">${fmtDuracaoDias(diag.diasStreak)}</strong>`
                    : `Atualmente acima do Teto Bazin`)}
              </div>
            </div>`
          : `
            <div class="vtrap-meter-col">
              <div class="vtrap-meter-head">
                <span>Referência Alternativa</span>
                <strong class="mono">${ehValido(principal.rank_greenblatt) ? `GB #${principal.rank_greenblatt}` : '—'}</strong>
              </div>
              <div class="vtrap-streak">
                ${ehValido(principal.graham)
                  ? `Graham: <strong class="mono t-strong">${formataReal(principal.graham)}</strong> (${formataPct(principal.margem_graham)})`
                  : `Avalie múltiplos no Raio-X`}
              </div>
            </div>`;

        trapEl.innerHTML = `
          <div class="vtrap-card ${classeBox}">
            <div class="vtrap-main">
              <div class="vtrap-title">${escHtml(diag.titulo)}</div>
              <p class="vtrap-desc">${escHtml(diag.resumo)} <button type="button" class="btn-inline-link" data-vopen-detail="${escHtml(principal.ticker)}">Ver pilares no Raio-X →</button></p>
            </div>
            ${colMedidor}
            <div class="vtrap-range-col">
              <div class="vtrap-range-item"><span>Mínimo (${visualState.periodo.toUpperCase()})</span><b>${formataReal(diag.minPreco)}</b></div>
              <div class="vtrap-range-item"><span>Máximo (${visualState.periodo.toUpperCase()})</span><b>${formataReal(diag.maxPreco)}</b></div>
              <div class="vtrap-range-item"><span>Preço Médio</span><b>${formataReal(diag.medPreco)}</b></div>
              <div class="vtrap-range-item"><span>Var. Cotação</span><b class="${ehValido(diag.varPeriodo) ? (diag.varPeriodo >= 0 ? 't-green' : 't-red') : ''}">${formataPct(diag.varPeriodo)}</b></div>
            </div>
          </div>
        `;
      }
    }

    // 5. Tabela comparativa de preços-teto (quando 2+ ativos comparados)
    if (cmpTableWrap) {
      if (ativosCmp.length === 0) {
        cmpTableWrap.innerHTML = '';
      } else {
        const linhasHtml = todosAtivos.map((a, idx) => {
          const dotCls = idx === 0 ? 'dot-price' : `dot-cmp-${(idx - 1) % PALETA_COMPARACAO.length}`;
          const serieTetoAtivo = calcularSerieTetoBazinHistorico(a, janela.datas);
          const dAtivo = diagnosticarDescontoProlongado(a, seriesPorTicker.get(a.ticker) || [], serieTetoAtivo);
          const cAtivo = obterCategoriaAtivo(a);
          const rotCat = cAtivo === 'besst' ? 'BESST' : (cAtivo === 'demais' ? 'Demais' : 'Divid.');
          const rotuloAlerta = dAtivo.diasStreak >= 180
            ? `Barato há ${fmtDuracaoDias(dAtivo.diasStreak)}`
            : `Barato (${formataPctSimples(dAtivo.pctAbaixo, 0)} s/ reação)`;
          const badgeDiag = dAtivo.tipo === 'alerta'
            ? `<span class="verdict verdict-amarelo">${rotuloAlerta}</span>`
            : (dAtivo.tipo === 'recente'
              ? `<span class="verdict verdict-verde">Desconto recente</span>`
              : (dAtivo.tipo === 'estrutural'
                ? `<span class="verdict verdict-verde">Recorrente (${formataPctSimples(dAtivo.pctAbaixo, 0)})</span>`
                : (dAtivo.tipo === 'acima'
                  ? `<span class="verdict verdict-vermelho">Acima do teto</span>`
                  : `<span class="t-dim">Sem teto Bazin</span>`)));

          const tCons = a.teto_consenso ?? a.bazin?.teto_projetado_consenso;
          const mCons = a.margem_consenso ?? a.bazin?.margem_projetada_consenso;
          const tBars = a.teto_barsi ?? a.bazin?.teto_projetado_barsi;
          const mBars = a.margem_barsi ?? a.bazin?.margem_projetada_barsi;

          return `
            <tr class="vcmp-row" data-vfocus-ticker="${escHtml(a.ticker)}" title="Clique para colocar ${escHtml(a.ticker)} em foco">
              <td data-label="Ativo">
                <span class="vcmp-ticker"><i class="dot ${dotCls}" aria-hidden="true"></i><b class="mono">${escHtml(a.ticker)}</b> <small class="t-muted">${escHtml(rotCat)}</small></span>
              </td>
              <td class="num mono" data-label="Preço Atual">${formataReal(a.preco)}</td>
              <td class="num mono" data-label="Teto Bazin">${a.bazin?.teto > 0 ? `${formataReal(a.bazin.teto)} <small class="${corClasseMargem(a.bazin.margem_seguranca)}">(${formataPct(a.bazin.margem_seguranca)})</small>` : '—'}</td>
              <td class="num mono" data-label="Teto Consenso">${ehValido(tCons) ? `${formataReal(tCons)} <small class="${corClasseMargem(mCons)}">(${formataPct(mCons)})</small>` : '—'}</td>
              <td class="num mono" data-label="Teto Barsi">${ehValido(tBars) ? `${formataReal(tBars)} <small class="${corClasseMargem(mBars)}">(${formataPct(mBars)})</small>` : '—'}</td>
              <td class="num mono" data-label="Teto Graham">${ehValido(a.graham) ? `${formataReal(a.graham)} <small class="${corClasseMargem(a.margem_graham)}">(${formataPct(a.margem_graham)})</small>` : '—'}</td>
              <td class="num mono" data-label="Teto Gordon">${ehValido(a.gordon) ? `${formataReal(a.gordon)} <small class="${corClasseMargem(a.margem_gordon)}">(${formataPct(a.margem_gordon)})</small>` : '—'}</td>
              <td class="num mono" data-label="Tempo < Bazin">${ehValido(dAtivo.pctAbaixo) ? formataPctSimples(dAtivo.pctAbaixo, 0) : '—'}</td>
              <td data-label="Leitura Histórica">${badgeDiag}</td>
            </tr>
          `;
        }).join('');

        cmpTableWrap.innerHTML = `
          <div class="vsub-table-head">Comparativo de Preços-Teto e Tempo Descontado (${ROTULO_PERIODO[visualState.periodo]}) · clique para focar</div>
          <div class="table-wrap">
            <table class="vt vcmp-table">
              <thead>
                <tr>
                  <th>Ativo</th>
                  <th class="num">Preço</th>
                  <th class="num">Teto Bazin (K=6%)</th>
                  <th class="num">Teto Consenso</th>
                  <th class="num">Teto Barsi</th>
                  <th class="num">Teto Graham</th>
                  <th class="num">Teto Gordon</th>
                  <th class="num">Tempo &lt; Bazin</th>
                  <th>Leitura Histórica</th>
                </tr>
              </thead>
              <tbody>${linhasHtml}</tbody>
            </table>
          </div>
        `;
      }
    }
  }

  /* ---------- Renderização 4: Simulador de Rendimento c/ Dividendos ---------- */

  function renderizarSecaoSimulador(principal, ativosCmp) {
    const kpiGrid = qSel('#sim-kpi-grid');
    const subEl = qSel('#sim-subtitle');
    const hudEl = qSel('#sim-chart-hud');
    const svgWrap = qSel('#sim-svg-wrap');
    const breakdownWrap = qSel('#sim-breakdown-wrap');
    if (!svgWrap || !kpiGrid) return;

    const janelaSim = obterJanelaSimulador(principal);

    const capInput = qSel('#sim-capital-input');
    if (capInput && document.activeElement !== capInput) {
      capInput.value = String(visualState.simCapital);
    }
    document.querySelectorAll('#sim-capital-presets .chip-mini').forEach(b => {
      b.classList.toggle('is-on', Number(b.dataset.capital) === visualState.simCapital);
    });
    document.querySelectorAll('#sim-reinvest-group .seg-btn').forEach(b => {
      b.classList.toggle('is-active', (b.dataset.reinvest === '1') === visualState.simReinvestir);
    });
    const btnTax = qSel('#sim-net-jcp-btn');
    if (btnTax) {
      btnTax.classList.toggle('is-on', visualState.simLiquidoJcp);
    }

    const preset = visualState.simPeriodoPreset || '5y';
    document.querySelectorAll('#sim-period-presets .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.simPeriod === preset);
    });
    const customDatesEl = qSel('#sim-custom-dates');
    if (customDatesEl) {
      customDatesEl.classList.toggle('is-hidden', preset !== 'custom');
    }
    const inputStart = qSel('#sim-date-start');
    const inputEnd = qSel('#sim-date-end');
    if (inputStart && inputEnd) {
      if (document.activeElement !== inputStart && document.activeElement !== inputEnd) {
        inputStart.value = janelaSim.dtIni;
        inputEnd.value = janelaSim.dtFim;
      }
    }

    document.querySelectorAll('#sim-benchmarks-group [data-sim-bench]').forEach(b => {
      const code = b.dataset.simBench;
      const ativo = Boolean(visualState.simBenchmarks?.[code]);
      b.classList.toggle('is-on', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    });

    const todosAtivos = [principal, ...ativosCmp];
    const simulacoes = todosAtivos
      .map((a, idx) => ({
        cor: idx === 0 ? '#06b6d4' : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length],
        corLinhaMulti: idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length],
        dotCls: idx === 0 ? 'dot-price' : `dot-cmp-${(idx - 1) % PALETA_COMPARACAO.length}`,
        principal: idx === 0,
        sim: simularRetornoAtivo(a, janelaSim, visualState.simCapital, visualState.simReinvestir, visualState.simLiquidoJcp)
      }))
      .filter(x => x.sim !== null);

    if (!simulacoes.length) {
      kpiGrid.innerHTML = '';
      svgWrap.innerHTML = `<div class="vchart-empty">Dados históricos insuficientes para simular o período selecionado.</div>`;
      if (breakdownWrap) breakdownWrap.innerHTML = '';
      return;
    }

    const simMain = simulacoes[0].sim;
    const datasSimMain = simMain.curva.map(p => p.data);
    const benchmarksTodos = ORDEM_BENCHMARKS
      .map(cod => simularBenchmark(cod, janelaSim, visualState.simCapital, datasSimMain))
      .filter(Boolean);
    const benchmarksAtivos = benchmarksTodos.filter(b => visualState.simBenchmarks?.[b.codigo]);

    if (subEl) {
      subEl.textContent = `Aporte inicial de ${formataReal(visualState.simCapital)} em ${principal.ticker} (${fmtDataBr(simMain.dataIni)} a ${fmtDataBr(simMain.dataFim)}) · ${visualState.simReinvestir ? 'reinvestindo proventos na data-com' : 'acumulando proventos em caixa'}`;
    }

    const sinalLucro = simMain.lucroTotal >= 0 ? '+' : '';
    kpiGrid.innerHTML = `
      <div class="kpi">
        <div class="kpi-label"><span>Patrimônio final (${escHtml(principal.ticker)})</span></div>
        <div class="kpi-value">${formataReal(simMain.patrimonioFinal)}</div>
        <div class="kpi-foot ${simMain.lucroTotal >= 0 ? 't-green' : 't-red'}">${sinalLucro}${formataReal(simMain.lucroTotal)} sobre ${formataReal(simMain.capitalInicial)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label"><span>Retorno total (c/ dividendos)</span></div>
        <div class="kpi-value ${simMain.retornoTotal >= 0 ? 't-green' : 't-red'}">${formataPct(simMain.retornoTotal)}</div>
        <div class="kpi-foot">${ehValido(simMain.cagr) ? `CAGR: ${formataPct(simMain.cagr)} ao ano` : `${fmtDataBr(simMain.dataIni)} a ${fmtDataBr(simMain.dataFim)}`}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label"><span>Apenas cotação (s/ proventos)</span></div>
        <div class="kpi-value ${simMain.retornoCotacao >= 0 ? '' : 't-red'}">${formataPct(simMain.retornoCotacao)}</div>
        <div class="kpi-foot">Patrimônio s/ dividendos: ${formataReal(simMain.patrimonioCotacaoFinal)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label"><span>Parcela gerada por proventos</span></div>
        <div class="kpi-value t-green">+${formataReal(Math.max(0, simMain.efeitoProventosRS))}</div>
        <div class="kpi-foot">YoC acum.: ${formataPctSimples(simMain.yocAcumulado)} · ${simMain.qtdEventos}x (${simMain.acoesIniciais.toFixed(0)} → ${simMain.acoesFinais.toFixed(0)} ações)</div>
      </div>
    `;

    const W = medirLarguraGrafico(svgWrap);
    const ehMobile = W < 580;
    const H = ehMobile ? 270 : 340;
    const padLeft = ehMobile ? 64 : 78;
    const padRight = ehMobile ? 16 : 26;
    const padTop = 18;
    const padBottom = 32;
    const plotW = Math.max(120, W - padLeft - padRight);
    const plotH = H - padTop - padBottom;
    const yBasePlot = padTop + plotH;

    const nPontos = simMain.curva.length;
    const modoMulti = simulacoes.length > 1;

    const valoresY = [visualState.simCapital];
    if (!modoMulti) {
      simMain.curva.forEach(p => { valoresY.push(p.patTotal, p.patCotacao); });
    } else {
      simulacoes.forEach(s => s.sim.curva.forEach(p => valoresY.push(p.patTotal)));
      simMain.curva.forEach(p => valoresY.push(p.patCotacao));
    }
    benchmarksAtivos.forEach(b => b.curva.forEach(p => valoresY.push(p.patTotal)));

    let yMin = Math.min(...valoresY);
    let yMax = Math.max(...valoresY);
    const folga = (yMax - yMin) * 0.08 || (visualState.simCapital * 0.05);
    yMin = Math.max(0, yMin - folga);
    yMax += folga;

    const eixoY = calcularTicksEixoY(yMin, yMax, ehMobile ? 5 : 6);
    const xDe = (i, total = nPontos) => padLeft + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);
    const yDe = (v) => padTop + plotH - ((v - eixoY.min) / (eixoY.max - eixoY.min || 1)) * plotH;

    const fmtMoedaEixo = (v) => {
      if (v >= 1000000) return 'R$ ' + (v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
      if (v >= 10000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
      return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    };

    const gradeSvg = eixoY.ticks.map(tv => {
      const y = yDe(tv);
      return `
        <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" stroke="var(--svg-grid)" stroke-width="1" />
        <text x="${padLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="vsvg-axis-text">${escHtml(fmtMoedaEixo(tv))}</text>
      `;
    }).join('');

    const qtdTicksX = ehMobile ? 4 : 8;
    const ticksX = [];
    for (let t = 0; t < qtdTicksX; t++) {
      const idx = Math.round((t / (qtdTicksX - 1)) * (nPontos - 1));
      if (!ticksX.includes(idx)) ticksX.push(idx);
    }
    const ticksXSvg = ticksX.map(idx => {
      const x = xDe(idx);
      return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vsvg-axis-text">${escHtml(fmtDataCurta(simMain.curva[idx].data, visualState.periodo !== '6m'))}</text>`;
    }).join('');

    const yAporte = yDe(visualState.simCapital);
    const linhaAporteSvg = `<line x1="${padLeft}" y1="${yAporte.toFixed(1)}" x2="${padLeft + plotW}" y2="${yAporte.toFixed(1)}" stroke="var(--border-strong)" stroke-width="1.2" stroke-dasharray="3 4" />`;

    const xyCotacaoMain = simMain.curva.map((p, i) => ({ x: xDe(i), y: yDe(p.patCotacao) }));
    const linhaCotacaoPuraSvg = `<path d="${caminhoSvgLinha(xyCotacaoMain)}" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-dasharray="5 4" />`;

    let curvasSimSvg = '';
    let marcadoresProvSvg = '';
    const seriesInterativas = [];

    if (!modoMulti) {
      const xyTotal = simMain.curva.map((p, i) => ({ x: xDe(i), y: yDe(p.patTotal) }));
      curvasSimSvg = `
        <path d="${caminhoSvgArea(xyTotal, yBasePlot)}" fill="url(#grad-sim-total)" />
        <path d="${caminhoSvgArea(xyCotacaoMain, yBasePlot)}" fill="url(#grad-sim-quote)" />
        ${linhaCotacaoPuraSvg}
        <path d="${caminhoSvgLinha(xyTotal)}" fill="none" stroke="var(--series-bazin)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      `;
      marcadoresProvSvg = simMain.curva
        .map((p, i) => p.provSemanaRS > 0
          ? `<circle cx="${xDe(i).toFixed(1)}" cy="${yDe(p.patTotal).toFixed(1)}" r="3.2" fill="var(--series-bazin)" stroke="var(--bg)" stroke-width="1.2" />`
          : '')
        .join('');
      seriesInterativas.push({ cor: '#06b6d4', xy: xyTotal }, { cor: '#94a3b8', xy: xyCotacaoMain });
    } else {
      curvasSimSvg = linhaCotacaoPuraSvg + simulacoes.map(s => {
        const len = s.sim.curva.length;
        const xy = s.sim.curva.map((p, i) => ({ x: xDe(i, len), y: yDe(p.patTotal) }));
        seriesInterativas.push({ cor: s.corLinhaMulti, xy, ticker: s.sim.ativo.ticker });
        return `<path d="${caminhoSvgLinha(xy)}" fill="none" stroke="${s.corLinhaMulti}" stroke-width="${s.principal ? 2.6 : 2.0}" stroke-linejoin="round" stroke-linecap="round" />`;
      }).join('');
    }

    const curvasBenchSvg = benchmarksAtivos.map(b => {
      const len = b.curva.length;
      const xy = b.curva.map((p, i) => ({ x: xDe(i, len), y: yDe(p.patTotal) }));
      seriesInterativas.push({ cor: b.cor, xy, ticker: b.codigo });
      return `<path d="${caminhoSvgLinha(xy)}" fill="none" stroke="${b.cor}" stroke-width="1.9" stroke-dasharray="${b.dash}" stroke-linejoin="round" stroke-linecap="round" opacity="0.92" />`;
    }).join('');

    const chDotsSvg = seriesInterativas.map((s, idx) =>
      `<circle class="v-sim-dot is-hidden" data-sim-idx="${idx}" cx="0" cy="0" r="4.0" fill="${s.cor}" stroke="var(--bg)" stroke-width="1.5" />`
    ).join('');

    svgWrap.innerHTML = `
      <svg class="vsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Evolução do patrimônio simulado com dividendos e benchmarks">
        <defs>
          <linearGradient id="grad-sim-total" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.26" />
            <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id="grad-sim-quote" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.14" />
            <stop offset="100%" stop-color="#60a5fa" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${gradeSvg}
        ${linhaAporteSvg}
        ${curvasBenchSvg}
        ${curvasSimSvg}
        ${marcadoresProvSvg}
        ${ticksXSvg}
        <line class="v-crosshair is-hidden" x1="0" y1="${padTop}" x2="0" y2="${yBasePlot}" stroke="var(--text-strong)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 3" />
        ${chDotsSvg}
        <rect class="v-hit-area" x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent" />
      </svg>
    `;

    const svgEl = svgWrap.querySelector('svg');
    const chLine = svgEl.querySelector('.v-crosshair');
    const chDots = svgEl.querySelectorAll('.v-sim-dot');

    const atualizarHudSim = (idx) => {
      const ehUltimo = idx === null || idx === undefined;
      const i = ehUltimo ? nPontos - 1 : idx;
      const pt = simMain.curva[i];
      const dt = fmtDataBr(pt.data);

      const benchHudHtml = benchmarksAtivos.map(b => {
        const idxB = Math.min(b.curva.length - 1, Math.round((i / Math.max(1, nPontos - 1)) * (b.curva.length - 1)));
        const pB = b.curva[idxB];
        const retB = (pB.patTotal - visualState.simCapital) / visualState.simCapital;
        return `<span class="vhud-metric"><i class="dot ${b.dotCls}" aria-hidden="true"></i><b>${escHtml(b.curto)}</b>: <strong class="mono">${formataReal(pB.patTotal)} (${formataPct(retB)})</strong></span>`;
      }).join('');

      if (!modoMulti) {
        const retData = (pt.patTotal - visualState.simCapital) / visualState.simCapital;
        if (hudEl) {
          hudEl.innerHTML = `
            <span class="vhud-date mono">${ehUltimo ? `Final (${dt})` : dt}</span>
            <span class="vhud-metric"><span class="vleg-swatch is-sim-total" aria-hidden="true"></span><b>${escHtml(principal.ticker)}</b> c/ div.: <strong class="mono t-green">${formataReal(pt.patTotal)} (${formataPct(retData)})</strong></span>
            <span class="vhud-metric"><span class="vleg-swatch is-sim-quote" aria-hidden="true"></span>Só cotação: <strong class="mono">${formataReal(pt.patCotacao)}</strong></span>
            ${benchHudHtml}
          `;
        }
      } else {
        const itens = simulacoes.map(s => {
          const idxProp = Math.min(s.sim.curva.length - 1, Math.round((i / Math.max(1, nPontos - 1)) * (s.sim.curva.length - 1)));
          const pSim = s.sim.curva[idxProp];
          const ret = (pSim.patTotal - visualState.simCapital) / visualState.simCapital;
          return `<span class="vhud-metric"><i class="dot ${s.dotCls}" aria-hidden="true"></i><b>${escHtml(s.sim.ativo.ticker)}</b>: <strong class="mono">${formataReal(pSim.patTotal)} (${formataPct(ret)})</strong></span>`;
        }).join('');
        if (hudEl) {
          hudEl.innerHTML = `<span class="vhud-date mono">${ehUltimo ? `Final (${dt})` : dt}</span>${itens}${benchHudHtml}`;
        }
      }
    };

    atualizarHudSim(null);

    anexarInteracaoCrosshair(
      svgEl,
      nPontos,
      (idx) => {
        const x = xDe(idx);
        chLine.setAttribute('x1', x.toFixed(1));
        chLine.setAttribute('x2', x.toFixed(1));
        chLine.classList.remove('is-hidden');
        chDots.forEach((dot, sIdx) => {
          const serie = seriesInterativas[sIdx];
          const idxAlvo = Math.min(serie.xy.length - 1, Math.round((idx / Math.max(1, nPontos - 1)) * (serie.xy.length - 1)));
          const pt = serie.xy[idxAlvo];
          if (pt) {
            dot.setAttribute('cx', pt.x.toFixed(1));
            dot.setAttribute('cy', pt.y.toFixed(1));
            dot.classList.remove('is-hidden');
          }
        });
        atualizarHudSim(idx);
      },
      () => {
        chLine.classList.add('is-hidden');
        chDots.forEach(d => d.classList.add('is-hidden'));
        atualizarHudSim(null);
      }
    );

    if (breakdownWrap) {
      const itensTabela = [
        ...simulacoes.map(item => ({ tipo: 'acao', dotCls: modoMulti ? item.dotCls : 'dot-bazin', sim: item.sim })),
        ...benchmarksTodos.map(b => ({ tipo: 'bench', dotCls: b.dotCls, sim: b, visivelNoGrafico: Boolean(visualState.simBenchmarks?.[b.codigo]) }))
      ].sort((a, b) => b.sim.patrimonioFinal - a.sim.patrimonioFinal);

      const linhas = itensTabela.map(item => {
        const s = item.sim;
        const diffPatrimonio = simMain.patrimonioFinal - s.patrimonioFinal;
        const diffPontosPct = (simMain.retornoTotal - s.retornoTotal) * 100;
        const sinalDiff = diffPontosPct > 0 ? '+' : '';

        if (item.tipo === 'acao') {
          const ehPrincipal = s.ativo.ticker.toUpperCase() === principal.ticker.toUpperCase();
          const colVsMain = ehPrincipal
            ? `<span class="t-dim">Referência</span>`
            : `<span class="${diffPontosPct >= 0 ? 't-green' : 't-red'}">${escHtml(principal.ticker)} ${sinalDiff}${diffPontosPct.toFixed(1).replace('.', ',')} p.p.</span>`;

          return `
            <tr class="vcmp-row" data-vfocus-ticker="${escHtml(s.ativo.ticker)}" title="Clique para focar em ${escHtml(s.ativo.ticker)}">
              <td data-label="Ativo / Benchmark">
                <span class="vcmp-ticker">
                  <i class="dot ${item.dotCls}" aria-hidden="true"></i>
                  <b class="mono">${escHtml(s.ativo.ticker)}</b>
                  <small class="vbench-tag is-stock">Ação</small>
                </span>
              </td>
              <td class="num mono" data-label="Preço Ini → Fim">${formataReal(s.precoIni)} → ${formataReal(s.precoFim)}</td>
              <td class="num mono ${s.retornoCotacao >= 0 ? '' : 't-red'}" data-label="Só Cotação">${formataPct(s.retornoCotacao)}</td>
              <td class="num mono t-green" data-label="Proventos Caixa">${formataReal(s.proventosRecebidosRS)} <small class="t-muted">(${s.qtdEventos}x)</small></td>
              <td class="num mono" data-label="Qtd. / Vs. Principal">${s.acoesIniciais.toFixed(1)} → ${s.acoesFinais.toFixed(1)} <small class="t-muted">(${colVsMain})</small></td>
              <td class="num mono" data-label="Patrimônio Final"><strong>${formataReal(s.patrimonioFinal)}</strong></td>
              <td class="num mono ${s.retornoTotal >= 0 ? 't-green' : 't-red'}" data-label="Retorno Total">
                <strong>${formataPct(s.retornoTotal)}</strong>
                ${ehValido(s.cagr) ? `<small class="t-muted"> (${formataPct(s.cagr)} a.a.)</small>` : ''}
              </td>
            </tr>
          `;
        }

        const fmtRef = (s.codigo === 'CDI' || s.codigo === 'IPCA')
          ? `Índice ${s.precoIni.toFixed(0)} → ${s.precoFim.toFixed(0)}`
          : `${formataReal(s.precoIni)} → ${formataReal(s.precoFim)}`;

        const txtAlpha = diffPontosPct >= 0
          ? `<span class="t-green">+${diffPontosPct.toFixed(1).replace('.', ',')} p.p. (+${formataReal(diffPatrimonio)})</span>`
          : `<span class="t-red">${diffPontosPct.toFixed(1).replace('.', ',')} p.p. (${formataReal(diffPatrimonio)})</span>`;

        return `
          <tr class="vcmp-row vcmp-row-bench ${item.visivelNoGrafico ? '' : 'is-bench-muted'}" data-vtoggle-bench-row="${escHtml(s.codigo)}" title="Clique para exibir/ocultar ${escHtml(s.curto)} (${escHtml(s.nome)}) na curva do gráfico">
            <td data-label="Ativo / Benchmark">
              <span class="vcmp-ticker">
                <i class="dot ${item.dotCls}" aria-hidden="true"></i>
                <b class="mono">${escHtml(s.curto)}</b>
                <small class="vbench-tag">${escHtml(s.nome)}</small>
              </span>
            </td>
            <td class="num mono t-muted" data-label="Preço Ini → Fim">${fmtRef}</td>
            <td class="num mono ${s.retornoTotal >= 0 ? '' : 't-red'}" data-label="Só Cotação">${formataPct(s.retornoTotal)}</td>
            <td class="num mono t-dim" data-label="Proventos Caixa">Total Return</td>
            <td class="num mono" data-label="Alpha (${escHtml(principal.ticker)} vs. Bench)">${txtAlpha}</td>
            <td class="num mono" data-label="Patrimônio Final"><strong>${formataReal(s.patrimonioFinal)}</strong></td>
            <td class="num mono ${s.retornoTotal >= 0 ? 't-green' : 't-red'}" data-label="Retorno Total">
              <strong>${formataPct(s.retornoTotal)}</strong>
              ${ehValido(s.cagr) ? `<small class="t-muted"> (${formataPct(s.cagr)} a.a.)</small>` : ''}
            </td>
          </tr>
        `;
      }).join('');

      breakdownWrap.innerHTML = `
        <div class="vsub-table-head">
          <span>Comparativo de Rendimento Total vs. Benchmarks · Aporte de ${formataReal(visualState.simCapital)} (${fmtDataBr(simMain.dataIni)} a ${fmtDataBr(simMain.dataFim)})</span>
          <small class="t-muted">Ordenado pelo maior patrimônio final</small>
        </div>
        <div class="table-wrap">
          <table class="vt vcmp-table">
            <thead>
              <tr>
                <th>Ativo / Benchmark</th>
                <th class="num">Cotação / Índice</th>
                <th class="num">Só Cotação</th>
                <th class="num">Proventos</th>
                <th class="num">Qtd. / Alpha (${escHtml(principal.ticker)})</th>
                <th class="num">Patrimônio Final</th>
                <th class="num">Retorno Total</th>
              </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
      `;
    }
  }

  /* ---------- Orquestração Principal da Aba Visual ---------- */

  function renderizarVisaoGrafica() {
    if (visualState.aba !== 'visual') return;
    if (!obterPayload() || !obterUniverso().length) return;

    const principal = garantirAtivosValidos();
    if (!principal) return;

    const mapa = construirMapaUniverso();
    const ativosCmp = visualState.comparados.map(t => mapa.get(t)).filter(Boolean);
    const janela = obterDatasJanela();

    try { renderizarExploradorEControles(principal); } catch (e) { console.error('[VisaoGrafica] Explorador:', e); }
    try { renderizarHeroAtivo(principal, janela); } catch (e) { console.error('[VisaoGrafica] Hero:', e); }
    try { renderizarSecaoPrecosTetos(principal, ativosCmp, janela); } catch (e) { console.error('[VisaoGrafica] PrecosTetos:', e); }
    try { renderizarSecaoSimulador(principal, ativosCmp, janela); } catch (e) { console.error('[VisaoGrafica] Simulador:', e); }
  }

  function definirAbaPainel(aba, tickerFoco) {
    visualState.aba = ['tabela', 'visual', 'matriz', 'calendario', 'carteira'].includes(aba) ? aba : 'tabela';
    const mapa = construirMapaUniverso();

    if (tickerFoco) {
      const limpo = String(tickerFoco).trim().toUpperCase();
      if (mapa.has(limpo)) {
        visualState.tickerPrincipal = limpo;
        visualState.comparados = visualState.comparados.filter(t => t !== limpo);
      }
    }

    salvarPrefsVisual();

    const abaAtiva = visualState.aba;
    const ehVisual = abaAtiva === 'visual';
    ['tabela', 'visual', 'matriz', 'calendario', 'carteira'].forEach(id => {
      const btn = qSel(`#tab-btn-${id}`);
      const on = abaAtiva === id;
      btn?.classList.toggle('is-active', on);
      btn?.setAttribute('aria-selected', String(on));
      qSel(`#view-${id}`)?.classList.toggle('is-hidden', !on);
    });

    const hintEl = qSel('#view-nav-hint');
    if (hintEl) {
      const mapaHints = {
        tabela: 'KPIs, cobertura BESST, Score Anti-Cilada e tabela comparativa de valuation',
        visual: 'Histórico 5 anos vs. Preços-Teto tracejados (Bazin 6%, Graham, Gordon) e Simulador com Dividendos',
        matriz: 'Quadrantes cruzando Margem de Segurança (Bazin/Graham) vs. Rentabilidade (ROE/ROIC) e filtro Anti-Cilada',
        calendario: 'Próximas datas-com abertas, pagamentos agendados, últimos pagos e sazonalidade de 12 meses',
        carteira: 'Posições, renda projetada de 12 meses, concentração por setor e sugestão de aporte do mês'
      };
      hintEl.textContent = mapaHints[abaAtiva] || mapaHints.tabela;
    }

    if (ehVisual) {
      renderizarVisaoGrafica();
      requestAnimationFrame(() => {
        const wrap = qSel('#visual-price-svg-wrap');
        const svg = wrap?.querySelector('svg');
        if (wrap && svg) {
          const wAtual = medirLarguraGrafico(wrap);
          const wSvg = Number(svg.getAttribute('width')) || 0;
          if (Math.abs(wAtual - wSvg) > 16) renderizarVisaoGrafica();
        }
        const elFoco = qSel('#visual-stock-list .vstock-row.is-focused');
        if (elFoco) {
          const box = qSel('#visual-stock-list');
          if (box) box.scrollTop = Math.max(0, elFoco.offsetTop - box.offsetTop - box.clientHeight / 3);
        }
      });
      if (tickerFoco) window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (abaAtiva === 'matriz' && typeof window.renderizarMatrizValuation === 'function') {
      window.renderizarMatrizValuation();
      requestAnimationFrame(() => window.renderizarMatrizValuation());
    } else if (abaAtiva === 'calendario' && typeof window.renderizarCalendarioDividendos === 'function') {
      window.renderizarCalendarioDividendos();
    } else if (abaAtiva === 'carteira' && typeof window.renderizarCarteira === 'function') {
      window.renderizarCarteira(true);
    }

    if (typeof window.sincronizarEstadoUrl === 'function') {
      window.sincronizarEstadoUrl();
    }
  }

  function focarAtivo(ticker) {
    const clean = String(ticker || '').trim().toUpperCase();
    if (!clean || !construirMapaUniverso().has(clean)) return;
    visualState.tickerPrincipal = clean;
    visualState.comparados = visualState.comparados.filter(t => t !== clean);
    salvarPrefsVisual();
    renderizarVisaoGrafica();
    if (typeof window.sincronizarEstadoUrl === 'function') {
      window.sincronizarEstadoUrl();
    }
  }

  function alternarComparacao(ticker) {
    const clean = String(ticker || '').trim().toUpperCase();
    if (!clean || !construirMapaUniverso().has(clean)) return;
    if (clean === visualState.tickerPrincipal) return;

    const idx = visualState.comparados.indexOf(clean);
    if (idx >= 0) {
      visualState.comparados.splice(idx, 1);
    } else {
      if (visualState.comparados.length >= 4) return;
      visualState.comparados.push(clean);
    }
    salvarPrefsVisual();
    renderizarVisaoGrafica();
    if (typeof window.sincronizarEstadoUrl === 'function') {
      window.sincronizarEstadoUrl();
    }
  }

  /* ---------- Sincronização com URL Hash ---------- */

  function obterEstadoVisaoGrafica() {
    return {
      aba: visualState.aba,
      ativo: visualState.tickerPrincipal,
      periodo: visualState.periodo,
      modo: visualState.modoPreco,
      comparar: [...visualState.comparados]
    };
  }

  function aplicarEstadoVisaoGrafica(obj) {
    if (!obj) return;
    const mapa = construirMapaUniverso();
    if (obj.ativo && mapa.has(String(obj.ativo).toUpperCase())) {
      visualState.tickerPrincipal = String(obj.ativo).toUpperCase();
    }
    const perRaw = obj.periodo || obj.per;
    if (perRaw && DIAS_PERIODO[perRaw]) {
      visualState.periodo = perRaw;
      if (['1y', '2y', '3y', '5y', '10y'].includes(perRaw)) {
        visualState.simPeriodoPreset = perRaw;
      }
    }
    if (obj.modo && ['preco', 'lucro_cotacao', 'margem_bazin', 'variacao'].includes(obj.modo)) {
      visualState.modoPreco = obj.modo;
    } else if (obj.m && ['preco', 'lucro_cotacao', 'margem_bazin', 'variacao'].includes(obj.m)) {
      visualState.modoPreco = obj.m;
    }
    const cmpRaw = obj.comparar || obj.c;
    if (cmpRaw) {
      visualState.comparados = String(cmpRaw)
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(t => t && t !== visualState.tickerPrincipal && mapa.has(t))
        .slice(0, 4);
    }
    salvarPrefsVisual();
  }

  window.obterEstadoVisaoGrafica = obterEstadoVisaoGrafica;
  window.aplicarEstadoVisaoGrafica = aplicarEstadoVisaoGrafica;

  /* ---------- Eventos ---------- */

  function bindEventosVisaoGrafica() {
    qSel('#main-view-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view-tab]');
      if (btn) definirAbaPainel(btn.dataset.viewTab);
    });

    qSel('#btn-toggle-visual-sidebar')?.addEventListener('click', () => {
      visualState.sidebarRecolhida = !visualState.sidebarRecolhida;
      salvarPrefsVisual();
      renderizarVisaoGrafica();
      requestAnimationFrame(() => renderizarVisaoGrafica());
    });

    qSel('#btn-export-visual-png')?.addEventListener('click', () => {
      const svgEl = qSel('#visual-price-svg-wrap svg');
      const tk = (visualState.tickerPrincipal || 'ativo').toLowerCase();
      if (svgEl && typeof window.exportarSvgComoPng === 'function') {
        window.exportarSvgComoPng(svgEl, `grafico-${tk}-${visualState.periodo}.png`);
      }
    });

    // Mobile selects
    qSel('#visual-main-select')?.addEventListener('change', (e) => {
      focarAtivo(e.target.value);
    });

    qSel('#visual-compare-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      e.target.value = '';
      if (val) alternarComparacao(val);
    });

    // Busca com debounce de 150ms e Enter na Sidebar Desktop
    const searchInput = qSel('#visual-search-input');
    let timerBuscaSidebar = null;
    searchInput?.addEventListener('input', (e) => {
      const valor = e.target.value || '';
      clearTimeout(timerBuscaSidebar);
      timerBuscaSidebar = setTimeout(() => {
        visualState.buscaLista = valor;
        const principal = garantirAtivosValidos();
        if (principal) renderizarExploradorEControles(principal);
      }, 150);
    });
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(timerBuscaSidebar);
      visualState.buscaLista = searchInput.value || '';
      const resultados = filtrarEOrdenarListaSidebar();
      if (resultados.length) {
        focarAtivo(resultados[0].ticker);
      }
    });

    // Ordenação e filtro por categoria na Sidebar Desktop
    qSel('#visual-list-sort')?.addEventListener('click', () => {
      visualState.ordemLista = visualState.ordemLista === 'az' ? 'margem' : 'az';
      salvarPrefsVisual();
      const principal = garantirAtivosValidos();
      if (principal) renderizarExploradorEControles(principal);
    });

    qSel('#visual-cat-filter')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-vcat]');
      if (!btn) return;
      visualState.filtroLista = btn.dataset.vcat;
      salvarPrefsVisual();
      const principal = garantirAtivosValidos();
      if (principal) renderizarExploradorEControles(principal);
    });

    // Clique na lista da Sidebar Desktop
    qSel('#visual-stock-list')?.addEventListener('click', (e) => {
      const resetBtn = e.target.closest('[data-vreset-cat]');
      if (resetBtn) {
        visualState.filtroLista = 'todos';
        salvarPrefsVisual();
        const principal = garantirAtivosValidos();
        if (principal) renderizarExploradorEControles(principal);
        return;
      }
      const cmpBtn = e.target.closest('[data-vtoggle-cmp]');
      if (cmpBtn) {
        e.stopPropagation();
        if (!cmpBtn.disabled) alternarComparacao(cmpBtn.dataset.vtoggleCmp);
        return;
      }
      const row = e.target.closest('[data-vselect-ticker]');
      if (row) {
        focarAtivo(row.dataset.vselectTicker);
      }
    });

    // Remover chips de comparação (desktop e mobile)
    const tratarCliqueChipsCmp = (e) => {
      const rem = e.target.closest('[data-vremove-cmp]');
      if (rem) {
        const alvo = rem.dataset.vremoveCmp.toUpperCase();
        visualState.comparados = visualState.comparados.filter(t => t !== alvo);
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
        return;
      }
      if (e.target.closest('[data-vclear-cmp]')) {
        visualState.comparados = [];
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
      }
    };
    qSel('#visual-compare-chips')?.addEventListener('click', tratarCliqueChipsCmp);
    qSel('#visual-mobile-cmp-chips')?.addEventListener('click', tratarCliqueChipsCmp);

    // Pares do mesmo setor & atalho de escala normalizada
    qSel('#visual-peer-suggestions')?.addEventListener('click', (e) => {
      const bPeer = e.target.closest('[data-vadd-peer]');
      if (bPeer) {
        alternarComparacao(bPeer.dataset.vaddPeer);
        return;
      }
      const bMode = e.target.closest('[data-vswitch-mode]');
      if (bMode) {
        visualState.modoPreco = bMode.dataset.vswitchMode;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
      }
    });

    // Janela temporal e modo do gráfico
    qSel('#visual-period-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vperiod]');
      if (b && DIAS_PERIODO[b.dataset.vperiod]) {
        visualState.periodo = b.dataset.vperiod;
        if (['1y', '2y', '3y', '5y', '10y'].includes(b.dataset.vperiod)) {
          visualState.simPeriodoPreset = b.dataset.vperiod;
        }
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
      }
    });

    qSel('#visual-chart-mode')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vmode]');
      if (b) {
        visualState.modoPreco = b.dataset.vmode;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
      }
    });

    qSel('#visual-ceiling-legend')?.addEventListener('click', (e) => {
      const bMedia = e.target.closest('[data-vmedia-toggle]');
      if (bMedia) {
        const k = bMedia.dataset.vmediaToggle;
        if (k in visualState.mediasVisiveis) {
          visualState.mediasVisiveis[k] = !visualState.mediasVisiveis[k];
          salvarPrefsVisual();
          renderizarVisaoGrafica();
          return;
        }
      }
      const bFreq = e.target.closest('[data-vlucro-freq]');
      if (bFreq) {
        visualState.frequenciaLucro = bFreq.dataset.vlucroFreq;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        return;
      }
      const bDinamico = e.target.closest('#btn-toggle-teto-dinamico');
      if (bDinamico) {
        visualState.modoTetoBazin = visualState.modoTetoBazin === 'dinamico' ? 'fixo' : 'dinamico';
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        return;
      }
      const b = e.target.closest('[data-vtoggle-ceil]');
      if (!b || b.disabled) return;
      const k = b.dataset.vtoggleCeil;
      if (k in visualState.tetosVisiveis) {
        visualState.tetosVisiveis[k] = !visualState.tetosVisiveis[k];
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    const tratarAbrirDetalhe = (e) => {
      const b = e.target.closest('[data-vopen-detail]');
      if (b && typeof window.abrirDetalhe === 'function') {
        window.abrirDetalhe(b.dataset.vopenDetail);
      }
    };
    qSel('#visual-asset-header')?.addEventListener('click', tratarAbrirDetalhe);
    qSel('#visual-valuetrap-box')?.addEventListener('click', tratarAbrirDetalhe);

    const focarAoClicarLinhaTabela = (e) => {
      const trBench = e.target.closest('[data-vtoggle-bench-row]');
      if (trBench) {
        const cod = trBench.dataset.vtoggleBenchRow;
        if (cod && ESTILO_BENCHMARKS[cod]) {
          visualState.simBenchmarks[cod] = !visualState.simBenchmarks[cod];
          salvarPrefsVisual();
          renderizarVisaoGrafica();
        }
        return;
      }
      const tr = e.target.closest('[data-vfocus-ticker]');
      if (!tr) return;
      const novo = tr.dataset.vfocusTicker.toUpperCase();
      if (novo && novo !== visualState.tickerPrincipal && construirMapaUniverso().has(novo)) {
        const antigo = visualState.tickerPrincipal;
        visualState.tickerPrincipal = novo;
        visualState.comparados = [antigo, ...visualState.comparados.filter(t => t !== novo)].slice(0, 4);
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
      }
    };
    qSel('#visual-compare-ceilings-wrap')?.addEventListener('click', focarAoClicarLinhaTabela);
    qSel('#sim-breakdown-wrap')?.addEventListener('click', focarAoClicarLinhaTabela);

    // Benchmarks do Simulador
    qSel('#sim-benchmarks-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sim-bench]');
      if (!b) return;
      const cod = b.dataset.simBench;
      if (cod && ESTILO_BENCHMARKS[cod]) {
        visualState.simBenchmarks[cod] = !visualState.simBenchmarks[cod];
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    qSel('#btn-sim-bench-all')?.addEventListener('click', () => {
      ORDEM_BENCHMARKS.forEach(c => { visualState.simBenchmarks[c] = true; });
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    qSel('#btn-sim-bench-none')?.addEventListener('click', () => {
      ORDEM_BENCHMARKS.forEach(c => { visualState.simBenchmarks[c] = false; });
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    // Controles do Simulador
    qSel('#sim-capital-input')?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (Number.isFinite(val) && val >= 50) {
        visualState.simCapital = val;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    qSel('#sim-capital-presets')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-capital]');
      if (!b) return;
      visualState.simCapital = Number(b.dataset.capital);
      const inp = qSel('#sim-capital-input');
      if (inp) inp.value = String(visualState.simCapital);
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    qSel('#sim-reinvest-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-reinvest]');
      if (!b) return;
      visualState.simReinvestir = b.dataset.reinvest === '1';
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    qSel('#sim-net-jcp-btn')?.addEventListener('click', () => {
      visualState.simLiquidoJcp = !visualState.simLiquidoJcp;
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    qSel('#sim-period-presets')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sim-period]');
      if (!b) return;
      visualState.simPeriodoPreset = b.dataset.simPeriod;
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    qSel('#sim-date-start')?.addEventListener('change', (e) => {
      visualState.simPeriodoPreset = 'custom';
      visualState.simDataInicio = e.target.value;
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    qSel('#sim-date-end')?.addEventListener('change', (e) => {
      visualState.simPeriodoPreset = 'custom';
      visualState.simDataFim = e.target.value;
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    let timerResize = null;
    window.addEventListener('resize', () => {
      if (visualState.aba !== 'visual') return;
      clearTimeout(timerResize);
      timerResize = setTimeout(() => renderizarVisaoGrafica(), 120);
    }, { passive: true });
  }

  window.atualizarVisaoGrafica = renderizarVisaoGrafica;
  window.definirAbaPainel = definirAbaPainel;
  window.abrirNaVisaoGrafica = (ticker) => definirAbaPainel('visual', ticker);
  window.abrirAtivoNaVisaoGrafica = (ticker) => definirAbaPainel('visual', ticker);

  window.addEventListener('DOMContentLoaded', bindEventosVisaoGrafica);
})();
