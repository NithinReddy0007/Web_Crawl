import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleX,
  FileCode2,
  FolderTree,
  Minus,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  filterSiteTree,
  flattenSiteTree,
  formatPagePath,
  type SiteTreeNode,
} from "@/lib/site-tree";

interface SiteTreeProps {
  tree: SiteTreeNode[];
  selectedId: string | null;
  onSelect: (node: SiteTreeNode) => void;
  loading: boolean;
}

function statusFor(node: SiteTreeNode) {
  if (node.findings.some((finding) => /critical|high/i.test(finding.severity))) {
    return { label: "High-severity finding", icon: CircleX, style: "text-status-danger" };
  }
  if (node.findings.length > 0) {
    return { label: "Finding reported", icon: AlertTriangle, style: "text-status-warning" };
  }
  if (node.status === null) {
    return { label: "Status not recorded", icon: CircleDashed, style: "text-muted-foreground" };
  }
  if (node.status >= 400) {
    return { label: `HTTP ${node.status}`, icon: CircleX, style: "text-status-danger" };
  }
  if (node.status >= 300) {
    return { label: `Redirect · HTTP ${node.status}`, icon: Minus, style: "text-status-warning" };
  }
  if (node.status >= 200) {
    return { label: `Checked · HTTP ${node.status}`, icon: Check, style: "text-status-success" };
  }
  return { label: `HTTP ${node.status}`, icon: CircleDashed, style: "text-muted-foreground" };
}

function TreeRow({
  node,
  selectedId,
  onSelect,
  expanded,
  onToggle,
}: {
  node: SiteTreeNode;
  selectedId: string | null;
  onSelect: (node: SiteTreeNode) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const status = statusFor(node);
  const StatusIcon = status.icon;

  return (
    <li className="min-w-0 list-none" role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        className={`group flex min-h-10 items-center gap-1.5 border-l-2 pr-2 transition-colors ${
          isSelected ? "border-l-primary bg-accent/70" : "border-l-transparent hover:bg-accent/45"
        }`}
        style={{ paddingInlineStart: `${Math.min(node.depth, 10) * 16 + 4}px` }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          disabled={!hasChildren}
          aria-label={hasChildren ? `${isOpen ? "Collapse" : "Expand"} ${formatPagePath(node.url)}` : `${formatPagePath(node.url)} has no discovered children`}
          aria-hidden={!hasChildren}
          tabIndex={hasChildren ? 0 : -1}
          onClick={() => onToggle(node.id)}
        >
          {hasChildren ? isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" /> : null}
        </Button>
        <Button
          variant="ghost"
          className={`h-8 min-w-0 flex-1 justify-start gap-2 overflow-hidden px-1 font-normal ${
            isSelected ? "text-foreground" : "text-muted-foreground"
          }`}
          aria-current={isSelected ? "page" : undefined}
          onClick={() => onSelect(node)}
        >
          <FileCode2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono text-xs" title={node.url}>
            {formatPagePath(node.url)}
          </span>
          {node.findings.length > 0 && (
            <span className={`ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] ${status.style}`}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
              <span>{node.findings.length}</span>
            </span>
          )}
          {node.findings.length === 0 && node.status !== null && (
            <span className={`ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] ${status.style}`}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{status.label}</span>
            </span>
          )}
          {node.findings.length === 0 && node.status === null && (
            <span className={`ml-auto inline-flex shrink-0 ${status.style}`}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{status.label}</span>
            </span>
          )}
        </Button>
      </div>
      {hasChildren && isOpen && (
        <ul className="list-none p-0" role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SiteTree({ tree, selectedId, onSelect, loading }: SiteTreeProps) {
  const [query, setQuery] = useState("");
  const filteredTree = useMemo(() => filterSiteTree(tree, query), [tree, query]);
  const allNodes = useMemo(() => flattenSiteTree(tree), [tree]);
  const initialExpansion = useMemo(
    () => new Set(allNodes.filter((node) => node.depth < 1).map((node) => node.id)),
    [allNodes],
  );
  const [expanded, setExpanded] = useState<Set<string>>(initialExpansion);
  const expandedTree = useMemo(() => {
    const next = new Set(expanded);
    if (query.trim()) {
      for (const node of flattenSiteTree(filteredTree)) {
        if (node.children.length > 0) next.add(node.id);
      }
    }
    return next;
  }, [expanded, filteredTree, query]);
  const displayedCount = flattenSiteTree(filteredTree).length;

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="min-w-0" aria-labelledby="site-tree-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <FolderTree className="size-[18px] text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold" id="site-tree-heading">Site tree</h2>
          <span className="font-mono text-xs text-muted-foreground">{allNodes.length} pages</span>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="h-8 pl-8 font-mono text-xs"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a page…"
            aria-label="Filter the site tree by page URL"
          />
        </div>
      </div>

      {loading && allNodes.length === 0 ? (
        <ul className="space-y-2 p-5" aria-label="Loading site tree" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="flex h-8 items-center gap-3" aria-hidden="true">
              <span className="skeleton-block h-3 w-3 rounded-sm" />
              <span className={`skeleton-block h-3 rounded-sm ${index === 0 ? "w-2/3" : "w-1/2"}`} />
            </li>
          ))}
        </ul>
      ) : filteredTree.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          {allNodes.length === 0 ? "No pages have been reported yet." : "No pages match this search."}
        </div>
      ) : (
        <div className="overflow-x-auto p-2 sm:p-3">
          <ul role="tree" aria-label="Discovered site pages" className="min-w-[320px]">
            {filteredTree.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                selectedId={selectedId}
                onSelect={onSelect}
                expanded={expandedTree}
                onToggle={toggle}
              />
            ))}
          </ul>
          <p className="sr-only" aria-live="polite">Showing {displayedCount} pages.</p>
        </div>
      )}
    </section>
  );
}