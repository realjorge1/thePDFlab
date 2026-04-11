/**
 * Project Gutenberg Library Adapter
 * Uses Gutendex API to search and fetch books from Project Gutenberg
 * Supports EPUB and PDF formats (when available)
 */

import { DownloadOption, SearchResult } from "@/src/types/library.types";

const GUTENDEX_API = "https://gutendex.com";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface GutendexAuthor {
  name: string;
  birth_year?: number;
  death_year?: number;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexAuthor[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
}

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

/**
 * Project Gutenberg adapter using Gutendex API
 * Gutendex provides a clean JSON API for Project Gutenberg's catalog
 */
class GutenbergAdapter {
  private baseUrl = GUTENDEX_API;
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
   * Search for books in Project Gutenberg
   */
  async search(query: string, page: number = 1): Promise<SearchResult[]> {
    const cacheKey = `search:${query}:${page}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/books?search=${encodeURIComponent(query)}&page=${page}&sort=popular`;
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Gutenberg rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Gutenberg API error: ${response.status}`);
      }

      const data: GutendexResponse = await response.json();
      const results = data.results
        .map((book) => this.mapToSearchResult(book))
        .filter((result) => result.downloadOptions.length > 0);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching Gutenberg:", error);
      throw error;
    }
  }

  /**
   * Get a specific book by ID
   */
  async getBook(id: string): Promise<SearchResult | null> {
    const cacheKey = `book:${id}`;
    const cached = this.getCached(cacheKey);
    if (cached && cached.length > 0) return cached[0];

    try {
      const url = `${this.baseUrl}/books/${id}`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const book: GutendexBook = await response.json();
      const result = this.mapToSearchResult(book);
      this.setCached(cacheKey, [result]);
      return result;
    } catch (error) {
      console.error("Error fetching Gutenberg book:", error);
      return null;
    }
  }

  /**
   * Search by author name
   */
  async searchByAuthor(author: string): Promise<SearchResult[]> {
    const cacheKey = `author:${author}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/books?search=${encodeURIComponent(author)}`;
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Gutenberg rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Gutenberg API error: ${response.status}`);
      }

      const data: GutendexResponse = await response.json();
      const results = data.results
        .map((book) => this.mapToSearchResult(book))
        .filter((result) => result.downloadOptions.length > 0);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching by author:", error);
      throw error;
    }
  }

  /**
   * Get popular/most downloaded books
   */
  async getPopular(page: number = 1): Promise<SearchResult[]> {
    const cacheKey = `popular:${page}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/books?page=${page}`;
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Gutenberg rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Gutenberg API error: ${response.status}`);
      }

      const data: GutendexResponse = await response.json();
      const results = data.results
        .map((book) => this.mapToSearchResult(book))
        .filter((result) => result.downloadOptions.length > 0);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error fetching popular books:", error);
      throw error;
    }
  }

  /**
   * Search by topic/subject
   */
  async searchByTopic(topic: string): Promise<SearchResult[]> {
    const cacheKey = `topic:${topic}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/books?topic=${encodeURIComponent(topic)}`;
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Gutenberg rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Gutenberg API error: ${response.status}`);
      }

      const data: GutendexResponse = await response.json();
      const results = data.results
        .map((book) => this.mapToSearchResult(book))
        .filter((result) => result.downloadOptions.length > 0);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching by topic:", error);
      throw error;
    }
  }

  /**
   * Map Gutendex book to SearchResult
   */
  private mapToSearchResult(book: GutendexBook): SearchResult {
    const downloadOptions = this.extractDownloadOptions(book.formats);
    const coverUrl = this.extractCoverUrl(book.formats);

    return {
      id: book.id.toString(),
      source: "gutenberg",
      title: book.title,
      authors: book.authors.map((a) => a.name),
      downloadOptions,
      sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
      coverUrl,
    };
  }

  /**
   * Extract available download options from formats
   * Only returns EPUB and PDF if they exist
   */
  private extractDownloadOptions(
    formats: Record<string, string>,
  ): DownloadOption[] {
    const options: DownloadOption[] = [];

    // Look for EPUB (most common and recommended for Gutenberg)
    const epubKey =
      Object.keys(formats).find(
        (key) => key.includes("epub") && key.includes("images"),
      ) || Object.keys(formats).find((key) => key.includes("epub"));

    if (epubKey && formats[epubKey]) {
      options.push({
        type: "epub",
        url: formats[epubKey],
      });
    }

    // Look for PDF (less common but some books have it)
    const pdfKey = Object.keys(formats).find((key) => key.includes("pdf"));
    if (pdfKey && formats[pdfKey]) {
      options.push({
        type: "pdf",
        url: formats[pdfKey],
      });
    }

    return options;
  }

  /**
   * Extract cover image URL from formats
   */
  private extractCoverUrl(formats: Record<string, string>): string | undefined {
    const coverKey = Object.keys(formats).find(
      (key) =>
        key.includes("cover") &&
        (key.includes("medium") || key.includes("small")),
    );

    return coverKey ? formats[coverKey] : undefined;
  }
}

// Export singleton instance
export const gutenbergAdapter = new GutenbergAdapter();
