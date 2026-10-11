export interface PageRecord {
  url: string;
  parent: string | null;
  status: number | null;
}

export interface FindingRecord {
  category: string;
  severity: string;
  url: string;
  error: string | null;
}

export interface SiteTreeNode {
  id: string;
  url: string;
  status: number | null;
  parentId: string | null;
  depth: number;
  findings: FindingRecord[];
  children: SiteTreeNode[];
}

/** Canonicalize URL syntax that cannot identify a distinct page. */
export function normalizePageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function buildSiteTree(
  pages: PageRecord[],
  findings: FindingRecord[],
  targetUrl: string,
): SiteTreeNode[] {
  const nodes = new Map<string, SiteTreeNode>();
  const parentCandidates = new Map<string, string[]>();
  const explicitRoots = new Set<string>();

  for (const page of pages) {
    const id = normalizePageUrl(page.url);
    if (!id) continue;
    const existing = nodes.get(id);
    if (existing) {
      if (existing.status === null && page.status !== null) existing.status = page.status;
    } else {
      nodes.set(id, {
        id,
        url: page.url,
        status: page.status,
        parentId: null,
        depth: 0,
        findings: [],
        children: [],
      });
      parentCandidates.set(id, []);
    }

    if (page.parent === null) explicitRoots.add(id);
    else {
      const parentId = normalizePageUrl(page.parent);
      const candidates = parentCandidates.get(id);
      if (parentId && parentId !== id && candidates && !candidates.includes(parentId)) {
        candidates.push(parentId);
      }
    }
  }

  for (const finding of findings) {
    const pageId = normalizePageUrl(finding.url);
    const node = pageId ? nodes.get(pageId) : undefined;
    if (node) node.findings.push(finding);
  }

  const targetId = normalizePageUrl(targetUrl);
  for (const [id, node] of nodes) {
    if (id === targetId || explicitRoots.has(id)) continue;
    const parent = parentCandidates.get(id)?.find((candidate) => nodes.has(candidate));
    node.parentId = parent ?? null;
  }

  // Break malformed parent cycles deterministically so each page appears once.
  for (const id of nodes.keys()) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let current: string | null = id;
    while (current) {
      const cycleStart = positions.get(current);
      if (cycleStart !== undefined) {
        const cycleId = chain[cycleStart];
        const cycleNode = cycleId ? nodes.get(cycleId) : undefined;
        if (cycleNode) cycleNode.parentId = null;
        break;
      }
      positions.set(current, chain.length);
      chain.push(current);
      current = nodes.get(current)?.parentId ?? null;
    }
  }

  for (const node of nodes.values()) node.children = [];
  const roots: SiteTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  roots.sort((a, b) => Number(b.id === targetId) - Number(a.id === targetId));
  const assignDepth = (node: SiteTreeNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  for (const root of roots) assignDepth(root, 0);
  return roots;
}

export function filterSiteTree(nodes: SiteTreeNode[], query: string): SiteTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return nodes;

  return nodes.flatMap((node) => {
    const children = filterSiteTree(node.children, normalizedQuery);
    const matches = node.url.toLocaleLowerCase().includes(normalizedQuery);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

export function flattenSiteTree(nodes: SiteTreeNode[]): SiteTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenSiteTree(node.children)]);
}

export function formatPagePath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname || "/"}${url.search}`;
  } catch {
    return value;
  }
}