/**
 * MCP servers as Settings keeps them (`mcpServers`, read by src-tauri
 * mcp/mod.rs): a program to start, or a URL to reach, each with its own
 * switch. Settings › Extensions › MCP edits them.
 */

export interface McpServer {
  /** Stable, made when it is added. */
  id: string;
  name: string;
  enabled: boolean;
  /** The program to start (npx, uvx, a path) - or "" for a URL. */
  command: string;
  args: string[];
  env: Record<string, string>;
  /** A Streamable HTTP endpoint - or "" for a command. */
  url: string;
  headers: Record<string, string>;
}

/** Ready-made servers to add: none needs an account or a key, and none
 *  does what Textus AI does itself already - reading the project's files,
 *  remembering, searching the web. Each starts with the command its own
 *  README gives. */
export interface McpPreset {
  id: string;
  name: string;
  /** What it gives Textus AI, by language code (`zh-Hant` before `zh`);
   *  English for the rest. */
  description: Record<string, string>;
  command: string;
  args: string[];
  homepage: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "arxiv",
    name: "arXiv",
    description: {
      en: "Searches arXiv, reads papers in full and follows their citations.",
      zh: "搜索 arXiv 论文，读全文，查看引用关系。",
      "zh-Hant": "搜尋 arXiv 論文，讀全文，查看引用關係。",
      ja: "arXiv の論文を検索し、全文を読み、引用関係をたどります。",
      ko: "arXiv 논문을 검색하고, 전문을 읽고, 인용 관계를 따라갑니다.",
      es: "Busca en arXiv, lee los artículos completos y sigue sus citas.",
      fr: "Cherche dans arXiv, lit les articles en entier et suit leurs citations.",
      de: "Durchsucht arXiv, liest Artikel vollständig und folgt ihren Zitaten.",
      ru: "Ищет статьи в arXiv, читает их целиком и показывает цитирования.",
      pt: "Pesquisa no arXiv, lê os artigos completos e segue as suas citações.",
    },
    command: "uvx",
    args: ["arxiv-mcp-server"],
    homepage: "https://github.com/blazickjp/arxiv-mcp-server",
  },
  {
    id: "ares",
    name: "ARES",
    description: {
      en: "Finds papers in OpenAlex, arXiv and Crossref, and fetches a DOI's BibTeX for your references.",
      zh: "在 OpenAlex、arXiv、Crossref 中查找文献，并按 DOI 取回 BibTeX，方便写参考文献。",
      "zh-Hant":
        "在 OpenAlex、arXiv、Crossref 中查找文獻，並按 DOI 取回 BibTeX，方便寫參考文獻。",
      ja: "OpenAlex・arXiv・Crossref で文献を探し、DOI から BibTeX を取得して参考文献づくりを助けます。",
      ko: "OpenAlex, arXiv, Crossref에서 문헌을 찾고 DOI로 BibTeX를 가져와 참고문헌 작성을 돕습니다.",
      es: "Busca artículos en OpenAlex, arXiv y Crossref, y trae el BibTeX de un DOI para tus referencias.",
      fr: "Trouve des articles dans OpenAlex, arXiv et Crossref, et récupère le BibTeX d’un DOI pour vos références.",
      de: "Findet Artikel in OpenAlex, arXiv und Crossref und holt das BibTeX zu einer DOI für deine Literaturliste.",
      ru: "Ищет статьи в OpenAlex, arXiv и Crossref и получает BibTeX по DOI для списка литературы.",
      pt: "Encontra artigos no OpenAlex, arXiv e Crossref, e obtém o BibTeX de um DOI para as suas referências.",
    },
    command: "uvx",
    args: ["ares-mcp"],
    homepage: "https://pypi.org/project/ares-mcp/",
  },
  {
    id: "context7",
    name: "Context7",
    description: {
      en: "Up-to-date documentation and code examples for programming libraries, for technical writing.",
      zh: "各种编程库的最新文档和代码示例，适合写技术文章。",
      "zh-Hant": "各種程式庫的最新文件和程式碼範例，適合寫技術文章。",
      ja: "プログラミングライブラリの最新ドキュメントとコード例。技術文書の執筆に。",
      ko: "프로그래밍 라이브러리의 최신 문서와 코드 예제. 기술 문서 작성에 알맞습니다.",
      es: "Documentación al día y ejemplos de código de bibliotecas de programación, para escritura técnica.",
      fr: "Documentation à jour et exemples de code des bibliothèques de programmation, pour la rédaction technique.",
      de: "Aktuelle Dokumentation und Codebeispiele zu Programmierbibliotheken, für technisches Schreiben.",
      ru: "Актуальная документация и примеры кода для программных библиотек — для технических текстов.",
      pt: "Documentação atualizada e exemplos de código de bibliotecas de programação, para escrita técnica.",
    },
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    homepage: "https://github.com/upstash/context7",
  },
];

/** A preset's description in `lang` (zh-Hant its own, not zh's), else
 *  English. */
export function presetDescription(preset: McpPreset, lang: string): string {
  return (
    preset.description[lang] ??
    preset.description[lang.split("-")[0]] ??
    preset.description.en
  );
}

/** A command line split into its words: spaces separate them, except in
 *  quotes ("…" or '…'), and a backslash keeps the next character. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length && quote !== "'") {
      word += line[++i];
      started = true;
    } else if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** Words as a command line, quoting the ones that need it. */
export function joinCommandLine(words: string[]): string {
  return words
    .map((w) => (w === "" || /[\s"'\\]/.test(w) ? JSON.stringify(w) : w))
    .join(" ");
}

/** `KEY=value` lines as a record; blank lines and lines without `=` are
 *  left out. */
export function parsePairs(
  text: string,
  separator = "=",
): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key) pairs[key] = line.slice(at + separator.length).trim();
  }
  return pairs;
}

export function formatPairs(
  pairs: Record<string, string>,
  separator = "=",
): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}${separator}${v}`)
    .join("\n");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** Stored servers, as far as they are well formed. */
export function normaliseMcpServers(value: unknown): McpServer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): McpServer[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id) return [];
    return [
      {
        id: s.id,
        name: typeof s.name === "string" ? s.name : s.id,
        enabled: s.enabled === true,
        command: typeof s.command === "string" ? s.command : "",
        args: Array.isArray(s.args)
          ? s.args.filter((a): a is string => typeof a === "string")
          : [],
        env: isStringRecord(s.env) ? s.env : {},
        url: typeof s.url === "string" ? s.url : "",
        headers: isStringRecord(s.headers) ? s.headers : {},
      },
    ];
  });
}
