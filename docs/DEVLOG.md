# DevLog — Assistente AI Blogger

Registro das decisões de arquitetura e dos problemas técnicos antecipados (e onde cada
solução vive no código). Atualize este arquivo a cada decisão relevante.

## Stack e decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Linguagem | TypeScript compilado para JavaScript | Tipagem estática evita que o agente de IA use APIs inexistentes e garante conformidade com o Manifest V3 |
| Build | Vite + `@crxjs/vite-plugin` | Empacotamento otimizado; o plugin injeta os caminhos compilados no manifest do `dist/` |
| Manifest | V3 | Obrigatório para novas extensões |
| Modelos de IA | Texto: DeepSeek (`deepseek-flash`) e Google Gemini (`gemini-3.8-flash`), com principal + reserva no popup. Imagem: família Nano Banana do Google | Texto e visão nos dois provedores; imagem só no Google |
| Armazenamento | `chrome.storage.local` + AES-GCM (PBKDF2) | Chave BYOK nunca em texto puro; `chrome.storage.session` guarda só a cópia desbloqueada |

## Problemas antecipados e soluções

### 1. O editor do Blogger é um `contenteditable` (possivelmente em iframe)

**Problema:** o editor não é uma `<textarea>`; é um `contenteditable` complexo, às vezes
dentro de iframes aninhados, com filtros de CSS que removem classes externas.

**Solução implementada:**

- Busca recursiva de janelas (`janelasAlcancaveis()` acessa `window.frames` em profundidade,
  pulando origens inacessíveis) — `src/content/content.ts`.
- Escolha do elemento de edição por pontuação (tamanho + quantidade de texto), sempre com
  seletores robustos (`[contenteditable="true"]`, `[role="textbox"]`), nunca classes voláteis.
- Escrita de volta com **Range + Selection + `execCommand`** (texto/HTML escapado), nunca
  substituindo `innerHTML` de outro elemento que não o alvo, e sempre avisando o editor
  (`input`/`change`) para o Blogger registrar a mudança.
- UI com estilos escopados em `#bai-seo-root` e `!important` nos pontos de layout
  (`src/content/content.css`), imunes ao CSS da página.
- Nada com classes é inserido no conteúdo salvo do post (apenas texto puro e o atributo `alt`).

### 2. Ciclo de vida do service worker no Manifest V3

**Problema:** o service worker "dorme" após ~30 s de inatividade; estado em memória se perde.

**Solução implementada:**

- Estado crítico (chave cifrada, preferências) é gravado **imediatamente** em
  `chrome.storage.local` (`src/background/service-worker.ts`).
- A chave desbloqueada fica em `chrome.storage.session` (memória da sessão do navegador;
  não persiste em disco e some ao fechar o Chrome).
- O listener de mensagens devolve `true` para manter o canal aberto até a resposta da IA.

### 3. CORS

**Problema:** o content script herda a origem do Blogger e não pode chamar a API do Gemini.

**Solução implementada:**

- Todas as chamadas externas acontecem no **service worker** (que não sofre restrição de CORS
  com as permissões de host declaradas).
- `host_permissions` no `manifest.json`: `*://*.blogger.com/*`, `https://generativelanguage.googleapis.com/*`
  (texto e imagens), `https://api.deepseek.com/*` (texto/visão) e os domínios de imagem do
  Blogger, usados para baixar as fotos antes de enviá-las à IA. `*://*/*` é **opcional**,
  pedida só para verificar links externos.

## Para agentes de IA (leia antes de mexer)

Este documento existe para ancorar quem for editar o projeto (humano ou agente). Antes de
qualquer mudança, confira as regras abaixo — elas evitam retrabalho e quebra de funcionalidade.

**Regras invioláveis**

1. `fetch` para domínios externos só no service worker (`src/background/service-worker.ts`).
   O content script herda a origem da página e seria bloqueado por CORS.
2. A chave da API nunca pode circular no content script nem ser registrada em log.
   A criptografia fica em `src/lib/crypto-utils.ts` e é usada só no service worker.
3. Todo contrato de mensagem novo entra em `src/lib/messages.ts` (fonte única) e é atendido
   em `tratarMensagem()` no service worker; o listener sempre devolve `true` (resposta assíncrona).
4. Estado crítico vai imediatamente para `chrome.storage.local`; a chave desbloqueada fica
   apenas em `chrome.storage.session` (nunca em texto puro no `local`).
5. Não usar classes voláteis do Blogger em seletores; preferir atributos estáveis
   (`aria-label`, `placeholder`, `[contenteditable]`) e as heurísticas de `src/content/content.ts`.
6. Conteúdo vindo da IA nunca entra como HTML sem escape; textos entram por `textContent`
   ou `execCommand` com escape (proteção contra XSS).
7. Editar apenas `src/`, `manifest.json`, `public/` e `tools/`; nunca mexer em `dist/`
   (gerado pelo build) nem em `node_modules/`.
8. Antes de considerar pronto: `npm run typecheck`, `npm run build` e, se tocar em
   criptografia, `npm run test:crypto`.
9. Sem emojis em código, mensagens, commits ou docs; textos de interface em pt-BR.
10. `manifest.json` é a fonte da verdade; caminhos nele apontam para as fontes
    (o plugin CRXJS reescreve para o `dist/` no build).

**Mapa rápido**

| Pergunta | Onde olhar |
|---|---|
| Como o editor é localizado (inclusive em iframe)? | `janelasAlcancaveis()` e `escolherEditor()` em `src/content/content.ts` |
| Onde ficam os prompts da IA? | `montarPromptTexto()`, `montarPromptImagem()`, `montarPromptPost()` e `montarPromptImagemDoPost()` no service worker |
| Como a chave é guardada e desbloqueada? | `salvarChave()` e `desbloquear()` no service worker |
| Quais comandos o fundo aceita? | união `MensagemParaFundo` em `src/lib/messages.ts` |
| Como compilar e testar? | seção "Como compilar" do `README.md` |

## Pendências abertas

- **Salvar no Blogger depois da inserção automática (investigação):** o usuário relatou que,
  após usar a inserção da extensão, o Blogger salvava só o título e o corpo sumia no rascunho
  (contornado copiando o conteúdo de verdade e salvando). Hipóteses, em ordem: (1) conteúdo
  inserido por `execCommand` não entra no modelo interno do editor; (2) imagem em data URL
  atrapalha a gravação/sanitização; (3) eventos sintéticos de `input`/`change` (`notificarEditor`)
  confundem o estado de alterações. Plano: testar só texto, só imagem e colagem real; dependendo
  do resultado, preferir o fluxo de copiar/colar e/ou rever `notificarEditor`.
- **Revisão de pontuação pela IA no otimizador de texto** (decisão do usuário: "os dois" —
  nota local + revisão da IA).
- **Empacotamento para a Chrome Web Store** (ícones e versão prontos; falta o pacote final).

## Linha do tempo

- **25/09/2026 (noite, 4)** — Extensão renomeada para "Assistente AI Blogger" (manifesto, versão
  1.1.0) e documentos revisados (README, DevLog e Entenda o projeto); `docs/PROMPTS_AGENTE.md`
  arquivado (a fase de validação terminou; as regras para agentes seguem no próprio DevLog).
- **25/09/2026 (noite, 3)** — Transparência de modelo e reserva: o painel mostra no rodapé "Serviço principal: X (modelo) - reserva: Y (modelo)"; as mensagens de sucesso dizem quem gerou ("Sugestões prontas (geradas por DeepSeek (deepseek-flash))", "Post gerado por ...", "Imagem pronta (modelo ...)"); o popup ganhou a caixa "Usar o outro serviço como reserva" (padrão ligada) e mostra principal/reserva e o último uso (nova chave de sessão `bai.ultimoUso`, mensagem `GET_USO`). Resumo do pós-processamento: `StatusChave` ganhou `reserva/provedorReserva/modeloReserva`. O botão flutuante e o título do painel viraram "Assistente AI Blogger".
- **25/09/2026 (noite, 2)** — Checklist e geração mais fiéis: título é encontrado mesmo em área editável pequena (busca em todas as janelas; `contenteditable` com altura ≤ 160); meta-descrição passa a ser memorizada por página (`bai.metaDescricao`), com botão "Conferir meta-descrição" que abre Configurações do post, relê e reaudita; "Reauditar" virou "Reler agora" e a dica explica que o checklist já se atualiza a cada 5 s (nada se perde, nem o editor apontado à mão). Na geração: regra do primeiro parágrafo com a palavra-chave (item novo na conformidade), `links_externos` com 1–2 fontes reais citadas no corpo (verificadas via permissão de links; card "Fontes externas no texto") e "Inserir no post" também aplica o título (o slug sai dele).
- **25/09/2026 (noite)** — Cota de imagem e detecção do editor: erros de nível gratuito (cota 0/dia, "Free Tier") deixam de ser tratados como instabilidade — a extensão tenta os demais modelos de imagem e, se nenhum tiver cota, explica em linguagem clara o que fazer (ativar faturamento no Google AI Studio, colar o comando no Gemini e usar "Escolher do computador", ou "Usar imagem padrão"). Ações manuais (escanear, montar comando, inserir) forçam nova busca do editor e a varredura tenta automaticamente 2 vezes antes de avisar.
- **25/09/2026 (tarde)** — Geração de imagem no post: comando criado pela IA a partir do título/texto, edição manual do comando, escolha de arquivo do computador e imagem padrão (espaço reservado desenhado em canvas); prévia com alt (sugerido pela IA ou manual), inserir no post, baixar e copiar. Usa a API nova de imagens do Google (Interactions, `POST /v1beta/interactions` com `response_format: {type: "image"}`), com recuo automático para o `generateContent` clássico e fila de modelos (`gemini-3.1-flash-image` → `3.1-flash-lite-image` → `3-pro-image` → `2.5-flash-image`). Só o Google gera imagem (DeepSeek não gera).
- **25/09/2026 (tarde)** — Erros passageiros (429/503, "alta procura") agora são repetidos (2,5 s e 7 s) e, se a outra chave estiver desbloqueada, a chamada continua no outro serviço antes de desistir. A sessão passou a guardar as duas chaves (mapa `{ativo, chaves}` em `chrome.storage.session`, com migração do formato antigo). A leitura do estilo passou a usar até 10 textos completos (3.000 caracteres cada).
- **25/09/2026** — Aba "Criar" (gerador de posts por personalidade, com aprendizado de estilo pelos posts do blog e checklist de SEO embutido) + auditoria alinhada ao padrão do usuário (título 50–60, meta 150–160, densidade 1–2%, 2+ imagens, links internos; ALT 70–125).
- **25/09/2026** — Suporte a dois provedores de IA: Google Gemini ou DeepSeek (escolha no popup; chaves criptografadas separadas; chamadas no service worker).
- **25/09/2026** — Modelo padrão do Google corrigido (`gemini-2.0-flash` aposentado pela API → `gemini-3.8-flash`), com migração automática de modelos antigos salvos.
- **25/09/2026** — Explicação em linguagem simples criada em `docs/ENTENDA_O_PROJETO.md`.
- **25/09/2026** — Prompt da fase de validação real criado em `docs/PROMPTS_AGENTE.md`.
- **25/09/2026** — Seção "Para agentes de IA" adicionada (ancoragem para uso com DeepSeek).
- **25/09/2026** — Estrutura inicial: TypeScript + Vite + CRXJS; manifest V3; criptografia
  AES-GCM/PBKDF2; service worker com Gemini (texto + visão) e proxy de links; content script
  com painel de 3 abas (Texto, Imagens, Checklist); popup BYOK com permissões opcionais.
