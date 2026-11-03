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
- Frontend: HTML/CSS/JS puros, sem build step e sem dependências externas; caminhos relativos (`./assets/...`).
- Design System: Personalidade sóbria, calma, densa e precisa (nível Linear, Stripe Dashboard e TradingView).
- Tipografia: Fonte única Inter (variável woff2 auto-hospedada em `./assets/fonts`, subset latin, `font-display: swap`). Números SEMPRE em `tabular-nums` alinhados à direita. Escala estrita: 12 / 13 / 14 / 16 / 20 / 28px, pesos 400/500/600 apenas (sem texto abaixo de 12px).
- Temas: Escuro padrão (`~#0F1217`) e Claro de primeira classe (`~#F6F7F9`); segue `prefers-color-scheme` no primeiro acesso e persiste em `localStorage` sem flash de tela.
- Cores de Veredito: Verde, amarelo e vermelho dessaturados (`~#3FB68B`, `~#E0A93B`, `~#E5645A`), diferenciados por luminosidade, ícone e rótulo explícito, com preenchimento sutil (pouca cor). Sinal técnico separado em tom neutro.
- Layout: Padrão master-detail (lista + detalhe à direita) otimizado para sessões longas de análise; paleta de comandos (Ctrl+K); densidade Confortável/Compacta memorizada.
- Python 3.12, Pydantic v2, funções de valuation puras e testadas (`pytest`).
- Um commit por etapa, mensagem em português no formato `"tipo: descrição"`.
