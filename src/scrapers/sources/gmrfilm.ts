/**
 * Source adapter: GMR/muvipro FILM sites (generic).
 *
 * Why this file exists:
 * Several Indonesian movie sites share the WordPress "GMR Movies"/muvipro theme
 * (identical markup: `.gmr-item-modulepost` cards, muvipro player tabs). This ONE
 * adapter drives ALL of them — only the baseUrl differs per source id. Films are
 * single videos, modeled as an anime with exactly ONE "episode" (the movie) so
 * they reuse the existing models/screens.
 *
 * Playback: prefer a clean player iframe in the page (e.g. playerp2p) loaded
 * directly in the in-app WebView; if the theme injects the player via AJAX (no
 * static iframe), fall back to loading the movie PAGE itself in the WebView,
 * where the theme's own JS builds the player client-side.
 *
 * Live-verified June 2026: iyengaryogacenter.com (primary), evilseniors.com (backup).
 */
import * as cheerio from 'cheerio';
import type { AnimeSource, SourceId } from '../../config';
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
  card: '.gmr-item-modulepost, article.item-infinite, article.item',
  cardLink: 'a[itemprop="url"], a[rel="bookmark"]',
  cardImg: 'img',
  cardTitle: '.entry-title, .title, h2',
  detailTitle: 'h1.entry-title, .entry-title, h1',
  detailPoster: 'figure.pull-left img, .gmr-movie-data img, [itemprop="image"], .thumb img, article img',
  detailGenre: 'span[itemprop="genre"] a, .gmr-movie-genre a, a[rel="tag"]',
} as const;

// Taxonomy / non-movie permalinks to skip when harvesting cards.
const TAXONOMY = /\/(category|genre|tag|country|year|director|cast|network|quality|season|tv-show|page)\//i;

function slugTitle(nativeSlug: string): string {
  return lastPathSegment(nativeSlug)
    .replace(/^nonton-(film-)?/i, '')
    .replace(/-/g, ' ')
    .replace(/\s*\b(19|20)\d{2}\b\s*$/, '')
    .trim();
}

export class GmrFilmAdapter extends BaseAdapter {
  readonly id: SourceId;

  constructor(source: AnimeSource) {
    super(source);
    this.id = source.id;
  }

  private card($el: cheerio.Cheerio<never>): AnimeListItem | null {
    const $a = ($el.find(SEL.cardLink).first().length
      ? $el.find(SEL.cardLink).first()
      : $el.find('a').first()) as cheerio.Cheerio<never>;
    // Movie pages are GMR permalinks (full URL); the slug IS the full URL.
    const href = absoluteUrl(this.source.baseUrl, $a.attr('href'));
    if (!href || TAXONOMY.test(href) || /[?#]/.test(href)) return null;
    const $img = $el.find(SEL.cardImg).first();
    const title = cleanText(
      ($a.attr('title') || '').replace(/^Permalink (ke|to):\s*/i, '') ||
        $el.find(SEL.cardTitle).first().text() ||
        $img.attr('alt') ||
        '',
    );
    if (!title) return null;
    return {
      title: title.replace(/^Nonton\s+(Film\s+)?/i, '').replace(/\s*\(\d{4}\).*/, '').trim(),
      slug: this.enc(href),
      cover: absoluteUrl(
        this.source.baseUrl,
        $img.attr('src') || $img.attr('data-src') || $img.attr('data-litespeed-src'),
      ),
      latest_episode: null,
      status: 'Film',
    };
  }

  private harvest(html: string, into: AnimeListItem[], seen: Set<string>): void {
    const $ = cheerio.load(html);
    $(SEL.card)
      .toArray()
      .forEach((el) => {
        const c = this.card($(el) as unknown as cheerio.Cheerio<never>);
        if (c && !seen.has(c.slug)) {
          seen.add(c.slug);
          into.push(c);
        }
      });
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
    for (const html of pages) if (html) this.harvest(html, items, seen);
    if (items.length === 0) throw new ScrapeParseError(`${this.id} home empty`);
    return { ongoing: items, latest: [], popular: items.slice(0, 12) };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const html = await sourceGet<string>(this.client, `/?s=${encodeURIComponent(query)}`);
    const items: AnimeListItem[] = [];
    this.harvest(html, items, new Set<string>());
    return items.map((c) => ({
      title: c.title,
      slug: c.slug,
      cover: c.cover,
      status: 'Film',
      genre: [],
    }));
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const fallbackTitle = slugTitle(nativeSlug) || 'Film';
    const episodes = [{ slug: this.enc(nativeSlug), number: 1, title: 'Tonton Film', upload_date: '' }];
    try {
      const html = await sourceGet<string>(this.client, nativeSlug);
      const $ = cheerio.load(html);
      const title =
        cleanText($(SEL.detailTitle).first().text()).replace(/^Nonton\s+(Film\s+)?/i, '').trim() ||
        fallbackTitle;
      const poster =
        $(SEL.detailPoster).first().attr('src') ||
        $(SEL.detailPoster).first().attr('data-src') ||
        $('meta[property="og:image"]').attr('content');

      // GMR keeps metadata in labelled rows: "Genre: Action, Comedy", "Tahun: 2026",
      // rating in the title block ("rata-rata 8.0 dari 10"). Parse those precisely
      // so cast/country/director don't leak into the genre list.
      const rows = $('.gmr-moviedata, .gmr-movie-data')
        .toArray()
        .map((el) => cleanText($(el).text()));
      let genre: string[] = [];
      let year: number | null = title.match(/\b(19|20)\d{2}\b/)
        ? Number(title.match(/\b((?:19|20)\d{2})\b/)![1])
        : null;
      for (const row of rows) {
        const g = row.match(/^Genre\s*:\s*(.+)$/i);
        if (g?.[1]) genre = g[1].split(/[,،]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
        const y = row.match(/Tahun\s*:\s*((?:19|20)\d{2})/i);
        if (y?.[1]) year = Number(y[1]);
      }
      const ratingRaw =
        $('[itemprop="ratingValue"]').attr('content') ||
        $('[itemprop="ratingValue"]').first().text() ||
        (html.match(/rata-rata\s*([\d.]+)\s*dari/i)?.[1] ?? '');
      const rating = cleanText(ratingRaw).match(/^\d+(\.\d+)?$/) ? cleanText(ratingRaw) : 'N/A';

      return {
        title: title.replace(/\s*\(\d{4}\).*/, '').trim(),
        slug: this.enc(nativeSlug),
        cover: absoluteUrl(this.source.baseUrl, poster),
        synopsis: cleanText(
          $('meta[property="og:description"]').attr('content') ||
            $('[itemprop="description"] p, .entry-content p, .desc').first().text() ||
            '',
        ),
        genre,
        status: 'Film',
        year,
        rating,
        total_episodes: 1,
        episodes,
      };
    } catch {
      return {
        title: fallbackTitle,
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
    // The in-app WebView loads the movie PAGE directly: the theme's own JS builds
    // the player client-side. Loading the bare player iframe instead black-screens
    // (it needs its parent page's context/referer). Instant — no server fetch.
    return {
      anime_title: slugTitle(nativeSlug) || 'Film',
      anime_slug: this.enc(nativeSlug),
      episode_number: 1,
      sources: [],
      prev_episode_slug: null,
      next_episode_slug: null,
      embed_url: nativeSlug,
    };
  }
}
