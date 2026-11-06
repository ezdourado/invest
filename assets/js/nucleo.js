/* Núcleo: formatação, datas no fuso da B3, armazenamento local e utilidades.
 * Sem regras de negócio e sem acesso ao DOM. Carregado antes de todos os outros scripts. */

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function valido(v) {
  return v !== null && v !== undefined && typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
}

function fmtReal(v) {
  if (!valido(v)) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRealSinal(v) {
  if (!valido(v)) return '—';
  const sinal = v > 0 ? '+' : (v < 0 ? '−' : '');
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sinal}R$ ${abs}`;
}

function fmtPct(v, casas = 1) {
  if (!valido(v)) return '—';
  const pct = v * 100;
  const sinal = pct > 0 ? '+' : '';
  return sinal + pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

function fmtPctSimples(v, casas = 1) {
  if (!valido(v)) return '—';
  const pct = v * 100;
  return pct.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

function fmtMult(v, sufixo = 'x') {
  if (!valido(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + sufixo;
}

function fmtMoedaCompacta(v) {
  if (!valido(v) || v === 0) return '—';
  const sinal = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  if (abs >= 1e9) return sinal + 'R$ ' + (abs / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' bi';
  if (abs >= 1e6) return sinal + 'R$ ' + (abs / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mi';
  if (abs >= 1e3) return sinal + 'R$ ' + (abs / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' mil';
  return fmtReal(v);
}

function fmtMultiplo(v) {
  if (!valido(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
}

function urlInvestidor10(ticker) {
  const clean = String(ticker || '').trim().toLowerCase();
  return `https://investidor10.com.br/acoes/${encodeURIComponent(clean)}/`;
}

function debounce(fn, espera = 150) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), espera);
  };
}

/* Parser local seguro para 'YYYY-MM-DD' sem deslocamento de fuso UTC */
function parseDataLocalIso(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

function fmtDataIso(iso) {
  const p = parseDataLocalIso(iso);
  if (!p) return iso || '—';
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

function fmtDataCurtaBr(strData) {
  if (!strData || typeof strData !== 'string') return '';
  const mIso = strData.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return `${mIso[3]}/${mIso[2]}`;
  const mBr = strData.trim().match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/);
  if (mBr) return `${mBr[1]}/${mBr[2]}`;
  return strData;
}

function formatarDataHoraSaoPaulo(isoUtc) {
  if (!isoUtc) return { dataCurta: '—', dataCompleta: '—', hora: '—', dateObj: null };
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) {
    return { dataCurta: String(isoUtc), dataCompleta: String(isoUtc), hora: '', dateObj: null };
  }
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(dt);
    const map = {};
    partes.forEach(p => { map[p.type] = p.value; });
    return {
      dataCurta: `${map.day}/${map.month}`,
      dataCompleta: `${map.day}/${map.month}/${map.year}`,
      hora: `${map.hour}:${map.minute}`,
      dateObj: dt
    };
  } catch (_) {
    return {
      dataCurta: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      dataCompleta: dt.toLocaleDateString('pt-BR'),
      hora: dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      dateObj: dt
    };
  }
}

function agoraSaoPaulo() {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
    const map = {};
    partes.forEach(p => { map[p.type] = p.value; });
    const diaUtil = !['Sat', 'Sun'].includes(map.weekday);
    return { diaUtil, minutosDia: (parseInt(map.hour, 10) % 24) * 60 + parseInt(map.minute, 10) };
  } catch (_) {
    const d = new Date(Date.now() - 3 * 3600 * 1000);
    const dow = d.getUTCDay();
    return { diaUtil: dow >= 1 && dow <= 5, minutosDia: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
}

function fmtIdadeBase(min) {
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 && h < 6 ? ` ${min % 60} min` : ''}`;
  return `${Math.floor(h / 24)} dias`;
}

function hojeIsoSaoPaulo() {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    partes.forEach(p => { map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_) {
    return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

function diasAteDataIsoB3(isoAlvo) {
  const pAlvo = parseDataLocalIso(isoAlvo);
  const pHoje = parseDataLocalIso(hojeIsoSaoPaulo());
  if (!pAlvo || !pHoje) return null;
  const tAlvo = Date.UTC(pAlvo.ano, pAlvo.mes - 1, pAlvo.dia);
  const tHoje = Date.UTC(pHoje.ano, pHoje.mes - 1, pHoje.dia);
  return Math.round((tAlvo - tHoje) / 86400000);
}

function mediana(lista) {
  const v = lista.filter(valido).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function lerStorage(chave, padrao) {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch (_) {
    return padrao;
  }
}

function gravarStorage(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (_) { /* modo privado */ }
}
