# Spec: Devorch Hub

<objective>
Uma página web local (dashboard) onde o usuário acompanha todas as sessões devorch ao vivo e opera o ciclo completo sem abrir o terminal: cria sessão (idea), inicia build com escolha de modelos, acompanha o DAG e os gates, responde conflitos de spec, abre o terminal da sessão embutido e dispara o merge.
</objective>

## Contract: servidor-local
- **Repo**: devorch
- **Behavior**: Servidor Bun em `dashboard/server.ts` serve a página e a API. Lê as sessões de `~/.claude/devorch-sessions/` (override via env `DEVORCH_SESSIONS_DIR` — usado por testes e pelo gate visual com fixtures). Escuta APENAS em 127.0.0.1, porta 7777 (override via env `DEVORCH_HUB_PORT`). Empurra atualizações por SSE alimentado por fs.watch com debounce de ~200ms.
- **Acceptance**:
  - [ ] `bun dashboard/server.ts` sobe e responde `GET /` com a página em <1s
  - [ ] servidor recusa bind fora de 127.0.0.1 (nenhuma config o expõe na LAN)
  - [ ] `GET /api/sessions` devolve as sessões do dir configurado com stage, phases, gates, specConflicts
  - [ ] editar um session.json reflete num evento SSE em ≤1s; 5 gravações em 100ms geram 1 evento
  - [ ] com `DEVORCH_SESSIONS_DIR` apontando para fixtures, a listagem reflete só as fixtures

## Contract: lista-sessoes
- **Repo**: devorch
- **Screens**: `build`, `spec-ready`, `blocked`, `merge`
- **Behavior**: Trilho lateral (desktop) / chips + seletor (mobile) com as sessões agrupadas por urgência: Bloqueadas, Em execução, Prontas para build, Aguardando merge, Concluídas (recolhidas). Cada item mostra nome, indicador do estágio e progresso (fase X/Y ou contagem de conflitos). Selecionar troca o detalhe.
- **Acceptance**:
  - [ ] grupos na ordem Bloqueadas → Em execução → Prontas → Aguardando merge → Concluídas, com contagens corretas
  - [ ] item selecionado destacado; clique troca o detalhe sem reload
  - [ ] sessão que muda de estágio troca de grupo ao vivo via SSE

## Contract: detalhe-por-estagio
- **Repo**: devorch
- **Screens**: `build`, `spec-ready`, `blocked`, `merge`
- **Behavior**: A área de detalhe muda conforme o stage da sessão selecionada: spec-ready → contratos + protótipo + plano projetado + formulário de build; build → raias por repo com cards de fase + linha de gates + faixa de screenshots; blocked-on-spec → cards de conflito no topo com o resto esmaecido; awaiting-merge → veredito + gates + galeria protótipo×build + botão merge.
- **Acceptance**:
  - [ ] cada um dos 4 stages renderiza sua vista conforme as baselines (`build.desktop`, `spec-ready.desktop`, `blocked.desktop`, `merge.desktop`)
  - [ ] cards de fase mostram status (concluída/rodando/aguardando/bloqueada) e contagem de tasks/commits a partir do session.json
  - [ ] em blocked, o conteúdo abaixo do card de conflito fica visualmente secundário (esmaecido)

## Contract: iniciar-build
- **Repo**: devorch
- **Screens**: `spec-ready`
- **Behavior**: Formulário com um seletor de modelo por papel (builder, fixer, explore, visual; valores haiku|sonnet|opus|fable|grok|herdar) pré-preenchido do manifest da sessão. Botão "Iniciar build" faz POST; o servidor cria a janela tmux `devorch-<sessão>` rodando `claude '/devorch build <sessão> --headless --models <mapa>'`.
- **Acceptance**:
  - [ ] POST com janela inexistente cria a janela tmux e devolve ok; o stage da sessão vira build e a página troca para a vista de build
  - [ ] POST repetido (janela já existe OU stage já é build) NÃO cria segunda janela e devolve o estado atual (idempotência coberta por teste)
  - [ ] o mapa de modelos escolhido chega no comando disparado (visível no teste por inspeção do comando gerado)

## Contract: flag-headless
- **Repo**: devorch
- **Behavior**: `/devorch build <sessão> --headless` pula a única pergunta do build (o "mergear agora?" final): com veredito PASS a sessão fica em awaiting-merge sem AskUserQuestion, e o relatório aponta `/devorch merge <sessão>`.
- **Acceptance**:
  - [ ] `commands/devorch.md` documenta a flag no MODE build (B0 aceita, B7 condiciona a pergunta) e o install propaga para `~/.claude/commands/devorch.md`
  - [ ] com `--headless`, nenhum AskUserQuestion entre o início do build e o fim do relatório

## Contract: terminal-embutido
- **Repo**: devorch
- **Screens**: `terminal`
- **Behavior**: Painel deslizante da base (desktop) / folha inteira (mobile) com xterm.js embarcado localmente. O servidor conecta um `Bun.Terminal` (PTY) rodando `tmux attach -r -t devorch-<sessão>` e transmite por WebSocket. Abre somente leitura; "Destravar escrita" reanexa sem `-r` e passa a encaminhar teclado. Resize do painel propaga ao PTY.
- **Acceptance**:
  - [ ] abrir o painel mostra o conteúdo ao vivo da janela tmux da sessão
  - [ ] em modo leitura, teclas não chegam ao tmux (coberto por teste do servidor)
  - [ ] após destravar, entrada de teclado chega (dá para responder um prompt do claude ali)
  - [ ] fechar o painel encerra o attach sem matar a janela tmux
  - [ ] layout conforme baselines `terminal.desktop` e `terminal.mobile`

## Contract: responder-conflito
- **Repo**: devorch
- **Screens**: `blocked`
- **Behavior**: Cada item de `specConflicts` vira um card: contrato, evidência, opções A/B como radio cards (recomendada destacada), campo de nota opcional E a terceira via "Outra resposta" em texto livre. Enviar grava a emenda no `decisions.md` da sessão (opção escolhida + nota, ou o texto livre na íntegra), limpa o conflito do session.json e dispara `claude '/devorch build <sessão> --resume'` na janela tmux.
- **Acceptance**:
  - [ ] card renderiza opções + recomendação + nota + resposta livre conforme baselines `blocked.desktop` / `blocked.mobile`
  - [ ] envio com opção A/B: emenda `## Amendment` aparece no decisions.md com a opção e a nota
  - [ ] envio com resposta livre: o texto vira a emenda na íntegra
  - [ ] após envio, o conflito some da lista e o resume é disparado (idempotente: reenvio não duplica emenda nem janela)

## Contract: merge-pela-pagina
- **Repo**: devorch
- **Screens**: `merge`
- **Behavior**: Vista awaiting-merge mostra veredito, resultado dos gates e galeria protótipo×build lado a lado (tela × viewport, com miniaturas). Botão "Merge" dispara `claude '/devorch merge <sessão>'` na janela tmux e abre o terminal embutido automaticamente (o merge pode perguntar em conflito contraditório).
- **Acceptance**:
  - [ ] galeria carrega os PNGs de `sessionDir/screenshots/final/` pareados com as baselines do protótipo
  - [ ] clique em Merge cria/usa a janela tmux e o painel do terminal abre sozinho
  - [ ] sessão que vira merged sai de Aguardando merge e entra em Concluídas ao vivo

## Contract: nova-sessao-idea
- **Repo**: devorch
- **Behavior**: Botão "Nova sessão" no trilho abre um formulário mínimo (descrição + toggle "com protótipo"). Enviar dispara `claude '/devorch idea "<descrição>" [--prototype]'` numa janela tmux nova e abre o terminal embutido já com escrita destravada — o grill acontece no terminal.
- **Acceptance**:
  - [ ] envio cria a janela tmux com o comando certo (com/sem --prototype conforme o toggle)
  - [ ] o painel do terminal abre com escrita habilitada (sem passo extra de destravar)
  - [ ] a sessão nova aparece na lista assim que o idea cria o session.json
