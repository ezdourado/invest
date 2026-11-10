/* Carteira, renda projetada, aporte do mês e alertas.
 *
 * Somente leitura do payload (window.VALUATION_DATA) + estado pessoal no localStorage
 * deste navegador (posições, pesos-alvo por setor e preferências). Nada é enviado a
 * servidor algum; há exportação/importação em JSON para levar a carteira a outro aparelho.
 *
 * Depende de funções globais de data.js: esc, valido, fmtReal, fmtRealSinal, fmtPct,
 * fmtPctSimples, classeMargem, mapearSetorBesst, passaFiltroQualidade, htmlVeredito,
 * hojeIsoSaoPaulo, mostrarToast, abrirDetalhe.
 */
(function () {
  'use strict';

  const CHAVE = 'painel_carteira_v1';
  const CHAVE_ALERTAS = 'painel_carteira_alertas_v1';
  const SETORES = [
    { id: 'bancos', nome: 'Bancos' },
    { id: 'energia', nome: 'Energia' },
    { id: 'saneamento', nome: 'Saneamento' },
    { id: 'seguros', nome: 'Seguros' },
    { id: 'telecom', nome: 'Telecom' },
    { id: 'outros', nome: 'Fora do BESST' }
  ];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const IR_JCP = 0.15;

  const PADRAO = {
    posicoes: [],
    alvos: { bancos: 20, energia: 20, saneamento: 20, seguros: 20, telecom: 20, outros: 0 },
    config: { baseRenda: '12m', jcpLiquido: false, margemMinAporte: 0.10, aporte: 1000, alertas: true, versao: 2 },
    meta: { rendaMensal: 1000, tickers: [], anos: 10 }
  };
  const MAX_META = 4;
  const G_MAX_PROJECAO = 0.12; // crescimento do dividendo usado na projeção é limitado a 12% a.a.
  const CORES_META = ['#06b6d4', '#f97316', '#a855f7', '#22c55e'];
  const LIQUIDEZ_MIN_PARES = 5e6; // R$ 5 milhões/dia de volume médio

  const $c = sel => document.querySelector(sel);

  /* ---------- Estado ---------- */

  // Versão 2 (10/11/2026): a renda passa a usar por padrão o DY real dos últimos 12 meses, bruto.
  // Configurações antigas (padrão 'menor' + JCP líquido) são migradas uma vez.
  function migrarConfig(cfg) {
    if ((cfg.versao || 1) < 2) {
      cfg.baseRenda = '12m';
      cfg.jcpLiquido = false;
      cfg.versao = 2;
    }
    return cfg;
  }

  function lerEstado() {
    try {
      const bruto = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (!bruto || typeof bruto !== 'object') return structuredClone(PADRAO);
      return {
        posicoes: Array.isArray(bruto.posicoes) ? bruto.posicoes.filter(p => p && p.ticker) : [],
        alvos: { ...PADRAO.alvos, ...(bruto.alvos || {}) },
        config: migrarConfig({ ...PADRAO.config, ...(bruto.config || {}) }),
        meta: { ...PADRAO.meta, ...(bruto.meta || {}) }
      };
    } catch (_) {
      return structuredClone(PADRAO);
    }
  }

  function gravarEstado() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (_) { /* modo privado */ }
  }

  let estado = lerEstado();

  function universo() {
    return Array.isArray(window.VALUATION_DATA?.ativos) ? window.VALUATION_DATA.ativos : [];
  }

  function mapaUniv() {
    return new Map(universo().map(a => [a.ticker.toUpperCase(), a]));
  }

  function setorDe(a) {
    return mapearSetorBesst(a?.setor) || 'outros';
  }

  /* ---------- Renda: base anual, perfil mensal e projeção de 12 meses ---------- */

  // Fração do valor histórico pago como JCP (sujeito a 15% de IR na fonte).
  function fracaoJcp(a) {
    const provs = (a.proventos_historico || []).filter(p => p.tipo !== 'extraordinario');
    const total = provs.reduce((s, p) => s + p.valor, 0);
    if (!(total > 0)) return 0;
    return provs.filter(p => p.tipo === 'jcp').reduce((s, p) => s + p.valor, 0) / total;
  }

  function fatorLiquido(a) {
    return estado.config.jcpLiquido ? 1 - IR_JCP * fracaoJcp(a) : 1;
  }

  // DPA usado na projeção: '12m' = recorrente pago nos últimos 12 meses (padrão, o DY atual),
  // '5a' = média dos últimos 60 meses, 'menor' = o menor dos dois (cenário conservador).
  function dpaBase(a) {
    const d5 = a.bazin?.dpa_sem_extra;
    const d12 = a.bazin?.dpa_12m;
    const ok5 = valido(d5) && d5 > 0;
    const ok12 = valido(d12) && d12 >= 0;
    if (estado.config.baseRenda === '5a') return ok5 ? d5 : (ok12 ? d12 : 0);
    if (estado.config.baseRenda === '12m') return ok12 ? d12 : (ok5 ? d5 : 0);
    if (ok5 && ok12) return Math.min(d5, d12);
    return ok5 ? d5 : (ok12 ? d12 : 0);
  }

  function rotuloBase() {
    const b = { '12m': 'DY atual (pago nos últimos 12 meses)', '5a': 'DY médio dos últimos 5 anos', menor: 'conservador: menor entre 12 meses e média 5a' }[estado.config.baseRenda] || 'DY atual';
    return `${b}${estado.config.jcpLiquido ? ', JCP líquido de IR' : ', bruto'}`;
  }

  // Perfil de pagamento por mês (frações que somam 1) a partir dos 5 anos fechados.
  function perfilMensal(a) {
    const anoAtual = Number(hojeIsoSaoPaulo().slice(0, 4));
    const pesos = new Array(12).fill(0);
    (a.proventos_historico || []).forEach(p => {
      if (p.tipo === 'extraordinario') return;
      const anoCom = Number(String(p.data_com).slice(0, 4));
      if (anoCom < anoAtual - 5 || anoCom >= anoAtual) return;
      let ref = p.data_pagamento;
      if (!ref) {
        const d = new Date(String(p.data_com).slice(0, 10) + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + 30);
        ref = d.toISOString().slice(0, 10);
      }
      pesos[Number(String(ref).slice(5, 7)) - 1] += p.valor;
    });
    const soma = pesos.reduce((s, v) => s + v, 0);
    return soma > 0 ? pesos.map(v => v / soma) : new Array(12).fill(1 / 12);
  }

  function proximosMeses() {
    const hoje = hojeIsoSaoPaulo();
    let ano = Number(hoje.slice(0, 4));
    let mes = Number(hoje.slice(5, 7));
    const lista = [];
    for (let i = 0; i < 12; i++) {
      lista.push({ ano, mes, chave: `${ano}-${String(mes).padStart(2, '0')}` });
      mes += 1;
      if (mes > 12) { mes = 1; ano += 1; }
    }
    return lista;
  }

  // Projeção por posição: pagamentos já anunciados (confirmados) + estimativa pelo perfil histórico.
  function projetarPosicao(a, qtd) {
    const meses = proximosMeses();
    const chaves = new Set(meses.map(m => m.chave));
    const fl = fatorLiquido(a);
    const confirmado = new Array(12).fill(0);
    (a.agenda_anunciada || []).forEach(ev => {
      if (!ev.data_pagamento || !(ev.valor > 0)) return;
      const k = String(ev.data_pagamento).slice(0, 7);
      if (!chaves.has(k)) return;
      const idx = meses.findIndex(m => m.chave === k);
      const liq = estado.config.jcpLiquido && ev.tipo === 'jcp' ? 1 - IR_JCP : 1;
      confirmado[idx] += ev.valor * liq * qtd;
    });
    const baseAnual = dpaBase(a) * qtd * fl;
    const totalConf = confirmado.reduce((s, v) => s + v, 0);
    const perfil = perfilMensal(a);
    const livres = meses.map((m, i) => (confirmado[i] > 0 ? 0 : perfil[m.mes - 1]));
    const somaLivres = livres.reduce((s, v) => s + v, 0);
    const restante = Math.max(0, baseAnual - totalConf);
    const estimado = livres.map(v => (somaLivres > 0 ? (v / somaLivres) * restante : 0));
    return { confirmado, estimado, baseAnual };
  }

  /* ---------- Cálculo consolidado ---------- */

  function consolidar() {
    const mapa = mapaUniv();
    const linhas = estado.posicoes.map(p => {
      const a = mapa.get(String(p.ticker).toUpperCase());
      const qtd = Number(p.qtd) || 0;
      const pm = Number(p.pm) || 0;
      if (!a) return { p, a: null, qtd, pm };
      const valor = qtd * a.preco;
      const custo = qtd * pm;
      const proj = projetarPosicao(a, qtd);
      return {
        p, a, qtd, pm, valor, custo,
        resultado: custo > 0 ? valor / custo - 1 : null,
        rendaAnual: proj.baseAnual,
        yoc: custo > 0 ? proj.baseAnual / custo : null,
        dyAtual: valor > 0 ? proj.baseAnual / valor : null,
        proj,
        setor: setorDe(a)
      };
    });
    const validas = linhas.filter(l => l.a);
    const total = validas.reduce((s, l) => s + l.valor, 0);
    const custo = validas.reduce((s, l) => s + l.custo, 0);
    const renda = validas.reduce((s, l) => s + l.rendaAnual, 0);
    validas.forEach(l => { l.peso = total > 0 ? l.valor / total : 0; });
    const pesoSetor = {};
    SETORES.forEach(s => { pesoSetor[s.id] = 0; });
    validas.forEach(l => { pesoSetor[l.setor] += l.peso; });
    const meses = proximosMeses();
    const conf = new Array(12).fill(0);
    const est = new Array(12).fill(0);
    validas.forEach(l => l.proj.confirmado.forEach((v, i) => { conf[i] += v; est[i] += l.proj.estimado[i]; }));
    return { linhas, validas, total, custo, renda, pesoSetor, meses, conf, est };
  }

  /* ---------- Render ---------- */

  function htmlKpis(c) {
    const res = c.custo > 0 ? c.total / c.custo - 1 : null;
    const yoc = c.custo > 0 ? c.renda / c.custo : null;
    const dy = c.total > 0 ? c.renda / c.total : null;
    const base = rotuloBase();
    return `
      <div class="kpi"><div class="kpi-label"><span>Patrimônio</span></div>
        <div class="kpi-value">${fmtReal(c.total)}</div>
        <div class="kpi-foot">${c.validas.length} ${c.validas.length === 1 ? 'posição' : 'posições'} · custo ${fmtReal(c.custo)}</div></div>
      <div class="kpi"><div class="kpi-label"><span>Resultado</span>${valido(res) ? `<span class="mono ${res >= 0 ? 't-green' : 't-red'}">${fmtPct(res)}</span>` : ''}</div>
        <div class="kpi-value ${valido(res) ? (res >= 0 ? 't-green' : 't-red') : ''}">${fmtRealSinal(c.total - c.custo)}</div>
        <div class="kpi-foot">Valorização da cotação (sem proventos recebidos)</div></div>
      <div class="kpi" data-tip="Renda anual estimada = quantidade × DPA (${esc(base)})${estado.config.jcpLiquido ? ', com JCP líquido de 15% de IR' : ', bruta'}. Não inclui extraordinários.">
        <div class="kpi-label"><span>Renda anual projetada</span></div>
        <div class="kpi-value t-green">${fmtReal(c.renda)}</div>
        <div class="kpi-foot">≈ ${fmtReal(c.renda / 12)} por mês · base: ${esc(base)}</div></div>
      <div class="kpi" data-tip="Yield on cost = renda anual ÷ custo de aquisição. DY atual = renda anual ÷ valor de mercado da carteira.">
        <div class="kpi-label"><span>Yield on cost</span></div>
        <div class="kpi-value">${valido(yoc) ? fmtPctSimples(yoc, 2) : '—'}</div>
        <div class="kpi-foot">DY sobre o valor atual: ${valido(dy) ? fmtPctSimples(dy, 2) : '—'}</div></div>`;
  }

  function htmlPosicoes(c) {
    if (!c.linhas.length) {
      return `<div class="cart-vazio"><strong>Sua carteira está vazia.</strong> Adicione posições acima (ticker, quantidade e preço médio) para ver renda projetada, concentração por setor e sugestões de aporte. Os dados ficam só neste navegador.</div>`;
    }
    const linhas = [...c.linhas].sort((x, y) => (y.valor || 0) - (x.valor || 0));
    return `
      <div class="table-wrap">
        <table class="vt cart-table">
          <thead><tr>
            <th>Ativo</th><th class="num">Qtd.</th><th class="num">Preço médio</th><th class="num">Preço</th>
            <th class="num">Valor</th><th class="num">Peso</th><th class="num">Resultado</th>
            <th class="num" data-tip="Renda anual estimada da posição">Renda/ano</th>
            <th class="num" data-tip="Renda anual ÷ custo">YoC</th>
            <th class="num">Margem Bazin</th><th>Situação</th><th class="col-actions"><span class="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            ${linhas.map(l => {
              if (!l.a) {
                return `<tr><td><span class="asset-ticker">${esc(l.p.ticker)}</span><span class="cell-sub t-red">Fora da base de dados</span></td><td class="num mono">${l.qtd}</td><td class="num mono">${fmtReal(l.pm)}</td><td colspan="8" class="t-dim">Sem cotação para este ticker</td>
                  <td class="c-actions"><button type="button" class="icon-btn remove" data-cart-remove="${esc(l.p.ticker)}" aria-label="Remover ${esc(l.p.ticker)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td></tr>`;
              }
              const b = l.a.bazin || {};
              return `
                <tr class="row" data-cart-detail="${esc(l.a.ticker)}">
                  <td data-label="Ativo"><div class="asset"><span class="asset-ticker">${esc(l.a.ticker)}</span><span class="asset-sector">${esc(SETORES.find(s => s.id === l.setor)?.nome || l.a.setor)}</span></div></td>
                  <td class="num" data-label="Qtd."><input class="cart-input" type="number" min="0" step="1" value="${l.qtd}" data-cart-edit="qtd" data-ticker="${esc(l.a.ticker)}" aria-label="Quantidade de ${esc(l.a.ticker)}"></td>
                  <td class="num" data-label="Preço médio"><input class="cart-input" type="number" min="0" step="0.01" value="${l.pm}" data-cart-edit="pm" data-ticker="${esc(l.a.ticker)}" aria-label="Preço médio de ${esc(l.a.ticker)}"></td>
                  <td class="num mono" data-label="Preço">${fmtReal(l.a.preco)}</td>
                  <td class="num mono" data-label="Valor">${fmtReal(l.valor)}</td>
                  <td class="num mono" data-label="Peso">${fmtPctSimples(l.peso)}</td>
                  <td class="num mono ${valido(l.resultado) ? (l.resultado >= 0 ? 't-green' : 't-red') : ''}" data-label="Resultado">${fmtPct(l.resultado)}</td>
                  <td class="num mono" data-label="Renda/ano">${fmtReal(l.rendaAnual)}</td>
                  <td class="num mono" data-label="YoC">${valido(l.yoc) ? fmtPctSimples(l.yoc, 2) : '—'}</td>
                  <td class="num mono ${classeMargem(b.teto > 0 ? b.margem_seguranca : null)}" data-label="Margem Bazin">${b.teto > 0 ? fmtPct(b.margem_seguranca) : '—'}</td>
                  <td data-label="Situação">${b.teto > 0 ? htmlVeredito(b.veredito) : '<span class="tag">Sem teto</span>'}</td>
                  <td class="c-actions"><div class="row-actions">
                    <button type="button" class="icon-btn remove" data-cart-remove="${esc(l.a.ticker)}" data-tip="Remover da carteira" aria-label="Remover ${esc(l.a.ticker)} da carteira"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
                  </div></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function htmlSetores(c) {
    const somaAlvos = SETORES.reduce((s, x) => s + (Number(estado.alvos[x.id]) || 0), 0);
    return `
      <div class="cart-setores">
        ${SETORES.map(s => {
          const atual = c.pesoSetor[s.id] || 0;
          const alvo = (Number(estado.alvos[s.id]) || 0) / 100;
          const dif = atual - alvo;
          const cls = Math.abs(dif) <= 0.03 ? '' : (dif < 0 ? 't-yellow' : 't-red');
          const rot = Math.abs(dif) <= 0.03 ? 'no alvo' : (dif < 0 ? `${fmtPctSimples(-dif, 0)} abaixo` : `${fmtPctSimples(dif, 0)} acima`);
          return `
            <div class="cart-setor-row">
              <span class="cart-setor-nome">${esc(s.nome)}</span>
              <svg class="cart-setor-bar" viewBox="0 0 100 10" preserveAspectRatio="none" data-tip="${esc(s.nome)}: ${fmtPctSimples(atual)} da carteira (alvo ${fmtPctSimples(alvo, 0)})" role="img" aria-label="${esc(s.nome)}: ${fmtPctSimples(atual)} da carteira, alvo ${fmtPctSimples(alvo, 0)}">
                <rect class="cart-setor-trilho" x="0" y="2" width="100" height="6" rx="3" />
                <rect class="cart-setor-fill" x="0" y="2" width="${Math.min(100, atual * 100).toFixed(1)}" height="6" rx="3" />
                ${alvo > 0 ? `<line class="cart-setor-alvo" x1="${Math.min(99.5, alvo * 100).toFixed(1)}" x2="${Math.min(99.5, alvo * 100).toFixed(1)}" y1="0" y2="10" vector-effect="non-scaling-stroke" />` : ''}
              </svg>
              <span class="mono cart-setor-pct">${fmtPctSimples(atual, 0)}</span>
              <label class="cart-alvo-wrap"><span class="sr-only">Peso-alvo de ${esc(s.nome)} (%)</span>
                <input class="cart-input cart-alvo" type="number" min="0" max="100" step="5" value="${Number(estado.alvos[s.id]) || 0}" data-cart-alvo="${s.id}">%
              </label>
              <span class="cell-sub ${cls}">${rot}</span>
            </div>`;
        }).join('')}
        <p class="d-note">Alvos somam ${somaAlvos}%${somaAlvos !== 100 ? ' <span class="t-yellow">(ajuste para 100%)</span>' : ''}. Padrão: 20% em cada setor BESST, como na carteira previdenciária de Barsi. O alvo orienta o "Aporte do mês"; setores com alvo 0% não recebem sugestão.</p>
      </div>`;
  }

  function htmlRendaMensal(c) {
    if (!c.validas.length) return '<p class="d-note">Adicione posições para ver a renda projetada mês a mês.</p>';
    const W = 640, H = 180, base = 150, topo = 18;
    const totais = c.meses.map((_, i) => c.conf[i] + c.est[i]);
    const max = Math.max(...totais, 1) * 1.15;
    const passo = W / 12;
    const larg = passo * 0.6;
    const barras = c.meses.map((m, i) => {
      const x = i * passo + (passo - larg) / 2;
      const hC = (c.conf[i] / max) * (base - topo);
      const hE = (c.est[i] / max) * (base - topo);
      const tip = `${MESES[m.mes - 1]}/${String(m.ano).slice(2)}: ${fmtReal(totais[i])} (${fmtReal(c.conf[i])} anunciado + ${fmtReal(c.est[i])} estimado)`;
      return `
        <g data-tip="${esc(tip)}">
          <rect x="${x}" y="${topo}" width="${larg}" height="${base - topo}" fill="transparent" />
          ${hE > 0 ? `<rect class="cart-bar-est" x="${x}" y="${base - hC - hE}" width="${larg}" height="${hE}" rx="2" />` : ''}
          ${hC > 0 ? `<rect class="cart-bar-conf" x="${x}" y="${base - hC}" width="${larg}" height="${hC}" rx="2" />` : ''}
          ${totais[i] > 0 ? `<text class="cart-bar-val" x="${x + larg / 2}" y="${base - hC - hE - 4}" text-anchor="middle">${Math.round(totais[i]).toLocaleString('pt-BR')}</text>` : ''}
          <text class="frd-eixo" x="${x + larg / 2}" y="${base + 16}" text-anchor="middle">${MESES[m.mes - 1]}</text>
        </g>`;
    }).join('');
    const totalAno = totais.reduce((s, v) => s + v, 0);
    return `
      <svg class="vsvg cart-renda-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Renda projetada nos próximos 12 meses">
        <line class="frd-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />
        ${barras}
      </svg>
      <div class="frd-legenda">
        <span><i class="frd-sw cart-sw-conf"></i>Anunciado (data de pagamento definida)</span>
        <span><i class="frd-sw cart-sw-est"></i>Estimado pelo histórico de 5 anos</span>
        <span class="mono">Total 12 meses: ${fmtReal(totalAno)}</span>
      </div>
      <p class="d-note">Estimativa: a renda anual de cada posição é distribuída pelos meses em que a empresa costuma pagar; pagamentos já anunciados substituem a estimativa. Pressupõe que você mantenha as posições até as datas-com.</p>`;
  }

  // Ranking de aporte: oportunidades qualificadas, ponderadas pela margem, pelo score e pelo gap de setor.
  function candidatosAporte(c) {
    const posse = new Set(c.validas.map(l => l.a.ticker));
    const margemMin = Number(estado.config.margemMinAporte) || 0;
    const usaAlvos = SETORES.some(s => (Number(estado.alvos[s.id]) || 0) > 0);
    return universo()
      .filter(a => passaFiltroQualidade(a) && (a.bazin?.margem_seguranca ?? -1) >= margemMin)
      // Setor com alvo 0% é uma escolha explícita de não investir nele: fica fora das sugestões.
      .filter(a => !usaAlvos || (Number(estado.alvos[setorDe(a)]) || 0) > 0)
      .map(a => {
        const s = setorDe(a);
        const alvo = (Number(estado.alvos[s]) || 0) / 100;
        const atual = c.pesoSetor[s] || 0;
        const gap = alvo - atual;
        let fatorSetor = 1 + Math.max(0, gap) * 2;
        if (gap < -0.05) fatorSetor = 0.6;
        const nota = (a.sustentabilidade?.nota ?? 50) / 100;
        const pontos = a.bazin.margem_seguranca * nota * fatorSetor;
        // Setor mais de 5 p.p. acima do alvo: aparece na lista, mas não recebe o aporte.
        const acimaDoAlvo = gap < -0.05;
        return { a, setor: s, alvo, atual, pontos, fatorSetor, acimaDoAlvo, temPosicao: posse.has(a.ticker) };
      })
      // Primeiro quem pode receber aporte (setor não acima do alvo); depois, pela pontuação.
      .sort((x, y) => (Number(x.acimaDoAlvo) - Number(y.acimaDoAlvo)) || (y.pontos - x.pontos))
      // Uma linha por empresa (ex.: CEBR3/CEBR5/CEBR6): fica a classe com melhor pontuação.
      .filter((x, i, lista) => lista.findIndex(y => y.a.ticker.slice(0, 4) === x.a.ticker.slice(0, 4)) === i)
      .slice(0, 10);
  }

  function htmlAporte(c) {
    const cands = candidatosAporte(c);
    const valor = Number(estado.config.aporte) || 0;
    if (!cands.length) {
      return `<p class="d-note">Nenhum papel da base passa no filtro (abaixo do teto com margem ≥ ${fmtPctSimples(estado.config.margemMinAporte, 0)}, score Forte/Moderado e dividendo recente sem queda). Reduza a margem mínima ou aguarde.</p>`;
    }
    const top = cands.filter(x => !x.acimaDoAlvo).slice(0, 3);
    const somaPts = top.reduce((s, x) => s + x.pontos, 0) || 1;
    let sobra = valor;
    const sugest = new Map();
    top.forEach(x => {
      const alocado = valor * (x.pontos / somaPts);
      const qtd = Math.floor(alocado / x.a.preco);
      sugest.set(x.a.ticker, qtd);
      sobra -= qtd * x.a.preco;
    });
    return `
      <div class="table-wrap">
        <table class="vt cart-table">
          <thead><tr>
            <th>#</th><th>Ativo</th><th class="num">Preço</th><th class="num">Margem</th><th class="num">Score</th>
            <th class="num" data-tip="DPA 12m ÷ DPA 5a">Div. 12m/5a</th><th class="num" data-tip="Peso atual do setor na carteira → peso-alvo">Setor (atual → alvo)</th>
            <th class="num" data-tip="DY real: pago nos últimos 12 meses ÷ cotação, bruto">DY 12m</th>
            <th class="num">Sugestão</th>
          </tr></thead>
          <tbody>
            ${cands.map((x, i) => {
              const q = sugest.get(x.a.ticker);
              const b = x.a.bazin;
              return `
                <tr class="row" data-cart-detail="${esc(x.a.ticker)}">
                  <td class="mono t-dim">${i + 1}</td>
                  <td><div class="asset"><span class="asset-ticker">${esc(x.a.ticker)} ${x.temPosicao ? '<span class="tag">na carteira</span>' : ''}</span><span class="asset-sector">${esc(SETORES.find(s => s.id === x.setor)?.nome || x.a.setor)}</span></div></td>
                  <td class="num mono">${fmtReal(x.a.preco)}</td>
                  <td class="num mono t-green">${fmtPct(b.margem_seguranca)}</td>
                  <td class="num mono">${x.a.sustentabilidade?.nota ?? '—'}</td>
                  <td class="num mono">${valido(b.razao_12m_5a) ? fmtPctSimples(b.razao_12m_5a, 0) : '—'}</td>
                  <td class="num mono ${x.fatorSetor > 1 ? 't-green' : (x.fatorSetor < 1 ? 't-yellow' : '')}">${fmtPctSimples(x.atual, 0)} → ${fmtPctSimples(x.alvo, 0)}</td>
                  <td class="num mono">${fmtPctSimples(dyReal12m(x.a), 2)}</td>
                  <td class="num mono">${q !== undefined ? (q > 0 ? `<strong>${q}</strong> ações · ${fmtReal(q * x.a.preco)}` : '<span class="t-dim">valor insuficiente</span>') : (x.acimaDoAlvo ? '<span class="t-yellow">setor acima do alvo</span>' : '<span class="t-dim">—</span>')}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="d-note">Sugestão divide o aporte entre os 3 primeiros cujo setor não está acima do alvo, proporcional à pontuação (margem Bazin × score anti-cilada × prioridade do setor abaixo do alvo). Uma linha por empresa (a melhor classe de ações). Sobra: ${fmtReal(Math.max(0, sobra))}. É um apoio quantitativo para a sua decisão, não uma recomendação de investimento.</p>`;
  }

  /* ---------- Meta de renda: quantas ações e quanto capital para R$ X/mês, e quem cresce mais ---------- */

  // Crescimento sustentável do dividendo ≈ ROE × (1 − payout): parte do lucro retida e reinvestida.
  function crescimentoDividendo(a) {
    const f = a.fundamentos || {};
    const roe = f.roe;
    const po = f.payout;
    if (!valido(roe) || roe <= 0 || !valido(po) || po < 0 || po >= 1) return null;
    return roe * (1 - po);
  }

  function calcularMeta(a, rendaMensal, anos) {
    const dpa = dpaBase(a) * fatorLiquido(a);
    if (!(dpa > 0) || !(a.preco > 0)) return { a, valido: false };
    const rendaAnual = rendaMensal * 12;
    const acoes = Math.ceil(rendaAnual / dpa);
    const capital = acoes * a.preco;
    const dy = dpa / a.preco;
    const gBruto = crescimentoDividendo(a);
    const g = gBruto === null ? 0 : Math.max(0, Math.min(G_MAX_PROJECAO, gBruto));
    const serieYoc = Array.from({ length: anos + 1 }, (_, t) => dy * Math.pow(1 + g, t));
    let acumulado = 0;
    for (let t = 0; t < anos; t++) acumulado += acoes * dpa * Math.pow(1 + g, t);
    return {
      a, valido: true, dpa, acoes, capital, dy, gBruto, g, serieYoc, acumulado,
      rendaMensalFinal: (acoes * dpa * Math.pow(1 + g, anos)) / 12,
      emQueda: valido(a.bazin?.razao_12m_5a) && a.bazin.razao_12m_5a < 0.7
    };
  }

  // Pares para comparar: mesmo setor BESST (ou mesmo setor da fonte), uma classe por empresa.
  function sugerirPares(ticker) {
    const mapa = mapaUniv();
    const base = mapa.get(String(ticker).toUpperCase());
    if (!base) return [];
    const chave = a => mapearSetorBesst(a.setor) || String(a.setor || '').toLowerCase();
    const raizBase = base.ticker.slice(0, 4);
    const vistos = new Set([raizBase]);
    const mesmoSetor = universo().filter(a => chave(a) === chave(base) && a.bazin?.dpa_sem_extra > 0 && a.bazin?.teto > 0);
    // Para quem vai montar posição relevante, liquidez importa: prioriza papéis com
    // volume médio ≥ R$ 5 mi/dia; se o setor não tiver nenhum, usa todos.
    const liquidos = mesmoSetor.filter(a => (a.fundamentos?.liquidez_diaria || 0) >= LIQUIDEZ_MIN_PARES);
    return (liquidos.length ? liquidos : mesmoSetor)
      .sort((x, y) => (y.bazin.margem_seguranca ?? -9) - (x.bazin.margem_seguranca ?? -9))
      .filter(a => { const r = a.ticker.slice(0, 4); if (vistos.has(r)) return false; vistos.add(r); return true; })
      .slice(0, MAX_META - 1)
      .map(a => a.ticker);
  }

  function htmlGraficoYoc(linhas, anos) {
    const W = 640, H = 230, padL = 44, padR = 96, padT = 14, padB = 30;
    const maxY = Math.max(...linhas.flatMap(l => l.serieYoc)) * 1.12 || 0.1;
    const xDe = t => padL + (t / anos) * (W - padL - padR);
    const yDe = v => padT + (1 - v / maxY) * (H - padT - padB);
    const passoY = maxY > 0.3 ? 0.1 : (maxY > 0.12 ? 0.04 : 0.02);
    const ticksY = [];
    for (let v = 0; v <= maxY + 1e-9; v += passoY) ticksY.push(v);
    const passoX = anos > 10 ? 5 : (anos > 5 ? 2 : 1);
    const ticksX = [];
    for (let t = 0; t <= anos; t += passoX) ticksX.push(t);

    const grade = ticksY.map(v => `
      <line class="meta-grade" x1="${padL}" x2="${W - padR}" y1="${yDe(v)}" y2="${yDe(v)}" />
      <text class="frd-eixo" x="${padL - 6}" y="${yDe(v) + 4}" text-anchor="end">${fmtPctSimples(v, 0)}</text>`).join('') +
      ticksX.map(t => `<text class="frd-eixo" x="${xDe(t)}" y="${H - 10}" text-anchor="middle">${t === 0 ? 'hoje' : `${t}a`}</text>`).join('');

    // Rótulos finais sem sobreposição: ordena pela altura e afasta no mínimo 13 px.
    const finais = linhas.map((l, i) => ({ i, y: yDe(l.serieYoc[anos]) })).sort((p, q) => p.y - q.y);
    for (let k = 1; k < finais.length; k++) finais[k].y = Math.max(finais[k].y, finais[k - 1].y + 13);
    const yRotulo = new Map(finais.map(f => [f.i, f.y]));

    const series = linhas.map((l, i) => {
      const pts = l.serieYoc.map((v, t) => `${xDe(t).toFixed(1)},${yDe(v).toFixed(1)}`).join(' ');
      const cor = CORES_META[i % CORES_META.length];
      return `
        <polyline class="meta-linha" points="${pts}" style="stroke:${cor}" />
        <circle class="meta-ponto" cx="${xDe(anos)}" cy="${yDe(l.serieYoc[anos])}" r="3" style="fill:${cor}" />
        <text class="meta-rotulo" x="${W - padR + 8}" y="${yRotulo.get(i) + 4}" style="fill:${cor}">${esc(l.a.ticker)} ${fmtPctSimples(l.serieYoc[anos], 1)}</text>`;
    }).join('');

    return `
      <svg class="vsvg meta-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Rendimento anual sobre o capital investido hoje, projetado ano a ano">
        ${grade}
        ${series}
      </svg>`;
  }

  function frasesCruzamento(linhas, anos) {
    if (linhas.length < 2) return [];
    const lider = [...linhas].sort((x, y) => y.dy - x.dy)[0];
    const frases = [`<strong>${esc(lider.a.ticker)}</strong> tem o maior DY hoje (${fmtPctSimples(lider.dy, 1)}): é o que exige menos capital para a meta.`];
    if (lider.gBruto === null) {
      frases.push(`Não há ROE/payout válidos para estimar o crescimento de ${esc(lider.a.ticker)}; a projeção usa 0%, o que pode subestimá-lo.`);
    }
    linhas.forEach(l => {
      if (l === lider) return;
      if (l.gBruto === null) {
        frases.push(`${esc(l.a.ticker)}: sem ROE/payout válidos para estimar o crescimento (projeção com 0%).`);
        return;
      }
      if (l.g <= lider.g) {
        frases.push(`${esc(l.a.ticker)} rende menos hoje e cresce no máximo o mesmo que ${esc(lider.a.ticker)} (${fmtPctSimples(l.g, 1)} a.a.): não alcança no horizonte.`);
        return;
      }
      const t = Math.log(lider.dy / l.dy) / Math.log((1 + l.g) / (1 + lider.g));
      if (Number.isFinite(t) && t > 0 && t <= anos) {
        frases.push(`<strong>${esc(l.a.ticker)}</strong> passa a render mais que ${esc(lider.a.ticker)} sobre o mesmo capital em ~${t < 1 ? 'menos de 1 ano' : `${Math.round(t)} anos`}, crescendo ${fmtPctSimples(l.g, 1)} a.a. contra ${fmtPctSimples(lider.g, 1)}.`);
      } else if (Number.isFinite(t) && t > anos) {
        frases.push(`${esc(l.a.ticker)} cresce mais (${fmtPctSimples(l.g, 1)} a.a.), mas só alcançaria ${esc(lider.a.ticker)} em ~${Math.round(t)} anos, além do horizonte de ${anos}.`);
      }
    });
    return frases;
  }

  function htmlMetaRenda() {
    const meta = estado.meta;
    const anos = Number(meta.anos) || 10;
    const renda = Number(meta.rendaMensal) || 0;
    const mapa = mapaUniv();
    const chips = meta.tickers.map((t, i) => `
      <span class="meta-chip" style="border-color:${CORES_META[i % CORES_META.length]}">
        <i class="meta-chip-cor" style="background:${CORES_META[i % CORES_META.length]}"></i>${esc(t)}
        <button type="button" data-meta-remove="${esc(t)}" aria-label="Remover ${esc(t)} da comparação">×</button>
      </span>`).join('');

    if (!meta.tickers.length) {
      return `<div class="meta-chips">${chips}</div><div class="cart-vazio"><strong>Escolha até ${MAX_META} papéis para comparar.</strong> Digite um ticker e clique em "Comparar" ou use "Sugerir pares do setor" depois de escolher o primeiro.</div>`;
    }

    const calc = meta.tickers.map(t => mapa.get(t)).filter(Boolean).map(a => calcularMeta(a, renda, anos));
    const validas = calc.filter(c => c.valido);
    const invalidas = calc.filter(c => !c.valido).map(c => c.a.ticker);
    const menorCapital = Math.min(...validas.map(c => c.capital));
    const base = rotuloBase();

    const linhasTabela = validas.map((c, i) => {
      const b = c.a.bazin || {};
      const cor = CORES_META[meta.tickers.indexOf(c.a.ticker) % CORES_META.length];
      return `
        <tr class="row" data-cart-detail="${esc(c.a.ticker)}">
          <td data-label="Ativo"><div class="asset"><span class="asset-ticker"><i class="meta-chip-cor" style="background:${cor}"></i>${esc(c.a.ticker)}${c.emQueda ? ' <span class="tag tag-mudou is-saiu" data-tip="Dividendo dos últimos 12 meses abaixo de 70% da média de 5 anos">div. em queda</span>' : ''}</span><span class="asset-sector">${esc(c.a.empresa || c.a.setor)}</span></div></td>
          <td class="num mono" data-label="Preço">${fmtReal(c.a.preco)}</td>
          <td class="num mono" data-label="DY 12m">${fmtPctSimples(dyReal12m(c.a), 2)}</td>
          <td class="num mono" data-label="DY médio 5a">${fmtPctSimples(dyMedio5a(c.a), 2)}</td>
          <td class="num mono" data-label="DY usado na meta"><div class="cell-stack"><strong>${fmtPctSimples(c.dy, 2)}</strong><span class="cell-sub">DPA ${fmtReal(c.dpa)}</span></div></td>
          <td class="num mono" data-label="Ações necessárias"><strong>${c.acoes.toLocaleString('pt-BR')}</strong></td>
          <td class="num mono ${c.capital === menorCapital ? 't-green' : ''}" data-label="Capital">${fmtReal(c.capital)}</td>
          <td class="num mono" data-label="Cresc. div. (g)" data-tip="ROE × (1 − payout). ${c.gBruto === null ? 'Sem ROE/payout válidos: projeção com 0%.' : (c.gBruto > G_MAX_PROJECAO ? `Estimativa bruta ${fmtPctSimples(c.gBruto, 1)}, limitada a ${fmtPctSimples(G_MAX_PROJECAO, 0)} na projeção.` : '')}">${c.gBruto === null ? '—' : fmtPctSimples(c.gBruto, 1)}${c.gBruto !== null && c.gBruto > G_MAX_PROJECAO ? '*' : ''}</td>
          <td class="num mono" data-label="Renda/mês em ${anos}a">${fmtReal(c.rendaMensalFinal)}</td>
          <td class="num mono" data-label="Acumulado ${anos}a">${fmtReal(c.acumulado)}</td>
          <td class="num mono ${classeMargem(b.teto > 0 ? b.margem_seguranca : null)}" data-label="Margem Bazin">${b.teto > 0 ? fmtPct(b.margem_seguranca) : '—'}</td>
          <td class="num mono" data-label="Score">${c.a.sustentabilidade?.nota ?? '—'}</td>
        </tr>`;
    }).join('');

    const frases = frasesCruzamento(validas, anos);
    return `
      <div class="meta-chips">${chips}</div>
      <p class="d-note meta-base">Base da conta: <strong>${esc(base)}</strong>. Troque no seletor “Renda” da seção Posições (DY atual, média 5a ou cenário conservador).</p>
      <div class="table-wrap">
        <table class="vt cart-table">
          <thead><tr>
            <th>Ativo</th><th class="num">Preço</th>
            <th class="num" data-tip="DY real: pago nos últimos 12 meses ÷ cotação, bruto">DY 12m</th>
            <th class="num" data-tip="DPA médio dos últimos 60 meses ÷ cotação">DY médio 5a</th>
            <th class="num" data-tip="O DY que entra na conta da meta: ${esc(base)}. Troque a base no seletor da seção Posições.">DY usado na meta</th>
            <th class="num">Ações necessárias</th><th class="num" data-tip="Ações × preço = renda anual ÷ DY. Depende só do DY, não do preço da ação.">Capital</th>
            <th class="num" data-tip="Crescimento sustentável do dividendo ≈ ROE × (1 − payout)">Cresc. div. (g)</th>
            <th class="num" data-tip="Com o mesmo número de ações, se o dividendo crescer a g">Renda/mês em ${anos}a</th>
            <th class="num" data-tip="Soma dos proventos recebidos no período, com o mesmo número de ações">Acumulado ${anos}a</th>
            <th class="num">Margem Bazin</th><th class="num">Score</th>
          </tr></thead>
          <tbody>${linhasTabela}</tbody>
        </table>
      </div>
      ${invalidas.length ? `<p class="d-note t-yellow">Sem DPA para calcular: ${invalidas.map(esc).join(', ')}.</p>` : ''}
      ${validas.length ? `
        <div class="meta-grafico">
          <div class="d-sub-title">Rendimento anual sobre o capital investido hoje (yield on cost projetado)</div>
          ${htmlGraficoYoc(validas, anos)}
        </div>
        <ul class="meta-leitura">${frases.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      <p class="d-note">Como ler: o capital para a meta depende só do DY (renda ÷ DY), não do preço da ação; um preço menor só significa mais ações. O que pode fazer a renda crescer é a parte do lucro que a empresa retém e reinveste (g ≈ ROE × (1 − payout)), limitada a ${fmtPctSimples(G_MAX_PROJECAO, 0)} a.a. na projeção. Não inclui valorização da cotação nem reinvestimento dos proventos. Estimativa, não promessa.</p>`;
  }

  function renderizarCarteira(forcar = false) {
    const raiz = $c('#view-carteira');
    if (!raiz || raiz.classList.contains('is-hidden')) return;
    if (!universo().length) return;
    // Não redesenha no ciclo automático enquanto o usuário edita um campo da carteira.
    if (!forcar && raiz.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    const c = consolidar();
    $c('#cart-kpis').innerHTML = htmlKpis(c);
    $c('#cart-posicoes').innerHTML = htmlPosicoes(c);
    $c('#cart-setores').innerHTML = htmlSetores(c);
    $c('#cart-renda').innerHTML = htmlRendaMensal(c);
    $c('#cart-aporte').innerHTML = htmlAporte(c);
    const corpoMeta = $c('#cart-meta-corpo');
    if (corpoMeta) corpoMeta.innerHTML = htmlMetaRenda();
    const mr = $c('#meta-renda'); if (mr && document.activeElement !== mr) mr.value = estado.meta.rendaMensal;
    const ma = $c('#meta-anos'); if (ma) ma.value = String(estado.meta.anos);
    const dl = $c('#cart-tickers');
    if (dl && !dl.childElementCount) {
      dl.innerHTML = universo().map(a => `<option value="${esc(a.ticker)}">${esc(a.empresa || a.setor)}</option>`).join('');
    }
    const cfg = estado.config;
    const sel = $c('#cart-base-renda'); if (sel) sel.value = cfg.baseRenda;
    const jcp = $c('#cart-jcp-liq'); if (jcp) jcp.checked = !!cfg.jcpLiquido;
    const mm = $c('#cart-margem-min'); if (mm) mm.value = Math.round((cfg.margemMinAporte || 0) * 100);
    const ap = $c('#cart-aporte-valor'); if (ap && document.activeElement !== ap) ap.value = cfg.aporte;
    const al = $c('#cart-alertas'); if (al) al.checked = !!cfg.alertas;
  }

  /* ---------- Ações ---------- */

  function adicionarPosicao(ticker, qtd, pm) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    if (!mapaUniv().has(t)) {
      mostrarToast(`${t} não está na base de dados do painel.`);
      return;
    }
    const existente = estado.posicoes.find(p => p.ticker === t);
    if (existente) {
      // Somar quantidades recalcula o preço médio ponderado.
      const q0 = Number(existente.qtd) || 0;
      const p0 = Number(existente.pm) || 0;
      const qt = q0 + qtd;
      existente.pm = qt > 0 ? Math.round(((q0 * p0 + qtd * pm) / qt) * 100) / 100 : pm;
      existente.qtd = qt;
    } else {
      estado.posicoes.push({ ticker: t, qtd, pm });
    }
    gravarEstado();
    renderizarCarteira(true);
  }

  function adicionarMeta(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    if (!mapaUniv().has(t)) { mostrarToast(`${t} não está na base de dados do painel.`); return; }
    if (estado.meta.tickers.includes(t)) return;
    if (estado.meta.tickers.length >= MAX_META) { mostrarToast(`Compare até ${MAX_META} papéis por vez; remova um antes.`); return; }
    estado.meta.tickers.push(t);
    gravarEstado();
    renderizarCarteira(true);
  }

  // Atalho público: abre a aba Carteira com o papel e seus pares de setor na meta de renda.
  function simularMetaRenda(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!mapaUniv().has(t)) return;
    estado.meta.tickers = [t, ...sugerirPares(t)].slice(0, MAX_META);
    gravarEstado();
    if (typeof window.definirAbaPainel === 'function') window.definirAbaPainel('carteira');
    renderizarCarteira(true);
    requestAnimationFrame(() => $c('#cart-meta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  window.simularMetaRenda = simularMetaRenda;

  function exportar() {
    const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carteira-bazin-${hojeIsoSaoPaulo()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function importar(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const dados = JSON.parse(String(leitor.result));
        if (!dados || !Array.isArray(dados.posicoes)) throw new Error('formato');
        estado = {
          posicoes: dados.posicoes.filter(p => p && p.ticker).map(p => ({ ticker: String(p.ticker).toUpperCase(), qtd: Number(p.qtd) || 0, pm: Number(p.pm) || 0 })),
          alvos: { ...PADRAO.alvos, ...(dados.alvos || {}) },
          config: migrarConfig({ ...PADRAO.config, ...(dados.config || {}) }),
          meta: { ...PADRAO.meta, ...(dados.meta || {}) }
        };
        gravarEstado();
        renderizarCarteira(true);
        mostrarToast(`Carteira importada: ${estado.posicoes.length} posições.`);
      } catch (_) {
        mostrarToast('Arquivo inválido: use um JSON exportado por este painel.');
      }
    };
    leitor.readAsText(arquivo);
  }

  function ligarEventos() {
    $c('#cart-add-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = $c('#cart-add-ticker').value;
      const q = Number($c('#cart-add-qtd').value) || 0;
      const pm = Number($c('#cart-add-pm').value) || 0;
      if (q <= 0) { mostrarToast('Informe a quantidade.'); return; }
      adicionarPosicao(t, q, pm > 0 ? pm : (mapaUniv().get(String(t).trim().toUpperCase())?.preco || 0));
      e.target.reset();
      $c('#cart-add-ticker').focus();
    });

    const raiz = $c('#view-carteira');
    raiz?.addEventListener('change', (e) => {
      const ed = e.target.closest('[data-cart-edit]');
      if (ed) {
        const pos = estado.posicoes.find(p => p.ticker === ed.dataset.ticker);
        if (pos) {
          pos[ed.dataset.cartEdit] = Math.max(0, Number(ed.value) || 0);
          gravarEstado();
          renderizarCarteira(true);
        }
        return;
      }
      const alvo = e.target.closest('[data-cart-alvo]');
      if (alvo) {
        estado.alvos[alvo.dataset.cartAlvo] = Math.max(0, Math.min(100, Number(alvo.value) || 0));
        gravarEstado();
        renderizarCarteira(true);
        return;
      }
      const cfg = estado.config;
      if (e.target.id === 'cart-base-renda') cfg.baseRenda = e.target.value;
      else if (e.target.id === 'cart-jcp-liq') cfg.jcpLiquido = e.target.checked;
      else if (e.target.id === 'cart-margem-min') cfg.margemMinAporte = Math.max(0, Number(e.target.value) || 0) / 100;
      else if (e.target.id === 'cart-aporte-valor') cfg.aporte = Math.max(0, Number(e.target.value) || 0);
      else if (e.target.id === 'meta-renda') estado.meta.rendaMensal = Math.max(0, Number(e.target.value) || 0);
      else if (e.target.id === 'meta-anos') estado.meta.anos = Math.max(1, Math.min(30, Number(e.target.value) || 10));
      else if (e.target.id === 'cart-alertas') {
        cfg.alertas = e.target.checked;
        if (cfg.alertas && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      } else if (e.target.id === 'cart-import-file' && e.target.files?.[0]) {
        importar(e.target.files[0]);
        e.target.value = '';
        return;
      } else return;
      gravarEstado();
      renderizarCarteira(true);
    });

    $c('#meta-add')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); adicionarMeta(e.target.value); e.target.value = ''; }
    });

    raiz?.addEventListener('click', (e) => {
      if (e.target.closest('#meta-add-btn')) {
        const inp = $c('#meta-add');
        adicionarMeta(inp?.value);
        if (inp) { inp.value = ''; inp.focus(); }
        return;
      }
      if (e.target.closest('#meta-pares')) {
        const primeiro = estado.meta.tickers[0] || ($c('#meta-add')?.value || '').trim().toUpperCase();
        if (!primeiro) { mostrarToast('Escolha primeiro um papel para buscar pares do mesmo setor.'); return; }
        if (!estado.meta.tickers.includes(primeiro)) adicionarMeta(primeiro);
        const pares = sugerirPares(primeiro).filter(t => !estado.meta.tickers.includes(t));
        estado.meta.tickers = [...estado.meta.tickers, ...pares].slice(0, MAX_META);
        gravarEstado();
        renderizarCarteira(true);
        if (!pares.length) mostrarToast(`Nenhum outro papel com DPA no setor de ${primeiro}.`);
        return;
      }
      const rmMeta = e.target.closest('[data-meta-remove]');
      if (rmMeta) {
        estado.meta.tickers = estado.meta.tickers.filter(t => t !== rmMeta.dataset.metaRemove);
        gravarEstado();
        renderizarCarteira(true);
        return;
      }
      const rm = e.target.closest('[data-cart-remove]');
      if (rm) {
        e.stopPropagation();
        const t = rm.dataset.cartRemove;
        const antes = estado.posicoes.slice();
        estado.posicoes = estado.posicoes.filter(p => p.ticker !== t);
        gravarEstado();
        renderizarCarteira(true);
        mostrarToast(`${t} removido da carteira.`, 'Desfazer', () => { estado.posicoes = antes; gravarEstado(); renderizarCarteira(true); });
        return;
      }
      if (e.target.closest('input, button, label, select')) return;
      const det = e.target.closest('[data-cart-detail]');
      if (det && typeof window.abrirDetalhe === 'function') window.abrirDetalhe(det.dataset.cartDetail);
    });
    $c('#cart-export')?.addEventListener('click', exportar);
  }

  /* ---------- Alertas: cruzamento do teto e data-com próxima ---------- */

  function tickersMonitorados() {
    const set = new Set(estado.posicoes.map(p => p.ticker));
    (typeof window.obterTickersPainelAtivo === 'function' ? window.obterTickersPainelAtivo() : []).forEach(t => set.add(String(t).toUpperCase()));
    return set;
  }

  function notificar(titulo, corpo) {
    mostrarToast(`${titulo} · ${corpo}`);
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(titulo, { body: corpo, icon: './favicon.png', tag: titulo });
      }
    } catch (_) { /* navegador sem suporte */ }
  }

  let ultimoGerado = null;

  function verificarAlertas() {
    const payload = window.VALUATION_DATA;
    if (!estado.config.alertas || !payload?.gerado_em || payload.gerado_em === ultimoGerado) return;
    ultimoGerado = payload.gerado_em;
    let mem;
    try { mem = JSON.parse(localStorage.getItem(CHAVE_ALERTAS) || '{}'); } catch (_) { mem = {}; }
    mem.vereditos = mem.vereditos || {};
    mem.datacom = mem.datacom || {};
    const hoje = hojeIsoSaoPaulo();
    const mapa = mapaUniv();
    const naCarteira = new Set(estado.posicoes.map(p => p.ticker));

    tickersMonitorados().forEach(t => {
      const a = mapa.get(t);
      if (!a || !(a.bazin?.teto > 0)) return;
      const v = a.bazin.veredito;
      const anterior = mem.vereditos[t];
      if (anterior && anterior !== v) {
        if (v === 'verde') notificar(`${t} entrou abaixo do teto`, `${fmtReal(a.preco)} vs. teto ${fmtReal(a.bazin.teto)} (margem ${fmtPct(a.bazin.margem_seguranca)})`);
        else if (anterior === 'verde') notificar(`${t} saiu da zona de compra`, `${fmtReal(a.preco)} vs. teto ${fmtReal(a.bazin.teto)}`);
      }
      mem.vereditos[t] = v;

      const dc = a.proxima_data_com?.data_com;
      if (dc) {
        const dias = Math.round((new Date(String(dc).slice(0, 10) + 'T12:00:00Z') - new Date(hoje + 'T12:00:00Z')) / 86400000);
        const chave = `${t}:${dc}`;
        const relevante = naCarteira.has(t) || (a.bazin.margem_seguranca ?? -1) >= 0;
        if (dias >= 0 && dias <= 2 && relevante && mem.datacom[chave] !== hoje) {
          notificar(`Data-com de ${t} ${dias === 0 ? 'hoje' : (dias === 1 ? 'amanhã' : `em ${dias} dias`)}`, `${fmtReal(a.proxima_data_com.valor)} por ação · pagamento ${a.proxima_data_com.data_pagamento ? String(a.proxima_data_com.data_pagamento).split('-').reverse().join('/') : 'a definir'}`);
          mem.datacom[chave] = hoje;
        }
      }
    });
    try { localStorage.setItem(CHAVE_ALERTAS, JSON.stringify(mem)); } catch (_) { /* modo privado */ }
  }

  /* ---------- Inicialização ---------- */

  window.renderizarCarteira = renderizarCarteira;
  window.addEventListener('DOMContentLoaded', () => {
    ligarEventos();
    setInterval(() => {
      verificarAlertas();
      renderizarCarteira();
    }, 30000);
    // Primeira checagem assim que o payload chegar.
    const espera = setInterval(() => {
      if (window.VALUATION_DATA?.gerado_em) {
        clearInterval(espera);
        verificarAlertas();
        renderizarCarteira();
      }
    }, 500);
  });
})();
