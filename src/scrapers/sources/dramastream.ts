/**
 * Shared adapter for the "dramastream" WordPress theme (Phase 3, live-verified).
 *
 * Why this file exists:
 * All three configured sources — ww2.aniwatch.fit, animeplaytv.com, animepahe.ch
 * — currently run the SAME WordPress theme ("dramastream", a Gogoanime mirror of
 * gogoanime.by), verified by fetching each live in June 2026. They share markup,
 * URL scheme, and player mechanism, so one parser serves all three. Each source
 * file (aniwatch.ts / animeplaytv.ts / animepahe.ts) is a thin subclass that
 * only sets its `id`; if one site later diverges, override `sel`/methods there.
 *
 * Verified structure:
 *   home    GET /                      .listupd article.bs cards
 *           - series cards  -> /series/<slug>/      => ongoing
 *           - episode cards -> /<slug-episode-N>/   => latest
 *           - sidebar .serieslist.pop li            => popular
 *   search  GET /?s=<query>            .listupd article.bs -> /series/<slug>/
 *   anime   GET /series/<slug>/        .entry-title / .genxed / .spe span
 *           episodes: .episode-item[data-episode-number] > a
 *   episode GET /<episodeSlug>/        .player-type-link[data-plain-url] -> embed
 *           prev/next: a[rel=prev] / a[rel=next]
 *           video: embed page (e.g. megaplay.su) exposes a direct .mp4/.m3u8
 *
 * Native slug formats:
 *   anime   : "<series-slug>"            e.g. "one-piece-1"
 *   episode : "<episode-permalink-slug>" e.g. "one-piece-episode-1167-english-subbed"
 */
import * as cheerio from 'cheerio';
import { NotFoundError, ScrapeParseError } from '../../utils/errors';
import { sourceGet } from '../../utils/http-client';
import { BaseAdapter } from '../source-adapter';
import type {
  AnimeDetail,
  AnimeListItem,
  EpisodeData,
  EpisodeListItem,
  HomeData,
  LatestEpisodeItem,
  SearchResultItem,
  VideoSource,
} from '../types';
import {
  absoluteUrl,
  cleanText,
  dedupeAndSortSources,
  extractStreamUrls,
  lastPathSegment,
  parseNumber,
} from '../util/parse';

/** Centralized selectors for the dramastream theme — tune here if it changes. */
const SEL = {
  card: '.listupd article.bs',
  cardLink: '.bsx > a',
  cardTitle: '.tt, .bsx > a',
  cardImg: 'img',
  cardEpisode: '.bt .epx, .epx',
  popularRow: '.serieslist.pop li, .serieslist li',
  seriesTitle: '.entry-title',
  seriesPoster: '.thumbook img, .thumb img',
  seriesGenre: '.genxed a, .sgeneros a',
  seriesInfo: '.spe span',
  episodeItem: '.episode-item',
  playerOption: '.player-type-link',
  navPrev: 'a[rel="prev"]',
  navNext: 'a[rel="next"]',
  seriesLink: 'a[href*="/series/"]',
} as const;

interface ParsedCard {
  href: string;
  slug: string;
  title: string;
  cover: string;
  episodeNumber: number | null;
  isSeries: boolean;
}

export abstract class DramastreamAdapter extends BaseAdapter {
  /** Exposed so a subclass can override individual selectors if it diverges. */
  protected get sel(): typeof SEL {
    return SEL;
  }

  private cover($img: cheerio.Cheerio<never>): string {
    const raw =
      $img.attr('src') ||
      $img.attr('data-src') ||
      $img.attr('data-lazy-src') ||
      ($img.attr('srcset') ?? '').split(' ')[0];
    return absoluteUrl(this.source.baseUrl, raw);
  }

  private parseCard($el: cheerio.Cheerio<never>): ParsedCard | null {
    const $a = $el.find(this.sel.cardLink).first();
    const href = $a.attr('href') ?? '';
    if (!href) return null;
    const title = cleanText($a.attr('title') || $el.find('.tt').first().text());
    const cover = this.cover($el.find(this.sel.cardImg).first() as cheerio.Cheerio<never>);
    const episodeNumber = parseNumber($el.find(this.sel.cardEpisode).first().text());
    return {
      href,
      slug: lastPathSegment(href),
      title,
      cover,
      episodeNumber,
      isSeries: /\/series\//i.test(href),
    };
  }

  // --- Home ------------------------------------------------------------------
  async scrapeHome(): Promise<HomeData> {
    // Front page gives "Latest Release" (episode cards) + a ranked popular
    // sidebar (series). Ongoing series live on a dedicated listing page, fetched
    // in parallel; if it fails, the rail falls back to popular.
    const [homeHtml, ongoingHtml] = await Promise.all([
      sourceGet<string>(this.client, '/'),
      sourceGet<string>(this.client, '/series/?status=Ongoing&order=update').catch(() => ''),
    ]);
    const $ = cheerio.load(homeHtml);

    const latest: LatestEpisodeItem[] = [];
    $(this.sel.card)
      .toArray()
      .forEach((el) => {
        const card = this.parseCard($(el) as unknown as cheerio.Cheerio<never>);
        if (!card || card.isSeries || !card.slug || !card.title) return;
        latest.push({
          anime_title: card.title.replace(/\s*Episode\s+\d+.*$/i, '').trim() || card.title,
          anime_slug: this.enc(card.slug),
          episode_slug: this.enc(card.slug), // episode permalink is directly playable
          episode_number: card.episodeNumber,
          upload_date: '',
          cover: card.cover,
        });
      });

    const popular: AnimeListItem[] = [];
    const seenPopular = new Set<string>();
    $(this.sel.popularRow)
      .toArray()
      .forEach((el) => {
        const $el = $(el);
        const $a = $el.find('a.series, a').first();
        const href = $a.attr('href') ?? '';
        if (!/\/series\//i.test(href)) return;
        const slug = lastPathSegment(href);
        const $img = $el.find('img').first();
        // Sidebar text concatenates genres, so prefer the clean title attrs.
        const title = cleanText($a.attr('title') || $img.attr('title') || $img.attr('alt') || '');
        if (!slug || !title || seenPopular.has(slug)) return;
        seenPopular.add(slug);
        popular.push({
          title,
          slug: this.enc(slug),
          cover: this.cover($img as cheerio.Cheerio<never>),
          latest_episode: null,
          status: '',
        });
      });

    const ongoing: AnimeListItem[] = [];
    const seenOngoing = new Set<string>();
    if (ongoingHtml) {
      const $o = cheerio.load(ongoingHtml);
      $o(this.sel.card)
        .toArray()
        .forEach((el) => {
          const card = this.parseCard($o(el) as unknown as cheerio.Cheerio<never>);
          if (!card || !card.isSeries || !card.slug || !card.title) return;
          if (seenOngoing.has(card.slug)) return;
          seenOngoing.add(card.slug);
          ongoing.push({
            title: card.title,
            slug: this.enc(card.slug),
            cover: card.cover,
            latest_episode: card.episodeNumber,
            status: 'Ongoing',
          });
        });
    }
    // Never leave the Ongoing rail empty.
    if (ongoing.length === 0) ongoing.push(...popular);

    if (ongoing.length === 0 && latest.length === 0 && popular.length === 0) {
      throw new ScrapeParseError(`${this.id} home returned no parseable cards`);
    }
    return { ongoing, latest: latest.slice(0, 30), popular };
  }

  // --- Search ----------------------------------------------------------------
  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const html = await sourceGet<string>(this.client, `/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    $(this.sel.card)
      .toArray()
      .forEach((el) => {
        const card = this.parseCard($(el) as unknown as cheerio.Cheerio<never>);
        if (!card || !card.slug || !card.title) return;
        // Search results are series pages; ignore stray episode links.
        if (!card.isSeries) return;
        if (seen.has(card.slug)) return;
        seen.add(card.slug);
        results.push({
          title: card.title,
          slug: this.enc(card.slug),
          cover: card.cover,
          status: '',
          genre: [],
        });
      });

    return results;
  }

  // --- Anime detail ----------------------------------------------------------
  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const html = await sourceGet<string>(this.client, `/series/${nativeSlug}/`);
    const $ = cheerio.load(html);

    const title = cleanText($(this.sel.seriesTitle).first().text());
    if (!title) throw new NotFoundError(`${this.id} anime not found: ${nativeSlug}`);

    const cover = this.cover($(this.sel.seriesPoster).first() as cheerio.Cheerio<never>);
    const genre = $(this.sel.seriesGenre)
      .toArray()
      .map((el) => cleanText($(el).text()))
      .filter(Boolean);

    // Parse the "label: value" info spans (Status / Released / Type / ...).
    const info = new Map<string, string>();
    $(this.sel.seriesInfo)
      .toArray()
      .forEach((el) => {
        const text = cleanText($(el).text());
        const idx = text.indexOf(':');
        if (idx > 0) info.set(text.slice(0, idx).trim().toLowerCase(), text.slice(idx + 1).trim());
      });
    const released = info.get('released') ?? info.get('aired') ?? '';
    const yearMatch = released.match(/\b(19|20)\d{2}\b/);

    const synopsis = cleanText(
      $('meta[property="og:description"]').attr('content') ||
        $('meta[name="description"]').attr('content') ||
        '',
    );

    const episodes: EpisodeListItem[] = [];
    $(this.sel.episodeItem)
      .toArray()
      .forEach((el) => {
        const $el = $(el);
        const href = $el.find('a').first().attr('href') ?? '';
        const slug = lastPathSegment(href);
        if (!slug) return;
        const number = parseNumber($el.attr('data-episode-number') || $el.find('a').text());
        episodes.push({
          slug: this.enc(slug),
          number,
          title: cleanText($el.find('a').first().text()) || `Episode ${number ?? ''}`.trim(),
          upload_date: '',
        });
      });

    return {
      title,
      slug: this.enc(nativeSlug),
      cover,
      synopsis,
      genre,
      status: info.get('status') || 'Unknown',
      year: yearMatch ? Number(yearMatch[0]) : null,
      rating: info.get('rating') || 'N/A',
      total_episodes: episodes.length,
      episodes,
    };
  }

  // --- Episode playback ------------------------------------------------------
  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    const html = await sourceGet<string>(this.client, `/${nativeSlug}/`);
    const $ = cheerio.load(html);

    const ogTitle = cleanText($('meta[property="og:title"]').attr('content') || '');
    const animeTitle = ogTitle
      .replace(/\s*Episode\s+\d+.*$/i, '')
      .replace(/\s*-\s*Gogoanime\s*$/i, '')
      .trim();
    const episodeNumber = parseNumber(ogTitle.match(/Episode\s+(\d+)/i)?.[1]);

    // First non-filter /series/ link is the parent anime.
    const seriesHref = $(this.sel.seriesLink)
      .toArray()
      .map((el) => $(el).attr('href') ?? '')
      .find((h) => h.includes('/series/') && !h.includes('?'));
    const animeSlug = seriesHref ? lastPathSegment(seriesHref) : nativeSlug;

    const prevHref = $(this.sel.navPrev).attr('href');
    const nextHref = $(this.sel.navNext).attr('href');

    const sources = await this.resolveSources($);
    if (sources.length === 0) {
      throw new ScrapeParseError(`${this.id} could not extract a stream for ${nativeSlug}`);
    }

    return {
      anime_title: animeTitle || nativeSlug,
      anime_slug: this.enc(animeSlug),
      episode_number: episodeNumber,
      sources,
      prev_episode_slug: prevHref ? this.enc(lastPathSegment(prevHref)) : null,
      next_episode_slug: nextHref ? this.enc(lastPathSegment(nextHref)) : null,
    };
  }

  /**
   * Resolve playable streams from the `.player-type-link` options.
   * Encrypted-only options (no `data-plain-url`, no decryption key) are skipped;
   * options exposing a plaintext embed URL are fetched and scraped for the
   * direct .mp4/.m3u8 their player (e.g. megaplay.su / JWPlayer) embeds.
   */
  private async resolveSources($: cheerio.CheerioAPI): Promise<VideoSource[]> {
    const options = $(this.sel.playerOption)
      .toArray()
      .map((el) => ({
        embed: $(el).attr('data-plain-url') ?? '',
        label: cleanText($(el).text()) || cleanText($(el).attr('data-type')) || 'auto',
      }))
      .filter((o) => o.embed.startsWith('http'));

    const collected: VideoSource[] = [];
    for (const opt of options.slice(0, 3)) {
      try {
        const embedHtml = await sourceGet<string>(this.client, opt.embed);
        const streams = extractStreamUrls(embedHtml).map((s) => ({
          ...s,
          quality: opt.label,
        }));
        collected.push(...streams);
      } catch {
        /* skip an unreachable embed and try the next option */
      }
    }

    return dedupeAndSortSources(collected);
  }
}
