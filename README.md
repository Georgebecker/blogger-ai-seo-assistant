![Assistente AI Blogger](docs/img/banner.png)

# Assistente AI Blogger

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4f46e5)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)
![Versão 2.0.0](https://img.shields.io/badge/vers%C3%A3o-2.0.0-0ea5e9)
![MVP em teste local](https://img.shields.io/badge/status-MVP%20em%20teste%20local-f59e0b)
![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-22c55e)
[![Instalar na Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Instalar-4f46e5?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/assistente-ai-blogger/dknljonehldnnlgdeonapcnnkolopedd)

Extensão do Chrome (Manifest V3) que leva inteligência artificial para dentro do **editor do Blogger**: cria e otimiza textos com SEO, gera imagens e descrições ALT e audita o post em tempo real — sem sair da tela de edição e sem alterar nada sem a sua confirmação.

Funciona com a **sua própria chave** de IA (BYOK): **DeepSeek** ou **Google Gemini**, escolhidos no popup, com o outro podendo entrar como **reserva automática**. A chave fica guardada **criptografada** no seu navegador.

> **Versão 2.0.0 para teste local:** ainda não foi publicada na Chrome Web Store. A versão da loja continua disponível pelo botão acima.

> Explicação em linguagem simples, para qualquer pessoa: [`docs/ENTENDA_O_PROJETO.md`](docs/ENTENDA_O_PROJETO.md).

## Classificação

- **Propósito:** apoiar criação, SEO e acessibilidade de posts no Blogger com IA.
- **Maturidade:** MVP 2.0.0 para teste local; ainda não publicado na loja.
- **O que estou praticando:** extensões Chrome, TypeScript, segurança e integração com APIs de IA.
- **Quem usaria:** autores de blogs no Blogger que tenham suas próprias chaves de IA.

## Metodologia Loop

Este projeto toma como referência o [`projeto_loop`](https://github.com/Georgebecker/projeto_loop) e trabalha em ciclos: hipótese, mudança pequena, teste, medição e decisão. Este projeto não foi feito no "achismo": decisões e pendências ficam registradas no [`DEVLOG.md`](docs/DEVLOG.md).

## O que ele faz

| Recurso | Em poucas palavras |
|---|---|
| **Criar** | Escreve o rascunho completo do post a partir de um assunto e de uma personalidade (manual ou aprendida dos textos do blog), com links internos e fontes externas |
| **Texto** | Sugere título, meta-descrição e melhorias com base na palavra-chave; aplica com confirmação |
| **Imagens** | Cria imagens para o post e gera descrição (alt) e legenda para as imagens sem descrição |
| **Checklist** | Confere SEO e links em tempo real: título, meta, densidade da palavra-chave, subtítulos, imagens, alt e links |

## Como funciona

```mermaid
flowchart LR
    A["Você, no editor do Blogger"] --> B["Painel: Texto, Criar, Imagens e Checklist"]
    B -- "mensagens tipadas" --> C["Service worker: chave e chamadas externas"]
    C -- "texto e visão" --> D["DeepSeek ou Google Gemini"]
    C -- "imagens" --> E["Modelos de imagem do Google"]
    D --> F["Sugestões: título, meta, texto, alt e links"]
    E --> F
    F --> G["Você revisa e aplica: nada muda sem confirmação"]
```

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (compilado para JavaScript) |
| Build | Vite + `@crxjs/vite-plugin` |
| Extensão | Chrome Manifest V3 (Chrome 102 ou mais recente) |
| IA de texto | DeepSeek (`deepseek-flash`) e Google Gemini (`gemini-3.8-flash`), com principal + reserva |
| IA de imagem | Família de modelos de imagem do Google |
| Proteção das chaves | Criptografia AES-GCM 256 com derivação PBKDF2 |

## Instalação rápida (modo desenvolvedor)

> **Só quer usar?** A extensão já está publicada na [Chrome Web Store](https://chromewebstore.google.com/detail/assistente-ai-blogger/dknljonehldnnlgdeonapcnnkolopedd) — instale por lá e pule esta seção. O passo a passo abaixo é para compilar do código-fonte.

```powershell
npm install
npm run build
```

1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha a pasta `blogger_ai_seo_assistant V2`.
3. Configure a sua chave no popup da extensão (abaixo).

Para preparar a pasta de teste, execute `npm run build` e copie o conteúdo gerado em `dist/` para `blogger_ai_seo_assistant V2`. Passo a passo para criar a chave: [`docs/INSTALACAO.md`](docs/INSTALACAO.md).

## Sua chave (BYOK)

1. Crie uma chave no [Google AI Studio](https://aistudio.google.com/app/apikey) ou na [DeepSeek](https://platform.deepseek.com/api_keys).
2. No popup da extensão, escolha o provedor principal, informe a chave e crie uma senha mestra.
3. Depois de salvar, a extensão desbloqueia a chave automaticamente ao abrir o Blogger neste perfil do Chrome. O botão **Bloquear** remove a autorização automática; para voltar a usá-la, informe a senha mestra no popup.

O uso da IA é cobrado pelo provedor escolhido (o Google tem camada sem custo para texto). Detalhes de segurança: [`docs/SEGURANCA.md`](docs/SEGURANCA.md).

## Principal diferença da V2

Na V1, era necessário desbloquear a chave manualmente após iniciar o navegador. Na V2, depois de salvar ou desbloquear a chave uma vez, a extensão pode voltar a usá-la automaticamente ao abrir o editor do Blogger. **As chaves permanecem criptografadas**; o botão **Bloquear** remove a autorização automática. Quem tiver acesso ao seu perfil do Chrome poderá usar a extensão, então proteja o acesso ao computador.

## Próximos passos

- Adicionar novos modelos de IA e permitir selecioná-los no popup.
- Adicionar novas funcionalidades ao assistente, com testes e validação no editor do Blogger.
- Integrar APIs adicionais para geração de imagens, além da opção atual do Google.

## Documentação

| Documento | Para quê |
|---|---|
| [`docs/ENTENDA_O_PROJETO.md`](docs/ENTENDA_O_PROJETO.md) | Explicação em linguagem simples (para qualquer pessoa) |
| [`docs/INSTALACAO.md`](docs/INSTALACAO.md) | Compilar, instalar e configurar a chave |
| [`docs/COMO_USAR.md`](docs/COMO_USAR.md) | Guia de uso no editor do Blogger |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Como o código é organizado e como as partes conversam |
| [`docs/SEGURANCA.md`](docs/SEGURANCA.md) | Criptografia, permissões e o que sai do navegador |
| [`docs/PRIVACIDADE.md`](docs/PRIVACIDADE.md) | Política de privacidade |
| [`docs/PUBLICACAO.md`](docs/PUBLICACAO.md) | Como publicar (GitHub e Chrome Web Store) |
| [`docs/DEVLOG.md`](docs/DEVLOG.md) | Histórico de decisões, problemas e pendências |

## Contribuir e reportar problemas

Iniciantes podem enviar um primeiro PR com uma melhoria pequena, como uma mensagem de erro ou um teste; eu reviso e ajudo. Colegas podem abrir uma issue para discutir gargalos, segurança ou arquitetura. Recrutadores e visitantes podem conferir o código e o histórico de decisões neste repositório.

Sugestões e problemas: <https://github.com/Georgebecker/blogger-ai-seo-assistant/issues>.

## Segurança e privacidade (resumo)

- As chaves são protegidas com **AES-GCM 256 + PBKDF2** e usadas somente pelo service worker; a página do Blogger nunca recebe a chave de API.
- Remover a extensão apaga os dados que o Chrome mantém para ela. Isso não equivale a uma garantia de apagamento forense dos setores do disco.
- **Sem telemetria, sem rastreamento, sem venda de dados**; o conteúdo só vai ao provedor de IA quando você aciona um recurso.

## Limitações conhecidas

- O painel aparece somente nas telas de edição de post do Blogger.
- A verificação de links externos depende de uma permissão opcional (autorizada no popup).
- Textos muito longos são analisados em partes de até 15 mil caracteres.
- **Inserção automática:** em alguns casos, o Blogger pode não salvar o corpo do post inserido pela extensão; o caminho garantido é **Copiar texto** e colar no editor com Ctrl+V antes de salvar (em investigação — veja o [`DEVLOG`](docs/DEVLOG.md)).
- Revise sempre o conteúdo sugerido pela IA antes de publicar.
- **Capturas da interface:** pendentes; este ambiente não permite carregar e operar a extensão em um Chrome real para registrar telas fiéis.

## Licença

[MIT](LICENSE) — use, estude e adapte à vontade.

---

**Autor:** George Herman Becker — Gestor em TI

**Apoie o autor:**
- **PIX:** `a8b68e14-edfe-4450-88f2-c2af4aca2a6c`
- **Buy Me a Coffee:** <https://buymeacoffee.com/georgehbecker>
- **LinkedIn:** <https://www.linkedin.com/in/georgehbecker/>

## Tags do GitHub

```text
chrome-extension, blogger, seo, typescript, loop-engineering
```
