/* Matriz Desconto × Qualidade & Calendário de Dividendos (index.html)
 * Somente leitura e apresentação dos dados de ./data/valuation.json:
 * - Margens (Bazin/Graham), ROE/ROIC, Score de Sustentabilidade Anti-Cilada e
 *   Agenda de Proventos (próxima data-com, último pago, pagamentos agendados e
 *   sazonalidade 5 anos) vêm prontos do motor Python (engine/build.py).
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
      cor: '#2fbf86',
      classe: 'is-ouro'
    },
    premio: {
      id: 'premio',
      titulo: 'Qualidade Cara',
      sub: 'Alta Rentabilidade · Acima do Teto',
      cor: '#5b8def',
      classe: 'is-premio'
    },
    atencao: {
      id: 'atencao',
      titulo: 'Desconto c/ Atenção',
      sub: 'Abaixo do Teto · Rentab. Modesta',
      cor: '#e0b341',
      classe: 'is-atencao'
    },
    evitar: {
      id: 'evitar',
      titulo: 'Caras & Baixo Retorno',
      sub: 'Acima do Teto · Baixa Rentabilidade',
      cor: '#e5636b',
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
    // Fuso de Brasília (UTC-3)
    const agora = new Date(Date.now() - 3 * 3600 * 1000);
    return agora.toISOString().slice(0, 10);
  }

  function diasEntreIso(isoAlvo, isoBase) {
    if (!isoAlvo || !isoBase) return null;
    const tAlvo = Date.parse(isoAlvo.slice(0, 10) + 'T00:00:00Z');
    const tBase = Date.parse(isoBase.slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(tAlvo) || Number.isNaN(tBase)) return null;
    return Math.round((tAlvo - tBase) / 86400000);
  }

  function rotuloContagemDias(dias) {
    if (dias === null) return '';
    if (dias === 0) return 'Hoje';
    if (dias === 1) return 'Amanhã';
    if (dias > 1) return `Em ${dias}d`;
    if (dias === -1) return 'Ontem';
    return `Há ${Math.abs(dias)}d`;
  }

  function rotuloTipoEvento(tipo) {
    if (tipo === 'jcp') return 'JCP';
    if (tipo === 'dividendo') return 'Dividendo';
    if (tipo === 'misto') return 'Div. + JCP';
    if (tipo === 'extraordinario') return 'Extraord.';
    return 'Provento';
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

  function htmlSeloSustentabilidade(a, compacto = false) {
    if (typeof window.htmlSustentabilidade === 'function') {
      return window.htmlSustentabilidade(a, compacto);
    }
    const s = a?.sustentabilidade;
    if (!s || s.nivel === 'sem_dividendo') {
      return `<span class="sust-badge sust-nd" data-tip="Ativo sem distribuição recorrente nos últimos 5 anos fechados">Sem Divid.</span>`;
    }
    const cls = s.nivel === 'forte' ? 'sust-forte' : (s.nivel === 'moderado' ? 'sust-mod' : 'sust-alerta');
    const resumo = Array.isArray(s.pilares) ? s.pilares.map(p => `${p.nome}: ${p.detalhe}`).join(' · ') : '';
    const txt = compacto ? `${s.nota}` : `${s.nota} · ${s.rotulo}`;
    return `<span class="sust-badge ${cls}" data-tip="${escH(`Score Anti-Cilada ${s.nota}/100 (${s.rotulo}) — ${resumo}`)}">${escH(txt)}</span>`;
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
    return (typeof painelState !== 'undefined' && Array.isArray(painelState.universo))
      ? painelState.universo
      : [];
  }

  function obterSelecionadosSet() {
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
      return { lista: univ, usouFallbackTodos: true };
    }
    if (escopo === 'besst') {
      return { lista: univ.filter(a => obterCat(a) === 'besst'), usouFallbackTodos: false };
    }
    if (escopo === 'dividendos') {
      return { lista: univ.filter(a => obterCat(a) !== 'demais'), usouFallbackTodos: false };
    }
    if (escopo === 'demais') {
      return { lista: univ.filter(a => obterCat(a) === 'demais'), usouFallbackTodos: false };
    }
    return { lista: univ, usouFallbackTodos: false };
  }

  /* ==========================================================================
   * ABA 3: MATRIZ DESCONTO × QUALIDADE
   * ========================================================================== */

  function extrairMetricasMatriz(a) {
    const f = a.fundamentos || {};
    const valX = state.matrizX === 'graham' ? a.margem_graham : a.bazin?.margem_seguranca;
    const tetoRef = state.matrizX === 'graham' ? a.graham : a.bazin?.teto;
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

  function sincronizarControlesMatriz() {
    document.querySelectorAll('#matriz-scope-group [data-mscope]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.mscope === state.matrizEscopo);
    });
    document.querySelectorAll('#matriz-xaxis-group [data-mx]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.mx === state.matrizX);
    });
    document.querySelectorAll('#matriz-yaxis-group [data-my]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.my === state.matrizY);
    });
    const trapBtn = qs('#matriz-notrap-btn');
    if (trapBtn) {
      trapBtn.classList.toggle('is-on', state.matrizSemCilada);
    }
  }

  function renderizarHudMatriz(ponto, totalPlotados, excluidos) {
    const hud = qs('#matriz-hud');
    if (!hud) return;
    const nomeX = state.matrizX === 'graham' ? 'Margem Graham' : 'Margem Bazin';
    const nomeY = state.matrizY === 'roic' ? 'ROIC' : 'ROE';

    if (!ponto) {
      const refY = limiarQualidadeY();
      hud.innerHTML = `
        <span class="vhud-date">${totalPlotados} papéis plotados</span>
        <span class="vhud-metric">Eixo X: <strong>${nomeX}</strong> (Teto = 0%)</span>
        <span class="vhud-metric">Eixo Y: <strong>${nomeY}</strong> (Ref. = ${fPctSimples(refY, 0)})</span>
        ${excluidos > 0 ? `<span class="t-dim" style="font-size:11.5px">· ${excluidos} fora (sem ${state.matrizX === 'graham' ? 'teto Graham' : 'DPA/teto Bazin'} ou ${nomeY})</span>` : ''}
        <span class="t-dim" style="margin-left:auto;font-size:11.5px">Passe o cursor ou clique em um ponto para abrir o Raio-X</span>
      `;
      return;
    }

    const a = ponto.ativo;
    const qMeta = QUADRANTES_META[ponto.quadrante];
    const nota = a.sustentabilidade?.nota;
    const rotSust = a.sustentabilidade?.rotulo || '—';

    hud.innerHTML = `
      <span class="vhud-date mono" style="border-color:${qMeta.cor};color:${qMeta.cor}">${escH(a.ticker)}</span>
      <span class="vhud-metric"><strong>${escH(a.empresa || a.setor)}</strong></span>
      <span class="vhud-metric">${nomeX}: <strong class="${ponto.valX >= 0 ? 't-green' : 't-red'} mono">${fPct(ponto.valX)}</strong></span>
      <span class="vhud-metric">${nomeY}: <strong class="mono">${fPctSimples(ponto.valY)}</strong></span>
      <span class="vhud-metric">Preço: <strong class="mono">${fReal(a.preco)}</strong> <span class="t-dim">(Teto ${fReal(ponto.tetoRef)})</span></span>
      <span class="vhud-metric">Anti-Cilada: <strong class="mono">${numOk(nota) && a.sustentabilidade?.nivel !== 'sem_dividendo' ? `${nota}/100 (${escH(rotSust)})` : escH(rotSust)}</strong></span>
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
      if (state.matrizSemCilada && a.sustentabilidade?.nivel === 'alerta') {
        return;
      }
      const { valX, valY, tetoRef } = extrairMetricasMatriz(a);
      if (!numOk(valX) || !numOk(valY)) {
        excluidosSemDados += 1;
        return;
      }
      const quadrante = classificarQuadrante(valX, valY, refY);
      const matchBusca = !qBusca
        || a.ticker.toLowerCase().includes(qBusca)
        || (a.empresa || '').toLowerCase().includes(qBusca)
        || (a.setor || '').toLowerCase().includes(qBusca);

      pontos.push({
        ativo: a,
        ticker: a.ticker,
        valX,
        valY,
        tetoRef,
        quadrante,
        matchBusca
      });
    });

    // Contagem por quadrante
    const contQuad = { ouro: [], premio: [], atencao: [], evitar: [] };
    pontos.forEach(p => {
      if (contQuad[p.quadrante]) contQuad[p.quadrante].push(p);
    });
    Object.values(contQuad).forEach(arr => {
      arr.sort((a, b) => (b.valX + b.valY) - (a.valX + a.valY));
    });

    // Renderizar os 4 cartões de quadrante clicáveis
    gridQuad.innerHTML = ['ouro', 'premio', 'atencao', 'evitar'].map(qKey => {
      const meta = QUADRANTES_META[qKey];
      const itens = contQuad[qKey];
      const ativo = state.matrizQuadrante === qKey;
      const topExemplos = itens.slice(0, 4).map(i => i.ticker).join(', ');
      return `
        <button type="button" class="mquad-card ${meta.classe} ${ativo ? 'is-active' : ''}" data-mquad="${qKey}" style="--q-color:${meta.cor}"
          data-tip="Clique para filtrar a tabela abaixo apenas pelos ativos deste quadrante">
          <div class="mquad-top">
            <span class="mquad-title">${escH(meta.titulo)}</span>
            <span class="mquad-count mono">${itens.length}</span>
          </div>
          <div class="mquad-sub">${escH(meta.sub)}</div>
          <div class="mquad-tickers mono">${itens.length ? escH(topExemplos + (itens.length > 4 ? '…' : '')) : 'Nenhum ativo'}</div>
        </button>
      `;
    }).join('');

    if (!pontos.length) {
      state.matrizPontosRender = [];
      renderizarHudMatriz(null, 0, excluidosSemDados);
      const nomeX = state.matrizX === 'graham' ? 'Margem Graham' : 'Margem Bazin';
      const nomeY = state.matrizY === 'roic' ? 'ROIC' : 'ROE';
      wrapSvg.innerHTML = `
        <div class="vchart-empty">
          Nenhum ativo no escopo atual possui simultaneamente <strong>${nomeX}</strong> e <strong>${nomeY}</strong> válidos.
          ${state.matrizX === 'bazin' ? '<br>Dica: para analisar ações sem dividendos ("Demais papéis"), alterne o Eixo X para <strong>Margem Graham</strong>.' : ''}
        </div>`;
      wrapTable.innerHTML = '';
      return;
    }

    // Medir largura real do container para SVG nítido 1:1
    const rectW = wrapSvg.getBoundingClientRect().width;
    const width = Math.max(340, Math.round((rectW > 80 ? rectW : 960) - 20));
    const ehCompacto = width < 580;
    const height = ehCompacto ? 340 : 450;

    const padL = ehCompacto ? 50 : 62;
    const padR = ehCompacto ? 20 : 28;
    const padT = 26;
    const padB = 42;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    // Domínio inteligente com clamp suave de outliers extremos
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

    // Grade X e Y
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

    // Coordenadas de tela de cada ponto
    const renderPts = pontos.map(p => {
      const cx = mapX(p.valX);
      const cy = mapY(p.valY);
      const clamped = p.valX < domMinX || p.valX > domMaxX || p.valY < domMinY || p.valY > domMaxY;
      const nota = p.ativo.sustentabilidade?.nota ?? 50;
      const ehCilada = p.ativo.sustentabilidade?.nivel === 'alerta';
      const r = p.matchBusca && qBusca ? 7.8 : (5.4 + (Math.max(0, nota) / 100) * 2.2);
      return { ...p, cx, cy, r, clamped, ehCilada };
    });

    state.matrizPontosRender = renderPts;

    // Seleção gananciosa sem colisão para rótulos diretos nos melhores pontos
    const caixasRotulos = [];
    const candidatosRotulo = [...renderPts]
      .filter(p => !qBusca || p.matchBusca)
      .sort((a, b) => {
        if (qBusca && a.matchBusca !== b.matchBusca) return a.matchBusca ? -1 : 1;
        const prioQ = { ouro: 0, atencao: 1, premio: 2, evitar: 3 };
        if (prioQ[a.quadrante] !== prioQ[b.quadrante]) return prioQ[a.quadrante] - prioQ[b.quadrante];
        return (b.valX + b.valY) - (a.valX + a.valY);
      });

    const maxLabels = ehCompacto ? 14 : 30;
    const rotulosEscolhidos = [];
    for (const p of candidatosRotulo) {
      if (rotulosEscolhidos.length >= maxLabels) break;
      const wTxt = p.ticker.length * 7.2 + 6;
      const hTxt = 14;
      const lx = p.cx + p.r + 5 + wTxt > width - padR ? p.cx - p.r - 5 - wTxt : p.cx + p.r + 5;
      const ly = clamp(p.cy + 4, padT + 12, padT + plotH - 4);
      const box = { x1: lx - 2, y1: ly - hTxt + 2, x2: lx + wTxt + 2, y2: ly + 3 };

      const colideCaixa = caixasRotulos.some(b => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2));
      const colidePonto = renderPts.some(o => o.ticker !== p.ticker && o.cx >= box.x1 - 2 && o.cx <= box.x2 + 2 && o.cy >= box.y1 - 2 && o.cy <= box.y2 + 2);
      if (!colideCaixa && !colidePonto) {
        caixasRotulos.push(box);
        rotulosEscolhidos.push({ p, lx, ly });
      }
    }

    const nomeXCurto = state.matrizX === 'graham' ? 'Margem Graham' : 'Margem Bazin (K=6%)';
    const nomeYCurto = state.matrizY === 'roic' ? 'ROIC' : 'ROE';

    // Área sombreada do Quadrante Ouro (topo direito: x >= xZero e y <= yRef)
    const ouroX = clamp(xZero, padL, padL + plotW);
    const ouroY = clamp(yRef, padT, padT + plotH);
    const ouroW = Math.max(0, padL + plotW - ouroX);
    const ouroH = Math.max(0, ouroY - padT);

    const gridLinesSvg = [
      ...ticksX.map(tx => {
        const px = mapX(tx);
        return `
          <line x1="${px.toFixed(1)}" y1="${padT}" x2="${px.toFixed(1)}" y2="${padT + plotH}" stroke="#1b2430" stroke-width="1"/>
          <text x="${px.toFixed(1)}" y="${padT + plotH + 18}" text-anchor="middle" class="vsvg-axis-text" stroke="none">${fPct(tx, 0)}</text>
        `;
      }),
      ...ticksY.map(ty => {
        const py = mapY(ty);
        return `
          <line x1="${padL}" y1="${py.toFixed(1)}" x2="${padL + plotW}" y2="${py.toFixed(1)}" stroke="#1b2430" stroke-width="1"/>
          <text x="${padL - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end" class="vsvg-axis-text" stroke="none">${fPctSimples(ty, 0)}</text>
        `;
      })
    ].join('');

    const watermarksSvg = ehCompacto ? '' : `
      <text x="${padL + plotW - 10}" y="${padT + 18}" text-anchor="end" class="vsvg-ceil-label" fill="#2fbf86" opacity="0.72" stroke="none">QUADRANTE OURO (DESCONTO + QUALIDADE)</text>
      <text x="${padL + 10}" y="${padT + 18}" text-anchor="start" class="vsvg-ceil-label" fill="#5b8def" opacity="0.6" stroke="none">QUALIDADE CARA</text>
      <text x="${padL + plotW - 10}" y="${padT + plotH - 10}" text-anchor="end" class="vsvg-ceil-label" fill="#e0b341" opacity="0.58" stroke="none">DESCONTO · CHECAR ANTI-CILADA</text>
      <text x="${padL + 10}" y="${padT + plotH - 10}" text-anchor="start" class="vsvg-ceil-label" fill="#e5636b" opacity="0.52" stroke="none">CARAS &amp; BAIXO RETORNO</text>
    `;

    const dotsSvg = renderPts.map(p => {
      if (state.matrizQuadrante !== 'todos' && p.quadrante !== state.matrizQuadrante) {
        return `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="3.5" fill="#3a4659" opacity="0.22"/>`;
      }
      const cor = QUADRANTES_META[p.quadrante].cor;
      const op = qBusca ? (p.matchBusca ? 0.96 : 0.16) : 0.86;
      const strokeCor = p.ehCilada ? '#e5636b' : '#0b1017';
      const strokeW = p.ehCilada ? 2.0 : 1.3;
      const halo = (qBusca && p.matchBusca)
        ? `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 4.5).toFixed(1)}" fill="none" stroke="${cor}" stroke-width="1.6" opacity="0.65"/>`
        : '';
      return `
        ${halo}
        <circle class="m-dot" data-mticker="${escH(p.ticker)}" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.r.toFixed(1)}"
          fill="${cor}" fill-opacity="${op}" stroke="${strokeCor}" stroke-width="${strokeW}" ${p.clamped ? 'stroke-dasharray="2 1.5"' : ''}/>
      `;
    }).join('');

    const labelsSvg = rotulosEscolhidos.map(({ p, lx, ly }) => {
      if (state.matrizQuadrante !== 'todos' && p.quadrante !== state.matrizQuadrante) return '';
      const op = qBusca && !p.matchBusca ? 0.2 : 0.94;
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="vsvg-ceil-label" fill="#e2e8f0" opacity="${op}" stroke="none">${escH(p.ticker)}</text>`;
    }).join('');

    wrapSvg.innerHTML = `
      <svg class="vsvg" id="matriz-scatter-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Matriz Desconto versus Qualidade">
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#0c1118" rx="4"/>
        ${ouroW > 0 && ouroH > 0 ? `<rect x="${ouroX.toFixed(1)}" y="${padT}" width="${ouroW.toFixed(1)}" height="${ouroH.toFixed(1)}" fill="#2fbf86" opacity="0.055"/>` : ''}
        ${gridLinesSvg}
        ${xZero >= padL && xZero <= padL + plotW ? `
          <line x1="${xZero.toFixed(1)}" y1="${padT}" x2="${xZero.toFixed(1)}" y2="${padT + plotH}" stroke="#2fbf86" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.75"/>
        ` : ''}
        ${yRef >= padT && yRef <= padT + plotH ? `
          <line x1="${padL}" y1="${yRef.toFixed(1)}" x2="${padL + plotW}" y2="${yRef.toFixed(1)}" stroke="#5b8def" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.75"/>
        ` : ''}
        ${watermarksSvg}
        <g id="matriz-dots-layer">${dotsSvg}</g>
        <g id="matriz-labels-layer" pointer-events="none">${labelsSvg}</g>
        <g id="matriz-hover-ring" pointer-events="none"></g>
        <text x="${(padL + plotW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="vsvg-axis-text" fill="#64748b" stroke="none">${nomeXCurto} → (direita = mais descontada abaixo do teto)</text>
        <rect class="v-hit-area" id="matriz-hit-rect" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"/>
      </svg>
    `;

    renderizarHudMatriz(null, renderPts.length, excluidosSemDados);
    conectarInteracaoSvgMatriz();
    renderizarTabelaMatriz(renderPts, usouFallbackTodos);
  }

  function conectarInteracaoSvgMatriz() {
    const svg = qs('#matriz-scatter-svg');
    const hit = qs('#matriz-hit-rect');
    const ringLayer = qs('#matriz-hover-ring');
    if (!svg || !hit || !ringLayer) return;

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

    hit.addEventListener('pointermove', (evt) => {
      const p = localizarPonto(evt);
      if (!p) {
        state.matrizHoverTicker = null;
        ringLayer.innerHTML = '';
        hit.style.cursor = 'crosshair';
        renderizarHudMatriz(null, state.matrizPontosRender.length, 0);
        return;
      }
      state.matrizHoverTicker = p.ticker;
      hit.style.cursor = 'pointer';
      const cor = QUADRANTES_META[p.quadrante].cor;
      ringLayer.innerHTML = `
        <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 5).toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="2"/>
        <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${(p.r + 8).toFixed(1)}" fill="none" stroke="${cor}" stroke-width="1.5" opacity="0.7"/>
      `;
      renderizarHudMatriz(p, state.matrizPontosRender.length, 0);
    });

    hit.addEventListener('pointerleave', () => {
      state.matrizHoverTicker = null;
      ringLayer.innerHTML = '';
      renderizarHudMatriz(null, state.matrizPontosRender.length, 0);
    });

    hit.addEventListener('click', (evt) => {
      const p = localizarPonto(evt);
      if (p && typeof window.abrirDetalhe === 'function') {
        window.abrirDetalhe(p.ticker);
      }
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

    const nomeX = state.matrizX === 'graham' ? 'Margem Graham' : 'Margem Bazin';
    const nomeTeto = state.matrizX === 'graham' ? 'Graham' : 'Teto Bazin';
    const nomeY = state.matrizY === 'roic' ? 'ROIC' : 'ROE';
    const tituloFiltro = state.matrizQuadrante === 'todos'
      ? 'Todos os quadrantes'
      : QUADRANTES_META[state.matrizQuadrante]?.titulo;

    wrap.innerHTML = `
      <div class="vsub-table-head" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
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
                    <span class="mquad-pill" style="--q-color:${qm.cor}">${escH(qm.titulo)}</span>
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
                    <div class="row-actions" style="opacity:1">
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
      b.classList.toggle('is-active', b.dataset.cscope === state.calEscopo);
    });
    document.querySelectorAll('#cal-paymode-group [data-cpaymode]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.cpaymode === state.calModoPgto);
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
    const { lista: baseEscopo } = filtrarPorEscopo(state.calEscopo);
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

    // Coletar eventos confirmados de data-com em aberto e pagamentos agendados no escopo filtrado
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

    // Sazonalidade e cobertura de 12 meses da seleção
    const mesesCobertos = [];
    for (let m = 1; m <= 12; m += 1) {
      const qtdMes = baseEscopo.filter(a => Array.isArray(a.meses_habituais_dividendo) && a.meses_habituais_dividendo.includes(m)).length;
      mesesCobertos.push({ mes: m, qtd: qtdMes });
    }
    const totalMesesComRenda = mesesCobertos.filter(x => x.qtd > 0).length;
    const pagadoresMesAtual = baseEscopo.filter(a => Array.isArray(a.meses_habituais_dividendo) && a.meses_habituais_dividendo.includes(mesAtualNum));

    const proxCom = eventosDataComAberta[0];
    const proxPgto = eventosPagamentosAgendados[0];

    // 1. Renderizar 4 KPIs executivos do Calendário
    kpiEl.innerHTML = `
      <div class="kpi" style="--kpi-color: var(--green)" data-tip="Eventos oficiais anunciados à B3 cuja data-com ainda está em aberto (hoje ou futura)">
        <div class="kpi-label">Datas-Com em aberto</div>
        <div class="kpi-value t-green">${eventosDataComAberta.length}</div>
        <div class="kpi-foot">${proxCom ? `Próxima: ${escH(proxCom.ativo.ticker)} em ${fDataCurtaIso(proxCom.ev.data_com)} (${rotuloContagemDias(diasEntreIso(proxCom.ev.data_com, hoje))})` : 'Nenhum anúncio em aberto no filtro'}</div>
      </div>
      <div class="kpi" style="--kpi-color: var(--accent)" data-tip="Proventos já aprovados com depósito agendado para os próximos dias/meses">
        <div class="kpi-label">Pagamentos agendados</div>
        <div class="kpi-value">${eventosPagamentosAgendados.length}</div>
        <div class="kpi-foot">${proxPgto ? `Próximo: ${escH(proxPgto.ativo.ticker)} em ${fDataCurtaIso(proxPgto.ev.data_pagamento)} (${fRealProvento(proxPgto.ev.valor)})` : 'Sem pagamentos agendados no filtro'}</div>
      </div>
      <div class="kpi" style="--kpi-color: var(--yellow)" data-tip="Ativos do escopo que historicamente têm data-com recorrente neste mês (${MESES_NOMES[mesAtualNum - 1]})">
        <div class="kpi-label">Sazonais em ${MESES_NOMES[mesAtualNum - 1]}</div>
        <div class="kpi-value">${pagadoresMesAtual.length}</div>
        <div class="kpi-foot">${pagadoresMesAtual.length ? escH(pagadoresMesAtual.slice(0, 4).map(a => a.ticker).join(', ') + (pagadoresMesAtual.length > 4 ? '…' : '')) : 'Sem recorrência habitual neste mês'}</div>
      </div>
      <div class="kpi" style="--kpi-color: var(--green)" data-tip="Quantos meses do ano possuem pelo menos um ativo com histórico habitual de data-com neste escopo">
        <div class="kpi-label">Cobertura anual de renda</div>
        <div class="kpi-value">${totalMesesComRenda}<span class="t-dim" style="font-size:14px"> / 12 meses</span></div>
        <div class="cal-mini-months" aria-hidden="true">
          ${mesesCobertos.map(mc => `<span class="${mc.qtd > 0 ? 'is-on' : ''} ${mc.mes === mesAtualNum ? 'is-now' : ''}" title="${MESES_CURTOS[mc.mes - 1]}: ${mc.qtd} ativos"></span>`).join('')}
        </div>
      </div>
    `;

    // 2. Coluna Esquerda: Próximas Datas-Com Anunciadas (Direito em Aberto)
    if (!eventosDataComAberta.length) {
      const totalUnivAbertas = obterUniverso().reduce((acc, a) => {
        const n = (a.agenda_anunciada || []).filter(ev => ev.status === 'anunciado' && ev.data_com >= hoje).length;
        return acc + n;
      }, 0);
      upComEl.innerHTML = `
        <div class="cal-empty">
          <strong>Nenhuma data-com em aberto neste filtro</strong>
          <span>As empresas da B3 anunciam datas-com alguns dias antes do corte. Consulte o mapa sazonal abaixo para ver os meses habituais de anúncio.</span>
          ${totalUnivAbertas > 0 && state.calEscopo !== 'todos'
            ? `<button type="button" class="btn btn-ghost" style="margin-top:10px" data-cal-show-all>Ver ${totalUnivAbertas} datas-com abertas em Todos os ativos</button>`
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

    // 3. Coluna Direita: Pagamentos Agendados (Caixa) OU Últimos Pagos
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

    // 4. Mapa Sazonal 12 Meses (Jan–Dez)
    const ordenadosMapa = [...listaFiltrada]
      .filter(a => {
        // Em "Todos" ou "Painel", coloca pagadoras primeiro e sem dividendos ao final
        return true;
      })
      .sort((a, b) => {
        const pa = a.proxima_data_com ? 1 : 0;
        const pb = b.proxima_data_com ? 1 : 0;
        if (pb !== pa) return pb - pa;
        const ma = (a.meses_habituais_dividendo || []).length;
        const mb = (b.meses_habituais_dividendo || []).length;
        if (mb !== ma) return mb - ma;
        return (b.bazin?.margem_seguranca ?? -9) - (a.bazin?.margem_seguranca ?? -9);
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
                      <span class="mono" style="font-weight:600;color:var(--text-strong)">${escH(a.ticker)}</span>
                      <span class="t-dim" style="font-size:11px;text-transform:capitalize">${escH(a.setor)}</span>
                    </div>
                  </td>
                  <td>${htmlSeloSustentabilidade(a, false)}</td>
                  <td style="white-space:nowrap;font-size:12px">${resumoAgenda}</td>
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
                          ${anunciado ? '★' : (freq > 0 ? `${freq}/5` : '·')}
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
   * EVENTOS DAS DUAS NOVAS ABAS
   * ========================================================================== */

  function bindEventosMatrizCalendario() {
    // --- Eventos da Matriz ---
    qs('#matriz-scope-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mscope]');
      if (!b) return;
      state.matrizEscopo = b.dataset.mscope;
      salvarPrefs();
      renderizarMatrizValuation();
    });

    qs('#matriz-xaxis-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mx]');
      if (!b) return;
      state.matrizX = b.dataset.mx;
      salvarPrefs();
      renderizarMatrizValuation();
    });

    qs('#matriz-yaxis-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-my]');
      if (!b) return;
      state.matrizY = b.dataset.my;
      salvarPrefs();
      renderizarMatrizValuation();
    });

    qs('#matriz-notrap-btn')?.addEventListener('click', () => {
      state.matrizSemCilada = !state.matrizSemCilada;
      salvarPrefs();
      renderizarMatrizValuation();
    });

    qs('#matriz-search-input')?.addEventListener('input', (e) => {
      state.matrizBusca = e.target.value || '';
      renderizarMatrizValuation();
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
      if (btnChart && typeof window.abrirNaVisaoGrafica === 'function') {
        e.stopPropagation();
        window.abrirNaVisaoGrafica(btnChart.dataset.mopenChart);
        return;
      }
      const row = e.target.closest('[data-mopen-detail]');
      if (row && typeof window.abrirDetalhe === 'function') {
        window.abrirDetalhe(row.dataset.mopenDetail);
      }
    });

    // --- Eventos do Calendário ---
    qs('#cal-scope-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cscope]');
      if (!b) return;
      state.calEscopo = b.dataset.cscope;
      salvarPrefs();
      renderizarCalendarioDividendos();
    });

    qs('#cal-month-select')?.addEventListener('change', (e) => {
      state.calMes = Number(e.target.value) || 0;
      renderizarCalendarioDividendos();
    });

    qs('#cal-cur-month-btn')?.addEventListener('click', () => {
      const mAtual = Number(hojeIsoB3().slice(5, 7)) || (new Date().getMonth() + 1);
      state.calMes = state.calMes === mAtual ? 0 : mAtual;
      renderizarCalendarioDividendos();
    });

    qs('#cal-paymode-group')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cpaymode]');
      if (!b) return;
      state.calModoPgto = b.dataset.cpaymode;
      salvarPrefs();
      renderizarCalendarioDividendos();
    });

    qs('#cal-search-input')?.addEventListener('input', (e) => {
      state.calBusca = e.target.value || '';
      renderizarCalendarioDividendos();
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
      if (alvo && typeof window.abrirDetalhe === 'function') {
        window.abrirDetalhe(alvo.dataset.copenDetail);
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
  window.renderizarCalendarioDividendos = renderizarCalendarioDividendos;

  window.addEventListener('DOMContentLoaded', bindEventosMatrizCalendario);
})();
