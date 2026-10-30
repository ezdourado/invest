/**
 * Visão Gráfica & Simulador de Dividendos (index.html)
 * ---------------------------------------------------------------------------
 * Consome o objeto global `window.VALUATION_DATA` (carregado por data.js) e:
 *  1. Popula a seção "Demais Papéis Fora do Painel" na aba de Tabela.
 *  2. Gerencia a navegação por abas (Tabela / Gráficos / Matriz / Calendário).
 *  3. Renderiza a aba Gráficos & Simulador:
 *     - Explorador lateral recolhível com busca (debounce 150ms) e filtro único
 *     - Cabeçalho do ativo em foco com 4 mini-KPIs e data_ult_cot real
 *     - Gráfico SVG Preço vs. Preços-Teto (460px desktop, paleta sem colisão,
 *       zona sombreada rotulada, legenda interativa aria-pressed, tooltip rAF)
 *     - Diagnóstico "Barato há muito tempo?" integrado ao Score Anti-Cilada
 *     - Simulador de Rendimento Total (Preço + Proventos) com área empilhada
 *  4. Zero atributos `style` inline (usa classes CSS, SVGs e regras dinâmicas).
 */

(function () {
  'use strict';

  var COR_PRECO = '#60a5fa';
  var COR_BAZIN = '#06b6d4';
  var COR_GRAHAM = '#a855f7';
  var COR_GORDON = '#f472b6';
  var CORES_COMPARACAO = ['#f97316', '#14b8a6', '#eab308', '#ec4899'];

  var estadoVisual = {
    abaAtiva: 'tabela',
    tickerPrincipal: null,
    tickersComparados: [],
    filtroSidebar: 'todos',
    buscaSidebar: '',
    sidebarRecolhida: false,
    periodoAnos: 5,
    modoGrafico: 'price', // 'price' | 'norm'
    mostrarTetos: {
      bazin: true,
      graham: true,
      gordon: true
    },
    simAnos: 5,
    simReinvestir: true,
    simDescontarIrJcp: true
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoeda(v, casas) {
    var d = casas !== undefined ? casas : 2;
    if (v === null || v === undefined || isNaN(v)) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  function fmtNumero(v, casas) {
    var d = casas !== undefined ? casas : 2;
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toLocaleString('pt-BR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  function fmtPct(v, casas, comSinal) {
    var d = casas !== undefined ? casas : 1;
    if (v === null || v === undefined || isNaN(v)) return '—';
    var n = Number(v) * 100;
    var prefixo = comSinal && n > 0 ? '+' : '';
    return prefixo + n.toLocaleString('pt-BR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    }) + '%';
  }

  function fmtDataCurta(isoStr) {
    if (!isoStr) return '—';
    var partes = String(isoStr).split('-');
    if (partes.length !== 3) return isoStr;
    return partes[2] + '/' + partes[1] + '/' + partes[0];
  }

  function fmtDiaMes(isoStr) {
    if (!isoStr) return '—';
    var partes = String(isoStr).split('-');
    if (partes.length !== 3) return isoStr;
    return partes[2] + '/' + partes[1];
  }

  function fmtMesAno(isoStr) {
    if (!isoStr) return '';
    var partes = String(isoStr).split('-');
    if (partes.length < 2) return isoStr;
    var meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    var m = parseInt(partes[1], 10) - 1;
    return (meses[m] || partes[1]) + '/' + partes[0].slice(2);
  }

  function obterAtivos() {
    if (!window.VALUATION_DATA || !Array.isArray(window.VALUATION_DATA.ativos)) {
      return [];
    }
    return window.VALUATION_DATA.ativos;
  }

  function obterDatasHistorico() {
    if (!window.VALUATION_DATA || !Array.isArray(window.VALUATION_DATA.historico_datas)) {
      return [];
    }
    return window.VALUATION_DATA.historico_datas;
  }

  function buscarAtivo(ticker) {
    if (!ticker) return null;
    var t = String(ticker).toUpperCase().trim();
    var lista = obterAtivos();
    for (var i = 0; i < lista.length; i++) {
      if (String(lista[i].ticker).toUpperCase() === t) return lista[i];
    }
    return null;
  }

  function ativoEstaNoPainelPadrao(a) {
    if (typeof window.obterTickersPainelAtivo === 'function') {
      var lista = window.obterTickersPainelAtivo();
      if (Array.isArray(lista) && lista.length > 0) {
        return lista.indexOf(a.ticker) !== -1;
      }
    }
    return a.painel_padrao !== false;
  }

  function obterMargemBazin(a) {
    if (!a || !a.bazin || a.bazin.margem === null || a.bazin.margem === undefined) return null;
    return Number(a.bazin.margem);
  }

  function obterTetoBazin(a) {
    if (!a || !a.bazin || a.bazin.preco_teto === null || a.bazin.preco_teto === undefined) return null;
    return Number(a.bazin.preco_teto);
  }

  function obterDpaMedio(a) {
    if (!a || !a.bazin || a.bazin.dpa_medio_5a === null || a.bazin.dpa_medio_5a === undefined) return 0;
    return Number(a.bazin.dpa_medio_5a);
  }

  function obterDyAtual(a) {
    if (!a) return null;
    if (a.fundamentos && a.fundamentos.dy_12m !== null && a.fundamentos.dy_12m !== undefined) {
      return Number(a.fundamentos.dy_12m);
    }
    var dpa = obterDpaMedio(a);
    if (dpa > 0 && a.preco > 0) return dpa / a.preco;
    return null;
  }

  function classificarVereditoBazin(a) {
    var m = obterMargemBazin(a);
    var teto = obterTetoBazin(a);
    if (teto === null || teto <= 0 || m === null) {
      return { classe: 'tag-warn', rotulo: '● Sem teto Bazin' };
    }
    if (m >= 0.15) return { classe: 'tag-ok', rotulo: '▲ Abaixo do teto' };
    if (m >= 0) return { classe: 'tag-warn', rotulo: '● Próximo do teto' };
    return { classe: 'tag-bad', rotulo: '▼ Acima do teto' };
  }

  /* ==========================================================================
   * 1. SEÇÃO "DEMAIS PAPÉIS (FORA DO PAINEL)" NA ABA TABELA
   * ========================================================================== */

  function renderizarDemaisPapeisCard() {
    var container = el('extra-categories-grid');
    if (!container) return;

    var todos = obterAtivos();
    var extras = todos.filter(function (a) {
      return !ativoEstaNoPainelPadrao(a);
    });

    if (extras.length === 0) {
      container.innerHTML = '';
      return;
    }

    extras.sort(function (a, b) {
      var ma = obterMargemBazin(a);
      var mb = obterMargemBazin(b);
      if (ma === null && mb === null) return String(a.ticker).localeCompare(String(b.ticker));
      if (ma === null) return 1;
      if (mb === null) return -1;
      return mb - ma;
    });

    var baratos = extras.filter(function (a) {
      var m = obterMargemBazin(a);
      return m !== null && m >= 0;
    }).length;

    var chipsHtml = extras.slice(0, 14).map(function (a) {
      var m = obterMargemBazin(a);
      var corCls = m === null ? '' : (m >= 0.15 ? 'pos' : (m >= 0 ? 'warn' : 'neg'));
      var mTxt = m !== null ? fmtPct(m, 0, true) : (a.margem_graham !== null ? 'Gr ' + fmtPct(a.margem_graham, 0, true) : '—');
      return (
        '<button type="button" class="extra-ticker-chip" data-open-visual="' + esc(a.ticker) + '" ' +
          'title="' + esc(a.empresa || a.ticker) + ' • ' + esc(a.setor || 'Demais papéis') + ' — Abrir nos Gráficos">' +
          '<span class="etc-ticker">' + esc(a.ticker) + '</span>' +
          '<span class="etc-price">' + fmtMoeda(a.preco) + '</span>' +
          '<span class="etc-margin ' + corCls + '">' + mTxt + '</span>' +
        '</button>'
      );
    }).join('');

    var restantes = extras.length > 14 ? extras.length - 14 : 0;

    container.innerHTML =
      '<div class="extra-category-banner">' +
        '<div class="ecb-info">' +
          '<div class="ecb-title-row">' +
            '<span class="ecb-badge">Demais papéis B3</span>' +
            '<h3 class="ecb-title">Ações fora da seleção ativa (' + extras.length + ' monitoradas · ' + baratos + ' abaixo do teto Bazin)</h3>' +
          '</div>' +
          '<p class="ecb-desc">' +
            'Inclui blue chips, varejo, indústria, saúde, tecnologia e agropecuária para comparação histórica de preços-teto e simulação com dividendos.' +
          '</p>' +
        '</div>' +
        '<div class="ecb-chips">' +
          chipsHtml +
          (restantes > 0
            ? '<button type="button" class="extra-ticker-more" id="btn-ver-todos-extras">+' + restantes + ' na visão gráfica →</button>'
            : '') +
        '</div>' +
      '</div>';

    var botoes = container.querySelectorAll('[data-open-visual]');
    for (var i = 0; i < botoes.length; i++) {
      botoes[i].addEventListener('click', function () {
        var tk = this.getAttribute('data-open-visual');
        abrirAtivoNaVisaoGrafica(tk);
      });
    }

    var btnTodos = el('btn-ver-todos-extras');
    if (btnTodos) {
      btnTodos.addEventListener('click', function () {
        estadoVisual.filtroSidebar = 'extras';
        sincronizarBotoesFiltroSidebar();
        alternarAbaPrincipal('visual');
      });
    }
  }

  /* ==========================================================================
   * 2. NAVEGAÇÃO ENTRE ABAS (TABELA vs GRÁFICOS vs MATRIZ vs CALENDÁRIO)
   * ========================================================================== */

  function alternarAbaPrincipal(aba, opcoes) {
    var abasValidas = ['tabela', 'visual', 'matriz', 'calendario'];
    var escolhida = abasValidas.indexOf(aba) !== -1 ? aba : 'tabela';
    estadoVisual.abaAtiva = escolhida;

    var mapaPaineis = {
      tabela: el('view-tabela'),
      visual: el('view-visual'),
      matriz: el('view-matriz'),
      calendario: el('view-calendario')
    };

    for (var k in mapaPaineis) {
      if (!mapaPaineis[k]) continue;
      if (k === escolhida) {
        mapaPaineis[k].classList.remove('is-hidden');
      } else {
        mapaPaineis[k].classList.add('is-hidden');
      }
    }

    var botoesAba = document.querySelectorAll('[data-view-tab]');
    for (var i = 0; i < botoesAba.length; i++) {
      var btn = botoesAba[i];
      var t = btn.getAttribute('data-view-tab');
      if (t === escolhida) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    }

    if (escolhida === 'visual') {
      garantirAtivoInicialSelecionado();
      renderizarVisaoGraficaCompleta();
    } else if (escolhida === 'matriz' && typeof window.renderizarAbaMatriz === 'function') {
      window.renderizarAbaMatriz();
    } else if (escolhida === 'calendario' && typeof window.renderizarAbaCalendario === 'function') {
      window.renderizarAbaCalendario();
    }

    if (!opcoes || !opcoes.semHash) {
      if (typeof window.sincronizarEstadoUrl === 'function') {
        window.sincronizarEstadoUrl();
      }
    }
  }

  function abrirAtivoNaVisaoGrafica(ticker) {
    if (ticker && buscarAtivo(ticker)) {
      estadoVisual.tickerPrincipal = String(ticker).toUpperCase();
    }
    alternarAbaPrincipal('visual');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.abrirAtivoNaVisaoGrafica = abrirAtivoNaVisaoGrafica;
  window.alternarAbaPrincipal = alternarAbaPrincipal;

  /* ==========================================================================
   * 3. EXPLORADOR DE PAPÉIS (SIDEBAR) E COMPARAÇÃO
   * ========================================================================== */

  function garantirAtivoInicialSelecionado() {
    if (estadoVisual.tickerPrincipal && buscarAtivo(estadoVisual.tickerPrincipal)) {
      return;
    }
    var todos = obterAtivos();
    if (todos.length === 0) return;

    var candidatos = todos.filter(function (a) {
      return a.bazin && a.bazin.preco_teto > 0 && Array.isArray(a.historico_precos) && a.historico_precos.length > 20;
    });
    candidatos.sort(function (a, b) {
      return (obterMargemBazin(b) || -99) - (obterMargemBazin(a) || -99);
    });

    estadoVisual.tickerPrincipal = (candidatos[0] || todos[0]).ticker;
  }

  function filtrarAtivosSidebar() {
    var todos = obterAtivos();
    var q = (estadoVisual.buscaSidebar || '').trim().toUpperCase();
    var filtro = estadoVisual.filtroSidebar;

    var filtrados = todos.filter(function (a) {
      if (filtro === 'painel' && !ativoEstaNoPainelPadrao(a)) return false;
      if (filtro === 'besst' && !a.besst) return false;
      if (filtro === 'extras' && ativoEstaNoPainelPadrao(a)) return false;

      if (q) {
        var texto = (
          String(a.ticker || '') + ' ' +
          String(a.empresa || '') + ' ' +
          String(a.setor || '')
        ).toUpperCase();
        if (texto.indexOf(q) === -1) return false;
      }
      return true;
    });

    filtrados.sort(function (a, b) {
      var ma = obterMargemBazin(a);
      var mb = obterMargemBazin(b);
      if (ma === null && mb === null) return String(a.ticker).localeCompare(String(b.ticker));
      if (ma === null) return 1;
      if (mb === null) return -1;
      return mb - ma;
    });

    return filtrados;
  }

  function renderizarListaSidebar() {
    var container = el('visual-asset-list');
    var countEl = el('visual-asset-count');
    if (!container) return;

    var lista = filtrarAtivosSidebar();
    if (countEl) {
      countEl.textContent = lista.length + (lista.length === 1 ? ' ativo' : ' ativos');
    }

    if (lista.length === 0) {
      container.innerHTML =
        '<div class="vside-empty">Nenhum papel encontrado para o filtro atual.</div>';
      return;
    }

    var exibirTagBesst = estadoVisual.filtroSidebar !== 'besst';

    var html = lista.map(function (a) {
      var ehPrincipal = a.ticker === estadoVisual.tickerPrincipal;
      var idxComp = estadoVisual.tickersComparados.indexOf(a.ticker);
      var ehComparado = idxComp !== -1;

      var m = obterMargemBazin(a);
      var clsMargem = m === null ? 'neutral' : (m >= 0.15 ? 'pos' : (m >= 0 ? 'warn' : 'neg'));
      var txtMargem = m !== null ? fmtPct(m, 1, true) : 'S/D';

      var tagBesst = (exibirTagBesst && a.besst)
        ? '<span class="vitem-tag besst">BESST</span>'
        : '';

      return (
        '<div class="vasset-item' + (ehPrincipal ? ' is-primary' : '') + (ehComparado ? ' is-compared' : '') + '" data-ticker-row="' + esc(a.ticker) + '">' +
          '<button type="button" class="vasset-main-btn" data-select-primary="' + esc(a.ticker) + '">' +
            '<div class="vasset-top">' +
              '<span class="vasset-ticker">' + esc(a.ticker) + '</span>' +
              tagBesst +
              '<span class="vasset-price">' + fmtMoeda(a.preco) + '</span>' +
            '</div>' +
            '<div class="vasset-bottom">' +
              '<span class="vasset-name">' + esc(a.empresa || a.setor || '') + '</span>' +
              '<span class="vasset-margin ' + clsMargem + '">' + txtMargem + '</span>' +
            '</div>' +
          '</button>' +
          '<button type="button" class="vasset-cmp-btn' + (ehComparado ? ' active' : '') + '" ' +
            'data-toggle-compare="' + esc(a.ticker) + '" ' +
            (ehPrincipal ? 'disabled title="Ativo principal em foco"' : 'title="Comparar no gráfico (máx. 4)"') + '>' +
            (ehComparado ? '✓' : '+') +
          '</button>' +
        '</div>'
      );
    }).join('');

    container.innerHTML = html;

    var btnsMain = container.querySelectorAll('[data-select-primary]');
    for (var i = 0; i < btnsMain.length; i++) {
      btnsMain[i].addEventListener('click', function () {
        var tk = this.getAttribute('data-select-primary');
        selecionarAtivoPrincipal(tk);
      });
    }

    var btnsCmp = container.querySelectorAll('[data-toggle-compare]');
    for (var j = 0; j < btnsCmp.length; j++) {
      btnsCmp[j].addEventListener('click', function (ev) {
        ev.stopPropagation();
        var tk = this.getAttribute('data-toggle-compare');
        alternarComparacaoTicker(tk);
      });
    }
  }

  function selecionarAtivoPrincipal(ticker) {
    if (!ticker || !buscarAtivo(ticker)) return;
    var tk = String(ticker).toUpperCase();
    estadoVisual.tickerPrincipal = tk;

    var idx = estadoVisual.tickersComparados.indexOf(tk);
    if (idx !== -1) {
      estadoVisual.tickersComparados.splice(idx, 1);
    }

    renderizarVisaoGraficaCompleta();
    if (typeof window.sincronizarEstadoUrl === 'function') {
      window.sincronizarEstadoUrl();
    }
  }

  function alternarComparacaoTicker(ticker) {
    if (!ticker) return;
    var tk = String(ticker).toUpperCase();
    if (tk === estadoVisual.tickerPrincipal) return;

    var idx = estadoVisual.tickersComparados.indexOf(tk);
    if (idx !== -1) {
      estadoVisual.tickersComparados.splice(idx, 1);
    } else {
      if (estadoVisual.tickersComparados.length >= 4) {
        estadoVisual.tickersComparados.shift();
      }
      estadoVisual.tickersComparados.push(tk);
      if (estadoVisual.tickersComparados.length === 1 && estadoVisual.modoGrafico === 'price') {
        estadoVisual.modoGrafico = 'norm';
        sincronizarBotoesModoGrafico();
      }
    }

    renderizarVisaoGraficaCompleta();
    if (typeof window.sincronizarEstadoUrl === 'function') {
      window.sincronizarEstadoUrl();
    }
  }

  function renderizarBarraComparacao() {
    var chipsEl = el('visual-compare-chips');
    var clearBtn = el('visual-clear-compare');
    if (!chipsEl) return;

    var principal = buscarAtivo(estadoVisual.tickerPrincipal);
    var html = '';

    if (principal) {
      html +=
        '<span class="vcmp-chip primary">' +
          '<span class="vcmp-dot dot-price"></span>' +
          '<strong>' + esc(principal.ticker) + '</strong> (foco)' +
        '</span>';
    }

    estadoVisual.tickersComparados.forEach(function (tk, i) {
      var clsCor = 'dot-cmp-' + (i % CORES_COMPARACAO.length);
      html +=
        '<span class="vcmp-chip compared">' +
          '<span class="vcmp-dot ' + clsCor + '"></span>' +
          '<strong>' + esc(tk) + '</strong>' +
          '<button type="button" class="vcmp-remove" data-remove-cmp="' + esc(tk) + '" title="Remover da comparação">×</button>' +
        '</span>';
    });

    if (estadoVisual.tickersComparados.length === 0) {
      html += '<span class="vcmp-empty">Clique no botão <strong>+</strong> de outro ativo na lista ao lado para comparar desempenho.</span>';
    }

    chipsEl.innerHTML = html;

    if (clearBtn) {
      if (estadoVisual.tickersComparados.length > 0) {
        clearBtn.classList.remove('is-hidden');
      } else {
        clearBtn.classList.add('is-hidden');
      }
    }

    var rmBtns = chipsEl.querySelectorAll('[data-remove-cmp]');
    for (var i = 0; i < rmBtns.length; i++) {
      rmBtns[i].addEventListener('click', function () {
        var tk = this.getAttribute('data-remove-cmp');
        alternarComparacaoTicker(tk);
      });
    }
  }

  /* ==========================================================================
   * 4. CABEÇALHO DO ATIVO EM FOCO + GRÁFICO SVG (PREÇO × PREÇOS-TETO)
   * ========================================================================== */

  function renderizarCabecalhoAtivoPrincipal(ativo) {
    if (!ativo) return;
    var tkEl = el('visual-focus-ticker');
    var nmEl = el('visual-focus-name');
    var bgEl = el('visual-focus-badges');
    var prEl = el('visual-focus-price');
    var vrEl = el('visual-focus-verdict');
    var kpisEl = el('visual-asset-kpis');
    var simTk = el('sim-target-ticker');

    if (tkEl) tkEl.textContent = ativo.ticker;
    if (nmEl) nmEl.textContent = (ativo.empresa || ativo.ticker) + ' • ' + (ativo.setor || 'B3');
    if (prEl) prEl.textContent = fmtMoeda(ativo.preco);
    if (simTk) simTk.textContent = ativo.ticker + ' (' + fmtMoeda(ativo.preco) + ')';

    var ver = classificarVereditoBazin(ativo);
    if (vrEl) {
      vrEl.className = 'tag ' + ver.classe;
      vrEl.textContent = ver.rotulo;
    }

    if (bgEl) {
      var bHtml = '';
      if (ativo.besst) {
        bHtml += '<span class="vfocus-badge besst">BESST · ' + esc(ativo.setor || '') + '</span>';
      } else {
        bHtml += '<span class="vfocus-badge extra">' + esc(ativo.setor || 'Demais papéis') + '</span>';
      }
      if (ativo.rank_greenblatt) {
        bHtml += '<span class="vfocus-badge magic">Greenblatt #' + ativo.rank_greenblatt + '</span>';
      }
      if (ativo.data_ult_cot) {
        bHtml += '<span class="vfocus-badge">Última cotação (' + esc(fmtDiaMes(ativo.data_ult_cot)) + ')</span>';
      }
      bgEl.innerHTML = bHtml;
    }

    if (kpisEl) {
      var mBazin = obterMargemBazin(ativo);
      var clsMargem = mBazin === null ? '' : (mBazin >= 0.15 ? 'pos' : (mBazin >= 0 ? 'warn' : 'neg'));
      var pctAbaixo = ativo.pct_abaixo_teto_5a !== null && ativo.pct_abaixo_teto_5a !== undefined
        ? Number(ativo.pct_abaixo_teto_5a)
        : null;
      var dpa = obterDpaMedio(ativo);
      var dy = obterDyAtual(ativo);

      kpisEl.innerHTML =
        '<div class="vasset-kpi">' +
          '<span class="vasset-kpi-label">Margem Bazin atual</span>' +
          '<span class="vasset-kpi-value ' + clsMargem + '">' + (mBazin !== null ? fmtPct(mBazin, 1, true) : '—') + '</span>' +
        '</div>' +
        '<div class="vasset-kpi">' +
          '<span class="vasset-kpi-label">% do período abaixo do teto</span>' +
          '<span class="vasset-kpi-value">' + (pctAbaixo !== null ? fmtPct(pctAbaixo, 0, false) : '—') + '</span>' +
        '</div>' +
        '<div class="vasset-kpi">' +
          '<span class="vasset-kpi-label">DPA médio (5a)</span>' +
          '<span class="vasset-kpi-value">' + (dpa > 0 ? fmtMoeda(dpa) : '—') + '</span>' +
        '</div>' +
        '<div class="vasset-kpi">' +
          '<span class="vasset-kpi-label">Dividend Yield (12m)</span>' +
          '<span class="vasset-kpi-value">' + (dy !== null ? fmtPct(dy, 1, false) : '—') + '</span>' +
        '</div>';
    }
  }

  function obterRecorteSerie(ativo, anos) {
    var datas = obterDatasHistorico();
    var precos = (ativo && Array.isArray(ativo.historico_precos)) ? ativo.historico_precos : [];
    var nTotal = Math.min(datas.length, precos.length);
    if (nTotal === 0) return { datas: [], precos: [] };

    var semanasDesejadas = Math.max(8, Math.round(anos * 52.2));
    var inicio = Math.max(0, nTotal - semanasDesejadas);

    while (inicio < nTotal && (precos[inicio] === null || precos[inicio] === undefined)) {
      inicio++;
    }

    return {
      datas: datas.slice(inicio, nTotal),
      precos: precos.slice(inicio, nTotal)
    };
  }

  function renderizarGraficoPrecoETetos() {
    var svg = el('visual-price-svg');
    var legEl = el('visual-chart-legend');
    var hudEl = el('visual-price-hud');
    var togglesWrap = el('visual-ceilings-toggles');
    if (!svg) return;

    var principal = buscarAtivo(estadoVisual.tickerPrincipal);
    if (!principal) return;

    renderizarCabecalhoAtivoPrincipal(principal);

    var modoNorm = estadoVisual.modoGrafico === 'norm';
    if (togglesWrap) {
      if (modoNorm) {
        togglesWrap.classList.add('is-hidden');
      } else {
        togglesWrap.classList.remove('is-hidden');
      }
    }

    var recorte = obterRecorteSerie(principal, estadoVisual.periodoAnos);
    var datas = recorte.datas;
    var precos = recorte.precos;

    if (datas.length < 2) {
      svg.innerHTML =
        '<text x="480" y="210" text-anchor="middle" fill="#9ca3af" font-size="14">' +
          'Histórico semanal insuficiente para ' + esc(principal.ticker) + '.' +
        '</text>';
      return;
    }

    var ehMobile = window.innerWidth <= 680;
    var W = 960;
    var H = ehMobile ? 310 : 460;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var padL = ehMobile ? 64 : 74;
    var padR = ehMobile ? 96 : 148;
    var padT = 26;
    var padB = 40;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var tetoBazin = obterTetoBazin(principal);
    var tetoGraham = principal.graham && principal.graham > 0 ? Number(principal.graham) : null;
    var tetoGordon = principal.gordon && principal.gordon > 0 ? Number(principal.gordon) : null;

    var seriesComp = [];
    var datasTodas = obterDatasHistorico();

    estadoVisual.tickersComparados.forEach(function (tk, idx) {
      var at = buscarAtivo(tk);
      if (!at || !Array.isArray(at.historico_precos)) return;
      var mapa = {};
      for (var i = 0; i < datasTodas.length && i < at.historico_precos.length; i++) {
        if (at.historico_precos[i] !== null && at.historico_precos[i] !== undefined) {
          mapa[datasTodas[i]] = Number(at.historico_precos[i]);
        }
      }
      var alinhados = datas.map(function (d) {
        return mapa[d] !== undefined ? mapa[d] : null;
      });
      seriesComp.push({
        ticker: tk,
        cor: CORES_COMPARACAO[idx % CORES_COMPARACAO.length],
        clsDot: 'dot-cmp-' + (idx % CORES_COMPARACAO.length),
        valores: alinhados
      });
    });

    var yMin = Infinity;
    var yMax = -Infinity;

    function registrarValorDominio(v) {
      if (v === null || v === undefined || isNaN(v)) return;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }

    var basePrincipal = precos.find(function (v) { return v !== null && v > 0; }) || 1;
    var seriePrincipalPlot = precos.map(function (v) {
      if (v === null || v === undefined) return null;
      return modoNorm ? ((v / basePrincipal) - 1) * 100 : Number(v);
    });

    seriePrincipalPlot.forEach(registrarValorDominio);

    var seriesCompPlot = seriesComp.map(function (sc) {
      var base = sc.valores.find(function (v) { return v !== null && v > 0; }) || 1;
      var pts = sc.valores.map(function (v) {
        if (v === null || v === undefined) return null;
        return modoNorm ? ((v / base) - 1) * 100 : Number(v);
      });
      pts.forEach(registrarValorDominio);
      return {
        ticker: sc.ticker,
        cor: sc.cor,
        clsDot: sc.clsDot,
        pontos: pts,
        brutos: sc.valores
      };
    });

    if (!modoNorm) {
      if (estadoVisual.mostrarTetos.bazin && tetoBazin) registrarValorDominio(tetoBazin);
      if (estadoVisual.mostrarTetos.graham && tetoGraham) registrarValorDominio(tetoGraham);
      if (estadoVisual.mostrarTetos.gordon && tetoGordon) registrarValorDominio(tetoGordon);
    } else {
      registrarValorDominio(0);
    }

    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 100;
    }
    if (Math.abs(yMax - yMin) < 1e-6) {
      yMin -= 5;
      yMax += 5;
    }

    var folga = (yMax - yMin) * 0.11;
    yMin = modoNorm ? (yMin - folga) : Math.max(0, yMin - folga);
    yMax = yMax + folga;

    function xPos(idx) {
      if (datas.length <= 1) return padL;
      return padL + (idx / (datas.length - 1)) * plotW;
    }

    function yPos(val) {
      return padT + plotH - ((val - yMin) / (yMax - yMin)) * plotH;
    }

    var nGradesY = 5;
    var gradeHtml = '';
    for (var g = 0; g <= nGradesY; g++) {
      var vGrade = yMin + (g / nGradesY) * (yMax - yMin);
      var yG = yPos(vGrade);
      var rotuloY = modoNorm
        ? (vGrade >= 0 ? '+' : '') + vGrade.toFixed(0) + '%'
        : 'R$ ' + vGrade.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      gradeHtml +=
        '<line x1="' + padL + '" y1="' + yG.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yG.toFixed(1) + '" class="vchart-grid-line" />' +
        '<text x="' + (padL - 10) + '" y="' + (yG + 4).toFixed(1) + '" text-anchor="end" class="vchart-axis-text">' + rotuloY + '</text>';
    }

    var nTicksX = ehMobile ? 4 : 6;
    var eixoXHtml = '';
    for (var tx = 0; tx < nTicksX; tx++) {
      var idxTick = Math.round((tx / (nTicksX - 1)) * (datas.length - 1));
      var xT = xPos(idxTick);
      eixoXHtml +=
        '<line x1="' + xT.toFixed(1) + '" y1="' + (padT + plotH) + '" x2="' + xT.toFixed(1) + '" y2="' + (padT + plotH + 5) + '" class="vchart-tick-line" />' +
        '<text x="' + xT.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="vchart-axis-text">' + fmtMesAno(datas[idxTick]) + '</text>';
    }

    function construirPath(arrValores) {
      var d = '';
      var aberto = false;
      for (var i = 0; i < arrValores.length; i++) {
        var v = arrValores[i];
        if (v === null || v === undefined || isNaN(v)) {
          aberto = false;
          continue;
        }
        var xp = xPos(i).toFixed(1);
        var yp = yPos(v).toFixed(1);
        d += (aberto ? ' L ' : ' M ') + xp + ' ' + yp;
        aberto = true;
      }
      return d;
    }

    var pathPrincipal = construirPath(seriePrincipalPlot);

    var indicesValidos = [];
    for (var k = 0; k < seriePrincipalPlot.length; k++) {
      if (seriePrincipalPlot[k] !== null && seriePrincipalPlot[k] !== undefined) {
        indicesValidos.push(k);
      }
    }

    var areaPrincipal = '';
    if (indicesValidos.length >= 2) {
      var iIni = indicesValidos[0];
      var iFim = indicesValidos[indicesValidos.length - 1];
      areaPrincipal = pathPrincipal +
        ' L ' + xPos(iFim).toFixed(1) + ' ' + (padT + plotH).toFixed(1) +
        ' L ' + xPos(iIni).toFixed(1) + ' ' + (padT + plotH).toFixed(1) + ' Z';
    }

    var zonaBazinHtml = '';
    if (!modoNorm && estadoVisual.mostrarTetos.bazin && tetoBazin && tetoBazin > yMin) {
      var yTetoB = Math.max(padT, Math.min(padT + plotH, yPos(tetoBazin)));
      var alturaZona = (padT + plotH) - yTetoB;
      if (alturaZona > 4) {
        zonaBazinHtml =
          '<rect x="' + padL + '" y="' + yTetoB.toFixed(1) + '" width="' + plotW + '" height="' + alturaZona.toFixed(1) + '" fill="url(#gradZonaBazin)" />' +
          (alturaZona > 26
            ? '<text x="' + (padL + 12) + '" y="' + (yTetoB + 16).toFixed(1) + '" class="vchart-zone-label">Zona de compra (abaixo do teto Bazin)</text>'
            : '');
      }
    }

    var linhasTetoHtml = '';
    if (!modoNorm) {
      var listaTetos = [];
      if (estadoVisual.mostrarTetos.bazin && tetoBazin) {
        listaTetos.push({
          chave: 'bazin',
          nome: 'Teto Bazin',
          valor: tetoBazin,
          cor: COR_BAZIN,
          dash: '8 5',
          largura: 2.3
        });
      }
      if (estadoVisual.mostrarTetos.graham && tetoGraham) {
        listaTetos.push({
          chave: 'graham',
          nome: 'Teto Graham',
          valor: tetoGraham,
          cor: COR_GRAHAM,
          dash: '4 4',
          largura: 1.9
        });
      }
      if (estadoVisual.mostrarTetos.gordon && tetoGordon) {
        listaTetos.push({
          chave: 'gordon',
          nome: 'Teto Gordon',
          valor: tetoGordon,
          cor: COR_GORDON,
          dash: '10 4 2 4',
          largura: 1.9
        });
      }

      listaTetos.forEach(function (lt) {
        lt.yLinha = yPos(lt.valor);
        lt.yLabel = lt.yLinha;
      });

      listaTetos.sort(function (a, b) { return a.yLabel - b.yLabel; });
      for (var m = 1; m < listaTetos.length; m++) {
        if (listaTetos[m].yLabel - listaTetos[m - 1].yLabel < 18) {
          listaTetos[m].yLabel = listaTetos[m - 1].yLabel + 18;
        }
      }

      listaTetos.forEach(function (lt) {
        var yL = lt.yLinha.toFixed(1);
        var yTxt = Math.min(padT + plotH - 4, Math.max(padT + 10, lt.yLabel)).toFixed(1);
        var txtTag = ehMobile
          ? (lt.chave === 'bazin' ? 'Bazin ' : lt.chave === 'graham' ? 'Graham ' : 'Gordon ') + fmtNumero(lt.valor, 2)
          : lt.nome + ' ' + fmtMoeda(lt.valor);

        linhasTetoHtml +=
          '<g class="vchart-ceiling-group">' +
            '<line x1="' + padL + '" y1="' + yL + '" x2="' + (W - padR) + '" y2="' + yL + '" ' +
              'stroke="' + lt.cor + '" stroke-width="' + lt.largura + '" stroke-dasharray="' + lt.dash + '" />' +
            '<rect x="' + (W - padR + 6) + '" y="' + (Number(yTxt) - 10) + '" width="' + (padR - 10) + '" height="18" rx="4" ' +
              'fill="rgba(15, 22, 35, 0.92)" stroke="' + lt.cor + '" stroke-opacity="0.55" stroke-width="1" />' +
            '<text x="' + (W - padR + 12) + '" y="' + (Number(yTxt) + 3) + '" fill="' + lt.cor + '" class="vchart-ceiling-label">' +
              esc(txtTag) +
            '</text>' +
          '</g>';
      });
    } else {
      var yZero = yPos(0).toFixed(1);
      linhasTetoHtml +=
        '<line x1="' + padL + '" y1="' + yZero + '" x2="' + (W - padR) + '" y2="' + yZero + '" stroke="#64748b" stroke-width="1.2" stroke-dasharray="4 4" />';
    }

    var pathsComparadosHtml = '';
    seriesCompPlot.forEach(function (sc) {
      var dComp = construirPath(sc.pontos);
      if (!dComp) return;
      pathsComparadosHtml +=
        '<path d="' + dComp + '" fill="none" stroke="' + sc.cor + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.92" />';
    });

    var ultimoIdx = indicesValidos.length > 0 ? indicesValidos[indicesValidos.length - 1] : datas.length - 1;
    var ultX = xPos(ultimoIdx).toFixed(1);
    var ultY = yPos(seriePrincipalPlot[ultimoIdx]).toFixed(1);

    svg.innerHTML =
      '<defs>' +
        '<linearGradient id="gradAreaPreco" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + COR_PRECO + '" stop-opacity="0.26" />' +
          '<stop offset="100%" stop-color="' + COR_PRECO + '" stop-opacity="0.0" />' +
        '</linearGradient>' +
        '<linearGradient id="gradZonaBazin" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + COR_BAZIN + '" stop-opacity="0.09" />' +
          '<stop offset="100%" stop-color="' + COR_BAZIN + '" stop-opacity="0.02" />' +
        '</linearGradient>' +
      '</defs>' +
      gradeHtml +
      zonaBazinHtml +
      eixoXHtml +
      (areaPrincipal && !modoNorm ? '<path d="' + areaPrincipal + '" fill="url(#gradAreaPreco)" />' : '') +
      linhasTetoHtml +
      pathsComparadosHtml +
      '<path d="' + pathPrincipal + '" fill="none" stroke="' + COR_PRECO + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />' +
      '<circle cx="' + ultX + '" cy="' + ultY + '" r="4.5" fill="' + COR_PRECO + '" stroke="#0b0f17" stroke-width="2" />' +
      '<line id="vchart-crosshair-x" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + plotH) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" class="is-hidden" />' +
      '<circle id="vchart-hover-dot" cx="0" cy="0" r="5.5" fill="' + COR_PRECO + '" stroke="#ffffff" stroke-width="2" class="is-hidden" />' +
      '<rect id="vchart-hit-area" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + plotH + '" fill="transparent" class="vchart-hit-rect" />';

    if (legEl) {
      var legHtml =
        '<span class="vleg-item"><span class="vleg-swatch is-price"></span>' +
          esc(principal.ticker) + ' (Preço: ' + fmtMoeda(principal.preco) + ')' +
        '</span>';

      if (!modoNorm) {
        if (tetoBazin) {
          legHtml +=
            '<button type="button" class="vleg-item is-interactive' + (estadoVisual.mostrarTetos.bazin ? '' : ' is-muted') + '" data-leg-ceiling="bazin" aria-pressed="' + (estadoVisual.mostrarTetos.bazin ? 'true' : 'false') + '">' +
              '<span class="vleg-swatch dashed is-bazin"></span>' +
              'Teto Bazin (6%): <strong>' + fmtMoeda(tetoBazin) + '</strong>' +
            '</button>';
        }
        if (tetoGraham) {
          legHtml +=
            '<button type="button" class="vleg-item is-interactive' + (estadoVisual.mostrarTetos.graham ? '' : ' is-muted') + '" data-leg-ceiling="graham" aria-pressed="' + (estadoVisual.mostrarTetos.graham ? 'true' : 'false') + '">' +
              '<span class="vleg-swatch dashed is-graham"></span>' +
              'Teto Graham: <strong>' + fmtMoeda(tetoGraham) + '</strong>' +
            '</button>';
        }
        if (tetoGordon) {
          legHtml +=
            '<button type="button" class="vleg-item is-interactive' + (estadoVisual.mostrarTetos.gordon ? '' : ' is-muted') + '" data-leg-ceiling="gordon" aria-pressed="' + (estadoVisual.mostrarTetos.gordon ? 'true' : 'false') + '">' +
              '<span class="vleg-swatch dashed is-gordon"></span>' +
              'Teto Gordon: <strong>' + fmtMoeda(tetoGordon) + '</strong>' +
            '</button>';
        }
      }

      seriesCompPlot.forEach(function (sc) {
        legHtml +=
          '<span class="vleg-item">' +
            '<span class="vleg-swatch ' + sc.clsDot + '"></span>' +
            esc(sc.ticker) +
          '</span>';
      });

      legEl.innerHTML = legHtml;

      var btnsLeg = legEl.querySelectorAll('[data-leg-ceiling]');
      for (var bl = 0; bl < btnsLeg.length; bl++) {
        btnsLeg[bl].addEventListener('click', function () {
          var chave = this.getAttribute('data-leg-ceiling');
          if (!chave || !estadoVisual.mostrarTetos.hasOwnProperty(chave)) return;
          estadoVisual.mostrarTetos[chave] = !estadoVisual.mostrarTetos[chave];
          var chk = document.querySelector('[data-ceiling="' + chave + '"]');
          if (chk) {
            chk.checked = estadoVisual.mostrarTetos[chave];
            if (chk.parentElement) {
              chk.parentElement.classList.toggle('active', chk.checked);
            }
          }
          renderizarGraficoPrecoETetos();
        });
      }
    }

    function atualizarHudIndice(idx, ehHover) {
      if (!hudEl) return;
      var ehUltimoPonto = idx === datas.length - 1;
      var dataRef = (!ehHover && ehUltimoPonto && principal.data_ult_cot)
        ? fmtDataCurta(principal.data_ult_cot)
        : fmtDataCurta(datas[idx]);
      var pBruto = (!ehHover && ehUltimoPonto && principal.preco)
        ? Number(principal.preco)
        : precos[idx];
      var pPlot = seriePrincipalPlot[idx];

      var htmlHud =
        '<span class="vhud-date">' + (ehHover ? 'Semana ' : 'Última cotação (') + dataRef + (ehHover ? '' : ')') + '</span>' +
        '<span class="vhud-main"><strong>' + esc(principal.ticker) + ':</strong> ' + fmtMoeda(pBruto) +
          (modoNorm && pPlot !== null ? ' (' + (pPlot >= 0 ? '+' : '') + pPlot.toFixed(1) + '%)' : '') +
        '</span>';

      if (!modoNorm && pBruto !== null && pBruto > 0) {
        if (tetoBazin) {
          var descB = (tetoBazin - pBruto) / tetoBazin;
          var clsB = descB >= 0 ? 'pos' : 'neg';
          htmlHud += '<span class="vhud-pill ' + clsB + '">Margem Bazin: ' + fmtPct(descB, 1, true) + '</span>';
        }
        if (tetoGraham) {
          var descGr = (tetoGraham - pBruto) / tetoGraham;
          htmlHud += '<span class="vhud-pill">Margem vs. Graham: ' + fmtPct(descGr, 1, true) + '</span>';
        }
        if (tetoGordon) {
          var descGo = (tetoGordon - pBruto) / tetoGordon;
          htmlHud += '<span class="vhud-pill">Margem vs. Gordon: ' + fmtPct(descGo, 1, true) + '</span>';
        }
      }

      seriesCompPlot.forEach(function (sc) {
        var vComp = sc.brutos[idx];
        var vPct = sc.pontos[idx];
        if (vComp !== null && vComp !== undefined) {
          htmlHud +=
            '<span class="vhud-pill">' +
              '<strong>' + esc(sc.ticker) + ':</strong> ' + fmtMoeda(vComp) +
              (modoNorm && vPct !== null ? ' (' + (vPct >= 0 ? '+' : '') + vPct.toFixed(1) + '%)' : '') +
            '</span>';
        }
      });

      hudEl.innerHTML = htmlHud;
    }

    atualizarHudIndice(ultimoIdx, false);

    var hitArea = el('vchart-hit-area');
    var crossX = el('vchart-crosshair-x');
    var dotHover = el('vchart-hover-dot');
    var rafPendente = false;

    function aoMoverPonteiro(clientX) {
      if (rafPendente) return;
      rafPendente = true;
      window.requestAnimationFrame(function () {
        rafPendente = false;
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        var relX = ((clientX - rect.left) / rect.width) * W;
        var frac = Math.max(0, Math.min(1, (relX - padL) / plotW));
        var idx = Math.round(frac * (datas.length - 1));
        var valPlot = seriePrincipalPlot[idx];
        if (valPlot === null || valPlot === undefined) return;

        var cx = xPos(idx);
        var cy = yPos(valPlot);
        if (crossX) {
          crossX.setAttribute('x1', cx.toFixed(1));
          crossX.setAttribute('x2', cx.toFixed(1));
          crossX.classList.remove('is-hidden');
        }
        if (dotHover) {
          dotHover.setAttribute('cx', cx.toFixed(1));
          dotHover.setAttribute('cy', cy.toFixed(1));
          dotHover.classList.remove('is-hidden');
        }
        if (hudEl && window.innerWidth > 900) {
          hudEl.classList.add('vhud-floating');
          var leftPct = Math.max(4, Math.min(58, (cx / W) * 100));
          if (typeof window.definirRegraCssDinamica === 'function') {
            window.definirRegraCssDinamica('#visual-price-hud.vhud-floating', 'left:' + leftPct.toFixed(1) + '%;top:10px;');
          }
        }
        atualizarHudIndice(idx, true);
      });
    }

    if (hitArea) {
      hitArea.addEventListener('mousemove', function (e) {
        aoMoverPonteiro(e.clientX);
      });
      hitArea.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches[0]) {
          aoMoverPonteiro(e.touches[0].clientX);
        }
      }, { passive: true });
      hitArea.addEventListener('mouseleave', function () {
        if (crossX) crossX.classList.add('is-hidden');
        if (dotHover) dotHover.classList.add('is-hidden');
        if (hudEl) hudEl.classList.remove('vhud-floating');
        atualizarHudIndice(ultimoIdx, false);
      });
    }
  }

  /* ==========================================================================
   * 5. DIAGNÓSTICO "BARATO HÁ MUITO TEMPO?" INTEGRADO AO ANTI-CILADA
   * ========================================================================== */

  function renderizarDiagnosticoValueTrap() {
    var principal = buscarAtivo(estadoVisual.tickerPrincipal);
    if (!principal) return;

    var badgeEl = el('visual-trap-badge');
    var barEl = el('visual-trap-bar');
    var statsEl = el('visual-trap-stats');
    var textEl = el('visual-trap-text');
    if (!badgeEl || !barEl || !statsEl || !textEl) return;

    var recorte = obterRecorteSerie(principal, estadoVisual.periodoAnos);
    var precos = recorte.precos.filter(function (v) { return v !== null && v > 0; });
    var tetoBazin = obterTetoBazin(principal);
    var margemBazin = obterMargemBazin(principal);
    var margemGraham = principal.margem_graham;
    var margemGordon = principal.margem_gordon;

    var sust = typeof window.calcularScoreSustentabilidade === 'function'
      ? window.calcularScoreSustentabilidade(principal)
      : null;

    if (!tetoBazin || tetoBazin <= 0 || precos.length === 0) {
      badgeEl.className = 'tag tag-warn';
      badgeEl.textContent = 'Sem teto Bazin aplicável';
      barEl.innerHTML = '';
      statsEl.innerHTML =
        '<div class="vt-stat"><span class="vt-label">Teto Graham</span><span class="vt-val">' + fmtMoeda(principal.graham) + '</span></div>' +
        '<div class="vt-stat"><span class="vt-label">Margem vs. Graham</span><span class="vt-val">' + fmtPct(margemGraham, 1, true) + '</span></div>';
      textEl.textContent =
        'Este papel não possui DPA médio positivo suficiente para o cálculo do Teto Bazin (6%). Utilize o Teto Graham e o Teto Gordon no gráfico acima para avaliar desconto patrimonial.';
      return;
    }

    var abaixoCount = 0;
    for (var i = 0; i < precos.length; i++) {
      if (precos[i] <= tetoBazin) abaixoCount++;
    }
    var pctAbaixoPeriodo = abaixoCount / precos.length;
    var pctCincoAnos = principal.pct_abaixo_teto_5a !== null && principal.pct_abaixo_teto_5a !== undefined
      ? Number(principal.pct_abaixo_teto_5a)
      : pctAbaixoPeriodo;

    var larguraPct = Math.max(2, Math.min(100, Math.round(pctAbaixoPeriodo * 100)));

    var classeCor = 'ok';
    var fillBar = '#10b981';
    var vereditoTrap = 'Oportunidade recente';
    var explicacao = '';

    var roe = principal.fundamentos && principal.fundamentos.roe ? Number(principal.fundamentos.roe) : null;
    var divLiq = principal.fundamentos && principal.fundamentos.div_liq_patrim ? Number(principal.fundamentos.div_liq_patrim) : null;

    if (margemBazin !== null && margemBazin < 0) {
      if (pctAbaixoPeriodo >= 0.5) {
        classeCor = 'warn';
        fillBar = '#f59e0b';
        vereditoTrap = 'Acima do teto hoje (esteve barato antes)';
        explicacao =
          principal.ticker + ' negociou abaixo do teto Bazin em ' + fmtPct(pctAbaixoPeriodo, 0) +
          ' das semanas dos últimos ' + estadoVisual.periodoAnos + 'a, mas subiu e hoje está ' +
          fmtPct(Math.abs(margemBazin), 1) + ' acima do teto.';
      } else {
        classeCor = 'neutral';
        fillBar = '#3b82f6';
        vereditoTrap = 'Prêmio estrutural (raramente barato)';
        explicacao =
          principal.ticker + ' passou apenas ' + fmtPct(pctAbaixoPeriodo, 0) +
          ' do período abaixo do teto Bazin. O mercado historicamente paga prêmio pela previsibilidade do ativo.';
      }
    } else {
      if (pctAbaixoPeriodo >= 0.80) {
        classeCor = 'bad';
        fillBar = '#ef4444';
        vereditoTrap = 'Alerta: barato há muito tempo (' + fmtPct(pctAbaixoPeriodo, 0) + ' do período)';
        var compGraham = (margemGraham !== null && margemGraham > 0)
          ? 'Também está descontado por Graham (' + fmtPct(margemGraham, 0, true) + '). '
          : 'Porém está caro pelo método de Graham (' + fmtPct(margemGraham, 0, true) + '). ';
        var compRoe = roe !== null ? 'ROE atual de ' + fmtPct(roe, 1) + '. ' : '';
        var compDiv = divLiq !== null ? 'Dív. Líq./PL de ' + fmtNumero(divLiq, 2) + 'x. ' : '';
        var compSust = sust ? 'Score Anti-Cilada: ' + sust.score + '/100 (' + sust.rotulo + '). ' : '';
        explicacao =
          'A cotação ficou abaixo do teto Bazin em ' + fmtPct(pctAbaixoPeriodo, 0) +
          ' das semanas analisadas (' + fmtPct(pctCincoAnos, 0) + ' em 5 anos). ' +
          compGraham + compRoe + compDiv + compSust +
          'Quando uma ação passa quase 5 anos inteiros descontada, valide se o dividendo é recorrente ou fruto de eventos extraordinários.';
      } else if (pctAbaixoPeriodo >= 0.45) {
        classeCor = 'warn';
        fillBar = '#f59e0b';
        vereditoTrap = 'Desconto recorrente / cíclico (' + fmtPct(pctAbaixoPeriodo, 0) + ')';
        explicacao =
          principal.ticker + ' esteve abaixo do teto Bazin em ' + fmtPct(pctAbaixoPeriodo, 0) +
          ' do período e hoje oferece margem de ' + fmtPct(margemBazin, 1, true) +
          '. Papel oscila entre janelas de desconto e preço justo.';
      } else {
        classeCor = 'ok';
        fillBar = '#10b981';
        vereditoTrap = 'Janela rara de compra (' + fmtPct(pctAbaixoPeriodo, 0) + ' do tempo)';
        explicacao =
          principal.ticker + ' negociou abaixo do teto Bazin em apenas ' + fmtPct(pctAbaixoPeriodo, 0) +
          ' das semanas do período, mas está abaixo do teto agora (' + fmtPct(margemBazin, 1, true) +
          '). Indica desconto pontual em papel que costuma negociar acima do teto.';
      }
    }

    var mapTag = { ok: 'tag-ok', warn: 'tag-warn', bad: 'tag-bad', neutral: 'tag-warn' };
    badgeEl.className = 'tag ' + (mapTag[classeCor] || 'tag-warn');
    badgeEl.textContent = vereditoTrap;

    barEl.innerHTML =
      '<svg class="inline-bar-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect x="0" y="0" width="' + larguraPct + '" height="10" rx="5" fill="' + fillBar + '" />' +
      '</svg>';

    statsEl.innerHTML =
      '<div class="vt-stat">' +
        '<span class="vt-label">Tempo abaixo do teto (' + estadoVisual.periodoAnos + 'a)</span>' +
        '<span class="vt-val">' + fmtPct(pctAbaixoPeriodo, 0) + ' <small>(' + abaixoCount + '/' + precos.length + ' sem.)</small></span>' +
      '</div>' +
      '<div class="vt-stat">' +
        '<span class="vt-label">Margem Bazin atual</span>' +
        '<span class="vt-val ' + (margemBazin >= 0 ? 'pos' : 'neg') + '">' + fmtPct(margemBazin, 1, true) + '</span>' +
      '</div>' +
      '<div class="vt-stat">' +
        '<span class="vt-label">Margem vs. Graham</span>' +
        '<span class="vt-val ' + (margemGraham !== null ? (margemGraham >= 0 ? 'pos' : 'neg') : '') + '">' + fmtPct(margemGraham, 1, true) + '</span>' +
      '</div>' +
      '<div class="vt-stat">' +
        '<span class="vt-label">Score Anti-Cilada</span>' +
        '<span class="vt-val">' + (sust ? (sust.score + '/100 · ' + esc(sust.rotulo)) : fmtPct(margemGordon, 1, true)) + '</span>' +
      '</div>';

    textEl.textContent = explicacao;
  }

  /* ==========================================================================
   * 6. SIMULADOR DE RENDIMENTO TOTAL (PREÇO + DIVIDENDOS / JCP)
   * ========================================================================== */

  function executarSimulacaoRendimento() {
    var principal = buscarAtivo(estadoVisual.tickerPrincipal);
    if (!principal) return;

    var inpInicial = el('sim-initial-input');
    var inpMensal = el('sim-monthly-input');
    var kpiGrid = el('sim-kpi-grid');
    var svgSim = el('sim-chart-svg');
    var noteEl = el('sim-summary-note');
    var hudSim = el('sim-chart-hud');
    if (!kpiGrid || !svgSim) return;

    var aporteInicial = inpInicial ? Math.max(0, Number(inpInicial.value) || 0) : 10000;
    var aporteMensal = inpMensal ? Math.max(0, Number(inpMensal.value) || 0) : 0;
    if (aporteInicial <= 0 && aporteMensal <= 0) {
      aporteInicial = 1000;
    }

    var recorte = obterRecorteSerie(principal, estadoVisual.simAnos);
    var datas = recorte.datas;
    var precos = recorte.precos;

    if (datas.length < 2) {
      kpiGrid.innerHTML = '<div class="sim-empty">Histórico insuficiente para simular este período.</div>';
      svgSim.innerHTML = '';
      return;
    }

    var proventosLista = Array.isArray(principal.proventos_historico) ? principal.proventos_historico : [];
    var dataInicioIso = datas[0];
    var dataFimIso = datas[datas.length - 1];

    var eventosPeriodo = proventosLista.filter(function (ev) {
      return ev && ev.data_com >= dataInicioIso && ev.data_com <= dataFimIso && Number(ev.valor) > 0;
    }).sort(function (a, b) {
      return String(a.data_com).localeCompare(String(b.data_com));
    });

    var usandoEstimativaDpa = false;
    var dpaMedioFallback = obterDpaMedio(principal);
    if (eventosPeriodo.length === 0 && dpaMedioFallback > 0) {
      usandoEstimativaDpa = true;
    }

    var cotasComReinv = 0;
    var cotasSemReinv = 0;
    var caixaDivAcumulado = 0;
    var totalProventosRecebidosComReinv = 0;
    var totalAportado = 0;

    var precoInicial = precos[0] || principal.preco || 1;
    if (aporteInicial > 0 && precoInicial > 0) {
      cotasComReinv = aporteInicial / precoInicial;
      cotasSemReinv = aporteInicial / precoInicial;
      totalAportado = aporteInicial;
    }

    var idxEvento = 0;
    var mesAnoAnterior = datas[0].slice(0, 7);

    var seriePatrimonioComReinv = [];
    var serieGanhoCapitalPuro = [];
    var serieAportado = [];

    for (var i = 0; i < datas.length; i++) {
      var dAtual = datas[i];
      var pAtual = (precos[i] !== null && precos[i] > 0) ? Number(precos[i]) : precoInicial;
      precoInicial = pAtual;

      var mesAno = dAtual.slice(0, 7);
      if (i > 0 && mesAno !== mesAnoAnterior && aporteMensal > 0) {
        cotasComReinv += aporteMensal / pAtual;
        cotasSemReinv += aporteMensal / pAtual;
        totalAportado += aporteMensal;
        mesAnoAnterior = mesAno;
      } else if (i > 0 && mesAno !== mesAnoAnterior) {
        mesAnoAnterior = mesAno;
      }

      if (!usandoEstimativaDpa) {
        while (idxEvento < eventosPeriodo.length && eventosPeriodo[idxEvento].data_com <= dAtual) {
          var ev = eventosPeriodo[idxEvento];
          var fatorLiquido = (estadoVisual.simDescontarIrJcp && ev.tipo === 'JCP') ? 0.85 : 1.0;
          var valorPorAcao = Number(ev.valor) * fatorLiquido;

          if (valorPorAcao > 0 && pAtual > 0) {
            var recebidoCom = cotasComReinv * valorPorAcao;
            totalProventosRecebidosComReinv += recebidoCom;
            if (estadoVisual.simReinvestir) {
              cotasComReinv += recebidoCom / pAtual;
            } else {
              caixaDivAcumulado += recebidoCom;
            }
          }
          idxEvento++;
        }
      } else if (i > 0 && i % 13 === 0) {
        var divTrimestral = dpaMedioFallback / 4;
        var recEst = cotasComReinv * divTrimestral;
        totalProventosRecebidosComReinv += recEst;
        if (estadoVisual.simReinvestir) {
          cotasComReinv += recEst / pAtual;
        } else {
          caixaDivAcumulado += recEst;
        }
      }

      var patrCom = estadoVisual.simReinvestir
        ? (cotasComReinv * pAtual)
        : (cotasComReinv * pAtual + caixaDivAcumulado);
      var patrSomentePreco = cotasSemReinv * pAtual;

      seriePatrimonioComReinv.push(patrCom);
      serieGanhoCapitalPuro.push(patrSomentePreco);
      serieAportado.push(totalAportado);
    }

    var nPts = datas.length;
    var patrFinal = seriePatrimonioComReinv[nPts - 1] || 0;
    var patrSoPrecoFinal = serieGanhoCapitalPuro[nPts - 1] || 0;
    var lucroTotal = patrFinal - totalAportado;
    var rentabTotalPct = totalAportado > 0 ? (lucroTotal / totalAportado) : 0;
    var anosDecorridos = Math.max(0.5, nPts / 52.18);
    var cagr = totalAportado > 0 && patrFinal > 0
      ? (Math.pow(patrFinal / totalAportado, 1 / anosDecorridos) - 1)
      : 0;

    var efeitoDividendos = Math.max(0, patrFinal - patrSoPrecoFinal);
    var yieldOnCostMedio = totalAportado > 0
      ? (totalProventosRecebidosComReinv / anosDecorridos) / totalAportado
      : 0;

    kpiGrid.innerHTML =
      '<div class="sim-kpi-card highlight">' +
        '<span class="sk-label">Patrimônio final (' + (estadoVisual.simReinvestir ? 'c/ reinvestimento' : 's/ reinvestimento') + ')</span>' +
        '<span class="sk-value">' + fmtMoeda(patrFinal) + '</span>' +
        '<span class="sk-sub">' + fmtNumero(cotasComReinv, 0) + ' ações acumuladas (iniciou com ' + fmtNumero(aporteInicial / (precos[0] || 1), 0) + ')</span>' +
      '</div>' +
      '<div class="sim-kpi-card">' +
        '<span class="sk-label">Retorno total no período</span>' +
        '<span class="sk-value ' + (rentabTotalPct >= 0 ? 'pos' : 'neg') + '">' + fmtPct(rentabTotalPct, 1, true) + '</span>' +
        '<span class="sk-sub">Lucro líquido: ' + fmtMoeda(lucroTotal) + ' • CAGR ~' + fmtPct(cagr, 1, true) + '/ano</span>' +
      '</div>' +
      '<div class="sim-kpi-card">' +
        '<span class="sk-label">Total investido (bolso)</span>' +
        '<span class="sk-value">' + fmtMoeda(totalAportado) + '</span>' +
        '<span class="sk-sub">Sem dividendos seria: ' + fmtMoeda(patrSoPrecoFinal) + '</span>' +
      '</div>' +
      '<div class="sim-kpi-card">' +
        '<span class="sk-label">Dividendos + efeito bola de neve</span>' +
        '<span class="sk-value pos">+' + fmtMoeda(efeitoDividendos) + '</span>' +
        '<span class="sk-sub">Proventos pagos: ' + fmtMoeda(totalProventosRecebidosComReinv) + ' • YoC médio ' + fmtPct(yieldOnCostMedio, 1) + '/a</span>' +
      '</div>';

    var ehMobile = window.innerWidth <= 680;
    var W = 960;
    var H = ehMobile ? 250 : 300;
    svgSim.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var padL = ehMobile ? 66 : 78;
    var padR = 28;
    var padT = 20;
    var padB = 34;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var yMin = Infinity;
    var yMax = -Infinity;
    for (var j = 0; j < nPts; j++) {
      var v1 = seriePatrimonioComReinv[j];
      var v2 = serieGanhoCapitalPuro[j];
      var v3 = serieAportado[j];
      yMin = Math.min(yMin, v1, v2, v3);
      yMax = Math.max(yMax, v1, v2, v3);
    }
    yMin = Math.max(0, yMin * 0.9);
    yMax = yMax * 1.08;
    if (Math.abs(yMax - yMin) < 1) yMax = yMin + 100;

    function xPos(idx) {
      return padL + (idx / Math.max(1, nPts - 1)) * plotW;
    }
    function yPos(val) {
      return padT + plotH - ((val - yMin) / (yMax - yMin)) * plotH;
    }

    var gradeHtml = '';
    for (var g = 0; g <= 4; g++) {
      var vg = yMin + (g / 4) * (yMax - yMin);
      var yg = yPos(vg);
      var txtY = vg >= 1000
        ? 'R$ ' + (vg / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k'
        : fmtMoeda(vg, 0);
      gradeHtml +=
        '<line x1="' + padL + '" y1="' + yg.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yg.toFixed(1) + '" class="vchart-grid-line" />' +
        '<text x="' + (padL - 8) + '" y="' + (yg + 4).toFixed(1) + '" text-anchor="end" class="vchart-axis-text">' + txtY + '</text>';
    }

    var eixoXHtml = '';
    var nTicksX = ehMobile ? 4 : 6;
    for (var tx = 0; tx < nTicksX; tx++) {
      var idxT = Math.round((tx / (nTicksX - 1)) * (nPts - 1));
      var xT = xPos(idxT);
      eixoXHtml +=
        '<text x="' + xT.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="vchart-axis-text">' + fmtMesAno(datas[idxT]) + '</text>';
    }

    function pathSerie(arr) {
      return arr.map(function (v, idx) {
        return (idx === 0 ? 'M ' : 'L ') + xPos(idx).toFixed(1) + ' ' + yPos(v).toFixed(1);
      }).join(' ');
    }

    var pathCom = pathSerie(seriePatrimonioComReinv);
    var pathPreco = pathSerie(serieGanhoCapitalPuro);
    var pathAporte = pathSerie(serieAportado);

    var areaCom = pathCom +
      ' L ' + xPos(nPts - 1).toFixed(1) + ' ' + (padT + plotH).toFixed(1) +
      ' L ' + xPos(0).toFixed(1) + ' ' + (padT + plotH).toFixed(1) + ' Z';

    var areaPreco = pathPreco +
      ' L ' + xPos(nPts - 1).toFixed(1) + ' ' + (padT + plotH).toFixed(1) +
      ' L ' + xPos(0).toFixed(1) + ' ' + (padT + plotH).toFixed(1) + ' Z';

    svgSim.innerHTML =
      '<defs>' +
        '<linearGradient id="gradSimTotal" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#10b981" stop-opacity="0.30" />' +
          '<stop offset="100%" stop-color="#10b981" stop-opacity="0.02" />' +
        '</linearGradient>' +
        '<linearGradient id="gradSimPreco" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#60a5fa" stop-opacity="0.22" />' +
          '<stop offset="100%" stop-color="#60a5fa" stop-opacity="0.02" />' +
        '</linearGradient>' +
      '</defs>' +
      gradeHtml +
      eixoXHtml +
      '<path d="' + areaCom + '" fill="url(#gradSimTotal)" />' +
      '<path d="' + areaPreco + '" fill="url(#gradSimPreco)" />' +
      (aporteMensal > 0 ? '<path d="' + pathAporte + '" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="4 4" />' : '') +
      '<path d="' + pathPreco + '" fill="none" stroke="#60a5fa" stroke-width="2" />' +
      '<path d="' + pathCom + '" fill="none" stroke="#10b981" stroke-width="2.6" />' +
      '<line id="sim-crosshair-x" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + plotH) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" class="is-hidden" />' +
      '<rect id="sim-hit-area" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + plotH + '" fill="transparent" class="vchart-hit-rect" />';

    function atualizarHudSim(idx) {
      if (!hudSim) return;
      hudSim.innerHTML =
        '<span class="vhud-date">' + fmtDataCurta(datas[idx]) + '</span>' +
        '<span class="vhud-pill pos">Total c/ dividendos: <strong>' + fmtMoeda(seriePatrimonioComReinv[idx]) + '</strong></span>' +
        '<span class="vhud-pill">Só cotação: <strong>' + fmtMoeda(serieGanhoCapitalPuro[idx]) + '</strong></span>' +
        '<span class="vhud-pill">Investido: <strong>' + fmtMoeda(serieAportado[idx]) + '</strong></span>';
    }

    atualizarHudSim(nPts - 1);

    var simHit = el('sim-hit-area');
    var simCross = el('sim-crosshair-x');
    var rafSim = false;
    if (simHit) {
      simHit.addEventListener('mousemove', function (e) {
        if (rafSim) return;
        rafSim = true;
        window.requestAnimationFrame(function () {
          rafSim = false;
          var rect = svgSim.getBoundingClientRect();
          if (!rect.width) return;
          var relX = ((e.clientX - rect.left) / rect.width) * W;
          var frac = Math.max(0, Math.min(1, (relX - padL) / plotW));
          var idx = Math.round(frac * (nPts - 1));
          var cx = xPos(idx);
          if (simCross) {
            simCross.setAttribute('x1', cx.toFixed(1));
            simCross.setAttribute('x2', cx.toFixed(1));
            simCross.classList.remove('is-hidden');
          }
          if (hudSim && window.innerWidth > 900) {
            hudSim.classList.add('vhud-floating');
            var leftPct = Math.max(4, Math.min(56, (cx / W) * 100));
            if (typeof window.definirRegraCssDinamica === 'function') {
              window.definirRegraCssDinamica('#sim-chart-hud.vhud-floating', 'left:' + leftPct.toFixed(1) + '%;top:8px;');
            }
          }
          atualizarHudSim(idx);
        });
      });
      simHit.addEventListener('mouseleave', function () {
        if (simCross) simCross.classList.add('is-hidden');
        if (hudSim) hudSim.classList.remove('vhud-floating');
        atualizarHudSim(nPts - 1);
      });
    }

    if (noteEl) {
      var notaFonte = usandoEstimativaDpa
        ? '⚠ Sem eventos individuais em proventos_historico no período; estimativa calculada com o DPA médio de 5 anos (' + fmtMoeda(dpaMedioFallback) + '/ação/ano).'
        : 'Simulação baseada em ' + eventosPeriodo.length + ' eventos reais de dividendos/JCP (' + fmtDataCurta(dataInicioIso) + ' a ' + fmtDataCurta(dataFimIso) + ').';

      noteEl.innerHTML =
        '<span class="sim-leg-inline"><i class="dot green"></i> Patrimônio com dividendos (' + fmtMoeda(patrFinal) + ')</span>' +
        '<span class="sim-leg-inline"><i class="dot blue"></i> Apenas variação da ação (' + fmtMoeda(patrSoPrecoFinal) + ')</span>' +
        (aporteMensal > 0 ? '<span class="sim-leg-inline"><i class="dot gray"></i> Total desembolsado (' + fmtMoeda(totalAportado) + ')</span>' : '') +
        '<span class="sim-note-txt">' + esc(notaFonte) + '</span>';
    }
  }

  /* ==========================================================================
   * 7. SINCRONIZAÇÃO DE CONTROLES, EVENTOS E ESTADO NA URL
   * ========================================================================== */

  function sincronizarBotoesFiltroSidebar() {
    var btns = document.querySelectorAll('#visual-sidebar-filters [data-vfilter]');
    for (var i = 0; i < btns.length; i++) {
      var f = btns[i].getAttribute('data-vfilter');
      btns[i].classList.toggle('active', f === estadoVisual.filtroSidebar);
    }
  }

  function sincronizarBotoesModoGrafico() {
    var btns = document.querySelectorAll('#visual-mode-group [data-vmode]');
    for (var i = 0; i < btns.length; i++) {
      var m = btns[i].getAttribute('data-vmode');
      btns[i].classList.toggle('active', m === estadoVisual.modoGrafico);
    }
  }

  function sincronizarBotoesPeriodo() {
    var btns = document.querySelectorAll('#visual-period-group [data-vperiod]');
    for (var i = 0; i < btns.length; i++) {
      var p = Number(btns[i].getAttribute('data-vperiod'));
      btns[i].classList.toggle('active', p === estadoVisual.periodoAnos);
    }
  }

  function renderizarVisaoGraficaCompleta() {
    if (estadoVisual.abaAtiva !== 'visual') return;
    garantirAtivoInicialSelecionado();
    renderizarListaSidebar();
    renderizarBarraComparacao();
    renderizarGraficoPrecoETetos();
    renderizarDiagnosticoValueTrap();
    executarSimulacaoRendimento();
  }

  window.obterEstadoVisaoGrafica = function () {
    return {
      aba: estadoVisual.abaAtiva,
      ativo: estadoVisual.tickerPrincipal,
      comparar: estadoVisual.tickersComparados.slice(),
      periodo: estadoVisual.periodoAnos,
      modo: estadoVisual.modoGrafico
    };
  };

  window.aplicarEstadoVisaoGrafica = function (params) {
    if (!params) return;
    if (params.ativo && buscarAtivo(params.ativo)) {
      estadoVisual.tickerPrincipal = String(params.ativo).toUpperCase();
    }
    if (params.periodo) {
      var p = parseInt(String(params.periodo).replace('y', ''), 10);
      if ([1, 2, 3, 5].indexOf(p) !== -1) {
        estadoVisual.periodoAnos = p;
        estadoVisual.simAnos = p;
        sincronizarBotoesPeriodo();
        var btnsSimP = document.querySelectorAll('#sim-period-group [data-speriod]');
        for (var i = 0; i < btnsSimP.length; i++) {
          btnsSimP[i].classList.toggle('active', Number(btnsSimP[i].getAttribute('data-speriod')) === p);
        }
      }
    }
    if (params.modo && (params.modo === 'price' || params.modo === 'norm')) {
      estadoVisual.modoGrafico = params.modo;
      sincronizarBotoesModoGrafico();
    }
    if (params.comparar) {
      var listaCmp = String(params.comparar).split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(function (tk) {
        return tk && tk !== estadoVisual.tickerPrincipal && buscarAtivo(tk);
      });
      estadoVisual.tickersComparados = listaCmp.slice(0, 4);
    }
    if (params.aba && ['tabela', 'visual', 'matriz', 'calendario'].indexOf(params.aba) !== -1) {
      alternarAbaPrincipal(params.aba, { semHash: true });
    }
  };

  function configurarEventosVisaoGrafica() {
    var botoesAba = document.querySelectorAll('[data-view-tab]');
    for (var i = 0; i < botoesAba.length; i++) {
      botoesAba[i].addEventListener('click', function () {
        var aba = this.getAttribute('data-view-tab');
        alternarAbaPrincipal(aba);
      });
    }

    var btnToggleSidebar = el('btn-toggle-visual-sidebar');
    var layoutVisual = document.querySelector('.visual-layout');
    if (btnToggleSidebar && layoutVisual) {
      btnToggleSidebar.addEventListener('click', function () {
        estadoVisual.sidebarRecolhida = !estadoVisual.sidebarRecolhida;
        layoutVisual.classList.toggle('is-sidebar-collapsed', estadoVisual.sidebarRecolhida);
        btnToggleSidebar.setAttribute('aria-expanded', estadoVisual.sidebarRecolhida ? 'false' : 'true');
        btnToggleSidebar.textContent = estadoVisual.sidebarRecolhida ? '»' : '«';
      });
    }

    var inpBusca = el('visual-search-input');
    var timerBuscaVisual = null;
    if (inpBusca) {
      inpBusca.addEventListener('input', function () {
        var val = this.value || '';
        if (timerBuscaVisual) clearTimeout(timerBuscaVisual);
        timerBuscaVisual = setTimeout(function () {
          estadoVisual.buscaSidebar = val;
          renderizarListaSidebar();
        }, 150);
      });
    }

    var btnsFiltro = document.querySelectorAll('#visual-sidebar-filters [data-vfilter]');
    for (var f = 0; f < btnsFiltro.length; f++) {
      btnsFiltro[f].addEventListener('click', function () {
        estadoVisual.filtroSidebar = this.getAttribute('data-vfilter') || 'todos';
        sincronizarBotoesFiltroSidebar();
        renderizarListaSidebar();
      });
    }

    var btnClearCmp = el('visual-clear-compare');
    if (btnClearCmp) {
      btnClearCmp.addEventListener('click', function () {
        estadoVisual.tickersComparados = [];
        if (estadoVisual.modoGrafico === 'norm') {
          estadoVisual.modoGrafico = 'price';
          sincronizarBotoesModoGrafico();
        }
        renderizarVisaoGraficaCompleta();
        if (typeof window.sincronizarEstadoUrl === 'function') {
          window.sincronizarEstadoUrl();
        }
      });
    }

    var btnsPeriodo = document.querySelectorAll('#visual-period-group [data-vperiod]');
    for (var p = 0; p < btnsPeriodo.length; p++) {
      btnsPeriodo[p].addEventListener('click', function () {
        estadoVisual.periodoAnos = Number(this.getAttribute('data-vperiod')) || 5;
        sincronizarBotoesPeriodo();
        renderizarGraficoPrecoETetos();
        renderizarDiagnosticoValueTrap();
        if (typeof window.sincronizarEstadoUrl === 'function') {
          window.sincronizarEstadoUrl();
        }
      });
    }

    var btnsModo = document.querySelectorAll('#visual-mode-group [data-vmode]');
    for (var m = 0; m < btnsModo.length; m++) {
      btnsModo[m].addEventListener('click', function () {
        estadoVisual.modoGrafico = this.getAttribute('data-vmode') || 'price';
        sincronizarBotoesModoGrafico();
        renderizarGraficoPrecoETetos();
        if (typeof window.sincronizarEstadoUrl === 'function') {
          window.sincronizarEstadoUrl();
        }
      });
    }

    var checksTeto = document.querySelectorAll('#visual-ceilings-toggles [data-ceiling]');
    for (var c = 0; c < checksTeto.length; c++) {
      checksTeto[c].addEventListener('change', function () {
        var chave = this.getAttribute('data-ceiling');
        estadoVisual.mostrarTetos[chave] = Boolean(this.checked);
        var labelPai = this.parentElement;
        if (labelPai) {
          labelPai.classList.toggle('active', Boolean(this.checked));
        }
        renderizarGraficoPrecoETetos();
      });
    }

    var btnDetalhe = el('visual-open-detail-btn');
    if (btnDetalhe) {
      btnDetalhe.addEventListener('click', function () {
        if (typeof window.abrirDetalheAtivo === 'function' && estadoVisual.tickerPrincipal) {
          window.abrirDetalheAtivo(estadoVisual.tickerPrincipal);
        }
      });
    }

    var btnExportPng = el('btn-export-visual-png');
    if (btnExportPng) {
      btnExportPng.addEventListener('click', function () {
        var svg = el('visual-price-svg');
        if (svg && typeof window.exportarSvgComoPng === 'function') {
          var tk = estadoVisual.tickerPrincipal || 'ativo';
          window.exportarSvgComoPng(svg, 'grafico-valuation-' + tk.toLowerCase() + '.png');
        }
      });
    }

    var inpSimIni = el('sim-initial-input');
    var inpSimMen = el('sim-monthly-input');
    if (inpSimIni) inpSimIni.addEventListener('input', executarSimulacaoRendimento);
    if (inpSimMen) inpSimMen.addEventListener('input', executarSimulacaoRendimento);

    var btnsSimP = document.querySelectorAll('#sim-period-group [data-speriod]');
    for (var sp = 0; sp < btnsSimP.length; sp++) {
      btnsSimP[sp].addEventListener('click', function () {
        estadoVisual.simAnos = Number(this.getAttribute('data-speriod')) || 5;
        for (var k = 0; k < btnsSimP.length; k++) {
          btnsSimP[k].classList.toggle('active', btnsSimP[k] === this);
        }
        executarSimulacaoRendimento();
      });
    }

    var btnsSimReinv = document.querySelectorAll('#sim-reinvest-group [data-sreinv]');
    for (var sr = 0; sr < btnsSimReinv.length; sr++) {
      btnsSimReinv[sr].addEventListener('click', function () {
        estadoVisual.simReinvestir = this.getAttribute('data-sreinv') === 'yes';
        for (var k = 0; k < btnsSimReinv.length; k++) {
          btnsSimReinv[k].classList.toggle('active', btnsSimReinv[k] === this);
        }
        executarSimulacaoRendimento();
      });
    }

    var btnIrJcp = el('sim-net-jcp-btn');
    if (btnIrJcp) {
      btnIrJcp.addEventListener('click', function () {
        estadoVisual.simDescontarIrJcp = !estadoVisual.simDescontarIrJcp;
        btnIrJcp.classList.toggle('active', estadoVisual.simDescontarIrJcp);
        btnIrJcp.setAttribute('aria-pressed', estadoVisual.simDescontarIrJcp ? 'true' : 'false');
        btnIrJcp.textContent = estadoVisual.simDescontarIrJcp
          ? '✓ Descontar 15% IR no JCP'
          : 'JCP bruto (sem descontar IR)';
        executarSimulacaoRendimento();
      });
    }

    var timerResize = null;
    window.addEventListener('resize', function () {
      if (estadoVisual.abaAtiva !== 'visual') return;
      if (timerResize) clearTimeout(timerResize);
      timerResize = setTimeout(function () {
        renderizarGraficoPrecoETetos();
        executarSimulacaoRendimento();
      }, 150);
    });
  }

  function inicializarModuloVisual() {
    if (!window.VALUATION_DATA || !Array.isArray(window.VALUATION_DATA.ativos)) {
      return;
    }
    garantirAtivoInicialSelecionado();
    renderizarDemaisPapeisCard();
    configurarEventosVisaoGrafica();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarModuloVisual);
  } else {
    inicializarModuloVisual();
  }
})();
