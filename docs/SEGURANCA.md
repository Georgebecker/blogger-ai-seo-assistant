# Segurança, privacidade e permissões

## O cofre da chave

- A chave de API é guardada **criptografada** com **AES-GCM 256**, e a chave de criptografia é derivada da sua **senha mestra** com **PBKDF2** (SHA-256, 210 mil iterações).
- A chave cifrada fica em `chrome.storage.local`; a senha mestra não é persistida.
- Para abrir o Blogger sem pedir a senha mestra a cada inicialização, a extensão guarda uma cópia **não exportável** da chave derivada no IndexedDB do perfil do Chrome. A senha mestra não é armazenada.
- Ao desbloquear, a chave de API em texto puro fica apenas em `chrome.storage.session` e desaparece quando o navegador fecha.
- Todo o uso da chave acontece **no service worker**. O painel injetado na página (content script) nunca vê a chave, e nada de chave é registrado em log.
- A senha mestra **nunca é enviada a lugar nenhum**: ela só deriva, no seu computador, a chave que abre o cofre. A chave derivada não exportável permite o desbloqueio automático neste perfil.
- O botão **Bloquear** apaga as chaves derivadas persistidas e a sessão aberta. Para voltar a habilitar o desbloqueio automático, desbloqueie novamente com a senha mestra.

## O que sai do navegador (e quando)

| Situação | O que é enviado | Para onde |
|---|---|---|
| Você usa um recurso de IA (otimizar, criar, descrever imagem...) | O trecho do post, título, palavra-chave e/ou a imagem envolvida | O provedor escolhido (Google Gemini ou DeepSeek), com a **sua** chave |
| Você usa a verificação de links externos | Uma requisição para cada link do post | Os próprios sites dos links (requisição comum de navegador) |
| Fora dessas situações | Nada | — |

Não há telemetria, analytics, rastreamento nem envio de dados "em segundo plano". O que a extensão guarda localmente (chaves cifradas, preferências, sessão) fica só no seu navegador — detalhes na [política de privacidade](PRIVACIDADE.md).

## Permissões pedidas, e por quê

| Permissão | Para quê |
|---|---|
| `storage` | Guardar a chave criptografada, a sessão de desbloqueio e as preferências |
| `*://*.blogger.com/*` | Ler e ajustar o editor do Blogger — a finalidade principal da extensão |
| `https://generativelanguage.googleapis.com/*` | Chamar a API do Google Gemini (texto, visão e imagens) |
| `https://api.deepseek.com/*` | Chamar a API do DeepSeek (quando for o provedor escolhido) |
| `*://*.googleusercontent.com/*`, `*://*.blogspot.com/*` | Baixar as imagens do post para a IA descrevê-las |
| `*://*/*` (opcional, pedida sob demanda) | Verificar links externos; você autoriza no popup quando quiser |

## Boas práticas para o usuário

- Use uma senha mestra forte e só sua (mínimo de 8 caracteres; mais é melhor). Ela protege a chave antes do primeiro desbloqueio e quando você volta a habilitar o desbloqueio automático.
- A chave de API é pessoal: se vazar, revogue no painel do provedor e crie outra.
- Lembre que o uso da IA é cobrado pelo provedor escolhido; no Google, a geração de imagens exige faturamento ativado.
- Tranque o cofre (**Bloquear**) quando não estiver usando.

## Limites do que a extensão protege

- O cofre protege contra leitura direta do texto cifrado e contra acesso pela página do Blogger — não substitui a segurança do computador, da conta do Chrome ou das extensões instaladas.
- O desbloqueio automático reduz a proteção em comparação a exigir a senha mestra em cada inicialização: alguém capaz de executar a extensão no seu perfil do Chrome também pode usar as chaves. A chave derivada não exportável não é um cofre do sistema operacional.
- Enquanto estiver aberta, a chave de API fica na sessão do navegador (por design, para funcionar); ao fechar o navegador, o texto puro desaparece e será decifrado automaticamente na próxima abertura do Blogger.
- Ao desinstalar a extensão, o Chrome remove os dados locais associados a ela. Isso não garante apagamento forense de blocos já gravados no dispositivo.
- O conteúdo enviado ao provedor de IA segue as políticas desse provedor (Google ou DeepSeek); revise os termos de cada um antes de usar em conteúdo sensível.
