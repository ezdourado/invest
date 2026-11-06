#!/usr/bin/env bash
# Orquestrador do motor de atualização do data/valuation.json.
# Publica no branch `dados` (ver publicar()); o código vem sempre da main.
# O workflow executa uma CÓPIA deste arquivo: sincronizar() faz `git reset --hard`, e o bash
# lê scripts aos poucos, então alterar o arquivo em execução poderia corromper o processo.
#
# Modos (variável MODO):
#   sessao     -> laço contínuo durante o pregão: ciclo rápido de cotações a cada INTERVALO
#                 e build completo a cada INTERVALO_COMPLETO. Ao fim da janela, faz o
#                 fechamento consolidado. Perto do limite de 6 h do runner, dispara a
#                 própria continuação (workflow_dispatch) e encerra.
#   completo   -> um build completo (cotações + proventos + fundamentos) e publica.
#   cotacoes   -> um ciclo rápido de cotações e publica.
#
# Disparos agendados que chegam fora da janela do pregão (o GitHub atrasa crons por horas)
# saem sem fazer nada, evitando commits inúteis de madrugada.

set -uo pipefail

BRANCH="${BRANCH:-main}"
DATA_BRANCH="${DATA_BRANCH:-dados}"
WORKFLOW_FILE="${WORKFLOW_FILE:-atualizar-valuation.yml}"
INTERVALO="${INTERVALO:-600}"                    # 10 min entre ciclos (delay da fonte já é ~15 min)
INTERVALO_COMPLETO="${INTERVALO_COMPLETO:-3600}" # build completo a cada 60 min
LIMITE_JOB="${LIMITE_JOB:-19800}"                # 5h30: margem antes do teto de 6 h do runner
JANELA_INICIO="${JANELA_INICIO:-0955}"           # horário de Brasília (HHMM)
JANELA_FIM="${JANELA_FIM:-1815}"

INICIO_JOB=$(date +%s)

log() { echo "[$(TZ=America/Sao_Paulo date +'%d/%m %H:%M:%S') BRT] $*"; }

em_janela() {
  local dow hm
  dow=$(TZ=America/Sao_Paulo date +%u)
  hm=$(TZ=America/Sao_Paulo date +%H%M)
  [ "$dow" -le 5 ] && [ "$((10#$hm))" -ge "$((10#$JANELA_INICIO))" ] && [ "$((10#$hm))" -lt "$((10#$JANELA_FIM))" ]
}

# Os dados vão para o branch `dados` (um único commit, sobrescrito a cada ciclo), e não para a
# `main`: assim cada atualização não dispara um deploy do GitHub Pages (que tem limite de
# ~10 builds/hora e enviava e-mail de falha a cada ciclo) nem incha o histórico da main.
# O site lê o JSON fresco via raw.githubusercontent.com/<repo>/dados/data/valuation.json.
ARQ_DADOS="data/valuation.json"

sincronizar() {
  # Código: sempre a main mais recente. Dados: a última versão publicada no branch de dados.
  git fetch -q origin "$BRANCH" && git reset -q --hard "origin/$BRANCH" || return 1
  if git fetch -q origin "+refs/heads/$DATA_BRANCH:refs/remotes/origin/$DATA_BRANCH" 2>/dev/null; then
    git show "origin/$DATA_BRANCH:$ARQ_DADOS" > "$ARQ_DADOS.tmp" && mv "$ARQ_DADOS.tmp" "$ARQ_DADOS"
  fi
  rm -f "$ARQ_DADOS.tmp"
  return 0
}

restaurar_dados() {
  # Volta o arquivo de trabalho para a última versão publicada (após um build que falhou no meio).
  git show "origin/$DATA_BRANCH:$ARQ_DADOS" > "$ARQ_DADOS.tmp" 2>/dev/null && mv "$ARQ_DADOS.tmp" "$ARQ_DADOS"
  rm -f "$ARQ_DADOS.tmp"
  return 0
}

publicar() {
  local rotulo="$1" blob atual idx tree commit
  blob=$(git hash-object -w "$ARQ_DADOS") || return 1
  atual=$(git rev-parse -q --verify "origin/$DATA_BRANCH:$ARQ_DADOS" 2>/dev/null || true)
  if [ "$blob" = "$atual" ]; then
    log "Sem alterações em $ARQ_DADOS ($rotulo)."
    return 0
  fi
  idx=$(mktemp)
  rm -f "$idx"
  GIT_INDEX_FILE="$idx" git read-tree --empty
  GIT_INDEX_FILE="$idx" git update-index --add --cacheinfo "100644,$blob,$ARQ_DADOS"
  tree=$(GIT_INDEX_FILE="$idx" git write-tree)
  rm -f "$idx"
  commit=$(git commit-tree "$tree" -m "dados: valuation.json ($rotulo $(date -u +%H:%M) UTC)")
  for tentativa in 1 2 3; do
    if git push -q -f origin "$commit:refs/heads/$DATA_BRANCH"; then
      git update-ref "refs/remotes/origin/$DATA_BRANCH" "$commit"
      log "Publicado no branch $DATA_BRANCH ($rotulo)."
      return 0
    fi
    log "Push falhou (tentativa $tentativa/3); nova tentativa em 5 s."
    sleep 5
  done
  echo "::warning::Não foi possível publicar o ciclo ($rotulo); o próximo ciclo tenta de novo."
  return 1
}

build_completo() {
  log "Build completo..."
  if python -m engine.build; then
    publicar "completo"
    return 0
  fi
  echo "::warning::Build completo falhou."
  restaurar_dados
  return 1
}

build_cotacoes() {
  log "Ciclo rápido de cotações..."
  if python -m engine.build --cotacoes; then
    publicar "cotações"
    return 0
  fi
  echo "::warning::Ciclo de cotações falhou."
  restaurar_dados
  return 1
}

disparar_continuacao() {
  log "Perto do limite do runner: disparando a continuação da sessão."
  if gh workflow run "$WORKFLOW_FILE" --ref "$BRANCH" -f modo=sessao; then
    log "Continuação disparada."
  else
    echo "::warning::Falha ao disparar a continuação; os crons de redundância retomam a sessão."
  fi
}

executar_sessao() {
  local ultimo_completo=0 inicio_ciclo agora espera
  log "Sessão iniciada (janela ${JANELA_INICIO}–${JANELA_FIM} BRT, ciclo ${INTERVALO}s)."
  while em_janela; do
    inicio_ciclo=$(date +%s)
    if [ $((inicio_ciclo - INICIO_JOB)) -ge "$LIMITE_JOB" ]; then
      disparar_continuacao
      return 0
    fi

    sincronizar || log "Aviso: falha ao sincronizar com origin/$BRANCH."

    if [ $((inicio_ciclo - ultimo_completo)) -ge "$INTERVALO_COMPLETO" ]; then
      if build_completo; then
        ultimo_completo=$inicio_ciclo
      else
        build_cotacoes || true
      fi
    else
      build_cotacoes || { build_completo && ultimo_completo=$inicio_ciclo; }
    fi

    agora=$(date +%s)
    espera=$((INTERVALO - (agora - inicio_ciclo)))
    if [ "$espera" -gt 0 ]; then
      sleep "$espera"
    fi
  done

  log "Janela do pregão encerrada: fechamento consolidado."
  sincronizar || true
  build_completo
}

MODO="${MODO:-sessao}"
log "Evento: ${EVENT_NAME:-?} · modo: $MODO"

case "$MODO" in
  sessao)
    if em_janela; then
      executar_sessao
    elif [ "${EVENT_NAME:-}" = "workflow_dispatch" ]; then
      log "Fora da janela do pregão: executando um build completo único."
      sincronizar || true
      build_completo
    else
      log "Disparo agendado fora da janela do pregão (provável atraso do GitHub): nada a fazer."
    fi
    ;;
  completo)
    sincronizar || true
    build_completo
    ;;
  cotacoes)
    sincronizar || true
    build_cotacoes
    ;;
  *)
    echo "::error::Modo desconhecido: $MODO"
    exit 1
    ;;
esac
exit 0
