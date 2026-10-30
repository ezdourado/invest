"""Modelos de dados Pydantic v2 para o motor de valuation."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


TipoDividendo = Literal["dividendo", "jcp", "extraordinario"]
VereditoCor = Literal["verde", "amarelo", "vermelho"]
CategoriaAtivo = Literal["besst", "dividendos", "demais"]


class Dividendo(BaseModel):
    """Evento de provento em dinheiro agrupado pela data-com (bonificações nunca entram)."""

    model_config = ConfigDict(extra="forbid")

    data_com: date
    valor: float = Field(..., gt=0, description="Valor bruto por ação em R$ (> 0)")
    tipo: TipoDividendo


class Fundamentos(BaseModel):
    """Indicadores fundamentalistas, múltiplos, qualidade e endividamento opcionais do ativo."""

    model_config = ConfigDict(extra="forbid")

    empresa: Optional[str] = None
    data_ult_cot: Optional[str] = None
    ult_balanco: Optional[str] = None
    lpa: Optional[float] = None
    vpa: Optional[float] = None
    ebit: Optional[float] = None
    ev: Optional[float] = None
    capital_investido: Optional[float] = None
    g_perpetuidade: Optional[float] = None
    # Múltiplos de valuation
    pl: Optional[float] = None
    pvp: Optional[float] = None
    psr: Optional[float] = None
    ev_ebit: Optional[float] = None
    ev_ebitda: Optional[float] = None
    dy_12m: Optional[float] = None
    payout: Optional[float] = None
    # Qualidade e rentabilidade
    roe: Optional[float] = None
    roic: Optional[float] = None
    margem_bruta: Optional[float] = None
    margem_ebit: Optional[float] = None
    margem_liquida: Optional[float] = None
    cresc_receita_5a: Optional[float] = None
    # Endividamento e liquidez
    div_liq_patrim: Optional[float] = None
    div_liq_ebit: Optional[float] = None
    div_liq_ebitda: Optional[float] = None
    liquidez_corrente: Optional[float] = None
    liquidez_diaria: Optional[float] = None


class Ativo(BaseModel):
    """Dados de entrada de um ativo da B3."""

    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(..., min_length=1)
    setor: str = Field(..., min_length=1)
    categoria: Optional[CategoriaAtivo] = None
    preco: float = Field(..., gt=0, description="Cotação atual em R$ (> 0)")
    dividendos: list[Dividendo] = Field(default_factory=list)
    fundamentos: Fundamentos = Field(default_factory=Fundamentos)
    pontos_historico: list[tuple[str, float]] = Field(default_factory=list)


class ResultadoBazin(BaseModel):
    """Resultado do método Bazin (K = 6% fixo)."""

    model_config = ConfigDict(extra="forbid")

    dpa: float = Field(..., ge=0)
    dpa_sem_extra: float = Field(..., ge=0)
    tem_extraordinario: bool = False
    teto: float = Field(..., ge=0)
    teto_sem_extra: Optional[float] = None
    margem_seguranca: Optional[float] = None
    veredito: VereditoCor
    por_ano: Optional[dict[str, float]] = None


class ResultadoAtivo(BaseModel):
    """Resultado consolidado de valuation e raio-x fundamentalista de um ativo."""

    model_config = ConfigDict(extra="forbid")

    ticker: str
    empresa: Optional[str] = None
    setor: str
    categoria: CategoriaAtivo = "dividendos"
    besst: bool = False
    preco: float = Field(..., gt=0)
    data_ult_cot: Optional[str] = None
    ult_balanco: Optional[str] = None
    bazin: ResultadoBazin
    graham: Optional[float] = None
    margem_graham: Optional[float] = None
    gordon: Optional[float] = None
    margem_gordon: Optional[float] = None
    rank_greenblatt: Optional[int] = None
    motivo_exclusao_greenblatt: Optional[str] = None
    fundamentos: Optional[Fundamentos] = None
    pct_abaixo_teto_5a: Optional[float] = None
    historico_precos: list[Optional[float]] = Field(default_factory=list)
    proventos_historico: list[Dividendo] = Field(default_factory=list)


class Saida(BaseModel):
    """Payload raiz exportado para data/valuation.json."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = "1.0"
    gerado_em: datetime
    historico_datas: list[str] = Field(default_factory=list)
    ativos: list[ResultadoAtivo] = Field(default_factory=list)
