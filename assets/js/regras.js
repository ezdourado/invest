/* Regras de leitura do método Bazin no painel: faixas de cor, setores BESST, filtros de
 * qualidade, triagens prontas e análise técnica. Funções puras sobre o payload do motor
 * (os cálculos de valuation em si ficam no motor Python, engine/valuation.py). */

const ORDEM_VEREDITO = { verde: 0, amarelo: 1, vermelho: 2 };

const ROTULO_VEREDITO = {
  verde: 'Abaixo do teto',
  amarelo: 'Próximo do teto',
  vermelho: 'Acima do teto',
  bullish: 'Tendência Bullish',
  bearish: 'Tendência Bearish'
};

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

// Padrão = faixas do pilar de alavancagem do motor (Dív. Líq./EBITDA): até 3,2x ok, até 4,2x alerta.
function classeAlavancagem(v, limiteBom = 3.2, limiteAlerta = 4.2) {
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

function razaoDpaPreco(a) {
  const dpa = a.bazin?.dpa_sem_extra;
  return valido(dpa) && a.preco > 0 ? dpa / a.preco : null;
}

function diferencaAteTeto(a) {
  const teto = a?.bazin?.teto;
  if (!valido(teto) || teto <= 0 || !valido(a?.preco)) return null;
  return teto - a.preco;
}

/* Ficha de realidade do dividendo: o teto de 5 anos ainda se sustenta com o que a empresa paga hoje? */
function anosAtipicosAtivo(b) {
  return Object.keys(b?.anos_atipicos || {}).map(Number).sort((x, y) => x - y);
}

function margemAtivo(a) {
  return a.bazin?.teto > 0 && valido(a.bazin?.margem_seguranca) ? a.bazin.margem_seguranca : null;
}

function dividendoSemQueda(a) {
  const r = a.bazin?.razao_12m_5a;
  return !valido(r) || r >= 0.7;
}

// Abaixo do teto + score Forte/Moderado + dividendo recente sem queda.
function passaFiltroQualidade(a) {
  const nivel = a.sustentabilidade?.nivel;
  return a.bazin?.veredito === 'verde' && (nivel === 'forte' || nivel === 'moderado') && dividendoSemQueda(a);
}

function diasAteDataCom(a) {
  const dc = a.proxima_data_com?.data_com;
  if (!dc) return null;
  const hoje = new Date(hojeIsoSaoPaulo() + 'T12:00:00Z');
  const alvo = new Date(String(dc).slice(0, 10) + 'T12:00:00Z');
  return Math.round((alvo - hoje) / 86400000);
}

function mudouDesdePregao(a) {
  const ant = a?.anterior;
  const b = a?.bazin || {};
  if (!ant || !(b.teto > 0)) return false;
  return ant.veredito !== b.veredito || (ant.teto > 0 && Math.abs(b.teto - ant.teto) / ant.teto > 0.005);
}

function mudancasDesdePregao(lista) {
  const entraram = [];
  const sairam = [];
  const tetoMudou = [];
  let dataRef = null;
  lista.forEach(a => {
    const ant = a.anterior;
    const b = a.bazin || {};
    if (!ant || !(b.teto > 0)) return;
    dataRef = dataRef || ant.data;
    if (ant.veredito !== 'verde' && b.veredito === 'verde') entraram.push(a.ticker);
    else if (ant.veredito === 'verde' && b.veredito !== 'verde') sairam.push(a.ticker);
    if (ant.teto > 0 && Math.abs(b.teto - ant.teto) / ant.teto > 0.005) tetoMudou.push(a.ticker);
  });
  return { entraram, sairam, tetoMudou, dataRef };
}

const TRIAGENS = {
  todas: { rotulo: 'Todas', filtro: () => true },
  classico: {
    rotulo: 'Bazin clássico',
    tip: 'Abaixo do teto, pagou nos 5 anos fechados, Score Anti-Cilada ≥ 75 e dividendo dos últimos 12 meses ≥ 70% da média.',
    filtro: a => a.bazin?.veredito === 'verde' && (a.sustentabilidade?.anos_pagos_5a ?? 0) >= 5 && (a.sustentabilidade?.nota ?? 0) >= 75 && dividendoSemQueda(a)
  },
  qualificada: {
    rotulo: 'Oportunidades qualificadas',
    tip: 'Abaixo do teto, Score Anti-Cilada Forte ou Moderado e dividendo recente sem queda.',
    filtro: passaFiltroQualidade
  },
  armadilha: {
    rotulo: 'Possíveis armadilhas',
    tip: 'Margem ≥ 15% (parece barato), mas o dividendo dos últimos 12 meses caiu abaixo de 70% da média ou o Score Anti-Cilada está em Risco.',
    filtro: a => (margemAtivo(a) ?? -9) >= 0.15 && (!dividendoSemQueda(a) || a.sustentabilidade?.nivel === 'alerta')
  },
  perto: {
    rotulo: 'Perto do teto (±5%)',
    tip: 'Margem entre −5% e +5%: candidatos a entrar ou sair da zona de compra.',
    filtro: a => { const m = margemAtivo(a); return m !== null && m >= -0.05 && m <= 0.05; }
  },
  datacom: {
    rotulo: 'Data-com em até 15 dias',
    tip: 'Data-com anunciada nos próximos 15 dias e preço abaixo do teto.',
    filtro: a => { const d = diasAteDataCom(a); return d !== null && d >= 0 && d <= 15 && (margemAtivo(a) ?? -9) >= 0; }
  },
  mudou: {
    rotulo: 'Mudou desde o último pregão',
    tip: 'Papéis que mudaram de faixa (veredito) ou tiveram o teto recalculado desde o fechamento anterior.',
    filtro: mudouDesdePregao
  }
};

function calcularAnaliseTecnica(a) {
  if (!a) return null;
  const precos = (a.historico_precos || []).filter(v => typeof v === 'number' && v > 0);
  if (!precos.length && a.preco > 0) precos.push(a.preco);
  if (!precos.length) return null;

  const n = precos.length;
  const precoAtual = a.preco || precos[n - 1];

  const mma = (periodo) => {
    if (n < Math.min(periodo, 4)) return null;
    const slice = precos.slice(-periodo);
    const soma = slice.reduce((acc, v) => acc + v, 0);
    return Math.round((soma / slice.length) * 100) / 100;
  };

  const mma9 = mma(9);
  const mma21 = mma(21);
  const mma50 = mma(50);
  const mma200 = n >= 50 ? mma(200) : null;

  // IFR 14 semanas
  let ifr14 = null;
  if (n >= 15) {
    const periodos = 14;
    const slice = precos.slice(-periodos - 1);
    let ganhos = 0;
    let perdas = 0;
    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i] - slice[i - 1];
      if (diff > 0) ganhos += diff;
      else perdas += Math.abs(diff);
    }
    const mediaGanhos = ganhos / periodos;
    const mediaPerdas = perdas / periodos;
    if (mediaPerdas === 0) ifr14 = 100;
    else {
      const rs = mediaGanhos / mediaPerdas;
      ifr14 = Math.round((100 - (100 / (1 + rs))) * 10) / 10;
    }
  }

  // Score de Tendência (0 a 100)
  let score = 0;
  let maxScore = 0;

  // 1. Preço vs MMA 21 (+25 pts)
  maxScore += 25;
  if (mma21 !== null && precoAtual >= mma21) score += 25;

  // 2. Preço vs MMA 50 (+25 pts)
  maxScore += 25;
  if (mma50 !== null && precoAtual >= mma50) score += 25;

  // 3. MMA 21 vs MMA 50 (+20 pts)
  if (mma21 !== null && mma50 !== null) {
    maxScore += 20;
    if (mma21 >= mma50) score += 20;
  }

  // 4. Preço vs MMA 200 (+15 pts)
  if (mma200 !== null) {
    maxScore += 15;
    if (precoAtual >= mma200) score += 15;
  }

  // 5. IFR Momentum (+15 pts)
  if (ifr14 !== null) {
    maxScore += 15;
    if (ifr14 >= 50 && ifr14 <= 70) score += 15;
    else if (ifr14 >= 40 && ifr14 < 50) score += 10;
    else if (ifr14 > 70) score += 8;
    else if (ifr14 >= 30 && ifr14 < 40) score += 5;
  }

  const scoreNormalizado = maxScore > 0 ? Math.round((score / maxScore) * 100) : 50;

  let status = 'neutro';
  let rotulo = 'Tendência Neutra';
  if (scoreNormalizado >= 65) {
    status = 'bullish';
    rotulo = 'Bullish (Tendência de Alta)';
  } else if (scoreNormalizado <= 35) {
    status = 'bearish';
    rotulo = 'Bearish (Tendência de Baixa)';
  }

  const sinais = [];
  if (mma21 && mma50 && mma21 > mma50) sinais.push('MMA 21 acima da MMA 50 (Alinhamento altista)');
  else if (mma21 && mma50 && mma21 < mma50) sinais.push('MMA 21 abaixo da MMA 50 (Pressão vendedora)');

  if (ifr14 !== null) {
    if (ifr14 < 30) sinais.push(`IFR Sobrevendido (${ifr14}) · Potencial repique`);
    else if (ifr14 > 70) sinais.push(`IFR Sobrecomprado (${ifr14}) · Cautela no curto prazo`);
  }

  if (mma200 && precoAtual > mma200) sinais.push('Acima da MMA 200 (Tendência primária de alta)');
  else if (mma200 && precoAtual < mma200) sinais.push('Abaixo da MMA 200 (Tendência primária de baixa)');

  return {
    precoAtual,
    mma9,
    mma21,
    mma50,
    mma200,
    ifr14,
    score: scoreNormalizado,
    status,
    rotulo,
    sinais
  };
}
