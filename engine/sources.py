"""Módulo isolado de coleta de dados reais de cotações, dividendos e fundamentos da B3.

Fontes utilizadas:
1. Proventos históricos: Fundamentus (`proventos.php?papel=<TICKER>&tipo=2`), que fornece
   a série histórica completa da B3 já indexada pela `data-com` oficial e com o tipo de
   provento explícito (`DIVIDENDO`, `JRS CAP PROPRIO`, `REST CAP DIN`, etc.), ajustada
   pelos fatores de desdobramento/bonificação (`splits`) da ação para manter a base
   comparável com a cotação atual.
   Caso o Fundamentus esteja indisponível para algum ativo, utiliza como fallback a série
   de dividendos do Yahoo Finance convertendo a `data-ex` para `data-com` (dia útil anterior).
2. Indicadores de qualidade, endividamento, múltiplos e datas de referência:
   Fundamentus (`detalhes.php?papel=<TICKER>`) + Yahoo Finance (`yfinance`, sufixo `.SA`).
"""

from __future__ import annotations

import json
import math
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import yfinance as yf
from bs4 import BeautifulSoup
from pydantic import ValidationError

from engine.schemas import Ativo, Dividendo, Fundamentos, TipoDividendo

CAMINHO_LOG_ERROS = Path(__file__).resolve().parent / "erros.log"
CAMINHO_TICKERS_PADRAO = Path(__file__).resolve().parent / "tickers.json"
MAX_WORKERS_COLETA = 8


def converter_data_ex_para_data_com(data_ex: date) -> date:
    """Converte a data-ex (Ex-Dividend Date) para a data-com (dia útil anterior).

    Documentação da regra (usada quando a fonte informa data-ex em vez de data-com):
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


def _normalizar_chave(texto: str) -> str:
    limpo = texto.lstrip("?").strip()
    sem_acento = unicodedata.normalize("NFKD", limpo).encode("ascii", "ignore").decode("ascii")
    return " ".join(sem_acento.lower().split())


def _parse_numero_br(val_str: Optional[str]) -> Optional[float]:
    """Converte string numérica pt-BR ('1.234,56' ou '20,1%') para float."""
    if not val_str:
        return None
    s = val_str.strip()
    if not s or s == "-":
        return None
    eh_pct = s.endswith("%")
    if eh_pct:
        s = s[:-1].strip()
    s = s.replace(".", "").replace(",", ".")
    try:
        num = float(s)
        if math.isnan(num) or math.isinf(num):
            return None
        return round(num / 100.0, 6) if eh_pct else num
    except ValueError:
        return None


def _mapear_tipo_provento(tipo_str: str) -> Optional[TipoDividendo]:
    """Classifica o tipo textual do provento em 'dividendo', 'jcp' ou 'extraordinario'.

    Bonificações em ações ou subscrições retornam None (nunca entram no DPA).
    Restituição de capital em dinheiro ('REST CAP DIN') ou dividendos especiais/extraordinários
    são classificados como 'extraordinario'.
    """
    t = tipo_str.strip().upper()
    if "BONIFICA" in t or "SUBSCRI" in t or "DESDOBRA" in t or "GRUPAMENTO" in t:
        return None
    if "REST" in t or "EXTRA" in t or "ESPECIAL" in t:
        return "extraordinario"
    if "JRS" in t or "JUROS" in t or "JCP" in t:
        return "jcp"
    return "dividendo"


def _coletar_detalhes_fundamentus(symbol_b3: str) -> dict[str, Any]:
    """Coleta múltiplos, indicadores de qualidade, endividamento e datas de referência do Fundamentus."""
    papel = symbol_b3.replace(".SA", "").strip().upper()
    url = f"https://www.fundamentus.com.br/detalhes.php?papel={papel}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        html = resp.read().decode("latin-1", errors="ignore")

    soup = BeautifulSoup(html, "lxml")
    pares: dict[str, str] = {}
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        for i in range(0, len(tds) - 1, 2):
            classes_k = tds[i].get("class") or []
            classes_v = tds[i + 1].get("class") or []
            if "label" in classes_k and "data" in classes_v:
                k = _normalizar_chave(tds[i].get_text(strip=True))
                v = tds[i + 1].get_text(strip=True)
                if k and k not in pares:
                    pares[k] = v

    if not pares:
        return {}

    cotacao = _parse_numero_br(pares.get("cotacao"))
    lpa = _parse_numero_br(pares.get("lpa"))
    vpa = _parse_numero_br(pares.get("vpa"))
    pl = _parse_numero_br(pares.get("p/l"))
    pvp = _parse_numero_br(pares.get("p/vp"))
    psr = _parse_numero_br(pares.get("psr"))
    ev_ebit = _parse_numero_br(pares.get("ev / ebit"))
    ev_ebitda = _parse_numero_br(pares.get("ev / ebitda"))
    dy_12m = _parse_numero_br(pares.get("div. yield"))

    roe = _parse_numero_br(pares.get("roe"))
    roic = _parse_numero_br(pares.get("roic"))
    margem_bruta = _parse_numero_br(pares.get("marg. bruta"))
    margem_ebit = _parse_numero_br(pares.get("marg. ebit"))
    margem_liquida = _parse_numero_br(pares.get("marg. liquida"))
    if margem_liquida == 0.0 and "receita liquida" not in pares:
        margem_liquida = None

    cresc_receita_5a = _parse_numero_br(pares.get("cres. rec (5a)"))
    liquidez_corrente = _parse_numero_br(pares.get("liquidez corr"))
    liquidez_diaria = _parse_numero_br(pares.get("vol $ med (2m)"))
    div_liq_patrim = _parse_numero_br(pares.get("div liq / patrim"))

    ebit = _parse_numero_br(pares.get("ebit"))
    ev = _parse_numero_br(pares.get("valor da firma"))
    div_liquida = _parse_numero_br(pares.get("div. liquida"))
    patrim_liq = _parse_numero_br(pares.get("patrim. liq"))

    div_liq_ebit: Optional[float] = None
    if div_liquida is not None and ebit is not None and ebit > 0:
        div_liq_ebit = round(div_liquida / ebit, 2)

    div_liq_ebitda: Optional[float] = None
    if div_liquida is not None and ev is not None and ev > 0 and ev_ebitda is not None and ev_ebitda > 0:
        ebitda_impl = ev / ev_ebitda
        if ebitda_impl > 0:
            div_liq_ebitda = round(div_liquida / ebitda_impl, 2)

    cap_inv: Optional[float] = None
    if patrim_liq is not None and div_liquida is not None:
        soma_cap = patrim_liq + div_liquida
        if soma_cap > 0:
            cap_inv = soma_cap

    return {
        "cotacao": cotacao,
        "empresa": pares.get("empresa") or None,
        "data_ult_cot": pares.get("data ult cot") or None,
        "ult_balanco": pares.get("ult balanco processado") or None,
        "lpa": lpa,
        "vpa": vpa,
        "pl": pl,
        "pvp": pvp,
        "psr": psr,
        "ev_ebit": ev_ebit,
        "ev_ebitda": ev_ebitda,
        "dy_12m": dy_12m,
        "roe": roe,
        "roic": roic,
        "margem_bruta": margem_bruta,
        "margem_ebit": margem_ebit,
        "margem_liquida": margem_liquida,
        "cresc_receita_5a": cresc_receita_5a,
        "liquidez_corrente": liquidez_corrente,
        "liquidez_diaria": liquidez_diaria,
        "div_liq_patrim": div_liq_patrim,
        "div_liq_ebit": div_liq_ebit,
        "div_liq_ebitda": div_liq_ebitda,
        "ebit": ebit,
        "ev": ev,
        "capital_investido": cap_inv,
    }


def _coletar_proventos_fundamentus(
    symbol_b3: str,
    splits: list[tuple[date, float]],
) -> list[Dividendo]:
    """Coleta a tabela oficial de proventos por data-com do Fundamentus ajustada por splits."""
    papel = symbol_b3.replace(".SA", "").strip().upper()
    url = f"https://www.fundamentus.com.br/proventos.php?papel={papel}&tipo=2"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        html = resp.read().decode("latin-1", errors="ignore")

    soup = BeautifulSoup(html, "lxml")
    tabela = soup.find("table", {"id": "resultado"})
    if not tabela or not tabela.find("tbody"):
        return []

    dividendos: list[Dividendo] = []
    for tr in tabela.find("tbody").find_all("tr"):
        cols = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(cols) < 5:
            continue

        dt_str, val_str, tipo_str, _, qtd_str = cols[:5]
        tipo_mapeado = _mapear_tipo_provento(tipo_str)
        if tipo_mapeado is None:
            continue

        try:
            dia, mes, ano = map(int, dt_str.split("/"))
            dt_com = date(ano, mes, dia)
            valor_bruto = float(val_str.replace(".", "").replace(",", "."))
            lote = float(qtd_str.replace(".", "").replace(",", "."))
            if lote <= 0 or valor_bruto <= 0:
                continue
            valor_por_acao = valor_bruto / lote
        except (ValueError, ZeroDivisionError):
            continue

        fator_split = 1.0
        for dt_split, ratio in splits:
            if dt_split > dt_com and ratio > 0:
                fator_split *= ratio

        valor_ajustado = valor_por_acao / fator_split
        if valor_ajustado <= 0:
            continue

        dividendos.append(
            Dividendo(
                data_com=dt_com,
                valor=round(valor_ajustado, 6),
                tipo=tipo_mapeado,
            )
        )

    return dividendos


def _coletar_dados_ativo(symbol_b3: str) -> dict[str, Any]:
    """Consulta cotação, múltiplos, indicadores de qualidade/dívida e histórico de proventos."""
    yf_symbol = symbol_b3 if symbol_b3.endswith(".SA") else f"{symbol_b3}.SA"
    ticker_obj = yf.Ticker(yf_symbol)

    detalhes_fund: dict[str, Any] = {}
    try:
        detalhes_fund = _coletar_detalhes_fundamentus(symbol_b3)
    except Exception:
        detalhes_fund = {}

    info: dict[str, Any] = {}
    try:
        info = ticker_obj.info or {}
    except Exception:
        info = {}

    preco = _limpar_float(
        info.get("regularMarketPrice")
        or info.get("currentPrice")
        or detalhes_fund.get("cotacao")
        or info.get("previousClose")
    )

    if preco is None or preco <= 0:
        try:
            hist = ticker_obj.history(period="5d")
            if hist is not None and not hist.empty and "Close" in hist:
                preco = _limpar_float(hist["Close"].dropna().iloc[-1])
        except Exception:
            preco = detalhes_fund.get("cotacao")

    splits: list[tuple[date, float]] = []
    try:
        serie_splits = ticker_obj.splits
        if serie_splits is not None and not serie_splits.empty:
            for idx_dt, ratio in serie_splits.items():
                r_val = _limpar_float(ratio)
                if r_val and r_val > 0:
                    dt_s = idx_dt.date() if hasattr(idx_dt, "date") else date.fromisoformat(str(idx_dt)[:10])
                    splits.append((dt_s, r_val))
    except Exception:
        pass

    dividendos: list[Dividendo] = []
    try:
        dividendos = _coletar_proventos_fundamentus(symbol_b3, splits)
    except Exception:
        dividendos = []

    if not dividendos:
        try:
            serie_div = ticker_obj.dividends
            if serie_div is not None and not serie_div.empty:
                for idx_dt, val in serie_div.items():
                    valor_f = _limpar_float(val)
                    if valor_f is None or valor_f <= 0:
                        continue
                    dt_ex = idx_dt.date() if hasattr(idx_dt, "date") else date.fromisoformat(str(idx_dt)[:10])
                    dt_com = converter_data_ex_para_data_com(dt_ex)
                    dividendos.append(
                        Dividendo(
                            data_com=dt_com,
                            valor=round(valor_f, 6),
                            tipo="dividendo",
                        )
                    )
        except Exception:
            pass

    lpa = detalhes_fund.get("lpa") if detalhes_fund.get("lpa") is not None else _limpar_float(info.get("trailingEps") or info.get("forwardEps"))
    vpa = detalhes_fund.get("vpa") if detalhes_fund.get("vpa") is not None else _limpar_float(info.get("bookValue"))
    ebit = detalhes_fund.get("ebit") if detalhes_fund.get("ebit") is not None else _limpar_float(info.get("ebitda"))
    ev = detalhes_fund.get("ev") if detalhes_fund.get("ev") is not None else _limpar_float(info.get("enterpriseValue"))

    capital_investido = detalhes_fund.get("capital_investido")
    if capital_investido is None:
        total_debt = _limpar_float(info.get("totalDebt")) or 0.0
        total_cash = _limpar_float(info.get("totalCash")) or 0.0
        shares = _limpar_float(info.get("sharesOutstanding"))
        patrimonio_liquido = (vpa * shares) if (vpa and vpa > 0 and shares and shares > 0) else 0.0
        cap_inv = patrimonio_liquido + total_debt - total_cash
        capital_investido = cap_inv if cap_inv > 0 else (ev if (ev and ev > 0) else None)

    roe = detalhes_fund.get("roe") if detalhes_fund.get("roe") is not None else _limpar_float(info.get("returnOnEquity"))
    payout_yf = _limpar_float(info.get("payoutRatio"))
    if roe is not None and roe > 0 and payout_yf is not None and 0 <= payout_yf < 1.0:
        g_raw = roe * (1.0 - payout_yf)
        g_perp = min(0.045, max(0.0, round(g_raw, 4)))
    else:
        g_perp = 0.025

    pl = detalhes_fund.get("pl") if detalhes_fund.get("pl") is not None else (round(preco / lpa, 2) if (preco and lpa and lpa != 0) else None)
    pvp = detalhes_fund.get("pvp") if detalhes_fund.get("pvp") is not None else (round(preco / vpa, 2) if (preco and vpa and vpa > 0) else None)

    return {
        "preco": preco,
        "dividendos": dividendos,
        "fundamentos": {
            "empresa": detalhes_fund.get("empresa") or info.get("shortName"),
            "data_ult_cot": detalhes_fund.get("data_ult_cot"),
            "ult_balanco": detalhes_fund.get("ult_balanco"),
            "lpa": lpa,
            "vpa": vpa,
            "ebit": ebit,
            "ev": ev,
            "capital_investido": capital_investido,
            "g_perpetuidade": g_perp,
            "pl": pl,
            "pvp": pvp,
            "psr": detalhes_fund.get("psr"),
            "ev_ebit": detalhes_fund.get("ev_ebit"),
            "ev_ebitda": detalhes_fund.get("ev_ebitda"),
            "dy_12m": detalhes_fund.get("dy_12m"),
            "payout": payout_yf if (payout_yf is not None and 0 <= payout_yf <= 3.0) else None,
            "roe": roe,
            "roic": detalhes_fund.get("roic"),
            "margem_bruta": detalhes_fund.get("margem_bruta"),
            "margem_ebit": detalhes_fund.get("margem_ebit"),
            "margem_liquida": detalhes_fund.get("margem_liquida"),
            "cresc_receita_5a": detalhes_fund.get("cresc_receita_5a"),
            "div_liq_patrim": detalhes_fund.get("div_liq_patrim"),
            "div_liq_ebit": detalhes_fund.get("div_liq_ebit"),
            "div_liq_ebitda": detalhes_fund.get("div_liq_ebitda"),
            "liquidez_corrente": detalhes_fund.get("liquidez_corrente"),
            "liquidez_diaria": detalhes_fund.get("liquidez_diaria"),
        },
    }


def obter_ativos(
    tickers: Iterable[dict[str, str] | str],
    caminho_log: Path = CAMINHO_LOG_ERROS,
) -> list[Ativo]:
    """Obtém e valida uma lista de `Ativo` em paralelo a partir de uma coleção de tickers."""
    mapa_setores_padrao: dict[str, str] = {}
    if CAMINHO_TICKERS_PADRAO.exists():
        try:
            for entrada in carregar_tickers_json(CAMINHO_TICKERS_PADRAO):
                t_key = str(entrada.get("ticker", "")).strip().upper()
                if t_key:
                    mapa_setores_padrao[t_key] = str(entrada.get("setor", "outros")).strip()
        except Exception:
            pass

    entradas_normalizadas: list[tuple[str, str]] = []
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
        entradas_normalizadas.append((ticker_raw, setor_raw))

    def _processar_um(par: tuple[str, str]) -> Optional[Ativo]:
        ticker_raw, setor_raw = par
        try:
            bruto = _coletar_dados_ativo(ticker_raw)
            preco = bruto.get("preco")
            if preco is None or preco <= 0:
                raise ValueError(f"Cotação inválida ou ausente retornada pela fonte: {preco}")

            dividendos = bruto.get("dividendos", [])
            fundamentos = Fundamentos.model_validate(bruto.get("fundamentos", {}))

            return Ativo(
                ticker=ticker_raw,
                setor=setor_raw,
                preco=round(float(preco), 4),
                dividendos=dividendos,
                fundamentos=fundamentos,
            )
        except (ValidationError, Exception) as exc:
            registrar_erro_log(ticker_raw, f"Falha ao obter/validar ativo: {exc}", caminho_log=caminho_log)
            return None

    workers = min(MAX_WORKERS_COLETA, max(1, len(entradas_normalizadas)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        resultados = list(pool.map(_processar_um, entradas_normalizadas))

    return [ativo for ativo in resultados if ativo is not None]
