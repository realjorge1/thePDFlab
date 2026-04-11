import { DownloadOption, SearchResult } from "@/src/types/library.types";

const ZENODO_API = "https://zenodo.org/api";
// Zenodo rate limit: 60 requests/minute → enforce ~1.1s between requests
const MIN_REQUEST_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ZenodoFile {
  key: string;
  size: number;
  type: string;
  links: {
    self: string;
  };
}

interface ZenodoRecord {
  id: number;
  metadata: {
    title: string;
    creators: Array<{ name: string }>;
    publication_date: string;
    description?: string;
    resource_type?: {
      type: string;
      title: string;
    };
    access_right?: string;
  };
  files?: ZenodoFile[];
  links: {
    html: string;
  };
}

interface ZenodoResponse {
  hits: {
    total: number;
    hits: ZenodoRecord[];
  };
}

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

/**
 * Zenodo adapter - CERN's research repository
 * Contains research papers, datasets, presentations, and more
 */
class ZenodoAdapter {
  private baseUrl = ZENODO_API;
  private lastRequestTime = 0;
  private cache = new Map<string, CacheEntry>();

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed),
      );
    }
    this.lastRequestTime = Date.now();
  }

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
   * Search Zenodo for open access content
   */
  async search(query: string, size: number = 20): Promise<SearchResult[]> {
    const cacheKey = `search:${query}:${size}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      // Use broad search directly — avoids the double-request fallback pattern
      const searchQuery = encodeURIComponent(query);
      const url = `${this.baseUrl}/records?q=${searchQuery}&access_right=open&size=${size}&sort=mostrecent`;

      await this.throttle();
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Zenodo rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Zenodo API error: ${response.status}`);
      }

      const data: ZenodoResponse = await response.json();

      if (!data.hits?.hits) {
        return [];
      }

      const results = data.hits.hits
        .filter((record) => this.hasPdfFile(record))
        .map((record) => this.mapToSearchResult(record))
        .filter((result): result is SearchResult => result !== null);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching Zenodo:", error);
      throw error;
    }
  }

  /**
   * Search by resource type (publication, presentation, dataset, etc.)
   */
  async searchByType(
    query: string,
    type: string,
    size: number = 20,
  ): Promise<SearchResult[]> {
    const cacheKey = `type:${query}:${type}:${size}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const searchQuery = encodeURIComponent(query);
      const url = `${this.baseUrl}/records?q=${searchQuery}&type=${type}&access_right=open&size=${size}`;

      await this.throttle();
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error(
          "Zenodo rate limit reached. Please wait a moment and try again.",
        );
      }

      if (!response.ok) {
        throw new Error(`Zenodo API error: ${response.status}`);
      }

      const data: ZenodoResponse = await response.json();

      if (!data.hits?.hits) {
        return [];
      }

      const results = data.hits.hits
        .filter((record) => this.hasPdfFile(record))
        .map((record) => this.mapToSearchResult(record))
        .filter((result): result is SearchResult => result !== null);

      this.setCached(cacheKey, results);
      return results;
    } catch (error) {
      console.error("Error searching by type:", error);
      throw error;
    }
  }

  /**
   * Search publications only
   */
  async searchPublications(
    query: string,
    size: number = 20,
  ): Promise<SearchResult[]> {
    return this.searchByType(query, "publication", size);
  }

  /**
   * Check if record has PDF files
   */
  private hasPdfFile(record: ZenodoRecord): boolean {
    if (!record.files || record.files.length === 0) {
      return false;
    }

    return record.files.some(
      (file) => file.type === "pdf" || file.key.toLowerCase().endsWith(".pdf"),
    );
  }

  /**
   * Extract PDF files from record
   */
  private extractPdfFiles(record: ZenodoRecord): DownloadOption[] {
    if (!record.files) {
      return [];
    }

    return record.files
      .filter(
        (file) =>
          file.type === "pdf" || file.key.toLowerCase().endsWith(".pdf"),
      )
      .map((file) => ({
        type: "pdf" as const,
        url: file.links.self,
        size: file.size,
      }));
  }

  /**
   * Map Zenodo record to SearchResult
   */
  private mapToSearchResult(record: ZenodoRecord): SearchResult | null {
    const downloadOptions = this.extractPdfFiles(record);

    if (downloadOptions.length === 0) {
      return null;
    }

    const authors = record.metadata.creators.map((c) => c.name);
    const year = record.metadata.publication_date.substring(0, 4);

    return {
      id: record.id.toString(),
      source: "zenodo",
      title: record.metadata.title,
      authors,
      year,
      downloadOptions,
      sourceUrl: record.links.html,
    };
  }

  /**
   * Get record by Zenodo ID
   */
  async getRecord(zenodoId: string): Promise<SearchResult | null> {
    const cacheKey = `record:${zenodoId}`;
    const cached = this.getCached(cacheKey);
    if (cached && cached.length > 0) return cached[0];

    try {
      const url = `${this.baseUrl}/records/${zenodoId}`;
      await this.throttle();
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const record: ZenodoRecord = await response.json();
      const result = this.mapToSearchResult(record);
      if (result) this.setCached(cacheKey, [result]);
      return result;
    } catch (error) {
      console.error("Error fetching record:", error);
      return null;
    }
  }
}

// Export singleton instance
export const zenodoAdapter = new ZenodoAdapter();
