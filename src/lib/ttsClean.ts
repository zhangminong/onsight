const FENCE = /```[\w-]*\n?/g;
const IMAGE = /!\[([^\]]*)\]\([^)]+\)/g;
const LINK = /\[([^\]]+)\]\([^)]+\)/g;
const BOLD = /(\*\*|__)(.+?)\1/g;
const ITALIC = /(\*|_)(.+?)\1/g;
const STRIKE = /~~(.+?)~~/g;
const CODE = /`([^`]+)`/g;
const HEADING = /^\s{0,3}#{1,6}\s*/gm;
const UL = /^\s*[-*+]\s+/gm;
const OL = /^\s*\d+\.\s+/gm;
const THINK_BLOCK =
  /<(?:think|thinking|reasoning|thought)>[\s\S]*?<\/(?:think|thinking|reasoning|thought)>/gi;
const THINK_OPEN = /<(?:think|thinking|reasoning|thought)>[\s\S]*$/i;
const THINK_TAG = /<\/?(?:think|thinking|reasoning|thought)>/gi;

function stripThink(text: string): string {
  let cleaned = text || "";
  cleaned = cleaned.replace(THINK_BLOCK, "");
  cleaned = cleaned.replace(THINK_OPEN, "");
  cleaned = cleaned.replace(THINK_TAG, "");
  cleaned = cleaned.replace(/【思考】[\s\S]*?(?:【回答】|【答案】)/g, "");
  cleaned = cleaned.replace(/^\s*(?:思考过程|推理过程)[:：][\s\S]*?(?=\n\s*(?:回答|结论)[:：])/g, "");
  return cleaned;
}

function stripMarkdown(text: string): string {
  let cleaned = text || "";
  cleaned = cleaned.replace(FENCE, "\n");
  cleaned = cleaned.replace(/```/g, "");
  cleaned = cleaned.replace(IMAGE, "$1");
  cleaned = cleaned.replace(LINK, "$1");
  cleaned = cleaned.replace(BOLD, "$2");
  cleaned = cleaned.replace(ITALIC, "$2");
  cleaned = cleaned.replace(STRIKE, "$1");
  cleaned = cleaned.replace(CODE, "$1");
  cleaned = cleaned.replace(HEADING, "");
  cleaned = cleaned.replace(UL, "• ");
  cleaned = cleaned.replace(OL, "");
  cleaned = cleaned.replace(/[*#_~`]+/g, "");
  return cleaned;
}

export function forDisplay(text: string): string {
  let cleaned = stripMarkdown(stripThink(text));
  cleaned = cleaned.replace(/[ \t]+\n/g, "\n");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

export function forSpeech(text: string): string {
  return forDisplay(text).replace(/\n+/g, "，").replace(/[ \t]+/g, " ").replace(/，{2,}/g, "，").trim();
}
