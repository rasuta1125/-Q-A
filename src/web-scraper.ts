/**
 * Webページをクロールしてテキストコンテンツを抽出
 */
export async function scrapeWebPage(url: string): Promise<{ title: string; content: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MacaroniQA/1.0; +https://macaroni-studio.example)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // HTMLから基本的なテキスト抽出（タグを除去）
    const title = extractTitle(html);
    const content = extractContent(html);

    return { title, content };
  } catch (error) {
    throw new Error(`Failed to scrape ${url}: ${(error as Error).message}`);
  }
}

/**
 * HTMLからタイトルを抽出
 */
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }
  return 'Untitled';
}

/**
 * HTMLからコンテンツを抽出（タグを除去）
 */
function extractContent(html: string): string {
  // script, style, navタグを除去
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // HTMLタグを除去
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // HTML entities をデコード
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  // 連続する空白を1つに、連続する改行を2つに
  cleaned = cleaned
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  // 長さ制限（Vectorizeとデータベースサイズを考慮）
  if (cleaned.length > 10000) {
    cleaned = cleaned.substring(0, 10000) + '...';
  }

  return cleaned;
}
