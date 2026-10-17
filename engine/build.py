"""Script de geração do arquivo estático data/valuation.json a partir de exemplo_ativos.json."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from engine.schemas import Ativo, ResultadoAtivo, Saida
from engine.valuation import (
    avaliar_bazin,
    eh_setor_besst,
    gordon,
    graham,
    margem,
    ranking_greenblatt,
)

TAXA_DESCONTO_GORDON_PADRAO: float = 0.10


def construir_saida(
    ativos: list[Ativo],
    ano_referencia: int | None = None,
    taxa_desconto_gordon: float = TAXA_DESCONTO_GORDON_PADRAO,
) -> Saida:
    """Calcula valuation completo para a lista de Ativo e retorna o objeto Saida validado."""
    agora = datetime.now(timezone.utc)
    ano_ref = ano_referencia if ano_referencia is not None else agora.year

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

        resultados.append(
            ResultadoAtivo(
                ticker=ativo.ticker,
                setor=ativo.setor,
                besst=eh_setor_besst(ativo.setor),
                preco=ativo.preco,
                bazin=bazin_res,
                graham=vi_graham,
                margem_graham=m_graham,
                gordon=preco_gordon,
                margem_gordon=m_gordon,
                rank_greenblatt=gb_info.rank if gb_info else None,
                motivo_exclusao_greenblatt=gb_info.motivo_exclusao if gb_info else None,
            )
        )

    return Saida(
        schema_version="1.0",
        gerado_em=agora,
        ativos=resultados,
    )


def main() -> None:
    raiz_projeto = Path(__file__).resolve().parent.parent
    caminho_entrada = Path(__file__).resolve().parent / "exemplo_ativos.json"
    caminho_saida = raiz_projeto / "data" / "valuation.json"

    dados_brutos = json.loads(caminho_entrada.read_text(encoding="utf-8"))
    ativos = [Ativo.model_validate(item) for item in dados_brutos]

    saida = construir_saida(ativos)
    saida_validada = Saida.model_validate(saida.model_dump(mode="json"))

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)
    caminho_saida.write_text(
        json.dumps(saida_validada.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Arquivo gerado com sucesso: {caminho_saida} ({len(saida_validada.ativos)} ativos)")


if __name__ == "__main__":
    main()
