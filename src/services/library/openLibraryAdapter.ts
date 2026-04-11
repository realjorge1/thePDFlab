/**
 * Open Library Adapter
 * Only returns truly downloadable public domain books (not borrowable/lending-only)
 * Downloads come from Internet Archive
 * Per requirements: PDF only when direct downloadable PDF link is available
 */

import { DownloadOption, SearchResult } from "@/src/types/library.types";

const OPENLIBRARY_API = "https://openlibrary.org";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface OpenLibraryWork {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_count?: number;
  has_fulltext?: boolean;
  ia?: string[]; // Internet Archive IDs
  lending_edition_s?: string;
  public_scan_b?: boolean;
}

interface OpenLibrarySearchResponse {
  numFound: number;
  start: number;
  docs: OpenLibraryWork[];
}

interface OpenLibraryEdition {
  key: string;
  title: string;
  authors?: Array<{ key: string; name?: string }>;
  publish_date?: string;
  ia_box_id?: string[];
  ocaid?: string; // Open Content Alliance ID (Internet Archive)
}

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

/**
 * Open Library adapter - only returns downloadable public domain books
 * Filters out lending/borrow-only items
 */
class OpenLibraryAdapter {
  private baseUrl = OPENLIBRARY_API;
  private cache = new Map<string, CacheEntry>();

  private getCached(key: string): SearchResult[] | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.results;
    }
    this.cache.delete(key);
    return null;
  }

  private setCached(key: string, results: SearchResult[]): void {
    this.cache.set(key, { results, timestamp: Date.now() });
  }

  /**
   * Search for downloadable books in Open Library
   * Only returns books with full-text available for download
   */
  async search(query: string, page: number = 1): Promise<SearchResult[]> {
    const cacheKey = `search:${query}:${page}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const offset = (page - 1) * 20;
      // Use general search with has_fulltext=true for reliable results
      const url = `${this.baseUrl}/search.json?q=${encodeURIComponent(query)}&has_fulltext=true&page=${page}&offset=${offset}`;

      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Open Library rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.status}`);
      }

      const data: OpenLibrarySearchResponse = await response.json();

      // Filter and map results - only keep truly downloadable items
      // Skip HEAD verification per result — too expensive (up to 10 requests per search).
      // Invalid URLs are caught downstream by urlFailureCache.
      const results = data.docs
        .filter((work) => this.isDownloadable(work))
        .slice(0, 10)
        .map((work) => this.mapToSearchResult(work))
        .filter((r): r is SearchResult => r !== null && r.downloadOptions.length > 0);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching Open Library:", error);
      throw error;
    }
  }

  /**
   * Get a specific work by Open Library ID
   */
  async getWork(workId: string): Promise<SearchResult | null> {
    const cacheKey = `work:${workId}`;
    const cached = this.getCached(cacheKey);
    if (cached && cached.length > 0) return cached[0];

    try {
      const url = `${this.baseUrl}/works/${workId}.json`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const work = await response.json();

      const editionsUrl = `${this.baseUrl}/works/${workId}/editions.json`;
      const editionsResponse = await fetch(editionsUrl);

      if (!editionsResponse.ok) {
        return null;
      }

      const editionsData = await editionsResponse.json();
      const downloadableEdition = editionsData.entries?.find(
        (e: OpenLibraryEdition) => e.ocaid,
      );

      if (!downloadableEdition) {
        return null;
      }

      const result = this.mapEditionToSearchResult(downloadableEdition, work.title);
      if (result) this.setCached(cacheKey, [result]);
      return result;
    } catch (error) {
      console.error("Error fetching Open Library work:", error);
      return null;
    }
  }

  /**
   * Search by author
   */
  async searchByAuthor(author: string): Promise<SearchResult[]> {
    const cacheKey = `author:${author}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/search.json?author=${encodeURIComponent(author)}&has_fulltext=true`;
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Open Library rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.status}`);
      }

      const data: OpenLibrarySearchResponse = await response.json();

      const results = data.docs
        .filter((work) => this.isDownloadable(work))
        .slice(0, 10)
        .map((work) => this.mapToSearchResult(work))
        .filter((r): r is SearchResult => r !== null && r.downloadOptions.length > 0);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching by author:", error);
      throw error;
    }
  }

  /**
   * Check if a work is truly downloadable (not just borrowable)
   */
  private isDownloadable(work: OpenLibraryWork): boolean {
    return Boolean(
      work.has_fulltext &&
        work.ia &&
        work.ia.length > 0 &&
        work.public_scan_b !== false,
    );
  }

  /**
   * Map Open Library work to SearchResult (synchronous — no HEAD request)
   */
  private mapToSearchResult(work: OpenLibraryWork): SearchResult | null {
    if (!work.ia || work.ia.length === 0) {
      return null;
    }

    const iaId = work.ia[0];
    const pdfUrl = `https://archive.org/download/${iaId}/${iaId}.pdf`;

    const downloadOptions: DownloadOption[] = [
      { type: "pdf", url: pdfUrl },
    ];

    return {
      id: work.key.replace("/works/", ""),
      source: "openlibrary",
      title: work.title,
      authors: work.author_name,
      year: work.first_publish_year?.toString(),
      downloadOptions,
      sourceUrl: `${this.baseUrl}${work.key}`,
      coverUrl: this.getCoverUrl(work.key),
    };
  }

  /**
   * Map Open Library edition to SearchResult
   */
  private mapEditionToSearchResult(
    edition: OpenLibraryEdition,
    title?: string,
  ): SearchResult | null {
    if (!edition.ocaid) {
      return null;
    }

    const downloadOptions: DownloadOption[] = [
      {
        type: "pdf",
        url: `https://archive.org/download/${edition.ocaid}/${edition.ocaid}.pdf`,
      },
    ];

    return {
      id: edition.key.replace("/books/", ""),
      source: "openlibrary",
      title: title || edition.title,
      authors: edition.authors?.map((a) => a.name || "Unknown"),
      year: edition.publish_date,
      downloadOptions,
      sourceUrl: `${this.baseUrl}${edition.key}`,
      coverUrl: this.getCoverUrl(edition.key),
    };
  }

  /**
   * Get cover image URL
   */
  private getCoverUrl(key: string): string {
    const id = key.replace("/works/", "").replace("/books/", "");
    return `${this.baseUrl}/works/${id}-M.jpg`;
  }
}

// Export singleton instance
export const openLibraryAdapter = new OpenLibraryAdapter();
