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
    assert len(saida.ativos) >= 5
    setores = {a.setor for a in saida.ativos}
    assert {"bancos", "energia", "saneamento", "seguros", "telecom"}.issubset(setores)
    assert any(a.besst is True for a in saida.ativos)


def test_conversao_data_ex_para_data_com():
    """Valida a regra de conversão de data-ex (Yahoo Finance) para data-com (dia útil anterior)."""
    from engine.sources import converter_data_ex_para_data_com

    # Segunda-feira (2026-01-05) -> Sexta-feira anterior (2026-01-02)
    assert converter_data_ex_para_data_com(date(2026, 1, 5)) == date(2026, 1, 2)
    # Terça-feira (2026-01-06) -> Segunda-feira (2026-01-05)
    assert converter_data_ex_para_data_com(date(2026, 1, 6)) == date(2026, 1, 5)
    # Virada de ano: data-ex na quinta 2026-01-01 -> data-com na quarta 2025-12-31
    assert converter_data_ex_para_data_com(date(2026, 1, 1)) == date(2025, 12, 31)


def test_obter_ativos_isola_falha_e_registra_erros_log(tmp_path, monkeypatch):
    """Se um ativo falhar na coleta ou validação Pydantic, registra em erros.log e segue o build."""
    import engine.sources as sources

    def fake_coletar(symbol):
        if symbol == "FALHA3":
            return {"preco": -10.0, "dividendos": [], "fundamentos": {}}
        return {
            "preco": 25.0,
            "dividendos": [
                Dividendo(data_com=date(2024, 5, 10), valor=1.50, tipo="dividendo"),
                Dividendo(data_com=date(2025, 5, 10), valor=1.80, tipo="jcp"),
            ],
            "fundamentos": {"lpa": 4.0, "vpa": 20.0, "ebit": 100.0, "ev": 500.0, "capital_investido": 400.0, "g_perpetuidade": 0.02},
        }

    monkeypatch.setattr(sources, "_coletar_dados_ativo", fake_coletar)
    log_file = tmp_path / "erros.log"

    entradas = [
        {"ticker": "FALHA3", "setor": "energia"},
        {"ticker": "TAEE11", "setor": "energia"},
    ]
    ativos = sources.obter_ativos(entradas, caminho_log=log_file)

    assert len(ativos) == 1
    assert ativos[0].ticker == "TAEE11"
    assert log_file.exists()
    conteudo_log = log_file.read_text(encoding="utf-8")
    assert "FALHA3" in conteudo_log


def test_categoria_demais_papeis_e_tempo_abaixo_teto():
    """Valida classificação 'demais', cálculo de tempo abaixo do teto e alinhamento histórico na Saida."""
    from engine.build import construir_saida
    from engine.valuation import proporcao_abaixo_teto, resolver_categoria_ativo

    assert resolver_categoria_ativo("bancos", None) == "besst"
    assert resolver_categoria_ativo("mineração", None) == "dividendos"
    assert resolver_categoria_ativo("tecnologia e software", "demais") == "demais"

    assert proporcao_abaixo_teto([20.0, 25.0, 30.0, 40.0], 30.0) == pytest.approx(0.75)
    assert proporcao_abaixo_teto([20.0, 25.0], 0.0) is None
    assert proporcao_abaixo_teto([], 30.0) is None

    ativos = [
        Ativo(
            ticker="BBAS3",
            setor="bancos",
            categoria="besst",
            preco=22.0,
            dividendos=[
                Dividendo(data_com=date(2021, 6, 10), valor=2.40, tipo="dividendo"),
                Dividendo(data_com=date(2022, 6, 10), valor=2.40, tipo="dividendo"),
                Dividendo(data_com=date(2023, 6, 10), valor=2.40, tipo="jcp"),
                Dividendo(data_com=date(2024, 6, 10), valor=2.40, tipo="dividendo"),
                Dividendo(data_com=date(2025, 6, 10), valor=2.40, tipo="dividendo"),
            ],
            fundamentos=Fundamentos(lpa=4.5, vpa=28.0, g_perpetuidade=0.03),
            pontos_historico=[
                ("2023-01-02", 18.50),
                ("2024-01-02", 27.00),
                ("2025-01-02", 42.00),
            ],
        ),
        Ativo(
            ticker="PRIO3",
            setor="petróleo e gás",
            categoria="demais",
            preco=41.0,
            dividendos=[],
            fundamentos=Fundamentos(lpa=5.0, vpa=18.0, ebit=800.0, ev=4000.0, capital_investido=3200.0),
            pontos_historico=[
                ("2023-01-02", 35.00),
                ("2025-01-02", 39.50),
            ],
        ),
    ]

    saida = construir_saida(ativos, ano_referencia=2026)
    assert len(saida.historico_datas) >= 3
    bbas = next(a for a in saida.ativos if a.ticker == "BBAS3")
    prio = next(a for a in saida.ativos if a.ticker == "PRIO3")

    assert bbas.categoria == "besst"
    assert prio.categoria == "demais"
    assert len(bbas.historico_precos) == len(saida.historico_datas)
    assert len(prio.historico_precos) == len(saida.historico_datas)
    assert bbas.historico_precos[-1] == pytest.approx(22.0)
    assert prio.historico_precos[-1] == pytest.approx(41.0)
    assert len(bbas.proventos_historico) == 5
    assert bbas.pct_abaixo_teto_5a is not None
    # PRIO3 sem dividendos tem teto Bazin 0, mas Graham e Greenblatt calculados normalmente
    assert prio.bazin.teto == 0.0
    assert prio.pct_abaixo_teto_5a is None
    assert prio.graham is not None and prio.graham > 0
    assert prio.rank_greenblatt == 1


def test_score_sustentabilidade_anti_cilada():
    """Valida os 4 pilares do Score de Sustentabilidade Anti-Cilada (forte, banco, cilada e sem dividendo)."""
    from engine.valuation import avaliar_sustentabilidade

    # 1. Pagadora perene operacional saudável -> Forte (>= 75)
    divs_fortes = [
        Dividendo(data_com=date(2021, 5, 10), valor=2.0, tipo="dividendo"),
        Dividendo(data_com=date(2022, 5, 10), valor=2.1, tipo="dividendo"),
        Dividendo(data_com=date(2023, 5, 10), valor=2.2, tipo="jcp"),
        Dividendo(data_com=date(2024, 5, 10), valor=2.3, tipo="dividendo"),
        Dividendo(data_com=date(2025, 5, 10), valor=2.4, tipo="dividendo"),
    ]
    bazin_forte = avaliar_bazin(divs_fortes, preco=30.0, ano_referencia=2026)
    fund_forte = Fundamentos(lpa=4.2, payout=0.55, div_liq_ebitda=1.4, roe=0.20)
    score_forte = avaliar_sustentabilidade(divs_fortes, bazin_forte, fund_forte, "energia", 2026)
    assert score_forte.nivel == "forte"
    assert score_forte.nota == 100
    assert score_forte.anos_pagos_5a == 5
    assert len(score_forte.pilares) == 4

    # 2. Banco sólido (sem Dív.Líq/EBITDA, avaliado via ROE bancário) -> Forte
    fund_banco = Fundamentos(lpa=5.0, payout=0.45, roe=0.19)
    score_banco = avaliar_sustentabilidade(divs_fortes, bazin_forte, fund_banco, "bancos", 2026)
    assert score_banco.nivel == "forte"
    assert score_banco.nota >= 90

    # 3. Cilada clássica: pagou muito em 2021-2022, secou em 2024-2025, prejuízo e dívida crítica -> Alerta
    divs_cilada = [
        Dividendo(data_com=date(2021, 8, 15), valor=6.0, tipo="dividendo"),
        Dividendo(data_com=date(2022, 8, 15), valor=5.0, tipo="dividendo"),
    ]
    bazin_cilada = avaliar_bazin(divs_cilada, preco=18.0, ano_referencia=2026)
    # Observe que pelo Bazin puro a média 5a = 2.20 -> teto = 36.67 (pareceria "barata"), mas o score detecta a cilada!
    assert bazin_cilada.veredito == "verde"
    fund_cilada = Fundamentos(lpa=-1.5, div_liq_ebitda=5.2, roe=-0.08)
    score_cilada = avaliar_sustentabilidade(divs_cilada, bazin_cilada, fund_cilada, "siderurgia", 2026)
    assert score_cilada.nivel == "alerta"
    assert score_cilada.nota < 50
    assert score_cilada.rotulo == "Risco Cilada"

    # 4. Ação de crescimento sem dividendos nos 5 anos -> sem_dividendo
    bazin_zero = avaliar_bazin([], preco=40.0, ano_referencia=2026)
    score_zero = avaliar_sustentabilidade([], bazin_zero, Fundamentos(lpa=3.0, roe=0.18), "tecnologia", 2026)
    assert score_zero.nivel == "sem_dividendo"
    assert score_zero.nota == 0


def test_consolidar_agenda_proventos_e_sazonalidade():
    """Valida próxima data-com, último provento pago, próximo pagamento, fusão de parcelas e sazonalidade 5a."""
    from engine.valuation import consolidar_agenda_proventos

    ref = date(2026, 10, 29)
    historico = [
        # Sazonalidade recorrente em Maio e Agosto nos últimos anos fechados
        Dividendo(data_com=date(2022, 5, 12), valor=0.50, tipo="dividendo", data_pagamento=date(2022, 5, 28)),
        Dividendo(data_com=date(2022, 8, 12), valor=0.40, tipo="jcp", data_pagamento=date(2022, 8, 28)),
        Dividendo(data_com=date(2023, 5, 11), valor=0.55, tipo="dividendo", data_pagamento=date(2023, 5, 29)),
        Dividendo(data_com=date(2024, 5, 10), valor=0.60, tipo="dividendo", data_pagamento=date(2024, 5, 27)),
        Dividendo(data_com=date(2025, 8, 14), valor=0.45, tipo="jcp", data_pagamento=date(2025, 8, 29)),
        # Último efetivamente PAGO antes de 29/10/2026
        Dividendo(data_com=date(2026, 5, 11), valor=0.56, tipo="jcp", data_pagamento=date(2026, 8, 26)),
        # Já ficou ex-dividendo em 14/08/2026 (duas parcelas na mesma data!), pagamento futuro em 26/11/2026
        Dividendo(data_com=date(2026, 8, 14), valor=0.3595, tipo="jcp", data_pagamento=date(2026, 11, 26)),
        Dividendo(data_com=date(2026, 8, 14), valor=0.2408, tipo="dividendo", data_pagamento=date(2026, 11, 26)),
    ]
    anuncios = [
        # Próxima data-com em aberto (>= 29/10/2026)
        Dividendo(data_com=date(2026, 11, 9), valor=0.19, tipo="jcp", data_pagamento=date(2026, 12, 7)),
    ]

    res = consolidar_agenda_proventos(historico, anuncios, data_referencia=ref, ano_referencia=2026)

    assert res.proxima_data_com is not None
    assert res.proxima_data_com.data_com == date(2026, 11, 9)
    assert res.proxima_data_com.data_pagamento == date(2026, 12, 7)
    assert res.proxima_data_com.status == "anunciado"

    assert res.ultimo_provento_pago is not None
    assert res.ultimo_provento_pago.data_pagamento == date(2026, 8, 26)
    assert res.ultimo_provento_pago.valor == pytest.approx(0.56)
    assert res.ultimo_provento_pago.status == "pago"

    assert res.proximo_pagamento is not None
    assert res.proximo_pagamento.data_pagamento == date(2026, 11, 26)
    assert res.proximo_pagamento.valor == pytest.approx(0.3595 + 0.2408)
    assert res.proximo_pagamento.tipo == "misto"
    assert res.proximo_pagamento.status == "a_pagar"

    assert res.meses_habituais_dividendo == [5, 8]
    assert res.mapa_sazonal_5a["5"] == 3
    assert res.mapa_sazonal_5a["8"] == 2
