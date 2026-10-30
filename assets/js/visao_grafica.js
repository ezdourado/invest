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

  const DIAS_PERIODO = {
    '6m': 183,
    '1y': 366,
    '2y': 731,
    '3y': 1096,
    '5y': 1860
  };

  const ROTULO_PERIODO = {
    '6m': '6 meses',
    '1y': '1 ano',
    '2y': '2 anos',
    '3y': '3 anos',
    '5y': '5 anos'
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
    modoPreco: ['preco', 'margem_bazin', 'variacao'].includes(prefsSalvas.modoPreco) ? prefsSalvas.modoPreco : 'preco',
    filtroLista: ['todos', 'painel', 'besst', 'dividendos', 'demais'].includes(prefsSalvas.filtroLista) ? prefsSalvas.filtroLista : 'todos',
    ordemLista: prefsSalvas.ordemLista === 'az' ? 'az' : 'margem',
    buscaLista: '',
    sidebarRecolhida: Boolean(prefsSalvas.sidebarRecolhida),
    tetosVisiveis: {
      bazin: prefsSalvas.tetosVisiveis?.bazin !== false,
      graham: prefsSalvas.tetosVisiveis?.graham !== false,
      gordon: prefsSalvas.tetosVisiveis?.gordon !== false
    },
    simCapital: Number(prefsSalvas.simCapital) >= 100 ? Number(prefsSalvas.simCapital) : 10000,
    simReinvestir: prefsSalvas.simReinvestir !== false,
    simLiquidoJcp: prefsSalvas.simLiquidoJcp !== false
  };

  function salvarPrefsVisual() {
    gravarPrefsLocal(STORAGE_KEY_VISUAL, {
      tickerPrincipal: visualState.tickerPrincipal,
      comparados: visualState.comparados,
      periodo: visualState.periodo,
      modoPreco: visualState.modoPreco,
      filtroLista: visualState.filtroLista,
      ordemLista: visualState.ordemLista,
      sidebarRecolhida: visualState.sidebarRecolhida,
      tetosVisiveis: visualState.tetosVisiveis,
      simCapital: visualState.simCapital,
      simReinvestir: visualState.simReinvestir,
      simLiquidoJcp: visualState.simLiquidoJcp
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

  /* ---------- Diagnóstico "Barato há muito tempo?" ---------- */

  function diagnosticarDescontoProlongado(ativo, serie) {
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

    const qtdAbaixo = validos.filter(p => p.preco <= tetoBazin).length;
    const pctAbaixo = qtdAbaixo / validos.length;
    const estaAbaixoAgora = precoFim <= tetoBazin;

    let idxQuebra = -1;
    if (estaAbaixoAgora) {
      for (let i = validos.length - 1; i >= 0; i--) {
        if (validos[i].preco > tetoBazin) {
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

    if (!estaAbaixoAgora) {
      return {
        tipo: 'acima',
        titulo: 'Negociando acima do Teto Bazin atualmente',
        resumo: pctAbaixo > 0
          ? `Acima do teto hoje (${formataReal(precoFim)} vs. teto ${formataReal(tetoBazin)}), mas esteve abaixo do Teto Bazin em ${formataPctSimples(pctAbaixo, 0)} desta janela de ${ROTULO_PERIODO[visualState.periodo]}.${sufixoSust}`
          : `Permaneceu 100% dos últimos ${ROTULO_PERIODO[visualState.periodo]} acima do Teto Bazin atual (${formataReal(tetoBazin)}).${sufixoSust}`,
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
        resumo: `Negociou abaixo do Teto Bazin em ${formataPctSimples(pctAbaixo, 0)} do período (${trechoTempo}) com variação de cotação de ${formataPct(varPeriodo)}.${sufixoSust} Verifique os 4 pilares no Raio-X para descartar armadilha de valor.`,
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
        resumo: `Ficou abaixo do Teto Bazin em ${formataPctSimples(pctAbaixo, 0)} do período (${trechoTempo}), porém valorizando ${formataPct(varPeriodo)} na cotação.${sufixoSust}`,
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
      resumo: `Abaixo do Teto Bazin há ${fmtDuracaoDias(diasStreak)} (${formataPctSimples(pctAbaixo, 0)} da janela de ${ROTULO_PERIODO[visualState.periodo]}). Não configura papel estagnado barato por anos.${sufixoSust}`,
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
      const serie = extrairSerieAtivo(principal, janela || obterDatasJanela());
      const diag = diagnosticarDescontoProlongado(principal, serie);
      const mBaz = temBazin ? principal.bazin.margem_seguranca : null;
      const pctAbaixo = ehValido(diag.pctAbaixo)
        ? diag.pctAbaixo
        : (ehValido(principal.pct_abaixo_teto_5a) ? principal.pct_abaixo_teto_5a / 100 : null);
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
    const tetoGraham = ehValido(principal.graham) && principal.graham > 0 ? principal.graham : null;
    const tetoGordon = ehValido(principal.gordon) && principal.gordon > 0 ? principal.gordon : null;

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
          { cfg: ESTILO_TETOS.graham, val: tetoGraham, m: principal.margem_graham },
          { cfg: ESTILO_TETOS.gordon, val: tetoGordon, m: principal.margem_gordon }
        ];
        tetosLegenda = modelos.map(({ cfg, val, m }) => {
          const ligado = visualState.tetosVisiveis[cfg.chave];
          const disp = ehValido(val);
          const ativo = Boolean(ligado && disp);
          return `
            <button type="button" class="vleg-btn ${ativo ? 'is-on' : 'is-off'} ${cfg.destaque ? 'is-primary-ceil' : ''}"
              data-vtoggle-ceil="${cfg.chave}" ${!disp ? 'disabled' : ''} aria-pressed="${String(ativo)}"
              data-tip="${disp ? `Mostrar ou ocultar a linha tracejada de ${cfg.nome} (${formataReal(val)})` : `${cfg.nome} não se aplica a ${principal.ticker}`}">
              <span class="vleg-swatch ${cfg.swatchCls}" aria-hidden="true"></span>
              <span>${cfg.curto}</span>
              ${cfg.destaque ? `<span class="vleg-badge-main">6%</span>` : ''}
              <strong class="mono">${disp ? formataReal(val) : 'N/A'}</strong>
              ${disp && ehValido(m) ? `<small class="mono ${corClasseMargem(m)}">(${formataPct(m)})</small>` : ''}
            </button>`;
        }).join('');
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
        if (modo === 'preco') return p.preco;
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

    const linhasTetoAtivas = [];
    if (modo === 'preco') {
      if (visualState.tetosVisiveis.bazin && ehValido(tetoBazin)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.bazin, valor: tetoBazin });
        todosValoresY.push(tetoBazin);
      }
      if (visualState.tetosVisiveis.graham && ehValido(tetoGraham)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.graham, valor: tetoGraham });
        todosValoresY.push(tetoGraham);
      }
      if (visualState.tetosVisiveis.gordon && ehValido(tetoGordon)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.gordon, valor: tetoGordon });
        todosValoresY.push(tetoGordon);
      }
    } else {
      todosValoresY.push(0);
    }

    if (!todosValoresY.length) {
      svgWrap.innerHTML = `<div class="vchart-empty">Este ativo não possui Teto Bazin para o modo "Margem vs. Bazin (%)". Alterne para "Preço (R$) &amp; Tetos" ou "Variação (%)".</div>`;
    } else {
      const W = medirLarguraGrafico(svgWrap);
      const ehMobile = W < 580;
      const H = ehMobile ? 295 : 460;
      const padLeft = ehMobile ? 58 : 74;
      const padRight = modo === 'preco' && linhasTetoAtivas.length ? (ehMobile ? 108 : 158) : (ehMobile ? 16 : 28);
      const padTop = 18;
      const padBottom = 32;
      const plotW = Math.max(120, W - padLeft - padRight);
      const plotH = H - padTop - padBottom;

      let yMinBruto = Math.min(...todosValoresY);
      let yMaxBruto = Math.max(...todosValoresY);
      const folga = (yMaxBruto - yMinBruto) * 0.09 || (Math.abs(yMaxBruto) * 0.09 || 1);
      if (modo === 'preco') yMinBruto = Math.max(0, yMinBruto - folga);
      else yMinBruto -= folga;
      yMaxBruto += folga;

      const eixoY = calcularTicksEixoY(yMinBruto, yMaxBruto, ehMobile ? 5 : 6);
      const xDe = (i) => padLeft + (nPontos <= 1 ? plotW / 2 : (i / (nPontos - 1)) * plotW);
      const yDe = (v) => padTop + plotH - ((v - eixoY.min) / (eixoY.max - eixoY.min || 1)) * plotH;

      const fmtEixoY = (v) => {
        if (modo === 'preco') return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: v < 10 ? 2 : 0 });
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

      const curvaPrincipal = curvasPlot[0];
      const yBasePlot = padTop + plotH;

      // Zona sombreada quando negociou abaixo do Teto Bazin + rótulo discreto
      let zonaBazinSvg = '';
      if (modo === 'preco' && visualState.tetosVisiveis.bazin && ehValido(tetoBazin) && curvaPrincipal) {
        const yBazin = Math.max(padTop, Math.min(yBasePlot, yDe(tetoBazin)));
        const areaAbaixoTeto = caminhoSvgArea(curvaPrincipal.xy, yBazin);
        if (areaAbaixoTeto && yBazin < yBasePlot - 12) {
          const yLabelZona = Math.min(yBasePlot - 10, Math.max(padTop + 16, yBazin + 16));
          zonaBazinSvg = `
            <clipPath id="clip-bazin-zone">
              <rect x="${padLeft}" y="${yBazin.toFixed(1)}" width="${plotW}" height="${(yBasePlot - yBazin).toFixed(1)}" />
            </clipPath>
            <path d="${areaAbaixoTeto}" fill="rgba(6, 182, 212, 0.12)" clip-path="url(#clip-bazin-zone)" />
            <text x="${padLeft + 10}" y="${yLabelZona.toFixed(1)}" fill="var(--series-bazin)" font-family="var(--sans)" font-size="12" font-weight="600" opacity="0.88">Zona de compra (abaixo do teto Bazin)</text>
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

      const ticksXSvg = ticksX.map(idx => {
        const x = xDe(idx);
        return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vsvg-axis-text">${escHtml(fmtDataCurta(janela.datas[idx], visualState.periodo !== '6m'))}</text>`;
      }).join('');

      let referenciasSvg = '';
      if (modo === 'preco') {
        referenciasSvg = labelsTetos.map(lt => {
          const xFim = padLeft + plotW;
          const textoValor = lt.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `
            <g class="vsvg-ceil-group">
              <line x1="${padLeft}" y1="${lt.y.toFixed(1)}" x2="${xFim}" y2="${lt.y.toFixed(1)}"
                stroke="${lt.cor}" stroke-width="${lt.largura}" stroke-dasharray="${lt.dash}" />
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

      const areaPrincipalSvg = modo === 'preco' && ativosCmp.length === 0 && curvaPrincipal
        ? `<path d="${caminhoSvgArea(curvaPrincipal.xy, yBasePlot)}" fill="url(#grad-price-main)" />`
        : '';

      const linhasCurvasSvg = curvasPlot.map(c => {
        const d = caminhoSvgLinha(c.xy);
        if (!d) return '';
        const sw = c.principal ? 2.5 : 2.0;
        return `<path d="${d}" fill="none" stroke="${c.cor}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" />`;
      }).join('');

      const pontosCrosshairSvg = curvasPlot.map((c, idx) =>
        `<circle class="v-ch-dot is-hidden" data-ch-idx="${idx}" cx="0" cy="0" r="${c.principal ? 4.8 : 4}" fill="${c.cor}" stroke="var(--bg)" stroke-width="1.8" />`
      ).join('');

      svgWrap.innerHTML = `
        <svg class="vsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gráfico histórico de preços e preços-teto de ${escHtml(principal.ticker)}">
          <defs>
            <linearGradient id="grad-price-main" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${COR_PRINCIPAL}" stop-opacity="0.22" />
              <stop offset="100%" stop-color="${COR_PRINCIPAL}" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          ${linhasGradeSvg}
          ${zonaBazinSvg}
          ${areaPrincipalSvg}
          ${referenciasSvg}
          ${linhasCurvasSvg}
          ${ticksXSvg}
          <line class="v-crosshair is-hidden" x1="0" y1="${padTop}" x2="0" y2="${yBasePlot}" stroke="var(--text-strong)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 3" />
          ${pontosCrosshairSvg}
          <rect class="v-hit-area" x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent" />
        </svg>
      `;

      const svgEl = svgWrap.querySelector('svg');
      const chLine = svgEl.querySelector('.v-crosshair');
      const chDots = svgEl.querySelectorAll('.v-ch-dot');

      const atualizarHudPreco = (idx) => {
        const ehUltimo = idx === null || idx === undefined;
        const i = ehUltimo ? nPontos - 1 : idx;
        const dtReal = ehUltimo && principal.data_ult_cot
          ? fmtDataBr(principal.data_ult_cot)
          : fmtDataBr(janela.datas[i]);

        if (ativosCmp.length === 0) {
          const p = ehUltimo && ehValido(principal.preco) ? principal.preco : curvaPrincipal.serieOriginal[i]?.preco;
          const mBaz = ehValido(tetoBazin) && ehValido(p) ? (tetoBazin - p) / tetoBazin : null;
          const mGra = ehValido(tetoGraham) && ehValido(p) ? (tetoGraham - p) / tetoGraham : null;
          const mGor = ehValido(tetoGordon) && ehValido(p) ? (tetoGordon - p) / tetoGordon : null;
          if (hudEl) {
            hudEl.innerHTML = `
              <span class="vhud-date mono">${ehUltimo ? `Última cotação (${dtReal})` : dtReal}</span>
              <span class="vhud-metric">Preço: <strong class="mono">${formataReal(p)}</strong></span>
              ${ehValido(tetoBazin) ? `<span class="vhud-metric">Margem vs. Bazin: <strong class="mono ${corClasseMargem(mBaz)}">${formataPct(mBaz)}</strong></span>` : ''}
              ${ehValido(tetoGraham) ? `<span class="vhud-metric">Margem vs. Graham: <strong class="mono ${corClasseMargem(mGra)}">${formataPct(mGra)}</strong></span>` : ''}
              ${ehValido(tetoGordon) ? `<span class="vhud-metric">Margem vs. Gordon: <strong class="mono ${corClasseMargem(mGor)}">${formataPct(mGor)}</strong></span>` : ''}
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
          atualizarHudPreco(idx);
        },
        () => {
          chLine.classList.add('is-hidden');
          chDots.forEach(d => d.classList.add('is-hidden'));
          atualizarHudPreco(null);
        }
      );
    }

    // 4. Diagnóstico 3 Colunas Desktop ("Barato há muito tempo?" integrado ao Score Anti-Cilada)
    const diag = diagnosticarDescontoProlongado(principal, seriesPorTicker.get(principal.ticker) || []);
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

    // 5. Tabela comparativa de preços-teto (quando 2+ ativos comparados)
    if (cmpTableWrap) {
      if (ativosCmp.length === 0) {
        cmpTableWrap.innerHTML = '';
      } else {
        const linhasHtml = todosAtivos.map((a, idx) => {
          const dotCls = idx === 0 ? 'dot-price' : `dot-cmp-${(idx - 1) % PALETA_COMPARACAO.length}`;
          const dAtivo = diagnosticarDescontoProlongado(a, seriesPorTicker.get(a.ticker) || []);
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

          return `
            <tr class="vcmp-row" data-vfocus-ticker="${escHtml(a.ticker)}" title="Clique para colocar ${escHtml(a.ticker)} em foco">
              <td data-label="Ativo">
                <span class="vcmp-ticker"><i class="dot ${dotCls}" aria-hidden="true"></i><b class="mono">${escHtml(a.ticker)}</b> <small class="t-muted">${escHtml(rotCat)}</small></span>
              </td>
              <td class="num mono" data-label="Preço Atual">${formataReal(a.preco)}</td>
              <td class="num mono" data-label="Teto Bazin">${a.bazin?.teto > 0 ? `${formataReal(a.bazin.teto)} <small class="${corClasseMargem(a.bazin.margem_seguranca)}">(${formataPct(a.bazin.margem_seguranca)})</small>` : '—'}</td>
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

  function renderizarSecaoSimulador(principal, ativosCmp, janela) {
    const kpiGrid = qSel('#sim-kpi-grid');
    const subEl = qSel('#sim-subtitle');
    const hudEl = qSel('#sim-chart-hud');
    const svgWrap = qSel('#sim-svg-wrap');
    const breakdownWrap = qSel('#sim-breakdown-wrap');
    if (!svgWrap || !kpiGrid) return;

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

    const todosAtivos = [principal, ...ativosCmp];
    const simulacoes = todosAtivos
      .map((a, idx) => ({
        cor: idx === 0 ? '#06b6d4' : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length],
        corLinhaMulti: idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length],
        dotCls: idx === 0 ? 'dot-price' : `dot-cmp-${(idx - 1) % PALETA_COMPARACAO.length}`,
        principal: idx === 0,
        sim: simularRetornoAtivo(a, janela, visualState.simCapital, visualState.simReinvestir, visualState.simLiquidoJcp)
      }))
      .filter(x => x.sim !== null);

    if (!simulacoes.length) {
      kpiGrid.innerHTML = '';
      svgWrap.innerHTML = `<div class="vchart-empty">Dados históricos insuficientes para simular o período selecionado.</div>`;
      if (breakdownWrap) breakdownWrap.innerHTML = '';
      return;
    }

    const simMain = simulacoes[0].sim;
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
        <div class="kpi-foot">${ehValido(simMain.cagr) ? `CAGR: ${formataPct(simMain.cagr)} ao ano` : `Janela de ${ROTULO_PERIODO[visualState.periodo]}`}</div>
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

    const chDotsSvg = seriesInterativas.map((s, idx) =>
      `<circle class="v-sim-dot is-hidden" data-sim-idx="${idx}" cx="0" cy="0" r="4.2" fill="${s.cor}" stroke="var(--bg)" stroke-width="1.6" />`
    ).join('');

    svgWrap.innerHTML = `
      <svg class="vsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Evolução do patrimônio simulado com dividendos">
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

      if (!modoMulti) {
        const retData = (pt.patTotal - visualState.simCapital) / visualState.simCapital;
        if (hudEl) {
          hudEl.innerHTML = `
            <span class="vhud-date mono">${ehUltimo ? `Final (${dt})` : dt}</span>
            <span class="vhud-metric"><span class="vleg-swatch is-sim-total" aria-hidden="true"></span>Total c/ dividendos: <strong class="mono t-green">${formataReal(pt.patTotal)} (${formataPct(retData)})</strong></span>
            <span class="vhud-metric"><span class="vleg-swatch is-sim-quote" aria-hidden="true"></span>Apenas cotação: <strong class="mono">${formataReal(pt.patCotacao)}</strong></span>
            <span class="vhud-metric">Parcela dividendos: <strong class="mono t-green">+${formataReal(Math.max(0, pt.patTotal - pt.patCotacao))}</strong></span>
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
          hudEl.innerHTML = `<span class="vhud-date mono">${ehUltimo ? `Final (${dt})` : dt}</span>${itens}`;
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
      const ordenadas = [...simulacoes].sort((a, b) => b.sim.patrimonioFinal - a.sim.patrimonioFinal);
      const linhas = ordenadas.map(item => {
        const s = item.sim;
        const dotCls = modoMulti ? item.dotCls : 'dot-bazin';
        return `
          <tr class="vcmp-row" data-vfocus-ticker="${escHtml(s.ativo.ticker)}" title="Clique para focar em ${escHtml(s.ativo.ticker)}">
            <td data-label="Ativo"><span class="vcmp-ticker"><i class="dot ${dotCls}" aria-hidden="true"></i><b class="mono">${escHtml(s.ativo.ticker)}</b></span></td>
            <td class="num mono" data-label="Preço Ini → Fim">${formataReal(s.precoIni)} → ${formataReal(s.precoFim)}</td>
            <td class="num mono ${s.retornoCotacao >= 0 ? '' : 't-red'}" data-label="Só Cotação">${formataPct(s.retornoCotacao)}</td>
            <td class="num mono t-green" data-label="Proventos Recebidos">${formataReal(s.proventosRecebidosRS)} <small class="t-muted">(${s.qtdEventos}x)</small></td>
            <td class="num mono" data-label="Ações (Ini → Fim)">${s.acoesIniciais.toFixed(1)} → ${s.acoesFinais.toFixed(1)}</td>
            <td class="num mono" data-label="Patrimônio Final"><strong>${formataReal(s.patrimonioFinal)}</strong></td>
            <td class="num mono ${s.retornoTotal >= 0 ? 't-green' : 't-red'}" data-label="Retorno Total">
              <strong>${formataPct(s.retornoTotal)}</strong>
              ${ehValido(s.cagr) ? `<small class="t-muted"> (${formataPct(s.cagr)} a.a.)</small>` : ''}
            </td>
          </tr>
        `;
      }).join('');

      breakdownWrap.innerHTML = `
        <div class="vsub-table-head">Resumo da Simulação · Aporte de ${formataReal(visualState.simCapital)} (${ROTULO_PERIODO[visualState.periodo]})</div>
        <div class="table-wrap">
          <table class="vt vcmp-table">
            <thead>
              <tr>
                <th>Ativo</th>
                <th class="num">Preço Ini → Fim</th>
                <th class="num">Só Cotação</th>
                <th class="num">Proventos Caixa</th>
                <th class="num">Qtd. Ações</th>
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
    visualState.aba = ['tabela', 'visual', 'matriz', 'calendario'].includes(aba) ? aba : 'tabela';
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
    ['tabela', 'visual', 'matriz', 'calendario'].forEach(id => {
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
        calendario: 'Próximas datas-com abertas, pagamentos agendados, últimos pagos e sazonalidade de 12 meses'
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
    if (obj.periodo && DIAS_PERIODO[obj.periodo]) {
      visualState.periodo = obj.periodo;
    }
    if (obj.modo && ['preco', 'margem_bazin', 'variacao'].includes(obj.modo)) {
      visualState.modoPreco = obj.modo;
    } else if (obj.m && ['preco', 'margem_bazin', 'variacao'].includes(obj.m)) {
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
