# DevLog — Blogger AI SEO Assistant

Registro das decisões de arquitetura e dos problemas técnicos antecipados (e onde cada
solução vive no código). Atualize este arquivo a cada decisão relevante.

## Stack e decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Linguagem | TypeScript compilado para JavaScript | Tipagem estática evita que o agente de IA use APIs inexistentes e garante conformidade com o Manifest V3 |
| Build | Vite + `@crxjs/vite-plugin` | Empacotamento otimizado; o plugin injeta os caminhos compilados no manifest do `dist/` |
| Manifest | V3 | Obrigatório para novas extensões |
| Modelo de IA | Google Gemini 2.0 Flash (padrão, trocável no popup) | Rápido, barato e com visão computacional nativa |
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
- `host_permissions` no `manifest.json`: `*://*.blogger.com/*` e
  `https://generativelanguage.googleapis.com/*` (além dos domínios de imagem do Blogger,
  usados para baixar as fotos antes de enviá-las à IA).

## Linha do tempo

- **25/09/2026** — Estrutura inicial: TypeScript + Vite + CRXJS; manifest V3; criptografia
  AES-GCM/PBKDF2; service worker com Gemini (texto + visão) e proxy de links; content script
  com painel de 3 abas (Texto, Imagens, Checklist); popup BYOK com permissões opcionais.
