# ClaudeSync

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md)

ClaudeSync mostra e organiza listas locais de sessões do Claude Code entre contas no mesmo computador. Gratuito, com uso próprio como prioridade. TypeScript + React + Electron, SwimmerUIKit e SwimmerI18nKit. A v2 é uma versão local de teste ainda não publicada; a v1 permanece no [GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases).

## Uso

1. Abra `ClaudeSync.app` ou o iniciador do código-fonte. Atualize.
2. Marque as contas que deseja incluir. Clique na conta para ver as sessões, ou use a lista combinada sem duplicatas.

Para manter as mesmas dez sessões em todas as contas, escolha essas dez e **Manter só as escolhidas**. Elas são adicionadas onde faltam e desarquivadas; o restante é arquivado. Se faltar uma conversa ou houver destino bloqueado, a operação para antes de arquivar outras sessões. **Escolher 10 recentes sincronizáveis** altera somente a seleção.

Tarefas remotas ou agendadas ativas também bloqueiam essa operação. Gerencie primeiro essas tarefas no Claude e depois organize as sessões locais.

## Exclusão e contagem

**Excluir sessões escolhidas** exclui conversas, não contas. Abre uma confirmação breve com orientação pelo estado: arquive uma sessão ativa ou cancele para preservar uma já arquivada. Os históricos exclusivos são movidos para a Lixeira do sistema e podem ser devolvidos de lá. A exclusão local se limita ao grupo e às contas escolhidos, sem incluir cópias antigas ocultas, e ao JSONL principal quando nenhuma outra sessão o utiliza. Conteúdo compartilhado, projetos, worktrees e arquivos auxiliares da CLI ficam intactos; os índices só mudam depois que todos os históricos previstos chegam à Lixeira. Outras operações mantêm revisão, backup e recuperação protegida.

Contas verificadas usam a organização confirmada pelo perfil; cópias antigas não alteram o estado atual de arquivo. E-mail e organização ficam só neste computador. As verificações local e da nuvem lembram a organização. Registros antigos que só têm e-mail precisam de uma nova verificação com essa conta conectada para confirmar sua organização. Local e nuvem têm números e seleções separados. A nuvem mostra histórico Code da conta atual, incluindo Wakeup, até 100 registros. Usa autorização existente não expirada. Exclui apenas registros Remote Control verificados e ociosos; registros em execução, vinculados ou desconhecidos ficam bloqueados. Verifica antes de escrever, para na primeira falha e confirma por leitura. Não renova OAuth, registra dispositivos, muda horários ou tenta novamente automaticamente. Feche Claude para alterações locais; não para a nuvem. Credenciais só na memória principal. Leituras reais verificadas; nenhuma conversa real foi excluída na aceitação.

No macOS, o módulo mantido `@napi-rs/keyring` lê as Chaves de forma assíncrona dentro do ClaudeSync, sem cliente CLI compartilhado. O diálogo não tem prazo de resposta imposto pelo app. Na mesma execução, a verificação e as credenciais em memória são reutilizadas até mudar o login ou seu cache criptografado. Confirmar a organização atual não prova a saída de outra: sem evidência explícita, as demais ficam não verificadas e a limpeza não as importa nem as move. A consulta atual do perfil não pode provar essa saída.

Entradas locais desconhecidas são ignoradas sem alterações; Atenção mostra o caminho e «ignorado, sem alterações». As pastas conhecidas do Desktop `backlog` e `waiting-input` são preservadas sem avisos nem gerenciamento. Se puderem existir referências compartilhadas desconhecidas, a exclusão mantém o texto. Um destino de gravação inseguro ou uma mudança no texto relevante interrompe a operação afetada.

## Desenvolvimento

Use Node 24 e a versão fixa do pnpm. Em um checkout novo: `pnpm install --frozen-lockfile`.

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm package:mac:dir
```

Os testes usam dados sintéticos temporários. O desenvolvimento permite isolamento com `CLAUDESYNC_DATA_DIR`; os pacotes finais ignoram esse ajuste.

O pacote local é uma `.app` Apple silicon sem assinatura. Windows, Intel Mac, Linux, assinatura e notarização precisam de validação separada. Cinco idiomas; a versão atual não tem anúncios, rastreamento, pagamentos ou sincronização automática. CI só manual; enviar código não publica. O antigo Python/Tk/Web foi retirado do código atual, preservando histórico Git e versões anteriores.

[Arquitetura](ARCHITECTURE.md) · [Contribuir](CONTRIBUTING.md) · [Segurança](SECURITY.md) · [Plano](docs/PLAN-TS-CROSSPLATFORM-COMMERCIAL.md)
