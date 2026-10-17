# PROJETO.md

## CONTEXTO
- Site estático publicado via GitHub Pages (repo `ezdourado/invest`).
- Objetivo: calculadora e painel de valuation de ações da B3 (Bazin, Graham, Gordon, Greenblatt), alimentado por um JSON gerado por um motor em Python.
- Arquitetura: engine Python gera `data/valuation.json`; o frontend só lê esse JSON.

## REGRAS DE VALUATION (não negociáveis)
- Bazin: K = 6% sempre, em qualquer cálculo.
- DPA retroativo: dividendos reais agrupados por ano civil da data-com, média dos últimos 5 anos fechados. Nunca derivar de DY x preço atual nem de LPA x payout.
- Margem de segurança = (teto - preço) / teto (teto no denominador).
- Bonificações nunca entram no DPA.
- Dividendos extraordinários: calcular DPA com e sem eles e sinalizar.
- Bazin projetivo: apenas direcional, nunca entra no veredito.
- Graham: referência secundária para financeiras e holdings.
- Greenblatt: ranking sobre o universo; bancos ficam fora do ranking (EBIT/EV não se aplica), registrando o motivo.
- Filtro setorial BESST: é atributo e agregação de cobertura por setor (bancos, energia, saneamento, seguros, telecom), não descarta ativos.

## PADRÕES
- Frontend: HTML/CSS/JS puros, sem build step; tema escuro, fontes IBM Plex Mono/Sans; vereditos em verde/amarelo/vermelho.
- Caminhos relativos (`./assets/...`), pois o Pages serve em subpasta.
- Python 3.12, Pydantic v2, funções de valuation puras e testadas (`pytest`).
- Um commit por etapa, mensagem em português no formato `"tipo: descrição"`.
