/* Fonte de dados: busca do valuation.json publicado pelo motor (branch `dados`, via
 * raw.githubusercontent.com) com fallback para a cópia servida pelo Pages. */

// O motor publica os dados no branch `dados` (não na main) para não disparar um deploy do
// GitHub Pages a cada ciclo; esta é a fonte mais fresca. A cópia servida pelo Pages
// (./data/valuation.json) é só um fallback e pode estar defasada.
const URL_VALUATION_REMOTO = 'https://raw.githubusercontent.com/ezdourado/invest/dados/data/valuation.json';

async function buscarJsonComCacheBust(urlBase) {
  const sep = urlBase.includes('?') ? '&' : '?';
  const resp = await fetch(`${urlBase}${sep}t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json || !Array.isArray(json.ativos)) throw new Error('formato inválido');
  return json;
}

async function obterPayloadMaisRecente() {
  const resultados = await Promise.allSettled([
    buscarJsonComCacheBust('./data/valuation.json'),
    buscarJsonComCacheBust(URL_VALUATION_REMOTO)
  ]);

  const validos = resultados
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (!validos.length) {
    const primeiroErro = resultados.find(r => r.status === 'rejected')?.reason;
    throw primeiroErro || new Error('Nenhuma fonte respondeu');
  }

  if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const local = resultados[0];
    if (local.status === 'fulfilled' && local.value) return local.value;
  }

  validos.sort((a, b) => {
    const ha = Array.isArray(a.historico_datas) && a.historico_datas.length > 0 ? 1 : 0;
    const hb = Array.isArray(b.historico_datas) && b.historico_datas.length > 0 ? 1 : 0;
    if (hb !== ha) return hb - ha;
    const sa = a.ativos?.[0]?.sustentabilidade ? 1 : 0;
    const sb = b.ativos?.[0]?.sustentabilidade ? 1 : 0;
    if (sb !== sa) return sb - sa;
    const ta = new Date(a.gerado_em || 0).getTime() || 0;
    const tb = new Date(b.gerado_em || 0).getTime() || 0;
    return tb - ta;
  });

  return validos[0];
}
