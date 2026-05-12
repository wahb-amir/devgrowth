import * as cheerio from "cheerio";

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function removeNoise($: cheerio.CheerioAPI): void {
  $("script, style, noscript, template, svg, canvas, iframe, path, symbol").remove();
  $("[hidden], [aria-hidden='true']").remove();
  $('[style*="display:none"], [style*="display: none"]').remove();
  $('[style*="visibility:hidden"], [style*="visibility: hidden"]').remove();

  $("nav, footer").each((_, el) => {
    const text = cleanText($(el).text());
    if (text.length < 40) return;
    if (/home|about|projects|contact|resume|privacy|terms/i.test(text)) {
      $(el).attr("data-portfolio-noise", "1");
    }
  });

  $("[data-portfolio-noise='1']").remove();
}

export function extractVisibleBlocks($: cheerio.CheerioAPI): string[] {
  const selectors = [
    "main h1",
    "main h2",
    "main h3",
    "main p",
    "main li",
    "main a",
    "section h1",
    "section h2",
    "section h3",
    "section p",
    "section li",
    "article h1",
    "article h2",
    "article h3",
    "article p",
    "article li",
    "p",
    "li",
    "h1",
    "h2",
    "h3",
  ];

  const blocks: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    $(selector)
      .toArray()
      .slice(0, 250)
      .forEach((el) => {
        const text = cleanText($(el).text());
        if (!text || text.length < 2) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        blocks.push(text);
      });
  }

  return blocks;
}