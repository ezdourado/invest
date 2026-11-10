# PROJETO.md

## CONTEXTO
- Site estático publicado via GitHub Pages (repo `ezdourado/invest`).
- Objetivo: calculadora e painel de valuation de ações da B3 (Bazin, Graham, Gordon, Greenblatt), alimentado por um JSON gerado por um motor em Python.
- Arquitetura: engine Python gera `data/valuation.json`; o frontend só lê esse JSON.

## REGRAS DE VALUATION (não negociáveis)
- Bazin: K = 6% sempre, em qualquer cálculo.
- DPA retroativo (base do teto): dividendos reais declarados (data-com) nos **últimos 60 meses corridos** até hoje, ÷ 5. Agrupados em 5 blocos de 12 meses para detectar períodos atípicos. Substituiu os "5 anos civis fechados" (decisão de 10/11/2026): agrupar por ano civil fazia a data-com de um JCP complementar (ex.: 06/01) mudar o ano em que o provento conta, e ignorava os pagamentos do ano em curso. Nunca derivar de DY x preço atual nem de LPA x payout.
- DY (o número exibido como "DY" em todo o painel): **real dos últimos 12 meses, bruto** = proventos com data-com nos últimos 12 meses ÷ cotação, calculado pelo motor. A média de 5 anos aparece sempre com o nome "DY médio 5a"; nunca rotular média, projeção ou valor líquido de IR como "DY".
- Lente de extraordinários: o usuário pode incluir extraordinários na visualização (teto, margem, DPA, DY). O veredito oficial é sempre sem extraordinários; com a lente ligada o painel avisa.
- Margem de segurança = (teto - preço) / teto (teto no denominador).
- Bonificações nunca entram no DPA.
- Dividendos extraordinários: calcular DPA com e sem eles e sinalizar.
  - Como a fonte quase nunca rotula extraordinários, um bloco de 12 meses da janela cujo total recorrente supere 2× a mediana dos blocos pagos (mínimo 3 blocos pagos) é "período atípico": o excedente sobre a mediana sai do DPA sem extra e é exibido como extraordinário.
- Teto histórico: o teto vigente em cada mês usa a mesma regra do teto atual (60 meses até o fim do mês anterior, períodos atípicos normalizados). "Tempo abaixo do teto" compara cada cotação com o teto vigente no seu mês.
- Payout: calculado internamente = proventos com data-com nos últimos 12 meses ÷ LPA 12m. Nunca usar `payoutRatio` do Yahoo.
- DPA 12m e "Teto 12 meses": checagem de realidade do teto de 5 anos; nunca entram no veredito. Razão DPA 12m ÷ DPA 5a < 70% sinaliza dividendo recente em queda.
- Teto pelo lucro: LPA atual × payout médio histórico (DPA 5a ÷ LPA médio anual, limitado a 25%–95%); direcional, nunca entra no veredito.
- Bazin projetivo: apenas direcional, nunca entra no veredito.
- Graham: referência secundária para financeiras e holdings.
- Greenblatt: ranking sobre o universo; bancos ficam fora do ranking (EBIT/EV não se aplica), registrando o motivo.
- Filtro setorial BESST: é atributo e agregação de cobertura por setor (bancos, energia, saneamento, seguros, telecom), não descarta ativos.

## ARQUITETURA
- Motor (`engine/`): única fonte de cálculo de valuation. Publica `data/valuation.json` no branch `dados` (um commit sobrescrito por ciclo), nunca na `main`, para não disparar deploy do Pages. Orquestração em `.github/scripts/motor.sh` (sessão contínua no pregão; ciclo rápido de cotações a cada 10 min e build completo a cada hora).
- Frontend (scripts clássicos, nesta ordem de carga):
  - `nucleo.js`: formatação, datas no fuso da B3, armazenamento local. Sem regras de negócio.
  - `regras.js`: leitura das regras (faixas de cor, BESST, filtros de qualidade, triagens, análise técnica). Funções puras sobre o payload; não recalcula valuation.
  - `fonte_dados.js`: busca do JSON (branch `dados` via raw.githubusercontent.com, fallback Pages).
  - `data.js`: estado, tabela, cards, detalhe e paleta de comandos.
  - `visao_grafica.js`, `matriz_calendario.js`, `carteira.js`: uma aba cada.
- O navegador só recalcula o que depende do preço (margens). Teto, DPA, payout e teto histórico vêm prontos do motor.
- Modelos de referência (Gordon, Consenso, Greenblatt) ficam recolhidos/ocultos por padrão e nunca entram no veredito.
- Calculadora (`CalculadoraBazin.html`): preenche dados a partir do mesmo JSON do painel. Nenhuma chave de API no cliente.

## PADRÕES
- Frontend: HTML/CSS/JS puros, sem build step e sem dependências externas; caminhos relativos (`./assets/...`).
- Design System: Personalidade sóbria, calma, densa e precisa (nível Linear, Stripe Dashboard e TradingView).
- Tipografia: Fonte única Inter (variável woff2 auto-hospedada em `./assets/fonts`, subset latin, `font-display: swap`). Números SEMPRE em `tabular-nums` alinhados à direita. Escala estrita: 12 / 13 / 14 / 16 / 20 / 28px, pesos 400/500/600 apenas (sem texto abaixo de 12px).
- Temas: Escuro padrão (`~#0F1217`) e Claro de primeira classe (`~#F6F7F9`); segue `prefers-color-scheme` no primeiro acesso e persiste em `localStorage` sem flash de tela.
- Cores de Veredito: Verde, amarelo e vermelho dessaturados (`~#3FB68B`, `~#E0A93B`, `~#E5645A`), diferenciados por luminosidade, ícone e rótulo explícito, com preenchimento sutil (pouca cor). Sinal técnico separado em tom neutro.
- Layout: Padrão master-detail (lista + detalhe à direita) otimizado para sessões longas de análise; paleta de comandos (Ctrl+K); densidade Confortável/Compacta memorizada.
- Python 3.12, Pydantic v2, funções de valuation puras e testadas (`pytest`).
- Um commit por etapa, mensagem em português no formato `"tipo: descrição"`.
