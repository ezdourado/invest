"""Testes unitários para o núcleo de valuation e schemas (PROJETO.md)."""

from datetime import date, datetime, timezone
import pytest
from pydantic import ValidationError

from engine.schemas import Ativo, Dividendo, Fundamentos, ResultadoAtivo, ResultadoBazin, Saida
from engine.valuation import (
    TAXA_BAZIN_FIXA,
    avaliar_bazin,
    dpa_retroativo,
    eh_setor_besst,
    gordon,
    graham,
    margem,
    ranking_greenblatt,
    teto_bazin,
)


def test_bucket_data_com_na_virada_de_ano():
    """Garante agrupamento estrito pelo ano civil da data-com na janela de 5 anos fechados."""
    # Ano de referência = 2026 -> janela fechada: 2021, 2022, 2023, 2024, 2025
    dividendos = [
        Dividendo(data_com=date(2020, 12, 31), valor=5.00, tipo="dividendo"),  # Fora (anterior à janela)
        Dividendo(data_com=date(2021, 1, 2), valor=1.00, tipo="dividendo"),    # Entra em 2021
        Dividendo(data_com=date(2022, 12, 29), valor=1.50, tipo="jcp"),        # Entra em 2022
        Dividendo(data_com=date(2023, 6, 15), valor=2.00, tipo="dividendo"),   # Entra em 2023
        Dividendo(data_com=date(2024, 12, 30), valor=2.50, tipo="dividendo"),  # Entra em 2024
        Dividendo(data_com=date(2025, 12, 31), valor=3.00, tipo="jcp"),        # Entra em 2025 (último dia do ano)
        Dividendo(data_com=date(2026, 1, 1), valor=9.00, tipo="dividendo"),    # Fora (ano de referência em aberto)
    ]

    res = dpa_retroativo(dividendos, ano_referencia=2026)

    assert set(res.por_ano.keys()) == {2021, 2022, 2023, 2024, 2025}
    assert res.por_ano[2021] == pytest.approx(1.00)
    assert res.por_ano[2025] == pytest.approx(3.00)
    # Soma = 1.0 + 1.5 + 2.0 + 2.5 + 3.0 = 10.0 -> Média 5 anos = 2.0
    assert res.dpa == pytest.approx(2.00)
    assert res.dpa_sem_extra == pytest.approx(2.00)
    assert res.tem_extraordinario is False


def test_exclusao_e_sinalizacao_de_extraordinarios():
    """Calcula DPA com e sem dividendos extraordinários e sinaliza presença."""
    dividendos = [
        Dividendo(data_com=date(2021, 5, 10), valor=1.20, tipo="dividendo"),
        Dividendo(data_com=date(2022, 5, 10), valor=1.20, tipo="dividendo"),
        Dividendo(data_com=date(2023, 5, 10), valor=1.20, tipo="jcp"),
        Dividendo(data_com=date(2024, 5, 10), valor=1.20, tipo="dividendo"),
        Dividendo(data_com=date(2025, 5, 10), valor=1.20, tipo="dividendo"),
        Dividendo(data_com=date(2025, 11, 20), valor=4.00, tipo="extraordinario"),
    ]

    res = dpa_retroativo(dividendos, ano_referencia=2026)

    assert res.tem_extraordinario is True
    assert res.dpa_sem_extra == pytest.approx(1.20)
    assert res.dpa == pytest.approx((6.00 + 4.00) / 5)

    bazin = avaliar_bazin(dividendos, preco=18.00, ano_referencia=2026)
    assert bazin.tem_extraordinario is True
    assert bazin.dpa_sem_extra == pytest.approx(1.20)
    assert bazin.dpa == pytest.approx(2.00)
    assert bazin.teto == pytest.approx(1.20 / 0.06)


def test_bonificacao_rejeitada_no_schema():
    """Bonificações nunca entram no DPA e são barradas no schema de Dividendo."""
    with pytest.raises(ValidationError):
        Dividendo(data_com=date(2024, 4, 10), valor=1.0, tipo="bonificacao")  # type: ignore[arg-type]


def test_k_fixo_6_porcento_no_teto_bazin():
    """Garante K = 6% fixo e sem parâmetro para alterar a taxa de desconto de Bazin."""
    assert TAXA_BAZIN_FIXA == pytest.approx(0.06)
    assert teto_bazin(3.00) == pytest.approx(50.00)
    assert teto_bazin(0.0) == 0.0
    assert teto_bazin(-1.5) == 0.0


def test_margem_seguranca_com_teto_no_denominador():
    """Margem de segurança deve ser (teto - preço) / teto (teto no denominador)."""
    teto = 50.0
    preco = 35.0
    # (50 - 35) / 50 = 0.30 (30%), e NÃO (50 - 35) / 35 = 42.85%
    assert margem(teto, preco) == pytest.approx((50.0 - 35.0) / 50.0)
    assert margem(50.0, 60.0) == pytest.approx(-0.20)
    assert margem(0.0, 35.0) is None
    assert margem(50.0, 0.0) is None


def test_graham_com_lpa_ou_vpa_negativo_ou_zero_retorna_none():
    """Graham retorna None se LPA ou VPA forem <= 0 ou ausentes."""
    assert graham(-2.0, 20.0) is None
    assert graham(2.0, -20.0) is None
    assert graham(-2.0, -20.0) is None
    assert graham(0.0, 20.0) is None
    assert graham(2.0, 0.0) is None
    assert graham(None, 20.0) is None
    assert graham(2.0, None) is None
    # Caso válido: sqrt(22.5 * 4 * 10) = sqrt(900) = 30.0
    assert graham(4.0, 10.0) == pytest.approx(30.0)


def test_gordon_perpetuidade():
    """Testa cálculo puro do Modelo de Gordon e restrições de k > g."""
    # DPA = 2.0, k = 10% (0.10), g = 2% (0.02) -> 2.0 * 1.02 / 0.08 = 25.50
    assert gordon(2.0, taxa_desconto=0.10, g_perpetuidade=0.02) == pytest.approx(25.50)
    assert gordon(2.0, taxa_desconto=0.05, g_perpetuidade=0.05) is None
    assert gordon(2.0, taxa_desconto=0.04, g_perpetuidade=0.05) is None
    assert gordon(0.0, taxa_desconto=0.10, g_perpetuidade=0.02) is None


def test_ranking_greenblatt_exclui_bancos_com_motivo():
    """Bancos ficam fora do ranking Greenblatt registrando o motivo; operacionais são ranqueadas."""
    ativos = [
        Ativo(
            ticker="BBAS3",
            setor="Bancos",
            preco=27.50,
            fundamentos=Fundamentos(lpa=5.8, vpa=31.2, ebit=40000, ev=150000, capital_investido=200000),
        ),
        Ativo(
            ticker="PETR4",
            setor="Petróleo e Gás",
            preco=38.20,
            fundamentos=Fundamentos(ebit=200.0, ev=600.0, capital_investido=800.0),  # EY=33.3%, ROIC=25.0%
        ),
        Ativo(
            ticker="WEGE3",
            setor="Bens Industriais",
            preco=44.50,
            fundamentos=Fundamentos(ebit=50.0, ev=1000.0, capital_investido=150.0),  # EY=5.0%, ROIC=33.3%
        ),
        Ativo(
            ticker="CMIG4",
            setor="Energia",
            preco=11.20,
            fundamentos=Fundamentos(ebit=150.0, ev=500.0, capital_investido=500.0),  # EY=30.0%, ROIC=30.0%
        ),
    ]

    ranking = ranking_greenblatt(ativos)

    # Banco deve estar fora do ranking com motivo registrado
    bbas = ranking["BBAS3"]
    assert bbas.elegivel is False
    assert bbas.rank is None
    assert bbas.motivo_exclusao is not None
    assert "EBIT/EV" in bbas.motivo_exclusao

    # Empresas operacionais recebem posições 1, 2 e 3
    assert ranking["CMIG4"].elegivel is True
    assert ranking["PETR4"].elegivel is True
    assert ranking["WEGE3"].elegivel is True
    ranks_operacionais = {ranking["CMIG4"].rank, ranking["PETR4"].rank, ranking["WEGE3"].rank}
    assert ranks_operacionais == {1, 2, 3}


def test_schema_saida_e_filtro_besst():
    """Valida serialização da Saida completa e identificação setorial BESST."""
    assert eh_setor_besst("Bancos") is True
    assert eh_setor_besst("Energia") is True
    assert eh_setor_besst("Varejo") is False

    saida = Saida(
        schema_version="1.0",
        gerado_em=datetime(2026, 10, 17, 2, 0, tzinfo=timezone.utc),
        ativos=[
            ResultadoAtivo(
                ticker="BBAS3",
                setor="Bancos",
                besst=True,
                preco=27.50,
                bazin=ResultadoBazin(
                    dpa=2.40,
                    dpa_sem_extra=2.40,
                    tem_extraordinario=False,
                    teto=40.00,
                    teto_sem_extra=40.00,
                    margem_seguranca=0.3125,
                    veredito="verde",
                ),
                graham=63.81,
                rank_greenblatt=None,
                motivo_exclusao_greenblatt="Bancos ficam fora do ranking Greenblatt (EBIT/EV não se aplica).",
            )
        ],
    )
    payload = saida.model_dump(mode="json")
    assert payload["schema_version"] == "1.0"
    assert payload["ativos"][0]["ticker"] == "BBAS3"


def test_build_gera_saida_valida():
    """Valida a construção do payload de Saida a partir do exemplo_ativos.json."""
    import json
    from pathlib import Path
    from engine.build import construir_saida

    caminho_exemplo = Path(__file__).resolve().parent.parent / "exemplo_ativos.json"
    dados = json.loads(caminho_exemplo.read_text(encoding="utf-8"))
    ativos = [Ativo.model_validate(item) for item in dados]

    saida = construir_saida(ativos, ano_referencia=2026)
    assert len(saida.ativos) == 5
    setores = {a.setor for a in saida.ativos}
    assert setores == {"bancos", "energia", "saneamento", "seguros", "telecom"}
    assert all(a.besst is True for a in saida.ativos)
