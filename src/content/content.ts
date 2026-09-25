// content.ts — injetado apenas nas URLs do editor do Blogger.
// Responsabilidades: localizar o editor (inclusive dentro de iframes same-origin,
// DevLog item 1), construir a UI, ler/escrever no post com Range/Selection e
// conversar com o service worker (que centraliza a IA por causa do CORS, DevLog item 3).

import './content.css';
import type {
  MensagemParaFundo,
  RespostaFundo,
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
const LIMITE_TEXTO = 15000;
const MAX_IMAGENS = 15;
const MAX_LINKS_UI = 20;
const INTERVALO_VARREDURA = 2500;

type AbaId = 'texto' | 'imagens' | 'checklist';
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
}

interface Estado {
  abaAtual: AbaId;
  janela: Window | null;
  editor: HTMLElement | null;
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
}

const estado: Estado = {
  abaAtual: 'texto',
  janela: null,
  editor: null,
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
  botaoEscanear: HTMLButtonElement;
  botaoGerarTodas: HTMLButtonElement;
  botaoAplicarTodas: HTMLButtonElement;
  statusImagens: HTMLElement;
  listaImagens: HTMLElement;
  resumoCheck: HTMLElement;
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
    let nos: NodeListOf<HTMLElement>;
    try {
      nos = doc.querySelectorAll<HTMLElement>(
        '[contenteditable="true"], [contenteditable=""], [role="textbox"][contenteditable="true"]',
      );
    } catch {
      continue;
    }
    for (const el of Array.from(nos)) {
      if (!visivel(el)) continue;
      if (el.closest('#' + RAIZ_ID)) continue;
      const retangulo = el.getBoundingClientRect();
      if (retangulo.width < 240 || retangulo.height < 80) continue;
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

function localizarCampoTitulo(janela: Window | null, editor: HTMLElement | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!janela) return null;
  let doc: Document | null = null;
  try {
    doc = janela.document;
  } catch {
    return null;
  }
  if (!doc) return null;
  const campos = Array.from(
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], input:not([type]), textarea'),
  ).filter((el) => visivel(el) && !el.closest('#' + RAIZ_ID));

  const comPista = campos.find((el) => PISTAS_TITULO.test(anotacoes(el)));
  if (comPista) return comPista;

  if (editor) {
    const topoEditor = editor.getBoundingClientRect().top;
    const acima = campos.filter((el) => {
      const retangulo = el.getBoundingClientRect();
      return retangulo.bottom <= topoEditor + 48 && retangulo.width >= 200;
    });
    if (acima.length) {
      acima.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      return acima[0];
    }
  }
  return campos.find((el) => el.getBoundingClientRect().width >= 280) || null;
}

function lerTitulo(): string {
  const campo = localizarCampoTitulo(estado.janela, estado.editor);
  if (!campo) return '';
  return String(campo.value || campo.textContent || '').trim();
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
    definirStatus(refs.statusTexto, 'Não encontrei o editor. Abra a página de edição do post.', 'erro');
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
  if (campo.isContentEditable) inserirTexto(campo, valor);
  else definirValorNativo(campo, valor);
  definirStatus(refs.statusTexto, 'Título aplicado.', 'ok');
  agendarChecklist();
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
  definirStatus(refs.statusTexto, 'Meta-descrição aplicada.', 'ok');
  agendarChecklist();
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

function escanearImagens(): void {
  const editor = localizarEditor();
  if (!editor) {
    definirStatus(refs.statusImagens, 'Não encontrei o editor. Abra a página de edição do post.', 'erro');
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
  definirStatus(refs.statusImagens, comSugestao + ' sugestão(ões) prontas para revisar e aplicar.', 'ok');
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
    if (url.hostname === location.hostname) internos += 1;
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
  return { problemas, resumo };
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
        'Título com 30 a 60 caracteres',
        tamanho >= 30 && tamanho <= 60 ? 'ok' : 'aviso',
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
  const descricao = campoDesc ? String(campoDesc.value || campoDesc.textContent || '').trim() : '';
  if (!campoDesc) {
    itens.push(
      itemChecklist(
        'meta-existe',
        'Meta-descrição definida',
        'info',
        'Abra "Configurações do post" para preencher (a aba Texto sugere uma).',
      ),
    );
  } else if (!descricao) {
    itens.push(itemChecklist('meta-existe', 'Meta-descrição definida', 'falha', 'O campo está vazio.'));
  } else {
    itens.push(
      itemChecklist('meta-existe', 'Meta-descrição definida', 'ok', 'atual: ' + descricao.length + ' caracteres'),
    );
    itens.push(
      itemChecklist(
        'meta-tamanho',
        'Meta-descrição com até 155 caracteres',
        descricao.length <= 155 && descricao.length >= 60 ? 'ok' : 'aviso',
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
    const densidadeOk = densidade >= 0.5 && densidade <= 2.5;
    itens.push(
      itemChecklist(
        'densidade',
        'Densidade da palavra-chave entre 0,5% e 2,5%',
        ocorrencias === 0 ? 'falha' : densidadeOk ? 'ok' : 'aviso',
        ocorrencias + ' ocorrência(s) - ' + densidade.toFixed(2).replace('.', ',') + '%',
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
  itens.push(
    itemChecklist(
      'imagens-alt',
      'Imagens com texto alternativo (alt)',
      coleta.todas.length === 0 ? 'info' : coleta.semAlt.length === 0 ? 'ok' : 'aviso',
      coleta.todas.length === 0
        ? 'O post ainda não tem imagens.'
        : coleta.semAlt.length === 0
          ? coleta.todas.length + ' imagem(ns), todas com descrição'
          : coleta.semAlt.length + ' de ' + coleta.todas.length + ' sem descrição',
    ),
  );

  const links = analisarLinks(editor);
  const detalheLinks = links.resumo + (links.problemas.length ? ' | ' + links.problemas.slice(0, 2).join(' | ') : '');
  itens.push(itemChecklist('links', 'Links válidos e seguros', links.problemas.length ? 'aviso' : 'ok', detalheLinks));

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
  const itens = montarChecklist();
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
      texto: 'Fechar',
      type: 'button',
      onclick: () => alternarPainel(false),
    }),
  ]);

  const abas = montarAbas();
  const corpo = criar('div', { className: 'bai-corpo' });
  const secaoTexto = montarSecaoTexto();
  const secaoImagens = montarSecaoImagens();
  const secaoChecklist = montarSecaoChecklist();
  corpo.append(secaoTexto, secaoImagens, secaoChecklist);
  secaoImagens.classList.add('bai-oculto');
  secaoChecklist.classList.add('bai-oculto');

  const rodape = criar('footer', {
    className: 'bai-rodape',
    texto: 'A chave da API fica no popup da extensão (ícone na barra do Chrome).',
  });

  painel.append(cabecalho, abas, corpo, rodape);
  raiz.append(botao, painel);
  document.body.appendChild(raiz);

  refs.raiz = raiz;
  refs.botao = botao;
  refs.pill = pill;
  refs.painel = painel;
  refs.secoes = { texto: secaoTexto, imagens: secaoImagens, checklist: secaoChecklist };
}

function montarAbas(): HTMLElement {
  const abas = criar('nav', { className: 'bai-abas', role: 'tablist' });
  const definicoes: Array<{ id: AbaId; rotulo: string }> = [
    { id: 'texto', rotulo: 'Texto' },
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

function montarSecaoImagens(): HTMLElement {
  const secao = criar('section', { className: 'bai-secao bai-secao-imagens' });

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

function montarSecaoChecklist(): HTMLElement {
  const secao = criar('section', { className: 'bai-secao bai-secao-checklist' });

  const resumo = criar('div', {
    className: 'bai-resumo bai-aviso',
    texto: 'Aguardando o editor...',
  });

  const linha = criar('div', { className: 'bai-linha-botoes' });
  const reauditar = criar('button', {
    className: 'bai-botao',
    texto: 'Reauditar',
    type: 'button',
    onclick: () => renderizarChecklist(),
  }) as HTMLButtonElement;
  linha.appendChild(reauditar);

  const lista = criar('div');

  secao.append(resumo, linha, lista);
  refs.resumoCheck = resumo;
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

function lerArmazenamentoLocal(chave: string): Promise<Record<string, unknown>> {
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
  const dados = await lerArmazenamentoLocal(CHAVE_KEYWORD);
  const salva = dados[CHAVE_KEYWORD];
  if (typeof salva === 'string' && salva) {
    estado.keyword = salva;
    refs.keyword.value = salva;
  }
}

function iniciarVigias(): void {
  document.addEventListener(
    'input',
    (evento) => {
      const alvo = evento.target as Element | null;
      if (!alvo || typeof alvo.closest !== 'function') return;
      if (alvo.closest('#' + RAIZ_ID)) return;
      const editor = estado.editor;
      if (editor && (editor === alvo || editor.contains(alvo))) agendarChecklist();
    },
    true,
  );

  setInterval(() => {
    if (location.href !== estado.urlAtual) {
      estado.urlAtual = location.href;
      estado.editor = null;
      estado.janela = null;
      estado.campoDesc = null;
      estado.imagens = [];
      estado.totalImagens = 0;
      estado.resultadoLinks = null;
      if (refs.resultadoTexto) refs.resultadoTexto.textContent = '';
      if (refs.listaImagens) refs.listaImagens.textContent = '';
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
