/**
 * Source adapter: donghub (donghua, primary) — https://donghub.vip
 *
 * Why this file exists:
 * A WordPress donghua aggregator (Anichin/Auratail/etc.) on the Dooplay-family
 * theme. It's the PRIMARY donghua source because it embeds episodes via
 * Dailymotion, which resolves to a direct .m3u8 (see util/dailymotion) — so
 * donghua plays end-to-end. Live-verified June 2026.
 *
 * URL scheme: home `/`, ongoing `/anime/?status=Ongoing`, search `/?s=`,
 * detail `/seri/<slug>/`, episode `/<episode-slug>/`.
 * Native slugs: anime = series slug, episode = episode permalink slug.
 */
import * as cheerio from 'cheerio';
import type { SourceId } from '../../config';
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
import { dailymotionId } from '../util/dailymotion';
import {
  absoluteUrl,
  cleanText,
  dedupeAndSortSources,
  extractStreamUrls,
  lastPathSegment,
  parseNumber,
} from '../util/parse';

const SEL = {
  card: '.listupd article, .listupd .bs',
  cardLink: '.bsx > a',
  cardImg: 'img',
  cardEpisode: '.bt .epx, .epx',
  popularRow: '.serieslist.pop li, .serieslist li',
  detailTitle: '.entry-title',
  detailPoster: '.thumbook img, .thumb img, .ime img',
  detailGenre: '.genxed a, .mgen a, .sgeneros a',
  detailInfo: '.spe span',
  episodeRow: '.eplister ul li a, .eplister li a',
  episodeNum: '.epl-num',
  episodeTitle: '.epl-title',
  episodeDate: '.epl-date',
  playerIframe: '#pembed iframe, .player-embed iframe, #player iframe, iframe',
  mirrorOption: '.mirror option, select.mirror option, #pembed option',
  seriesLink: 'a[href*="/seri/"]',
} as const;

function imgUrl(base: string, $img: cheerio.Cheerio<never>): string {
  return absoluteUrl(
    base,
    $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src'),
  );
}

export class DonghubAdapter extends BaseAdapter {
  readonly id: SourceId = 'donghub';

  async scrapeHome(): Promise<HomeData> {
    const [homeHtml, ongoingHtml] = await Promise.all([
      sourceGet<string>(this.client, '/'),
      sourceGet<string>(this.client, '/anime/?status=Ongoing&order=update').catch(() => ''),
    ]);
    const $ = cheerio.load(homeHtml);
    const base = this.source.baseUrl;

    const latest: LatestEpisodeItem[] = [];
    $(SEL.card)
      .toArray()
      .forEach((el) => {
        const $el = $(el);
        const $a = $el.find(SEL.cardLink).first();
        const href = $a.attr('href') ?? '';
        const slug = lastPathSegment(href);
        const title = cleanText($a.attr('title') || $el.find('.tt').first().text());
        if (!slug || !title || !/-episode-/i.test(href)) return; // episode cards only
        latest.push({
          anime_title: title.replace(/\s*Episode\s+.*$/i, '').trim() || title,
          anime_slug: this.enc(slug),
          episode_slug: this.enc(slug),
          episode_number: parseNumber($el.find(SEL.cardEpisode).first().text()),
          upload_date: '',
          cover: imgUrl(base, $el.find(SEL.cardImg).first() as cheerio.Cheerio<never>),
        });
      });

    const ongoing: AnimeListItem[] = [];
    const seen = new Set<string>();
    if (ongoingHtml) {
      const $o = cheerio.load(ongoingHtml);
      $o(SEL.card)
        .toArray()
        .forEach((el) => {
          const $el = $o(el);
          const $a = $el.find(SEL.cardLink).first();
          const href = $a.attr('href') ?? '';
          const slug = lastPathSegment(href);
          const title = cleanText($a.attr('title') || $el.find('.tt').first().text());
          if (!slug || !title || seen.has(slug)) return;
          seen.add(slug);
          ongoing.push({
            title,
            slug: this.enc(slug),
            cover: imgUrl(base, $el.find(SEL.cardImg).first() as cheerio.Cheerio<never>),
            latest_episode: parseNumber($el.find(SEL.cardEpisode).first().text()),
            status: 'Ongoing',
          });
        });
    }

    const popular: AnimeListItem[] = [];
    $(SEL.popularRow)
      .toArray()
      .forEach((el) => {
        const $el = $(el);
        const $a = $el.find('a.series, a').first();
        const href = $a.attr('href') ?? '';
        const slug = lastPathSegment(href);
        const $img = $el.find('img').first();
        const title = cleanText($a.attr('title') || $img.attr('title') || $img.attr('alt') || '');
        if (!slug || !title) return;
        popular.push({
          title,
          slug: this.enc(slug),
          cover: imgUrl(base, $img as cheerio.Cheerio<never>),
          latest_episode: null,
          status: '',
        });
      });

    if (ongoing.length === 0 && popular.length > 0) ongoing.push(...popular);
    if (ongoing.length === 0 && latest.length === 0) {
      throw new ScrapeParseError('donghub home returned no cards');
    }
    return {
      ongoing,
      latest: latest.slice(0, 30),
      popular: popular.length > 0 ? popular : ongoing.slice(0, 10),
    };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const html = await sourceGet<string>(this.client, `/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const base = this.source.baseUrl;
    const out: SearchResultItem[] = [];
    const seen = new Set<string>();

    $(SEL.card)
      .toArray()
      .forEach((el) => {
        const $el = $(el);
        const $a = $el.find(SEL.cardLink).first();
        const href = $a.attr('href') ?? '';
        const slug = lastPathSegment(href);
        const title = cleanText($a.attr('title') || $el.find('.tt').first().text());
        // Series results only; skip episode permalinks.
        if (!slug || !title || /-episode-/i.test(href)) return;
        if (seen.has(slug)) return;
        seen.add(slug);
        out.push({
          title,
          slug: this.enc(slug),
          cover: imgUrl(base, $el.find(SEL.cardImg).first() as cheerio.Cheerio<never>),
          status: '',
          genre: [],
        });
      });

    return out;
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    // donghub series detail lives at the top level (/<slug>/), not /seri/.
    const html = await sourceGet<string>(this.client, `/${nativeSlug}/`);
    const $ = cheerio.load(html);
    const base = this.source.baseUrl;

    const title = cleanText($(SEL.detailTitle).first().text());
    if (!title) throw new NotFoundError(`donghub donghua not found: ${nativeSlug}`);

    const info = new Map<string, string>();
    $(SEL.detailInfo)
      .toArray()
      .forEach((el) => {
        const text = cleanText($(el).text());
        const idx = text.indexOf(':');
        if (idx > 0) info.set(text.slice(0, idx).trim().toLowerCase(), text.slice(idx + 1).trim());
      });
    const yearMatch = (info.get('released') ?? info.get('season') ?? '').match(/\b(19|20)\d{2}\b/);

    const episodes: EpisodeListItem[] = [];
    $(SEL.episodeRow)
      .toArray()
      .forEach((el) => {
        const $el = $(el);
        const href = $el.attr('href') ?? '';
        const slug = lastPathSegment(href);
        if (!slug) return;
        episodes.push({
          slug: this.enc(slug),
          number: parseNumber($el.find(SEL.episodeNum).text() || $el.text()),
          title: cleanText($el.find(SEL.episodeTitle).text()) || cleanText($el.text()),
          upload_date: cleanText($el.find(SEL.episodeDate).text()),
        });
      });
    episodes.reverse();

    return {
      title,
      slug: this.enc(nativeSlug),
      cover: imgUrl(base, $(SEL.detailPoster).first() as cheerio.Cheerio<never>),
      synopsis: cleanText(
        $('meta[property="og:description"]').attr('content') ||
          $('.entry-content.entry-content-single, .synp .entry-content').first().text() ||
          '',
      ),
      genre: $(SEL.detailGenre)
        .toArray()
        .map((el) => cleanText($(el).text()))
        .filter(Boolean),
      status: info.get('status') || 'Unknown',
      year: yearMatch ? Number(yearMatch[0]) : null,
      rating: info.get('rating') || 'N/A',
      total_episodes: episodes.length,
      episodes,
    };
  }

  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    const html = await sourceGet<string>(this.client, `/${nativeSlug}/`);
    const $ = cheerio.load(html);

    const ogTitle = cleanText($('meta[property="og:title"]').attr('content') || '');
    const animeTitle = ogTitle
      .replace(/\s*Episode\s+\d+.*$/i, '')
      .replace(/\s*-\s*Donghub.*$/i, '')
      .trim();
    // Series slug is the episode slug minus the "-episode-N…" suffix.
    const animeSlug = nativeSlug.replace(/-episode-\d+.*$/i, '') || nativeSlug;

    const { sources, embedUrl } = await this.resolveSources($, html);
    if (sources.length === 0 && !embedUrl) {
      throw new ScrapeParseError(`donghub could not extract a stream for ${nativeSlug}`);
    }

    const prev = $('a[rel="prev"]').attr('href');
    const next = $('a[rel="next"]').attr('href');
    return {
      anime_title: animeTitle || nativeSlug,
      anime_slug: this.enc(animeSlug),
      episode_number: parseNumber(ogTitle.match(/Episode\s+(\d+)/i)?.[1]),
      sources,
      prev_episode_slug: prev ? this.enc(lastPathSegment(prev)) : null,
      next_episode_slug: next ? this.enc(lastPathSegment(next)) : null,
      embed_url: embedUrl,
    };
  }

  /**
   * Returns the resolved direct sources (for media_kit) AND a Dailymotion embed
   * URL (for WebView playback — its manifest is CDN-token-locked so direct play
   * fails on the client).
   */
  private async resolveSources(
    $: cheerio.CheerioAPI,
    html: string,
  ): Promise<{ sources: VideoSource[]; embedUrl: string }> {
    const collected: VideoSource[] = [];

    // 1) Dailymotion id from the active iframe or anywhere in the page.
    const iframeSrc = $(SEL.playerIframe)
      .toArray()
      .map((el) => $(el).attr('src') || $(el).attr('data-src') || '')
      .find((s) => s.includes('dailymotion'));
    let dmId = dailymotionId(iframeSrc) ?? dailymotionId(html);

    // 2) Mirror options often base64-encode their iframe; a Dailymotion mirror
    //    may exist even when the primary player is something else.
    if (!dmId) {
      for (const opt of $(SEL.mirrorOption).toArray()) {
        const id = dailymotionId(decodeMirrorValue($(opt).attr('value')));
        if (id) {
          dmId = id;
          break;
        }
      }
    }

    if (dmId) {
      // Use the SAME geo player the source site uses (it supports 1080p; the
      // generic /embed/video/ player caps at 720p on mobile). Reuse the page's
      // exact iframe URL when present, else build it with the site's player id.
      const geo =
        iframeSrc && iframeSrc.includes('geo.dailymotion.com')
          ? iframeSrc.split('&')[0]!
          : `https://geo.dailymotion.com/player/xid0t.html?video=${dmId}`;
      const sources: VideoSource[] = DM_QUALITIES.map((q) => ({
        quality: q.label,
        url: `${geo}&quality=${q.value}`,
        type: 'hls',
      }));
      return { sources, embedUrl: sources[0]!.url };
    }

    // 2) Fallback: any inline direct stream in the page (rare).
    collected.push(...extractStreamUrls(html));
    return { sources: dedupeAndSortSources(collected), embedUrl: '' };
  }
}

/** Dailymotion quality options (highest first; default 1080p). */
const DM_QUALITIES = [
  { label: '1080p', value: '1080' },
  { label: '720p', value: '720' },
  { label: '480p', value: '480' },
  { label: 'Auto', value: 'auto' },
] as const;

/** Decode a (possibly base64) mirror-option value to its raw HTML/URL. */
function decodeMirrorValue(value?: string | null): string {
  if (!value) return '';
  if (!/^[A-Za-z0-9+/=]{20,}$/.test(value)) return value;
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}
