import { describe, expect, it } from "vitest";

import {
  buildSiteTree,
  filterSiteTree,
  flattenSiteTree,
  normalizePageUrl,
  type PageRecord,
} from "@/lib/site-tree";

const target = "https://example.com/";

describe("site tree", () => {
  it("normalizes fragment aliases but preserves query strings and URL case semantics", () => {
    expect(normalizePageUrl("https://EXAMPLE.com:443/a#top")).toBe("https://example.com/a");
    expect(normalizePageUrl("https://example.com/a?view=1#top")).toBe("https://example.com/a?view=1");
    expect(normalizePageUrl("https://example.com/a?view=2")).not.toBe(
      normalizePageUrl("https://example.com/a?view=1"),
    );
    expect(normalizePageUrl("javascript:alert(1)")).toBeNull();
  });

  it("builds a single-copy hierarchy from BFS discovery parents", () => {
    const pages: PageRecord[] = [
      { url: target, parent: null, status: 200 },
      { url: "https://example.com/docs", parent: target, status: 200 },
      { url: "https://example.com/docs/setup", parent: "https://example.com/docs", status: 200 },
      { url: "https://example.com/pricing", parent: target, status: 200 },
    ];
    const tree = buildSiteTree(pages, [], target);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((node) => node.url)).toEqual([
      "https://example.com/docs",
      "https://example.com/pricing",
    ]);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
    expect(flattenSiteTree(tree)).toHaveLength(4);
  });

  it("deduplicates fragments, handles missing parents, and breaks malformed cycles", () => {
    const pages: PageRecord[] = [
      { url: target, parent: null, status: 200 },
      { url: "https://example.com/a#first", parent: target, status: 200 },
      { url: "https://example.com/a#second", parent: target, status: 200 },
      { url: "https://example.com/b", parent: "https://example.com/c", status: 200 },
      { url: "https://example.com/c", parent: "https://example.com/b", status: 200 },
      { url: "https://example.com/orphan", parent: "https://missing.example", status: 200 },
    ];
    const tree = buildSiteTree(pages, [], target);
    const flattened = flattenSiteTree(tree);
    expect(flattened).toHaveLength(5);
    expect(flattened.filter((node) => node.id === "https://example.com/a")).toHaveLength(1);
    expect(tree.map((node) => node.url)).toContain("https://example.com/orphan");
    expect(flattened.find((node) => node.url === "https://example.com/orphan")?.parentId).toBeNull();
    expect(flattened.some((node) => node.url === "https://example.com/b")).toBe(true);
    expect(flattened.some((node) => node.url === "https://example.com/c")).toBe(true);
  });

  it("associates findings with affected pages and preserves matching ancestors", () => {
    const finding = {
      category: "broken link",
      severity: "High",
      url: "https://example.com/docs/setup#section",
      error: "HTTP 404",
    };
    const tree = buildSiteTree(
      [
        { url: target, parent: null, status: 200 },
        { url: "https://example.com/docs", parent: target, status: 200 },
        { url: "https://example.com/docs/setup", parent: "https://example.com/docs", status: 404 },
      ],
      [finding],
      target,
    );
    expect(tree[0]?.children[0]?.children[0]?.findings).toEqual([finding]);
    const filtered = filterSiteTree(tree, "/setup");
    expect(flattenSiteTree(filtered).map((node) => node.url)).toEqual([
      target,
      "https://example.com/docs",
      "https://example.com/docs/setup",
    ]);
  });
});