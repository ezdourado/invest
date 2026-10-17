"""Módulo isolado de coleta de dados reais de cotações, dividendos e fundamentos da B3.

Fonte primária: Yahoo Finance (`yfinance`, sufixo `.SA` para ativos da B3).
Todo o código de acesso externo fica restrito a este módulo para permitir
substituição futura de provedor sem impacto em `valuation.py` ou `build.py`.

REGRA DE CONVERSÃO DATA-EX -> DATA-COM:
O Yahoo Finance registra os eventos de proventos pela `data-ex` (Ex-Dividend Date),
que é o primeiro pregão em que a ação passa a ser negociada sem direito ao provento.
Na B3, a `data-com` (último dia com direito ao dividendo) corresponde ao dia útil
imediatamente anterior à `data-ex`:
- Se a `data-ex` cai em uma segunda-feira (`weekday == 0`), a `data-com` é a
  sexta-feira anterior (`data_ex - 3 dias`).
- Se a `data-ex` cai em um domingo (`weekday == 6`), recua 2 dias para sexta-feira.
- Nos demais dias úteis (terça a sábado), a `data-com` é o dia anterior (`data_ex - 1 dia`).
Isso garante que proventos cuja `data-com` ocorreu nos últimos dias de dezembro
(e cuja `data-ex` caiu no início de janeiro do ano seguinte) sejam alocados
corretamente no ano civil da `data-com`, conforme exigido pelo PROJETO.md.
"""

from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import yfinance as yf
from pydantic import ValidationError

from engine.schemas import Ativo, Dividendo, Fundamentos, TipoDividendo

CAMINHO_LOG_ERROS = Path(__file__).resolve().parent / "erros.log"
CAMINHO_TICKERS_PADRAO = Path(__file__).resolve().parent / "tickers.json"


def converter_data_ex_para_data_com(data_ex: date) -> date:
    """Converte a data-ex (Ex-Dividend Date) para a data-com (dia útil anterior).

    Documentação da regra:
    - Segunda-feira (weekday == 0) -> recua 3 dias (sexta-feira anterior).
    - Domingo (weekday == 6)       -> recua 2 dias (sexta-feira anterior).
    - Terça a Sábado               -> recua 1 dia.
    """
    dia_semana = data_ex.weekday()
    if dia_semana == 0:
        return data_ex - timedelta(days=3)
    if dia_semana == 6:
        return data_ex - timedelta(days=2)
    return data_ex - timedelta(days=1)


def registrar_erro_log(ticker: str, mensagem: str, caminho_log: Path = CAMINHO_LOG_ERROS) -> None:
    """Registra falhas de coleta ou validação Pydantic em engine/erros.log sem interromper o build."""
    timestamp = datetime.now(timezone.utc).isoformat()
    linha = f"[{timestamp}] [{ticker}] {mensagem}\n"
    caminho_log.parent.mkdir(parents=True, exist_ok=True)
    with caminho_log.open("a", encoding="utf-8") as f:
        f.write(linha)


def carregar_tickers_json(caminho: Path = CAMINHO_TICKERS_PADRAO) -> list[dict[str, str]]:
    """Lê a lista de dicionários {'ticker': ..., 'setor': ...} de engine/tickers.json."""
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    if not isinstance(dados, list):
        raise ValueError(f"O arquivo {caminho} deve conter uma lista JSON de objetos ticker/setor.")
    return dados


def _limpar_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        num = float(val)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    except (TypeError, ValueError):
        return None


def _classificar_proventos(eventos_brutos: list[tuple[date, float]]) -> list[Dividendo]:
    """Converte tuplas (data_com, valor) em objetos Dividendo e detecta extraordinários.

    Heurística transparente para sinalizar dividendos extraordinários quando a fonte
    fornece a série histórica bruta de caixa: se houver ao menos 4 pagamentos na janela
    e um pagamento individual for superior a 3,0x a mediana dos pagamentos do ativo
    (e representar valor relevante >= R$ 0,50), ele é classificado como 'extraordinario'.
    """
    validos = [(dt, val) for dt, val in eventos_brutos if val is not None and val > 0]
    if not validos:
        return []

    valores_ordenados = sorted(v for _, v in validos)
    n = len(valores_ordenados)
    mediana = (
        valores_ordenados[n // 2]
        if n % 2 == 1
        else (valores_ordenados[n // 2 - 1] + valores_ordenados[n // 2]) / 2.0
    )

    limiar_extra = max(mediana * 3.0, 0.50) if n >= 4 else float("inf")

    resultado: list[Dividendo] = []
    for dt_com, valor in validos:
        tipo: TipoDividendo = "extraordinario" if valor >= limiar_extra else "dividendo"
        resultado.append(
            Dividendo(
                data_com=dt_com,
                valor=round(valor, 6),
                tipo=tipo,
            )
        )
    return resultado


def _coletar_dados_yahoo(symbol_b3: str) -> dict[str, Any]:
    """Consulta cotação, dividendos históricos e indicadores fundamentalistas no Yahoo Finance."""
    yf_symbol = symbol_b3 if symbol_b3.endswith(".SA") else f"{symbol_b3}.SA"
    ticker_obj = yf.Ticker(yf_symbol)

    info: dict[str, Any] = {}
    try:
        info = ticker_obj.info or {}
    except Exception:
        info = {}

    preco = _limpar_float(
        info.get("regularMarketPrice")
        or info.get("currentPrice")
        or info.get("previousClose")
    )

    if preco is None or preco <= 0:
        try:
            hist = ticker_obj.history(period="5d")
            if hist is not None and not hist.empty and "Close" in hist:
                preco = _limpar_float(hist["Close"].dropna().iloc[-1])
        except Exception:
            preco = None

    eventos_dividendos: list[tuple[date, float]] = []
    try:
        serie_div = ticker_obj.dividends
        if serie_div is not None and not serie_div.empty:
            for idx_dt, val in serie_div.items():
                valor_f = _limpar_float(val)
                if valor_f is None or valor_f <= 0:
                    continue
                dt_ex = idx_dt.date() if hasattr(idx_dt, "date") else date.fromisoformat(str(idx_dt)[:10])
                dt_com = converter_data_ex_para_data_com(dt_ex)
                eventos_dividendos.append((dt_com, valor_f))
    except Exception:
        pass

    lpa = _limpar_float(info.get("trailingEps") or info.get("forwardEps"))
    vpa = _limpar_float(info.get("bookValue"))
    ebit = _limpar_float(info.get("ebitda"))
    ev = _limpar_float(info.get("enterpriseValue"))

    total_debt = _limpar_float(info.get("totalDebt")) or 0.0
    total_cash = _limpar_float(info.get("totalCash")) or 0.0
    shares = _limpar_float(info.get("sharesOutstanding"))
    patrimonio_liquido = (vpa * shares) if (vpa and vpa > 0 and shares and shares > 0) else 0.0
    cap_inv = patrimonio_liquido + total_debt - total_cash
    capital_investido = cap_inv if cap_inv > 0 else (ev if (ev and ev > 0) else None)

    roe = _limpar_float(info.get("returnOnEquity"))
    payout = _limpar_float(info.get("payoutRatio"))
    if roe is not None and roe > 0 and payout is not None and 0 <= payout < 1.0:
        g_raw = roe * (1.0 - payout)
        g_perp = min(0.045, max(0.0, round(g_raw, 4)))
    else:
        g_perp = 0.025

    return {
        "preco": preco,
        "eventos_dividendos": eventos_dividendos,
        "fundamentos": {
            "lpa": lpa,
            "vpa": vpa,
            "ebit": ebit,
            "ev": ev,
            "capital_investido": capital_investido,
            "g_perpetuidade": g_perp,
        },
    }


def obter_ativos(
    tickers: Iterable[dict[str, str] | str],
    caminho_log: Path = CAMINHO_LOG_ERROS,
) -> list[Ativo]:
    """Obtém e valida uma lista de `Ativo` a partir de uma coleção de tickers.

    Cada item de `tickers` pode ser um `dict` com `{"ticker": "BBAS3", "setor": "bancos"}`
    ou uma string `"BBAS3"` (caso em que o setor é consultado em `engine/tickers.json`).
    Se qualquer ativo falhar na coleta ou na validação Pydantic, o erro é gravado em
    `engine/erros.log` e o processamento prossegue para o próximo ticker.
    """
    mapa_setores_padrao: dict[str, str] = {}
    if CAMINHO_TICKERS_PADRAO.exists():
        try:
            for entrada in carregar_tickers_json(CAMINHO_TICKERS_PADRAO):
                t_key = str(entrada.get("ticker", "")).strip().upper()
                if t_key:
                    mapa_setores_padrao[t_key] = str(entrada.get("setor", "outros")).strip()
        except Exception:
            pass

    ativos_validados: list[Ativo] = []

    for item in tickers:
        if isinstance(item, dict):
            ticker_raw = str(item.get("ticker", "")).strip().upper()
            setor_raw = str(item.get("setor") or mapa_setores_padrao.get(ticker_raw, "outros")).strip()
        else:
            ticker_raw = str(item).strip().upper()
            setor_raw = mapa_setores_padrao.get(ticker_raw, "outros")

        if not ticker_raw:
            registrar_erro_log("VAZIO", "Ticker em branco ignorado.", caminho_log=caminho_log)
            continue

        try:
            bruto = _coletar_dados_yahoo(ticker_raw)
            preco = bruto.get("preco")
            if preco is None or preco <= 0:
                raise ValueError(f"Cotação inválida ou ausente retornada pela fonte: {preco}")

            dividendos = _classificar_proventos(bruto.get("eventos_dividendos", []))
            fundamentos = Fundamentos.model_validate(bruto.get("fundamentos", {}))

            ativo = Ativo(
                ticker=ticker_raw,
                setor=setor_raw,
                preco=round(float(preco), 4),
                dividendos=dividendos,
                fundamentos=fundamentos,
            )
            ativos_validados.append(ativo)
        except (ValidationError, Exception) as exc:
            registrar_erro_log(ticker_raw, f"Falha ao obter/validar ativo: {exc}", caminho_log=caminho_log)
            continue

    return ativos_validados
