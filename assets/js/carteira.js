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
    config: { baseRenda: 'menor', jcpLiquido: true, margemMinAporte: 0.10, aporte: 1000, alertas: true }
  };

  const $c = sel => document.querySelector(sel);

  /* ---------- Estado ---------- */

  function lerEstado() {
    try {
      const bruto = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (!bruto || typeof bruto !== 'object') return structuredClone(PADRAO);
      return {
        posicoes: Array.isArray(bruto.posicoes) ? bruto.posicoes.filter(p => p && p.ticker) : [],
        alvos: { ...PADRAO.alvos, ...(bruto.alvos || {}) },
        config: { ...PADRAO.config, ...(bruto.config || {}) }
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

  // DPA usado na projeção: média 5a, últimos 12m ou o menor dos dois (conservador, padrão).
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
    const base = { menor: 'menor entre DPA 5a e 12m', '5a': 'DPA médio 5a', '12m': 'DPA 12 meses' }[estado.config.baseRenda];
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
        <p class="d-note">Alvos somam ${somaAlvos}%${somaAlvos !== 100 ? ' <span class="t-yellow">(ajuste para 100%)</span>' : ''}. Padrão: 20% em cada setor BESST, como na carteira previdenciária de Barsi. O alvo orienta o "Aporte do mês".</p>
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
    return universo()
      .filter(a => passaFiltroQualidade(a) && (a.bazin?.margem_seguranca ?? -1) >= margemMin)
      .map(a => {
        const s = setorDe(a);
        const alvo = (Number(estado.alvos[s]) || 0) / 100;
        const atual = c.pesoSetor[s] || 0;
        const gap = alvo - atual;
        let fatorSetor = 1 + Math.max(0, gap) * 2;
        if (c.validas.length && alvo === 0) fatorSetor = 0.5;
        else if (gap < -0.05) fatorSetor = 0.6;
        const nota = (a.sustentabilidade?.nota ?? 50) / 100;
        const pontos = a.bazin.margem_seguranca * nota * fatorSetor;
        return { a, setor: s, alvo, atual, pontos, fatorSetor, temPosicao: posse.has(a.ticker) };
      })
      .sort((x, y) => y.pontos - x.pontos)
      .slice(0, 10);
  }

  function htmlAporte(c) {
    const cands = candidatosAporte(c);
    const valor = Number(estado.config.aporte) || 0;
    if (!cands.length) {
      return `<p class="d-note">Nenhum papel da base passa no filtro (abaixo do teto com margem ≥ ${fmtPctSimples(estado.config.margemMinAporte, 0)}, score Forte/Moderado e dividendo recente sem queda). Reduza a margem mínima ou aguarde.</p>`;
    }
    const top = cands.slice(0, 3);
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
            <th class="num" data-tip="Renda anual por R$ investido hoje (DPA base ÷ preço)">DY na compra</th>
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
                  <td class="num mono">${fmtPctSimples(dpaBase(x.a) / x.a.preco, 2)}</td>
                  <td class="num mono">${q !== undefined ? (q > 0 ? `<strong>${q}</strong> ações · ${fmtReal(q * x.a.preco)}` : '<span class="t-dim">valor insuficiente</span>') : '<span class="t-dim">—</span>'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="d-note">Sugestão divide o aporte entre os 3 primeiros, proporcional à pontuação (margem Bazin × score anti-cilada × prioridade do setor abaixo do alvo). Sobra: ${fmtReal(Math.max(0, sobra))}. É um apoio quantitativo para a sua decisão, não uma recomendação de investimento.</p>`;
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
          config: { ...PADRAO.config, ...(dados.config || {}) }
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

    raiz?.addEventListener('click', (e) => {
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
