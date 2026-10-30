/* Matriz Desconto × Qualidade & Calendário de Dividendos (index.html)
 * Somente leitura e apresentação dos dados de ./data/valuation.json:
 * - Margens (Bazin/Graham), ROE/ROIC, Score de Sustentabilidade Anti-Cilada e
 *   Agenda de Proventos (próxima data-com, último pago, pagamentos agendados e
 *   sazonalidade 5 anos).
 */

(function () {
  'use strict';

  const STORAGE_KEY_MATRIZ_CAL = 'painel_valuation_matriz_cal_prefs';

  const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MESES_NOMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const QUADRANTES_META = {
    ouro: {
      id: 'ouro',
      titulo: 'Quadrante Ouro',
      sub: 'Descontadas & Alta Qualidade',
      cor: '#10b981',
      classe: 'is-ouro'
    },
    premio: {
      id: 'premio',
      titulo: 'Qualidade Cara',
      sub: 'Alta Rentabilidade · Acima do Teto',
      cor: '#3b82f6',
      classe: 'is-premio'
    },
    atencao: {
      id: 'atencao',
      titulo: 'Desconto c/ Atenção',
      sub: 'Abaixo do Teto · Rentab. Modesta',
      cor: '#f59e0b',
      classe: 'is-atencao'
    },
    evitar: {
      id: 'evitar',
      titulo: 'Caras & Baixo Retorno',
      sub: 'Acima do Teto · Baixa Rentabilidade',
      cor: '#ef4444',
      classe: 'is-evitar'
    }
  };

  /* ---------- Helpers Defensivos ---------- */

  const qs = (sel) => document.querySelector(sel);

  function escH(str) {
    if (typeof window.esc === 'function') return window.esc(str);
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function numOk(v) {
    return v !== null && v !== undefined && typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
  }

  function fReal(v, casas = 2) {
    if (!numOk(v)) return '—';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }

  function fRealProvento(v) {
    if (!numOk(v)) return '—';
    const casas = v < 0.1 ? 4 : 2;
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
  }

  function fPct(v, casas = 1) {
    if (!numOk(v)) return '—';
    const pct = Math.abs(v * 100) < 0.05 && casas === 0 ? 0 : v * 100;
    const sinal = pct > 0 ? '+' : '';
    return sinal + pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  }

  function fPctSimples(v, casas = 1) {
    if (!numOk(v)) return '—';
    return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  }

  function fDataIso(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    const p = iso.slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return `${p[2]}/${p[1]}/${p[0]}`;
  }

  function fDataCurtaIso(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    const p = iso.slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return `${p[2]}/${p[1]}/${p[0].slice(2)}`;
  }

  function hojeIsoB3() {
    const agora = new Date(Date.now() - 3 * 3600 * 1000);
    return agora.toISOString().slice(0, 10);
  }

  function parseIsoLocalDays(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return null;
    const partes = isoStr.slice(0, 10).split('-');
    if (partes.length !== 3) return null;
    const dt = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]), 12, 0, 0);
    if (Number.isNaN(dt.getTime())) return null;
    return Math.round(dt.getTime() / 86400000);
  }

  function diasEntreIso(isoAlvo, isoBase) {
    const dAlvo = parseIsoLocalDays(isoAlvo);
    const dBase = parseIsoLocalDays(isoBase);
    if (dAlvo === null || dBase === null) return null;
    return dAlvo - dBase;
  }

  function rotuloContagemDias(dias) {
    if (dias === null) return '';
    if (dias === 0) return 'Hoje';
    if (dias === 1) return 'Amanhã';
    if (dias > 1) return `em ${dias} dias`;
    if (dias === -1) return 'Ontem';
    return `há ${Math.abs(dias)}d`;
  }

  function rotuloTipoEvento(tipo) {
    const t = String(tipo || '').toLowerCase();
    if (t === 'jcp') return 'JCP';
    if (t === 'dividendo') return 'Dividendo';
    if (t === 'misto') return 'Div. + JCP';
    if (t === 'extraordinario') return 'Extraord.';
    return tipo ? String(tipo) : 'Provento';
  }

  function obterCat(a) {
    if (typeof window.categoriaDoAtivo === 'function') {
      try { return window.categoriaDoAtivo(a); } catch (_) { /* fallback */ }
    }
    if (!a) return 'dividendos';
    if (a.categoria === 'demais') return 'demais';
    if (a.besst) return 'besst';
    return 'dividendos';
  }

  function ehBancoSetor(setor) {
    return String(setor || '').trim().toLowerCase().startsWith('banco');
  }

  function obterSustentabilidadeAtivo(a) {
    if (!a) return { nota: 0, score: 0, rotulo: 'Sem Divid.', nivel: 'sem_dividendo', pilares: [] };
    if (a.sustentabilidade && numOk(a.sustentabilidade.nota)) {
      return a.sustentabilidade;
    }
    if (typeof window.calcularScoreSustentabilidade === 'function') {
      const s = window.calcularScoreSustentabilidade(a);
      if (s) {
        const dpa5a = a.bazin && numOk(a.bazin.dpa_medio_5a) ? a.bazin.dpa_medio_5a : 0;
        const temHist = Array.isArray(a.proventos_historico) && a.proventos_historico.length > 0;
        if (dpa5a <= 0 && !temHist) {
          return { nota: 0, score: 0, rotulo: 'Sem Divid.', nivel: 'sem_dividendo', pilares: [] };
        }
        const nivel = s.score >= 75 ? 'forte' : (s.score >= 50 ? 'moderado' : 'alerta');
        return {
          nota: s.score,
          score: s.score,
          rotulo: s.rotulo,
          nivel,
          pilares: [
            { nome: 'Regularidade (5a)', detalhe: `${s.pilares.regularidade}/25` },
            { nome: 'Payout / Cobertura', detalhe: `${s.pilares.cobertura}/25` },
            { nome: 'ROE & Alavancagem', detalhe: `${s.pilares.alavancagemRoe}/25` },
            { nome: 'Tendência DPA', detalhe: `${s.pilares.tendenciaDpa}/25` }
          ]
        };
      }
    }
    return { nota: 50, score: 50, rotulo: 'Intermediário', nivel: 'moderado', pilares: [] };
  }

  function htmlSeloSustentabilidade(a, compacto = false) {
    const s = obterSustentabilidadeAtivo(a);
    if (!s || s.nivel === 'sem_dividendo') {
      return `<span class="sust-badge sust-nd" data-tip="Ativo sem distribuição recorrente nos últimos 5 anos fechados">Sem Divid.</span>`;
    }
    const cls = s.nivel === 'forte' ? 'sust-forte' : (s.nivel === 'moderado' ? 'sust-mod' : 'sust-alerta');
    const resumo = Array.isArray(s.pilares) ? s.pilares.map(p => `${p.nome}: ${p.detalhe}`).join(' · ') : '';
    const txt = compacto ? `${s.nota}` : `${s.nota} · ${s.rotulo}`;
    return `<span class="sust-badge ${cls}" data-tip="${escH(`Score Anti-Cilada ${s.nota}/100 (${s.rotulo}) — ${resumo}`)}">${escH(txt)}</span>`;
  }

  function enriquecerAgendaAtivo(a, hojeIso) {
    if (!a) return { agenda_anunciada: [], mapa_sazonal_5a: {}, meses_habituais_dividendo: [], proxima_data_com: null, proximo_pagamento: null, ultimo_provento_pago: null };
    if (Array.isArray(a.agenda_anunciada) && a.mapa_sazonal_5a) {
      return a;
    }
    const hist = Array.isArray(a.proventos_historico) ? a.proventos_historico : [];
    const anoAtual = Number(hojeIso.slice(0, 4)) || 2026;
    const anoMinSazonal = anoAtual - 5;
    const anosPorMes = {};
    for (let m = 1; m <= 12; m += 1) anosPorMes[String(m)] = new Set();

    const agenda = [];
    const pagos = [];

    hist.forEach(ev => {
      if (!ev || !ev.data_com || !(Number(ev.valor) > 0)) return;
      const dc = String(ev.data_com).slice(0, 10);
      const dp = ev.data_pagamento ? String(ev.data_pagamento).slice(0, 10) : null;
      const anoEv = Number(dc.slice(0, 4));
      const mesEv = Number(dc.slice(5, 7));
      if (anoEv >= anoMinSazonal && anoEv < anoAtual && mesEv >= 1 && mesEv <= 12) {
        anosPorMes[String(mesEv)].add(anoEv);
      }

      if (dc >= hojeIso) {
        agenda.push({
          data_com: dc,
          data_pagamento: dp,
          valor: Number(ev.valor),
          tipo: String(ev.tipo || 'dividendo').toLowerCase(),
          status: 'anunciado'
        });
      } else if (dp && dp >= hojeIso) {
        agenda.push({
          data_com: dc,
          data_pagamento: dp,
          valor: Number(ev.valor),
          tipo: String(ev.tipo || 'dividendo').toLowerCase(),
          status: 'a_pagar'
        });
      } else {
        pagos.push({
          data_com: dc,
          data_pagamento: dp,
          valor: Number(ev.valor),
          tipo: String(ev.tipo || 'dividendo').toLowerCase(),
          status: 'pago'
        });
      }
    });

    const mapa_sazonal_5a = {};
    const meses_habituais_dividendo = [];
    for (let m = 1; m <= 12; m += 1) {
      const cnt = Math.min(5, anosPorMes[String(m)].size);
      mapa_sazonal_5a[String(m)] = cnt;
      if (cnt >= 2) meses_habituais_dividendo.push(m);
    }

    agenda.sort((x, y) => x.data_com.localeCompare(y.data_com));
    pagos.sort((x, y) => (y.data_pagamento || y.data_com).localeCompare(x.data_pagamento || x.data_com));

    const abertas = agenda.filter(e => e.status === 'anunciado' && e.data_com >= hojeIso);
    const aPagar = agenda.filter(e => e.data_pagamento && e.data_pagamento >= hojeIso)
      .sort((x, y) => x.data_pagamento.localeCompare(y.data_pagamento));

    return {
      ...a,
      agenda_anunciada: agenda,
      mapa_sazonal_5a,
      meses_habituais_dividendo,
      proxima_data_com: abertas[0] || null,
      proximo_pagamento: aPagar[0] || null,
      ultimo_provento_pago: pagos[0] || null
    };
  }

  function lerPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MATRIZ_CAL);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function salvarPrefs() {
    try {
      localStorage.setItem(STORAGE_KEY_MATRIZ_CAL, JSON.stringify({
        matrizEscopo: state.matrizEscopo,
        matrizX: state.matrizX,
        matrizY: state.matrizY,
        matrizSemCilada: state.matrizSemCilada,
        matrizQuadrante: state.matrizQuadrante,
        calEscopo: state.calEscopo,
        calModoPgto: state.calModoPgto
      }));
    } catch (_) { /* modo privado */ }
  }

  const prefsSalvas = lerPrefs();
  const state = {
    matrizEscopo: prefsSalvas.matrizEscopo || 'painel',
    matrizX: prefsSalvas.matrizX || 'bazin',
    matrizY: prefsSalvas.matrizY || 'roe',
    matrizSemCilada: Boolean(prefsSalvas.matrizSemCilada),
    matrizQuadrante: prefsSalvas.matrizQuadrante || 'todos',
    matrizBusca: '',
    matrizPontosRender: [],
    matrizHoverTicker: null,

    calEscopo: prefsSalvas.calEscopo || 'painel',
    calMes: 0, // 0 = Todos os meses, 1..12 = Jan..Dez
    calModoPgto: prefsSalvas.calModoPgto || 'agendados', // 'agendados' | 'pagos'
    calBusca: ''
  };

  function obterUniverso() {
    if (typeof painelState !== 'undefined' && Array.isArray(painelState.universo) && painelState.universo.length) {
      return painelState.universo;
    }
    if (window.VALUATION_DATA && Array.isArray(window.VALUATION_DATA.ativos)) {
      return window.VALUATION_DATA.ativos;
    }
    return [];
  }

  function obterSelecionadosSet() {
    if (typeof window.obterTickersPainelAtivo === 'function') {
      const lista = window.obterTickersPainelAtivo();
      if (Array.isArray(lista) && lista.length) {
        return new Set(lista.map(t => String(t).toUpperCase()));
      }
    }
    const arr = (typeof painelState !== 'undefined' && Array.isArray(painelState.selecionados))
      ? painelState.selecionados
      : [];
    return new Set(arr.map(t => String(t).toUpperCase()));
  }

  function filtrarPorEscopo(escopo) {
    const univ = obterUniverso();
    if (!univ.length) return { lista: [], usouFallbackTodos: false };
    const selSet = obterSelecionadosSet();

    if (escopo === 'painel') {
      if (selSet.size > 0) {
        return {
          lista: univ.filter(a => selSet.has(a.ticker.toUpperCase())),
          usouFallbackTodos: false
        };
      }
      return {
        lista: univ.filter(a => a.painel_padrao !== false),
        usouFallbackTodos: false
      };
    }
    if (escopo === 'besst') {
      return { lista: univ.filter(a => Boolean(a.besst) || obterCat(a) === 'besst'), usouFallbackTodos: false };
    }
    if (escopo === 'dividendos') {
      return { lista: univ.filter(a => obterCat(a) !== 'demais'), usouFallbackTodos: false };
    }
    if (escopo === 'demais') {
      return { lista: univ.filter(a => obterCat(a) === 'demais' || a.painel_padrao === false), usouFallbackTodos: false };
    }
    return { lista: univ, usouFallbackTodos: false };
  }

  /* ==========================================================================
   * ABA 3: MATRIZ DESCONTO × QUALIDADE
   * ========================================================================== */

  function extrairMetricasMatriz(a) {
    const f = a.fundamentos || {};
    const mBazin = a.bazin ? (numOk(a.bazin.margem) ? a.bazin.margem : a.bazin.margem_seguranca) : null;
    const tBazin = a.bazin ? (numOk(a.bazin.preco_teto) ? a.bazin.preco_teto : a.bazin.teto) : null;
    const valX = state.matrizX === 'graham' ? a.margem_graham : mBazin;
    const tetoRef = state.matrizX === 'graham' ? a.graham : tBazin;
    let valY = null;
    if (state.matrizY === 'roic') {
      valY = ehBancoSetor(a.setor) ? null : f.roic;
    } else {
      valY = f.roe;
    }
    return { valX, valY, tetoRef };
  }

  function limiarQualidadeY() {
    return state.matrizY === 'roic' ? 0.12 : 0.15;
  }

  function classificarQuadrante(x, y, refY) {
    if (x >= 0 && y >= refY) return 'ouro';
    if (x < 0 && y >= refY) return 'premio';
    if (x >= 0 && y < refY) return 'atencao';
    return 'evitar';
  }

  function vereditoFactualMargem(margem) {
    if (!numOk(margem)) return '● Sem teto';
    if (margem >= 0.15) return '▲ Abaixo do teto';
    if (margem >= 0) return '● Próximo do teto';
    return '▼ Acima do teto';
  }

  function sincronizarControlesMatriz() {
    document.querySelectorAll('#matriz-scope-group [data-mscope]').forEach(b => {
      const on = b.dataset.mscope === state.matrizEscopo;
      b.classList.toggle('is-active', on);
      b.classList.toggle('active', on);
    });
    document.querySelectorAll('#matriz-xaxis-group [data-mx]').forEach(b => {
      const on = b.dataset.mx === state.matrizX;
      b.classList.toggle('is-active', on);
      b.classList.toggle('active', on);
    });
    document.querySelectorAll('#matriz-yaxis-group [data-my]').forEach(b => {
      const on = b.dataset.my === state.matrizY;
      b.classList.toggle('is-active', on);
      b.classList.toggle('active', on);
    });
    const trapBtn = qs('#matriz-notrap-btn');
    if (trapBtn) {
      trapBtn.classList.toggle('is-on', state.matrizSemCilada);
      trapBtn.classList.toggle('active', state.matrizSemCilada);
      trapBtn.setAttribute('aria-pressed', state.matrizSemCilada ? 'true' : 'false');
    }
  }

  function renderizarHudMatriz(ponto, totalPlotados, excluidos) {
    const hud = qs('#matriz-hud');
    if (!hud) return;
    const nomeX = state.matrizX === 'graham' ? 'Margem vs. Graham' : 'Margem Bazin';
    const nomeY = state.matrizY === 'roic' ? 'ROIC' : 'ROE';

    if (!ponto) {
      hud.classList.remove('vhud-floating');
      const refY = limiarQualidadeY();
      hud.innerHTML = `
        <span class="vhud-date">${totalPlotados} papéis plotados</span>
        <span class="vhud-metric">Eixo X: <strong>${nomeX}</strong> (Corte = 0%)</span>
        <span class="vhud-metric">Eixo Y: <strong>${nomeY}</strong> (Corte = ${fPctSimples(refY, 0)})</span>
        ${excluidos > 0 ? `<span class="t-dim">· ${excluidos} fora (sem ${state.matrizX === 'graham' ? 'teto Graham' : 'DPA/teto Bazin'} ou ${nomeY})</span>` : ''}
        <span class="t-dim">Passe o cursor, navegue com Tab ou clique em um ponto para abrir o Raio-X</span>
      `;
      return;
    }

    const a = ponto.ativo;
    const sust = ponto.sust || obterSustentabilidadeAtivo(a);
    const verTxt = vereditoFactualMargem(ponto.valX);

    hud.innerHTML = `
      <span class="vhud-date mono">${escH(a.ticker)}</span>
      <span class="vhud-metric"><strong>${escH(a.empresa || a.setor)}</strong></span>
      <span class="vhud-metric">${nomeX}: <strong class="${ponto.valX >= 0 ? 't-green' : 't-red'} mono">${fPct(ponto.valX)}</strong> (${escH(verTxt)})</span>
      <span class="vhud-metric">${nomeY}: <strong class="mono">${fPctSimples(ponto.valY)}</strong></span>
      <span class="vhud-metric">Anti-Cilada: <strong class="mono">${sust.nota}/100 (${escH(sust.rotulo)})</strong></span>
    `;
  }

  function renderizarMatrizValuation() {
    const wrapSvg = qs('#matriz-svg-wrap');
    const gridQuad = qs('#matriz-quadrants-grid');
    const wrapTable = qs('#matriz-table-wrap');
    if (!wrapSvg || !gridQuad || !wrapTable) return;

    sincronizarControlesMatriz();

    const { lista: baseEscopo, usouFallbackTodos } = filtrarPorEscopo(state.matrizEscopo);
    const refY = limiarQualidadeY();
    const qBusca = state.matrizBusca.trim().toLowerCase();

    let excluidosSemDados = 0;
    const pontos = [];

    baseEscopo.forEach(a => {
      const sust = obterSustentabilidadeAtivo(a);
      if (state.matrizSemCilada && (sust.nivel === 'alerta' || sust.nota < 50)) {
        return;
      }
      const { valX, valY, tetoRef } = extrairMetricasMatriz(a);
      if (!numOk(valX) || !numOk(valY)) {
        excluidosSemDados += 1;
        return;
      }
      const quadrante = classificarQuadrante(valX, valY, refY);
      const matchBusca = Boolean(qBusca) && (
        a.ticker.toLowerCase().includes(qBusca)
        || (a.empresa || '').toLowerCase().includes(qBusca)
        || (a.setor || '').toLowerCase().includes(qBusca)
      );

      pontos.push({
        ativo: a,
        sust,
        ticker: a.ticker,
        valX,
        valY,
        tetoRef,
        quadrante,
        matchBusca
      });
    });

    const contQuad = { ouro: [], premio: [], atencao: [], evitar: [] };
    pontos.forEach(p => {
      if (contQuad[p.quadrante]) contQuad[p.quadrante].push(p);
    });
    Object.values(contQuad).forEach(arr => {
      arr.sort((a, b) => (b.valX + b.valY) - (a.valX + a.valY));
    });

    // Renderizar os 4 cartões de quadrante clicáveis (contagem e top 3 tickers)
    gridQuad.innerHTML = ['ouro', 'premio', 'atencao', 'evitar'].map(qKey => {
      const meta = QUADRANTES_META[qKey];
      const itens = contQuad[qKey];
      const ativo = state.matrizQuadrante === qKey;
      const topExemplos = itens.slice(0, 3).map(i => i.ticker).join(', ');
      return `
        <button type="button" class="mquad-card ${meta.classe} ${ativo ? 'is-active active' : ''}" data-mquad="${qKey}"
          aria-pressed="${ativo ? 'true' : 'false'}"
          data-tip="Clique para filtrar a tabela e o gráfico apenas pelos ativos deste quadrante">
          <div class="mquad-top">
            <span class="mquad-title">${escH(meta.titulo)}</span>
            <span class="mquad-count mono">${itens.length}</span>
          </div>
          <div class="mquad-sub">${escH(meta.sub)}</div>
          <div class="mquad-tickers mono">${itens.length ? escH('Top 3: ' + topExemplos) : 'Nenhum ativo'}</div>
        </button>
      `;
    }).join('');

    if (!pontos.length) {
      state.matrizPontosRender = [];
      renderizarHudMatriz(null, 0, excluidosSemDados);
      const nomeX = state.matrizX === 'graham' ? 'Margem vs. Graham' : 'Margem Bazin';
      const nomeY = state.matrizY === 'roic' ? 'ROIC' : 'ROE';
      wrapSvg.innerHTML = `
        <div class="vchart-empty">
          Nenhum ativo no escopo atual possui simultaneamente <strong>${nomeX}</strong> e <strong>${nomeY}</strong> válidos.
          ${state.matrizX === 'bazin' ? '<br>Dica: para analisar ações sem dividendos ("Demais papéis"), alterne o Eixo X para <strong>Margem vs. Graham</strong>.' : ''}
        </div>`;
      wrapTable.innerHTML = '';
      return;
    }

    const rectW = wrapSvg.getBoundingClientRect().width;
    const width = Math.max(360, Math.round((rectW > 80 ? rectW : 960) - 16));
    const ehCompacto = width < 580;
    const height = ehCompacto ? 340 : 460;

    const padL = ehCompacto ? 52 : 66;
    const padR = ehCompacto ? 22 : 30;
    const padT = 28;
    const padB = 44;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const xs = pontos.map(p => p.valX);
    const ys = pontos.map(p => p.valY);
    const minXRaw = Math.min(...xs, -0.35);
    const maxXRaw = Math.max(...xs, 0.35);
    const minYRaw = Math.min(...ys, 0.0);
    const maxYRaw = Math.max(...ys, refY + 0.14);

    const domMinX = Math.max(-0.85, Math.floor((minXRaw - 0.05) * 20) / 20);
    const domMaxX = Math.min(0.68, Math.ceil((maxXRaw + 0.05) * 20) / 20);
    const domMinY = Math.max(-0.12, Math.floor((minYRaw - 0.02) * 20) / 20);
    const domMaxY = Math.min(0.48, Math.ceil((maxYRaw + 0.04) * 20) / 20);

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const mapX = (x) => (padL + 10) + ((clamp(x, domMinX, domMaxX) - domMinX) / (domMaxX - domMinX || 1)) * (plotW - 20);
    const mapY = (y) => (padT + 10) + (plotH - 20) - ((clamp(y, domMinY, domMaxY) - domMinY) / (domMaxY - domMinY || 1)) * (plotH - 20);

    const xZero = mapX(0);
    const yRef = mapY(refY);

    const ticksX = [];
    const stepX = (domMaxX - domMinX) > 1.0 ? 0.20 : 0.15;
    for (let v = Math.ceil(domMinX / stepX) * stepX; v <= domMaxX + 1e-6; v += stepX) {
      ticksX.push(Number(v.toFixed(2)));
    }
    if (!ticksX.some(t => Math.abs(t) < 0.03)) ticksX.push(0);
    ticksX.sort((a, b) => a - b);

    const ticksY = [];
    const stepY = (domMaxY - domMinY) > 0.42 ? 0.10 : 0.05;
    for (let v = Math.ceil(domMinY / stepY) * stepY; v <= domMaxY + 1e-6; v += stepY) {
      ticksY.push(Number(v.toFixed(2)));
    }

    const renderPts = pontos.map(p => {
      const cx = mapX(p.valX);
      const cy = mapY(p.valY);
      const clamped = p.valX < domMinX || p.valX > domMaxX || p.valY < domMinY || p.valY > domMaxY;
      const nota = p.sust?.nota ?? 50;
      const ehCilada = p.sust?.nivel === 'alerta' || nota < 50;
      const r = p.matchBusca ? 8.0 : (5.2 + (Math.max(0, nota) / 100) * 2.4);
      return { ...p, cx, cy, r, clamped, ehCilada };
    });

    state.matrizPontosRender = renderPts;

    // Rótulo de ticker visível APENAS nos pontos em destaque (foco/hover ou busca ativa), nunca sobreposto
    const caixasRotulos = [];
    const candidatosRotulo = renderPts.filter(p => p.matchBusca || p.ticker === state.matrizHoverTicker);
    const rotulosEscolhidos = [];
    for (const p of candidatosRotulo) {
      const wTxt = p.ticker.length * 7.5 + 8;
      const hTxt = 15;
      const lx = p.cx + p.r + 6 + wTxt > width - padR ? p.cx - p.r - 6 - wTxt : p.cx + p.r + 6;
      const ly = clamp(p.cy + 4, padT + 14, padT + plotH - 4);
      const box = { x1: lx - 2, y1: ly - hTxt + 2, x2: lx + wTxt + 2, y2: ly + 3 };
      const colide = caixasRotulos.some(b => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2));
      if (!colide) {
        caixasRotulos.push(box);
        rotulosEscolhidos.push({ p, lx, ly });
      }
    }

    const nomeXCurto = state.matrizX === 'graham' ? 'Margem vs. Graham' : 'Margem Bazin (K=6%)';
    const nomeYCurto = state.matrizY === 'roic' ? 'ROIC' : 'ROE';

    const corteX = clamp(xZero, padL, padL + plotW);
    const corteY = clamp(yRef, padT, padT + plotH);

    const qOuroW = Math.max(0, padL + plotW - corteX);
    const qOuroH = Math.max(0, corteY - padT);
    const qPremioW = Math.max(0, corteX - padL);
    const qPremioH = Math.max(0, corteY - padT);
    const qAtencaoW = Math.max(0, padL + plotW - corteX);
    const qAtencaoH = Math.max(0, padT + plotH - corteY);
    const qEvitarW = Math.max(0, corteX - padL);
    const qEvitarH = Math.max(0, padT + plotH - corteY);

    const gridLinesSvg = [
      ...ticksX.map(tx => {
        const px = mapX(tx);
        return `
          <line x1="${px.toFixed(1)}" y1="${padT}" x2="${px.toFixed(1)}" y2="${padT + plotH}" class="vchart-grid-line"/>
          <text x="${px.toFixed(1)}" y="${padT + plotH + 18}" text-anchor="middle" class="vsvg-axis-text">${fPct(tx, 0)}</text>
        `;
      }),
      ...ticksY.map(ty => {
        const py = mapY(ty);
        return `
          <line x1="${padL}" y1="${py.toFixed(1)}" x2="${padL + plotW}" y2="${py.toFixed(1)}" class="vchart-grid-line"/>
          <text x="${padL - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end" class="vsvg-axis-text">${fPctSimples(ty, 0)}</text>
        `;
      })
    ].join('');

    const watermarksSvg = ehCompacto ? '' : `
      <text x="${padL + plotW - 10}" y="${padT + 18}" text-anchor="end" class="vsvg-ceil-label" fill="#10b981" opacity="0.82">QUADRANTE OURO (DESCONTO + QUALIDADE)</text>
      <text x="${padL + 10}" y="${padT + 18}" text-anchor="start" class="vsvg-ceil-label" fill="#3b82f6" opacity="0.72">QUALIDADE CARA</text>
      <text x="${padL + plotW - 10}" y="${padT + plotH - 10}" text-anchor="end" class="vsvg-ceil-label" fill="#f59e0b" opacity="0.72">DESCONTO C/ ATENÇÃO</text>
      <text x="${padL + 10}" y="${padT + plotH - 10}" text-anchor="start" class="vsvg-ceil-label" fill="#ef4444" opacity="0.65">CARAS &amp; BAIXO RETORNO</text>
    `;

    const dotsSvg = renderPts.map(p => {
      if (state.matrizQuadrante !== 'todos' && p.quadrante !== state.matrizQuadrante) {
        return `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="3.5" fill="#475569" opacity="0.22"/>`;
      }
      const cor = QUADRANTES_META[p.quadrante].cor;
      const op = qBusca ? (p.matchBusca ? 0.96 : 0.18) : 0.88;
      const strokeCor = p.ehCilada ? '#ef4444' : '#0b0f17';
      const strokeW = p.ehCilada ? 2.2 : 1.4;
      const dashAttr = p.ehCilada ? 'stroke-dasharray="3 2"' : (p.clamped ? 'stroke-dasharray="2 1.5"' : '');
      const anelCilada = p.ehCilada
        ? `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 3.2).toFixed(1)}" fill="none" stroke="#ef4444" stroke-width="1" stroke-dasharray="2 2" opacity="0.75" pointer-events="none"/>`
        : '';
      const halo = p.matchBusca
        ? `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 4.8).toFixed(1)}" fill="none" stroke="${cor}" stroke-width="1.8" opacity="0.75" pointer-events="none"/>`
        : '';
      const ariaLbl = `${p.ticker}: ${nomeXCurto} ${fPct(p.valX)}, ${nomeYCurto} ${fPctSimples(p.valY)}, Anti-Cilada ${p.sust.nota}/100`;
      return `
        ${anelCilada}
        ${halo}
        <circle class="m-dot" tabindex="0" role="button" aria-label="${escH(ariaLbl)}"
          data-mticker="${escH(p.ticker)}" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.r.toFixed(1)}"
          fill="${cor}" fill-opacity="${op}" stroke="${strokeCor}" stroke-width="${strokeW}" ${dashAttr}/>
      `;
    }).join('');

    const labelsSvg = rotulosEscolhidos.map(({ p, lx, ly }) => {
      if (state.matrizQuadrante !== 'todos' && p.quadrante !== state.matrizQuadrante) return '';
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="vsvg-ceil-label" fill="#f8fafc">${escH(p.ticker)}</text>`;
    }).join('');

    wrapSvg.innerHTML = `
      <svg class="vsvg" id="matriz-scatter-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Matriz Desconto versus Qualidade">
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#0c1118" rx="4"/>
        ${qOuroW > 0 && qOuroH > 0 ? `<rect x="${corteX.toFixed(1)}" y="${padT}" width="${qOuroW.toFixed(1)}" height="${qOuroH.toFixed(1)}" fill="#10b981" opacity="0.05"/>` : ''}
        ${qPremioW > 0 && qPremioH > 0 ? `<rect x="${padL}" y="${padT}" width="${qPremioW.toFixed(1)}" height="${qPremioH.toFixed(1)}" fill="#3b82f6" opacity="0.03"/>` : ''}
        ${qAtencaoW > 0 && qAtencaoH > 0 ? `<rect x="${corteX.toFixed(1)}" y="${corteY.toFixed(1)}" width="${qAtencaoW.toFixed(1)}" height="${qAtencaoH.toFixed(1)}" fill="#f59e0b" opacity="0.035"/>` : ''}
        ${qEvitarW > 0 && qEvitarH > 0 ? `<rect x="${padL}" y="${corteY.toFixed(1)}" width="${qEvitarW.toFixed(1)}" height="${qEvitarH.toFixed(1)}" fill="#ef4444" opacity="0.035"/>` : ''}
        ${gridLinesSvg}
        ${xZero >= padL && xZero <= padL + plotW ? `
          <line x1="${xZero.toFixed(1)}" y1="${padT}" x2="${xZero.toFixed(1)}" y2="${padT + plotH}" stroke="#10b981" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.8"/>
          <text x="${(xZero + 6).toFixed(1)}" y="${(padT + plotH - 8).toFixed(1)}" class="vsvg-ceil-label" fill="#10b981">Margem = 0% (Teto)</text>
        ` : ''}
        ${yRef >= padT && yRef <= padT + plotH ? `
          <line x1="${padL}" y1="${yRef.toFixed(1)}" x2="${padL + plotW}" y2="${yRef.toFixed(1)}" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.8"/>
          <text x="${(padL + 8).toFixed(1)}" y="${(yRef - 6).toFixed(1)}" class="vsvg-ceil-label" fill="#60a5fa">${nomeYCurto} = ${fPctSimples(refY, 0)}</text>
        ` : ''}
        ${watermarksSvg}
        <rect class="v-hit-area" id="matriz-hit-rect" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"/>
        <g id="matriz-dots-layer">${dotsSvg}</g>
        <g id="matriz-labels-layer" pointer-events="none">${labelsSvg}</g>
        <g id="matriz-hover-ring" pointer-events="none"></g>
        <text x="${(padL + plotW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="vsvg-axis-text">${nomeXCurto} → (direita = mais descontada abaixo do teto)</text>
      </svg>
    `;

    renderizarHudMatriz(null, renderPts.length, excluidosSemDados);
    conectarInteracaoSvgMatriz(width, padR);
    renderizarTabelaMatriz(renderPts, usouFallbackTodos);
  }

  function conectarInteracaoSvgMatriz(vbWidth, padR) {
    const svg = qs('#matriz-scatter-svg');
    const hit = qs('#matriz-hit-rect');
    const ringLayer = qs('#matriz-hover-ring');
    const hud = qs('#matriz-hud');
    if (!svg || !hit || !ringLayer) return;

    const destacarPonto = (p) => {
      if (!p) {
        state.matrizHoverTicker = null;
        ringLayer.innerHTML = '';
        renderizarHudMatriz(null, state.matrizPontosRender.length, 0);
        return;
      }
      state.matrizHoverTicker = p.ticker;
      const cor = QUADRANTES_META[p.quadrante].cor;
      const wTxt = p.ticker.length * 7.6 + 12;
      const lx = p.cx + p.r + 7 + wTxt > vbWidth - padR ? p.cx - p.r - 7 - wTxt : p.cx + p.r + 7;
      const ly = Math.max(24, p.cy + 4);
      ringLayer.innerHTML = `
        <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 5).toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="2"/>
        <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 8).toFixed(1)}" fill="none" stroke="${cor}" stroke-width="1.5" opacity="0.75"/>
        <rect x="${(lx - 4).toFixed(1)}" y="${(ly - 13).toFixed(1)}" width="${wTxt.toFixed(1)}" height="18" rx="4" fill="#0b0f17" stroke="${cor}" stroke-width="1"/>
        <text x="${(lx + 2).toFixed(1)}" y="${ly.toFixed(1)}" class="vsvg-ceil-label" fill="#f8fafc">${escH(p.ticker)}</text>
      `;
      if (hud && window.innerWidth > 900) {
        hud.classList.add('vhud-floating');
        const leftPct = Math.max(3, Math.min(48, (p.cx / (vbWidth || 960)) * 100));
        if (typeof window.definirRegraCssDinamica === 'function') {
          window.definirRegraCssDinamica('#matriz-hud.vhud-floating', `left:${leftPct.toFixed(1)}%;top:10px;`);
        }
      }
      renderizarHudMatriz(p, state.matrizPontosRender.length, 0);
    };

    const localizarPonto = (evt) => {
      const rect = svg.getBoundingClientRect();
      const vbW = Number(svg.getAttribute('width')) || rect.width;
      const vbH = Number(svg.getAttribute('height')) || rect.height;
      const mx = ((evt.clientX - rect.left) / (rect.width || 1)) * vbW;
      const my = ((evt.clientY - rect.top) / (rect.height || 1)) * vbH;

      let melhor = null;
      let menorDist = 30;
      for (const p of state.matrizPontosRender) {
        if (state.matrizQuadrante !== 'todos' && p.quadrante !== state.matrizQuadrante) continue;
        const d = Math.hypot(p.cx - mx, p.cy - my);
        if (d < menorDist) {
          menorDist = d;
          melhor = p;
        }
      }
      return melhor;
    };

    let rafM = false;
    svg.addEventListener('pointermove', (evt) => {
      if (rafM) return;
      rafM = true;
      window.requestAnimationFrame(() => {
        rafM = false;
        const p = localizarPonto(evt);
        destacarPonto(p);
      });
    });

    svg.addEventListener('pointerleave', () => {
      destacarPonto(null);
    });

    svg.addEventListener('click', (evt) => {
      const p = localizarPonto(evt);
      if (p) {
        const fn = window.abrirDetalheAtivo || window.abrirDetalhe;
        if (typeof fn === 'function') fn(p.ticker);
      }
    });

    svg.querySelectorAll('.m-dot[tabindex="0"]').forEach(dot => {
      dot.addEventListener('focus', () => {
        const tk = dot.getAttribute('data-mticker');
        const p = state.matrizPontosRender.find(x => x.ticker === tk);
        if (p) destacarPonto(p);
      });
      dot.addEventListener('blur', () => {
        destacarPonto(null);
      });
      dot.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const tk = dot.getAttribute('data-mticker');
          const fn = window.abrirDetalheAtivo || window.abrirDetalhe;
          if (tk && typeof fn === 'function') fn(tk);
        }
      });
    });
  }

  function renderizarTabelaMatriz(pontos, usouFallbackTodos) {
    const wrap = qs('#matriz-table-wrap');
    if (!wrap) return;

    const qBusca = state.matrizBusca.trim().toLowerCase();
    const filtrados = pontos
      .filter(p => (state.matrizQuadrante === 'todos' || p.quadrante === state.matrizQuadrante))
      .filter(p => !qBusca || p.matchBusca)
      .sort((a, b) => {
        const ordemQ = { ouro: 0, atencao: 1, premio: 2, evitar: 3 };
        if (ordemQ[a.quadrante] !== ordemQ[b.quadrante]) return ordemQ[a.quadrante] - ordemQ[b.quadrante];
        return (b.valX + b.valY * 0.8) - (a.valX + a.valY * 0.8);
      });

    const nomeX = state.matrizX === 'graham' ? 'Margem vs. Graham' : 'Margem Bazin';
    const nomeTeto = state.matrizX === 'graham' ? 'Graham' : 'Teto Bazin';
    const nomeY = state.matrizY === 'roic' ? 'ROIC' : 'ROE';
    const tituloFiltro = state.matrizQuadrante === 'todos'
      ? 'Todos os quadrantes'
      : QUADRANTES_META[state.matrizQuadrante]?.titulo;

    wrap.innerHTML = `
      <div class="vsub-table-head">
        <span>Ranking da Matriz · ${escH(tituloFiltro)} (${filtrados.length} ${filtrados.length === 1 ? 'ativo' : 'ativos'})${usouFallbackTodos ? ' · Exibindo base completa' : ''}</span>
        ${state.matrizQuadrante !== 'todos' ? `<button type="button" class="btn-link-dim" data-mclear-quad>Mostrar todos os quadrantes</button>` : ''}
      </div>
      <div class="table-wrap">
        <table class="vt vcmp-table">
          <thead>
            <tr>
              <th>Ativo</th>
              <th>Quadrante</th>
              <th class="num">${nomeX}</th>
              <th class="num">${nomeY}</th>
              <th>Anti-Cilada</th>
              <th class="num">Preço / ${nomeTeto}</th>
              <th class="col-actions"><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            ${filtrados.slice(0, 80).map(p => {
              const a = p.ativo;
              const qm = QUADRANTES_META[p.quadrante];
              return `
                <tr class="vcmp-row" data-mopen-detail="${escH(a.ticker)}">
                  <td data-label="Ativo">
                    <div class="asset">
                      <span class="asset-ticker">${escH(a.ticker)}</span>
                      <span class="asset-sector">${escH(a.empresa || a.setor)}</span>
                    </div>
                  </td>
                  <td data-label="Quadrante">
                    <span class="mquad-pill ${qm.classe}">${escH(qm.titulo)}</span>
                  </td>
                  <td class="num ${p.valX >= 0 ? 't-green' : 't-red'}" data-label="${nomeX}">${fPct(p.valX)}</td>
                  <td class="num ${p.valY >= limiarQualidadeY() ? 't-green' : ''}" data-label="${nomeY}">${fPctSimples(p.valY)}</td>
                  <td data-label="Anti-Cilada">${htmlSeloSustentabilidade(a)}</td>
                  <td class="num" data-label="Preço / ${nomeTeto}">
                    <div class="cell-stack">
                      <span>${fReal(a.preco)}</span>
                      <span class="cell-sub">Teto ${fReal(p.tetoRef)}</span>
                    </div>
                  </td>
                  <td class="c-actions">
                    <div class="row-actions">
                      <button type="button" class="icon-btn" data-mopen-chart="${escH(a.ticker)}" data-tip="Abrir em Gráficos & Simulador">
                        <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/></svg>
                      </button>
                      <button type="button" class="icon-btn" data-mopen-detail="${escH(a.ticker)}" data-tip="Abrir Raio-X">
                        <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ==========================================================================
   * ABA 4: CALENDÁRIO DE DIVIDENDOS
   * ========================================================================== */

  function sincronizarControlesCalendario() {
    document.querySelectorAll('#cal-scope-group [data-cscope]').forEach(b => {
      const on = b.dataset.cscope === state.calEscopo;
      b.classList.toggle('is-active', on);
      b.classList.toggle('active', on);
    });
    document.querySelectorAll('#cal-paymode-group [data-cpaymode]').forEach(b => {
      const on = b.dataset.cpaymode === state.calModoPgto;
      b.classList.toggle('is-active', on);
      b.classList.toggle('active', on);
    });
    const selMes = qs('#cal-month-select');
    if (selMes && String(selMes.value) !== String(state.calMes)) {
      selMes.value = String(state.calMes);
    }
  }

  function renderizarCalendarioDividendos() {
    const kpiEl = qs('#cal-kpi-grid');
    const upComEl = qs('#cal-upcoming-datacom');
    const payEl = qs('#cal-payments-list');
    const heatEl = qs('#cal-heatmap-wrap');
    if (!kpiEl || !upComEl || !payEl || !heatEl) return;

    sincronizarControlesCalendario();

    const hoje = hojeIsoB3();
    const mesAtualNum = Number(hoje.slice(5, 7)) || (new Date().getMonth() + 1);
    const { lista: baseEscopoBruta } = filtrarPorEscopo(state.calEscopo);
    const baseEscopo = baseEscopoBruta.map(a => enriquecerAgendaAtivo(a, hoje));
    const q = state.calBusca.trim().toLowerCase();

    const listaFiltrada = baseEscopo.filter(a => {
      if (q && !a.ticker.toLowerCase().includes(q) && !(a.empresa || '').toLowerCase().includes(q) && !(a.setor || '').toLowerCase().includes(q)) {
        return false;
      }
      if (state.calMes > 0) {
        const mStr = String(state.calMes);
        const temSazonal = (a.mapa_sazonal_5a && Number(a.mapa_sazonal_5a[mStr]) > 0)
          || (Array.isArray(a.meses_habituais_dividendo) && a.meses_habituais_dividendo.includes(state.calMes));
        const temEventoMes = Array.isArray(a.agenda_anunciada) && a.agenda_anunciada.some(ev => {
          const mCom = Number((ev.data_com || '').slice(5, 7));
          const mPg = Number((ev.data_pagamento || '').slice(5, 7));
          return mCom === state.calMes || mPg === state.calMes;
        });
        return temSazonal || temEventoMes;
      }
      return true;
    });

    const eventosDataComAberta = [];
    const eventosPagamentosAgendados = [];
    const eventosUltimosPagos = [];

    listaFiltrada.forEach(a => {
      const agenda = Array.isArray(a.agenda_anunciada) ? a.agenda_anunciada : [];
      agenda.forEach(ev => {
        if (ev.status === 'anunciado' && ev.data_com >= hoje) {
          eventosDataComAberta.push({ ativo: a, ev });
        }
        if (ev.data_pagamento && ev.data_pagamento >= hoje) {
          eventosPagamentosAgendados.push({ ativo: a, ev });
        }
      });
      if (a.ultimo_provento_pago) {
        eventosUltimosPagos.push({ ativo: a, ev: a.ultimo_provento_pago });
      }
    });

    eventosDataComAberta.sort((x, y) => x.ev.data_com.localeCompare(y.ev.data_com) || x.ativo.ticker.localeCompare(y.ativo.ticker));
    eventosPagamentosAgendados.sort((x, y) => (x.ev.data_pagamento || '').localeCompare(y.ev.data_pagamento || '') || x.ativo.ticker.localeCompare(y.ativo.ticker));
    eventosUltimosPagos.sort((x, y) => (y.ev.data_pagamento || y.ev.data_com || '').localeCompare(x.ev.data_pagamento || x.ev.data_com || ''));

    const mesesCobertos = [];
    for (let m = 1; m <= 12; m += 1) {
      const qtdMes = baseEscopo.filter(a => Array.isArray(a.meses_habituais_dividendo) && a.meses_habituais_dividendo.includes(m)).length;
      mesesCobertos.push({ mes: m, qtd: qtdMes });
    }
    const totalMesesComRenda = mesesCobertos.filter(x => x.qtd > 0).length;
    const pagadoresMesAtual = baseEscopo.filter(a => Array.isArray(a.meses_habituais_dividendo) && a.meses_habituais_dividendo.includes(mesAtualNum));

    const proxCom = eventosDataComAberta[0];
    const proxPgto = eventosPagamentosAgendados[0];

    kpiEl.innerHTML = `
      <div class="kpi" data-tip="Eventos oficiais anunciados à B3 cuja data-com ainda está em aberto (hoje ou futura)">
        <div class="kpi-label">Datas-Com em aberto</div>
        <div class="kpi-value t-green">${eventosDataComAberta.length}</div>
        <div class="kpi-foot">${proxCom ? `Próxima: ${escH(proxCom.ativo.ticker)} em ${fDataCurtaIso(proxCom.ev.data_com)} (${rotuloContagemDias(diasEntreIso(proxCom.ev.data_com, hoje))})` : 'Nenhum anúncio em aberto no filtro'}</div>
      </div>
      <div class="kpi" data-tip="Proventos já aprovados com depósito agendado para os próximos dias/meses">
        <div class="kpi-label">Pagamentos agendados</div>
        <div class="kpi-value">${eventosPagamentosAgendados.length}</div>
        <div class="kpi-foot">${proxPgto ? `Próximo: ${escH(proxPgto.ativo.ticker)} em ${fDataCurtaIso(proxPgto.ev.data_pagamento)} (${fRealProvento(proxPgto.ev.valor)})` : 'Sem pagamentos agendados no filtro'}</div>
      </div>
      <div class="kpi" data-tip="Ativos do escopo que historicamente têm data-com recorrente neste mês (${MESES_NOMES[mesAtualNum - 1]})">
        <div class="kpi-label">Sazonais em ${MESES_NOMES[mesAtualNum - 1]}</div>
        <div class="kpi-value">${pagadoresMesAtual.length}</div>
        <div class="kpi-foot">${pagadoresMesAtual.length ? escH(pagadoresMesAtual.slice(0, 4).map(a => a.ticker).join(', ') + (pagadoresMesAtual.length > 4 ? '…' : '')) : 'Sem recorrência habitual neste mês'}</div>
      </div>
      <div class="kpi" data-tip="Quantos meses do ano possuem pelo menos um ativo com histórico habitual de data-com neste escopo">
        <div class="kpi-label">Cobertura anual de renda</div>
        <div class="kpi-value">${totalMesesComRenda} <span class="t-dim">/ 12m</span></div>
        <div class="cal-mini-months" aria-hidden="true">
          ${mesesCobertos.map(mc => `<span class="${mc.qtd > 0 ? 'is-on' : ''} ${mc.mes === mesAtualNum ? 'is-now' : ''}" title="${MESES_CURTOS[mc.mes - 1]}: ${mc.qtd} ativos"></span>`).join('')}
        </div>
      </div>
    `;

    if (!eventosDataComAberta.length) {
      const totalUnivAbertas = obterUniverso().reduce((acc, rawA) => {
        const a = enriquecerAgendaAtivo(rawA, hoje);
        const n = (a.agenda_anunciada || []).filter(ev => ev.status === 'anunciado' && ev.data_com >= hoje).length;
        return acc + n;
      }, 0);
      upComEl.innerHTML = `
        <div class="cal-empty">
          <strong>Nenhuma data-com em aberto neste filtro</strong>
          <span>As empresas da B3 anunciam datas-com alguns dias antes do corte. Consulte o mapa sazonal abaixo para ver os meses habituais de anúncio.</span>
          ${totalUnivAbertas > 0 && state.calEscopo !== 'todos'
            ? `<button type="button" class="btn btn-ghost" data-cal-show-all>Ver ${totalUnivAbertas} datas-com abertas em Todos os ativos</button>`
            : ''}
        </div>
      `;
    } else {
      upComEl.innerHTML = `
        <div class="cal-event-list">
          ${eventosDataComAberta.slice(0, 24).map(({ ativo: a, ev }) => {
            const dias = diasEntreIso(ev.data_com, hoje);
            const dyEv = a.preco > 0 ? ev.valor / a.preco : null;
            const urgente = dias !== null && dias <= 3;
            return `
              <div class="cal-event-row" data-copen-detail="${escH(a.ticker)}">
                <div class="cal-ev-datebox ${urgente ? 'is-urgent' : ''}">
                  <span class="cal-ev-countdown">${escH(rotuloContagemDias(dias))}</span>
                  <strong class="mono">${fDataCurtaIso(ev.data_com)}</strong>
                </div>
                <div class="cal-ev-main">
                  <div class="cal-ev-top">
                    <span class="cal-ev-ticker mono">${escH(a.ticker)}</span>
                    <span class="cal-ev-type">${escH(rotuloTipoEvento(ev.tipo))}</span>
                    ${htmlSeloSustentabilidade(a, true)}
                  </div>
                  <div class="cal-ev-sub">
                    Pgto: <strong class="mono">${ev.data_pagamento ? fDataIso(ev.data_pagamento) : 'A definir'}</strong>
                    · ${escH(a.setor)}
                  </div>
                </div>
                <div class="cal-ev-val">
                  <strong class="mono t-green">${fRealProvento(ev.valor)}</strong>
                  <span class="mono t-muted">${numOk(dyEv) ? fPctSimples(dyEv, 2) : ''}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const listaDireita = state.calModoPgto === 'pagos' ? eventosUltimosPagos : eventosPagamentosAgendados;
    if (!listaDireita.length) {
      payEl.innerHTML = `
        <div class="cal-empty">
          <strong>${state.calModoPgto === 'pagos' ? 'Sem histórico de pagamentos neste filtro' : 'Nenhum pagamento futuro agendado neste filtro'}</strong>
          <span>Altere o escopo ou alterne para "${state.calModoPgto === 'pagos' ? 'A Receber' : 'Últimos Pagos'}".</span>
        </div>
      `;
    } else {
      payEl.innerHTML = `
        <div class="cal-event-list">
          ${listaDireita.slice(0, 24).map(({ ativo: a, ev }) => {
            const dtRef = ev.data_pagamento || ev.data_com;
            const dias = diasEntreIso(dtRef, hoje);
            const dyEv = a.preco > 0 ? ev.valor / a.preco : null;
            return `
              <div class="cal-event-row" data-copen-detail="${escH(a.ticker)}">
                <div class="cal-ev-datebox ${state.calModoPgto === 'pagos' ? 'is-paid' : 'is-pay'}">
                  <span class="cal-ev-countdown">${escH(ev.data_pagamento ? rotuloContagemDias(dias) : 'Sem data')}</span>
                  <strong class="mono">${ev.data_pagamento ? fDataCurtaIso(ev.data_pagamento) : fDataCurtaIso(ev.data_com)}</strong>
                </div>
                <div class="cal-ev-main">
                  <div class="cal-ev-top">
                    <span class="cal-ev-ticker mono">${escH(a.ticker)}</span>
                    <span class="cal-ev-type">${escH(rotuloTipoEvento(ev.tipo))}</span>
                  </div>
                  <div class="cal-ev-sub">
                    Data-com: <span class="mono">${fDataIso(ev.data_com)}</span>
                    ${ev.status === 'anunciado' ? ' · <span class="t-green">Em aberto</span>' : (ev.status === 'a_pagar' ? ' · <span class="t-accent">Já ex</span>' : '')}
                  </div>
                </div>
                <div class="cal-ev-val">
                  <strong class="mono">${fRealProvento(ev.valor)}</strong>
                  <span class="mono t-muted">${numOk(dyEv) ? fPctSimples(dyEv, 2) : ''}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const ordenadosMapa = [...listaFiltrada].sort((a, b) => {
      const pa = a.proxima_data_com ? 1 : 0;
      const pb = b.proxima_data_com ? 1 : 0;
      if (pb !== pa) return pb - pa;
      const ma = (a.meses_habituais_dividendo || []).length;
      const mb = (b.meses_habituais_dividendo || []).length;
      if (mb !== ma) return mb - ma;
      const mbzA = a.bazin ? (numOk(a.bazin.margem) ? a.bazin.margem : (a.bazin.margem_seguranca ?? -9)) : -9;
      const mbzB = b.bazin ? (numOk(b.bazin.margem) ? b.bazin.margem : (b.bazin.margem_seguranca ?? -9)) : -9;
      return mbzB - mbzA;
    });

    heatEl.innerHTML = `
      <div class="table-wrap cal-heat-scroll">
        <table class="cal-heat-table">
          <thead>
            <tr>
              <th class="cal-sticky-col">Ativo</th>
              <th>Anti-Cilada</th>
              <th>Próxima Data-Com / Últ. Pago</th>
              ${MESES_CURTOS.map((mNome, idx) => {
                const mNum = idx + 1;
                return `<th class="cal-m-head ${mNum === mesAtualNum ? 'is-cur-month' : ''} ${state.calMes === mNum ? 'is-sel-month' : ''}" data-cselect-month="${mNum}" data-tip="Clique para filtrar ${MESES_NOMES[idx]}">${mNome}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${ordenadosMapa.slice(0, 100).map(a => {
              const mapa = a.mapa_sazonal_5a || {};
              const mesesAnunciados = new Set(
                (a.agenda_anunciada || [])
                  .filter(ev => ev.status === 'anunciado' && ev.data_com >= hoje)
                  .map(ev => Number(ev.data_com.slice(5, 7)))
              );

              let resumoAgenda = '<span class="t-dim">Sem proventos recentes</span>';
              if (a.proxima_data_com) {
                resumoAgenda = `<span class="t-green mono" data-tip="Data-Com aberta em ${fDataIso(a.proxima_data_com.data_com)} · Pgto ${fDataIso(a.proxima_data_com.data_pagamento)}">★ Com ${fDataCurtaIso(a.proxima_data_com.data_com)} (${fRealProvento(a.proxima_data_com.valor)})</span>`;
              } else if (a.proximo_pagamento) {
                resumoAgenda = `<span class="t-accent mono" data-tip="Já ex-dividendo (Data-com ${fDataIso(a.proximo_pagamento.data_com)}) · Pagamento agendado">Pgto ${fDataCurtaIso(a.proximo_pagamento.data_pagamento)} (${fRealProvento(a.proximo_pagamento.valor)})</span>`;
              } else if (a.ultimo_provento_pago) {
                const dtUlt = a.ultimo_provento_pago.data_pagamento || a.ultimo_provento_pago.data_com;
                resumoAgenda = `<span class="t-muted mono" data-tip="Último provento (${rotuloTipoEvento(a.ultimo_provento_pago.tipo)}) · Data-com ${fDataIso(a.ultimo_provento_pago.data_com)}">Pago ${fDataCurtaIso(dtUlt)} (${fRealProvento(a.ultimo_provento_pago.valor)})</span>`;
              }

              return `
                <tr class="cal-heat-row" data-copen-detail="${escH(a.ticker)}">
                  <td class="cal-sticky-col">
                    <div class="cal-row-asset">
                      <span class="mono">${escH(a.ticker)}</span>
                      <span class="t-dim">${escH(a.setor)}</span>
                    </div>
                  </td>
                  <td>${htmlSeloSustentabilidade(a, false)}</td>
                  <td>${resumoAgenda}</td>
                  ${MESES_CURTOS.map((mNome, idx) => {
                    const mNum = idx + 1;
                    const freq = Number(mapa[String(mNum)] || 0);
                    const anunciado = mesesAnunciados.has(mNum);
                    const lvl = freq >= 4 ? 'lvl-high' : (freq >= 2 ? 'lvl-mid' : (freq === 1 ? 'lvl-low' : 'lvl-zero'));
                    const tip = anunciado
                      ? `${a.ticker} em ${MESES_NOMES[idx]}: Data-Com OFICIAL anunciada! (Histórico: ${freq}/5 anos)`
                      : (freq > 0 ? `${a.ticker} em ${MESES_NOMES[idx]}: teve data-com em ${freq} dos últimos 5 anos fechados` : `${a.ticker}: sem data-com em ${MESES_NOMES[idx]} nos últimos 5 anos`);
                    return `
                      <td class="cal-m-cell ${mNum === mesAtualNum ? 'is-cur-month' : ''}" data-tip="${escH(tip)}">
                        <span class="cal-heat-pill ${lvl} ${anunciado ? 'is-announced' : ''}">
                          ${anunciado ? `★ ${freq}/5` : (freq > 0 ? `${freq}/5` : '0/5')}
                        </span>
                      </td>
                    `;
                  }).join('')}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ==========================================================================
   * EVENTOS DAS DUAS ABAS
   * ========================================================================== */

  function bindEventosMatrizCalendario() {
    qs('#matriz-scope-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mscope]');
      if (!b) return;
      state.matrizEscopo = b.dataset.mscope;
      salvarPrefs();
      renderizarMatrizValuation();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    qs('#matriz-xaxis-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mx]');
      if (!b) return;
      state.matrizX = b.dataset.mx;
      salvarPrefs();
      renderizarMatrizValuation();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    qs('#matriz-yaxis-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-my]');
      if (!b) return;
      state.matrizY = b.dataset.my;
      salvarPrefs();
      renderizarMatrizValuation();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    qs('#matriz-notrap-btn')?.addEventListener('click', () => {
      state.matrizSemCilada = !state.matrizSemCilada;
      salvarPrefs();
      renderizarMatrizValuation();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    let timerBuscaMatriz = null;
    qs('#matriz-search-input')?.addEventListener('input', (e) => {
      const v = e.target.value || '';
      if (timerBuscaMatriz) clearTimeout(timerBuscaMatriz);
      timerBuscaMatriz = setTimeout(() => {
        state.matrizBusca = v;
        renderizarMatrizValuation();
      }, 150);
    });

    qs('#btn-export-matriz-png')?.addEventListener('click', () => {
      const svg = qs('#matriz-scatter-svg');
      if (svg && typeof window.exportarSvgComoPng === 'function') {
        window.exportarSvgComoPng(svg, `matriz-desconto-qualidade-${state.matrizX}-${state.matrizY}.png`);
      }
    });

    qs('#matriz-quadrants-grid')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-mquad]');
      if (!card) return;
      const q = card.dataset.mquad;
      state.matrizQuadrante = state.matrizQuadrante === q ? 'todos' : q;
      salvarPrefs();
      renderizarMatrizValuation();
    });

    qs('#matriz-table-wrap')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-mclear-quad]')) {
        state.matrizQuadrante = 'todos';
        salvarPrefs();
        renderizarMatrizValuation();
        return;
      }
      const btnChart = e.target.closest('[data-mopen-chart]');
      if (btnChart) {
        e.stopPropagation();
        const fnChart = window.abrirAtivoNaVisaoGrafica || window.abrirNaVisaoGrafica;
        if (typeof fnChart === 'function') fnChart(btnChart.dataset.mopenChart);
        return;
      }
      const row = e.target.closest('[data-mopen-detail]');
      if (row) {
        const fnDet = window.abrirDetalheAtivo || window.abrirDetalhe;
        if (typeof fnDet === 'function') fnDet(row.dataset.mopenDetail);
      }
    });

    // --- Eventos do Calendário ---
    qs('#cal-scope-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cscope]');
      if (!b) return;
      state.calEscopo = b.dataset.cscope;
      salvarPrefs();
      renderizarCalendarioDividendos();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    qs('#cal-month-select')?.addEventListener('change', (e) => {
      state.calMes = Number(e.target.value) || 0;
      renderizarCalendarioDividendos();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    qs('#cal-cur-month-btn')?.addEventListener('click', () => {
      const mAtual = Number(hojeIsoB3().slice(5, 7)) || (new Date().getMonth() + 1);
      state.calMes = state.calMes === mAtual ? 0 : mAtual;
      renderizarCalendarioDividendos();
      if (typeof window.sincronizarEstadoUrl === 'function') window.sincronizarEstadoUrl();
    });

    qs('#cal-paymode-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cpaymode]');
      if (!b) return;
      state.calModoPgto = b.dataset.cpaymode;
      salvarPrefs();
      renderizarCalendarioDividendos();
    });

    let timerBuscaCal = null;
    qs('#cal-search-input')?.addEventListener('input', (e) => {
      const v = e.target.value || '';
      if (timerBuscaCal) clearTimeout(timerBuscaCal);
      timerBuscaCal = setTimeout(() => {
        state.calBusca = v;
        renderizarCalendarioDividendos();
      }, 150);
    });

    const tratarCliqueCalendario = (e) => {
      if (e.target.closest('[data-cal-show-all]')) {
        state.calEscopo = 'todos';
        state.calMes = 0;
        salvarPrefs();
        renderizarCalendarioDividendos();
        return;
      }
      const thMes = e.target.closest('[data-cselect-month]');
      if (thMes) {
        const m = Number(thMes.dataset.cselectMonth) || 0;
        state.calMes = state.calMes === m ? 0 : m;
        renderizarCalendarioDividendos();
        return;
      }
      const alvo = e.target.closest('[data-copen-detail]');
      if (alvo) {
        const fnDet = window.abrirDetalheAtivo || window.abrirDetalhe;
        if (typeof fnDet === 'function') fnDet(alvo.dataset.copenDetail);
      }
    };

    qs('#cal-upcoming-datacom')?.addEventListener('click', tratarCliqueCalendario);
    qs('#cal-payments-list')?.addEventListener('click', tratarCliqueCalendario);
    qs('#cal-heatmap-wrap')?.addEventListener('click', tratarCliqueCalendario);

    let timerResize = null;
    window.addEventListener('resize', () => {
      const viewMatrizVisivel = !qs('#view-matriz')?.classList.contains('is-hidden');
      if (!viewMatrizVisivel) return;
      clearTimeout(timerResize);
      timerResize = setTimeout(() => renderizarMatrizValuation(), 120);
    }, { passive: true });
  }

  window.renderizarMatrizValuation = renderizarMatrizValuation;
  window.renderizarAbaMatriz = renderizarMatrizValuation;
  window.renderizarCalendarioDividendos = renderizarCalendarioDividendos;
  window.renderizarAbaCalendario = renderizarCalendarioDividendos;

  window.obterEstadoMatrizCalendario = function () {
    return {
      matrizEscopo: state.matrizEscopo,
      matrizX: state.matrizX,
      matrizY: state.matrizY,
      matrizSemCilada: state.matrizSemCilada,
      matrizQuadrante: state.matrizQuadrante,
      calEscopo: state.calEscopo,
      calMes: state.calMes,
      calModoPgto: state.calModoPgto
    };
  };

  window.aplicarEstadoMatrizCalendario = function (params) {
    if (!params) return;
    if (params.x && ['bazin', 'graham'].includes(params.x)) state.matrizX = params.x;
    if (params.y && ['roe', 'roic'].includes(params.y)) state.matrizY = params.y;
    if (params.escopo && ['painel', 'besst', 'dividendos', 'demais', 'todos'].includes(params.escopo)) {
      state.matrizEscopo = params.escopo;
      state.calEscopo = params.escopo;
    }
    if (params.quad && ['todos', 'ouro', 'premio', 'atencao', 'evitar'].includes(params.quad)) {
      state.matrizQuadrante = params.quad;
    }
    if (params.mes !== undefined) {
      const m = Number(params.mes);
      if (!Number.isNaN(m) && m >= 0 && m <= 12) state.calMes = m;
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindEventosMatrizCalendario);
  } else {
    bindEventosMatrizCalendario();
  }
})();
