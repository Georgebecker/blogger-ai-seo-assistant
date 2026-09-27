# Entenda o projeto (em palavras simples)

Esta é a explicação da extensão para quem não é da área — sem termos técnicos. O detalhe
técnico fica nos documentos da pasta `docs/` (instalação, uso, arquitetura e segurança).

## O que é

Um assistente que se senta ao lado de quem escreve um post no Blogger (o serviço de blogs do
Google). Ele sugere, arruma, confere — e, quando você quiser, também escreve um primeiro
rascunho do post para você. Só aparece quando você está na tela de escrever o post; no resto
do navegador, fica quietinho.

## O que ele faz na prática

### 1. Escreve um rascunho inteiro do post para você

Você diz o assunto e o que precisa aparecer no texto — e pode até "ensinar" o seu jeito de
escrever, deixando o assistente ler os posts que você já publicou. Ele devolve um post
completo: título, resumo, endereço curto (o "slug"), palavras-chave e o texto já organizado,
com 1 a 2 fontes externas para dar credibilidade.

### 2. Deixa o texto mais fácil de achar no Google

Você digita qual é o assunto principal do post. O assistente lê o texto e sugere:

- um título melhor;
- um resumo curto (o textinho que aparece embaixo do link na busca);
- observações sobre o que dá para melhorar.

As sugestões aparecem numa janelinha — e nada entra no post sem você mandar.

### 3. Cuida das fotos: descreve as antigas e cria novas

Pessoas cegas usam programas que "leem" a tela; para isso, cada foto precisa de uma descrição
invisível. O assistente olha cada imagem sem descrição, entende o que tem nela e sugere uma
frase curta. Você revisa, aplica — e ainda pode gerar uma legenda. Ele também cria imagens
novas a partir do assunto do post (ou de um comando seu) para você inserir no texto.

### 4. Confere uma lista de boas práticas enquanto você escreve

Funciona como uma revisão de professor: o título está num tamanho bom? O resumo foi
preenchido? As fotos têm descrição? Os links funcionam? Tudo numa listinha com sinais de
"ok", "atenção" e "corrigir".

## A história da chave

Para pensar, o assistente precisa de acesso a uma inteligência artificial (Google Gemini ou
DeepSeek — você escolhe o principal no popup e pode deixar o outro como reserva), que é paga
por uso — como uma conta de luz. Esse acesso
vem na forma de uma "chave" (um código pessoal):

- A chave é **sua** (você cria no site do provedor escolhido).
- Ela fica **trancada num cofre** dentro do navegador, protegida por uma senha que só você sabe.
- Na hora de usar, o cofre abre por um instante, a chave é usada e tudo se tranca de novo.
- A página do Blogger **nunca vê a chave** — é como pagar uma compra sem entregar o cartão na
  mão do vendedor.

## O que já está pronto

- **O assistente em si** — funciona de ponta a ponta: otimizar texto, criar posts, criar
  imagens, descrever fotos e a lista de conferência.
- **Testado no Blogger de verdade** — com posts reais, ajustando o que apareceu pelo caminho.
- **O "livro de regras"** — um documento que explica as decisões do projeto e as regras que
  ninguém pode quebrar ao mexer nele. É o que mantém tudo no trilho, mesmo que outra pessoa
  (ou outra inteligência artificial) trabalhe no projeto depois.
- **O cofre da chave** — trancar, destrancar e recusar senha errada: tudo testado.

## O que falta

- **Um ajuste no salvamento:** em alguns casos, depois de o assistente inserir o texto, o
  Blogger salva só o título e o corpo some do rascunho (em investigação; por enquanto, o
  caminho garantido é copiar e colar o texto antes de salvar).
- **Publicar na loja do Chrome:** o pacote e os textos já estão prontos; faltam a conta de
  desenvolvedor e o envio para revisão (veja `PUBLICACAO.md`), além da revisão fina de
  pontuação do texto.

<details>
<summary>Ver os nomes técnicos (para curiosos)</summary>

| Na explicação | Nome técnico |
|---|---|
| Assistente que aparece na página | content script |
| Mensageiro que trabalha nos bastidores | service worker |
| Janelinha de configurações | popup |
| Cofre da chave | chrome.storage.local + criptografia AES-GCM |
| Acesso pago à IA | chave de API do Google Gemini ou do DeepSeek (BYOK) |

</details>
