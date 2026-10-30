"""Funções puras de valuation seguindo estritamente as regras do PROJETO.md."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional

from engine.schemas import Ativo, CategoriaAtivo, Dividendo, ResultadoBazin, VereditoCor

TAXA_BAZIN_FIXA: float = 0.06
JANELA_ANOS_DPA: int = 5
SETORES_BESST: frozenset[str] = frozenset(
    {"bancos", "energia", "saneamento", "seguros", "telecom"}
)


@dataclass(frozen=True)
class ResultadoDPA:
    """Resultado do cálculo de DPA retroativo de 5 anos fechados."""

    dpa: float
    dpa_sem_extra: float
    tem_extraordinario: bool
    por_ano: dict[int, float]
    por_ano_sem_extra: dict[int, float]


@dataclass(frozen=True)
class ItemRankingGreenblatt:
    """Entrada individual do resultado de ranking da Fórmula Mágica de Greenblatt."""

    ticker: str
    elegivel: bool
    rank: Optional[int]
    score: Optional[int]
    rank_ey: Optional[int]
    rank_roic: Optional[int]
    earnings_yield: Optional[float]
    roic: Optional[float]
    motivo_exclusao: Optional[str] = None


def normalizar_setor(setor: str) -> str:
    """Normaliza o nome do setor para comparação consistente."""
    return setor.strip().lower()


def eh_setor_besst(setor: str) -> bool:
    """Retorna True se o setor pertence ao acrônimo BESST (bancos, energia, saneamento, seguros, telecom)."""
    s = normalizar_setor(setor)
    if s in SETORES_BESST:
        return True
    mapeamento_prefixos = ("banco", "energia", "eletric", "saneamento", "segur", "telecom")
    return any(s.startswith(p) for p in mapeamento_prefixos)


def resolver_categoria_ativo(
    setor: str,
    categoria_declarada: Optional[CategoriaAtivo] = None,
) -> CategoriaAtivo:
    """Resolve a categoria do ativo ('besst', 'dividendos' ou 'demais')."""
    if categoria_declarada == "demais":
        return "demais"
    if eh_setor_besst(setor):
        return "besst"
    if categoria_declarada in ("besst", "dividendos"):
        return categoria_declarada
    return "dividendos"


def proporcao_abaixo_teto(
    precos: Iterable[Optional[float]],
    teto: Optional[float],
) -> Optional[float]:
    """Calcula a proporção (0.0 a 1.0) de cotações históricas abaixo ou iguais ao preço-teto."""
    if teto is None or teto <= 0 or math.isnan(teto):
        return None
    validos = [p for p in precos if p is not None and p > 0 and not math.isnan(p)]
    if not validos:
        return None
    abaixo = sum(1 for p in validos if p <= teto)
    return round(abaixo / len(validos), 4)


def _eh_banco(setor: str) -> bool:
    s = normalizar_setor(setor)
    return s in {"banco", "bancos", "bancario", "bancário"} or s.startswith("banco")


def dpa_retroativo(
    dividendos: Iterable[Dividendo],
    ano_referencia: int,
    janela: int = JANELA_ANOS_DPA,
) -> ResultadoDPA:
    """Calcula o DPA retroativo agrupando proventos pelo ano civil da data-com.

    Considera exclusivamente os últimos `janela` (padrão 5) anos civis fechados
    imediatamente anteriores a `ano_referencia`, ou seja:
    [ano_referencia - janela, ..., ano_referencia - 1].

    Retorna o DPA total (com extraordinários), o DPA sem extraordinários e a flag
    sinalizando se houve dividendos extraordinários na janela.
    """
    if janela <= 0:
        raise ValueError("A janela de anos para o DPA deve ser maior que zero.")

    anos_fechados = list(range(ano_referencia - janela, ano_referencia))
    conjunto_anos = set(anos_fechados)

    por_ano: dict[int, float] = {ano: 0.0 for ano in anos_fechados}
    por_ano_sem_extra: dict[int, float] = {ano: 0.0 for ano in anos_fechados}
    tem_extraordinario = False

    for div in dividendos:
        ano_com = div.data_com.year
        if ano_com not in conjunto_anos:
            continue

        por_ano[ano_com] += div.valor
        if div.tipo == "extraordinario":
            tem_extraordinario = True
        else:
            por_ano_sem_extra[ano_com] += div.valor

    soma_total = sum(por_ano.values())
    soma_sem_extra = sum(por_ano_sem_extra.values())

    return ResultadoDPA(
        dpa=soma_total / janela,
        dpa_sem_extra=soma_sem_extra / janela,
        tem_extraordinario=tem_extraordinario,
        por_ano=por_ano,
        por_ano_sem_extra=por_ano_sem_extra,
    )


def teto_bazin(dpa: float) -> float:
    """Calcula o Preço-Teto pelo método Bazin com K = 6% fixo e imutável."""
    if dpa <= 0 or math.isnan(dpa):
        return 0.0
    return dpa / TAXA_BAZIN_FIXA


def margem(teto: float, preco: float) -> Optional[float]:
    """Calcula a margem de segurança com o preço-teto no denominador: (teto - preco) / teto."""
    if teto <= 0 or preco <= 0 or math.isnan(teto) or math.isnan(preco):
        return None
    return (teto - preco) / teto


def veredito_bazin(teto: float, preco: float) -> VereditoCor:
    """Determina o veredito (verde, amarelo ou vermelho) exclusivamente pelo Bazin retroativo."""
    m = margem(teto, preco)
    if m is None:
        return "vermelho"
    if m >= 0.0:
        return "verde"
    if m >= -0.05:
        return "amarelo"
    return "vermelho"


def avaliar_bazin(
    dividendos: Iterable[Dividendo],
    preco: float,
    ano_referencia: int,
) -> ResultadoBazin:
    """Executa a avaliação completa de Bazin para um ativo (com e sem extraordinários)."""
    res_dpa = dpa_retroativo(dividendos, ano_referencia=ano_referencia)
    teto_principal = teto_bazin(res_dpa.dpa_sem_extra)
    teto_com_extra = teto_bazin(res_dpa.dpa)
    m_seguranca = margem(teto_principal, preco)

    return ResultadoBazin(
        dpa=res_dpa.dpa,
        dpa_sem_extra=res_dpa.dpa_sem_extra,
        tem_extraordinario=res_dpa.tem_extraordinario,
        teto=teto_principal,
        teto_sem_extra=teto_principal if res_dpa.tem_extraordinario else teto_com_extra,
        margem_seguranca=m_seguranca,
        veredito=veredito_bazin(teto_principal, preco),
        por_ano={str(ano): round(val, 4) for ano, val in res_dpa.por_ano_sem_extra.items()},
    )


def graham(lpa: Optional[float], vpa: Optional[float]) -> Optional[float]:
    """Calcula o Valor Intrínseco de Benjamin Graham: sqrt(22.5 * LPA * VPA).

    Retorna None caso LPA ou VPA sejam ausentes, zero ou negativos.
    """
    if lpa is None or vpa is None:
        return None
    if lpa <= 0 or vpa <= 0 or math.isnan(lpa) or math.isnan(vpa):
        return None
    return math.sqrt(22.5 * lpa * vpa)


def gordon(
    dpa: Optional[float],
    taxa_desconto: float,
    g_perpetuidade: Optional[float] = 0.0,
) -> Optional[float]:
    """Calcula o Preço Justo pelo Modelo de Gordon: DPA * (1 + g) / (k - g).

    Retorna None caso DPA <= 0, g < 0 ou taxa_desconto <= g.
    """
    if dpa is None or dpa <= 0:
        return None
    g = 0.0 if g_perpetuidade is None else g_perpetuidade
    if g < 0 or taxa_desconto <= 0 or taxa_desconto <= g:
        return None
    return (dpa * (1.0 + g)) / (taxa_desconto - g)


def ranking_greenblatt(ativos: Iterable[Ativo]) -> dict[str, ItemRankingGreenblatt]:
    """Calcula o ranking da Magic Formula de Joel Greenblatt sobre o universo de ativos.

    Regras (PROJETO.md):
    - Bancos ficam fora do ranking (EBIT/EV não se aplica), registrando o motivo.
    - Ativos sem EBIT, EV ou Capital Investido positivos também ficam fora do ranking,
      registrando o motivo correspondente.
    - O ranking combina:
      1. Maior Earnings Yield (EBIT / EV) -> rank 1 para o maior.
      2. Maior ROIC (EBIT / Capital Investido) -> rank 1 para o maior.
    """
    lista_ativos = list(ativos)
    resultado: dict[str, ItemRankingGreenblatt] = {}
    elegiveis: list[tuple[str, float, float]] = []

    for ativo in lista_ativos:
        if _eh_banco(ativo.setor):
            resultado[ativo.ticker] = ItemRankingGreenblatt(
                ticker=ativo.ticker,
                elegivel=False,
                rank=None,
                score=None,
                rank_ey=None,
                rank_roic=None,
                earnings_yield=None,
                roic=None,
                motivo_exclusao="Bancos ficam fora do ranking Greenblatt (EBIT/EV não se aplica).",
            )
            continue

        f = ativo.fundamentos
        if f.ebit is None or f.ev is None or f.capital_investido is None:
            resultado[ativo.ticker] = ItemRankingGreenblatt(
                ticker=ativo.ticker,
                elegivel=False,
                rank=None,
                score=None,
                rank_ey=None,
                rank_roic=None,
                earnings_yield=None,
                roic=None,
                motivo_exclusao="Dados insuficientes para Greenblatt (requer EBIT, EV e Capital Investido).",
            )
            continue

        if f.ebit <= 0 or f.ev <= 0 or f.capital_investido <= 0:
            resultado[ativo.ticker] = ItemRankingGreenblatt(
                ticker=ativo.ticker,
                elegivel=False,
                rank=None,
                score=None,
                rank_ey=None,
                rank_roic=None,
                earnings_yield=None,
                roic=None,
                motivo_exclusao="Múltiplos operacionais não positivos (EBIT, EV e Capital Investido devem ser > 0).",
            )
            continue

        ey = f.ebit / f.ev
        roic_val = f.ebit / f.capital_investido
        elegiveis.append((ativo.ticker, ey, roic_val))

    if not elegiveis:
        return resultado

    ordenado_ey = sorted(elegiveis, key=lambda x: (-x[1], x[0]))
    mapa_rank_ey = {ticker: idx + 1 for idx, (ticker, _, _) in enumerate(ordenado_ey)}

    ordenado_roic = sorted(elegiveis, key=lambda x: (-x[2], x[0]))
    mapa_rank_roic = {ticker: idx + 1 for idx, (ticker, _, _) in enumerate(ordenado_roic)}

    combinado = []
    for ticker, ey, roic_val in elegiveis:
        r_ey = mapa_rank_ey[ticker]
        r_roic = mapa_rank_roic[ticker]
        score = r_ey + r_roic
        combinado.append((ticker, score, r_ey, r_roic, ey, roic_val))

    combinado.sort(key=lambda x: (x[1], -x[4], -x[5], x[0]))

    for idx, (ticker, score, r_ey, r_roic, ey, roic_val) in enumerate(combinado):
        resultado[ticker] = ItemRankingGreenblatt(
            ticker=ticker,
            elegivel=True,
            rank=idx + 1,
            score=score,
            rank_ey=r_ey,
            rank_roic=r_roic,
            earnings_yield=ey,
            roic=roic_val,
            motivo_exclusao=None,
        )

    return resultado
