# ClaudeSync (Português)

**Veja primeiro. Escolha o título. Sincronize somente quando for seguro.**

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md)

ClaudeSync deixa claras as listas locais de sessões do Claude Code quando você usa duas contas no mesmo computador. Ele mostra o que pode ser adicionado, explica o que será ignorado e coloca os conflitos de título na própria tabela. A escrita só acontece depois que o Claude termina de executar.

![Prévia do ClaudeSync](docs/images/claudesync-preview.svg)

> Não é uma migração para a nuvem: não faz login, não lê senhas, não envia conversas e não move Artifacts.

## Instaladores

Baixe o pacote para macOS (Apple silicon ou Intel), Windows 64 bits ou Debian/Ubuntu em [GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases/latest). A interface oferece chinês simplificado, inglês, japonês, espanhol e português. O pacote do macOS inclui Python; no Linux sem Tk, a interface local abre automaticamente no navegador.

## Comece

Você precisa do Python 3.9 ou mais recente.

```sh
git clone https://github.com/PieAIStudio/ClaudeSync.git
cd ClaudeSync
```

- macOS: clique duas vezes em `Sync.command`
- Windows: clique duas vezes em `Sync.bat`
- Linux: execute `./Sync.sh`
- Qualquer sistema: `python sync_gui.py`

Na primeira execução, escolha a pasta raiz dos dois índices, as pastas da Conta A e da Conta B e a pasta `projects` que contém os JSONL locais.

1. Clique em **Check**; é somente leitura.
2. Em cada linha vermelha escolha Conta A, Conta B ou **Skip**.
3. Salve o trabalho no Claude e clique em **Sync safe items** ou **Close Claude and sync**.
4. Abra o Claude e confira a lista. Login e troca de conta continuam manuais.

## Regras

Títulos iguais não mudam. Um título manual pode ser copiado para o lado automático. Dois títulos manuais diferentes exigem sua escolha. Dois títulos automáticos diferentes não são adivinhados. Marcadores antigos como `（来自账号 A 的分支）` são removidos; novas ramificações usam o título original.

O corpo JSONL, entradas existentes, exclusões, arquivos, Artifacts, conectores e credenciais não são alterados. O índice é salvo antes da escrita e verificado depois.

## Comandos

```sh
python sync_sessions.py --check
python sync_sessions.py --sync
python sync_sessions.py --close-sync
```

Veja [ARCHITECTURE.md](ARCHITECTURE.md) para manutenção e o [README em inglês](README.md) para todos os limites. Licença MIT.
