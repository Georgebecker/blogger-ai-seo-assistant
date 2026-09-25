# Entenda o projeto (em palavras simples)

Esta é a explicação da extensão para quem não é da área — sem termos técnicos. O detalhe
técnico fica no `README.md` e no `docs/DEVLOG.md`.

## O que é

Um assistente que se senta ao lado de quem escreve um post no Blogger (o serviço de blogs do
Google). Ele não escreve no seu lugar: sugere, arruma e confere. E só aparece quando você está
na tela de escrever o post — no resto do navegador, fica quietinho.

## O que ele faz na prática

### 1. Deixa o texto mais fácil de achar no Google

Você digita qual é o assunto principal do post. O assistente lê o texto e sugere:

- um título melhor;
- um resumo curto (o textinho que aparece embaixo do link na busca);
- observações sobre o que dá para melhorar.

As sugestões aparecem numa janelinha — e nada entra no post sem você mandar. Se não gostar,
é só desfazer.

### 2. Descreve as fotos para quem não consegue vê-las

Pessoas cegas usam programas que "leem" a tela; para isso, cada foto precisa de uma descrição
invisível. O assistente olha cada imagem sem descrição, entende o que tem nela e sugere uma
frase curta. Você revisa, aplica — e ainda pode gerar uma legenda.

### 3. Confere uma lista de boas práticas enquanto você escreve

Funciona como uma revisão de professor: o título está num tamanho bom? O resumo foi
preenchido? As fotos têm descrição? Os links funcionam? Tudo numa listinha com sinais de
"ok", "atenção" e "corrigir".

## A história da chave

Para pensar, o assistente precisa de acesso a uma inteligência artificial do Google, que é
paga por uso — como uma conta de luz. Esse acesso vem na forma de uma "chave" (um código
pessoal):

- A chave é **sua** (você cria no site do Google).
- Ela fica **trancada num cofre** dentro do navegador, protegida por uma senha que só você sabe.
- Na hora de usar, o cofre abre por um instante, a chave é usada e tudo se tranca de novo.
- A página do Blogger **nunca vê a chave** — é como pagar uma compra sem entregar o cartão na
  mão do vendedor.

## O que já está pronto

- **O assistente em si** — montado por completo e conferido por dentro (não dá erro de montagem).
- **O "livro de regras"** — um documento que explica as decisões do projeto e as regras que
  ninguém pode quebrar ao mexer nele. É o que mantém tudo no trilho, mesmo que outra pessoa
  (ou outra inteligência artificial) trabalhe no projeto depois.
- **O "roteiro de testes"** — um passo a passo para conferir, no navegador de verdade, se cada
  parte funciona. Como a revisão geral antes da estreia.
- **O cofre da chave já foi testado** — trancar, destrancar e recusar senha errada: tudo passou.

## O que falta

**Levar o assistente para dentro do Blogger de verdade e testar com um post de verdade.**
Isso só você pode fazer, porque precisa da sua conta. O roteiro está pronto: dá para seguir na
ordem, testando uma parte de cada vez — e qualquer coisa que não funcionar a gente conserta
na hora (o caminho está em `docs/PROMPTS_AGENTE.md`).

<details>
<summary>Ver os nomes técnicos (para curiosos)</summary>

| Na explicação | Nome técnico |
|---|---|
| Assistente que aparece na página | content script |
| Mensageiro que trabalha nos bastidores | service worker |
| Janelinha de configurações | popup |
| Cofre da chave | chrome.storage.local + criptografia AES-GCM |
| Acesso pago à IA | chave de API do Google Gemini (BYOK) |

</details>
