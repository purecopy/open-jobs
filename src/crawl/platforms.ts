export type PlatformType = "aggregator" | "institution";

export interface CrawlScopeOptions {
  excludePaths?: string[];
  includePaths?: string[];
  limit?: number;
}

export interface Platform {
  crawlScope?: CrawlScopeOptions;
  id: string;
  type: PlatformType;
  url: string;
}

export const platforms: Platform[] = [
  // Aggregators — listing pages with multiple jobs
  {
    id: "kulturkonzepte",
    url: "https://kulturkonzepte.at/service/jobboerse/",
    type: "aggregator",
    crawlScope: {
      includePaths: ["/job/.+"],
      limit: 50,
    },
  },
  {
    id: "kupf",
    url: "https://kupf.at/kulturjobs",
    type: "aggregator",
    crawlScope: {
      includePaths: ["/kulturjobs/.+"],
      limit: 50,
    },
  },
  {
    id: "igkultur",
    url: "https://igkultur.at/service/stellenanzeigen-jobs-kultur",
    type: "aggregator",
    crawlScope: {
      includePaths: ["/service/stellenanzeigen.*"],
      limit: 50,
    },
  },

  /*
  // Institution career pages — 0-2 jobs each, scraped directly
  { id: "mumok", url: "https://www.mumok.at/en/jobs", type: "institution" },
  {
    id: "kunsthalle-wien",
    url: "https://kunsthallewien.at/en/jobs",
    type: "institution",
  },
  {
    id: "belvedere",
    url: "https://www.belvedere.at/karriere",
    type: "institution",
  },
  { id: "mak", url: "https://www.mak.at/jobs", type: "institution" },
  {
    id: "albertina",
    url: "https://www.albertina.at/karriere/offene-stellen/",
    type: "institution",
  },
  {
    id: "leopold-museum",
    url: "https://www.leopoldmuseum.org/de/museum/team-und-kontakte/jobs",
    type: "institution",
  },
  {
    id: "museumsquartier",
    url: "https://www.mqw.at/jobs",
    type: "institution",
  },
  {
    id: "festwochen",
    url: "https://www.festwochen.at/jobs",
    type: "institution",
  },
   */
];
