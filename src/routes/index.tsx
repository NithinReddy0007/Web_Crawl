import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileText,
  Globe2,
  LoaderCircle,
  Network,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SiteTree } from "@/components/site-tree";
import {
  buildSiteTree,
  flattenSiteTree,
  formatPagePath,
  normalizePageUrl,
  type FindingRecord,
  type PageRecord,
  type SiteTreeNode,
} from "@/lib/site-tree";

const API_URL =
  import.meta.env["VITE_API_URL"]?.replace(/\/$/, "") ||
  "https://websleuth-api.onrender.com";

interface ScanResult {
  id: string;
  status: string;
  target: string;
}

interface ScanProgress {
  status: string;
  pages_crawled: number;
  findings_detected: number;
  max_pages: number;
}

interface PagesResponse {
  pages: PageRecord[];
}

interface FindingsResponse {
  findings: FindingRecord[];
}

const activeStatuses = new Set(["queued", "running"]);

function getScanStatus(status: string) {
  if (status === "queued") return { label: "Queued", icon: Clock3, style: "text-muted-foreground" };
  if (status === "running") return { label: "Scanning", icon: LoaderCircle, style: "text-primary" };
  if (status === "completed") return { label: "Completed", icon: Check, style: "text-status-success" };
  if (status.includes("completed_with")) {
    return { label: "Completed with findings", icon: AlertCircle, style: "text-status-warning" };
  }
  if (status === "cancelled") return { label: "Cancelled", icon: CircleDashed, style: "text-muted-foreground" };
  if (status === "timed_out") return { label: "Timed out", icon: Clock3, style: "text-status-warning" };
  return { label: "Scan failed", icon: X, style: "text-status-danger" };
}

function findSelectedPath(nodes: SiteTreeNode[], selectedId: string | null): SiteTreeNode[] {
  if (!selectedId) return [];
  for (const node of nodes) {
    if (node.id === selectedId) return [node];
    const childPath = findSelectedPath(node.children, selectedId);
    if (childPath.length > 0) return [node, ...childPath];
  }
  return [];
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WebSleuth — Website Scan & Site Tree" },
      {
        name: "description",
        content: "Scan an authorized website and explore discovered pages in a traceable hierarchy.",
      },
      { property: "og:title", content: "WebSleuth — Website Scan & Site Tree" },
      {
        property: "og:description",
        content: "Scan an authorized website and explore discovered pages in a traceable hierarchy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WebSleuthWorkspace,
});

export function WebSleuthWorkspace() {
  const [url, setUrl] = useState("");
  const [depth, setDepth] = useState("2");
  const [maxPages, setMaxPages] = useState("25");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [findings, setFindings] = useState<FindingRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const tree = useMemo(
    () => (scan ? buildSiteTree(pages, findings, scan.target) : []),
    [pages, findings, scan],
  );
  const allNodes = useMemo(() => flattenSiteTree(tree), [tree]);
  const selectedNode = allNodes.find((node) => node.id === selectedId) ?? tree[0] ?? null;
  const selectedPath = useMemo(() => findSelectedPath(tree, selectedNode?.id ?? null), [tree, selectedNode]);
  const visibleFindings = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return findings;
    return findings.filter((finding) =>
      [finding.category, finding.severity, finding.url, finding.error ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    );
  }, [findings, filter]);

  const refreshScan = useCallback(async (scanId: string, signal: AbortSignal) => {
    const endpoints = ["progress", "pages", "findings"];
    const responses = await Promise.all(
      endpoints.map((endpoint) => fetch(`${API_URL}/api/scans/${scanId}/${endpoint}`, { signal })),
    );
    const failedResponse = responses.find((response) => !response.ok);
    if (failedResponse) {
      throw new Error(failedResponse.status === 404 ? "This scan is no longer available." : `Could not load scan results (HTTP ${failedResponse.status}).`);
    }

    const [nextProgress, nextPages, nextFindings] = (await Promise.all(
      responses.map((response) => response.json()),
    )) as [ScanProgress, PagesResponse, FindingsResponse];
    setProgress(nextProgress);
    setPages(Array.isArray(nextPages.pages) ? nextPages.pages : []);
    setFindings(Array.isArray(nextFindings.findings) ? nextFindings.findings : []);
    setLoadState("ready");
    setError("");
    setSelectedId((current) => current ?? normalizePageUrl(scan?.target ?? ""));
    return nextProgress.status;
  }, [scan]);

  useEffect(() => {
    if (!scan?.id || !activeStatuses.has(progress?.status ?? scan.status)) return;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await refreshScan(scan.id, controller.signal);
        if (!activeStatuses.has(status)) return;
      } catch (pollError) {
        if (controller.signal.aborted) return;
        setLoadState("error");
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Could not refresh this scan. Previously received results are still shown.",
        );
      }
      if (!controller.signal.aborted) timeoutId = setTimeout(poll, 2000);
    };

    void poll();
    return () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [progress?.status, refreshScan, scan]);

  async function startScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const submitted = url.trim();
    const inputUrl = /^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(inputUrl);
      if (!/^https?:$/.test(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
        throw new Error("Enter a public HTTP or HTTPS website URL without credentials.");
      }
    } catch (validationError) {
      setError(
        validationError instanceof Error && validationError.message.startsWith("Enter")
          ? validationError.message
          : "Enter a valid HTTP or HTTPS website address, such as https://example.com.",
      );
      return;
    }

    setIsStarting(true);
    setScan(null);
    setProgress(null);
    setPages([]);
    setFindings([]);
    setSelectedId(null);
    setLoadState("loading");

    try {
      const response = await fetch(`${API_URL}/api/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: parsedUrl.href, max_depth: Number(depth), max_pages: Number(maxPages) }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<ScanResult> & { detail?: string };
      if (!response.ok) throw new Error(data.detail || `The scan service rejected the request (HTTP ${response.status}).`);
      if (!data.id || !data.target) throw new Error("The scan service returned an incomplete scan record.");
      setScan({ id: data.id, status: data.status ?? "queued", target: data.target });
      setProgress({ status: data.status ?? "queued", pages_crawled: 0, findings_detected: 0, max_pages: Number(maxPages) });
      setSelectedId(normalizePageUrl(data.target));
    } catch (startError) {
      setLoadState("error");
      setError(
        startError instanceof TypeError
          ? "Could not reach the scan service. It may be starting up, or this preview may not be allowed by its connection settings. Please try again shortly."
          : startError instanceof Error
            ? startError.message
            : "The scan could not be started. Please try again.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function cancelScan() {
    if (!scan) return;
    try {
      const response = await fetch(`${API_URL}/api/scans/${scan.id}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error(`The scan service responded with HTTP ${response.status}.`);
      setProgress((current) => current ? { ...current, status: "cancelled" } : current);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "The scan could not be cancelled.");
    }
  }

  const scanStatus = getScanStatus(progress?.status ?? scan?.status ?? "queued");
  const ScanStatusIcon = scanStatus.icon;
  const running = activeStatuses.has(progress?.status ?? scan?.status ?? "queued");
  const cap = progress?.max_pages ?? Number(maxPages);
  const pageCount = progress?.pages_crawled ?? pages.length;
  const progressValue = cap > 0 ? Math.min(100, (pageCount / cap) * 100) : 0;
  const resultStatus = progress?.status ?? "";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface-header">
        <div className="mx-auto flex h-14 max-w-[1480px] items-center justify-between px-4 sm:px-8">
          <a href="/" aria-label="WebSleuth home" className="inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground">
              <Search className="size-[18px]" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold">WebSleuth</span>
          </a>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-status-success" aria-hidden="true" />
            <span>Website scanner</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-4 pb-12 pt-8 sm:px-8 sm:pt-10">
        <section aria-labelledby="scan-title" className="border-b border-border pb-6">
          <div className="mb-5">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Crawl configuration</p>
            <h1 id="scan-title" className="text-2xl font-semibold tracking-normal">Website scan</h1>
          </div>

          <form onSubmit={startScan} className="grid items-end gap-4 lg:grid-cols-[minmax(250px,1fr)_180px_180px_auto]">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="website-url">Website address</Label>
              <div className="relative">
                <Globe2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="website-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="h-10 pl-9 font-mono text-sm"
                  aria-describedby="scan-permission"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scan-depth">Crawl depth</Label>
              <Select value={depth} onValueChange={setDepth}>
                <SelectTrigger id="scan-depth" aria-label="Crawl depth"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((level) => (
                    <SelectItem value={String(level)} key={level}>{level} {level === 1 ? "level" : "levels"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="page-limit">Page limit</Label>
              <Select value={maxPages} onValueChange={setMaxPages}>
                <SelectTrigger id="page-limit" aria-label="Maximum pages"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((limit) => (
                    <SelectItem value={String(limit)} key={limit}>{limit} pages</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-10 px-5" disabled={isStarting}>
              {isStarting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Network aria-hidden="true" />}
              {isStarting ? "Starting scan" : "Start scan"}
              {!isStarting && <ArrowUpRight aria-hidden="true" />}
            </Button>
          </form>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground" id="scan-permission">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>Scan only public websites you own or are authorized to test.</span>
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CircleDashed className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>Private pages, sign-in screens, and interactions are not tested.</span>
            </p>
          </div>
          {error && (
            <div className="mt-4 flex items-start gap-2 border border-status-danger/30 bg-status-danger/5 px-3.5 py-3 text-sm text-status-danger" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
              {scan && <Button type="button" variant="ghost" size="icon" className="-my-1 -mr-1 size-7 shrink-0 text-status-danger" aria-label="Dismiss message" onClick={() => setError("")}><X aria-hidden="true" /></Button>}
            </div>
          )}
        </section>

        <section className="pt-6" aria-labelledby="results-heading" aria-busy={running || loadState === "loading"}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <FileText className="size-[18px] shrink-0 text-primary" aria-hidden="true" />
              <h2 id="results-heading" className="text-base font-semibold">Scan results</h2>
              {scan && <span className="truncate font-mono text-xs text-muted-foreground">{formatPagePath(scan.target)}</span>}
            </div>
            <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${scanStatus.style}`} role="status" aria-live="polite">
              <ScanStatusIcon className={`size-3.5 ${running && progress?.status === "running" ? "animate-spin" : ""}`} aria-hidden="true" />
              {scanStatus.label}
            </div>
          </div>

          {scan && (
            <div className="mb-4 grid gap-3 border-b border-border pb-4 sm:grid-cols-[minmax(220px,1fr)_auto_auto_auto] sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <Progress value={progressValue} aria-label={`${pageCount} of ${cap} page limit reached`} className="h-1.5" />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{pageCount} / {cap} pages</span>
              </div>
              <span className="text-xs text-muted-foreground">{findings.length} finding{findings.length === 1 ? "" : "s"}</span>
              <span className="text-xs text-muted-foreground">Depth {depth}</span>
              {running && <Button type="button" variant="outline" size="sm" onClick={cancelScan}><X aria-hidden="true" /> Cancel scan</Button>}
            </div>
          )}

          {!scan && loadState === "idle" ? (
            <div className="flex min-h-32 items-center justify-center border border-dashed border-border px-5 text-center text-sm text-muted-foreground">
              Enter a website address and start a scan to view discovered pages.
            </div>
          ) : loadState === "loading" && !scan ? (
            <div className="flex min-h-32 items-center gap-3 border border-border px-5 text-sm text-muted-foreground" role="status" aria-live="polite">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Connecting to the scan service…
            </div>
          ) : scan ? (
            <>
              {resultStatus.includes("completed_with") && (
                <div className="mb-4 border border-status-warning/30 bg-status-warning/5 px-3.5 py-3 text-sm text-status-warning" role="status">
                  The scan finished with findings. A clean result would not prove the website is free of issues.
                </div>
              )}
              {resultStatus === "completed" && findings.length === 0 && (
                <div className="mb-4 border border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground" role="status">
                  No issues detected by the selected checks. This does not prove the website is free of defects.
                </div>
              )}
              {resultStatus === "failed" && (
                <div className="mb-4 border border-status-danger/30 bg-status-danger/5 px-3.5 py-3 text-sm text-status-danger" role="alert">
                  The scan could not finish. Previously reported pages and findings are still available above.
                </div>
              )}

              <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
                <div className="min-w-0 overflow-hidden border border-border bg-card">
                  <SiteTree tree={tree} selectedId={selectedNode?.id ?? null} onSelect={(node) => setSelectedId(node.id)} loading={running} />
                </div>
                <section className="min-w-0 border border-border bg-card" aria-labelledby="page-detail-heading">
                  <div className="border-b border-border px-4 py-3.5 sm:px-5">
                    <h3 id="page-detail-heading" className="text-sm font-semibold">Page details</h3>
                  </div>
                  {selectedNode ? (
                    <div className="p-4 sm:p-5">
                      <p className="mb-1.5 text-xs text-muted-foreground">Selected page</p>
                      <a href={selectedNode.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-center gap-1.5 rounded-sm font-mono text-xs text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="break-all">{selectedNode.url}</span>
                        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </a>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">HTTP status</dt>
                          <dd className={`mt-1 text-sm font-medium ${selectedNode.status === null ? "text-muted-foreground" : selectedNode.status >= 400 ? "text-status-danger" : selectedNode.status >= 300 ? "text-status-warning" : "text-status-success"}`}>
                            {selectedNode.status === null ? "Not recorded" : `HTTP ${selectedNode.status}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Discovery depth</dt>
                          <dd className="mt-1 text-sm font-medium">{selectedNode.depth}</dd>
                        </div>
                      </dl>
                      <div className="mt-4">
                        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Discovery path</h4>
                        {selectedPath.length > 0 ? (
                          <ol className="flex flex-wrap items-center gap-y-1" aria-label="Page discovery path">
                            {selectedPath.map((node, index) => (
                              <li key={node.id} className="inline-flex min-w-0 items-center">
                                {index > 0 && <ArrowUpRight className="mx-1 size-3 shrink-0 rotate-45 text-muted-foreground" aria-hidden="true" />}
                                <Button type="button" variant="link" className="h-auto max-w-36 truncate px-0 py-0 font-mono text-xs" onClick={() => setSelectedId(node.id)} title={node.url}>
                                  {formatPagePath(node.url)}
                                </Button>
                              </li>
                            ))}
                          </ol>
                        ) : <p className="text-xs text-muted-foreground">Discovery path not recorded.</p>}
                      </div>
                      <div className="mt-5">
                        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Findings on this page</h4>
                        {selectedNode.findings.length === 0 ? (
                          <p className="text-xs leading-5 text-muted-foreground">No findings reported for this page. Unobserved checks remain unknown.</p>
                        ) : (
                          <ul className="space-y-2">
                            {selectedNode.findings.map((finding, index) => (
                              <li key={`${finding.category}-${finding.error}-${index}`} className="border border-border p-3">
                                <div className={`flex items-center gap-2 text-xs font-semibold ${/critical|high/i.test(finding.severity) ? "text-status-danger" : /medium/i.test(finding.severity) ? "text-status-warning" : "text-muted-foreground"}`}>
                                  <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                                  <span>{finding.severity} · {finding.category}</span>
                                </div>
                                {finding.error && <p className="mt-1.5 break-words font-mono text-xs leading-5 text-muted-foreground">{finding.error}</p>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="px-5 py-8 text-sm text-muted-foreground">
                      {running ? "Waiting for the scanner to report a page…" : "No page details are available."}
                    </div>
                  )}
                </section>
              </div>

              <section className="mt-5 border border-border bg-card" aria-labelledby="findings-heading">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="size-[18px] text-muted-foreground" aria-hidden="true" />
                    <h3 id="findings-heading" className="text-sm font-semibold">All findings</h3>
                    <span className="font-mono text-xs text-muted-foreground">{findings.length}</span>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      className="h-8 pl-8 font-mono text-xs"
                      type="search"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="Filter findings…"
                      aria-label="Filter findings by severity, category, URL, or evidence"
                    />
                  </div>
                </div>
                {visibleFindings.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                    {findings.length === 0 ? "No findings have been reported yet." : "No findings match this search."}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-medium">Severity</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Affected page</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Evidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {visibleFindings.map((finding, index) => (
                          <tr key={`${finding.url}-${finding.category}-${index}`} className="align-top hover:bg-muted/20">
                            <td className="whitespace-nowrap px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 font-medium ${/critical|high/i.test(finding.severity) ? "text-status-danger" : /medium/i.test(finding.severity) ? "text-status-warning" : "text-muted-foreground"}`}>
                                <span aria-hidden="true">{/critical|high/i.test(finding.severity) ? "!" : /medium/i.test(finding.severity) ? "△" : "—"}</span>
                                {finding.severity || "Unknown"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-foreground">{finding.category || "Unclassified"}</td>
                            <td className="px-4 py-3">
                              <Button
                                variant="link"
                                className="h-auto max-w-64 justify-start truncate p-0 font-mono text-xs"
                                title={finding.url}
                                onClick={() => {
                                  const affectedId = normalizePageUrl(finding.url);
                                  if (affectedId) setSelectedId(affectedId);
                                }}
                              >
                                {formatPagePath(finding.url)}
                              </Button>
                            </td>
                            <td className="max-w-64 break-words px-4 py-3 font-mono text-muted-foreground">{finding.error || "Evidence not provided"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <CircleDashed className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                A page returning HTTP 200 or having no reported findings does not confirm that its content, APIs, or security checks are healthy.
              </p>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
