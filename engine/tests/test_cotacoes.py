"""Testes do ciclo rápido de cotações (engine.build.aplicar_cotacoes)."""

from datetime import date, datetime, timezone

import pytest

from engine.build import aplicar_cotacoes
from engine.schemas import Fundamentos, ResultadoAtivo, ResultadoBazin, Saida


def _saida_base() -> Saida:
    ativo = ResultadoAtivo(
        ticker="TAEE11",
        setor="energia",
        preco=40.0,
        data_ult_cot="04/11/2026",
        bazin=ResultadoBazin(
            dpa=3.0, dpa_sem_extra=3.0, teto=50.0, margem_seguranca=0.2, veredito="verde",
            teto_projetado_consenso=45.0, margem_projetada_consenso=0.111,
        ),
        graham=60.0,
        margem_graham=1 / 3,
        fundamentos=Fundamentos(lpa=4.0, vpa=20.0, pl=10.0, pvp=2.0),
        historico_precos=[38.0, 40.0],
    )
    sem_cotacao = ResultadoAtivo(
        ticker="XPTO3",
        setor="outros",
        preco=10.0,
        bazin=ResultadoBazin(dpa=0.0, dpa_sem_extra=0.0, teto=0.0, veredito="vermelho"),
        historico_precos=[9.0, 10.0],
    )
    return Saida(
        gerado_em=datetime(2026, 11, 4, 21, 0, tzinfo=timezone.utc),
        historico_datas=["2026-10-26", "2026-11-02"],
        benchmarks_historico={"CDI": [100.0, 100.3]},
        ativos=[ativo, sem_cotacao],
    )


def test_recalcula_margens_e_veredito_com_novo_preco():
    agora = datetime(2026, 11, 5, 15, 0, tzinfo=timezone.utc)
    out = aplicar_cotacoes(_saida_base(), {"TAEE11": (52.5, date(2026, 11, 5))}, agora=agora)
    a = out.ativos[0]

    assert a.preco == pytest.approx(52.5)
    assert a.data_ult_cot == "05/11/2026"
    assert a.bazin.margem_seguranca == pytest.approx((50.0 - 52.5) / 50.0)
    assert a.bazin.veredito == "amarelo"  # -5% de margem
    assert a.bazin.margem_projetada_consenso == pytest.approx((45.0 - 52.5) / 45.0)
    assert a.margem_graham == pytest.approx((60.0 - 52.5) / 60.0)
    assert a.fundamentos.pl == pytest.approx(13.12, abs=0.01)
    assert a.fundamentos.pvp == pytest.approx(2.62, abs=0.01)
    # DPA e teto permanecem os do build completo
    assert a.bazin.teto == pytest.approx(50.0)
    assert out.gerado_em == agora


def test_anexa_ponto_do_dia_e_alinha_series():
    agora = datetime(2026, 11, 5, 15, 0, tzinfo=timezone.utc)
    out = aplicar_cotacoes(_saida_base(), {"TAEE11": (41.0, date(2026, 11, 5))}, agora=agora)

    assert out.historico_datas[-1] == "2026-11-05"
    for a in out.ativos:
        assert len(a.historico_precos) == len(out.historico_datas)
    assert out.ativos[0].historico_precos[-1] == pytest.approx(41.0)
    # Ativo sem cotação nova repete o último valor conhecido
    assert out.ativos[1].historico_precos[-1] == pytest.approx(10.0)
    assert out.ativos[1].preco == pytest.approx(10.0)
    assert len(out.benchmarks_historico["CDI"]) == len(out.historico_datas)


def test_mesmo_dia_sobrescreve_ultimo_ponto():
    base = _saida_base().model_copy(update={"historico_datas": ["2026-10-26", "2026-11-05"]})
    agora = datetime(2026, 11, 5, 18, 0, tzinfo=timezone.utc)
    out = aplicar_cotacoes(base, {"TAEE11": (42.0, date(2026, 11, 5))}, agora=agora)

    assert out.historico_datas == ["2026-10-26", "2026-11-05"]
    assert out.ativos[0].historico_precos == [38.0, 42.0]
