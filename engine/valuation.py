"""Funções puras de valuation seguindo estritamente as regras do PROJETO.md."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from engine.schemas import (
    Ativo,
    CategoriaAtivo,
    Dividendo,
    EventoProvento,
    Fundamentos,
    NivelSustentabilidade,
    PilarSustentabilidade,
    ResultadoBazin,
    ScoreSustentabilidade,
    StatusEventoProvento,
    TipoEventoProvento,
    VereditoCor,
)

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


@dataclass(frozen=True)
class ResumoAgendaProventos:
    """Consolidação pura da agenda de proventos, pagamentos e sazonalidade histórica de 5 anos."""

    proxima_data_com: Optional[EventoProvento]
    ultimo_provento_pago: Optional[EventoProvento]
    proximo_pagamento: Optional[EventoProvento]
    agenda_anunciada: list[EventoProvento]
    meses_habituais_dividendo: list[int]
    mapa_sazonal_5a: dict[str, int]


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


def _fmt_pct_pt(valor: float, casas: int = 0) -> str:
    return f"{valor * 100:.{casas}f}%".replace(".", ",")


def _fmt_mult_pt(valor: float) -> str:
    return f"{valor:.2f}x".replace(".", ",")


def avaliar_sustentabilidade(
    dividendos: Iterable[Dividendo],
    bazin_res: ResultadoBazin,
    fundamentos: Fundamentos,
    setor: str,
    ano_referencia: int,
) -> ScoreSustentabilidade:
    """Calcula o Score de Sustentabilidade Anti-Cilada (0–100) baseado em 4 pilares objetivos.

    Pilares (25 pontos cada):
    1. Regularidade nos 5 anos civis fechados (constância de proventos recorrentes).
    2. Saúde do Payout e cobertura pelo lucro contábil (LPA > 0 e Payout sustentável).
    3. Solidez financeira / Alavancagem (Dív. Líq./EBITDA para operacionais; ROE para bancos/seguradoras).
    4. Tendência recente de proventos (último ano fechado / ano corrente vs. média de 5 anos).
    """
    lista_div = list(dividendos)
    por_ano = bazin_res.por_ano or {}
    anos_pagos = sum(1 for val in por_ano.values() if val is not None and val > 0)
    dpa_5a = bazin_res.dpa_sem_extra

    # 1. Pilar: Regularidade 5 anos
    if anos_pagos >= 5:
        p1 = PilarSustentabilidade(
            id="regularidade",
            nome="Regularidade (5a)",
            pontos=25,
            status="ok",
            detalhe="Pagou proventos em 5/5 anos fechados",
        )
    elif anos_pagos == 4:
        p1 = PilarSustentabilidade(
            id="regularidade",
            nome="Regularidade (5a)",
            pontos=18,
            status="ok",
            detalhe="Pagou proventos em 4/5 anos fechados",
        )
    elif anos_pagos == 3:
        p1 = PilarSustentabilidade(
            id="regularidade",
            nome="Regularidade (5a)",
            pontos=10,
            status="alerta",
            detalhe="Pagou em 3/5 anos (histórico intermitente)",
        )
    elif anos_pagos >= 1:
        p1 = PilarSustentabilidade(
            id="regularidade",
            nome="Regularidade (5a)",
            pontos=4,
            status="risco",
            detalhe=f"Pagou em apenas {anos_pagos}/5 anos (esporádico)",
        )
    else:
        p1 = PilarSustentabilidade(
            id="regularidade",
            nome="Regularidade (5a)",
            pontos=0,
            status="neutro",
            detalhe="Sem proventos recorrentes na janela de 5 anos",
        )

    # 2. Pilar: Saúde do Payout e Lucratividade
    lpa = fundamentos.lpa
    payout_efetivo = fundamentos.payout
    if payout_efetivo is None and lpa is not None and lpa > 0 and dpa_5a > 0:
        payout_efetivo = dpa_5a / lpa

    tem_prejuizo = lpa is not None and lpa <= 0
    if tem_prejuizo:
        p2 = PilarSustentabilidade(
            id="payout",
            nome="Cobertura pelo Lucro",
            pontos=0,
            status="risco",
            detalhe="Prejuízo contábil atual (LPA ≤ 0)",
        )
    elif payout_efetivo is not None and dpa_5a > 0:
        if 0 < payout_efetivo <= 0.85:
            p2 = PilarSustentabilidade(
                id="payout",
                nome="Cobertura pelo Lucro",
                pontos=25,
                status="ok",
                detalhe=f"Payout saudável ({_fmt_pct_pt(payout_efetivo)})",
            )
        elif 0.85 < payout_efetivo <= 1.05:
            p2 = PilarSustentabilidade(
                id="payout",
                nome="Cobertura pelo Lucro",
                pontos=17,
                status="alerta",
                detalhe=f"Payout elevado ({_fmt_pct_pt(payout_efetivo)})",
            )
        elif payout_efetivo > 1.05:
            p2 = PilarSustentabilidade(
                id="payout",
                nome="Cobertura pelo Lucro",
                pontos=5,
                status="risco",
                detalhe=f"Payout acima do lucro ({_fmt_pct_pt(payout_efetivo)})",
            )
        else:
            p2 = PilarSustentabilidade(
                id="payout",
                nome="Cobertura pelo Lucro",
                pontos=10,
                status="neutro",
                detalhe="Retenção integral de lucros",
            )
    elif lpa is not None and lpa > 0:
        p2 = PilarSustentabilidade(
            id="payout",
            nome="Cobertura pelo Lucro",
            pontos=16,
            status="ok",
            detalhe="Empresa lucrativa (LPA positivo)",
        )
    else:
        p2 = PilarSustentabilidade(
            id="payout",
            nome="Cobertura pelo Lucro",
            pontos=10,
            status="neutro",
            detalhe="Dados de payout indisponíveis",
        )

    # 3. Pilar: Solidez Financeira e Alavancagem
    eh_banco = _eh_banco(setor)
    roe = fundamentos.roe
    div_ebitda = fundamentos.div_liq_ebitda
    div_patrim = fundamentos.div_liq_patrim
    alavancagem_critica = False

    if eh_banco:
        if roe is not None:
            if roe >= 0.14:
                p3 = PilarSustentabilidade(
                    id="solidez",
                    nome="Solidez & Rentabilidade",
                    pontos=25,
                    status="ok",
                    detalhe=f"ROE bancário sólido ({_fmt_pct_pt(roe, 1)})",
                )
            elif roe >= 0.10:
                p3 = PilarSustentabilidade(
                    id="solidez",
                    nome="Solidez & Rentabilidade",
                    pontos=18,
                    status="ok",
                    detalhe=f"ROE bancário adequado ({_fmt_pct_pt(roe, 1)})",
                )
            elif roe >= 0.05:
                p3 = PilarSustentabilidade(
                    id="solidez",
                    nome="Solidez & Rentabilidade",
                    pontos=9,
                    status="alerta",
                    detalhe=f"ROE bancário pressionado ({_fmt_pct_pt(roe, 1)})",
                )
            else:
                alavancagem_critica = True
                p3 = PilarSustentabilidade(
                    id="solidez",
                    nome="Solidez & Rentabilidade",
                    pontos=2,
                    status="risco",
                    detalhe=f"ROE bancário fraco ({_fmt_pct_pt(roe, 1)})",
                )
        else:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Solidez & Rentabilidade",
                pontos=12,
                status="neutro",
                detalhe="ROE bancário não informado",
            )
    elif div_ebitda is not None:
        if div_ebitda < 0:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Alavancagem (Dív./EBITDA)",
                pontos=25,
                status="ok",
                detalhe=f"Caixa líquido ({_fmt_mult_pt(div_ebitda)})",
            )
        elif div_ebitda <= 2.2:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Alavancagem (Dív./EBITDA)",
                pontos=25,
                status="ok",
                detalhe=f"Dívida confortável ({_fmt_mult_pt(div_ebitda)})",
            )
        elif div_ebitda <= 3.2:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Alavancagem (Dív./EBITDA)",
                pontos=18,
                status="ok",
                detalhe=f"Dívida moderada ({_fmt_mult_pt(div_ebitda)})",
            )
        elif div_ebitda <= 4.2:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Alavancagem (Dív./EBITDA)",
                pontos=9,
                status="alerta",
                detalhe=f"Alavancagem elevada ({_fmt_mult_pt(div_ebitda)})",
            )
        else:
            alavancagem_critica = True
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Alavancagem (Dív./EBITDA)",
                pontos=0,
                status="risco",
                detalhe=f"Alavancagem crítica ({_fmt_mult_pt(div_ebitda)})",
            )
    else:
        # Seguradoras, holdings e empresas sem EV/EBITDA reportado
        if roe is not None and roe >= 0.12 and (div_patrim is None or div_patrim <= 1.0):
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Solidez & Rentabilidade",
                pontos=25,
                status="ok",
                detalhe=f"Boa rentabilidade (ROE {_fmt_pct_pt(roe, 1)})",
            )
        elif roe is not None and roe >= 0.08:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Solidez & Rentabilidade",
                pontos=17,
                status="ok",
                detalhe=f"ROE positivo ({_fmt_pct_pt(roe, 1)})",
            )
        elif roe is not None and roe < 0.08:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Solidez & Rentabilidade",
                pontos=6,
                status="alerta",
                detalhe=f"Baixa rentabilidade (ROE {_fmt_pct_pt(roe, 1)})",
            )
        else:
            p3 = PilarSustentabilidade(
                id="solidez",
                nome="Alavancagem (Dív./EBITDA)",
                pontos=12,
                status="neutro",
                detalhe="Indicador de dívida não aplicável / N/D",
            )

    # 4. Pilar: Tendência recente de proventos vs. Média de 5 anos
    ultimo_ano_fechado = str(ano_referencia - 1)
    dpa_ultimo_fechado = float(por_ano.get(ultimo_ano_fechado, 0.0) or 0.0)
    dpa_ano_aberto = sum(
        d.valor for d in lista_div if d.data_com.year == ano_referencia and d.tipo != "extraordinario"
    )
    dpa_recente_ref = max(dpa_ultimo_fechado, dpa_ano_aberto)
    corte_severo = False

    if dpa_5a <= 0:
        p4 = PilarSustentabilidade(
            id="tendencia",
            nome="Tendência do Dividendo",
            pontos=0,
            status="neutro",
            detalhe="Sem base de DPA 5a para comparação",
        )
    else:
        razao = dpa_recente_ref / dpa_5a
        if razao >= 0.95:
            p4 = PilarSustentabilidade(
                id="tendencia",
                nome="Tendência do Dividendo",
                pontos=25,
                status="ok",
                detalhe=f"Estável ou crescente ({_fmt_pct_pt(razao)} da média 5a)",
            )
        elif razao >= 0.70:
            p4 = PilarSustentabilidade(
                id="tendencia",
                nome="Tendência do Dividendo",
                pontos=16,
                status="alerta",
                detalhe=f"Oscilação moderada ({_fmt_pct_pt(razao)} da média 5a)",
            )
        elif razao >= 0.35:
            p4 = PilarSustentabilidade(
                id="tendencia",
                nome="Tendência do Dividendo",
                pontos=7,
                status="risco",
                detalhe=f"Queda recente ({_fmt_pct_pt(razao)} da média 5a)",
            )
        else:
            corte_severo = True
            p4 = PilarSustentabilidade(
                id="tendencia",
                nome="Tendência do Dividendo",
                pontos=0,
                status="risco",
                detalhe="Corte severo de proventos no ciclo recente",
            )

    pilares = [p1, p2, p3, p4]

    if dpa_5a <= 0 and anos_pagos == 0:
        return ScoreSustentabilidade(
            nota=0,
            nivel="sem_dividendo",
            rotulo="Sem Divid.",
            anos_pagos_5a=0,
            pilares=pilares,
        )

    nota = p1.pontos + p2.pontos + p3.pontos + p4.pontos
    # Trava de segurança anti-cilada: empresa com prejuízo atual, corte severo ou dívida crítica nunca recebe "Forte"
    if tem_prejuizo or corte_severo or alavancagem_critica:
        nota = min(nota, 68)
    if tem_prejuizo and (corte_severo or alavancagem_critica):
        nota = min(nota, 45)

    nivel: NivelSustentabilidade
    if nota >= 75:
        nivel = "forte"
        rotulo = "Forte"
    elif nota >= 50:
        nivel = "moderado"
        rotulo = "Moderado"
    else:
        nivel = "alerta"
        rotulo = "Risco Cilada"

    return ScoreSustentabilidade(
        nota=nota,
        nivel=nivel,
        rotulo=rotulo,
        anos_pagos_5a=anos_pagos,
        pilares=pilares,
    )


def consolidar_agenda_proventos(
    dividendos: Iterable[Dividendo],
    anuncios_agenda: Iterable[Dividendo],
    data_referencia: date,
    ano_referencia: Optional[int] = None,
) -> ResumoAgendaProventos:
    """Consolida próximo evento com data-com em aberto, último provento pago, próximo pagamento e sazonalidade 5a."""
    ano_ref = ano_referencia if ano_referencia is not None else data_referencia.year
    lista_hist = [d for d in dividendos if d.valor > 0]
    lista_anuncios = [a for a in anuncios_agenda if a.valor > 0]

    # Mapa de data_pagamento auxiliar vindo da agenda mensal para enriquecer eventos históricos sem data de pgto
    pgto_por_data_com: dict[date, date] = {}
    for an in lista_anuncios:
        if an.data_pagamento is not None and an.data_com not in pgto_por_data_com:
            pgto_por_data_com[an.data_com] = an.data_pagamento

    datas_com_hist = {d.data_com for d in lista_hist}
    combinados: list[Dividendo] = []

    for d in lista_hist:
        if d.data_pagamento is None and d.data_com in pgto_por_data_com:
            combinados.append(d.model_copy(update={"data_pagamento": pgto_por_data_com[d.data_com]}))
        else:
            combinados.append(d)

    for an in lista_anuncios:
        if an.data_com not in datas_com_hist:
            combinados.append(an)

    # Consolida parcelas com mesma (data_com, data_pagamento)
    grupos: dict[tuple[date, Optional[date]], list[Dividendo]] = defaultdict(list)
    for item in combinados:
        grupos[(item.data_com, item.data_pagamento)].append(item)

    eventos: list[EventoProvento] = []
    for (dt_com, dt_pgto), parcelas in grupos.items():
        soma_valor = round(sum(p.valor for p in parcelas), 6)
        if soma_valor <= 0:
            continue
        tipos_distintos = {p.tipo for p in parcelas}
        if len(tipos_distintos) == 1:
            tipo_ev: TipoEventoProvento = next(iter(tipos_distintos))
        else:
            tipo_ev = "misto"

        status_ev: StatusEventoProvento
        if dt_com >= data_referencia:
            status_ev = "anunciado"
        elif dt_pgto is not None and dt_pgto > data_referencia:
            status_ev = "a_pagar"
        elif dt_pgto is not None and dt_pgto <= data_referencia:
            status_ev = "pago"
        else:
            status_ev = "sem_data_pgto"

        eventos.append(
            EventoProvento(
                data_com=dt_com,
                data_pagamento=dt_pgto,
                valor=soma_valor,
                tipo=tipo_ev,
                status=status_ev,
            )
        )

    anunciados = sorted(
        [e for e in eventos if e.status == "anunciado"],
        key=lambda e: (e.data_com, e.data_pagamento or date.max),
    )
    proxima_data_com = anunciados[0] if anunciados else None

    a_pagar = sorted(
        [e for e in eventos if e.status == "a_pagar"],
        key=lambda e: (e.data_pagamento or date.max, e.data_com),
    )
    proximo_pagamento = a_pagar[0] if a_pagar else None

    pagos = sorted(
        [e for e in eventos if e.status == "pago"],
        key=lambda e: (e.data_pagamento or e.data_com, e.data_com),
        reverse=True,
    )
    if pagos:
        ultimo_provento_pago = pagos[0]
    else:
        # Fallback caso a fonte do ativo não traga coluna de data de pagamento
        passados = sorted(
            [e for e in eventos if e.data_com < data_referencia],
            key=lambda e: e.data_com,
            reverse=True,
        )
        ultimo_provento_pago = passados[0] if passados else None

    agenda_anunciada = (anunciados + a_pagar)[:8]

    # Sazonalidade histórica nos 5 anos civis fechados (pela data-com)
    anos_fechados = set(range(ano_ref - JANELA_ANOS_DPA, ano_ref))
    anos_por_mes: dict[int, set[int]] = defaultdict(set)
    for d in lista_hist:
        if d.data_com.year in anos_fechados and d.tipo != "extraordinario":
            anos_por_mes[d.data_com.month].add(d.data_com.year)

    if not anos_por_mes:
        for d in lista_hist:
            if d.data_com.year in anos_fechados:
                anos_por_mes[d.data_com.month].add(d.data_com.year)

    mapa_sazonal_5a = {str(mes): len(anos_set) for mes, anos_set in sorted(anos_por_mes.items()) if anos_set}
    habituais = [mes for mes, anos_set in sorted(anos_por_mes.items()) if len(anos_set) >= 2]
    if not habituais and anos_por_mes:
        habituais = sorted(anos_por_mes.keys())

    return ResumoAgendaProventos(
        proxima_data_com=proxima_data_com,
        ultimo_provento_pago=ultimo_provento_pago,
        proximo_pagamento=proximo_pagamento,
        agenda_anunciada=agenda_anunciada,
        meses_habituais_dividendo=habituais,
        mapa_sazonal_5a=mapa_sazonal_5a,
    )
