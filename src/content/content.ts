// content.ts — injetado apenas nas URLs do editor do Blogger.
// Responsabilidades: localizar o editor (inclusive dentro de iframes same-origin,
// DevLog item 1), construir a UI, ler/escrever no post com Range/Selection e
// conversar com o service worker (que centraliza a IA por causa do CORS, DevLog item 3).

import './content.css';
import type {
  CriacaoPost,
  MensagemParaFundo,
  PerfilEstilo,
  PromptImagem,
  RespostaFundo,
  ResultadoImagem,
  ResultadoLink,
  ResultadoLinks,
  StatusChave,
  SugestaoAlt,
  SugestaoTexto,
} from '../lib/messages';

declare global {
  interface Window {
    __baiSeoAtivo?: boolean;
  }
}

const RAIZ_ID = 'bai-seo-root';
const CHAVE_KEYWORD = 'bai.keyword';
const CHAVE_PERSONA = 'bai.persona';
const CHAVE_META = 'bai.metaDescricao';
const LIMITE_TEXTO = 15000;
const MAX_IMAGENS = 15;
const MAX_LINKS_UI = 20;
const INTERVALO_VARREDURA = 2500;

type AbaId = 'texto' | 'criar' | 'imagens' | 'checklist';
type StatusItem = 'ok' | 'aviso' | 'falha' | 'info' | 'erro';

interface ItemImagem {
  img: HTMLImageElement;
  src: string;
  alt: string;
  sugestao: SugestaoAlt | null;
  aplicado: boolean;
  status: 'novo' | 'gerando' | 'ok' | 'erro';
  erro: string | null;
}

interface ItemChecklist {
  id: string;
  rotulo: string;
  status: StatusItem;
  detalhe: string;
}

interface ResultadoAnaliseLinks {
  problemas: string[];
  resumo: string;
  internos: number;
}

interface ImagemCriada {
  fonte: 'modelo' | 'arquivo' | 'padrao';
  dataUrl: string;
  alt: string;
  modelo: string;
}

interface Estado {
  abaAtual: AbaId;
  janela: Window | null;
  editor: HTMLElement | null;
  editorManual: boolean;
  campoDesc: HTMLTextAreaElement | HTMLInputElement | null;
  keyword: string;
  imagens: ItemImagem[];
  totalImagens: number;
  relogioCheck: number;
  urlAtual: string;
  ocupado: boolean;
  verificandoLinks: boolean;
  linksExternos: string[];
  resultadoLinks: ResultadoLink[] | null;
  linksTemPermissao: boolean;
  imagemCriada: ImagemCriada | null;
  altImagem: string;
  gerandoImagem: boolean;
  metaCache: { pagina: string; valor: string } | null;
}

const estado: Estado = {
  abaAtual: 'texto',
  janela: null,
  editor: null,
  editorManual: false,
  campoDesc: null,
  keyword: '',
  imagens: [],
  totalImagens: 0,
  relogioCheck: 0,
  urlAtual: location.href,
  ocupado: false,
  verificandoLinks: false,
  linksExternos: [],
  resultadoLinks: null,
  linksTemPermissao: false,
  imagemCriada: null,
  altImagem: '',
  gerandoImagem: false,
  metaCache: null,
};

interface Refs {
  raiz: HTMLDivElement;
  painel: HTMLElement;
  botao: HTMLButtonElement;
  pill: HTMLElement;
  abas: HTMLButtonElement[];
  secoes: Record<AbaId, HTMLElement>;
  keyword: HTMLInputElement;
  botaoOtimizar: HTMLButtonElement;
  statusTexto: HTMLElement;
  resultadoTexto: HTMLElement;
  persona: HTMLTextAreaElement;
  assunto: HTMLInputElement;
  pontos: HTMLTextAreaElement;
  botaoAprender: HTMLButtonElement;
  botaoGerarPost: HTMLButtonElement;
  statusCriar: HTMLElement;
  resultadoCriar: HTMLElement;
  botaoEscanear: HTMLButtonElement;
  botaoGerarTodas: HTMLButtonElement;
  botaoAplicarTodas: HTMLButtonElement;
  statusImagens: HTMLElement;
  listaImagens: HTMLElement;
  promptImagem: HTMLTextAreaElement;
  proporcaoImagem: HTMLSelectElement;
  botaoPromptImagem: HTMLButtonElement;
  botaoGerarImagem: HTMLButtonElement;
  botaoEscolherImagem: HTMLButtonElement;
  botaoImagemPadrao: HTMLButtonElement;
  arquivoImagem: HTMLInputElement;
  statusImagem: HTMLElement;
  previewImagem: HTMLElement;
  resumoCheck: HTMLElement;
  checkAtualizado: HTMLElement;
  listaCheck: HTMLElement;
}

// Preenchido durante a construção da UI (montarUI).
const refs = {} as Refs;

// ---------------------------------------------------------------------------
// Utilidades gerais
// ---------------------------------------------------------------------------

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AtributosCriar {
  className?: string;
  texto?: string;
  [chave: string]: string | EventListener | undefined;
}

function criar(tag: string, atributos: AtributosCriar = {}, filhos: Array<Node | string | null> = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor === undefined) continue;
    if (chave === 'className' && typeof valor === 'string') el.className = valor;
    else if (chave === 'texto' && typeof valor === 'string') el.textContent = valor;
    else if (chave.startsWith('on') && typeof valor === 'function') el.addEventListener(chave.slice(2), valor);
    else if (typeof valor === 'string') el.setAttribute(chave, valor);
  }
  for (const filho of filhos) {
    if (filho === null) continue;
    el.appendChild(typeof filho === 'string' ? document.createTextNode(filho) : filho);
  }
  return el;
}

function definirStatus(elemento: HTMLElement, texto: string, tipo = 'info'): void {
  elemento.textContent = texto;
  elemento.className = 'bai-status bai-' + tipo;
}

function ocupar(botao: HTMLButtonElement, ocupado: boolean, rotulo?: string): void {
  if (ocupado) {
    botao.disabled = true;
    botao.dataset.anterior = botao.textContent || '';
    if (rotulo) botao.textContent = rotulo;
  } else {
    botao.disabled = false;
    if (botao.dataset.anterior) {
      botao.textContent = botao.dataset.anterior;
      delete botao.dataset.anterior;
    }
  }
}

function statusDaAba(): HTMLElement {
  return estado.abaAtual === 'imagens' ? refs.statusImagens : refs.statusTexto;
}

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caractere) => {
    const mapa: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return mapa[caractere] || caractere;
  });
}

async function copiar(texto: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    definirStatus(statusDaAba(), 'Copiado para a área de transferência.', 'ok');
    return;
  } catch {
    // tenta o caminho antigo abaixo
  }
  try {
    const area = criar('textarea', { className: 'bai-copia' }) as HTMLTextAreaElement;
    area.value = texto;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    definirStatus(statusDaAba(), 'Copiado para a área de transferência.', 'ok');
  } catch {
    definirStatus(statusDaAba(), 'Não consegui copiar. Selecione o texto manualmente.', 'erro');
  }
}

function mensagemDeRuntime(texto: string | undefined): string {
  if (/context invalidated|Receiving end does not exist/i.test(texto || '')) {
    return 'A extensão foi atualizada. Atualize esta página (F5) e tente de novo.';
  }
  return texto || 'Falha de comunicação com a extensão.';
}

function enviarParaFundo<T>(mensagem: MensagemParaFundo): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(mensagem, (resposta: RespostaFundo<T> | undefined) => {
        const erro = chrome.runtime.lastError;
        if (erro) {
          reject(new Error(mensagemDeRuntime(erro.message)));
          return;
        }
        if (!resposta) {
          reject(new Error('O serviço da extensão não respondeu.'));
          return;
        }
        if (resposta.ok !== true) {
          reject(new Error(resposta.error || 'Falha inesperada.'));
          return;
        }
        resolve(resposta.data);
      });
    } catch {
      reject(new Error('A extensão foi atualizada. Atualize esta página (F5) e tente de novo.'));
    }
  });
}

// ---------------------------------------------------------------------------
// Localização do editor (com busca recursiva de janelas / iframes)
// ---------------------------------------------------------------------------

function visivel(elemento: Element | null): elemento is HTMLElement {
  if (!elemento || !(elemento instanceof HTMLElement)) return false;
  const retangulo = elemento.getBoundingClientRect();
  if (retangulo.width === 0 || retangulo.height === 0) return false;
  const janela = elemento.ownerDocument.defaultView;
  if (!janela) return false;
  const estilo = janela.getComputedStyle(elemento);
  return estilo.visibility !== 'hidden' && estilo.display !== 'none';
}

// Percorre window.frames em profundidade (apenas origens acessíveis — DevLog item 1).
function janelasAlcancaveis(): Window[] {
  const encontradas: Window[] = [];
  const fila: Window[] = [window];
  while (fila.length) {
    const janela = fila.shift() as Window;
    encontradas.push(janela);
    let quadros: Window | null = null;
    try {
      quadros = janela.frames;
    } catch {
      continue;
    }
    if (!quadros) continue;
    for (let i = 0; i < quadros.length; i += 1) {
      let filho: Window | null = null;
      try {
        filho = quadros[i] as Window;
      } catch {
        filho = null;
      }
      if (!filho) continue;
      try {
        void filho.document;
        fila.push(filho);
      } catch {
        // iframe de outra origem: ignorado
      }
    }
  }
  return encontradas;
}

interface CandidatoEditor {
  janela: Window;
  el: HTMLElement;
  pontuacao: number;
}

const SELETOR_EDITAVEIS =
  '[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""], [contenteditable]:not([contenteditable="false"])';

// Coleta elementos editáveis, inclusive dentro de shadow DOM aberto (interface nova do Blogger).
function coletarEditaveis(doc: Document): HTMLElement[] {
  const encontrados: HTMLElement[] = [];
  const fila: Array<Document | ShadowRoot> = [doc];
  let visitados = 0;
  while (fila.length && visitados < 20000) {
    const raiz = fila.shift() as Document | ShadowRoot;
    try {
      for (const el of Array.from(raiz.querySelectorAll(SELETOR_EDITAVEIS))) {
        encontrados.push(el as HTMLElement);
        visitados += 1;
      }
      for (const el of Array.from(raiz.querySelectorAll('*'))) {
        visitados += 1;
        if (visitados > 20000) break;
        const raizSombra = (el as HTMLElement).shadowRoot;
        if (raizSombra) fila.push(raizSombra);
      }
    } catch {
      // raiz inacessível; ignora
    }
  }
  return encontrados;
}

function escolherEditor(): CandidatoEditor | null {
  const candidatos: CandidatoEditor[] = [];
  for (const janela of janelasAlcancaveis()) {
    let doc: Document | null = null;
    try {
      doc = janela.document;
    } catch {
      continue;
    }
    if (!doc) continue;
    for (const el of coletarEditaveis(doc)) {
      if (!visivel(el)) continue;
      if (el.closest('#' + RAIZ_ID)) continue;
      const retangulo = el.getBoundingClientRect();
      if (retangulo.width < 200 || retangulo.height < 60) continue;
      const texto = (el.innerText || '').trim();
      const pontuacao = texto.length * 6 + (retangulo.width * retangulo.height) / 400;
      candidatos.push({ janela, el, pontuacao });
    }
  }
  candidatos.sort((a, b) => b.pontuacao - a.pontuacao);
  return candidatos[0] || null;
}

let buscaFalhouEm = 0;

function localizarEditor(): HTMLElement | null {
  if (estado.editorManual && estado.editor && estado.editor.isConnected) return estado.editor;
  if (estado.editor && estado.editor.isConnected && visivel(estado.editor)) return estado.editor;
  const agora = Date.now();
  if (!estado.editor && agora - buscaFalhouEm < 800) return null;
  const escolhido = escolherEditor();
  if (escolhido) {
    estado.editor = escolhido.el;
    estado.janela = escolhido.janela;
    return estado.editor;
  }
  estado.editor = null;
  estado.janela = null;
  buscaFalhouEm = agora;
  return null;
}

// Procura o editor ignorando a espera de 800 ms (usado em ações diretas do usuário).
function localizarEditorForcado(): HTMLElement | null {
  if (!estado.editorManual) {
    estado.editor = null;
    estado.janela = null;
    buscaFalhouEm = 0;
  }
  return localizarEditor();
}

function lerTextoDoEditor(editor: HTMLElement): string {
  const bruto = editor.innerText || '';
  return bruto
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function notificarEditor(editor: HTMLElement): void {
  try {
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ---------------------------------------------------------------------------
// Campos de título e meta-descrição
// ---------------------------------------------------------------------------

const PISTAS_TITULO = /t[íi]tulo|title|titulo/i;
const PISTAS_DESCRICAO = /descri[çc][ãa]o da pesquisa|search[ _-]?desc|search description/i;

function anotacoes(el: Element): string {
  return [
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    (el as HTMLInputElement).name,
    el.id,
  ]
    .filter(Boolean)
    .join(' ');
}

type CampoTitulo = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function documentoDe(janela: Window | null): Document | null {
  if (!janela) return null;
  try {
    return janela.document;
  } catch {
    return null;
  }
}

// Campos que podem ser o título: entradas de texto e áreas editáveis pequenas.
function coletarCamposTitulo(doc: Document): CampoTitulo[] {
  const seletor = [
    'input[type="text"]',
    'input:not([type])',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[contenteditable=""]',
  ].join(', ');
  const campos: CampoTitulo[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(seletor))) {
    if (!visivel(el) || el.closest('#' + RAIZ_ID)) continue;
    if (el === estado.editor) continue;
    if (estado.editor && (el.contains(estado.editor) || estado.editor.contains(el))) continue;
    campos.push(el);
  }
  return campos;
}

function pareceCampoDeTitulo(el: CampoTitulo): boolean {
  const retangulo = el.getBoundingClientRect();
  return retangulo.width >= 180 && retangulo.height > 0 && retangulo.height <= 160;
}

function localizarCampoTitulo(janela: Window | null, editor: HTMLElement | null): CampoTitulo | null {
  const janelas: Window[] = [];
  if (janela) janelas.push(janela);
  for (const outra of janelasAlcancaveis()) {
    if (outra !== janela) janelas.push(outra);
  }

  // 1) campo com pista no nome ("título", "title")
  for (const j of janelas) {
    const doc = documentoDe(j);
    if (!doc) continue;
    const comPista = coletarCamposTitulo(doc).find((el) => PISTAS_TITULO.test(anotacoes(el)));
    if (comPista && pareceCampoDeTitulo(comPista)) return comPista;
  }

  // 2) campo de texto logo acima do editor (o título fica em cima do texto)
  if (editor) {
    const topoEditor = editor.getBoundingClientRect().top;
    const acima: CampoTitulo[] = [];
    for (const j of janelas) {
      const doc = documentoDe(j);
      if (!doc) continue;
      for (const el of coletarCamposTitulo(doc)) {
        if (!pareceCampoDeTitulo(el)) continue;
        const retangulo = el.getBoundingClientRect();
        if (retangulo.bottom <= topoEditor + 48) acima.push(el);
      }
    }
    if (acima.length) {
      acima.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      return acima[0];
    }
  }

  // 3) último recurso: primeiro campo de texto largo da página
  for (const j of janelas) {
    const doc = documentoDe(j);
    if (!doc) continue;
    const largo = coletarCamposTitulo(doc).find(
      (el) => pareceCampoDeTitulo(el) && el.getBoundingClientRect().width >= 280,
    );
    if (largo) return largo;
  }
  return null;
}

function lerTitulo(): string {
  const campo = localizarCampoTitulo(estado.janela, estado.editor);
  if (!campo) return '';
  const valor = (campo as HTMLInputElement).value;
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  return String(campo.textContent || '').trim();
}

function localizarCampoDescricao(janela: Window | null): HTMLTextAreaElement | HTMLInputElement | null {
  if (estado.campoDesc && estado.campoDesc.isConnected && visivel(estado.campoDesc)) return estado.campoDesc;
  const alvo = janela || estado.janela || window;
  let doc: Document | null = null;
  try {
    doc = alvo.document;
  } catch {
    return null;
  }
  if (!doc) return null;
  const campos = Array.from(
    doc.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"]'),
  ).filter((el) => visivel(el) && !el.closest('#' + RAIZ_ID));
  const campo = campos.find((el) => PISTAS_DESCRICAO.test(anotacoes(el)));
  estado.campoDesc = campo || null;
  return estado.campoDesc;
}

function acharClicavelPorTexto(janela: Window, regex: RegExp): HTMLElement | null {
  let doc: Document | null = null;
  try {
    doc = janela.document;
  } catch {
    return null;
  }
  if (!doc) return null;
  const candidatos = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"], a, span, div, label'));
  for (const el of candidatos) {
    if (el.closest('#' + RAIZ_ID)) continue;
    const texto = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!texto || texto.length > 40) continue;
    if (!regex.test(texto)) continue;
    if (!visivel(el)) continue;
    const clicavel = (el.closest('button, [role="button"], a') as HTMLElement | null) || el;
    if (!visivel(clicavel)) continue;
    return clicavel;
  }
  return null;
}

// Se o campo não estiver visível, abre "Configurações do post" > "Descrição da pesquisa".
async function garantirCampoDescricao(): Promise<HTMLTextAreaElement | HTMLInputElement | null> {
  const janela = estado.janela || window;
  let campo = localizarCampoDescricao(janela);
  if (campo) return campo;

  const botaoAjustes = acharClicavelPorTexto(janela, /configura[çc][õo]es do post|post settings/i);
  if (botaoAjustes) {
    botaoAjustes.click();
    await dormir(450);
    campo = localizarCampoDescricao(janela);
  }
  if (campo) return campo;

  const linkDescricao = acharClicavelPorTexto(janela, /descri[çc][ãa]o da pesquisa|search description/i);
  if (linkDescricao) {
    linkDescricao.click();
    await dormir(450);
    campo = localizarCampoDescricao(janela);
  }
  return campo || null;
}

function definirValorNativo(campo: HTMLInputElement | HTMLTextAreaElement, valor: string): void {
  const janela = campo.ownerDocument.defaultView || window;
  const proto = campo.tagName === 'TEXTAREA' ? janela.HTMLTextAreaElement.prototype : janela.HTMLInputElement.prototype;
  const descritor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descritor && descritor.set) descritor.set.call(campo, valor);
  else campo.value = valor;
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  campo.dispatchEvent(new Event('change', { bubbles: true }));
}

// Escreve dentro de um contenteditable usando Range + Selection (DevLog item 1).
function inserirTexto(elemento: HTMLElement, texto: string): void {
  const doc = elemento.ownerDocument;
  elemento.focus();
  const selecao = doc.getSelection();
  const intervalo = doc.createRange();
  intervalo.selectNodeContents(elemento);
  if (selecao) {
    selecao.removeAllRanges();
    selecao.addRange(intervalo);
  }
  let aplicado = false;
  try {
    aplicado = doc.execCommand('insertText', false, texto);
  } catch {
    aplicado = false;
  }
  if (!aplicado) {
    elemento.textContent = texto;
    notificarEditor(elemento);
  }
}

function aplicarTextoNoEditor(editor: HTMLElement, texto: string): void {
  const doc = editor.ownerDocument;
  editor.focus();
  const selecao = doc.getSelection();
  const intervalo = doc.createRange();
  intervalo.selectNodeContents(editor);
  if (selecao) {
    selecao.removeAllRanges();
    selecao.addRange(intervalo);
  }
  const paragrafos = texto
    .split(/\n{2,}/)
    .map((paragrafo) => paragrafo.trim())
    .filter(Boolean);
  const html = paragrafos.map((p) => '<p>' + escaparHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
  let aplicado = false;
  try {
    aplicado = doc.execCommand('insertHTML', false, html);
  } catch {
    aplicado = false;
  }
  if (!aplicado) {
    try {
      aplicado = doc.execCommand('insertText', false, texto);
    } catch {
      aplicado = false;
    }
  }
  if (!aplicado) {
    if (selecao) selecao.removeAllRanges();
    editor.textContent = texto;
    notificarEditor(editor);
  }
}

function primeiroBlocoDeTexto(editor: HTMLElement): string {
  const blocos = Array.from(editor.querySelectorAll<HTMLElement>('p, div, li'));
  for (const bloco of blocos) {
    if (bloco.querySelector('p, div, li')) continue;
    const texto = (bloco.textContent || '').trim();
    if (texto.length > 40) return texto;
  }
  return lerTextoDoEditor(editor).slice(0, 200);
}

// ---------------------------------------------------------------------------
// Aba Texto
// ---------------------------------------------------------------------------

async function otimizarTexto(): Promise<void> {
  const editor = localizarEditor();
  if (!editor) {
    definirStatus(
      refs.statusTexto,
      'Não encontrei o editor. Abra a página de edição do post ou use "Apontar manualmente" no rodapé do painel.',
      'erro',
    );
    return;
  }
  const palavra = estado.keyword.trim();
  if (!palavra) {
    definirStatus(refs.statusTexto, 'Informe a palavra-chave principal do post.', 'aviso');
    refs.keyword.focus();
    return;
  }
  const texto = lerTextoDoEditor(editor);
  if (texto.length < 40) {
    definirStatus(refs.statusTexto, 'O texto do post está muito curto para analisar.', 'aviso');
    return;
  }
  const cortado = texto.length > LIMITE_TEXTO;
  estado.ocupado = true;
  ocupar(refs.botaoOtimizar, true, 'Analisando...');
  definirStatus(refs.statusTexto, 'Enviando o texto para a IA...', 'info');
  try {
    const dados = await enviarParaFundo<SugestaoTexto>({
      type: 'AI_OPTIMIZE_TEXT',
      text: texto.slice(0, LIMITE_TEXTO),
      title: lerTitulo(),
      keyword: palavra,
    });
    renderizarResultados(dados);
    definirStatus(
      refs.statusTexto,
      'Sugestões prontas. Revise antes de aplicar.' +
        (cortado ? ' Texto longo: a análise cobriu os primeiros 15 mil caracteres.' : ''),
      'ok',
    );
  } catch (erro) {
    definirStatus(refs.statusTexto, (erro as Error).message, 'erro');
  } finally {
    estado.ocupado = false;
    ocupar(refs.botaoOtimizar, false);
  }
}

interface AcaoCard {
  rotulo: string;
  acao: () => void;
  principal?: boolean;
}

function botaoAcao(rotulo: string, acao: (() => void) | null, desabilitado = false): HTMLButtonElement {
  const botao = criar('button', {
    className: 'bai-botao',
    texto: rotulo,
    type: 'button',
  }) as HTMLButtonElement;
  if (acao) botao.addEventListener('click', acao);
  botao.disabled = desabilitado;
  return botao;
}

function cardTexto(rotulo: string, metaInfo: string, texto: string, acoes: AcaoCard[]): HTMLElement {
  const cartao = criar('section', { className: 'bai-card' });
  const cabecalho = criar('div', { className: 'bai-card-cabeco' }, [
    criar('strong', { texto: rotulo }),
    criar('span', { texto: metaInfo }),
  ]);
  const corpo = criar('div', { className: 'bai-texto', texto });
  const caixaAcoes = criar('div', { className: 'bai-acoes' });
  for (const acao of acoes) {
    caixaAcoes.appendChild(criarBotaoComClasse(acao));
  }
  cartao.append(cabecalho, corpo, caixaAcoes);
  return cartao;
}

function criarBotaoComClasse(acao: AcaoCard): HTMLButtonElement {
  const botao = botaoAcao(acao.rotulo, acao.acao);
  if (acao.principal) botao.classList.add('bai-principal');
  return botao;
}

function cardLista(rotulo: string, itens: string[]): HTMLElement {
  const cartao = criar('section', { className: 'bai-card' });
  const cabecalho = criar('div', { className: 'bai-card-cabeco' }, [
    criar('strong', { texto: rotulo }),
  ]);
  const lista = criar('ul', { className: 'bai-lista' });
  for (const item of itens) {
    lista.appendChild(criar('li', { texto: item }));
  }
  cartao.append(cabecalho, lista);
  return cartao;
}

function renderizarResultados(dados: SugestaoTexto): void {
  const caixa = refs.resultadoTexto;
  caixa.textContent = '';

  if (dados.title) {
    caixa.appendChild(
      cardTexto('Título sugerido', dados.title.length + ' caracteres', dados.title, [
        { rotulo: 'Aplicar no título', acao: () => aplicarTitulo(dados.title), principal: true },
        { rotulo: 'Copiar', acao: () => void copiar(dados.title) },
      ]),
    );
  }
  if (dados.meta_description) {
    caixa.appendChild(
      cardTexto('Meta-descrição', dados.meta_description.length + ' caracteres', dados.meta_description, [
        { rotulo: 'Aplicar', acao: () => void aplicarMetaDescricao(dados.meta_description), principal: true },
        { rotulo: 'Copiar', acao: () => void copiar(dados.meta_description) },
      ]),
    );
  }
  if (dados.improved_text) {
    const cartao = cardTexto('Texto otimizado', 'confira antes de aplicar', dados.improved_text, [
      { rotulo: 'Substituir o texto do post', acao: () => substituirTexto(dados.improved_text), principal: true },
      { rotulo: 'Copiar', acao: () => void copiar(dados.improved_text) },
    ]);
    cartao.appendChild(
      criar('p', {
        className: 'bai-dica',
        texto: 'A substituição afeta o post inteiro; use Ctrl+Z no editor para desfazer.',
      }),
    );
    caixa.appendChild(cartao);
  }
  if (dados.headings.length) caixa.appendChild(cardLista('Subtítulos sugeridos (H2)', dados.headings));
  if (dados.notes.length) caixa.appendChild(cardLista('Observações', dados.notes));
}

function aplicarTitulo(valor: string): void {
  const campo = localizarCampoTitulo(estado.janela, estado.editor);
  if (!campo) {
    definirStatus(refs.statusTexto, 'Não encontrei o campo de título nesta tela.', 'erro');
    return;
  }
  gravarTitulo(campo, valor);
  definirStatus(refs.statusTexto, 'Título aplicado. O Blogger monta o endereço (slug) a partir dele.', 'ok');
  agendarChecklist();
}

function gravarTitulo(campo: CampoTitulo, valor: string): void {
  if (campo.isContentEditable) inserirTexto(campo, valor);
  else definirValorNativo(campo as HTMLInputElement | HTMLTextAreaElement, valor);
}

async function aplicarMetaDescricao(valor: string): Promise<void> {
  definirStatus(refs.statusTexto, 'Procurando o campo de meta-descrição...', 'info');
  const campo = await garantirCampoDescricao();
  if (!campo) {
    definirStatus(
      refs.statusTexto,
      'Não achei o campo. Abra "Configurações do post" e a seção "Descrição da pesquisa"; a sugestão também está no botão Copiar.',
      'aviso',
    );
    return;
  }
  if (campo.isContentEditable) inserirTexto(campo, valor);
  else definirValorNativo(campo, valor);
  salvarMetaCache(valor);
  definirStatus(refs.statusTexto, 'Meta-descrição aplicada (o checklist já conta com ela).', 'ok');
  agendarChecklist();
}

function salvarMetaCache(valor: string): void {
  estado.metaCache = { pagina: location.pathname, valor };
  gravarArmazenamentoLocal({ [CHAVE_META]: { pagina: location.pathname, valor } });
}

async function lerMetaCache(): Promise<void> {
  const dados = await lerArmazenamentoLocal(CHAVE_META);
  const bruto = dados[CHAVE_META] as { pagina?: unknown; valor?: unknown } | undefined;
  if (bruto && bruto.pagina === location.pathname && typeof bruto.valor === 'string') {
    estado.metaCache = { pagina: location.pathname, valor: bruto.valor };
  } else {
    estado.metaCache = null;
  }
}

// Abre "Configurações do post", lê a meta-descrição de verdade e atualiza o checklist.
async function conferirMetaDescricao(): Promise<void> {
  if (refs.checkAtualizado) refs.checkAtualizado.textContent = 'Procurando a meta-descrição...';
  const campo = await garantirCampoDescricao();
  if (!campo) {
    if (refs.checkAtualizado) {
      refs.checkAtualizado.textContent =
        'Não achei a meta-descrição. Abra "Configurações do post" > "Descrição da pesquisa" e clique de novo.';
    }
    return;
  }
  const valor = String(campo.value || campo.textContent || '').trim();
  salvarMetaCache(valor);
  renderizarChecklist();
}

function substituirTexto(texto: string): void {
  const editor = localizarEditor();
  if (!editor) {
    definirStatus(refs.statusTexto, 'Não encontrei o editor.', 'erro');
    return;
  }
  const confirmado = window.confirm(
    'Substituir todo o texto do post pela versão otimizada? O Blogger permite desfazer com Ctrl+Z.',
  );
  if (!confirmado) return;
  aplicarTextoNoEditor(editor, texto);
  definirStatus(refs.statusTexto, 'Texto do post substituído. Confira e salve o rascunho.', 'ok');
  agendarChecklist();
}

// ---------------------------------------------------------------------------
// Aba Imagens
// ---------------------------------------------------------------------------

interface ColetaImagens {
  todas: HTMLImageElement[];
  semAlt: HTMLImageElement[];
}

function coletarImagens(editor: HTMLElement): ColetaImagens {
  const todas: HTMLImageElement[] = [];
  const semAlt: HTMLImageElement[] = [];
  for (const img of Array.from(editor.querySelectorAll<HTMLImageElement>('img'))) {
    if (img.closest('#' + RAIZ_ID)) continue;
    if (img.closest('[role="toolbar"]')) continue;
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!/^(https?:|data:image)/i.test(src)) continue;
    const retangulo = img.getBoundingClientRect();
    if (retangulo.width < 60 || retangulo.height < 60) continue;
    todas.push(img);
    const alt = (img.getAttribute('alt') || '').trim();
    if (!alt) semAlt.push(img);
  }
  return { todas, semAlt };
}

function escanearImagens(tentativa = 0): void {
  const editor = localizarEditorForcado();
  if (!editor) {
    if (tentativa < 2) {
      definirStatus(refs.statusImagens, 'Procurando a área de escrita do post...', 'info');
      window.setTimeout(() => escanearImagens(tentativa + 1), 1200);
      return;
    }
    definirStatus(
      refs.statusImagens,
      'Não achei a área de escrita do post nesta página. Se isso já funcionou antes, clique em "Apontar manualmente" no rodapé do painel e clique na área onde você escreve. ' +
        'A caixa "Imagem nova para o post" funciona mesmo assim: você pode gerar ou escolher a imagem agora.',
      'aviso',
    );
    return;
  }
  const coleta = coletarImagens(editor);
  estado.totalImagens = coleta.todas.length;
  estado.imagens = coleta.semAlt.map((img) => ({
    img,
    src: img.currentSrc || img.getAttribute('src') || '',
    alt: '',
    sugestao: null,
    aplicado: false,
    status: 'novo' as const,
    erro: null,
  }));
  renderizarListaImagens();
  definirStatus(
    refs.statusImagens,
    coleta.todas.length + ' imagem(ns) no post, ' + coleta.semAlt.length + ' sem descrição (alt).',
    coleta.semAlt.length ? 'aviso' : 'ok',
  );
}

function resumoDoEndereco(src: string): string {
  if (src.startsWith('data:')) return 'imagem colada (data URI)';
  try {
    const url = new URL(src);
    return (url.hostname + url.pathname).slice(0, 60);
  } catch {
    return src.slice(0, 60);
  }
}

function renderizarListaImagens(): void {
  const caixa = refs.listaImagens;
  caixa.textContent = '';
  estado.imagens.forEach((item, indice) => {
    const linha = criar('div', { className: 'bai-img-item' }) as HTMLDivElement;

    const miniatura = criar('img', {
      className: 'bai-thumb',
      src: item.src,
      alt: 'Miniatura da imagem ' + (indice + 1),
    }) as HTMLImageElement;

    const info = criar('div', { className: 'bai-img-info' });
    const titulo = criar('strong', {
      texto: 'Imagem ' + (indice + 1) + (item.aplicado ? ' (alt aplicado)' : ''),
    });
    const dominio = criar('span', { className: 'bai-dominio', texto: resumoDoEndereco(item.src) });
    info.append(titulo, dominio);

    if (item.sugestao) {
      const caixaSugestao = criar('div', { className: 'bai-sugestao' });
      const linhaAlt = criar('div');
      linhaAlt.append(criar('b'), document.createTextNode('alt: ' + item.sugestao.alt));
      caixaSugestao.appendChild(linhaAlt);
      if (item.sugestao.caption) {
        const linhaLegenda = criar('div');
        linhaLegenda.append(criar('b'), document.createTextNode('legenda: ' + item.sugestao.caption));
        caixaSugestao.appendChild(linhaLegenda);
      }
      info.appendChild(caixaSugestao);
    }

    if (item.status === 'erro' && item.erro) {
      info.appendChild(criar('div', { className: 'bai-check-detalhe', texto: item.erro }));
    }

    const acoes = criar('div', { className: 'bai-acoes-img' });
    if (item.status === 'gerando') {
      acoes.appendChild(botaoAcao('Gerando...', null, true));
    } else {
      acoes.appendChild(
        botaoAcao(item.sugestao ? 'Gerar de novo' : 'Gerar sugestão', () => void gerarSugestaoImagem(item)),
      );
    }
    acoes.appendChild(
      botaoAcao('Aplicar no alt', () => aplicarAlt(item), !item.sugestao || item.aplicado || item.status === 'gerando'),
    );
    acoes.appendChild(
      botaoAcao(
        'Inserir legenda',
        () => inserirLegenda(item),
        !item.sugestao || !item.sugestao.caption || item.status === 'gerando',
      ),
    );
    info.appendChild(acoes);

    linha.append(miniatura, info);
    caixa.appendChild(linha);
  });

  const prontas = estado.imagens.filter((item) => item.sugestao && !item.aplicado).length;
  refs.botaoAplicarTodas.classList.toggle('bai-oculto', prontas === 0);
  refs.botaoAplicarTodas.textContent = 'Aplicar todas (' + prontas + ')';
}

async function gerarSugestaoImagem(item: ItemImagem): Promise<void> {
  item.status = 'gerando';
  item.erro = null;
  renderizarListaImagens();
  try {
    const dados = await enviarParaFundo<SugestaoAlt>({
      type: 'AI_IMAGE_ALT',
      src: item.src,
      contexto: { titulo: lerTitulo(), palavraChave: estado.keyword.trim() },
    });
    item.sugestao = dados;
    item.status = 'ok';
  } catch (erro) {
    item.status = 'erro';
    item.erro = (erro as Error).message;
  }
  renderizarListaImagens();
}

async function gerarSugestoesTodas(): Promise<void> {
  if (!estado.imagens.length) {
    escanearImagens();
    if (!estado.imagens.length) return;
  }
  const alvos = estado.imagens.filter((item) => !item.sugestao).slice(0, MAX_IMAGENS);
  if (!alvos.length) {
    definirStatus(refs.statusImagens, 'Todas as imagens já têm sugestão. Aplique ou gere de novo uma por uma.', 'info');
    return;
  }
  estado.ocupado = true;
  ocupar(refs.botaoGerarTodas, true, 'Gerando (0/' + alvos.length + ')...');
  let concluidas = 0;
  const titulo = lerTitulo();
  const palavraChave = estado.keyword.trim();
  for (const item of alvos) {
    item.status = 'gerando';
    item.erro = null;
    renderizarListaImagens();
    try {
      const dados = await enviarParaFundo<SugestaoAlt>({
        type: 'AI_IMAGE_ALT',
        src: item.src,
        contexto: { titulo, palavraChave },
      });
      item.sugestao = dados;
      item.status = 'ok';
    } catch (erro) {
      item.status = 'erro';
      item.erro = (erro as Error).message;
    }
    concluidas += 1;
    ocupar(refs.botaoGerarTodas, true, 'Gerando (' + concluidas + '/' + alvos.length + ')...');
    renderizarListaImagens();
    await dormir(350);
  }
  estado.ocupado = false;
  ocupar(refs.botaoGerarTodas, false);
  const comSugestao = estado.imagens.filter((i) => i.sugestao).length;
  const comErro = estado.imagens.filter((i) => i.status === 'erro').length;
  definirStatus(
    refs.statusImagens,
    comSugestao + ' sugestão(ões) prontas para revisar e aplicar.' +
      (comErro ? ' ' + comErro + ' com erro — veja o detalhe em vermelho na lista.' : ''),
    comSugestao ? 'ok' : 'aviso',
  );
}

function aplicarAlt(item: ItemImagem): void {
  if (!item.sugestao || !item.sugestao.alt) return;
  item.img.setAttribute('alt', item.sugestao.alt);
  item.aplicado = true;
  const editor = localizarEditor();
  if (editor) notificarEditor(editor);
  definirStatus(refs.statusImagens, 'Alt aplicado. Confira no post e salve o rascunho.', 'ok');
  renderizarListaImagens();
  agendarChecklist();
}

function aplicarTodosAlt(): void {
  const prontas = estado.imagens.filter((item) => item.sugestao && !item.aplicado);
  if (!prontas.length) return;
  const confirmado = window.confirm('Aplicar o texto alternativo sugerido em ' + prontas.length + ' imagem(ns)?');
  if (!confirmado) return;
  for (const item of prontas) {
    if (!item.sugestao) continue;
    item.img.setAttribute('alt', item.sugestao.alt);
    item.aplicado = true;
  }
  const editor = localizarEditor();
  if (editor) notificarEditor(editor);
  definirStatus(refs.statusImagens, 'Alt aplicado em ' + prontas.length + ' imagem(ns). Confira e salve o rascunho.', 'ok');
  renderizarListaImagens();
  agendarChecklist();
}

function inserirLegenda(item: ItemImagem): void {
  const texto = item.sugestao && item.sugestao.caption;
  if (!texto) return;
  const img = item.img;
  const doc = img.ownerDocument;
  let figura = img.closest('figure');
  if (!figura) {
    figura = doc.createElement('figure');
    img.replaceWith(figura);
    figura.appendChild(img);
  }
  let legenda = figura.querySelector('figcaption');
  if (!legenda) {
    legenda = doc.createElement('figcaption');
    figura.appendChild(legenda);
  }
  legenda.textContent = texto;
  const editor = localizarEditor();
  if (editor) notificarEditor(editor);
  definirStatus(refs.statusImagens, 'Legenda inserida. O Blogger pode ajustar a formatação ao salvar.', 'ok');
  agendarChecklist();
}

// ---------------------------------------------------------------------------
// Imagem nova para o post (gerar com IA, escolher do computador ou padrão)
// ---------------------------------------------------------------------------

const MIME_IMAGEM_ACEITO = /^image\/(png|jpe?g|webp|gif|avif)$/i;

function proporcaoEscolhida(): string {
  const valor = refs.proporcaoImagem ? refs.proporcaoImagem.value : '';
  return /^[0-9]{1,2}:[0-9]{1,2}$/.test(valor) ? valor : '16:9';
}

async function montarPromptDaImagem(): Promise<void> {
  const editor = localizarEditorForcado();
  const texto = editor ? lerTextoDoEditor(editor) : '';
  const titulo = lerTitulo();
  if (!titulo || texto.trim().length < 200) {
    definirStatus(
      refs.statusImagem,
      editor
        ? 'Para montar o comando a partir do post, o post precisa ter título e pelo menos um parágrafo escrito. Escreva um pouco mais ou escreva você mesmo o comando da imagem.'
        : 'Não achei a área de escrita do post agora, então não consigo ler o texto. Escreva você mesmo o comando da imagem - ou clique em "Apontar manualmente" no rodapé para me mostrar onde você escreve.',
      'aviso',
    );
    return;
  }
  ocupar(refs.botaoPromptImagem, true, 'Lendo o post...');
  definirStatus(refs.statusImagem, 'A IA está lendo o post para criar o comando da imagem...', 'info');
  try {
    const dados = await enviarParaFundo<PromptImagem>({
      type: 'AI_PROMPT_IMAGEM',
      titulo,
      texto: texto.slice(0, LIMITE_TEXTO),
      palavraChave: estado.keyword.trim(),
      estilo: refs.persona ? refs.persona.value.trim().slice(0, 300) : '',
    });
    refs.promptImagem.value = dados.prompt;
    estado.altImagem = dados.alt;
    if (estado.imagemCriada && !estado.imagemCriada.alt) estado.imagemCriada.alt = dados.alt;
    renderizarPreviewImagem();
    definirStatus(
      refs.statusImagem,
      'Comando pronto. Revise se quiser e clique em "Gerar imagem com IA".',
      'ok',
    );
  } catch (erro) {
    definirStatus(refs.statusImagem, (erro as Error).message, 'erro');
  } finally {
    ocupar(refs.botaoPromptImagem, false);
  }
}

async function gerarImagemIA(): Promise<void> {
  const prompt = refs.promptImagem.value.trim();
  if (prompt.length < 15) {
    definirStatus(
      refs.statusImagem,
      'Escreva o comando da imagem (ou clique em "Montar pelo post", que precisa de título e texto no post).',
      'aviso',
    );
    refs.promptImagem.focus();
    return;
  }
  if (estado.gerandoImagem) return;
  estado.gerandoImagem = true;
  ocupar(refs.botaoGerarImagem, true, 'Gerando imagem...');
  definirStatus(
    refs.statusImagem,
    'Gerando a imagem (pode levar até um minuto). O serviço é pago: contas do Google no nível gratuito não têm cota de imagem.',
    'info',
  );
  try {
    const dados = await enviarParaFundo<ResultadoImagem>({
      type: 'AI_GERAR_IMAGEM',
      prompt,
      proporcao: proporcaoEscolhida(),
      alt: estado.altImagem,
    });
    estado.imagemCriada = {
      fonte: 'modelo',
      dataUrl: dados.imagem,
      alt: dados.alt || estado.altImagem,
      modelo: dados.modelo,
    };
    estado.altImagem = estado.imagemCriada.alt;
    renderizarPreviewImagem();
    definirStatus(refs.statusImagem, 'Imagem pronta. Confira a descrição (alt) e clique em "Inserir no post".', 'ok');
  } catch (erro) {
    definirStatus(refs.statusImagem, (erro as Error).message, 'erro');
  } finally {
    estado.gerandoImagem = false;
    ocupar(refs.botaoGerarImagem, false);
  }
}

function escolherImagemDoComputador(arquivos: FileList | null): void {
  const arquivo = arquivos && arquivos[0];
  if (!arquivo) return;
  if (!MIME_IMAGEM_ACEITO.test(arquivo.type || '')) {
    definirStatus(refs.statusImagem, 'Esse arquivo não parece ser uma imagem (use PNG, JPG, WEBP ou GIF).', 'erro');
    return;
  }
  if (arquivo.size > 8 * 1024 * 1024) {
    definirStatus(refs.statusImagem, 'A imagem é grande demais (máximo 8 MB). Reduza e tente de novo.', 'erro');
    return;
  }
  const leitor = new FileReader();
  leitor.onload = () => {
    const dataUrl = String(leitor.result || '');
    if (!dataUrl.startsWith('data:image/')) {
      definirStatus(refs.statusImagem, 'Não consegui ler esse arquivo como imagem.', 'erro');
      return;
    }
    estado.imagemCriada = { fonte: 'arquivo', dataUrl, alt: estado.altImagem, modelo: '' };
    renderizarPreviewImagem();
    definirStatus(refs.statusImagem, 'Imagem do computador carregada. Revise a descrição (alt) e insira no post.', 'ok');
  };
  leitor.onerror = () => definirStatus(refs.statusImagem, 'Não consegui ler o arquivo escolhido.', 'erro');
  leitor.readAsDataURL(arquivo);
}

function criarImagemPadrao(): string {
  const tela = document.createElement('canvas');
  tela.width = 1200;
  tela.height = 675;
  const contexto = tela.getContext('2d');
  if (!contexto) return '';
  const gradiente = contexto.createLinearGradient(0, 0, 1200, 675);
  gradiente.addColorStop(0, '#4f46e5');
  gradiente.addColorStop(1, '#7c3aed');
  contexto.fillStyle = gradiente;
  contexto.fillRect(0, 0, 1200, 675);
  contexto.globalAlpha = 0.12;
  contexto.fillStyle = '#ffffff';
  for (let x = -160; x < 1400; x += 140) {
    contexto.beginPath();
    contexto.arc(x, 110, 95, 0, Math.PI * 2);
    contexto.fill();
  }
  contexto.globalAlpha = 1;
  contexto.fillStyle = '#ffffff';
  contexto.textAlign = 'center';
  contexto.font = '600 58px system-ui, "Segoe UI", Arial, sans-serif';
  contexto.fillText('Adicione a imagem do post aqui', 600, 320);
  contexto.font = '400 28px system-ui, "Segoe UI", Arial, sans-serif';
  contexto.fillText('Troque por uma imagem de verdade antes de publicar.', 600, 378);
  return tela.toDataURL('image/jpeg', 0.9);
}

function usarImagemPadrao(): void {
  const dataUrl = criarImagemPadrao();
  if (!dataUrl) {
    definirStatus(refs.statusImagem, 'Não consegui montar a imagem padrão neste navegador.', 'erro');
    return;
  }
  estado.imagemCriada = {
    fonte: 'padrao',
    dataUrl,
    alt: estado.altImagem || 'Espaço reservado para a imagem do post (trocar antes de publicar)',
    modelo: '',
  };
  estado.altImagem = estado.imagemCriada.alt;
  renderizarPreviewImagem();
  definirStatus(
    refs.statusImagem,
    'Imagem padrão pronta: ela é só um espaço reservado. Troque por uma imagem de verdade antes de publicar.',
    'aviso',
  );
}

function renderizarPreviewImagem(): void {
  const caixa = refs.previewImagem;
  if (!caixa) return;
  caixa.textContent = '';
  const criada = estado.imagemCriada;
  if (!criada || !criada.dataUrl) {
    caixa.classList.add('bai-oculto');
    return;
  }
  caixa.classList.remove('bai-oculto');

  const origem =
    criada.fonte === 'modelo'
      ? 'Gerada pela IA' + (criada.modelo ? ' (' + criada.modelo + ')' : '')
      : criada.fonte === 'arquivo'
        ? 'Escolhida do computador'
        : 'Imagem padrão (espaço reservado)';

  const imagem = criar('img', {
    className: 'bai-preview-img',
    src: criada.dataUrl,
    alt: criada.alt || 'Prévia da imagem',
  }) as HTMLImageElement;
  const meta = criar('div', {
    className: 'bai-dica',
    texto: origem + ' - cerca de ' + Math.max(1, Math.round(criada.dataUrl.length / 1024)) + ' KB',
  });

  const campoAlt = criar('div', { className: 'bai-campo' });
  campoAlt.appendChild(
    criar('label', { className: 'bai-rotulo', texto: 'Descrição da imagem (alt)', for: 'bai-alt-imagem' }),
  );
  const alt = criar('input', {
    type: 'text',
    id: 'bai-alt-imagem',
    className: 'bai-entrada',
    maxlength: '160',
    placeholder: 'ex.: caderno aberto com gráficos coloridos sobre a mesa',
  }) as HTMLInputElement;
  alt.value = criada.alt;
  alt.addEventListener('input', () => {
    estado.altImagem = alt.value;
    if (estado.imagemCriada) estado.imagemCriada.alt = alt.value;
  });
  campoAlt.appendChild(alt);

  const dica = criar('div', { className: 'bai-dica', texto: 'Dica: o alt ideal tem de 70 a 125 caracteres.' });

  const acoes = criar('div', { className: 'bai-acoes-img' });
  acoes.appendChild(botaoAcao('Inserir no post', () => inserirImagemNoPost()));
  acoes.appendChild(botaoAcao('Sugerir descrição com IA', () => void sugerirAltDaImagem()));
  acoes.appendChild(botaoAcao('Baixar imagem', () => baixarImagemCriada()));
  acoes.appendChild(botaoAcao('Copiar imagem', () => void copiarImagemCriada()));

  caixa.append(imagem, meta, campoAlt, dica, acoes);
}

async function sugerirAltDaImagem(): Promise<void> {
  const criada = estado.imagemCriada;
  if (!criada || !criada.dataUrl) return;
  definirStatus(refs.statusImagem, 'A IA está olhando a imagem para sugerir a descrição...', 'info');
  try {
    const dados = await enviarParaFundo<SugestaoAlt>({
      type: 'AI_IMAGE_ALT',
      src: criada.dataUrl,
      contexto: { titulo: lerTitulo(), palavraChave: estado.keyword.trim() },
    });
    criada.alt = dados.alt;
    estado.altImagem = dados.alt;
    renderizarPreviewImagem();
    definirStatus(refs.statusImagem, 'Descrição sugerida. Confira e insira no post.', 'ok');
  } catch (erro) {
    definirStatus(refs.statusImagem, (erro as Error).message, 'erro');
  }
}

function inserirImagemNoPost(): void {
  const criada = estado.imagemCriada;
  if (!criada || !criada.dataUrl) return;
  const editor = localizarEditorForcado();
  if (!editor) {
    definirStatus(
      refs.statusImagem,
      'Não achei a área de escrita do post para inserir. A imagem continua guardada aqui: use "Baixar imagem" para salvá-la e envie pelo botão de imagem do Blogger, ou clique em "Apontar manualmente" no rodapé e tente de novo.',
      'aviso',
    );
    return;
  }
  const alt = (criada.alt || '').trim();
  if (alt.length < 10) {
    definirStatus(
      refs.statusImagem,
      'Escreva uma descrição (alt) com pelo menos 10 caracteres antes de inserir - isso ajuda no SEO e na acessibilidade.',
      'aviso',
    );
    return;
  }
  const avisoPadrao =
    criada.fonte === 'padrao'
      ? ' Esta é uma imagem padrão (espaço reservado): troque por uma imagem de verdade antes de publicar.'
      : '';
  const confirmado = window.confirm(
    'Inserir a imagem no fim do post?' + avisoPadrao + ' Dá para desfazer com Ctrl+Z.',
  );
  if (!confirmado) return;
  const doc = editor.ownerDocument;
  editor.focus();
  const selecao = doc.getSelection();
  const intervalo = doc.createRange();
  intervalo.selectNodeContents(editor);
  intervalo.collapse(false);
  if (selecao) {
    selecao.removeAllRanges();
    selecao.addRange(intervalo);
  }
  const html = '<p><img src="' + criada.dataUrl + '" alt="' + escaparHtml(alt) + '"></p>';
  let aplicado = false;
  try {
    aplicado = doc.execCommand('insertHTML', false, html);
  } catch {
    aplicado = false;
  }
  if (!aplicado) {
    definirStatus(
      refs.statusImagem,
      'O Blogger não aceitou a inserção automática. Use "Baixar imagem" e envie pelo botão de imagem do próprio Blogger; depois use "Escanear imagens" para completar o alt.',
      'aviso',
    );
    return;
  }
  definirStatus(
    refs.statusImagem,
    'Imagem inserida no fim do post. Confira e salve o rascunho. Se ela não aparecer depois de publicar, baixe a imagem e envie pelo botão de imagem do Blogger.',
    'ok',
  );
  agendarChecklist();
}

function baixarImagemCriada(): void {
  const criada = estado.imagemCriada;
  if (!criada || !criada.dataUrl) return;
  const nome =
    (criada.alt || 'imagem-do-post')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'imagem-do-post';
  const link = document.createElement('a');
  link.href = criada.dataUrl;
  link.download = nome + '.jpg';
  document.body.appendChild(link);
  link.click();
  link.remove();
  definirStatus(refs.statusImagem, 'Imagem salva na pasta de downloads.', 'ok');
}

async function copiarImagemCriada(): Promise<void> {
  const criada = estado.imagemCriada;
  if (!criada || !criada.dataUrl) return;
  try {
    const resposta = await fetch(criada.dataUrl);
    const blob = await resposta.blob();
    if (typeof ClipboardItem === 'undefined') {
      definirStatus(refs.statusImagem, 'Este navegador não deixa copiar imagens. Use "Baixar imagem".', 'aviso');
      return;
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/jpeg']: blob })]);
    definirStatus(refs.statusImagem, 'Imagem copiada. Cole no editor com Ctrl+V.', 'ok');
  } catch {
    definirStatus(refs.statusImagem, 'Não consegui copiar a imagem. Use "Baixar imagem".', 'aviso');
  }
}

// ---------------------------------------------------------------------------
// Aba Checklist
// ---------------------------------------------------------------------------

function contarOcorrencias(texto: string, palavra: string): number {
  const base = palavra.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alvo = texto.toLowerCase();
  try {
    const encontrados = alvo.match(new RegExp(base, 'g'));
    return encontrados ? encontrados.length : 0;
  } catch {
    return 0;
  }
}

function analisarLinks(editor: HTMLElement): ResultadoAnaliseLinks {
  const ancoras = Array.from(editor.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const problemas: string[] = [];
  let internos = 0;
  let externos = 0;
  for (const ancora of ancoras) {
    const bruto = (ancora.getAttribute('href') || '').trim();
    const texto = (ancora.textContent || '').trim();
    if (!bruto || bruto === '#' || /^javascript:/i.test(bruto)) {
      problemas.push('Link sem destino: "' + (texto || bruto || '(vazio)') + '"');
      continue;
    }
    let url: URL;
    try {
      url = new URL(bruto, location.href);
    } catch {
      problemas.push('Endereço inválido: ' + bruto);
      continue;
    }
    if (url.hostname === location.hostname || /\.blogspot\.com$/i.test(url.hostname)) internos += 1;
    else externos += 1;
    if (!texto) problemas.push('Link sem texto visível: ' + url.href);
    if (ancora.getAttribute('target') === '_blank' && !/noopener/.test(ancora.getAttribute('rel') || '')) {
      problemas.push('Link com target _blank sem rel="noopener": ' + url.href);
    }
  }
  const resumo =
    ancoras.length +
    ' link(s): ' +
    internos +
    ' interno(s), ' +
    externos +
    ' externo(s)' +
    (problemas.length ? '; ' + problemas.length + ' ponto(s) de atenção' : '');
  return { problemas, resumo, internos };
}

function coletarLinksExternos(editor: HTMLElement): string[] {
  const vistos = new Set<string>();
  const urls: string[] = [];
  for (const ancora of Array.from(editor.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const bruto = (ancora.getAttribute('href') || '').trim();
    if (!/^https?:/i.test(bruto)) continue;
    let url: URL;
    try {
      url = new URL(bruto, location.href);
    } catch {
      continue;
    }
    if (url.hostname === location.hostname) continue;
    if (vistos.has(url.href)) continue;
    vistos.add(url.href);
    urls.push(url.href);
    if (urls.length >= MAX_LINKS_UI) break;
  }
  return urls;
}

function itemChecklist(id: string, rotulo: string, status: StatusItem, detalhe: string): ItemChecklist {
  return { id, rotulo, status, detalhe };
}

function montarChecklist(): ItemChecklist[] {
  const editor = localizarEditor();
  if (!editor) {
    return [
      itemChecklist('editor', 'Editor do post', 'erro', 'Não encontrei o editor nesta tela.'),
    ];
  }

  const itens: ItemChecklist[] = [];
  const texto = lerTextoDoEditor(editor);
  const palavras = texto ? texto.split(/\s+/).filter(Boolean).length : 0;
  const titulo = lerTitulo();
  const palavra = estado.keyword.trim();
  const palavraMinuscula = palavra.toLowerCase();

  if (titulo) {
    itens.push(itemChecklist('titulo-existe', 'Título definido', 'ok', titulo));
    const tamanho = titulo.length;
    itens.push(
      itemChecklist(
        'titulo-tamanho',
        'Título com 50 a 60 caracteres',
        tamanho >= 50 && tamanho <= 60 ? 'ok' : 'aviso',
        'atual: ' + tamanho + ' caracteres',
      ),
    );
    if (palavra) {
      itens.push(
        itemChecklist(
          'titulo-palavra',
          'Palavra-chave no título',
          titulo.toLowerCase().includes(palavraMinuscula) ? 'ok' : 'aviso',
          palavra,
        ),
      );
    }
  } else {
    itens.push(itemChecklist('titulo-existe', 'Título definido', 'falha', 'O post ainda não tem título.'));
  }

  const campoDesc = localizarCampoDescricao(estado.janela);
  const doCampo = campoDesc ? String(campoDesc.value || campoDesc.textContent || '').trim() : '';
  const doCache =
    estado.metaCache && estado.metaCache.pagina === location.pathname ? estado.metaCache.valor.trim() : '';
  const descricao = doCampo || doCache;
  if (!campoDesc && !doCache) {
    itens.push(
      itemChecklist(
        'meta-existe',
        'Meta-descrição definida',
        'info',
        'Não consigo ler sem abrir as configurações: clique em "Conferir meta-descrição" acima (a aba Texto também sugere uma).',
      ),
    );
  } else if (!descricao) {
    itens.push(itemChecklist('meta-existe', 'Meta-descrição definida', 'falha', 'O campo está vazio.'));
  } else {
    itens.push(
      itemChecklist(
        'meta-existe',
        'Meta-descrição definida',
        'ok',
        'atual: ' +
          descricao.length +
          ' caracteres' +
          (doCampo ? '' : ' (último valor lido - clique em "Conferir meta-descrição" para reler)'),
      ),
    );
    itens.push(
      itemChecklist(
        'meta-tamanho',
        'Meta-descrição com 150 a 160 caracteres',
        descricao.length >= 150 && descricao.length <= 160 ? 'ok' : 'aviso',
        'atual: ' + descricao.length + ' caracteres',
      ),
    );
    if (palavra) {
      itens.push(
        itemChecklist(
          'meta-palavra',
          'Palavra-chave na meta-descrição',
          descricao.toLowerCase().includes(palavraMinuscula) ? 'ok' : 'aviso',
          palavra,
        ),
      );
    }
  }

  itens.push(
    itemChecklist(
      'conteudo-tamanho',
      'Conteúdo com pelo menos 300 palavras',
      palavras >= 300 ? 'ok' : 'aviso',
      palavras + ' palavras',
    ),
  );

  if (palavra) {
    const ocorrencias = contarOcorrencias(texto, palavra);
    const densidade = palavras ? (ocorrencias / palavras) * 100 : 0;
    const densidadeOk = densidade >= 1 && densidade <= 2;
    let detalheDensidade = ocorrencias + ' ocorrência(s) - ' + densidade.toFixed(2).replace('.', ',') + '%';
    if (densidade > 3) detalheDensidade += ' (acima do limite de 3%)';
    itens.push(
      itemChecklist(
        'densidade',
        'Densidade da palavra-chave entre 1% e 2%',
        ocorrencias === 0 ? 'falha' : densidadeOk ? 'ok' : 'aviso',
        detalheDensidade,
      ),
    );
    const primeiroParagrafo = primeiroBlocoDeTexto(editor);
    if (primeiroParagrafo) {
      itens.push(
        itemChecklist(
          'primeiro-paragrafo',
          'Palavra-chave no primeiro parágrafo',
          primeiroParagrafo.toLowerCase().includes(palavraMinuscula) ? 'ok' : 'aviso',
          'Trecho: "' + primeiroParagrafo.slice(0, 80) + '..."',
        ),
      );
    }
  }

  const cabecalhos = Array.from(editor.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
  const internos = cabecalhos.filter((h) => h.tagName !== 'H1');
  const temH1 = cabecalhos.some((h) => h.tagName === 'H1');
  if (!internos.length) {
    itens.push(itemChecklist('subtitulos', 'Subtítulos (H2+) no conteúdo', 'aviso', 'Nenhum subtítulo encontrado.'));
  } else {
    let detalhe = internos.map((h) => h.tagName).join(', ');
    let status: StatusItem = 'ok';
    if (temH1) {
      status = 'aviso';
      detalhe += ' - evite H1 no corpo (o título do post já é o H1).';
    }
    itens.push(itemChecklist('subtitulos', 'Subtítulos (H2+) no conteúdo', status, detalhe));
  }

  const coleta = coletarImagens(editor);
  let detalheImagens: string;
  if (coleta.todas.length === 0) detalheImagens = 'O post ainda não tem imagens (recomendado: 2 ou mais).';
  else if (coleta.semAlt.length > 0) detalheImagens = coleta.semAlt.length + ' de ' + coleta.todas.length + ' sem descrição';
  else if (coleta.todas.length < 2) detalheImagens = coleta.todas.length + ' imagem com descrição (recomendado: 2 ou mais)';
  else detalheImagens = coleta.todas.length + ' imagem(ns), todas com descrição';
  itens.push(
    itemChecklist(
      'imagens-alt',
      'Imagens: 2 ou mais, todas com texto alternativo',
      coleta.todas.length >= 2 && coleta.semAlt.length === 0 ? 'ok' : 'aviso',
      detalheImagens,
    ),
  );

  const links = analisarLinks(editor);
  const detalheLinks = links.resumo + (links.problemas.length ? ' | ' + links.problemas.slice(0, 2).join(' | ') : '');
  itens.push(itemChecklist('links', 'Links válidos e seguros', links.problemas.length ? 'aviso' : 'ok', detalheLinks));
  itens.push(
    itemChecklist(
      'links-internos',
      'Links internos (2 a 5 por 1.000 palavras)',
      links.internos >= Math.max(2, Math.ceil((palavras / 1000) * 2)) ? 'ok' : 'aviso',
      links.internos + ' link(s) interno(s) em ' + palavras + ' palavras',
    ),
  );

  itens.push(
    itemChecklist(
      'amp',
      'AMP (configuração do blog)',
      'info',
      'O AMP se ativa no blog, não no post. Verifique nas configurações do Blogger.',
    ),
  );

  return itens;
}

function formatarPontos(pontos: number): string {
  return (pontos % 1 === 0 ? String(pontos) : pontos.toFixed(1)).replace('.', ',');
}

function renderizarChecklist(): void {
  let itens: ItemChecklist[];
  try {
    itens = montarChecklist();
  } catch {
    itens = [
      itemChecklist(
        'auditoria-erro',
        'Auditoria',
        'erro',
        'Não consegui ler a página agora. Atualize a página (F5) e tente de novo.',
      ),
    ];
  }
  if (refs.checkAtualizado) {
    refs.checkAtualizado.textContent = 'Atualizado às ' +
      new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const avaliaveis = itens.filter((item) => item.status !== 'info');
  const pontos = avaliaveis.reduce(
    (soma, item) => soma + (item.status === 'ok' ? 1 : item.status === 'aviso' ? 0.5 : 0),
    0,
  );
  const percentual = avaliaveis.length ? Math.round((pontos / avaliaveis.length) * 100) : 0;
  refs.resumoCheck.textContent = avaliaveis.length
    ? formatarPontos(pontos) + ' de ' + avaliaveis.length + ' verificações OK (' + percentual + '%)'
    : 'Sem verificações disponíveis';
  refs.resumoCheck.className =
    'bai-resumo ' + (percentual >= 80 ? 'bai-ok' : percentual >= 50 ? 'bai-aviso' : 'bai-falha');
  refs.listaCheck.textContent = '';
  for (const item of itens) {
    const linha = criar('div', { className: 'bai-check-item bai-' + item.status });
    const ponto = criar('span', { className: 'bai-ponto' });
    const corpo = criar('div');
    corpo.appendChild(criar('div', { className: 'bai-check-rotulo', texto: item.rotulo }));
    if (item.detalhe) {
      corpo.appendChild(criar('div', { className: 'bai-check-detalhe', texto: item.detalhe }));
    }
    linha.append(ponto, corpo);
    refs.listaCheck.appendChild(linha);
  }
  renderizarLinksExternos();
}

function renderizarLinksExternos(): void {
  const editor = localizarEditor();
  if (!editor) return;
  const urls = coletarLinksExternos(editor);
  estado.linksExternos = urls;
  if (!urls.length) return;

  const bloco = criar('section', { className: 'bai-card' });
  const cabecalho = criar('div', { className: 'bai-card-cabeco' }, [
    criar('strong', { texto: 'Links externos (' + urls.length + ')' }),
  ]);
  bloco.appendChild(cabecalho);

  const botao = botaoAcao('Verificar links externos', () => void verificarLinksExternos(botao));
  bloco.appendChild(botao);

  if (estado.resultadoLinks) {
    const listaResultados = criar('div');
    for (const resultado of estado.resultadoLinks) {
      const rotulos: Record<string, string> = {
        ok: 'OK',
        quebrado: 'Quebrado',
        nao_verificado: 'Não verificado',
      };
      let texto = (resultado.url ? resultado.url + ' - ' : '') + (rotulos[resultado.status] || resultado.status);
      if (resultado.http) texto += ' (HTTP ' + resultado.http + ')';
      listaResultados.appendChild(criar('div', { className: 'bai-check-detalhe', texto }));
    }
    bloco.appendChild(listaResultados);
    if (!estado.linksTemPermissao) {
      bloco.appendChild(
        criar('p', {
          className: 'bai-dica',
          texto: 'Dica: permita o acesso aos sites no popup da extensão para uma verificação completa.',
        }),
      );
    }
  }

  refs.listaCheck.appendChild(bloco);
}

async function verificarLinksExternos(botao: HTMLButtonElement): Promise<void> {
  const urls = estado.linksExternos;
  if (!urls.length) return;
  estado.verificandoLinks = true;
  botao.disabled = true;
  botao.textContent = 'Verificando...';
  try {
    const dados = await enviarParaFundo<ResultadoLinks>({ type: 'CHECK_LINKS', urls });
    estado.resultadoLinks = dados.resultados;
    estado.linksTemPermissao = dados.temPermissao;
  } catch (erro) {
    estado.resultadoLinks = [{ url: '', status: 'nao_verificado', http: null }];
    definirStatus(refs.statusTexto, (erro as Error).message, 'erro');
  } finally {
    estado.verificandoLinks = false;
  }
  renderizarChecklist();
}

function agendarChecklist(): void {
  clearTimeout(estado.relogioCheck);
  estado.relogioCheck = window.setTimeout(() => {
    if (estado.abaAtual === 'checklist') renderizarChecklist();
  }, 700);
}

// ---------------------------------------------------------------------------
// Criar: personalidade, aprendizado de estilo e geração de post
// ---------------------------------------------------------------------------

function numeroDoBlog(): string {
  const partes = location.pathname.split('/').filter(Boolean);
  for (const parte of partes) {
    if (/^[0-9]{6,25}$/.test(parte)) return parte;
  }
  return '';
}

async function aprenderEstilo(): Promise<void> {
  const blogId = numeroDoBlog();
  if (!blogId) {
    definirStatus(
      refs.statusCriar,
      'Não identifiquei o número do blog nesta página. Abra o editor de um post e tente de novo.',
      'aviso',
    );
    return;
  }
  ocupar(refs.botaoAprender, true, 'Lendo os textos do blog...');
  definirStatus(refs.statusCriar, 'Buscando os posts publicados para aprender o estilo...', 'info');
  try {
    const perfil = await enviarParaFundo<PerfilEstilo>({ type: 'AI_APRENDER_ESTILO', blogId });
    refs.persona.value = perfil.perfil;
    gravarArmazenamentoLocal({ [CHAVE_PERSONA]: perfil.perfil });
    const quantidade = perfil.posts.length;
    const poucos =
      quantidade < 10
        ? ' O ideal são 10 textos ou mais; com menos que isso, complete a personalidade à mão.'
        : '';
    definirStatus(
      refs.statusCriar,
      'Estilo aprendido de ' + quantidade + ' post(s) do blog e salvo na personalidade.' + poucos + ' Revise se quiser.',
      quantidade < 10 ? 'aviso' : 'ok',
    );
  } catch (erro) {
    definirStatus(refs.statusCriar, (erro as Error).message, 'erro');
  } finally {
    ocupar(refs.botaoAprender, false);
  }
}

async function gerarPost(): Promise<void> {
  const persona = refs.persona.value.trim();
  const assunto = refs.assunto.value.trim();
  const pontos = refs.pontos.value.trim();
  if (!assunto) {
    definirStatus(refs.statusCriar, 'Informe o assunto (ou um título provisório) do post.', 'aviso');
    refs.assunto.focus();
    return;
  }
  if (persona.length < 20) {
    definirStatus(
      refs.statusCriar,
      'Escreva a personalidade ou clique em "Aprender estilo com os textos do blog".',
      'aviso',
    );
    refs.persona.focus();
    return;
  }
  estado.ocupado = true;
  ocupar(refs.botaoGerarPost, true, 'Escrevendo o post...');
  definirStatus(refs.statusCriar, 'A IA está escrevendo o post completo (pode levar um tempo)...', 'info');
  try {
    const criacao = await enviarParaFundo<CriacaoPost>({
      type: 'AI_GERAR_POST',
      persona,
      assunto,
      pontos,
      blogId: numeroDoBlog(),
    });
    renderizarCriacao(criacao);
    definirStatus(refs.statusCriar, 'Post gerado. Revise, aplique os campos e insira o texto no post.', 'ok');
  } catch (erro) {
    definirStatus(refs.statusCriar, (erro as Error).message, 'erro');
  } finally {
    estado.ocupado = false;
    ocupar(refs.botaoGerarPost, false);
  }
}

const TAGS_PERMITIDAS = new Set(['H2', 'H3', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'A']);

function sanitizarNo(no: Node, doc: Document): Node {
  if (no.nodeType === Node.TEXT_NODE) return doc.createTextNode(no.textContent || '');
  if (no.nodeType !== Node.ELEMENT_NODE) return doc.createTextNode('');
  const el = no as HTMLElement;
  if (!TAGS_PERMITIDAS.has(el.tagName)) {
    const fragmento = doc.createDocumentFragment();
    for (const filho of Array.from(el.childNodes)) fragmento.appendChild(sanitizarNo(filho, doc));
    return fragmento;
  }
  const novo = doc.createElement(el.tagName.toLowerCase());
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') || '';
    if (/^https?:/i.test(href)) {
      novo.setAttribute('href', href);
      novo.setAttribute('target', '_blank');
      novo.setAttribute('rel', 'noopener');
    }
  }
  for (const filho of Array.from(el.childNodes)) novo.appendChild(sanitizarNo(filho, doc));
  return novo;
}

function sanitizarHtml(bruto: string): string {
  const doc = new DOMParser().parseFromString(bruto, 'text/html');
  const destino = doc.createElement('div');
  for (const no of Array.from(doc.body.childNodes)) destino.appendChild(sanitizarNo(no, doc));
  return destino.innerHTML;
}

function textoPlanoDoHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function avaliarCriacao(criacao: CriacaoPost): ItemChecklist[] {
  const itens: ItemChecklist[] = [];
  const texto = textoPlanoDoHtml(criacao.corpo_html);
  const palavras = texto ? texto.split(/\s+/).filter(Boolean).length : 0;
  const palavra = criacao.palavra_chave.toLowerCase();

  const tamanhoTitulo = criacao.titulo.length;
  itens.push(
    itemChecklist(
      'c-titulo',
      'Título com 50 a 60 caracteres',
      tamanhoTitulo >= 50 && tamanhoTitulo <= 60 ? 'ok' : 'aviso',
      'atual: ' + tamanhoTitulo + ' caracteres',
    ),
  );
  itens.push(
    itemChecklist(
      'c-titulo-inicio',
      'Palavra-chave no início do título',
      palavra && criacao.titulo.toLowerCase().indexOf(palavra) === 0 ? 'ok' : 'aviso',
      criacao.palavra_chave || '(sem palavra-chave)',
    ),
  );
  const tamanhoMeta = criacao.meta_descricao.length;
  itens.push(
    itemChecklist(
      'c-meta',
      'Meta descrição com 150 a 160 caracteres',
      tamanhoMeta >= 150 && tamanhoMeta <= 160 ? 'ok' : 'aviso',
      'atual: ' + tamanhoMeta + ' caracteres',
    ),
  );
  itens.push(
    itemChecklist('c-palavras', 'Pelo menos 800 palavras', palavras >= 800 ? 'ok' : 'aviso', palavras + ' palavras'),
  );
  const ocorrencias = contarOcorrencias(texto, criacao.palavra_chave);
  const densidade = palavras ? (ocorrencias / palavras) * 100 : 0;
  let detalheDensidade = ocorrencias + ' ocorrência(s) - ' + densidade.toFixed(2).replace('.', ',') + '%';
  if (densidade > 3) detalheDensidade += ' (acima do limite de 3%)';
  itens.push(
    itemChecklist(
      'c-densidade',
      'Densidade da palavra-chave entre 1% e 2%',
      densidade >= 1 && densidade <= 2 ? 'ok' : 'aviso',
      detalheDensidade,
    ),
  );
  const doc = new DOMParser().parseFromString(criacao.corpo_html, 'text/html');
  const h2 = doc.body.querySelectorAll('h2').length;
  const h3 = doc.body.querySelectorAll('h3').length;
  const h1 = doc.body.querySelectorAll('h1').length;
  let pulouNivel = false;
  let anterior = 2;
  for (const titulo of Array.from(doc.body.querySelectorAll('h1, h2, h3, h4'))) {
    const nivel = Number(titulo.tagName.slice(1));
    if (nivel > anterior + 1) pulouNivel = true;
    anterior = nivel;
  }
  let detalheEstrutura = h2 + ' H2, ' + h3 + ' H3';
  if (h1) detalheEstrutura += ', ' + h1 + ' H1 (não use H1 no corpo)';
  if (pulouNivel) detalheEstrutura += ' - pulou um nível';
  itens.push(
    itemChecklist(
      'c-estrutura',
      'Subtítulos H2/H3 sem pular níveis',
      h1 === 0 && h2 >= 2 && !pulouNivel ? 'ok' : 'aviso',
      detalheEstrutura,
    ),
  );
  const primeiroParagrafo = (doc.body.querySelector('p')?.textContent || '').toLowerCase();
  itens.push(
    itemChecklist(
      'c-primeiro-paragrafo',
      'Primeiro parágrafo com a palavra-chave',
      palavra && primeiroParagrafo.includes(palavra) ? 'ok' : 'aviso',
      palavra ? 'procurando "' + criacao.palavra_chave + '" nas primeiras frases' : '(sem palavra-chave)',
    ),
  );
  itens.push(
    itemChecklist(
      'c-links',
      'Links internos sugeridos (2 a 5)',
      criacao.links_internos.length >= 2 ? 'ok' : 'aviso',
      criacao.links_internos.length + ' link(s)',
    ),
  );
  itens.push(
    itemChecklist(
      'c-fontes',
      'Fontes externas no texto (1 a 2)',
      criacao.links_externos.length >= 1 && criacao.links_externos.length <= 2 ? 'ok' : 'aviso',
      criacao.links_externos.length + ' fonte(s) externa(s)',
    ),
  );
  itens.push(
    itemChecklist(
      'c-slug',
      'Endereço (slug) com a palavra-chave',
      palavra && criacao.slug && criacao.slug.toLowerCase().includes(palavra.split(' ')[0]) ? 'ok' : 'aviso',
      criacao.slug || '(sem slug)',
    ),
  );
  return itens;
}

function renderizarCriacao(criacao: CriacaoPost): void {
  const caixa = refs.resultadoCriar;
  caixa.textContent = '';

  const itens = avaliarCriacao(criacao);
  const avaliaveis = itens.filter((item) => item.status !== 'info');
  const pontos = avaliaveis.reduce(
    (soma, item) => soma + (item.status === 'ok' ? 1 : item.status === 'aviso' ? 0.5 : 0),
    0,
  );
  const percentual = avaliaveis.length ? Math.round((pontos / avaliaveis.length) * 100) : 0;
  caixa.appendChild(
    criar('div', {
      className: 'bai-resumo ' + (percentual >= 80 ? 'bai-ok' : percentual >= 50 ? 'bai-aviso' : 'bai-falha'),
      texto: 'Conformidade SEO do texto gerado: ' + percentual + '%',
    }),
  );

  const detalhes = criar('section', { className: 'bai-card' });
  for (const item of itens) {
    const linha = criar('div', { className: 'bai-check-item bai-' + item.status });
    const ponto = criar('span', { className: 'bai-ponto' });
    const corpo = criar('div');
    corpo.appendChild(criar('div', { className: 'bai-check-rotulo', texto: item.rotulo }));
    if (item.detalhe) corpo.appendChild(criar('div', { className: 'bai-check-detalhe', texto: item.detalhe }));
    linha.append(ponto, corpo);
    detalhes.appendChild(linha);
  }
  caixa.appendChild(detalhes);

  if (criacao.titulo) {
    caixa.appendChild(
      cardTexto('Título do post', criacao.titulo.length + ' caracteres', criacao.titulo, [
        { rotulo: 'Aplicar no título', acao: () => aplicarTitulo(criacao.titulo), principal: true },
        { rotulo: 'Copiar', acao: () => void copiar(criacao.titulo) },
      ]),
    );
  }
  if (criacao.meta_descricao) {
    caixa.appendChild(
      cardTexto('Meta descrição', criacao.meta_descricao.length + ' caracteres', criacao.meta_descricao, [
        { rotulo: 'Aplicar', acao: () => void aplicarMetaDescricao(criacao.meta_descricao), principal: true },
        { rotulo: 'Copiar', acao: () => void copiar(criacao.meta_descricao) },
      ]),
    );
  }
  const extras = [
    criacao.slug ? 'slug: ' + criacao.slug : '',
    criacao.palavra_chave ? 'palavra-chave: ' + criacao.palavra_chave : '',
    criacao.palavras_secundarias.length ? 'secundárias: ' + criacao.palavras_secundarias.join(', ') : '',
  ].filter(Boolean);
  if (extras.length) caixa.appendChild(cardLista('Palavras e endereço', extras));
  if (criacao.links_internos.length) {
    caixa.appendChild(
      cardLista('Links internos sugeridos', criacao.links_internos.map((link) => link.ancora + ' -> ' + link.url)),
    );
  }
  if (criacao.links_externos.length) {
    caixa.appendChild(
      cardLista(
        'Fontes externas no texto',
        criacao.links_externos.map((link) => link.ancora + ' -> ' + link.url),
      ),
    );
  }
  if (criacao.observacoes.length) caixa.appendChild(cardLista('Recados da IA', criacao.observacoes));

  const palavrasCorpo = textoPlanoDoHtml(criacao.corpo_html).split(/\s+/).filter(Boolean).length;
  const cartao = criar('section', { className: 'bai-card' });
  cartao.appendChild(
    criar('div', { className: 'bai-card-cabeco' }, [
      criar('strong', { texto: 'Corpo do post' }),
      criar('span', { texto: palavrasCorpo + ' palavras' }),
    ]),
  );
  const preview = criar('div', { className: 'bai-preview' });
  // O HTML abaixo já passou pelo filtro de tags permitidas (sanitizarHtml).
  preview.innerHTML = sanitizarHtml(criacao.corpo_html);
  cartao.appendChild(preview);
  const acoes = criar('div', { className: 'bai-acoes' });
  acoes.appendChild(
    criarBotaoComClasse({ rotulo: 'Inserir no post', acao: () => inserirCriacaoNoPost(criacao), principal: true }),
  );
  acoes.appendChild(
    criarBotaoComClasse({ rotulo: 'Copiar texto', acao: () => void copiar(textoPlanoDoHtml(criacao.corpo_html)) }),
  );
  cartao.appendChild(acoes);
  caixa.appendChild(cartao);
}

function inserirCriacaoNoPost(criacao: CriacaoPost): void {
  const editor = localizarEditor();
  if (!editor) {
    definirStatus(refs.statusCriar, 'Não encontrei o editor. Use "Apontar manualmente" no rodapé do painel.', 'erro');
    return;
  }
  const confirmado = window.confirm(
    'Inserir o texto gerado no fim do post e aplicar o título?' +
      ' O título alimenta o endereço (slug). Dá para desfazer com Ctrl+Z.',
  );
  if (!confirmado) return;
  let tituloAplicado = false;
  const campoTitulo = localizarCampoTitulo(estado.janela, editor);
  if (campoTitulo && criacao.titulo) {
    const atual = String((campoTitulo as HTMLInputElement).value || campoTitulo.textContent || '').trim();
    if (atual !== criacao.titulo) {
      gravarTitulo(campoTitulo, criacao.titulo);
      tituloAplicado = true;
    }
  }
  const html = sanitizarHtml(criacao.corpo_html);
  const doc = editor.ownerDocument;
  editor.focus();
  const selecao = doc.getSelection();
  const intervalo = doc.createRange();
  intervalo.selectNodeContents(editor);
  intervalo.collapse(false);
  if (selecao) {
    selecao.removeAllRanges();
    selecao.addRange(intervalo);
  }
  let aplicado = false;
  try {
    aplicado = doc.execCommand('insertHTML', false, html);
  } catch {
    aplicado = false;
  }
  if (!aplicado) {
    try {
      aplicado = doc.execCommand('insertText', false, textoPlanoDoHtml(criacao.corpo_html));
    } catch {
      aplicado = false;
    }
  }
  if (!aplicado) {
    definirStatus(
      refs.statusCriar,
      'O Blogger não aceitou a inserção automática. Use "Copiar texto" e cole no post.',
      'aviso',
    );
    return;
  }
  definirStatus(
    refs.statusCriar,
    'Texto inserido no fim do post' +
      (tituloAplicado ? ' e título aplicado (o endereço/slug sai dele)' : '') +
      '. Revise e salve o rascunho.',
    'ok',
  );
  agendarChecklist();
}

// ---------------------------------------------------------------------------
// UI (botão flutuante + painel com abas)
// ---------------------------------------------------------------------------

function montarUI(): void {
  if (document.getElementById(RAIZ_ID)) return;

  const raiz = criar('div', { id: RAIZ_ID, 'data-bai': 'raiz' }) as HTMLDivElement;

  const botao = criar('button', {
    className: 'bai-fab',
    texto: 'Assistente SEO',
    type: 'button',
    onclick: () => alternarPainel(),
  }) as HTMLButtonElement;

  const pill = criar('span', { className: 'bai-pill', texto: 'chave: verificando' });

  const painel = criar('section', {
    className: 'bai-painel bai-oculto',
    'aria-label': 'Blogger AI SEO Assistant',
  }) as HTMLElement;

  const cabecalho = criar('header', { className: 'bai-cabecalho' }, [
    criar('div', { className: 'bai-titulo', texto: 'Blogger AI SEO Assistant' }),
    pill,
    criar('button', {
      className: 'bai-fechar',
      texto: 'Minimizar',
      type: 'button',
      onclick: () => alternarPainel(false),
    }),
  ]);

  const abas = montarAbas();
  const corpo = criar('div', { className: 'bai-corpo' });
  const secaoTexto = montarSecaoTexto();
  const secaoCriar = montarSecaoCriar();
  const secaoImagens = montarSecaoImagens();
  const secaoChecklist = montarSecaoChecklist();
  corpo.append(secaoTexto, secaoCriar, secaoImagens, secaoChecklist);
  secaoCriar.classList.add('bai-oculto');
  secaoImagens.classList.add('bai-oculto');
  secaoChecklist.classList.add('bai-oculto');

  const rodape = criar('footer', { className: 'bai-rodape' });
  rodape.appendChild(
    criar('div', { texto: 'A chave da API fica no popup da extensão (ícone na barra do Chrome).' }),
  );
  rodape.appendChild(
    criar('button', {
      className: 'bai-link',
      texto: 'Não achou o editor? Apontar manualmente',
      type: 'button',
      onclick: () => iniciarEscolhaManual(),
    }),
  );

  painel.append(cabecalho, abas, corpo, rodape);
  raiz.append(botao, painel);
  document.body.appendChild(raiz);

  refs.raiz = raiz;
  refs.botao = botao;
  refs.pill = pill;
  refs.painel = painel;
  refs.secoes = { texto: secaoTexto, criar: secaoCriar, imagens: secaoImagens, checklist: secaoChecklist };
}

function montarAbas(): HTMLElement {
  const abas = criar('nav', { className: 'bai-abas', role: 'tablist' });
  const definicoes: Array<{ id: AbaId; rotulo: string }> = [
    { id: 'texto', rotulo: 'Texto' },
    { id: 'criar', rotulo: 'Criar' },
    { id: 'imagens', rotulo: 'Imagens' },
    { id: 'checklist', rotulo: 'Checklist' },
  ];
  refs.abas = [];
  for (const definicao of definicoes) {
    const botao = criar('button', {
      className: 'bai-aba',
      texto: definicao.rotulo,
      type: 'button',
      role: 'tab',
      onclick: () => trocarAba(definicao.id),
    }) as HTMLButtonElement;
    botao.dataset.aba = definicao.id;
    refs.abas.push(botao);
    abas.appendChild(botao);
  }
  return abas;
}

function montarSecaoTexto(): HTMLElement {
  const secao = criar('section', { className: 'bai-secao bai-secao-texto' });

  const campo = criar('div', { className: 'bai-campo' });
  campo.appendChild(criar('label', { className: 'bai-rotulo', texto: 'Palavra-chave principal', for: 'bai-keyword' }));
  const entrada = criar('input', {
    type: 'text',
    id: 'bai-keyword',
    className: 'bai-entrada',
    placeholder: 'ex.: receita de pão integral',
    autocomplete: 'off',
  }) as HTMLInputElement;
  entrada.addEventListener('input', () => {
    estado.keyword = entrada.value;
    gravarArmazenamentoLocal({ [CHAVE_KEYWORD]: entrada.value });
    agendarChecklist();
  });
  campo.appendChild(entrada);

  const linha = criar('div', { className: 'bai-linha-botoes' });
  const otimizar = criar('button', {
    className: 'bai-botao bai-principal',
    texto: 'Otimizar texto',
    type: 'button',
    onclick: () => void otimizarTexto(),
  }) as HTMLButtonElement;
  linha.appendChild(otimizar);

  const status = criar('div', { className: 'bai-status bai-info' });
  const resultado = criar('div');

  secao.append(campo, linha, status, resultado);
  refs.keyword = entrada;
  refs.botaoOtimizar = otimizar;
  refs.statusTexto = status;
  refs.resultadoTexto = resultado;
  return secao;
}

function montarSecaoCriar(): HTMLElement {
  const secao = criar('section', { className: 'bai-secao bai-secao-criar' });

  const campoPersona = criar('div', { className: 'bai-campo' });
  campoPersona.appendChild(
    criar('label', { className: 'bai-rotulo', texto: 'Personalidade do autor', for: 'bai-persona' }),
  );
  const persona = criar('textarea', {
    id: 'bai-persona',
    className: 'bai-entrada bai-area',
    placeholder: 'ex.: entusiasta de tecnologia, escritor direto ao ponto, gosta de exemplos do dia a dia...',
    rows: '3',
  }) as HTMLTextAreaElement;
  persona.addEventListener('input', () => {
    gravarArmazenamentoLocal({ [CHAVE_PERSONA]: persona.value });
  });
  campoPersona.appendChild(persona);

  const linhaPersona = criar('div', { className: 'bai-linha-botoes' });
  const aprender = criar('button', {
    className: 'bai-botao',
    texto: 'Aprender estilo com os textos do blog',
    type: 'button',
    onclick: () => void aprenderEstilo(),
  }) as HTMLButtonElement;
  linhaPersona.appendChild(aprender);
  campoPersona.appendChild(linhaPersona);

  const campoAssunto = criar('div', { className: 'bai-campo' });
  campoAssunto.appendChild(
    criar('label', { className: 'bai-rotulo', texto: 'Assunto ou título provisório', for: 'bai-assunto' }),
  );
  const assunto = criar('input', {
    type: 'text',
    id: 'bai-assunto',
    className: 'bai-entrada',
    placeholder: 'ex.: como escolher um notebook em 2026',
    autocomplete: 'off',
  }) as HTMLInputElement;
  campoAssunto.appendChild(assunto);

  const campoPontos = criar('div', { className: 'bai-campo' });
  campoPontos.appendChild(
    criar('label', { className: 'bai-rotulo', texto: 'Pontos que precisam aparecer (um por linha)', for: 'bai-pontos' }),
  );
  const pontos = criar('textarea', {
    id: 'bai-pontos',
    className: 'bai-entrada bai-area',
    rows: '3',
    placeholder: 'ex.: falar de orçamento\ncomparar 3 modelos\ncitar garantia de 1 ano',
  }) as HTMLTextAreaElement;
  campoPontos.appendChild(pontos);

  const linhaGerar = criar('div', { className: 'bai-linha-botoes' });
  const gerar = criar('button', {
    className: 'bai-botao bai-principal',
    texto: 'Gerar post completo',
    type: 'button',
    onclick: () => void gerarPost(),
  }) as HTMLButtonElement;
  linhaGerar.appendChild(gerar);

  const status = criar('div', { className: 'bai-status bai-info' });
  const resultado = criar('div');

  secao.append(campoPersona, campoAssunto, campoPontos, linhaGerar, status, resultado);
  refs.persona = persona;
  refs.assunto = assunto;
  refs.pontos = pontos;
  refs.botaoAprender = aprender;
  refs.botaoGerarPost = gerar;
  refs.statusCriar = status;
  refs.resultadoCriar = resultado;
  return secao;
}

function montarSecaoImagens(): HTMLElement {
  const secao = criar('section', { className: 'bai-secao bai-secao-imagens' });

  secao.appendChild(montarCaixaImagemNova());

  const linha = criar('div', { className: 'bai-linha-botoes' });
  const escanear = criar('button', {
    className: 'bai-botao',
    texto: 'Escanear imagens',
    type: 'button',
    onclick: () => escanearImagens(),
  }) as HTMLButtonElement;
  const gerar = criar('button', {
    className: 'bai-botao bai-principal',
    texto: 'Gerar sugestões para todas',
    type: 'button',
    onclick: () => void gerarSugestoesTodas(),
  }) as HTMLButtonElement;
  const aplicar = criar('button', {
    className: 'bai-botao bai-oculto',
    texto: 'Aplicar todas',
    type: 'button',
    onclick: () => aplicarTodosAlt(),
  }) as HTMLButtonElement;
  linha.append(escanear, gerar, aplicar);

  const status = criar('div', { className: 'bai-status bai-info' });
  const lista = criar('div');

  secao.append(linha, status, lista);
  refs.botaoEscanear = escanear;
  refs.botaoGerarTodas = gerar;
  refs.botaoAplicarTodas = aplicar;
  refs.statusImagens = status;
  refs.listaImagens = lista;
  return secao;
}

function montarCaixaImagemNova(): HTMLElement {
  const caixa = criar('div', { className: 'bai-caixa-imagem' });
  caixa.appendChild(criar('div', { className: 'bai-titulo-caixa', texto: 'Imagem nova para o post' }));

  const campoPrompt = criar('div', { className: 'bai-campo' });
  campoPrompt.appendChild(
    criar('label', { className: 'bai-rotulo', texto: 'O que a imagem deve mostrar?', for: 'bai-prompt-imagem' }),
  );
  const prompt = criar('textarea', {
    id: 'bai-prompt-imagem',
    className: 'bai-entrada bai-area',
    rows: '2',
    placeholder: 'ex.: mesa de escritório com notebook aberto e café, luz da manhã, estilo fotográfico',
  }) as HTMLTextAreaElement;
  campoPrompt.appendChild(prompt);

  const linhaPrompt = criar('div', { className: 'bai-linha-botoes' });
  const montar = criar('button', {
    className: 'bai-botao',
    texto: 'Montar pelo post',
    type: 'button',
    onclick: () => void montarPromptDaImagem(),
  }) as HTMLButtonElement;
  const gerar = criar('button', {
    className: 'bai-botao bai-principal',
    texto: 'Gerar imagem com IA',
    type: 'button',
    onclick: () => void gerarImagemIA(),
  }) as HTMLButtonElement;
  linhaPrompt.append(montar, gerar);

  const linhaProporcao = criar('div', { className: 'bai-linha-campos' });
  const rotuloProporcao = criar('label', {
    className: 'bai-rotulo bai-rotulo-inline',
    texto: 'Formato',
    for: 'bai-proporcao-imagem',
  });
  const proporcao = criar('select', {
    id: 'bai-proporcao-imagem',
    className: 'bai-entrada bai-entrada-curta',
  }) as HTMLSelectElement;
  for (const valor of ['16:9', '4:3', '1:1', '3:4', '9:16']) {
    proporcao.appendChild(
      criar('option', {
        value: valor,
        texto: valor === '16:9' ? '16:9 (capa do post)' : valor,
      }) as HTMLOptionElement,
    );
  }
  linhaProporcao.append(rotuloProporcao, proporcao);

  const linhaArquivo = criar('div', { className: 'bai-linha-botoes' });
  const arquivo = criar('input', { type: 'file', accept: 'image/*', className: 'bai-oculto' }) as HTMLInputElement;
  arquivo.addEventListener('change', () => escolherImagemDoComputador(arquivo.files));
  const escolher = criar('button', {
    className: 'bai-botao',
    texto: 'Escolher do computador',
    type: 'button',
    onclick: () => arquivo.click(),
  }) as HTMLButtonElement;
  const padrao = criar('button', {
    className: 'bai-botao',
    texto: 'Usar imagem padrão',
    type: 'button',
    onclick: () => usarImagemPadrao(),
  }) as HTMLButtonElement;
  linhaArquivo.append(escolher, padrao, arquivo);

  const status = criar('div', { className: 'bai-status bai-info' });
  const preview = criar('div', { className: 'bai-preview-imagem bai-oculto' });

  const detalhe = criar('details', { className: 'bai-detalhe' });
  detalhe.appendChild(criar('summary', { texto: 'Como a imagem é feita' }));
  detalhe.appendChild(
    criar('div', {
      className: 'bai-dica',
      texto:
        'A imagem é criada pelo serviço de imagem do Google, a partir do comando que você escreveu. Esse serviço é pago: contas do Google no nível gratuito têm cota de 0 imagens por dia e a geração não funciona. ' +
        'Alternativas que funcionam sempre: cole o comando em um serviço de imagens (por exemplo, o Gemini no navegador), salve a imagem e use "Escolher do computador"; ou use "Usar imagem padrão" para deixar um espaço reservado no post. ' +
        'Para gerar direto por aqui, ative o faturamento da conta no Google AI Studio.',
    }),
  );

  caixa.append(campoPrompt, linhaPrompt, linhaProporcao, linhaArquivo, status, preview, detalhe);
  refs.promptImagem = prompt;
  refs.proporcaoImagem = proporcao;
  refs.botaoPromptImagem = montar;
  refs.botaoGerarImagem = gerar;
  refs.botaoEscolherImagem = escolher;
  refs.botaoImagemPadrao = padrao;
  refs.arquivoImagem = arquivo;
  refs.statusImagem = status;
  refs.previewImagem = preview;
  return caixa;
}

function montarSecaoChecklist(): HTMLElement {
  const secao = criar('section', { className: 'bai-secao bai-secao-checklist' });

  const resumo = criar('div', {
    className: 'bai-resumo bai-aviso',
    texto: 'Aguardando o editor...',
  });

  const linha = criar('div', { className: 'bai-linha-botoes' });
  const reauditar = criar('button', {
    className: 'bai-botao',
    texto: 'Reler agora',
    type: 'button',
    onclick: () => {
      // Recomeça a leitura do zero, sem perder o editor apontado manualmente.
      if (!estado.editorManual) {
        estado.editor = null;
        estado.janela = null;
      }
      estado.campoDesc = null;
      buscaFalhouEm = 0;
      renderizarChecklist();
    },
  }) as HTMLButtonElement;
  const conferirMeta = criar('button', {
    className: 'bai-botao',
    texto: 'Conferir meta-descrição',
    type: 'button',
    onclick: () => void conferirMetaDescricao(),
  }) as HTMLButtonElement;
  linha.append(reauditar, conferirMeta);

  const dica = criar('div', {
    className: 'bai-dica',
    texto:
      'O checklist se atualiza sozinho a cada 5 segundos. "Reler agora" força uma leitura nova e não perde nada (nem o editor apontado à mão).',
  });
  const atualizado = criar('div', { className: 'bai-dica', texto: 'Atualizado às --:--:--' });
  const lista = criar('div');

  secao.append(resumo, linha, dica, atualizado, lista);
  refs.resumoCheck = resumo;
  refs.checkAtualizado = atualizado;
  refs.listaCheck = lista;
  return secao;
}

function trocarAba(id: AbaId): void {
  estado.abaAtual = id;
  for (const botao of refs.abas) {
    const ativa = botao.dataset.aba === id;
    botao.classList.toggle('bai-ativa', ativa);
    botao.setAttribute('aria-selected', ativa ? 'true' : 'false');
  }
  for (const [nome, secao] of Object.entries(refs.secoes)) {
    secao.classList.toggle('bai-oculto', nome !== id);
  }
  if (id === 'checklist') renderizarChecklist();
  if (id === 'imagens' && !estado.imagens.length) escanearImagens();
}

function alternarPainel(forcar?: boolean): void {
  const abrir = typeof forcar === 'boolean' ? forcar : refs.painel.classList.contains('bai-oculto');
  refs.painel.classList.toggle('bai-oculto', !abrir);
  refs.botao.classList.toggle('bai-oculto', abrir);
  if (abrir) {
    void atualizarStatusChave();
    if (estado.abaAtual === 'checklist') renderizarChecklist();
  }
}

// Modo de emergência: o usuário clica na área de escrita e o assistente guarda esse elemento.
function iniciarEscolhaManual(): void {
  const janelas = janelasAlcancaveis();
  definirStatus(
    refs.statusTexto,
    'Clique na área onde você escreve o post (o assistente vai aprender o caminho).',
    'info',
  );

  const capturar = (evento: MouseEvent) => {
    const alvo = evento.target as Element | null;
    if (alvo && alvo.closest && alvo.closest('#' + RAIZ_ID)) return; // cliques no painel são ignorados
    evento.preventDefault();
    evento.stopPropagation();
    const editavel = alvo && alvo.closest ? (alvo.closest(SELETOR_EDITAVEIS) as HTMLElement | null) : null;
    if (editavel) {
      estado.editor = editavel;
      estado.editorManual = true;
      try {
        estado.janela = editavel.ownerDocument.defaultView;
      } catch {
        estado.janela = window;
      }
      definirStatus(refs.statusTexto, 'Editor apontado manualmente. Agora use as abas normalmente.', 'ok');
      agendarChecklist();
    } else {
      definirStatus(refs.statusTexto, 'Esse ponto não é a área de escrita. Tente de novo pelo botão do rodapé.', 'aviso');
    }
    for (const janela of janelas) {
      try {
        janela.document.removeEventListener('click', capturar, true);
        if (janela.document.body) janela.document.body.style.cursor = '';
      } catch {
        // janela inacessível; ignora
      }
    }
  };

  for (const janela of janelas) {
    try {
      janela.document.addEventListener('click', capturar, true);
      if (janela.document.body) janela.document.body.style.cursor = 'crosshair';
    } catch {
      // janela inacessível; ignora
    }
  }
}

async function atualizarStatusChave(): Promise<void> {
  try {
    const dados = await enviarParaFundo<StatusChave>({ type: 'GET_STATUS' });
    const temChave = dados.provedor === 'deepseek' ? dados.temDeepSeek : dados.temGoogle;
    if (!temChave) {
      refs.pill.textContent = 'sem chave';
      refs.pill.className = 'bai-pill bai-falha';
    } else if (!dados.desbloqueada) {
      refs.pill.textContent = 'chave bloqueada';
      refs.pill.className = 'bai-pill bai-aviso';
    } else {
      refs.pill.textContent = 'chave ativa';
      refs.pill.className = 'bai-pill bai-ok';
    }
  } catch {
    refs.pill.textContent = 'indisponível';
    refs.pill.className = 'bai-pill bai-falha';
  }
}

// ---------------------------------------------------------------------------
// Preferências e vigias
// ---------------------------------------------------------------------------

function lerArmazenamentoLocal(chave: string | string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(chave, (itens) => resolve((itens || {}) as Record<string, unknown>));
    } catch {
      resolve({});
    }
  });
}

function gravarArmazenamentoLocal(dados: Record<string, unknown>): void {
  try {
    chrome.storage.local.set(dados, () => void chrome.runtime.lastError);
  } catch {
    // sem armazenamento disponível; a preferência vale só nesta aba
  }
}

async function carregarPreferencias(): Promise<void> {
  const dados = await lerArmazenamentoLocal([CHAVE_KEYWORD, CHAVE_PERSONA]);
  const salva = dados[CHAVE_KEYWORD];
  if (typeof salva === 'string' && salva) {
    estado.keyword = salva;
    refs.keyword.value = salva;
  }
  const persona = dados[CHAVE_PERSONA];
  if (typeof persona === 'string' && persona && refs.persona) {
    refs.persona.value = persona;
  }
  await lerMetaCache();
}

const janelasComVigia = new WeakSet<Document>();

function garantirVigiasDeDigitacao(): void {
  for (const janela of janelasAlcancaveis()) {
    let doc: Document | null = null;
    try {
      doc = janela.document;
    } catch {
      continue;
    }
    if (!doc || janelasComVigia.has(doc)) continue;
    janelasComVigia.add(doc);
    const aoDigitar = (evento: Event) => {
      const alvo = evento.target as Element | null;
      if (!alvo || typeof alvo.closest !== 'function') return;
      if (alvo.closest('#' + RAIZ_ID)) return;
      const editor = estado.editor;
      if (editor && (editor === alvo || editor.contains(alvo))) agendarChecklist();
    };
    doc.addEventListener('input', aoDigitar, true);
    doc.addEventListener('change', aoDigitar, true);
  }
}

function iniciarVigias(): void {
  garantirVigiasDeDigitacao();

  setInterval(() => {
    garantirVigiasDeDigitacao();
    if (location.href !== estado.urlAtual) {
      estado.urlAtual = location.href;
      estado.editor = null;
      estado.janela = null;
      estado.campoDesc = null;
      estado.imagens = [];
      estado.totalImagens = 0;
      estado.resultadoLinks = null;
      estado.imagemCriada = null;
      estado.altImagem = '';
      estado.metaCache = null;
      void lerMetaCache();
      if (refs.resultadoTexto) refs.resultadoTexto.textContent = '';
      if (refs.listaImagens) refs.listaImagens.textContent = '';
      if (refs.previewImagem) {
        refs.previewImagem.textContent = '';
        refs.previewImagem.classList.add('bai-oculto');
      }
      void atualizarStatusChave();
    }
  }, INTERVALO_VARREDURA);

  setInterval(() => {
    if (
      estado.abaAtual === 'checklist' &&
      !estado.ocupado &&
      !estado.verificandoLinks &&
      !refs.painel.classList.contains('bai-oculto')
    ) {
      renderizarChecklist();
    }
  }, 5000);
}

function iniciar(): void {
  if (!document.body) {
    window.setTimeout(iniciar, 500);
    return;
  }
  montarUI();
  void carregarPreferencias();
  void atualizarStatusChave();
  iniciarVigias();
  trocarAba('texto');
}

if (window.top === window && !window.__baiSeoAtivo) {
  window.__baiSeoAtivo = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
}
