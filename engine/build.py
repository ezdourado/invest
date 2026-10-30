"""Script de geração do arquivo estático data/valuation.json a partir de dados reais (engine/sources.py)."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from engine.schemas import Ativo, Dividendo, ResultadoAtivo, Saida
from engine.sources import CAMINHO_TICKERS_PADRAO, carregar_tickers_json, obter_ativos
from engine.valuation import (
    avaliar_bazin,
    eh_setor_besst,
    gordon,
    graham,
    margem,
    proporcao_abaixo_teto,
    ranking_greenblatt,
    resolver_categoria_ativo,
)

TAXA_DESCONTO_GORDON_PADRAO: float = 0.10


def _compactar_vetores_historico(json_str: str) -> str:
    """Mantém objetos indentados para diff limpo no Git, compactando vetores planos de histórico em linha única."""

    def _colapsar(match: re.Match[str]) -> str:
        prefixo, miolo, sufixo = match.group(1), match.group(2), match.group(3)
        itens = "".join(linha.strip() for linha in miolo.splitlines())
        return f"{prefixo}{itens}{sufixo}"

    compactado = re.sub(
        r'("(?:historico_datas|historico_precos)": \[)\s*([^\[\]\{\}]*?)\s*(\])',
        _colapsar,
        json_str,
    )
    return re.sub(
        r'\{\s+("data_com": "[^"]+",)\s+("valor": [0-9.eE+-]+,)\s+("tipo": "[^"]+")\s+\}',
        r'{ \1 \2 \3 }',
        compactado,
    )


def construir_saida(
    ativos: list[Ativo],
    ano_referencia: int | None = None,
    taxa_desconto_gordon: float = TAXA_DESCONTO_GORDON_PADRAO,
) -> Saida:
    """Calcula valuation completo para a lista de Ativo e retorna o objeto Saida validado."""
    agora = datetime.now(timezone.utc)
    ano_ref = ano_referencia if ano_referencia is not None else agora.year
    data_corte_proventos = date(ano_ref - 5, 1, 1)

    conjunto_datas: set[str] = set()
    mapas_pontos: dict[str, dict[str, float]] = {}
    for ativo in ativos:
        if ativo.pontos_historico:
            mp = {dt_str: round(float(val), 2) for dt_str, val in ativo.pontos_historico if val and val > 0}
            if mp:
                mapas_pontos[ativo.ticker] = mp
                conjunto_datas.update(mp.keys())

    historico_datas = sorted(conjunto_datas)
    if historico_datas:
        hoje_iso = agora.date().isoformat()
        ultima_dt = historico_datas[-1]
        if hoje_iso > ultima_dt:
            historico_datas.append(hoje_iso)
            for ativo in ativos:
                if ativo.ticker in mapas_pontos:
                    mapas_pontos[ativo.ticker][hoje_iso] = round(float(ativo.preco), 2)
        else:
            for ativo in ativos:
                if ativo.ticker in mapas_pontos:
                    mapas_pontos[ativo.ticker][ultima_dt] = round(float(ativo.preco), 2)

    mapa_greenblatt = ranking_greenblatt(ativos)
    resultados: list[ResultadoAtivo] = []

    for ativo in ativos:
        bazin_res = avaliar_bazin(
            dividendos=ativo.dividendos,
            preco=ativo.preco,
            ano_referencia=ano_ref,
        )

        vi_graham = graham(ativo.fundamentos.lpa, ativo.fundamentos.vpa)
        m_graham = margem(vi_graham, ativo.preco) if vi_graham is not None else None

        preco_gordon = gordon(
            dpa=bazin_res.dpa_sem_extra,
            taxa_desconto=taxa_desconto_gordon,
            g_perpetuidade=ativo.fundamentos.g_perpetuidade,
        )
        m_gordon = margem(preco_gordon, ativo.preco) if preco_gordon is not None else None

        gb_info = mapa_greenblatt.get(ativo.ticker)
        f = ativo.fundamentos
        payout_calc = f.payout
        if payout_calc is None and f.lpa is not None and f.lpa > 0 and bazin_res.dpa_sem_extra >= 0:
            payout_calc = round(bazin_res.dpa_sem_extra / f.lpa, 4)

        fund_out = f.model_copy(update={"payout": payout_calc})
        categoria_resolvida = resolver_categoria_ativo(ativo.setor, ativo.categoria)

        mp_ativo = mapas_pontos.get(ativo.ticker)
        serie_alinhada: list[Optional[float]] = []
        if historico_datas and mp_ativo:
            ultimo_conhecido: Optional[float] = None
            for dt_iso in historico_datas:
                if dt_iso in mp_ativo:
                    ultimo_conhecido = mp_ativo[dt_iso]
                    serie_alinhada.append(ultimo_conhecido)
                else:
                    serie_alinhada.append(ultimo_conhecido)

        pct_abaixo = proporcao_abaixo_teto(serie_alinhada, bazin_res.teto) if serie_alinhada else None

        proventos_5a = sorted(
            [
                Dividendo(
                    data_com=d.data_com,
                    valor=round(float(d.valor), 6),
                    tipo=d.tipo,
                )
                for d in ativo.dividendos
                if d.data_com >= data_corte_proventos and round(float(d.valor), 6) > 0
            ],
            key=lambda x: x.data_com,
        )

        resultados.append(
            ResultadoAtivo(
                ticker=ativo.ticker,
                empresa=f.empresa,
                setor=ativo.setor,
                categoria=categoria_resolvida,
                besst=eh_setor_besst(ativo.setor),
                preco=ativo.preco,
                data_ult_cot=f.data_ult_cot,
                ult_balanco=f.ult_balanco,
                bazin=bazin_res,
                graham=vi_graham,
                margem_graham=m_graham,
                gordon=preco_gordon,
                margem_gordon=m_gordon,
                rank_greenblatt=gb_info.rank if gb_info else None,
                motivo_exclusao_greenblatt=gb_info.motivo_exclusao if gb_info else None,
                fundamentos=fund_out,
                pct_abaixo_teto_5a=pct_abaixo,
                historico_precos=serie_alinhada,
                proventos_historico=proventos_5a,
            )
        )

    return Saida(
        schema_version="1.0",
        gerado_em=agora,
        historico_datas=historico_datas,
        ativos=resultados,
    )


def serializar_saida(saida_validada: Saida) -> str:
    """Serializa o objeto Saida validado em JSON legível e compacto."""
    bruto: dict[str, Any] = saida_validada.model_dump(mode="json")
    texto = json.dumps(bruto, ensure_ascii=False, indent=2)
    return _compactar_vetores_historico(texto) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera data/valuation.json com dados de valuation da B3.")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Usa engine/exemplo_ativos.json em vez de consultar a API externa.",
    )
    parser.add_argument(
        "--tickers-file",
        type=Path,
        default=CAMINHO_TICKERS_PADRAO,
        help="Caminho para o arquivo JSON com a lista de tickers e setores.",
    )
    args = parser.parse_args()

    raiz_projeto = Path(__file__).resolve().parent.parent
    caminho_saida = raiz_projeto / "data" / "valuation.json"

    if args.offline:
        caminho_exemplo = Path(__file__).resolve().parent / "exemplo_ativos.json"
        dados_brutos = json.loads(caminho_exemplo.read_text(encoding="utf-8"))
        ativos = [Ativo.model_validate(item) for item in dados_brutos]
    else:
        lista_tickers = carregar_tickers_json(args.tickers_file)
        ativos = obter_ativos(lista_tickers)
        if not ativos:
            raise RuntimeError("Nenhum ativo válido pôde ser obtido pela fonte de dados.")

    saida = construir_saida(ativos)
    saida_validada = Saida.model_validate(saida.model_dump(mode="json"))

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)
    caminho_saida.write_text(
        serializar_saida(saida_validada),
        encoding="utf-8",
    )
    print(f"Arquivo gerado com sucesso: {caminho_saida} ({len(saida_validada.ativos)} ativos reais)")


if __name__ == "__main__":
    main()
