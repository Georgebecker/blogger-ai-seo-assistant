# Assistente AI Blogger

Extensão do Chrome (Manifest V3) que se integra ao editor do Blogger para:

- **Criar posts** a partir de um assunto, com uma personalidade (escrita à mão ou aprendida
  dos textos do próprio blog) e o texto inteiro já dentro das regras de SEO.
- **Otimizar o texto** do post: título, meta-descrição, subtítulos e densidade da palavra-chave.
- **Criar imagens** para o post (comando montado pela IA, comando seu ou arquivo do computador)
  e **gerar ALT e legendas** para imagens sem descrição.
- **Auditar o post** em tempo real: checklist de SEO técnico, links internos e externos.

As chaves de API são suas (BYOK): **DeepSeek** e/ou **Google Gemini** — você escolhe o serviço
principal no popup e pode deixar o outro como **reserva** (entra quando o principal falha, fica
indisponível ou acaba o crédito). A chave fica guardada **criptografada** (AES-GCM + PBKDF2) no
seu navegador e só é usada no service worker, no momento da chamada — nunca é exposta na página.

Explicação em linguagem simples (para qualquer pessoa): [`docs/ENTENDA_O_PROJETO.md`](docs/ENTENDA_O_PROJETO.md).

---

## Stack

| Item | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript (compilado para JavaScript) | Tipagem estática evita API inexistente e garante conformidade com o Manifest V3 |
| Build | Vite + `@crxjs/vite-plugin` | Empacotamento otimizado e caminhos do manifest resolvidos automaticamente |
| Manifest | V3 | Obrigatório para novas extensões |
| Modelos de IA | Texto: DeepSeek e/ou Google Gemini, com principal + reserva configuráveis. Imagem: família Nano Banana, do Google | Padrões: `deepseek-flash` e `gemini-3.8-flash`; imagem a partir de `gemini-3.1-flash-image` |
| Armazenamento | `chrome.storage.local` + criptografia AES-GCM | A chave nunca fica em texto puro no disco |

## Requisitos

- **Node.js 18+** e npm.
- **Python 3.8+** — apenas para regerar os ícones (`tools/gerar_icones.py`, sem dependências).

## Como compilar

```powershell
cd blogger-ai-seo-assistant
npm install
npm run build        # roda o typecheck (tsc) e gera a pasta dist/
```

Outros comandos:

| Comando | Para quê |
|---|---|
| `npm run typecheck` | Só a checagem de tipos |
| `npm run dev` | Modo desenvolvimento (Vite) para iteração com recarga |
| `npm run icons` | Regera os ícones em `public/icons/` |

## Como instalar (modo desenvolvedor)

1. Rode `npm run build` e confira que a pasta `dist/` foi criada.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta `dist/`.
5. Fixe a extensão na barra de ferramentas.

## Como configurar a chave

1. Escolha o provedor no popup e crie a chave no painel dele:
   - Google Gemini: <https://aistudio.google.com/app/apikey> (tem camada sem custo);
   - DeepSeek: <https://platform.deepseek.com/api_keys>.
2. Clique no ícone da extensão e informe:
   - a **chave da API** do provedor escolhido;
   - uma **senha mestra** (criada por você; é ela que criptografa a chave).
3. Clique em **Salvar chave** (e, se quiser conferir, em **Testar conexão**).
4. Ajuste a **reserva**, se quiser: com a caixa marcada, o outro serviço entra automaticamente
   quando o principal falhar ou ficar sem créditos. Os modelos ativos aparecem no rodapé do
   painel e no popup.

A chave fica gravada no `chrome.storage.local` **cifrada**; ao fechar o navegador ela é
**bloqueada** e basta desbloquear com a senha mestra na próxima vez. Enquanto o navegador
estiver aberto, a chave desbloqueada fica apenas na memória da sessão (`chrome.storage.session`).

## Como usar no editor do Blogger

1. Entre em `draft.blogger.com` (ou `www.blogger.com`) e abra um post no editor
   (URLs no padrão `/blog/post/...`).
2. Clique no botão flutuante **Assistente AI Blogger** (canto inferior direito).
3. Abas:
   - **Texto** — informe a palavra-chave e clique em **Otimizar texto**. Revise as sugestões e
     aplique o título, a meta-descrição ou o texto revisado (com confirmação; dá para desfazer
     com Ctrl+Z). A meta-descrição é aplicada em "Configurações do post > Descrição da pesquisa"
     (a extensão abre a seção por você quando precisa).
   - **Criar** — separado da auditoria: escreva (ou aprenda com os textos do blog) uma
     personalidade, informe o assunto e os pontos que precisam aparecer, e receba um post
     completo com título, meta-descrição, slug, palavras-chave, links internos e 1–2 fontes
     externas citadas no texto; revise a "Conformidade SEO" e use "Inserir no post"
     (que também aplica o título — o endereço/slug sai dele).
   - **Imagens** — crie uma imagem nova (montada a partir do post, com comando seu, escolhida do
     computador ou padrão), confira a descrição e insira no post; e escaneie as imagens
     existentes sem `alt` para gerar e aplicar sugestões (alt + legenda). Observação: a geração
     com IA usa os modelos de imagem do Google e exige conta com faturamento ativado (o nível
     gratuito tem cota de 0 imagens por dia); sem isso, use "Escolher do computador" ou
     "Usar imagem padrão".
   - **Checklist** — auditoria em tempo real (título, meta-descrição, densidade da palavra-chave,
     subtítulos, alt, links) e verificação de links externos.

## Segurança

- AES-GCM 256 com chave derivada da senha mestra por **PBKDF2** (SHA-256, 210 mil iterações).
- A chave descriptografada vive só na memória da sessão do navegador e some ao fechar.
- O **content script nunca vê a chave**: todo acesso à API acontece no service worker.
- Nada de log da chave no console; o conteúdo do post é usado apenas para montar o prompt.

## Permissões (por quê)

| Permissão | Para quê |
|---|---|
| `storage` | Guardar a chave criptografada, a sessão de desbloqueio e as preferências |
| `activeTab`, `scripting` | Recursos do popup e injeção sob demanda |
| `*://*.blogger.com/*` | Ler e ajustar o editor do Blogger |
| `https://generativelanguage.googleapis.com/*` | Chamar a API do Google Gemini (feito no service worker) |
| `https://api.deepseek.com/*` | Chamar a API do DeepSeek (só se você escolher esse provedor) |
| `*://*.googleusercontent.com/*`, `*://*.blogspot.com/*` | Baixar as imagens do post para a IA descrevê-las |
| `*://*/*` (opcional, pedida sob demanda) | Verificar links externos; você autoriza no popup |

## Estrutura do projeto

```
blogger-ai-seo-assistant/
├── manifest.json               # Manifest V3 (fonte; o build gera o do dist/)
├── package.json                # Scripts e dependências (Vite + CRXJS + TypeScript)
├── tsconfig.json
├── vite.config.ts
├── docs/
│   ├── DEVLOG.md               # Decisões, regras invioláveis, problemas e pendências
│   └── ENTENDA_O_PROJETO.md    # Explicação em linguagem simples (para qualquer pessoa)
├── public/
│   └── icons/                  # Ícones (gerados por tools/gerar_icones.py)
├── src/
│   ├── background/
│   │   └── service-worker.ts   # IA, criptografia, fetch (Gemini)
│   ├── content/
│   │   ├── content.ts          # Injeção no DOM, UI, comunicação
│   │   └── content.css         # Estilos da UI injetada
│   ├── popup/
│   │   ├── popup.html          # Configurações da chave API
│   │   └── popup.ts
│   └── lib/
│       ├── crypto-utils.ts     # AES-GCM, PBKDF2
│       └── messages.ts         # Contratos de mensagem entre contextos
└── tools/
    └── gerar_icones.py         # Gera os PNGs dos ícones sem dependências
```

## Limitações conhecidas

- O Blogger pode mudar a estrutura da página; se o botão não aparecer, ajuste os `matches`
  do manifest ou os seletores em `src/content/content.ts`.
- Legendas (`figcaption`) podem ser ajustadas pelo próprio Blogger ao salvar; sempre revise.
- AMP é configuração do blog (não do post) — o checklist apenas orienta.
- A verificação de links externos depende da permissão opcional; sem ela, links de outros
  domínios ficam como "não verificado".
- Textos muito longos são analisados até o limite de 15 mil caracteres por vez.
- **Inserção automática:** ao inserir conteúdo pela extensão e salvar, o Blogger pode não gravar
  o corpo do post (em investigação). O caminho garantido é **Copiar texto** e colar no editor
  com Ctrl+V antes de salvar.
- Revise sempre o conteúdo sugerido pela IA antes de publicar.

---

**Autor:** George Herman Becker
**Gestor em TI — Estácio**

**Apoie o autor:**
- **PIX:** `a8b68e14-edfe-4450-88f2-c2af4aca2a6c`
- **Buy Me a Coffee:** <https://buymeacoffee.com/georgehbecker>
- **LinkedIn:** <https://www.linkedin.com/in/georgehbecker/>
