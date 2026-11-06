#!/usr/bin/env bash
# Orquestrador do motor de atualização do data/valuation.json.
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
WORKFLOW_FILE="${WORKFLOW_FILE:-atualizar-valuation.yml}"
INTERVALO="${INTERVALO:-600}"                    # 10 min entre ciclos (≤ 6 deploys/h no Pages)
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

sincronizar() {
  git fetch -q origin "$BRANCH" && git reset -q --hard "origin/$BRANCH"
}

publicar() {
  local rotulo="$1"
  if git diff --quiet -- data/valuation.json; then
    log "Sem alterações em data/valuation.json ($rotulo)."
    return 0
  fi
  git add data/valuation.json
  git commit -q -m "chore: atualiza data/valuation.json ($rotulo $(date -u +%H:%M) UTC)"
  for tentativa in 1 2 3; do
    if ! git pull -q --rebase -X theirs origin "$BRANCH"; then
      git rebase --abort 2>/dev/null || true
    fi
    if git push -q origin "HEAD:$BRANCH"; then
      log "Publicado ($rotulo)."
      return 0
    fi
    log "Push falhou (tentativa $tentativa/3); nova tentativa em 5 s."
    sleep 5
  done
  echo "::warning::Não foi possível publicar o ciclo ($rotulo); o próximo ciclo tenta de novo."
  sincronizar || true
  return 1
}

build_completo() {
  log "Build completo..."
  if python -m engine.build; then
    publicar "completo"
    return 0
  fi
  echo "::warning::Build completo falhou."
  git checkout -q -- data/valuation.json 2>/dev/null || true
  return 1
}

build_cotacoes() {
  log "Ciclo rápido de cotações..."
  if python -m engine.build --cotacoes; then
    publicar "cotações"
    return 0
  fi
  echo "::warning::Ciclo de cotações falhou."
  git checkout -q -- data/valuation.json 2>/dev/null || true
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
