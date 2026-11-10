"""Script de geração do arquivo estático data/valuation.json a partir de dados reais (engine/sources.py)."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from engine.schemas import Ativo, Dividendo, PontoLucro, ResultadoAtivo, Saida, SnapshotAnterior
from engine.sources import (
    CAMINHO_TICKERS_PADRAO,
    carregar_tickers_json,
    coletar_benchmarks_historico,
    coletar_cotacoes_lote,
    obter_ativos,
)
from engine.valuation import (
    avaliar_bazin,
    avaliar_sustentabilidade,
    consolidar_agenda_proventos,
    eh_setor_besst,
    gordon,
    graham,
    dpa_ultimos_12m,
    margem,
    proporcao_abaixo_teto_dinamico,
    ranking_greenblatt,
    teto_por_mes_historico,
    resolver_categoria_ativo,
    veredito_bazin,
)

TAXA_DESCONTO_GORDON_PADRAO: float = 0.10
FUSO_B3 = timezone(timedelta(hours=-3))


def _compactar_vetores_historico(json_str: str) -> str:
    """Mantém objetos indentados para diff limpo no Git, compactando vetores planos de histórico em linha única."""

    def _colapsar(match: re.Match[str]) -> str:
        prefixo, miolo, sufixo = match.group(1), match.group(2), match.group(3)
        itens = "".join(linha.strip() for linha in miolo.splitlines())
        return f"{prefixo}{itens}{sufixo}"

    compactado = re.sub(
        r'("(?:historico_datas|historico_precos|meses_habituais_dividendo|CDI|IPCA|WRLD11|MUND11|B5P211)": \[)\s*([^\[\]\{\}]*?)\s*(\])',
        _colapsar,
        json_str,
    )
    compactado = re.sub(
        r'\{\s+("data_com": "[^"]+",)\s+("valor": [0-9.eE+-]+,)\s+("tipo": "[^"]+",)\s+("data_pagamento": (?:"[^"]+"|null))\s+\}',
        r'{ \1 \2 \3 \4 }',
        compactado,
    )
    compactado = re.sub(
        r'("(?:por_ano|por_ano_total|anos_atipicos|teto_por_ano|teto_por_mes)": \{)([^\{\}]*?)(\})',
        lambda m: m.group(1) + " ".join(l.strip() for l in m.group(2).splitlines() if l.strip()) + m.group(3),
        compactado,
    )
    compactado = re.sub(
        r'\{\s+("fim": "[^"]+",[^\{\}]*?"na_janela": (?:true|false))\s+\}',
        lambda m: '{ ' + re.sub(r'\s+', ' ', m.group(1).strip()) + ' }',
        compactado,
    )
    return re.sub(
        r'\{\s+("ano": \d+,[\s\S]*?"tipo": "[^"]+")\s+\}',
        lambda m: '{ ' + re.sub(r'\s+', ' ', m.group(1).strip()) + ' }',
        compactado,
    )


def payout_medio_historico(
    dpa_recorrente_5a: float,
    historico_lucros: list[PontoLucro],
    lpa_atual: Optional[float],
) -> float:
    """Payout de longo prazo = DPA recorrente médio ÷ LPA médio dos anos fechados disponíveis.

    Usa os LPAs anuais do histórico (até 5); sem pelo menos 2 anos positivos, cai para
    DPA 5a ÷ LPA atual. O resultado é limitado a [25%, 95%] para evitar projeções absurdas
    em anos de lucro deprimido; sem dados, assume 50%.
    """
    lpas = [p.lpa for p in historico_lucros if p.tipo == "anual" and p.lpa is not None]
    lpas = lpas[-5:]
    base: Optional[float] = None
    if len(lpas) >= 2 and sum(lpas) / len(lpas) > 0:
        base = dpa_recorrente_5a / (sum(lpas) / len(lpas))
    elif lpa_atual is not None and lpa_atual > 0:
        base = dpa_recorrente_5a / lpa_atual
    if base is None or base <= 0:
        return 0.50
    return round(max(0.25, min(0.95, base)), 4)


def construir_saida(
    ativos: list[Ativo],
    ano_referencia: int | None = None,
    taxa_desconto_gordon: float = TAXA_DESCONTO_GORDON_PADRAO,
    data_referencia: date | None = None,
    benchmarks_historico: dict[str, list[Optional[float]]] | None = None,
) -> Saida:
    """Calcula valuation completo para a lista de Ativo e retorna o objeto Saida validado."""
    agora = datetime.now(timezone.utc)
    hoje_b3 = data_referencia if data_referencia is not None else datetime.now(FUSO_B3).date()
    ano_ref = ano_referencia if ano_referencia is not None else hoje_b3.year
    data_corte_proventos = date(ano_ref - 10, 1, 1)
    data_corte_5a_iso = date(ano_ref - 5, hoje_b3.month, min(hoje_b3.day, 28)).isoformat()

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
        hoje_iso = hoje_b3.isoformat()
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
            data_referencia=hoje_b3,
        )
        tetos_mes = teto_por_mes_historico(ativo.dividendos, inicio=date(ano_ref - 10, 1, 1), fim=hoje_b3)
        bazin_res = bazin_res.model_copy(update={"teto_por_mes": tetos_mes})

        vi_graham = graham(ativo.fundamentos.lpa, ativo.fundamentos.vpa)
        m_graham = margem(vi_graham, ativo.preco) if vi_graham is not None else None

        gb_info = mapa_greenblatt.get(ativo.ticker)
        f = ativo.fundamentos

        # Payout calculado internamente: proventos com data-com nos últimos 12 meses ÷ LPA 12m
        # (Fundamentus). O `payoutRatio` do Yahoo para a B3 é inconsistente (ex.: 1.684% na VALE3).
        total_12m, _ = dpa_ultimos_12m(ativo.dividendos, hoje_b3)
        payout_calc: Optional[float] = None
        if f.lpa is not None and f.lpa > 0:
            payout_calc = round(total_12m / f.lpa, 4)

        g_calc = f.g_perpetuidade
        if f.roe is not None and f.roe > 0 and payout_calc is not None and 0 <= payout_calc < 1:
            g_calc = min(0.045, max(0.0, round(f.roe * (1 - payout_calc), 4)))

        preco_gordon = gordon(
            dpa=bazin_res.dpa_sem_extra,
            taxa_desconto=taxa_desconto_gordon,
            g_perpetuidade=g_calc,
        )
        m_gordon = margem(preco_gordon, ativo.preco) if preco_gordon is not None else None

        # Projeção de Tetos (direcional, nunca entra no veredito): lucro × payout MÉDIO histórico.
        # Não pode usar o payout de 12 meses: LPA × (DPA 12m ÷ LPA) devolveria o próprio DPA 12m.
        payout_base = payout_medio_historico(
            dpa_recorrente_5a=bazin_res.dpa_sem_extra,
            historico_lucros=ativo.historico_lucros,
            lpa_atual=f.lpa,
        )

        # 1. Consenso Mercado (forward_eps * payout)
        dpa_consenso = None
        teto_consenso = None
        m_consenso = None
        if f.forward_eps is not None and f.forward_eps > 0:
            dpa_consenso = round(f.forward_eps * payout_base, 4)
            if dpa_consenso > 0:
                teto_consenso = round(dpa_consenso / 0.06, 2)
                m_consenso = margem(teto_consenso, ativo.preco)

        # 2. Fundamentalista Barsi/AGF ((VPA * ROE) * payout)
        dpa_barsi = None
        teto_barsi = None
        m_barsi = None
        if f.vpa is not None and f.roe is not None and f.vpa > 0 and f.roe > 0:
            lpa_barsi = f.vpa * f.roe
            dpa_barsi = round(lpa_barsi * payout_base, 4)
            if dpa_barsi > 0:
                teto_barsi = round(dpa_barsi / 0.06, 2)
                m_barsi = margem(teto_barsi, ativo.preco)

        bazin_completo = bazin_res.model_copy(update={
            "dpa_projetado_consenso": dpa_consenso,
            "teto_projetado_consenso": teto_consenso,
            "margem_projetada_consenso": m_consenso,
            "dpa_projetado_barsi": dpa_barsi,
            "teto_projetado_barsi": teto_barsi,
            "margem_projetada_barsi": m_barsi,
        })

        fund_out = f.model_copy(update={"payout": payout_calc, "g_perpetuidade": g_calc})
        categoria_resolvida = resolver_categoria_ativo(ativo.setor, ativo.categoria)

        sustentabilidade = avaliar_sustentabilidade(
            dividendos=ativo.dividendos,
            bazin_res=bazin_res,
            fundamentos=fund_out,
            setor=ativo.setor,
            ano_referencia=ano_ref,
        )

        agenda_res = consolidar_agenda_proventos(
            dividendos=ativo.dividendos,
            anuncios_agenda=ativo.anuncios_agenda,
            data_referencia=hoje_b3,
            ano_referencia=ano_ref,
        )

        mp_ativo = mapas_pontos.get(ativo.ticker)
        serie_alinhada: list[Optional[float]] = []
        pontos_5a: list[tuple[str, Optional[float]]] = []
        if historico_datas and mp_ativo:
            ultimo_conhecido: Optional[float] = None
            for dt_iso in historico_datas:
                if dt_iso in mp_ativo:
                    ultimo_conhecido = mp_ativo[dt_iso]
                serie_alinhada.append(ultimo_conhecido)
                if dt_iso >= data_corte_5a_iso:
                    pontos_5a.append((dt_iso, ultimo_conhecido))

        # Cada cotação é comparada ao teto vigente na sua própria data (não ao teto de hoje).
        pct_abaixo = proporcao_abaixo_teto_dinamico(pontos_5a, tetos_mes) if pontos_5a else None

        proventos_5a = sorted(
            [
                Dividendo(
                    data_com=d.data_com,
                    valor=round(float(d.valor), 6),
                    tipo=d.tipo,
                    data_pagamento=d.data_pagamento,
                )
                for d in ativo.dividendos
                if data_corte_proventos <= d.data_com <= hoje_b3 and round(float(d.valor), 6) > 0
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
                bazin=bazin_completo,
                teto_consenso=teto_consenso,
                margem_consenso=m_consenso,
                teto_barsi=teto_barsi,
                margem_barsi=m_barsi,
                graham=vi_graham,
                margem_graham=m_graham,
                gordon=preco_gordon,
                margem_gordon=m_gordon,
                rank_greenblatt=gb_info.rank if gb_info else None,
                motivo_exclusao_greenblatt=gb_info.motivo_exclusao if gb_info else None,
                sustentabilidade=sustentabilidade,
                proxima_data_com=agenda_res.proxima_data_com,
                ultimo_provento_pago=agenda_res.ultimo_provento_pago,
                proximo_pagamento=agenda_res.proximo_pagamento,
                agenda_anunciada=agenda_res.agenda_anunciada,
                meses_habituais_dividendo=agenda_res.meses_habituais_dividendo,
                mapa_sazonal_5a=agenda_res.mapa_sazonal_5a,
                fundamentos=fund_out,
                pct_abaixo_teto_5a=pct_abaixo,
                historico_precos=serie_alinhada,
                proventos_historico=proventos_5a,
                historico_lucros=ativo.historico_lucros,
            )
        )

    return Saida(
        schema_version="1.0",
        gerado_em=agora,
        historico_datas=historico_datas,
        benchmarks_historico=benchmarks_historico or {},
        ativos=resultados,
    )


def aplicar_cotacoes(
    saida: Saida,
    cotacoes: dict[str, tuple[float, date]],
    agora: datetime | None = None,
) -> Saida:
    """Atualiza apenas preços e métricas derivadas do preço em uma Saida já calculada.

    Usado no ciclo rápido intradiário: DPA, tetos, proventos e fundamentos contábeis
    permanecem os do último build completo; só o que depende da cotação é recalculado
    (margens, veredito, P/L, P/VP e o último ponto da série histórica).
    Ativos sem cotação nova mantêm os valores anteriores.
    """
    momento = agora if agora is not None else datetime.now(timezone.utc)
    hoje_iso = momento.astimezone(FUSO_B3).date().isoformat()

    datas = list(saida.historico_datas)
    anexar_data = bool(datas) and hoje_iso > datas[-1]
    if anexar_data:
        datas.append(hoje_iso)

    novos_ativos: list[ResultadoAtivo] = []
    for a in saida.ativos:
        cot = cotacoes.get(a.ticker)
        serie = list(a.historico_precos)
        if anexar_data and serie:
            serie.append(serie[-1])

        if cot is None or not cot[0] or cot[0] <= 0:
            novos_ativos.append(a.model_copy(update={"historico_precos": serie}))
            continue

        preco = round(float(cot[0]), 4)
        data_cot = cot[1].strftime("%d/%m/%Y")
        if serie:
            serie[-1] = round(preco, 2)

        b = a.bazin
        bazin_novo = b.model_copy(update={
            "margem_seguranca": margem(b.teto, preco),
            "veredito": veredito_bazin(b.teto, preco),
            "margem_projetada_consenso": margem(b.teto_projetado_consenso, preco) if b.teto_projetado_consenso else None,
            "margem_projetada_barsi": margem(b.teto_projetado_barsi, preco) if b.teto_projetado_barsi else None,
            "margem_12m": margem(b.teto_12m, preco) if b.teto_12m else None,
        })

        fund = a.fundamentos
        if fund is not None:
            upd_f: dict[str, Any] = {"data_ult_cot": data_cot}
            if fund.lpa:
                upd_f["pl"] = round(preco / fund.lpa, 2)
            if fund.vpa and fund.vpa > 0:
                upd_f["pvp"] = round(preco / fund.vpa, 2)
            fund = fund.model_copy(update=upd_f)

        novos_ativos.append(a.model_copy(update={
            "preco": preco,
            "data_ult_cot": data_cot,
            "fundamentos": fund,
            "bazin": bazin_novo,
            "margem_consenso": margem(a.teto_consenso, preco) if a.teto_consenso else None,
            "margem_barsi": margem(a.teto_barsi, preco) if a.teto_barsi else None,
            "margem_graham": margem(a.graham, preco) if a.graham else None,
            "margem_gordon": margem(a.gordon, preco) if a.gordon else None,
            "historico_precos": serie,
        }))

    benchmarks = {k: list(v) for k, v in saida.benchmarks_historico.items()}
    if anexar_data:
        for k, v in benchmarks.items():
            if v:
                v.append(v[-1])

    return saida.model_copy(update={
        "gerado_em": momento,
        "historico_datas": datas,
        "benchmarks_historico": benchmarks,
        "ativos": novos_ativos,
    })


def aplicar_snapshot_anterior(
    nova: Saida,
    existente: Optional[Saida],
    agora: datetime | None = None,
) -> Saida:
    """Preenche `anterior` de cada ativo com o estado do último pregão anterior a hoje.

    Se a base existente foi gerada num dia anterior (horário B3), o estado dela vira o
    "anterior". Se foi gerada hoje, o "anterior" dela é mantido. Assim o painel compara
    sempre com o fechamento do pregão anterior, qualquer que seja a hora do ciclo.
    """
    if existente is None:
        return nova
    momento = agora if agora is not None else datetime.now(timezone.utc)
    hoje = momento.astimezone(FUSO_B3).date()
    dia_existente = existente.gerado_em.astimezone(FUSO_B3).date()
    mapa = {a.ticker: a for a in existente.ativos}

    ativos: list[ResultadoAtivo] = []
    for a in nova.ativos:
        ant = mapa.get(a.ticker)
        snap: Optional[SnapshotAnterior] = None
        if ant is not None:
            if dia_existente < hoje:
                snap = SnapshotAnterior(
                    data=dia_existente,
                    preco=ant.preco,
                    teto=ant.bazin.teto,
                    veredito=ant.bazin.veredito,
                    margem=ant.bazin.margem_seguranca,
                )
            else:
                snap = ant.anterior
        ativos.append(a.model_copy(update={"anterior": snap}))
    return nova.model_copy(update={"ativos": ativos})


def _ler_saida_existente(caminho: Path) -> Optional[Saida]:
    try:
        return Saida.model_validate_json(caminho.read_text(encoding="utf-8"))
    except Exception:
        return None


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
    parser.add_argument(
        "--cotacoes",
        action="store_true",
        help="Ciclo rápido: atualiza só as cotações (e métricas derivadas) do data/valuation.json existente.",
    )
    args = parser.parse_args()

    raiz_projeto = Path(__file__).resolve().parent.parent
    caminho_saida = raiz_projeto / "data" / "valuation.json"

    if args.cotacoes:
        saida_atual = Saida.model_validate_json(caminho_saida.read_text(encoding="utf-8"))
        cotacoes = coletar_cotacoes_lote([a.ticker for a in saida_atual.ativos])
        if not cotacoes:
            raise RuntimeError("Nenhuma cotação obtida no ciclo rápido; arquivo mantido sem alterações.")
        saida = aplicar_cotacoes(saida_atual, cotacoes)
        saida = aplicar_snapshot_anterior(saida, saida_atual)
        saida_validada = Saida.model_validate(saida.model_dump(mode="json"))
        caminho_saida.write_text(serializar_saida(saida_validada), encoding="utf-8")
        print(f"Cotações atualizadas: {len(cotacoes)}/{len(saida_atual.ativos)} ativos ({caminho_saida})")
        return

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
    saida = aplicar_snapshot_anterior(saida, _ler_saida_existente(caminho_saida))
    if not args.offline and saida.historico_datas:
        try:
            benches = coletar_benchmarks_historico(saida.historico_datas)
            saida = saida.model_copy(update={"benchmarks_historico": benches})
        except Exception:
            pass
    saida_validada = Saida.model_validate(saida.model_dump(mode="json"))

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)
    caminho_saida.write_text(
        serializar_saida(saida_validada),
        encoding="utf-8",
    )
    print(f"Arquivo gerado com sucesso: {caminho_saida} ({len(saida_validada.ativos)} ativos reais)")


if __name__ == "__main__":
    main()
