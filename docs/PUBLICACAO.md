# Como publicar (GitHub e Chrome Web Store)

Este guia cobre as duas publicações: o código no GitHub e a extensão na Chrome Web Store — o que já está pronto e o que depende de você.

## O que já está pronto

- Manifest V3 válido, versão 1.1.0 e ícones 16/32/48/128.
- Build limpo (`npm run build`) e empacotador (`npm run empacotar` → `loja/assistente-ai-blogger-vX.Y.Z.zip`).
- Imagens promocionais em `docs/img/` (`banner.png` e `loja-440x280.png`), geradas por `tools/gerar_promocionais.ps1`.
- Política de privacidade ([`PRIVACIDADE.md`](PRIVACIDADE.md)) e justificativas de permissão.
- Textos da listagem prontos (abaixo, para copiar e colar).

## O que depende de você (conta de desenvolvedor)

1. **Registrar a conta** em <https://chrome.google.com/webstore/devconsole> com a conta Google que vai administrar a extensão.
2. **Pagar a taxa única de registro** (US$ 5, no cartão; cobrada uma vez por conta).
3. **Ativar a verificação em duas etapas** na conta Google (obrigatória para publicar).
4. **Verificação de identidade do publicador** (nome e endereço) — pode levar de alguns dias a algumas semanas; comece por aqui se quiser publicar rápido.
5. Se for distribuir na União Europeia: declarar o status de "trader" (comerciante) — exige dados de contato públicos.

## 1. Publicar o código no GitHub (recomendado)

O repositório local já tem histórico e não tem nada sensível rastreado.

```powershell
cd D:\Projetos\blogger-ai-seo-assistant
gh repo create Georgebecker/blogger-ai-seo-assistant --public --source . --push
gh repo edit Georgebecker/blogger-ai-seo-assistant --description "Extensão Chrome (Manifest V3) com IA para o editor do Blogger: cria e otimiza posts com SEO, gera imagens e ALT e audita o post. BYOK (DeepSeek e Google Gemini)." --add-topic chrome-extension --add-topic manifest-v3 --add-topic blogger --add-topic seo --add-topic accessibility --add-topic typescript --add-topic deepseek --add-topic google-gemini
```

> Nunca aponte o `origin` deste repositório para o repositório do `projeto_loop`.

Com o repositório no ar, o link da política de privacidade fica:

`https://github.com/Georgebecker/blogger-ai-seo-assistant/blob/master/docs/PRIVACIDADE.md`

(Alternativa: publicar a pasta `docs/` pelo GitHub Pages, em Configurações > Pages, e usar o endereço gerado.)

## 2. Gerar o pacote da loja

```powershell
npm run empacotar
```

Isso compila e cria `loja/assistente-ai-blogger-v<versão>.zip`, com o `manifest.json` **na raiz** do ZIP (exigência da loja). Para a próxima versão, aumente o número em `manifest.json` antes de empacotar.

## 3. Enviar para a Chrome Web Store

1. No [painel do desenvolvedor](https://chrome.google.com/webstore/devconsole), clique em **Adicionar novo item** e faça upload do ZIP.
2. Preencha a aba **Detalhes do app** com os textos abaixo.
3. Preencha a aba **Privacidade** (finalidade única, uso de dados e justificativas) — é lá que entra a URL da política de privacidade.
4. Na aba **Distribuição**, escolha a visibilidade pública, os países e a gratuidade.
5. Clique em **Enviar para revisão** (você pode marcar "adiar publicação" para escolher o momento de ir ao ar).
6. Acompanhe o e-mail cadastrado: a revisão de itens novos costuma levar de alguns dias a algumas semanas.

### Materiais da listagem

| Item | Especificação | Status |
|---|---|---|
| Ícone | 128×128 | Pronto (dentro do pacote) |
| Capturas de tela | 1 a 5 imagens, 1280×800 (ou 640×400), PNG/JPEG | **Falta capturar** (veja abaixo) |
| Imagem promocional pequena (opcional) | 440×280 | Pronta: `docs/img/loja-440x280.png` |
| Imagem promocional grande (opcional) | 1400×560 | Opcional |
| Vídeo (opcional) | Link do YouTube | Opcional |

Roteiro sugerido para as capturas (no editor do Blogger, com um post de exemplo):

1. Painel aberto na aba **Texto**, com sugestões visíveis.
2. Aba **Criar**, com um post gerado e a conformidade.
3. Aba **Imagens**, com uma prévia e o alt.
4. Aba **Checklist**, com os itens conferidos.

### Textos prontos para a listagem

**Nome:** Assistente AI Blogger

**Resumo (até 132 caracteres):**

```text
Assistente de IA para o editor do Blogger: cria e otimiza posts com SEO, gera imagens e ALT e confere o post em tempo real.
```

**Descrição detalhada:**

```text
O Assistente AI Blogger leva inteligência artificial para dentro do editor do Blogger, sem sair da tela de edição.

O QUE ELE FAZ
- Cria o rascunho completo do post a partir de um assunto, com a personalidade que você definir (ou aprendida dos textos do seu próprio blog): título, meta-descrição, endereço (slug), palavras-chave, links internos e 1 a 2 fontes externas citadas no texto.
- Otimiza o texto e a estrutura: sugere título, meta-descrição e melhorias com base na palavra-chave principal.
- Cuida das imagens: cria imagens para o post e gera descrição (alt) e legenda para as imagens que estão sem descrição, importante para acessibilidade e SEO.
- Audita o post em tempo real: checklist de SEO, densidade da palavra-chave, títulos, imagens e links (internos e externos).

SUA CHAVE, SEU CONTROLE (BYOK)
Você usa a sua própria chave do DeepSeek ou do Google Gemini. A chave fica guardada criptografada (AES-GCM + PBKDF2) no seu navegador, protegida por uma senha mestra que só você conhece, e é usada apenas nos bastidores da extensão. Você escolhe o serviço principal no popup e pode deixar o outro como reserva automática para falhas ou falta de créditos.

PRIVACIDADE
- Nada de rastreamento ou telemetria.
- O conteúdo do post só é enviado ao provedor de IA quando você aciona um recurso (otimizar, criar, descrever imagem etc.).
- Você revisa tudo antes de aplicar: nada muda no post sem a sua confirmação.

OBSERVAÇÕES
- Os serviços de IA são pagos por uso no provedor escolhido (o Google tem camada sem custo para texto; a geração de imagens exige uma conta com faturamento ativado).
- A extensão aparece somente nas telas de edição de post do Blogger.

Assistente AI Blogger é um projeto independente, sem vínculo com o Google. Blogger é uma marca do Google LLC.
```

**Categoria:** Produtividade | **Idioma:** Português (Brasil)

**Finalidade única (mensagem para a revisão):**

```text
Assistente de IA integrado ao editor do Blogger para criar, otimizar e auditar posts (texto, imagens e SEO), usando a chave de API do próprio usuário.
```

**Uso de dados (aba Privacidade):**

| Tipo de dado | Declarar? | Por quê |
|---|---|---|
| Informações de autenticação (chave de API) | Sim | Usada para autenticar as chamadas ao provedor escolhido; fica criptografada no navegador |
| Conteúdo do site (texto e imagens do post) | Sim | Processado para gerar as sugestões; enviado ao provedor somente quando o usuário aciona o recurso |

E marque as certificações: os dados **não são vendidos**, **não são usados para finalidades não relacionadas** e **não são usados para avaliar crédito**.

**Justificativa das permissões (para colar nos campos da aba Privacidade):**

| Permissão | Texto sugerido |
|---|---|
| `storage` | Guardar a chave de API criptografada, a sessão de desbloqueio e as preferências do usuário. |
| `activeTab` / `scripting` | Abrir a interface e injetar o painel quando o usuário interage com a extensão no editor. |
| `*://*.blogger.com/*` | Ler e ajustar o editor do Blogger — finalidade principal da extensão. |
| `https://generativelanguage.googleapis.com/*` | Chamar a API do Google Gemini (texto, visão e imagens) quando o usuário aciona um recurso. |
| `https://api.deepseek.com/*` | Chamar a API do DeepSeek quando for o provedor escolhido pelo usuário. |
| `*://*.googleusercontent.com/*` e `*://*.blogspot.com/*` | Baixar as imagens do post para gerar descrições (alt). |
| `*://*/*` (opcional) | Verificar se os links externos do post respondem; pedida somente quando o usuário usa o recurso. |

**Instruções de teste (se a loja pedir):**

```text
A extensão funciona em qualquer blog do Blogger. Crie um blog de teste, abra um post no editor (draft.blogger.com, endereço /blog/post/...), clique no botão flutuante no canto inferior direito. As funções de IA exigem uma chave própria (DeepSeek ou Google Gemini), informada no popup com uma senha mestra; sem chave, é possível conferir o checklist e a interface.
```

## Depois de publicado

- **Atualizações:** aumente a versão em `manifest.json`, rode `npm run empacotar` e envie o novo ZIP pelo painel ("Enviar atualização").
- **Suporte:** issues no GitHub e o e-mail configurado no painel do desenvolvedor.
- **Avaliações:** responda educadamente; o feedback vira melhoria.

## Alternativa: Microsoft Edge Add-ons (grátis)

A mesma extensão (Manifest V3 do Chrome) pode ser publicada na loja do Edge, sem taxa de registro: <https://partner.microsoft.com/dashboard/microsoftedge>. O ZIP é o mesmo.

## Antes de enviar: cuidados do projeto

- **Pendência conhecida (mitigada em 26/09):** a inserção automática + salvar no Blogger recebeu mitigação (inserção pela colagem + aviso imediato se o editor desfizer; protocolo de teste no [`DEVLOG.md`](DEVLOG.md)). Confirme o comportamento no Blogger real antes de enviar, porque a revisão testa os recursos.
- **Revisão de pontuação do otimizador:** pendente; não bloqueia a publicação.
- Revise os textos da listagem: sem promessas exageradas e sem sugerir vínculo com o Google.
- A primeira versão publicada é a 1.1.0; depois dela, cada envio precisa de um número maior.
