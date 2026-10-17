"""Modelos de dados Pydantic v2 para o motor de valuation."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


TipoDividendo = Literal["dividendo", "jcp", "extraordinario"]
VereditoCor = Literal["verde", "amarelo", "vermelho"]


class Dividendo(BaseModel):
    """Evento de provento em dinheiro agrupado pela data-com (bonificações nunca entram)."""

    model_config = ConfigDict(extra="forbid")

    data_com: date
    valor: float = Field(..., gt=0, description="Valor bruto por ação em R$ (> 0)")
    tipo: TipoDividendo


class Fundamentos(BaseModel):
    """Indicadores fundamentalistas opcionais do ativo."""

    model_config = ConfigDict(extra="forbid")

    lpa: Optional[float] = None
    vpa: Optional[float] = None
    ebit: Optional[float] = None
    ev: Optional[float] = None
    capital_investido: Optional[float] = None
    g_perpetuidade: Optional[float] = None


class Ativo(BaseModel):
    """Dados de entrada de um ativo da B3."""

    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(..., min_length=1)
    setor: str = Field(..., min_length=1)
    preco: float = Field(..., gt=0, description="Cotação atual em R$ (> 0)")
    dividendos: list[Dividendo] = Field(default_factory=list)
    fundamentos: Fundamentos = Field(default_factory=Fundamentos)


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


class ResultadoAtivo(BaseModel):
    """Resultado consolidado de valuation de um ativo."""

    model_config = ConfigDict(extra="forbid")

    ticker: str
    setor: str
    besst: bool = False
    preco: float = Field(..., gt=0)
    bazin: ResultadoBazin
    graham: Optional[float] = None
    margem_graham: Optional[float] = None
    gordon: Optional[float] = None
    margem_gordon: Optional[float] = None
    rank_greenblatt: Optional[int] = None
    motivo_exclusao_greenblatt: Optional[str] = None


class Saida(BaseModel):
    """Payload raiz exportado para data/valuation.json."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = "1.0"
    gerado_em: datetime
    ativos: list[ResultadoAtivo] = Field(default_factory=list)
