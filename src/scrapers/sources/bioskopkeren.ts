/**
 * Source adapter: bioskopkeren (FILM) — bioskop-keren.com (→ kebioskop21).
 *
 * Why this file exists:
 * Films are single videos, modeled here as an anime with exactly ONE "episode"
 * (the movie itself) so they reuse the existing models/screens. The movie page
 * exposes an iframe embed (apidrive.php) that plays in the in-app WebView, just
 * like donghua. Live-verified June 2026.
 *
 * Native slug = movie permalink slug. Home redirects to the live content domain;
 * the Axios client follows redirects automatically.
 */
import * as cheerio from 'cheerio';
import type { SourceId } from '../../config';
import { ScrapeParseError } from '../../utils/errors';
import { sourceGet } from '../../utils/http-client';
import { BaseAdapter } from '../source-adapter';
import type {
  AnimeDetail,
  AnimeListItem,
  EpisodeData,
  HomeData,
  SearchResultItem,
} from '../types';
import { absoluteUrl, cleanText, lastPathSegment } from '../util/parse';

const SEL = {
  card: '.moviefilm, article.item-infinite, article.item',
  cardLink: 'a',
  cardImg: 'img',
  cardTitle: '.title, h2, .entry-title',
  detailTitle: 'h1.entry-title, .entry-title, h1',
  detailPoster: '.gmr-movie-data img, .thumb img, .poster img, article img',
  detailGenre: '.gmr-moviedata a[rel="tag"], [rel="tag"], .gmr-movie-genre a',
  detailSynopsis: '.entry-content p, [itemprop="description"] p, .desc',
  playerIframe: '#muvipro_player_content_id iframe, .gmr-embed-responsive iframe, #player iframe, iframe',
} as const;

export class BioskopkerenAdapter extends BaseAdapter {
  readonly id: SourceId = 'bioskopkeren';

  private card($el: cheerio.Cheerio<never>): AnimeListItem | null {
    const $a = $el.find(SEL.cardLink).first();
    // Movie pages live on a separate content domain, so the slug is the FULL URL.
    const href = absoluteUrl(this.source.baseUrl, $a.attr('href'));
    if (!href || !/\/(nonton|film|movie)/i.test(href)) return null;
    const $img = $el.find(SEL.cardImg).first();
    const title = cleanText(
      $a.attr('title') || $el.find(SEL.cardTitle).first().text() || $img.attr('alt') || '',
    );
    if (!title) return null;
    return {
      title: title.replace(/^Nonton\s+(Film\s+)?/i, '').replace(/\s*\(\d{4}\).*/, '').trim(),
      slug: this.enc(href),
      cover: absoluteUrl(this.source.baseUrl, $img.attr('src') || $img.attr('data-src')),
      latest_episode: null,
      status: 'Film',
    };
  }

  async scrapeHome(): Promise<HomeData> {
    // Fetch a few pages so the Film catalog isn't tiny.
    const pages = await Promise.all([
      sourceGet<string>(this.client, '/'),
      sourceGet<string>(this.client, '/page/2/').catch(() => ''),
      sourceGet<string>(this.client, '/page/3/').catch(() => ''),
    ]);
    const items: AnimeListItem[] = [];
    const seen = new Set<string>();
    for (const html of pages) {
      if (!html) continue;
      const $ = cheerio.load(html);
      $(SEL.card)
        .toArray()
        .forEach((el) => {
          const c = this.card($(el) as unknown as cheerio.Cheerio<never>);
          if (c && !seen.has(c.slug)) {
            seen.add(c.slug);
            items.push(c);
          }
        });
    }
    if (items.length === 0) throw new ScrapeParseError('bioskopkeren home empty');
    return {
      ongoing: items,
      latest: [],
      popular: items.slice(0, 12),
    };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const html = await sourceGet<string>(this.client, `/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const out: SearchResultItem[] = [];
    const seen = new Set<string>();
    $(SEL.card)
      .toArray()
      .forEach((el) => {
        const c = this.card($(el) as unknown as cheerio.Cheerio<never>);
        if (c && !seen.has(c.slug)) {
          seen.add(c.slug);
          out.push({ title: c.title, slug: c.slug, cover: c.cover, status: 'Film', genre: [] });
        }
      });
    return out;
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const fallbackTitle =
      lastPathSegment(nativeSlug).replace(/^nonton-film-/i, '').replace(/-/g, ' ').trim() || 'Film';
    const episodes = [
      { slug: this.enc(nativeSlug), number: 1, title: 'Tonton Film', upload_date: '' },
    ];

    try {
      // nativeSlug is the full movie URL (cross-domain, sometimes slow/flaky).
      const html = await sourceGet<string>(this.client, nativeSlug);
      const $ = cheerio.load(html);
      const title =
        cleanText($(SEL.detailTitle).first().text()).replace(/^Nonton\s+(Film\s+)?/i, '').trim() ||
        fallbackTitle;
      const yearMatch = title.match(/\b(19|20)\d{2}\b/) || html.match(/Tahun[^0-9]*(\d{4})/i);

      return {
        title: title.replace(/\s*\(\d{4}\).*/, '').trim(),
        slug: this.enc(nativeSlug),
        cover: absoluteUrl(this.source.baseUrl, $(SEL.detailPoster).first().attr('src')),
        synopsis: cleanText(
          $('meta[property="og:description"]').attr('content') ||
            $(SEL.detailSynopsis).first().text() ||
            '',
        ),
        genre: $(SEL.detailGenre)
          .toArray()
          .map((el) => cleanText($(el).text()))
          .filter(Boolean)
          .slice(0, 6),
        status: 'Film',
        year: yearMatch ? Number(yearMatch[1] ?? yearMatch[0]) : null,
        rating: 'N/A',
        total_episodes: 1,
        episodes,
      };
    } catch {
      // Page slow/unreachable — return a minimal but PLAYABLE detail.
      return {
        title: fallbackTitle.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim() || fallbackTitle,
        slug: this.enc(nativeSlug),
        cover: '',
        synopsis: '',
        genre: [],
        status: 'Film',
        year: null,
        rating: 'N/A',
        total_episodes: 1,
        episodes,
      };
    }
  }

  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    // No server fetch (the movie host is slow/flaky): the WebView loads the
    // movie PAGE directly client-side, where its player works. Title is derived
    // from the slug so this endpoint is instant.
    const title = lastPathSegment(nativeSlug)
      .replace(/^nonton-film-/i, '')
      .replace(/-/g, ' ')
      .replace(/\s*\b(19|20)\d{2}\b\s*$/, '')
      .trim();
    return {
      anime_title: title || 'Film',
      anime_slug: this.enc(nativeSlug),
      episode_number: 1,
      sources: [],
      prev_episode_slug: null,
      next_episode_slug: null,
      embed_url: nativeSlug,
    };
  }
}
