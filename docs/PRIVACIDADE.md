# Política de Privacidade — Assistente AI Blogger

**Última atualização:** 29 de setembro de 2026

## Resumo

O Assistente AI Blogger funciona **no seu navegador, no seu computador**, e **não coleta dados para o desenvolvedor**: não existe servidor do projeto, não há telemetria, rastreamento, estatísticas nem envio de informações em segundo plano. Nada fica com a gente — não recebemos, não armazenamos e não vendemos nenhum dado seu.

A extensão usa as informações abaixo **apenas para funcionar**, e todas ficam no seu computador. A única saída é a chamada que **você** aciona (otimizar, criar, descrever imagem etc.): o trecho necessário é enviado **direto ao provedor de IA que você escolheu** (Google Gemini ou DeepSeek), com a **sua** chave — como um aplicativo de e-mail que fala com o seu servidor. Tudo detalhado abaixo, sem letras miúdas.

## Dados que a extensão usa para funcionar (e onde ficam)

| Dado | Para quê | Onde fica |
|---|---|---|
| Chave de API (BYOK) | Autenticar as chamadas ao provedor de IA escolhido por você | Criptografada (AES-GCM + PBKDF2) no `chrome.storage.local` do seu navegador |
| Senha mestra | Derivar a chave de criptografia do cofre | Nunca sai do seu computador; não é armazenada de forma legível |
| Conteúdo do post (texto, título, imagens) | Gerar as sugestões (otimizar, criar, descrever imagens) | Enviado somente quando você aciona um recurso, direto ao provedor escolhido; não é armazenado pelo desenvolvedor |
| Preferências (provedor, modelo, reserva) | Manter a extensão configurada como você deixou | `chrome.storage` do seu navegador |
| Links do post | Verificar se respondem (recurso opcional) | Requisição feita pelo seu navegador aos próprios sites dos links |

O desenvolvedor **não tem acesso** a nenhum desses dados: não existe servidor do projeto.

## Compartilhamento

- **Provedores de IA:** quando você aciona um recurso, o conteúdo necessário é enviado ao provedor que **você** escolheu (Google Gemini ou DeepSeek), usando a **sua** chave. O tratamento segue as políticas do provedor:
  - Google: <https://policies.google.com/privacy>
  - DeepSeek: consulte os termos em <https://platform.deepseek.com>
- **Sem outros compartilhamentos:** não vendemos, alugamos nem cedemos dados a terceiros.

## O que a extensão não faz

- Não coleta telemetria, estatísticas de uso ou identificadores.
- Não rastreia sua navegação.
- Não envia dados em segundo plano: tudo parte de uma ação sua.
- Não acessa outros sites além dos declarados nas permissões (ver [SEGURANCA.md](SEGURANCA.md)).

## Retenção e exclusão

- Os dados ficam apenas no seu navegador.
- Para apagar tudo: remova a extensão (ou limpe os dados dela em `chrome://extensions`). Não há cópia em servidores do projeto.

## Segurança

As medidas técnicas (criptografia, isolamento da chave no service worker etc.) estão detalhadas em [`SEGURANCA.md`](SEGURANCA.md). Nenhum método é 100% infalível, mas o projeto adota as práticas recomendadas para extensões.

## Crianças

A extensão não é destinada a menores de idade e não coleta dados de crianças.

## Alterações desta política

Mudanças relevantes serão publicadas neste arquivo, com a data de atualização no topo, no repositório do projeto.

## Contato

Dúvidas ou solicitações: abra uma issue em <https://github.com/Georgebecker/blogger-ai-seo-assistant/issues> ou pelo LinkedIn do autor: <https://www.linkedin.com/in/georgehbecker/>.
