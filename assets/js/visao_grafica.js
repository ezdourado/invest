/* Visão Gráfica & Simulador de Rendimento com Dividendos (index.html)
 * Somente leitura e apresentação dos dados de ./data/valuation.json:
 * - Os preços-teto Bazin (K=6%), Graham e Gordon vêm prontos do motor Python.
 * - O histórico de preços (ajustado apenas por splits) e os proventos por data-com
 *   alimentam o gráfico comparativo e o simulador de retorno total.
 */

(function () {
  const STORAGE_KEY_VISUAL = 'painel_valuation_visual_prefs';

  const COR_PRINCIPAL = '#5b8def';
  const PALETA_COMPARACAO = ['#38bdf8', '#f59e0b', '#f472b6', '#34d399'];

  const ESTILO_TETOS = {
    bazin: {
      chave: 'bazin',
      nome: 'Teto Bazin (K=6%)',
      curto: 'Bazin',
      cor: '#2fbf86',
      dash: '9 5',
      largura: 2.4,
      destaque: true
    },
    graham: {
      chave: 'graham',
      nome: 'Teto Graham',
      curto: 'Graham',
      cor: '#e0b341',
      dash: '5 5',
      largura: 1.75,
      destaque: false
    },
    gordon: {
      chave: 'gordon',
      nome: 'Teto Gordon',
      curto: 'Gordon',
      cor: '#a78bfa',
      dash: '2.5 4',
      largura: 1.75,
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

  const prefsSalvas = lerStorage(STORAGE_KEY_VISUAL, {}) || {};

  const visualState = {
    aba: 'tabela',
    tickerPrincipal: prefsSalvas.tickerPrincipal || '',
    comparados: Array.isArray(prefsSalvas.comparados) ? prefsSalvas.comparados.slice(0, 4) : [],
    periodo: DIAS_PERIODO[prefsSalvas.periodo] ? prefsSalvas.periodo : '5y',
    modoPreco: ['preco', 'margem_bazin', 'variacao'].includes(prefsSalvas.modoPreco) ? prefsSalvas.modoPreco : 'preco',
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
    gravarStorage(STORAGE_KEY_VISUAL, {
      tickerPrincipal: visualState.tickerPrincipal,
      comparados: visualState.comparados,
      periodo: visualState.periodo,
      modoPreco: visualState.modoPreco,
      tetosVisiveis: visualState.tetosVisiveis,
      simCapital: visualState.simCapital,
      simReinvestir: visualState.simReinvestir,
      simLiquidoJcp: visualState.simLiquidoJcp
    });
  }

  function fmtDataBr(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '—';
    const partes = isoStr.slice(0, 10).split('-');
    if (partes.length !== 3) return isoStr;
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
    if (!valido(dias) || dias <= 0) return 'menos de 1 semana';
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
    const mapa = mapaUniverso();
    if (!mapa.size) return null;

    if (!visualState.tickerPrincipal || !mapa.has(visualState.tickerPrincipal.toUpperCase())) {
      const preferidoPainel = painelState.selecionados.find(t => mapa.has(t.toUpperCase()));
      const padraoBase = mapa.has('BBAS3') ? 'BBAS3' : painelState.universo[0]?.ticker;
      visualState.tickerPrincipal = (preferidoPainel || padraoBase || '').toUpperCase();
    } else {
      visualState.tickerPrincipal = visualState.tickerPrincipal.toUpperCase();
    }

    visualState.comparados = visualState.comparados
      .map(t => String(t).toUpperCase())
      .filter((t, idx, arr) => t !== visualState.tickerPrincipal && mapa.has(t) && arr.indexOf(t) === idx)
      .slice(0, 4);

    return mapa.get(visualState.tickerPrincipal) || null;
  }

  /* ---------- Extração de série histórica na janela ---------- */

  function obterDatasJanela() {
    const todasDatas = painelState.payload?.historico_datas || [];
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
        preco: valido(p) && p > 0 ? p : null
      });
    }
    return pontos;
  }

  /* ---------- Diagnóstico "Barato há muito tempo?" ---------- */

  function diagnosticarDescontoProlongado(ativo, serie) {
    const validos = serie.filter(p => valido(p.preco) && p.preco > 0);
    const tetoBazin = ativo?.bazin?.teto;
    const cat = categoriaDoAtivo(ativo);

    if (!validos.length) {
      return { tipo: 'neutro', titulo: 'Histórico indisponível', resumo: 'Sem cotações suficientes na janela selecionada.' };
    }

    const precos = validos.map(p => p.preco);
    const minPreco = Math.min(...precos);
    const maxPreco = Math.max(...precos);
    const medPreco = precos.reduce((acc, v) => acc + v, 0) / precos.length;
    const precoIni = validos[0].preco;
    const precoFim = validos[validos.length - 1].preco;
    const varPeriodo = precoIni > 0 ? (precoFim - precoIni) / precoIni : 0;
    const diasJanela = Math.max(1, (new Date(validos[validos.length - 1].data) - new Date(validos[0].data)) / 86400000);

    if (!valido(tetoBazin) || tetoBazin <= 0) {
      const refGraham = valido(ativo.graham)
        ? `Referência secundária Graham: ${fmtReal(ativo.graham)} (${fmtPct(ativo.margem_graham)}).`
        : 'Sem LPA/VPA positivos para cálculo de Graham.';
      return {
        tipo: 'sem-bazin',
        titulo: cat === 'demais' ? 'Perfil Demais papéis · sem teto Bazin aplicável' : 'Sem DPA recorrente p/ Teto Bazin',
        resumo: `${ativo.ticker} não possui proventos recorrentes nos últimos 5 anos fechados para formar preço-teto Bazin. ${refGraham}`,
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

    if (!estaAbaixoAgora) {
      return {
        tipo: 'acima',
        titulo: 'Negociando acima do Teto Bazin atualmente',
        resumo: pctAbaixo > 0
          ? `Apesar de caro hoje (${fmtReal(precoFim)} vs. teto ${fmtReal(tetoBazin)}), negociou abaixo do Teto Bazin em ${fmtPctSimples(pctAbaixo, 0)} desta janela de ${ROTULO_PERIODO[visualState.periodo]}.`
          : `Permaneceu 100% dos últimos ${ROTULO_PERIODO[visualState.periodo]} acima do Teto Bazin atual (${fmtReal(tetoBazin)}).`,
        pctAbaixo,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak: 0
      };
    }

    // Está abaixo do Teto Bazin hoje
    if (diasJanela >= 500 && (pctAbaixo >= 0.70 || diasStreak >= 540) && varPeriodo <= 0.05) {
      return {
        tipo: 'alerta',
        titulo: 'Atenção · Barato há muito tempo sem reação na cotação',
        resumo: `Ficou abaixo do Teto Bazin atual em ${fmtPctSimples(pctAbaixo, 0)} da janela (${fmtDuracaoDias(diasStreak)} consecutivos) com variação de preço de ${fmtPct(varPeriodo)}. Desconto crônico exige checar no Raio-X se há queda de lucros/ROE, risco regulatório ou possível armadilha de valor.`,
        pctAbaixo,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak
      };
    }

    if (diasJanela >= 500 && (pctAbaixo >= 0.65 || diasStreak >= 450)) {
      return {
        tipo: 'estrutural',
        titulo: 'Desconto recorrente · Múltiplos historicamente abaixo do teto',
        resumo: `Negociou abaixo do Teto Bazin atual em ${fmtPctSimples(pctAbaixo, 0)} do período (${fmtDuracaoDias(diasStreak)} seguidos), mas acumulando ${fmtPct(varPeriodo)} na cotação. Comum em geradoras de caixa com valuation descontado — valide sustentabilidade do payout e dívida.`,
        pctAbaixo,
        minPreco,
        maxPreco,
        medPreco,
        varPeriodo,
        diasStreak
      };
    }

    return {
      tipo: 'recente',
      titulo: 'Janela de desconto recente frente ao histórico',
      resumo: `Negocia abaixo do Teto Bazin há ${fmtDuracaoDias(diasStreak)} (${fmtPctSimples(pctAbaixo, 0)} da janela de ${ROTULO_PERIODO[visualState.periodo]}). Não apresenta padrão de papel estagnado barato por anos.`,
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
    const validos = serieBruta.filter(p => valido(p.preco) && p.preco > 0);
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
          .filter(ev => ev && ev.data_com > dataIni && ev.data_com <= dataFim && valido(ev.valor) && ev.valor > 0)
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

  /* ---------- Utilitários de Gráfico SVG Responsivo ---------- */

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

  function resolverColisaoVertical(itens, minTop, maxBottom, espacamento = 20) {
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

  function anexarInteracaoCrosshair(svgEl, areaPlot, totalPontos, aoMover, aoSair) {
    const hitRect = svgEl.querySelector('.v-hit-area');
    if (!hitRect || totalPontos < 1) return;

    const processarEvento = (ev) => {
      const rect = hitRect.getBoundingClientRect();
      if (!rect.width) return;
      const relX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const idx = Math.round(relX * (totalPontos - 1));
      aoMover(Math.max(0, Math.min(totalPontos - 1, idx)), areaPlot);
    };

    hitRect.addEventListener('pointerdown', (ev) => {
      processarEvento(ev);
    });
    hitRect.addEventListener('pointermove', (ev) => {
      processarEvento(ev);
    });
    hitRect.addEventListener('pointerleave', () => {
      aoSair();
    });
  }

  /* ---------- Renderização: Controles do Topo ---------- */

  function renderizarControlesTopo(principal) {
    const selMain = $('#visual-main-select');
    const selCmp = $('#visual-compare-select');
    const pillsWrap = $('#visual-quick-pills');
    const chipsCmp = $('#visual-compare-chips');
    const peersWrap = $('#visual-peer-suggestions');

    const universoOrd = [...painelState.universo].sort((a, b) => a.ticker.localeCompare(b.ticker));
    const noPainelSet = new Set(painelState.selecionados.map(t => t.toUpperCase()));

    const gruposOpt = [
      { titulo: 'No seu painel', itens: universoOrd.filter(a => noPainelSet.has(a.ticker.toUpperCase())) },
      { titulo: 'Setores BESST', itens: universoOrd.filter(a => !noPainelSet.has(a.ticker.toUpperCase()) && categoriaDoAtivo(a) === 'besst') },
      { titulo: 'Outras pagadoras de dividendos', itens: universoOrd.filter(a => !noPainelSet.has(a.ticker.toUpperCase()) && categoriaDoAtivo(a) === 'dividendos') },
      { titulo: 'Demais papéis', itens: universoOrd.filter(a => !noPainelSet.has(a.ticker.toUpperCase()) && categoriaDoAtivo(a) === 'demais') }
    ];

    if (selMain) {
      selMain.innerHTML = gruposOpt
        .filter(g => g.itens.length)
        .map(g => `<optgroup label="${esc(g.titulo)}">${g.itens.map(a =>
          `<option value="${esc(a.ticker)}" ${a.ticker.toUpperCase() === principal.ticker.toUpperCase() ? 'selected' : ''}>${esc(a.ticker)} · ${esc(a.setor)} (${fmtReal(a.preco)})</option>`
        ).join('')}</optgroup>`).join('');
    }

    if (selCmp) {
      const jaUsados = new Set([principal.ticker.toUpperCase(), ...visualState.comparados]);
      const desabilitado = visualState.comparados.length >= 4;
      selCmp.disabled = desabilitado;
      selCmp.innerHTML = `<option value="">${desabilitado ? 'Limite de 4 comparações atingido' : '+ Comparar papel…'}</option>` +
        gruposOpt
          .filter(g => g.itens.length)
          .map(g => {
            const disp = g.itens.filter(a => !jaUsados.has(a.ticker.toUpperCase()));
            if (!disp.length) return '';
            return `<optgroup label="${esc(g.titulo)}">${disp.map(a =>
              `<option value="${esc(a.ticker)}">${esc(a.ticker)} · ${esc(a.setor)}</option>`
            ).join('')}</optgroup>`;
          }).join('');
    }

    // Pílulas rápidas: ativos do painel ou destaques das 3 categorias
    if (pillsWrap) {
      let listaRapida = ativosSelecionados();
      if (!listaRapida.length) {
        const destaques = ['BBAS3', 'ITUB4', 'TAEE11', 'BBSE3', 'VIVT3', 'PETR4', 'VALE3', 'WEGE3', 'PRIO3', 'RADL3'];
        const mapa = mapaUniverso();
        listaRapida = destaques.map(t => mapa.get(t)).filter(Boolean);
      }
      pillsWrap.innerHTML = listaRapida.slice(0, 18).map(a => {
        const ativo = a.ticker.toUpperCase() === principal.ticker.toUpperCase();
        const cat = categoriaDoAtivo(a);
        const corDot = a.bazin?.veredito === 'verde' ? 'var(--green)' : (a.bazin?.veredito === 'amarelo' ? 'var(--yellow)' : 'var(--red)');
        return `
          <button type="button" class="chip ${ativo ? 'is-on' : ''}" data-vquick-ticker="${esc(a.ticker)}"
            data-tip="${esc(a.setor)}${cat === 'demais' ? ' · Demais papéis' : ''} · ${fmtReal(a.preco)}">
            <i style="background:${corDot}"></i>${esc(a.ticker)}
          </button>`;
      }).join('');
    }

    // Chips dos papéis comparados
    if (chipsCmp) {
      if (!visualState.comparados.length) {
        chipsCmp.innerHTML = `<span class="t-dim" style="font-size:12px">Nenhum papel adicionado</span>`;
      } else {
        chipsCmp.innerHTML = visualState.comparados.map((t, idx) => {
          const cor = PALETA_COMPARACAO[idx % PALETA_COMPARACAO.length];
          return `
            <span class="vcompare-chip" style="--cmp-color:${cor}">
              <i style="background:${cor}"></i>
              <b>${esc(t)}</b>
              <button type="button" data-vremove-cmp="${esc(t)}" aria-label="Remover ${esc(t)} da comparação">×</button>
            </span>`;
        }).join('') + (visualState.comparados.length > 1
          ? `<button type="button" class="btn-link-dim" id="btn-clear-comparisons">Limpar</button>`
          : '');
      }
    }

    // Sugestões de pares do mesmo setor
    if (peersWrap) {
      const jaUsados = new Set([principal.ticker.toUpperCase(), ...visualState.comparados]);
      const prefixoRaiz = principal.ticker.slice(0, 4);
      const pares = painelState.universo
        .filter(a => !jaUsados.has(a.ticker.toUpperCase()) && a.setor === principal.setor && !a.ticker.startsWith(prefixoRaiz))
        .slice(0, 4);

      if (pares.length && visualState.comparados.length < 4) {
        peersWrap.innerHTML = `<span class="vctrl-mini-label">Mesmo setor:</span>` +
          pares.map(p => `<button type="button" class="chip-mini" data-vadd-peer="${esc(p.ticker)}">+ ${esc(p.ticker)}</button>`).join('');
      } else {
        peersWrap.innerHTML = '';
      }
    }

    // Estado ativo dos botões de período e modo
    document.querySelectorAll('#visual-period-group .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.vperiod === visualState.periodo);
    });
    document.querySelectorAll('#visual-chart-mode .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.vmode === visualState.modoPreco);
    });
  }

  /* ---------- Renderização: Gráfico 1 (Preços vs. Preços-Teto Tracejados) ---------- */

  function renderizarSecaoPrecosTetos(principal, ativosCmp, janela) {
    const headerEl = $('#visual-asset-header');
    const legendEl = $('#visual-ceiling-legend');
    const hudEl = $('#visual-price-hud');
    const svgWrap = $('#visual-price-svg-wrap');
    const trapEl = $('#visual-valuetrap-box');
    const cmpTableWrap = $('#visual-compare-ceilings-wrap');
    if (!svgWrap) return;

    const cat = categoriaDoAtivo(principal);
    const catBadge = cat === 'besst'
      ? `<span class="tag tag-besst">BESST</span>`
      : (cat === 'demais' ? `<span class="tag tag-demais">Demais papéis</span>` : `<span class="tag tag-div">Dividendos</span>`);

    if (headerEl) {
      headerEl.innerHTML = `
        <div class="vasset-title-row">
          <h2 class="card-title vasset-main-title">
            <span class="mono">${esc(principal.ticker)}</span>
            ${principal.empresa ? `<span class="t-muted" style="font-weight:400">· ${esc(principal.empresa)}</span>` : ''}
            ${catBadge}
            ${htmlVeredito(principal.bazin?.veredito)}
          </h2>
        </div>
        <p class="card-sub">
          Setor: <strong style="color:var(--text);text-transform:capitalize">${esc(principal.setor)}</strong> ·
          Cotação atual: <strong class="mono" style="color:var(--text-strong)">${fmtReal(principal.preco)}</strong> ·
          <button type="button" class="btn-inline-link" data-vopen-detail="${esc(principal.ticker)}">Abrir Raio-X completo</button> ·
          <a class="btn-inline-link" href="${urlInvestidor10(principal.ticker)}" target="_blank" rel="noopener noreferrer">Investidor10 ↗</a>
        </p>
      `;
    }

    const todosAtivos = [principal, ...ativosCmp];
    const seriesPorTicker = new Map();
    todosAtivos.forEach(a => seriesPorTicker.set(a.ticker, extrairSerieAtivo(a, janela)));

    const modo = visualState.modoPreco;
    const tetoBazin = principal.bazin?.teto > 0 ? principal.bazin.teto : null;
    const tetoGraham = valido(principal.graham) && principal.graham > 0 ? principal.graham : null;
    const tetoGordon = valido(principal.gordon) && principal.gordon > 0 ? principal.gordon : null;

    // Legenda interativa de preços-teto e papéis comparados
    if (legendEl) {
      const seriesLegenda = todosAtivos.map((a, idx) => {
        const cor = idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length];
        return `<span class="vleg-item"><span class="vleg-line" style="border-top:2.5px solid ${cor}"></span><b>${esc(a.ticker)}</b> <span class="mono t-muted">${fmtReal(a.preco)}</span></span>`;
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
          const disp = valido(val);
          const estiloDash = cfg.chave === 'gordon' ? 'dotted' : 'dashed';
          return `
            <button type="button" class="vleg-btn ${ligado && disp ? 'is-on' : 'is-off'} ${cfg.destaque ? 'is-primary-ceil' : ''}"
              data-vtoggle-ceil="${cfg.chave}" ${!disp ? 'disabled' : ''}
              data-tip="${disp ? `Clique para mostrar/ocultar a linha tracejada de ${cfg.nome} de ${principal.ticker}` : `${cfg.nome} não aplicável a ${principal.ticker}`}">
              <span class="vleg-line" style="border-top:${cfg.destaque ? '2.5px' : '2px'} ${estiloDash} ${cfg.cor}"></span>
              <span>${cfg.nome}</span>
              <strong class="mono">${disp ? fmtReal(val) : 'N/A'}</strong>
              ${disp && valido(m) ? `<small class="mono ${classeMargem(m)}">(${fmtPct(m)})</small>` : ''}
            </button>`;
        }).join('');
      } else if (modo === 'margem_bazin') {
        tetosLegenda = `
          <span class="vleg-item is-primary-ceil">
            <span class="vleg-line" style="border-top:2.5px dashed ${ESTILO_TETOS.bazin.cor}"></span>
            <span>Linha 0% = Teto Bazin de cada papel (acima de 0% = barato / com margem de segurança)</span>
          </span>`;
      } else {
        tetosLegenda = `<span class="vleg-item t-muted">Variação percentual acumulada da cotação (Base 0% no início de ${ROTULO_PERIODO[visualState.periodo]})</span>`;
      }

      legendEl.innerHTML = `<div class="vleg-group">${seriesLegenda}</div><div class="vleg-group">${tetosLegenda}</div>`;
    }

    // Construção das curvas numéricas conforme o modo selecionado
    const nPontos = janela.datas.length;
    const curvasPlot = [];

    todosAtivos.forEach((a, idx) => {
      const cor = idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length];
      const serie = seriesPorTicker.get(a.ticker) || [];
      const primeiroValido = serie.find(p => valido(p.preco) && p.preco > 0)?.preco || null;
      const tBazinAtivo = a.bazin?.teto > 0 ? a.bazin.teto : null;

      const valores = serie.map(p => {
        if (!valido(p.preco) || p.preco <= 0) return null;
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
        principal: idx === 0,
        serieOriginal: serie,
        valores,
        semBazinModoMargem: modo === 'margem_bazin' && !tBazinAtivo
      });
    });

    // Determinar domínio Y
    const todosValoresY = [];
    curvasPlot.forEach(c => c.valores.forEach(v => { if (valido(v)) todosValoresY.push(v); }));

    const linhasTetoAtivas = [];
    if (modo === 'preco') {
      if (visualState.tetosVisiveis.bazin && valido(tetoBazin)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.bazin, valor: tetoBazin });
        todosValoresY.push(tetoBazin);
      }
      if (visualState.tetosVisiveis.graham && valido(tetoGraham)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.graham, valor: tetoGraham });
        todosValoresY.push(tetoGraham);
      }
      if (visualState.tetosVisiveis.gordon && valido(tetoGordon)) {
        linhasTetoAtivas.push({ ...ESTILO_TETOS.gordon, valor: tetoGordon });
        todosValoresY.push(tetoGordon);
      }
    } else if (modo === 'margem_bazin') {
      todosValoresY.push(0);
    } else if (modo === 'variacao') {
      todosValoresY.push(0);
    }

    if (!todosValoresY.length) {
      svgWrap.innerHTML = `<div class="vchart-empty">Este ativo não possui Teto Bazin para o modo "Desconto vs. Bazin (%)". Alterne para "Preço (R$) &amp; Tetos" ou "Variação (%)".</div>`;
    } else {
      const larguraContainer = Math.max(300, svgWrap.clientWidth || 860);
      const ehMobile = larguraContainer < 600;
      const W = larguraContainer;
      const H = ehMobile ? 300 : 360;
      const padLeft = ehMobile ? 54 : 66;
      const padRight = modo === 'preco' && linhasTetoAtivas.length ? (ehMobile ? 96 : 126) : (ehMobile ? 16 : 24);
      const padTop = 18;
      const padBottom = 32;
      const plotW = Math.max(120, W - padLeft - padRight);
      const plotH = H - padTop - padBottom;

      let yMinBruto = Math.min(...todosValoresY);
      let yMaxBruto = Math.max(...todosValoresY);
      const folga = (yMaxBruto - yMinBruto) * 0.08 || (Math.abs(yMaxBruto) * 0.08 || 1);
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

      // Ticks do eixo X
      const qtdTicksX = ehMobile ? 4 : 7;
      const ticksX = [];
      for (let t = 0; t < qtdTicksX; t++) {
        const idx = Math.round((t / (qtdTicksX - 1)) * (nPontos - 1));
        if (!ticksX.includes(idx)) ticksX.push(idx);
      }

      // Coordenadas XY de cada curva
      curvasPlot.forEach(c => {
        c.xy = c.valores.map((v, i) => valido(v) ? { x: xDe(i), y: yDe(v), v, data: janela.datas[i], preco: c.serieOriginal[i]?.preco } : null);
      });

      const clipId = 'clip-bazin-zone';
      const gradId = 'grad-price-main';
      const curvaPrincipal = curvasPlot[0];
      const yBasePlot = padTop + plotH;

      // Zona sombreada verde abaixo do Teto Bazin no modo Preço (quando 1 ativo ou foco no principal)
      let zonaBazinSvg = '';
      if (modo === 'preco' && visualState.tetosVisiveis.bazin && valido(tetoBazin) && curvaPrincipal) {
        const yBazin = Math.max(padTop, Math.min(yBasePlot, yDe(tetoBazin)));
        const areaAbaixoTeto = caminhoSvgArea(curvaPrincipal.xy, yBazin);
        if (areaAbaixoTeto && yBazin < yBasePlot) {
          zonaBazinSvg = `
            <clipPath id="${clipId}">
              <rect x="${padLeft}" y="${yBazin.toFixed(1)}" width="${plotW}" height="${(yBasePlot - yBazin).toFixed(1)}" />
            </clipPath>
            <path d="${areaAbaixoTeto}" fill="rgba(47, 191, 134, 0.11)" clip-path="url(#${clipId})" />
          `;
        }
      } else if (modo === 'margem_bazin') {
        const yZero = Math.max(padTop, Math.min(yBasePlot, yDe(0)));
        if (yZero > padTop) {
          zonaBazinSvg = `<rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${(yZero - padTop).toFixed(1)}" fill="rgba(47, 191, 134, 0.06)" />`;
        }
      }

      // Rótulos laterais anticolisão para os preços-teto no modo Preço
      const labelsTetos = resolverColisaoVertical(
        linhasTetoAtivas.map(lt => ({ ...lt, y: yDe(lt.valor) })),
        padTop + 10,
        yBasePlot - 10,
        22
      );

      const linhasGradeSvg = eixoY.ticks.map(tv => {
        const y = yDe(tv);
        return `
          <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" stroke="#1d2632" stroke-width="1" />
          <text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="vsvg-axis-text">${esc(fmtEixoY(tv))}</text>
        `;
      }).join('');

      const ticksXSvg = ticksX.map(idx => {
        const x = xDe(idx);
        return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vsvg-axis-text">${esc(fmtDataCurta(janela.datas[idx], visualState.periodo !== '6m'))}</text>`;
      }).join('');

      // Linhas de referência tracejadas (Bazin, Graham, Gordon ou Linha 0%)
      let referenciasSvg = '';
      if (modo === 'preco') {
        referenciasSvg = labelsTetos.map(lt => {
          const xFim = padLeft + plotW;
          const textoValor = lt.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const labelTxt = ehMobile ? `${lt.curto} ${textoValor}` : `${lt.curto} R$ ${textoValor}`;
          return `
            <g class="vsvg-ceil-group">
              <line x1="${padLeft}" y1="${lt.y.toFixed(1)}" x2="${xFim}" y2="${lt.y.toFixed(1)}"
                stroke="${lt.cor}" stroke-width="${lt.largura}" stroke-dasharray="${lt.dash}" />
              <path d="M${xFim},${lt.y.toFixed(1)} L${xFim + 6},${lt.yLabel.toFixed(1)}" stroke="${lt.cor}" stroke-width="1.2" opacity="0.7" fill="none" />
              <rect x="${xFim + 6}" y="${(lt.yLabel - 9.5).toFixed(1)}" width="${padRight - 10}" height="19" rx="4"
                fill="rgba(16, 22, 31, 0.94)" stroke="${lt.cor}" stroke-opacity="${lt.destaque ? '0.85' : '0.5'}" stroke-width="1" />
              <text x="${xFim + 11}" y="${(lt.yLabel + 3.5).toFixed(1)}" fill="${lt.cor}" class="vsvg-ceil-label ${lt.destaque ? 'is-bold' : ''}">${esc(labelTxt)}</text>
            </g>
          `;
        }).join('');
      } else if (modo === 'margem_bazin') {
        const yZero = yDe(0);
        if (yZero >= padTop && yZero <= yBasePlot) {
          referenciasSvg = `
            <line x1="${padLeft}" y1="${yZero.toFixed(1)}" x2="${padLeft + plotW}" y2="${yZero.toFixed(1)}"
              stroke="${ESTILO_TETOS.bazin.cor}" stroke-width="2.2" stroke-dasharray="9 5" />
            <text x="${padLeft + 8}" y="${Math.max(padTop + 12, yZero - 6).toFixed(1)}" fill="${ESTILO_TETOS.bazin.cor}" class="vsvg-ceil-label is-bold">Teto Bazin (0% margem)</text>
          `;
        }
      } else if (modo === 'variacao') {
        const yZero = yDe(0);
        if (yZero >= padTop && yZero <= yBasePlot) {
          referenciasSvg = `<line x1="${padLeft}" y1="${yZero.toFixed(1)}" x2="${padLeft + plotW}" y2="${yZero.toFixed(1)}" stroke="#3b495e" stroke-width="1.4" stroke-dasharray="4 4" />`;
        }
      }

      // Curvas dos ativos
      const areaPrincipalSvg = modo === 'preco' && ativosCmp.length === 0 && curvaPrincipal
        ? `<path d="${caminhoSvgArea(curvaPrincipal.xy, yBasePlot)}" fill="url(#${gradId})" />`
        : '';

      const linhasCurvasSvg = curvasPlot.map(c => {
        const d = caminhoSvgLinha(c.xy);
        if (!d) return '';
        const sw = c.principal ? 2.4 : 1.9;
        return `<path d="${d}" fill="none" stroke="${c.cor}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" />`;
      }).join('');

      const pontosCrosshairSvg = curvasPlot.map((c, idx) =>
        `<circle class="v-ch-dot" data-ch-idx="${idx}" cx="0" cy="0" r="${c.principal ? 4.5 : 3.8}" fill="${c.cor}" stroke="#0a0e14" stroke-width="1.8" style="display:none" />`
      ).join('');

      svgWrap.innerHTML = `
        <svg class="vsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gráfico histórico de preços e preços-teto">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
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
          <line class="v-crosshair" x1="0" y1="${padTop}" x2="0" y2="${yBasePlot}" stroke="#eef2f8" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 3" style="display:none" />
          ${pontosCrosshairSvg}
          <rect class="v-hit-area" x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent" />
        </svg>
      `;

      const svgEl = svgWrap.querySelector('svg');
      const chLine = svgEl.querySelector('.v-crosshair');
      const chDots = svgEl.querySelectorAll('.v-ch-dot');

      const atualizarHudPreco = (idx) => {
        const i = idx !== null && idx !== undefined ? idx : nPontos - 1;
        const dt = fmtDataBr(janela.datas[i]);
        const ehUltimo = idx === null || idx === undefined;

        if (ativosCmp.length === 0) {
          const p = curvaPrincipal.serieOriginal[i]?.preco;
          const mBaz = valido(tetoBazin) && valido(p) ? (tetoBazin - p) / tetoBazin : null;
          const mGra = valido(tetoGraham) && valido(p) ? (tetoGraham - p) / tetoGraham : null;
          const mGor = valido(tetoGordon) && valido(p) ? (tetoGordon - p) / tetoGordon : null;
          if (hudEl) {
            hudEl.innerHTML = `
              <span class="vhud-date mono">${ehUltimo ? `Última (${dt})` : dt}</span>
              <span class="vhud-metric">Cotação: <strong class="mono">${fmtReal(p)}</strong></span>
              ${valido(tetoBazin) ? `<span class="vhud-metric">vs. Bazin: <strong class="mono ${classeMargem(mBaz)}">${fmtPct(mBaz)}</strong></span>` : ''}
              ${valido(tetoGraham) ? `<span class="vhud-metric">vs. Graham: <strong class="mono ${classeMargem(mGra)}">${fmtPct(mGra)}</strong></span>` : ''}
              ${valido(tetoGordon) ? `<span class="vhud-metric">vs. Gordon: <strong class="mono ${classeMargem(mGor)}">${fmtPct(mGor)}</strong></span>` : ''}
            `;
          }
        } else {
          const itens = curvasPlot.map(c => {
            const p = c.serieOriginal[i]?.preco;
            const valModo = c.valores[i];
            const txtVal = modo === 'preco'
              ? fmtReal(p)
              : (valido(valModo) ? `${valModo > 0 ? '+' : ''}${valModo.toFixed(1)}% (${fmtReal(p)})` : `s/ Bazin (${fmtReal(p)})`);
            return `<span class="vhud-metric"><i class="dot" style="background:${c.cor}"></i><b>${esc(c.ativo.ticker)}</b>: <strong class="mono">${txtVal}</strong></span>`;
          }).join('');
          if (hudEl) {
            hudEl.innerHTML = `<span class="vhud-date mono">${ehUltimo ? `Última (${dt})` : dt}</span>${itens}`;
          }
        }
      };

      atualizarHudPreco(null);

      anexarInteracaoCrosshair(
        svgEl,
        { padLeft, plotW },
        nPontos,
        (idx) => {
          const x = xDe(idx);
          chLine.setAttribute('x1', x.toFixed(1));
          chLine.setAttribute('x2', x.toFixed(1));
          chLine.style.display = '';
          chDots.forEach((dot, cIdx) => {
            const pt = curvasPlot[cIdx]?.xy[idx];
            if (pt) {
              dot.setAttribute('cx', pt.x.toFixed(1));
              dot.setAttribute('cy', pt.y.toFixed(1));
              dot.style.display = '';
            } else {
              dot.style.display = 'none';
            }
          });
          atualizarHudPreco(idx);
        },
        () => {
          chLine.style.display = 'none';
          chDots.forEach(d => { d.style.display = 'none'; });
          atualizarHudPreco(null);
        }
      );
    }

    // Diagnóstico "Barato há muito tempo?"
    const diag = diagnosticarDescontoProlongado(principal, seriesPorTicker.get(principal.ticker) || []);
    if (trapEl) {
      const classeBox = diag.tipo === 'alerta'
        ? 'is-warn'
        : (diag.tipo === 'recente' ? 'is-good' : (diag.tipo === 'estrutural' ? 'is-info' : 'is-neutral'));
      const barraPct = valido(diag.pctAbaixo)
        ? `
          <div class="vtrap-meter-wrap">
            <div class="vtrap-meter-head">
              <span>Tempo abaixo do Teto Bazin (${ROTULO_PERIODO[visualState.periodo]})</span>
              <strong class="mono">${fmtPctSimples(diag.pctAbaixo, 0)}</strong>
            </div>
            <div class="vtrap-meter"><span style="width:${(diag.pctAbaixo * 100).toFixed(1)}%"></span></div>
          </div>`
        : '';

      trapEl.innerHTML = `
        <div class="vtrap-card ${classeBox}">
          <div class="vtrap-main">
            <div class="vtrap-title">${esc(diag.titulo)}</div>
            <p class="vtrap-desc">${esc(diag.resumo)}</p>
          </div>
          <div class="vtrap-stats">
            ${barraPct}
            <div class="vtrap-minmax mono">
              <span>Mín: <b>${fmtReal(diag.minPreco)}</b></span>
              <span>Méd: <b>${fmtReal(diag.medPreco)}</b></span>
              <span>Máx: <b>${fmtReal(diag.maxPreco)}</b></span>
            </div>
          </div>
        </div>
      `;
    }

    // Tabela / Cartões Comparativos de Preços-Teto quando há comparação (ou resumo multi-modelo)
    if (cmpTableWrap) {
      if (ativosCmp.length === 0) {
        cmpTableWrap.innerHTML = '';
      } else {
        const linhasHtml = todosAtivos.map((a, idx) => {
          const cor = idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length];
          const dAtivo = diagnosticarDescontoProlongado(a, seriesPorTicker.get(a.ticker) || []);
          const cAtivo = categoriaDoAtivo(a);
          const rotCat = cAtivo === 'besst' ? 'BESST' : (cAtivo === 'demais' ? 'Demais papéis' : 'Dividendos');
          const badgeDiag = dAtivo.tipo === 'alerta'
            ? `<span class="verdict verdict-amarelo">Barato há ${fmtDuracaoDias(dAtivo.diasStreak)}</span>`
            : (dAtivo.tipo === 'recente'
              ? `<span class="verdict verdict-verde">Desconto recente</span>`
              : (dAtivo.tipo === 'estrutural'
                ? `<span class="verdict verdict-verde">Recorrente (${fmtPctSimples(dAtivo.pctAbaixo, 0)})</span>`
                : (dAtivo.tipo === 'acima'
                  ? `<span class="verdict verdict-vermelho">Acima do teto</span>`
                  : `<span class="t-dim">Sem teto Bazin</span>`)));

          return `
            <tr class="vcmp-row" data-vfocus-ticker="${esc(a.ticker)}">
              <td data-label="Ativo">
                <span class="vcmp-ticker"><i class="dot" style="background:${cor}"></i><b class="mono">${esc(a.ticker)}</b> <small class="t-muted">${esc(rotCat)}</small></span>
              </td>
              <td class="num mono" data-label="Preço Atual">${fmtReal(a.preco)}</td>
              <td class="num mono" data-label="Teto Bazin">${a.bazin?.teto > 0 ? `${fmtReal(a.bazin.teto)} <small class="${classeMargem(a.bazin.margem_seguranca)}">(${fmtPct(a.bazin.margem_seguranca)})</small>` : '—'}</td>
              <td class="num mono" data-label="Teto Graham">${valido(a.graham) ? `${fmtReal(a.graham)} <small class="${classeMargem(a.margem_graham)}">(${fmtPct(a.margem_graham)})</small>` : '—'}</td>
              <td class="num mono" data-label="Teto Gordon">${valido(a.gordon) ? `${fmtReal(a.gordon)} <small class="${classeMargem(a.margem_gordon)}">(${fmtPct(a.margem_gordon)})</small>` : '—'}</td>
              <td class="num mono" data-label="Tempo < Bazin">${valido(dAtivo.pctAbaixo) ? fmtPctSimples(dAtivo.pctAbaixo, 0) : '—'}</td>
              <td data-label="Leitura Histórica">${badgeDiag}</td>
            </tr>
          `;
        }).join('');

        cmpTableWrap.innerHTML = `
          <div class="vsub-table-head">Comparativo de Preços-Teto e Tempo Descontado (${ROTULO_PERIODO[visualState.periodo]})</div>
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

  /* ---------- Renderização: Gráfico 2 (Simulador de Rendimento c/ Dividendos) ---------- */

  function renderizarSecaoSimulador(principal, ativosCmp, janela) {
    const kpiGrid = $('#sim-kpi-grid');
    const subEl = $('#sim-subtitle');
    const hudEl = $('#sim-chart-hud');
    const svgWrap = $('#sim-svg-wrap');
    const breakdownWrap = $('#sim-breakdown-wrap');
    if (!svgWrap || !kpiGrid) return;

    // Sincronizar controles visuais do simulador
    const capInput = $('#sim-capital-input');
    if (capInput && document.activeElement !== capInput) {
      capInput.value = String(visualState.simCapital);
    }
    document.querySelectorAll('#sim-capital-presets .chip-mini').forEach(b => {
      b.classList.toggle('is-on', Number(b.dataset.capital) === visualState.simCapital);
    });
    document.querySelectorAll('#sim-reinvest-group .seg-btn').forEach(b => {
      b.classList.toggle('is-active', (b.dataset.reinvest === '1') === visualState.simReinvestir);
    });
    const btnTax = $('#sim-net-jcp-btn');
    if (btnTax) {
      btnTax.classList.toggle('is-on', visualState.simLiquidoJcp);
      const dot = btnTax.querySelector('i');
      if (dot) dot.style.background = visualState.simLiquidoJcp ? 'var(--green)' : 'var(--dim)';
    }

    const todosAtivos = [principal, ...ativosCmp];
    const simulacoes = todosAtivos
      .map((a, idx) => ({
        cor: idx === 0 ? '#2fbf86' : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length],
        corLinhaMulti: idx === 0 ? COR_PRINCIPAL : PALETA_COMPARACAO[(idx - 1) % PALETA_COMPARACAO.length],
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
      subEl.textContent = `Simulação de ${fmtReal(visualState.simCapital)} em ${principal.ticker} de ${fmtDataBr(simMain.dataIni)} a ${fmtDataBr(simMain.dataFim)} (${visualState.simReinvestir ? 'reinvestindo proventos na data-com' : 'acumulando proventos em caixa'})`;
    }

    // 4 KPIs do Ativo Principal
    const sinalLucro = simMain.lucroTotal >= 0 ? '+' : '';
    kpiGrid.innerHTML = `
      <div class="kpi" style="--kpi-color: ${simMain.lucroTotal >= 0 ? 'var(--green)' : 'var(--red)'}">
        <div class="kpi-label">Patrimônio final (${esc(principal.ticker)})</div>
        <div class="kpi-value">${fmtReal(simMain.patrimonioFinal)}</div>
        <div class="kpi-foot ${simMain.lucroTotal >= 0 ? 't-green' : 't-red'}">${sinalLucro}${fmtReal(simMain.lucroTotal)} sobre ${fmtReal(simMain.capitalInicial)}</div>
      </div>
      <div class="kpi" style="--kpi-color: var(--accent)">
        <div class="kpi-label">Retorno total (c/ dividendos)</div>
        <div class="kpi-value ${simMain.retornoTotal >= 0 ? 't-green' : 't-red'}">${fmtPct(simMain.retornoTotal)}</div>
        <div class="kpi-foot">${valido(simMain.cagr) ? `Equivalente a ${fmtPct(simMain.cagr)} ao ano` : `Janela de ${ROTULO_PERIODO[visualState.periodo]}`}</div>
      </div>
      <div class="kpi" style="--kpi-color: var(--border-strong)">
        <div class="kpi-label">Apenas variação da cotação</div>
        <div class="kpi-value ${simMain.retornoCotacao >= 0 ? '' : 't-red'}">${fmtPct(simMain.retornoCotacao)}</div>
        <div class="kpi-foot">Sem proventos: ${fmtReal(simMain.patrimonioCotacaoFinal)}</div>
      </div>
      <div class="kpi" style="--kpi-color: var(--green)">
        <div class="kpi-label">Ganho gerado por proventos</div>
        <div class="kpi-value t-green">+${fmtReal(Math.max(0, simMain.efeitoProventosRS))}</div>
        <div class="kpi-foot">YoC acum.: ${fmtPctSimples(simMain.yocAcumulado)} · ${simMain.qtdEventos} ${simMain.qtdEventos === 1 ? 'evento' : 'eventos'} (${simMain.acoesIniciais.toFixed(0)} → ${simMain.acoesFinais.toFixed(0)} ações)</div>
      </div>
    `;

    // Gráfico SVG de Evolução do Patrimônio
    const larguraContainer = Math.max(300, svgWrap.clientWidth || 860);
    const ehMobile = larguraContainer < 600;
    const W = larguraContainer;
    const H = ehMobile ? 275 : 320;
    const padLeft = ehMobile ? 62 : 76;
    const padRight = ehMobile ? 16 : 24;
    const padTop = 18;
    const padBottom = 32;
    const plotW = Math.max(120, W - padLeft - padRight);
    const plotH = H - padTop - padBottom;
    const yBasePlot = padTop + plotH;

    const nPontos = simMain.curva.length;
    const modoMulti = simulacoes.length > 1;

    const valoresY = [visualState.simCapital];
    if (!modoMulti) {
      simMain.curva.forEach(p => {
        valoresY.push(p.patTotal, p.patCotacao);
      });
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
        <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" stroke="#1d2632" stroke-width="1" />
        <text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="vsvg-axis-text">${esc(fmtMoedaEixo(tv))}</text>
      `;
    }).join('');

    const qtdTicksX = ehMobile ? 4 : 7;
    const ticksX = [];
    for (let t = 0; t < qtdTicksX; t++) {
      const idx = Math.round((t / (qtdTicksX - 1)) * (nPontos - 1));
      if (!ticksX.includes(idx)) ticksX.push(idx);
    }
    const ticksXSvg = ticksX.map(idx => {
      const x = xDe(idx);
      return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vsvg-axis-text">${esc(fmtDataCurta(simMain.curva[idx].data, visualState.periodo !== '6m'))}</text>`;
    }).join('');

    const yAporte = yDe(visualState.simCapital);
    const linhaAporteSvg = `<line x1="${padLeft}" y1="${yAporte.toFixed(1)}" x2="${padLeft + plotW}" y2="${yAporte.toFixed(1)}" stroke="#3b495e" stroke-width="1.2" stroke-dasharray="3 4" />`;

    const xyCotacaoMain = simMain.curva.map((p, i) => ({ x: xDe(i), y: yDe(p.patCotacao) }));
    const linhaCotacaoPuraSvg = `<path d="${caminhoSvgLinha(xyCotacaoMain)}" fill="none" stroke="#8a95a6" stroke-width="1.6" stroke-dasharray="5 4" />`;

    let curvasSimSvg = '';
    let marcadoresProvSvg = '';
    const seriesInterativas = [];

    if (!modoMulti) {
      const xyTotal = simMain.curva.map((p, i) => ({ x: xDe(i), y: yDe(p.patTotal) }));
      curvasSimSvg = `
        <path d="${caminhoSvgArea(xyTotal, yBasePlot)}" fill="url(#grad-sim-total)" />
        ${linhaCotacaoPuraSvg}
        <path d="${caminhoSvgLinha(xyTotal)}" fill="none" stroke="#2fbf86" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      `;
      marcadoresProvSvg = simMain.curva
        .map((p, i) => p.provSemanaRS > 0
          ? `<circle cx="${xDe(i).toFixed(1)}" cy="${yDe(p.patTotal).toFixed(1)}" r="3.2" fill="#2fbf86" stroke="#0a0e14" stroke-width="1.2" />`
          : '')
        .join('');
      seriesInterativas.push({ cor: '#2fbf86', xy: xyTotal }, { cor: '#8a95a6', xy: xyCotacaoMain });
    } else {
      curvasSimSvg = linhaCotacaoPuraSvg + simulacoes.map(s => {
        const len = s.sim.curva.length;
        const xy = s.sim.curva.map((p, i) => ({ x: xDe(i, len), y: yDe(p.patTotal) }));
        seriesInterativas.push({ cor: s.corLinhaMulti, xy, ticker: s.sim.ativo.ticker });
        return `<path d="${caminhoSvgLinha(xy)}" fill="none" stroke="${s.corLinhaMulti}" stroke-width="${s.principal ? 2.5 : 1.9}" stroke-linejoin="round" stroke-linecap="round" />`;
      }).join('');
    }

    const chDotsSvg = seriesInterativas.map((s, idx) =>
      `<circle class="v-sim-dot" data-sim-idx="${idx}" cx="0" cy="0" r="4" fill="${s.cor}" stroke="#0a0e14" stroke-width="1.6" style="display:none" />`
    ).join('');

    svgWrap.innerHTML = `
      <svg class="vsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Evolução do patrimônio simulado com dividendos">
        <defs>
          <linearGradient id="grad-sim-total" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2fbf86" stop-opacity="0.24" />
            <stop offset="100%" stop-color="#2fbf86" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${gradeSvg}
        ${linhaAporteSvg}
        ${curvasSimSvg}
        ${marcadoresProvSvg}
        ${ticksXSvg}
        <line class="v-crosshair" x1="0" y1="${padTop}" x2="0" y2="${yBasePlot}" stroke="#eef2f8" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 3" style="display:none" />
        ${chDotsSvg}
        <rect class="v-hit-area" x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent" />
      </svg>
    `;

    const svgEl = svgWrap.querySelector('svg');
    const chLine = svgEl.querySelector('.v-crosshair');
    const chDots = svgEl.querySelectorAll('.v-sim-dot');

    const atualizarHudSim = (idx) => {
      const i = idx !== null && idx !== undefined ? idx : nPontos - 1;
      const pt = simMain.curva[i];
      const dt = fmtDataBr(pt.data);
      const ehUltimo = idx === null || idx === undefined;

      if (!modoMulti) {
        const retData = (pt.patTotal - visualState.simCapital) / visualState.simCapital;
        if (hudEl) {
          hudEl.innerHTML = `
            <span class="vhud-date mono">${ehUltimo ? `Final (${dt})` : dt}</span>
            <span class="vhud-metric"><i class="dot" style="background:#2fbf86"></i>Com dividendos: <strong class="mono t-green">${fmtReal(pt.patTotal)} (${fmtPct(retData)})</strong></span>
            <span class="vhud-metric"><i class="dot" style="background:#8a95a6"></i>Só cotação: <strong class="mono">${fmtReal(pt.patCotacao)}</strong></span>
            <span class="vhud-metric">Proventos recebidos: <strong class="mono">${fmtReal(pt.proventosAcumRS)}</strong></span>
          `;
        }
      } else {
        const itens = simulacoes.map(s => {
          const idxProp = Math.min(s.sim.curva.length - 1, Math.round((i / Math.max(1, nPontos - 1)) * (s.sim.curva.length - 1)));
          const pSim = s.sim.curva[idxProp];
          const ret = (pSim.patTotal - visualState.simCapital) / visualState.simCapital;
          return `<span class="vhud-metric"><i class="dot" style="background:${s.corLinhaMulti}"></i><b>${esc(s.sim.ativo.ticker)}</b>: <strong class="mono">${fmtReal(pSim.patTotal)} (${fmtPct(ret)})</strong></span>`;
        }).join('');
        if (hudEl) {
          hudEl.innerHTML = `<span class="vhud-date mono">${ehUltimo ? `Final (${dt})` : dt}</span>${itens}`;
        }
      }
    };

    atualizarHudSim(null);

    anexarInteracaoCrosshair(
      svgEl,
      { padLeft, plotW },
      nPontos,
      (idx) => {
        const x = xDe(idx);
        chLine.setAttribute('x1', x.toFixed(1));
        chLine.setAttribute('x2', x.toFixed(1));
        chLine.style.display = '';
        chDots.forEach((dot, sIdx) => {
          const serie = seriesInterativas[sIdx];
          const idxAlvo = Math.min(serie.xy.length - 1, Math.round((idx / Math.max(1, nPontos - 1)) * (serie.xy.length - 1)));
          const pt = serie.xy[idxAlvo];
          if (pt) {
            dot.setAttribute('cx', pt.x.toFixed(1));
            dot.setAttribute('cy', pt.y.toFixed(1));
            dot.style.display = '';
          }
        });
        atualizarHudSim(idx);
      },
      () => {
        chLine.style.display = 'none';
        chDots.forEach(d => { d.style.display = 'none'; });
        atualizarHudSim(null);
      }
    );

    // Tabela de Decomposição & Ranking entre os papéis simulados
    if (breakdownWrap) {
      const ordenadas = [...simulacoes].sort((a, b) => b.sim.patrimonioFinal - a.sim.patrimonioFinal);
      const linhas = ordenadas.map(item => {
        const s = item.sim;
        const cor = modoMulti ? item.corLinhaMulti : '#2fbf86';
        return `
          <tr class="vcmp-row" data-vfocus-ticker="${esc(s.ativo.ticker)}">
            <td data-label="Ativo"><span class="vcmp-ticker"><i class="dot" style="background:${cor}"></i><b class="mono">${esc(s.ativo.ticker)}</b></span></td>
            <td class="num mono" data-label="Preço Ini → Fim">${fmtReal(s.precoIni)} → ${fmtReal(s.precoFim)}</td>
            <td class="num mono ${s.retornoCotacao >= 0 ? '' : 't-red'}" data-label="Só Cotação">${fmtPct(s.retornoCotacao)}</td>
            <td class="num mono t-green" data-label="Proventos Recebidos">${fmtReal(s.proventosRecebidosRS)} <small class="t-muted">(${s.qtdEventos}x)</small></td>
            <td class="num mono" data-label="Ações (Ini → Fim)">${s.acoesIniciais.toFixed(1)} → ${s.acoesFinais.toFixed(1)}</td>
            <td class="num mono" data-label="Patrimônio Final"><strong>${fmtReal(s.patrimonioFinal)}</strong></td>
            <td class="num mono ${s.retornoTotal >= 0 ? 't-green' : 't-red'}" data-label="Retorno Total">
              <strong>${fmtPct(s.retornoTotal)}</strong>
              ${valido(s.cagr) ? `<small class="t-muted"> (${fmtPct(s.cagr)} a.a.)</small>` : ''}
            </td>
          </tr>
        `;
      }).join('');

      breakdownWrap.innerHTML = `
        <div class="vsub-table-head">Resumo da Simulação · Aporte de ${fmtReal(visualState.simCapital)} (${ROTULO_PERIODO[visualState.periodo]})</div>
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

  /* ---------- Orquestração da Aba Visual ---------- */

  function renderizarVisaoGrafica() {
    if (visualState.aba !== 'visual') return;
    if (!painelState.payload || !painelState.universo.length) return;

    const principal = garantirAtivosValidos();
    if (!principal) return;

    const mapa = mapaUniverso();
    const ativosCmp = visualState.comparados.map(t => mapa.get(t)).filter(Boolean);
    const janela = obterDatasJanela();

    renderizarControlesTopo(principal);
    renderizarSecaoPrecosTetos(principal, ativosCmp, janela);
    renderizarSecaoSimulador(principal, ativosCmp, janela);
  }

  function definirAbaPainel(aba, tickerFoco) {
    visualState.aba = aba === 'visual' ? 'visual' : 'tabela';
    if (tickerFoco) {
      const limpo = String(tickerFoco).trim().toUpperCase();
      if (mapaUniverso().has(limpo)) {
        visualState.tickerPrincipal = limpo;
        visualState.comparados = visualState.comparados.filter(t => t !== limpo);
        salvarPrefsVisual();
      }
    }

    const ehVisual = visualState.aba === 'visual';
    $('#tab-btn-tabela')?.classList.toggle('is-active', !ehVisual);
    $('#tab-btn-tabela')?.setAttribute('aria-selected', String(!ehVisual));
    $('#tab-btn-visual')?.classList.toggle('is-active', ehVisual);
    $('#tab-btn-visual')?.setAttribute('aria-selected', String(ehVisual));

    $('#view-tabela')?.classList.toggle('is-hidden', ehVisual);
    $('#view-visual')?.classList.toggle('is-hidden', !ehVisual);

    if (ehVisual) {
      renderizarVisaoGrafica();
      if (tickerFoco) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function adicionarComparacao(ticker) {
    const clean = String(ticker || '').trim().toUpperCase();
    if (!clean || !mapaUniverso().has(clean)) return;
    if (clean === visualState.tickerPrincipal) return;
    if (visualState.comparados.includes(clean)) return;
    if (visualState.comparados.length >= 4) return;
    visualState.comparados.push(clean);
    salvarPrefsVisual();
    renderizarVisaoGrafica();
  }

  function bindEventosVisaoGrafica() {
    $('#main-view-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view-tab]');
      if (btn) definirAbaPainel(btn.dataset.viewTab);
    });

    $('#visual-main-select')?.addEventListener('change', (e) => {
      const val = String(e.target.value || '').toUpperCase();
      if (mapaUniverso().has(val)) {
        visualState.tickerPrincipal = val;
        visualState.comparados = visualState.comparados.filter(t => t !== val);
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    const quickInput = $('#visual-search-input');
    quickInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = (quickInput.value || '').trim().toUpperCase();
      if (!q) return;
      const mapa = mapaUniverso();
      let achado = mapa.get(q);
      if (!achado) {
        achado = painelState.universo.find(a =>
          a.ticker.toUpperCase().startsWith(q) || (a.empresa || '').toUpperCase().includes(q)
        );
      }
      if (achado) {
        visualState.tickerPrincipal = achado.ticker.toUpperCase();
        visualState.comparados = visualState.comparados.filter(t => t !== visualState.tickerPrincipal);
        quickInput.value = '';
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    $('#visual-quick-pills')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-vquick-ticker]');
      if (!chip) return;
      const t = chip.dataset.vquickTicker.toUpperCase();
      visualState.tickerPrincipal = t;
      visualState.comparados = visualState.comparados.filter(x => x !== t);
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    $('#visual-compare-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      e.target.value = '';
      if (val) adicionarComparacao(val);
    });

    $('#visual-compare-chips')?.addEventListener('click', (e) => {
      const rem = e.target.closest('[data-vremove-cmp]');
      if (rem) {
        const alvo = rem.dataset.vremoveCmp.toUpperCase();
        visualState.comparados = visualState.comparados.filter(t => t !== alvo);
        salvarPrefsVisual();
        renderizarVisaoGrafica();
        return;
      }
      if (e.target.closest('#btn-clear-comparisons')) {
        visualState.comparados = [];
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    $('#visual-peer-suggestions')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vadd-peer]');
      if (b) adicionarComparacao(b.dataset.vaddPeer);
    });

    $('#visual-period-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vperiod]');
      if (b && DIAS_PERIODO[b.dataset.vperiod]) {
        visualState.periodo = b.dataset.vperiod;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    $('#visual-chart-mode')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vmode]');
      if (b) {
        visualState.modoPreco = b.dataset.vmode;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    $('#visual-ceiling-legend')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vtoggle-ceil]');
      if (!b || b.disabled) return;
      const k = b.dataset.vtoggleCeil;
      if (k in visualState.tetosVisiveis) {
        visualState.tetosVisiveis[k] = !visualState.tetosVisiveis[k];
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    $('#visual-asset-header')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vopen-detail]');
      if (b) abrirDetalhe(b.dataset.vopenDetail);
    });

    // Clicar em qualquer linha das tabelas comparativas pode torná-la o ativo principal
    const focarAoClicarLinha = (e) => {
      const tr = e.target.closest('[data-vfocus-ticker]');
      if (!tr) return;
      const novo = tr.dataset.vfocusTicker.toUpperCase();
      if (novo && novo !== visualState.tickerPrincipal && mapaUniverso().has(novo)) {
        const antigo = visualState.tickerPrincipal;
        visualState.tickerPrincipal = novo;
        visualState.comparados = [antigo, ...visualState.comparados.filter(t => t !== novo)].slice(0, 4);
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    };
    $('#visual-compare-ceilings-wrap')?.addEventListener('click', focarAoClicarLinha);
    $('#sim-breakdown-wrap')?.addEventListener('click', focarAoClicarLinha);

    // Controles do Simulador
    $('#sim-capital-input')?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (Number.isFinite(val) && val >= 50) {
        visualState.simCapital = val;
        salvarPrefsVisual();
        renderizarVisaoGrafica();
      }
    });

    $('#sim-capital-presets')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-capital]');
      if (!b) return;
      visualState.simCapital = Number(b.dataset.capital);
      const inp = $('#sim-capital-input');
      if (inp) inp.value = String(visualState.simCapital);
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    $('#sim-reinvest-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-reinvest]');
      if (!b) return;
      visualState.simReinvestir = b.dataset.reinvest === '1';
      salvarPrefsVisual();
      renderizarVisaoGrafica();
    });

    $('#sim-net-jcp-btn')?.addEventListener('click', () => {
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

  window.addEventListener('DOMContentLoaded', bindEventosVisaoGrafica);
})();
