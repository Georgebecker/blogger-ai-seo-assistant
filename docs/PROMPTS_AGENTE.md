# Prompts para o agente — Blogger AI SEO Assistant

Este arquivo guarda os prompts usados para conduzir agentes de IA (DeepSeek e outros) no
desenvolvimento do projeto. Antes de executar qualquer fase, o agente deve ler o `README.md`
e o `docs/DEVLOG.md` da extensão — eles são a âncora (regras invioláveis + mapa do código).

## Mapa das fases

| Fase | Escopo | Situação |
|---|---|---|
| 1. Esqueleto do projeto | Estrutura, manifest V3, build (TypeScript + Vite + CRXJS) | Concluída (commit `0de8614`) |
| 2. Módulos | UI no editor, criptografia (BYOK), IA de texto, IA de visão, checklist | Concluída (commit `0de8614`) |
| 3. Validação real | Teste no Chrome + editor do Blogger e endurecimento | **Atual — prompt abaixo** |
| 4. A definir | Ideias: publicação de teste, métricas de uso, empacotamento para a Chrome Web Store | — |

## Fase 3 — Validação real no Chrome e no Blogger

**Como usar:** dê ao agente acesso a esta pasta do projeto (ex.: DeepSeek trabalhando no
repositório) e cole o bloco abaixo. O humano executa os passos do navegador e devolve as
evidências (resultado de cada módulo, captura de tela e erros do console). O agente corrige o
que aparecer seguindo o DEVLOG e registra as mudanças.

```text
Você é um engenheiro de software full-stack especializado em extensões Chrome (Manifest V3)
e integração com APIs de IA generativa.

CONTEXTO
- Projeto: Blogger AI SEO Assistant, já implementado e compilado, em `blogger-ai-seo-assistant/`.
- Leia antes de qualquer coisa: `README.md` e `docs/DEVLOG.md` da extensão. O DEVLOG tem as
  regras invioláveis e o mapa do código — não as contrarie.
- Stack: TypeScript + Vite + @crxjs/vite-plugin (o build gera `dist/`). Sem framework no front.
- O humano executa os passos no Chrome; você orienta, coleta evidências e corrige o código.

MISSÃO
Conduzir comigo a validação real da extensão no Chrome e no editor do Blogger, módulo por
módulo, e corrigir o que falhar — com diff pequeno, seguindo o DEVLOG.

PREPARAÇÃO
1. Rode `npm install` (se necessário) e `npm run build`; confirme que `dist/manifest.json` existe.
2. Peça para eu carregar `blogger-ai-seo-assistant/dist` em `chrome://extensions`
   (modo do desenvolvedor, "Carregar sem compactação").

PLANO DE TESTE (um módulo por vez; espere minha evidência antes de seguir)

Módulo A — Carregamento e UI
- Abrir um post no editor do Blogger (URL no padrão `https://draft.blogger.com/blog/post/...`).
- Confirmar: botão flutuante "Assistente SEO" visível; painel abre/fecha; abas Texto, Imagens e
  Checklist funcionam; o layout do Blogger não quebra (painel acima das barras; nada vazando).
- Evidência: resultado + captura de tela + erros do console da página (F12).

Módulo B — Criptografia e ciclo de vida
1. Salvar chave + senha mestra → estado "chave ativa".
2. "Testar conexão" → deve responder com a palavra "ok".
3. "Bloquear" → estado "chave bloqueada"; desbloquear com senha errada deve dar
   "Senha mestra incorreta"; desbloquear com a correta → "chave ativa".
4. Aguardar cerca de 1 minuto (o service worker "dorme") e usar uma ação de IA de novo —
   deve funcionar sem pedir a senha outra vez.
5. Fechar e reabrir o Chrome → deve voltar "chave bloqueada" até desbloquear.
- A chave nunca aparece em tela, log ou relatório.

Módulo C — Aba Texto (IA de texto)
- Informar a palavra-chave e rodar "Otimizar texto" em um post de teste.
- Aplicar o título (conferir se o campo foi localizado) e aplicar a meta-descrição (a extensão
  deve abrir "Configurações do post > Descrição da pesquisa"); se não achar o campo, reporte
  exatamente o que o Blogger mostra (atributos `aria-label`, `placeholder` e `id` do elemento).
- Testar "Substituir o texto do post" e desfazer com Ctrl+Z (o post deve voltar como estava).
- Reportar: campos encontrados, tempo da chamada, qualidade das sugestões (pt-BR?) e erros.

Módulo D — Aba Imagens (visão)
- Escanear as imagens do rascunho; gerar sugestão de UMA imagem; revisar `alt` e legenda;
  aplicar o `alt` e inserir a legenda.
- Salvar o rascunho no Blogger e conferir, após salvar/recarregar, se `alt` e `figcaption`
  persistiram.
- Reportar imagens ignoradas pelo filtro (menores que 60px) e se alguma legítima ficou de fora.

Módulo E — Checklist
- Conferir os itens e o percentual; rodar "Reauditar".
- "Verificar links externos": testar sem a permissão opcional e com a permissão concedida no popup.
- Reportar itens que pareçam errados (falso positivo ou falso negativo).

Módulo F — Navegação
- Trocar de post dentro do Blogger (sem recarregar por completo) e confirmar que a UI continua
  funcionando.
- Recarregar a extensão com a aba aberta: a página deve avisar para dar F5 (sem travar).

REGRAS DE CORREÇÃO
- Siga as regras invioláveis do DEVLOG: `fetch` externo só no service worker; chave nunca no
  content script; mensagens novas em `src/lib/messages.ts`; conteúdo de IA sempre escapado
  (nunca `innerHTML` cru); editar somente `src/`, `manifest.json`, `public/` e `tools/`.
- Uma correção por vez, com diff pequeno (menos de 50 linhas quando possível); explique o quê
  e por quê.
- Depois de cada correção: `npm run typecheck` e `npm run build`; se tocar em criptografia,
  também `npm run test:crypto`.
- Se um seletor do Blogger falhar, ajuste as heurísticas de `src/content/content.ts`
  (sem classes voláteis) e registre a mudança na linha do tempo do `docs/DEVLOG.md`.
- Não recrie o projeto, não troque a stack, não refatore por preferência.
- Sem emojis em código, mensagens ou relatórios; textos em português do Brasil.

FORMATO DO RELATÓRIO (fim de cada módulo)
| Módulo | Resultado (OK/Falhou) | Evidência | Ação (correção aplicada ou "sem ação") |

No fim, liste: arquivos alterados, comandos rodados e o que ficou pendente.
```

## Próximas fases

Quando a validação terminar, acrescente aqui o prompt da fase seguinte (ex.: empacotamento
para a Chrome Web Store, página de opções, métricas). Mantenha a mesma estrutura: contexto,
missão, passos, regras e formato de relatório.
