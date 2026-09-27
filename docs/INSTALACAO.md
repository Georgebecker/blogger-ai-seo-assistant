# Instalação e configuração

Guia completo para compilar a extensão, instalá-la no Chrome (modo desenvolvedor) e configurar a sua chave de API.

## Requisitos

| Requisito | Para quê |
|---|---|
| Google Chrome 102 ou mais recente | A extensão usa o Manifest V3 |
| Node.js 18+ com npm | Compilar o projeto (TypeScript + Vite) |
| Python 3.8+ (opcional) | Apenas para regerar os ícones (`tools/gerar_icones.py`, sem dependências) |

## 1. Compilar

```powershell
cd blogger-ai-seo-assistant
npm install
npm run build
```

O `npm run build` roda a checagem de tipos (TypeScript) e gera a pasta `dist/` — é essa pasta que o Chrome carrega.

Outros comandos:

| Comando | Para quê |
|---|---|
| `npm run typecheck` | Só a checagem de tipos |
| `npm run dev` | Modo de desenvolvimento (Vite) |
| `npm run icons` | Regera os ícones em `public/icons/` |
| `npm run test:crypto` | Testa a criptografia do cofre da chave |
| `npm run empacotar` | Gera o ZIP pronto para a Chrome Web Store (pasta `loja/`) |

## 2. Instalar no Chrome (modo desenvolvedor)

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `dist/`.
4. Fixe a extensão na barra de ferramentas (ícone de extensões > fixar).
5. Abra um post no editor do Blogger (endereço no padrão `/blog/post/...`) e clique no botão flutuante **Assistente AI Blogger**, no canto inferior direito.

Para atualizar depois de uma mudança: rode `npm run build` de novo, clique no botão de recarregar da extensão em `chrome://extensions` e atualize a página do Blogger (F5).

## 3. Configurar a chave (BYOK)

A extensão não cobra nem hospeda nada: você usa a sua própria chave de IA.

1. Crie uma chave no provedor que vai usar:
   - **Google Gemini** — <https://aistudio.google.com/app/apikey> (tem camada sem custo para texto);
   - **DeepSeek** — <https://platform.deepseek.com/api_keys>.
2. Clique no ícone da extensão para abrir o popup.
3. Em **Provedor de IA (principal)**, escolha o serviço. Se quiser, mantenha marcada a caixa **"Usar o outro serviço como reserva"** — assim, quando o principal falhar, ficar indisponível ou sem créditos, a extensão tenta o outro automaticamente.
4. Cole a **chave da API** e crie uma **senha mestra** (mínimo de 8 caracteres; ela não sai do seu computador).
5. Clique em **Salvar chave** e, para conferir, em **Testar conexão**.

Ao fechar o navegador a chave é trancada; para usar de novo, clique em **Desbloquear** e informe a senha mestra. O botão **Bloquear** tranca na hora, quando você quiser.

## 4. Permissão opcional (links externos)

No popup, o botão **Permitir acesso aos sites dos links** libera a conferência de links de outros domínios no checklist. Sem essa permissão, esses links ficam como "não verificado" — nada mais deixa de funcionar.

## 5. Onde os dados ficam

- A chave fica **criptografada** (AES-GCM + PBKDF2) em `chrome.storage.local`; a cópia desbloqueada vive apenas na memória da sessão do navegador (`chrome.storage.session`).
- Os textos e imagens só saem do navegador quando você aciona um recurso de IA, e vão direto para o provedor escolhido.
- Detalhes completos: [`SEGURANCA.md`](SEGURANCA.md) e [`PRIVACIDADE.md`](PRIVACIDADE.md).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| O botão flutuante não aparece | Confira se está numa tela de edição de post (`/blog/post/...`), atualize a página (F5) e veja se a extensão está ativa em `chrome://extensions` |
| "Testar conexão" falhou | Confira a chave, o provedor escolhido e a senha mestra (desbloqueie antes de testar) |
| A geração de imagem não funciona no Google | No nível gratuito a cota de imagem é 0 por dia; ative o faturamento no Google AI Studio, ou use **Escolher do computador** / **Usar imagem padrão** |
| Erros passageiros ("alta procura", 429/503) | A extensão repete automaticamente e, se houver reserva configurada, troca de serviço sozinha antes de desistir |
| Mensagem sobre a chave bloqueada | Clique em **Desbloquear** no popup e informe a senha mestra |
