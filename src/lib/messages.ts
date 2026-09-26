// messages.ts — contratos de mensagem entre content script, popup e service worker.

export interface ContextoImagem {
  titulo: string;
  palavraChave: string;
}

export type Provedor = 'google' | 'deepseek';

export interface StatusChave {
  provedor: Provedor;
  temGoogle: boolean;
  temDeepSeek: boolean;
  desbloqueada: boolean;
  modelo: string;
  reserva: boolean;
  provedorReserva: Provedor;
  modeloReserva: string;
}

export interface UsoIA {
  provedor: Provedor;
  modelo: string;
  reserva: boolean;
  quandoIso: string;
}

export interface SugestaoTexto {
  title: string;
  meta_description: string;
  improved_text: string;
  headings: string[];
  notes: string[];
}

export interface SugestaoAlt {
  alt: string;
  caption: string;
}

export type StatusLink = 'ok' | 'quebrado' | 'nao_verificado';

export interface ResultadoLink {
  url: string;
  status: StatusLink;
  http: number | null;
}

export interface ResultadoLinks {
  temPermissao: boolean;
  resultados: ResultadoLink[];
}

export interface PostDoBlog {
  titulo: string;
  url: string;
}

export interface PerfilEstilo {
  perfil: string;
  posts: PostDoBlog[];
  atualizadoEm: string;
}

export interface LinkInterno {
  ancora: string;
  url: string;
}

export interface CriacaoPost {
  titulo: string;
  meta_descricao: string;
  slug: string;
  palavra_chave: string;
  palavras_secundarias: string[];
  corpo_html: string;
  links_internos: LinkInterno[];
  links_externos: LinkInterno[];
  observacoes: string[];
}

export interface ResultadoImagem {
  imagem: string;
  modelo: string;
  alt: string;
}

export interface PromptImagem {
  prompt: string;
  alt: string;
}

export type MensagemParaFundo =
  | { type: 'GET_STATUS' }
  | { type: 'GET_USO' }
  | { type: 'SAVE_KEY'; provedor: Provedor; apiKey: string; masterPassword: string }
  | { type: 'UNLOCK'; provedor: Provedor; masterPassword: string }
  | { type: 'LOCK' }
  | { type: 'TEST_KEY' }
  | { type: 'SET_SETTINGS'; provedor?: Provedor; modelo?: string; reserva?: boolean }
  | { type: 'AI_OPTIMIZE_TEXT'; text: string; title: string; keyword: string }
  | { type: 'AI_IMAGE_ALT'; src: string; contexto: ContextoImagem }
  | { type: 'AI_APRENDER_ESTILO'; blogId: string }
  | { type: 'AI_GERAR_POST'; persona: string; assunto: string; pontos: string; blogId: string }
  | { type: 'AI_PROMPT_IMAGEM'; titulo: string; texto: string; palavraChave: string; estilo: string }
  | { type: 'AI_GERAR_IMAGEM'; prompt: string; proporcao: string; alt: string }
  | { type: 'CHECK_LINKS'; urls: string[] };

export type RespostaFundo<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
