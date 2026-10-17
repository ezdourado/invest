/* Lógica pura de cálculos de Valuation (sem acesso ao DOM) */

function fmtReal(val) {
  if (isNaN(val) || !isFinite(val) || val <= 0) return 'R$ 0,00';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(val) {
  if (isNaN(val) || !isFinite(val)) return '0,0%';
  const prefix = val > 0 ? '+' : '';
  return prefix + val.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function computeRulerPositions(price, tetoBazin, viGraham = 0) {
  const validVals = [price, tetoBazin, viGraham].filter(v => v > 0);
  if (validVals.length === 0) {
    return { valid: false, pctPrice: 50, pctTeto: 50, pctGraham: 50 };
  }
  const maxVal = Math.max(...validVals) * 1.15;
  const clamp = (v) => Math.min(95, Math.max(5, (v / maxVal) * 100));

  return {
    valid: true,
    pctPrice: price > 0 ? clamp(price) : null,
    pctTeto: tetoBazin > 0 ? clamp(tetoBazin) : null,
    pctGraham: viGraham > 0 ? clamp(viGraham) : null
  };
}

function computeYieldLadder(price, dpa) {
  if (!dpa || dpa <= 0) return [];

  const yieldTargets = [
    { rate: 6.0, label: '6,0% (Bazin Clássico)', isBazin: true },
    { rate: 7.0, label: '7,0% (Conservador)', isBazin: false },
    { rate: 8.0, label: '8,0% (Exigente)', isBazin: false },
    { rate: 9.0, label: '9,0% (Cíclicas / Risco)', isBazin: false },
    { rate: 10.0, label: '10,0% (Margem Extrema)', isBazin: false }
  ];

  return yieldTargets.map(y => {
    const teto = dpa / (y.rate / 100);
    const margem = price > 0 ? (((teto - price) / teto) * 100) : 0;

    let badgeType = 'neutral';
    let badgeText = '-';
    if (price > 0) {
      if (price <= teto) {
        badgeType = 'green';
        badgeText = '🟢 Desconto';
      } else if (price <= teto * 1.05) {
        badgeType = 'yellow';
        badgeText = '🟡 Limite';
      } else {
        badgeType = 'red';
        badgeText = '🔴 Ágio';
      }
    }

    return {
      label: y.label,
      isBazin: y.isBazin,
      teto,
      margem,
      badgeType,
      badgeText
    };
  });
}

function evaluateBazinClassic({ dpaMode, directDpa, yearsDpa, price, hasDyMedio, dyMedioInput, isBank, debtEbitda }) {
  let dpa = 0;
  let hasDpa = false;
  let avgYearsDpa = 0;

  if (dpaMode === 'direct') {
    hasDpa = !isNaN(directDpa) && directDpa > 0;
    if (hasDpa) dpa = directDpa;
  } else {
    const validYears = (yearsDpa || []).filter(v => !isNaN(v) && v >= 0);
    hasDpa = validYears.length > 0 && validYears.some(v => v > 0);
    if (hasDpa) {
      dpa = validYears.reduce((a, b) => a + b, 0) / validYears.length;
      avgYearsDpa = dpa;
    }
  }

  if ((!hasDpa && !hasDyMedio) || price <= 0) {
    return { valid: false, avgYearsDpa };
  }

  let dyMedio = 0;
  if (hasDpa && hasDyMedio) {
    dyMedio = dyMedioInput;
  } else if (hasDpa && !hasDyMedio) {
    dyMedio = price > 0 ? (dpa / price) * 100 : 0;
  } else if (!hasDpa && hasDyMedio) {
    dyMedio = dyMedioInput;
    dpa = price * (dyMedio / 100);
  }

  const kDecimal = 0.06;
  const precoTeto = dpa / kDecimal;
  const margemSeguranca = precoTeto > 0 ? (((precoTeto - price) / precoTeto) * 100) : -100;

  const levOk = isBank || debtEbitda <= 2.5;
  const levCritica = !isBank && debtEbitda > 3.5;
  const precoSobTeto = price <= precoTeto;
  const dyHistOk = !hasDyMedio || dyMedio >= 6.0;

  let status = 'neutro';
  let statusTitle = 'NEUTRALIDADE · AGUARDAR AJUSTE';

  if (dpa <= 0) {
    status = 'reprovado';
    statusTitle = 'REPROVADO · SEM PROVENTOS';
  } else if (levCritica) {
    status = 'reprovado';
    statusTitle = 'REPROVADO · ENDIVIDAMENTO CRÍTICO';
  } else if (precoSobTeto && levOk && dyHistOk) {
    status = 'compra';
    statusTitle = 'COMPRA · MARGEM & SAÚDE OK';
  } else if (price > precoTeto * 1.1) {
    status = 'reprovado';
    statusTitle = 'REPROVADO · PREÇO MUITO ELEVADO';
  }

  return {
    valid: true,
    dpa,
    avgYearsDpa,
    price,
    precoTeto,
    margemSeguranca,
    status,
    statusTitle
  };
}

function evaluateGrahamBazin({ vpa, lpa, payout, price }) {
  const dpaImplicit = (lpa > 0 && payout >= 0) ? (lpa * (payout / 100)) : 0;

  if (price <= 0 || lpa <= 0 || vpa <= 0) {
    return { valid: false, dpaImplicit };
  }

  const product = 22.5 * lpa * vpa;
  const vi = product > 0 ? Math.sqrt(product) : 0;
  const margemGraham = vi > 0 ? (((vi - price) / vi) * 100) : -100;
  const convGraham = price > 0 ? (((vi - price) / price) * 100) : 0;

  const precoTetoBazin = dpaImplicit / 0.06;
  const margemBazin = precoTetoBazin > 0 ? (((precoTetoBazin - price) / precoTetoBazin) * 100) : -100;

  let status = 'neutro';
  let statusTitle = 'NEUTRALIDADE · MARGEM MODERADA';

  if (lpa <= 0) {
    status = 'reprovado';
    statusTitle = 'REPROVADO · OPERAÇÃO PREJUÍZO';
  } else if (margemGraham >= 30.0 && price <= precoTetoBazin) {
    status = 'compra';
    statusTitle = 'COMPRA · EXCELENTE MARGEM & PROVENTO';
  } else if (margemGraham < 0 || price > precoTetoBazin) {
    status = 'reprovado';
    statusTitle = 'REPROVADO · FUNDAMENTOS ESTICADOS';
  }

  return {
    valid: true,
    dpaImplicit,
    price,
    vi,
    margemGraham,
    convGraham,
    precoTetoBazin,
    margemBazin,
    status,
    statusTitle
  };
}

function buildSummaryText({ ticker, price, dpa, tetoBazin, margemBazin, status, statusTitle, viGraham = 0, margemGraham = 0, fallbackVpa = 0, fallbackLpa = 0 }) {
  if (viGraham === 0) {
    const product = 22.5 * fallbackLpa * fallbackVpa;
    if (product > 0) {
      viGraham = Math.sqrt(product);
      margemGraham = viGraham > 0 ? (((viGraham - price) / viGraham) * 100) : -100;
    }
  }

  let emoji = '🟡';
  if (status === 'compra') emoji = '🟢';
  if (status === 'reprovado') emoji = '🔴';

  const viStr = viGraham > 0 ? fmtReal(viGraham) : 'N/A';
  const margemGrahamStr = viGraham > 0 ? fmtPct(margemGraham) : 'N/A';
  const paperName = ticker && ticker.trim() !== '' ? ticker.trim().toUpperCase() : 'ATIVO';

  let text = `📌 *RESUMO DE ANÁLISE - ${paperName}*\n`;
  text += `• *Cotação:* ${fmtReal(price)}\n`;
  text += `• *DPA:* ${fmtReal(dpa)}\n`;
  text += `• *PT Bazin (6%):* ${fmtReal(tetoBazin)} | *Margem:* ${fmtPct(margemBazin)}\n`;
  text += `• *VI Graham:* ${viStr} | *Margem:* ${margemGrahamStr}\n`;
  text += `• *Diagnóstico:* ${emoji} ${statusTitle}`;

  return text;
}

function calculateTerminalItemMetrics(item, globalK) {
  const price = parseFloat(item.price) || 0;
  const lpa = parseFloat(item.lpa) || 0;
  const vpa = parseFloat(item.vpa) || 0;
  const evEbit = parseFloat(item.evEbit) || 0;
  const roic = parseFloat(item.roic) || 0;
  const roe = parseFloat(item.roe) || 0;
  const payout = parseFloat(item.payout) || 0;

  const dpa = (lpa > 0 && payout > 0) ? (lpa * (payout / 100)) : (parseFloat(item.dpa) || 0);

  const ptBazin = dpa > 0 ? (dpa / 0.06) : 0;
  const marginBazin = (ptBazin > 0 && price > 0) ? (((ptBazin - price) / ptBazin) * 100) : -100;

  const productGraham = 22.5 * lpa * vpa;
  const viGraham = (productGraham > 0 && lpa > 0 && vpa > 0) ? Math.sqrt(productGraham) : 0;
  const marginGraham = (viGraham > 0 && price > 0) ? (((viGraham - price) / viGraham) * 100) : -100;

  let gCalcRaw = 0;
  if (payout >= 100) {
    gCalcRaw = 0.0;
  } else {
    gCalcRaw = roe * (1 - (payout / 100));
    if (gCalcRaw < 0) gCalcRaw = 0.0;
  }

  const maxGAllowed = Math.min(4.5, globalK - 0.5);
  const gCalculated = Math.max(0, Math.min(gCalcRaw, maxGAllowed));

  let priceGordon = 0;
  let marginGordon = -100;
  let gordonValid = true;

  if (globalK <= gCalculated || dpa <= 0) {
    gordonValid = false;
  } else {
    priceGordon = (dpa * (1 + (gCalculated / 100))) / ((globalK / 100) - (gCalculated / 100));
    marginGordon = (priceGordon > 0 && price > 0) ? (((priceGordon - price) / priceGordon) * 100) : -100;
  }

  return {
    ptBazin, marginBazin,
    viGraham, marginGraham,
    gCalculated, priceGordon, marginGordon, gordonValid,
    evEbit, roic
  };
}

function rankTerminalList(list, globalK) {
  if (!list || list.length === 0) return [];

  const processed = list.map(item => ({
    ...item,
    calc: calculateTerminalItemMetrics(item, globalK)
  }));

  const nonFinancials = processed.filter(x => !x.isFinancial);
  const financials = processed.filter(x => !!x.isFinancial);

  if (nonFinancials.length > 0) {
    const sortedByEvEbit = [...nonFinancials].sort((a, b) => {
      const aVal = a.calc.evEbit;
      const bVal = b.calc.evEbit;
      if (aVal <= 0 && bVal <= 0) return 0;
      if (aVal <= 0) return 1;
      if (bVal <= 0) return -1;
      return aVal - bVal;
    });

    sortedByEvEbit.forEach((item, index) => {
      item.evEbitRank = index + 1;
    });

    const sortedByRoic = [...nonFinancials].sort((a, b) => b.calc.roic - a.calc.roic);
    sortedByRoic.forEach((item, index) => {
      item.roicRank = index + 1;
    });

    nonFinancials.forEach(item => {
      item.magicScore = item.evEbitRank + item.roicRank;
    });

    nonFinancials.sort((a, b) => a.magicScore - b.magicScore);
    nonFinancials.forEach((item, index) => {
      item.magicRank = index + 1;
    });
  }

  financials.forEach(item => {
    item.magicRank = null;
    item.magicScore = null;
  });

  return [...nonFinancials, ...financials];
}

function buildTerminalTextSummary(list, globalK) {
  const rankedList = rankTerminalList(list, globalK);

  if (rankedList.length === 0) {
    return 'Nenhum ativo cadastrado no Terminal.';
  }

  let text = `🏆 *RANKING MAGIC FORMULA & VALUATION (K = ${globalK.toFixed(1)}%a.a.)*\n\n`;

  const nonFinancials = rankedList.filter(x => !x.isFinancial);
  const financials = rankedList.filter(x => !!x.isFinancial);

  if (nonFinancials.length > 0) {
    text += `--- *EMPRESAS OPERACIONAIS (MAGIC FORMULA)* ---\n`;
    nonFinancials.forEach(item => {
      const c = item.calc;
      let medal = '•';
      if (item.magicRank === 1) medal = '🥇';
      else if (item.magicRank === 2) medal = '🥈';
      else if (item.magicRank === 3) medal = '🥉';

      const viGrahamStr = c.viGraham > 0 ? fmtReal(c.viGraham) : 'N/A';
      const marginGrahamStr = c.viGraham > 0 ? fmtPct(c.marginGraham) : 'N/A';
      const gordonStr = (c.gordonValid && c.priceGordon > 0) ? `${fmtReal(c.priceGordon)} (${fmtPct(c.marginGordon)})` : 'N/A';

      text += `${medal} *#${item.magicRank} ${item.ticker}* (${fmtReal(item.price)})\n`;
      text += `  • Bazin PT (6%): ${fmtReal(c.ptBazin)} | Margem: ${fmtPct(c.marginBazin)}\n`;
      text += `  • Graham VI: ${viGrahamStr} | Margem: ${marginGrahamStr}\n`;
      text += `  • Gordon: ${gordonStr}\n`;
      text += `  • EV/EBIT: ${c.evEbit > 0 ? c.evEbit.toFixed(1) + 'x' : 'N/A'} | ROIC: ${c.roic.toFixed(1)}%\n\n`;
    });
  }

  if (financials.length > 0) {
    text += `--- *SETOR FINANCEIRO & HOLDINGS (ISENTOS DA MF)* ---\n`;
    financials.forEach(item => {
      const c = item.calc;
      const viGrahamStr = c.viGraham > 0 ? fmtReal(c.viGraham) : 'N/A';
      const marginGrahamStr = c.viGraham > 0 ? fmtPct(c.marginGraham) : 'N/A';
      const gordonStr = (c.gordonValid && c.priceGordon > 0) ? `${fmtReal(c.priceGordon)} (${fmtPct(c.marginGordon)})` : 'N/A';

      text += `🏦 *${item.ticker}* (${fmtReal(item.price)})\n`;
      text += `  • Bazin PT (6%): ${fmtReal(c.ptBazin)} | Margem: ${fmtPct(c.marginBazin)}\n`;
      text += `  • Graham VI: ${viGrahamStr} | Margem: ${marginGrahamStr}\n`;
      text += `  • Gordon: ${gordonStr}\n`;
      text += `  • ROE: ${item.roe ? item.roe.toFixed(1) + '%' : 'N/A'} | Payout: ${item.payout ? item.payout.toFixed(1) + '%' : 'N/A'}\n\n`;
    });
  }

  return text.trim();
}
