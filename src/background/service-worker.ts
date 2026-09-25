// service-worker.ts — centro do assistente (Manifest V3).
// Guarda as chaves (criptografadas), fala com as APIs de IA (Google Gemini ou DeepSeek)
// e atende content script + popup.
// Decisões do DevLog aplicadas aqui:
// - o service worker "dorme"; todo estado crítico vai para chrome.storage.local na hora;
// - as chamadas externas ficam centralizadas aqui por causa do CORS;
// - o listener devolve `true` para manter o canal aberto até a resposta assíncrona;
// - a chave nunca é registrada em log nem enviada ao content script.

import { encryptKey, decryptKey, type PacoteChave } from '../lib/crypto-utils';
import type {
  MensagemParaFundo,
  Provedor,
  ResultadoLink,
  ResultadoLinks,
  StatusChave,
  SugestaoAlt,
  SugestaoTexto,
} from '../lib/messages';

const ARMAZEM_AJUSTES = 'bai.settings';
const SESSAO_CHAVE = 'bai.sessionKey';

const ENDPOINT_GOOGLE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ENDPOINT_DEEPSEEK = 'https://api.deepseek.com/chat/completions';
const MODELO_PADRAO_GOOGLE = 'gemini-3.8-flash';
const MODELO_PADRAO_DEEPSEEK = 'deepseek-flash';
const LIMITE_TEXTO = 15000;
const MAX_LINKS = 20;

const NOMES_PROVEDOR: Record<Provedor, string> = { google: 'Google', deepseek: 'DeepSeek' };

// Modelos aposentados que podem ter ficado salvos de versões anteriores.
const MODELOS_APOSENTADOS: Record<string, string> = {
  'gemini-2.0-flash': MODELO_PADRAO_GOOGLE,
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
};

function armazemChave(provedor: Provedor): string {
  return 'bai.encryptedKey.' + provedor;
}

const ESQUEMA_TEXTO = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Título do post com até 60 caracteres, contendo a palavra-chave.' },
    meta_description: { type: 'STRING', description: 'Meta-descrição com até 155 caracteres.' },
    improved_text: { type: 'STRING', description: 'Texto revisado em parágrafos separados por linha em branco, sem HTML.' },
    headings: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Até 5 sugestões curtas de subtítulos (H2).' },
    notes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Até 5 observações objetivas de SEO.' },
  },
  required: ['title', 'meta_description', 'improved_text', 'headings', 'notes'],
  propertyOrdering: ['title', 'meta_description', 'improved_text', 'headings', 'notes'],
};

const ESQUEMA_ALT = {
  type: 'OBJECT',
  properties: {
    alt: { type: 'STRING', description: 'Descrição da imagem para o atributo alt (no máximo 10 palavras).' },
    caption: { type: 'STRING', description: 'Legenda curta que complementa a imagem.' },
  },
  required: ['alt', 'caption'],
  propertyOrdering: ['alt', 'caption'],
};

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((mensagem: unknown, remetente, responder) => {
  if (!remetente || remetente.id !== chrome.runtime.id) return false;
  tratarMensagem(mensagem as MensagemParaFundo)
    .then((data) => responder({ ok: true, data }))
    .catch((erro) => responder({ ok: false, error: textoDoErro(erro) }));
  return true;
});

function textoDoErro(erro: unknown): string {
  if (erro && typeof erro === 'object' && 'message' in erro) {
    return String((erro as { message: unknown }).message);
  }
  return 'Falha inesperada na extensão.';
}

async function tratarMensagem(mensagem: MensagemParaFundo): Promise<unknown> {
  await garantirMigracao();
  switch (mensagem.type) {
    case 'GET_STATUS':
      return statusAtual();
    case 'SAVE_KEY':
      return salvarChave(mensagem);
    case 'UNLOCK':
      return desbloquear(mensagem);
    case 'LOCK':
      await bloquear();
      return statusAtual();
    case 'TEST_KEY':
      return testarChave();
    case 'SET_SETTINGS':
      return salvarAjustes({ provedor: mensagem.provedor, modelo: mensagem.modelo });
    case 'AI_OPTIMIZE_TEXT':
      return otimizarTexto(mensagem);
    case 'AI_IMAGE_ALT':
      return gerarAlt(mensagem);
    case 'CHECK_LINKS':
      return verificarLinks(mensagem.urls);
    default:
      throw new Error('Comando desconhecido.');
  }
}

// ---------------------------------------------------------------------------
// Chave de API (BYOK)
// ---------------------------------------------------------------------------

interface AjustesIA {
  provedor: Provedor;
  modelos: Record<Provedor, string>;
}

interface SessaoIA {
  provedor: Provedor;
  apiKey: string;
}

function normalizarProvedor(valor: unknown): Provedor {
  return valor === 'deepseek' ? 'deepseek' : 'google';
}

function normalizarModelo(nome: string, padrao: string): string {
  const modelo = String(nome || '').trim();
  if (!modelo) return padrao;
  return MODELOS_APOSENTADOS[modelo] || modelo;
}

async function obterAjustes(): Promise<AjustesIA> {
  const local = (await chrome.storage.local.get(ARMAZEM_AJUSTES)) as Record<string, unknown>;
  const bruto = (local[ARMAZEM_AJUSTES] || {}) as Record<string, unknown>;
  const modelos = (bruto.modelos || {}) as Record<string, unknown>;
  const modeloAntigo = typeof bruto.modelo === 'string' ? bruto.modelo : '';
  return {
    provedor: normalizarProvedor(bruto.provedor),
    modelos: {
      google: normalizarModelo(String(modelos.google || modeloAntigo || ''), MODELO_PADRAO_GOOGLE),
      deepseek: normalizarModelo(String(modelos.deepseek || ''), MODELO_PADRAO_DEEPSEEK),
    },
  };
}

async function salvarAjustes(parcial: { provedor?: Provedor; modelo?: string }): Promise<StatusChave> {
  const atuais = await obterAjustes();
  const proximo: AjustesIA = {
    provedor: parcial.provedor ? normalizarProvedor(parcial.provedor) : atuais.provedor,
    modelos: { ...atuais.modelos },
  };
  if (parcial.modelo !== undefined) {
    const modelo = String(parcial.modelo || '').trim();
    if (!modelo) throw new Error('Informe o nome do modelo.');
    if (modelo.length > 80) throw new Error('O nome do modelo é longo demais.');
    proximo.modelos[proximo.provedor] = modelo;
  }
  await chrome.storage.local.set({ [ARMAZEM_AJUSTES]: proximo });
  return statusAtual();
}

async function definirProvedorAtivo(provedor: Provedor): Promise<void> {
  const atuais = await obterAjustes();
  await chrome.storage.local.set({
    [ARMAZEM_AJUSTES]: { provedor, modelos: { ...atuais.modelos } },
  });
}

async function obterSessao(): Promise<SessaoIA | null> {
  const dados = (await chrome.storage.session.get(SESSAO_CHAVE)) as Record<string, unknown>;
  const bruto = dados[SESSAO_CHAVE] as { provedor?: unknown; apiKey?: unknown } | undefined;
  if (!bruto || typeof bruto.apiKey !== 'string' || !bruto.apiKey) return null;
  return { provedor: normalizarProvedor(bruto.provedor), apiKey: bruto.apiKey };
}

async function gravarSessao(provedor: Provedor, apiKey: string): Promise<void> {
  await chrome.storage.session.set({ [SESSAO_CHAVE]: { provedor, apiKey } });
}

let migracaoFeita = false;

async function garantirMigracao(): Promise<void> {
  if (migracaoFeita) return;
  migracaoFeita = true;
  try {
    // Formato antigo: uma única chave, sempre do Google.
    const local = (await chrome.storage.local.get(['bai.encryptedKey', armazemChave('google')])) as Record<string, unknown>;
    if (local['bai.encryptedKey'] && !local[armazemChave('google')]) {
      await chrome.storage.local.set({ [armazemChave('google')]: local['bai.encryptedKey'] });
      await chrome.storage.local.remove('bai.encryptedKey');
    }
  } catch {
    // segue sem migração
  }
}

async function statusAtual(): Promise<StatusChave> {
  const ajustes = await obterAjustes();
  const local = (await chrome.storage.local.get([
    armazemChave('google'),
    armazemChave('deepseek'),
  ])) as Record<string, unknown>;
  const sessao = await obterSessao();
  return {
    provedor: ajustes.provedor,
    temGoogle: Boolean(local[armazemChave('google')]),
    temDeepSeek: Boolean(local[armazemChave('deepseek')]),
    desbloqueada: Boolean(sessao && sessao.provedor === ajustes.provedor),
    modelo: ajustes.modelos[ajustes.provedor],
  };
}

async function salvarChave(mensagem: { provedor: Provedor; apiKey: string; masterPassword: string }): Promise<StatusChave> {
  const provedor = normalizarProvedor(mensagem.provedor);
  const chave = String(mensagem.apiKey || '').trim();
  const senha = String(mensagem.masterPassword || '');
  if (!chave) throw new Error('Informe a chave da API.');
  if (chave.length < 20) throw new Error('A chave da API parece curta demais. Confira no painel do provedor.');
  if (senha.length < 8) throw new Error('A senha mestra precisa ter pelo menos 8 caracteres.');

  const pacote = await encryptKey(chave, senha);
  await chrome.storage.local.set({ [armazemChave(provedor)]: pacote });
  await definirProvedorAtivo(provedor);
  await gravarSessao(provedor, chave);
  return statusAtual();
}

async function desbloquear(mensagem: { provedor: Provedor; masterPassword: string }): Promise<StatusChave> {
  const provedor = normalizarProvedor(mensagem.provedor);
  const senha = String(mensagem.masterPassword || '');
  if (!senha) throw new Error('Informe a senha mestra.');
  const local = (await chrome.storage.local.get(armazemChave(provedor))) as Record<string, unknown>;
  const pacote = local[armazemChave(provedor)] as PacoteChave | undefined;
  if (!pacote) {
    throw new Error('Nenhuma chave do ' + NOMES_PROVEDOR[provedor] + ' salva ainda. Salve a chave primeiro.');
  }

  let chave: string;
  try {
    chave = await decryptKey(pacote, senha);
  } catch {
    throw new Error('Senha mestra incorreta.');
  }
  await definirProvedorAtivo(provedor);
  await gravarSessao(provedor, chave);
  return statusAtual();
}

async function bloquear(): Promise<void> {
  await chrome.storage.session.remove(SESSAO_CHAVE);
}

async function obterChaveAtiva(): Promise<SessaoIA> {
  const ajustes = await obterAjustes();
  const sessao = await obterSessao();
  if (!sessao || sessao.provedor !== ajustes.provedor) {
    throw new Error(
      'A chave do ' + NOMES_PROVEDOR[ajustes.provedor] +
        ' está bloqueada. Abra o popup da extensão e desbloqueie com a senha mestra (ou salve a chave).',
    );
  }
  return sessao;
}

async function testarChave(): Promise<{ resposta: string; provedor: string; modelo: string }> {
  const ativa = await obterChaveAtiva();
  const ajustes = await obterAjustes();
  const resposta = await chamarIA({
    prompt: 'Responda apenas com a palavra: ok',
    temperatura: 0,
    maxTokens: 256,
  });
  return {
    resposta: limitarTexto(resposta, 40),
    provedor: NOMES_PROVEDOR[ativa.provedor],
    modelo: ajustes.modelos[ativa.provedor],
  };
}

// ---------------------------------------------------------------------------
// APIs de IA (Google Gemini e DeepSeek)
// ---------------------------------------------------------------------------

interface OpcoesIA {
  prompt: string;
  imagemBase64?: string | null;
  tipoImagem?: string;
  esquema?: object | null;
  temperatura?: number;
  maxTokens?: number;
}

interface RespostaGemini {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

interface RespostaDeepSeek {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function chamarIA(opcoes: OpcoesIA): Promise<string> {
  const ativa = await obterChaveAtiva();
  const ajustes = await obterAjustes();
  const modelo = ajustes.modelos[ativa.provedor];
  if (ativa.provedor === 'deepseek') {
    return chamarDeepSeek(ativa.apiKey, modelo, opcoes);
  }
  return chamarGoogle(ativa.apiKey, modelo, opcoes);
}

async function chamarGoogle(apiKey: string, modelo: string, opcoes: OpcoesIA): Promise<string> {
  const partes: Array<Record<string, unknown>> = [{ text: opcoes.prompt }];
  if (opcoes.imagemBase64) {
    partes.push({
      inline_data: { mime_type: opcoes.tipoImagem || 'image/jpeg', data: opcoes.imagemBase64 },
    });
  }

  const corpo: Record<string, unknown> = {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      temperature: opcoes.temperatura ?? 0.2,
      maxOutputTokens: opcoes.maxTokens ?? 8192,
    },
  };
  if (opcoes.esquema) {
    const config = corpo.generationConfig as Record<string, unknown>;
    config.responseMimeType = 'application/json';
    config.responseSchema = opcoes.esquema;
  }

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 60000);
  let resposta: Response;
  try {
    resposta = await fetch(`${ENDPOINT_GOOGLE}/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    if (erro && erro.name === 'AbortError') {
      throw new Error('A IA demorou demais para responder. Tente novamente.');
    }
    throw new Error('Não consegui falar com a API do Google. Verifique a conexão e tente de novo.');
  } finally {
    clearTimeout(relogio);
  }

  const dados = (await resposta.json().catch(() => null)) as RespostaGemini | null;
  if (!resposta.ok) {
    throw new Error(descreverErroApi('Google', resposta.status, dados?.error?.message ?? undefined));
  }

  const texto = extrairTexto(dados);
  if (!texto) throw new Error('A IA não retornou texto. Tente novamente.');
  return texto;
}

async function chamarDeepSeek(apiKey: string, modelo: string, opcoes: OpcoesIA): Promise<string> {
  const conteudo: Array<Record<string, unknown>> = [{ type: 'text', text: opcoes.prompt }];
  if (opcoes.imagemBase64) {
    const tipo = opcoes.tipoImagem || 'image/jpeg';
    conteudo.push({
      type: 'image_url',
      image_url: { url: `data:${tipo};base64,${opcoes.imagemBase64}` },
    });
  }

  const corpo: Record<string, unknown> = {
    model: modelo,
    messages: [{ role: 'user', content: conteudo }],
    temperature: opcoes.temperatura ?? 0.2,
    max_tokens: opcoes.maxTokens ?? 8192,
  };

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 60000);
  let resposta: Response;
  try {
    resposta = await fetch(ENDPOINT_DEEPSEEK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    if (erro && erro.name === 'AbortError') {
      throw new Error('A IA demorou demais para responder. Tente novamente.');
    }
    throw new Error('Não consegui falar com a API do DeepSeek. Verifique a conexão e tente de novo.');
  } finally {
    clearTimeout(relogio);
  }

  const dados = (await resposta.json().catch(() => null)) as RespostaDeepSeek | null;
  if (!resposta.ok) {
    throw new Error(descreverErroApi('DeepSeek', resposta.status, dados?.error?.message ?? undefined));
  }

  const candidato = dados && dados.choices && dados.choices[0];
  const texto = candidato && candidato.message && candidato.message.content;
  const limpo = typeof texto === 'string' ? texto.trim() : '';
  if (!limpo) throw new Error('A IA não retornou texto. Tente novamente.');
  return limpo;
}

function descreverErroApi(provedorNome: string, status: number, detalheApi?: string): string {
  const detalhe = detalheApi ? ` (${detalheApi})` : '';
  if (status === 400) return 'A chave da API parece inválida ou a solicitação foi recusada.' + detalhe;
  if (status === 401 || status === 403) return 'A chave da API não tem permissão para usar este modelo.' + detalhe;
  if (status === 404) {
    return 'O modelo configurado não foi encontrado. Confira o nome do modelo no popup da extensão.' + detalhe;
  }
  if (status === 429) return 'Limite de uso da API atingido. Aguarde um instante e tente novamente.' + detalhe;
  if (status >= 500) return 'O serviço do ' + provedorNome + ' está instável agora. Tente novamente em instantes.' + detalhe;
  return 'A API do ' + provedorNome + ' respondeu com erro ' + status + '.' + detalhe;
}

function extrairTexto(dados: RespostaGemini | null): string {
  const candidato = dados && dados.candidates && dados.candidates[0];
  const partes = candidato && candidato.content && candidato.content.parts;
  if (!partes || !partes.length) {
    const motivo = dados && dados.promptFeedback && dados.promptFeedback.blockReason;
    if (motivo) throw new Error('O conteúdo foi bloqueado pela IA (' + motivo + ').');
    if (candidato && candidato.finishReason === 'MAX_TOKENS') {
      throw new Error('A IA atingiu o limite de resposta antes de escrever. Tente novamente.');
    }
    return '';
  }
  return partes.map((parte) => parte.text || '').join('').trim();
}

// ---------------------------------------------------------------------------
// Otimização de texto
// ---------------------------------------------------------------------------

async function otimizarTexto(mensagem: { text: string; title: string; keyword: string }): Promise<SugestaoTexto> {
  const texto = String(mensagem.text || '').trim();
  const titulo = limitarTexto(mensagem.title, 160);
  const palavraChave = limitarTexto(mensagem.keyword, 120);

  if (texto.length < 40) throw new Error('O texto do post está muito curto para analisar.');
  if (!palavraChave) throw new Error('Informe a palavra-chave principal do post.');

  const bruto = await chamarIA({
    prompt: montarPromptTexto({ texto, titulo, palavraChave }),
    esquema: ESQUEMA_TEXTO,
    temperatura: 0.2,
    maxTokens: 8192,
  });

  return normalizarOtimizacao(lerJson(bruto));
}

function montarPromptTexto(dados: { texto: string; titulo: string; palavraChave: string }): string {
  const cortado = dados.texto.length > LIMITE_TEXTO;
  const trecho = cortado ? dados.texto.slice(0, LIMITE_TEXTO) : dados.texto;
  const linhas = [
    'Você é um especialista em SEO para blogs e escreve em português do Brasil.',
    'Analise o post abaixo e responda SOMENTE com o JSON pedido, sem comentários.',
    '',
    'Palavra-chave principal: "' + dados.palavraChave + '"',
    dados.titulo ? 'Título atual: "' + dados.titulo + '"' : 'O post ainda não tem título.',
    '',
    'Regras:',
    '- title: no máximo 60 caracteres, com a palavra-chave, sem sensacionalismo.',
    '- meta_description: no máximo 155 caracteres, com a palavra-chave, resumindo o conteúdo.',
    '- improved_text: reescreva melhorando clareza e legibilidade, sem mudar o sentido;',
    '  mantenha os parágrafos separados por linha em branco; não use HTML.',
    '- headings: até 5 sugestões curtas de subtítulos (H2), em ordem de aparição.',
    '- notes: até 5 observações objetivas (legibilidade, densidade da palavra-chave, estrutura).',
  ];
  if (cortado) linhas.push('(Observação: o texto foi cortado no limite de análise.)');
  linhas.push('', 'POST:', '"""', trecho, '"""');
  return linhas.join('\n');
}

function normalizarOtimizacao(bruto: unknown): SugestaoTexto {
  const dados = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const saida: SugestaoTexto = {
    title: limitarTexto(dados.title, 70),
    meta_description: limitarTexto(dados.meta_description, 160),
    improved_text: String(dados.improved_text || '').trim(),
    headings: vetorDeTextos(dados.headings, 8, 90),
    notes: vetorDeTextos(dados.notes, 8, 220),
  };
  if (!saida.title && !saida.meta_description && !saida.improved_text) {
    throw new Error('A IA devolveu uma resposta vazia. Tente novamente.');
  }
  return saida;
}

// ---------------------------------------------------------------------------
// ALT de imagens (visão)
// ---------------------------------------------------------------------------

async function gerarAlt(mensagem: {
  src: string;
  contexto: { titulo: string; palavraChave: string };
}): Promise<SugestaoAlt> {
  const src = String(mensagem.src || '').trim();
  if (!src) throw new Error('A imagem não tem endereço utilizável.');
  if (!/^(https?:|data:image)/i.test(src)) {
    throw new Error('Não consigo analisar este tipo de imagem.');
  }

  const { base64, tipo } = await baixarImagem(src);
  const bruto = await chamarIA({
    prompt: montarPromptImagem(mensagem.contexto),
    imagemBase64: base64,
    tipoImagem: tipo,
    esquema: ESQUEMA_ALT,
    temperatura: 0.2,
    maxTokens: 1024,
  });
  return normalizarAlt(lerJson(bruto));
}

function montarPromptImagem(contexto: { titulo: string; palavraChave: string }): string {
  const linhas = [
    'Você descreve imagens para acessibilidade (atributo alt) de blogs, em português do Brasil.',
  ];
  if (contexto && contexto.titulo) linhas.push('Título do post: "' + limitarTexto(contexto.titulo, 120) + '"');
  if (contexto && contexto.palavraChave) linhas.push('Palavra-chave do post: "' + limitarTexto(contexto.palavraChave, 80) + '"');
  linhas.push(
    '',
    'Responda SOMENTE com o JSON pedido.',
    '- alt: descrição específica e objetiva da imagem, no máximo 10 palavras (até 100 caracteres), sem "imagem de" e sem aspas.',
    '- caption: uma frase curta de legenda que complemente a imagem, sem repetir o alt literalmente.',
  );
  return linhas.join('\n');
}

function normalizarAlt(bruto: unknown): SugestaoAlt {
  const dados = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const alt = limitarTexto(dados.alt, 125);
  if (!alt) throw new Error('A IA não conseguiu descrever a imagem.');
  return { alt, caption: limitarTexto(dados.caption, 160) };
}

async function baixarImagem(src: string): Promise<{ base64: string; tipo: string }> {
  let blob: Blob;
  try {
    const resposta = await fetch(src, { redirect: 'follow' });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    blob = await resposta.blob();
  } catch {
    throw new Error('Não consegui baixar a imagem (pode ser privada ou o endereço mudou).');
  }
  if (!/^image\//.test(blob.type || '')) throw new Error('O endereço não devolveu uma imagem.');
  const ajustado = await reduzirImagem(blob);
  if (ajustado.size > 15 * 1024 * 1024) throw new Error('A imagem é grande demais para enviar à IA.');
  return { base64: await blobParaBase64(ajustado), tipo: ajustado.type || 'image/jpeg' };
}

async function reduzirImagem(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const maiorLado = Math.max(bitmap.width, bitmap.height);
    const escala = Math.min(1, 1024 / maiorLado);
    if (escala === 1 && blob.size <= 1500000) {
      bitmap.close();
      return blob;
    }
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const tela = new OffscreenCanvas(largura, altura);
    const contexto = tela.getContext('2d');
    if (!contexto) return blob;
    contexto.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();
    return await tela.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } catch {
    return blob;
  }
}

async function blobParaBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode(...Array.from(bytes.subarray(i, i + passo)));
  }
  return btoa(binario);
}

// ---------------------------------------------------------------------------
// Verificação de links externos (permissão opcional *://*/*)
// ---------------------------------------------------------------------------

async function verificarLinks(lista: string[]): Promise<ResultadoLinks> {
  const urls = [...new Set((Array.isArray(lista) ? lista : []).map((url) => String(url || '').trim()))]
    .filter((url) => /^https?:/i.test(url))
    .slice(0, MAX_LINKS);

  let temPermissao = false;
  try {
    temPermissao = await chrome.permissions.contains({ origins: ['*://*/*'] });
  } catch {
    temPermissao = false;
  }

  const resultados: ResultadoLink[] = [];
  for (const url of urls) {
    resultados.push(await verificarUrl(url));
  }
  return { temPermissao, resultados };
}

async function verificarUrl(url: string): Promise<ResultadoLink> {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 8000);
  try {
    let resposta: Response | null = null;
    try {
      resposta = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controlador.signal });
    } catch {
      resposta = null;
    }
    if (!resposta || resposta.status === 405 || resposta.status === 501) {
      resposta = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
        signal: controlador.signal,
      });
    }
    if (resposta.status >= 200 && resposta.status < 400) {
      return { url, status: 'ok', http: resposta.status };
    }
    return { url, status: 'quebrado', http: resposta.status };
  } catch {
    return { url, status: 'nao_verificado', http: null };
  } finally {
    clearTimeout(relogio);
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    // segue para a tentativa de recorte
  }
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio >= 0 && fim > inicio) {
    try {
      return JSON.parse(texto.slice(inicio, fim + 1));
    } catch {
      // segue para o erro amigável
    }
  }
  throw new Error('A IA devolveu uma resposta em formato inesperado. Tente novamente.');
}

function limitarTexto(valor: unknown, maximo: number): string {
  const texto = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return (ultimoEspaco > maximo * 0.6 ? corte.slice(0, ultimoEspaco) : corte).trim();
}

function vetorDeTextos(valor: unknown, maximo: number, limite: number): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => limitarTexto(item, limite)).filter(Boolean).slice(0, maximo);
}

// Ajustes iniciais na primeira instalação.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local
    .get(ARMAZEM_AJUSTES)
    .then((atual: Record<string, unknown>) => {
      if (!atual[ARMAZEM_AJUSTES]) {
        chrome.storage.local.set({
          [ARMAZEM_AJUSTES]: {
            provedor: 'google',
            modelos: { google: MODELO_PADRAO_GOOGLE, deepseek: MODELO_PADRAO_DEEPSEEK },
          },
        });
      }
    })
    .catch(() => {});
});
