import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type Page = {
  url: string;
  status?: number | null;
  parent?: string | null;
  children?: Page[];
};

type Finding = {
  category: string;
  severity: string;
  url: string;
  error: string;
};

type TreeDiagramProps = {
  pages: Page[];
  findings: Finding[];
};

export default function TreeDiagram({ pages, findings }: TreeDiagramProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const rootNodes = useMemo(() => {
    const map: Record<string, Page> = {};

    pages.forEach((page) => {
      if (!map[page.url]) {
        map[page.url] = { ...page, children: [] };
      } else {
        map[page.url] = {
          ...map[page.url],
          ...page,
          children: map[page.url].children ?? [],
        };
      }
    });

    const roots: Page[] = [];
    const assigned = new Set<string>();

    pages.forEach((page) => {
      const node = map[page.url];

      if (page.parent && page.parent !== page.url && map[page.parent]) {
        const parent = map[page.parent];
        if (!parent.children!.some((child) => child.url === node.url)) {
          parent.children!.push(node);
        }
        assigned.add(node.url);
      } else if (!roots.some((root) => root.url === node.url)) {
        roots.push(node);
      }
    });

    Object.values(map).forEach((node) => {
      if (!assigned.has(node.url) && !roots.some((root) => root.url === node.url)) {
        roots.push(node);
      }
    });

    return roots;
  }, [pages]);

  const findingsByUrl = useMemo(() => {
    const map: Record<string, Finding[]> = {};
    findings.forEach((finding) => {
      (map[finding.url] ??= []).push(finding);
    });
    return map;
  }, [findings]);

  if (pages.length === 0) {
    return <div style={{ marginTop: '1rem' }}>No pages discovered yet.</div>;
  }

  const renderNode = (
    node: Page,
    ancestors: Set<string> = new Set()
  ): ReactNode => {
    if (ancestors.has(node.url)) return null;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.url);

    const nodeFindings = findingsByUrl[node.url] ?? [];
    const hasError = nodeFindings.length > 0;
    const isSelected = selectedNode === node.url;

    let bgColor = '#e6f4ea';
    let borderColor = '#137333';
    let label = node.status != null ? `HTTP ${node.status}` : 'Scanned';

    if (hasError) {
      bgColor = '#fce8e6';
      borderColor = '#c5221f';
      const category = nodeFindings[0].category;

      if (category === 'Page Not Found') label = '404 — Page Not Found';
      else if (category === 'Access Restricted') label = 'Access Restricted — Not Accessed';
      else label = category;
    } else if (node.status != null && node.status >= 400) {
      bgColor = '#fce8e6';
      borderColor = '#c5221f';
      label = `HTTP ${node.status}`;
    }

    const children = (node.children ?? []).filter(
      (child) => !nextAncestors.has(child.url)
    );

    return (
      <li
        key={node.url}
        style={{
          listStyleType: 'none',
          position: 'relative',
          paddingLeft: '20px',
          marginTop: '10px',
        }}
      >
        <button
          type="button"
          onClick={() =>
            setSelectedNode((current) => current === node.url ? null : node.url)
          }
          aria-expanded={isSelected}
          style={{
            textAlign: 'left',
            border: `2px solid ${isSelected ? '#1a73e8' : borderColor}`,
            backgroundColor: bgColor,
            padding: '8px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'inline-block',
            maxWidth: '100%',
            boxShadow: isSelected ? '0 0 0 2px rgba(26,115,232,0.3)' : 'none',
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '14px', overflowWrap: 'anywhere' }}>
            {node.url}
          </div>
          <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>
            {hasError ? (
              <strong style={{ color: '#c5221f' }}>{label}</strong>
            ) : (
              <span>{label}</span>
            )}
          </div>
        </button>

        {isSelected && hasError && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px',
              backgroundColor: '#fff',
              border: '1px solid #ddd',
              borderRadius: '4px',
              maxWidth: '400px',
              overflowWrap: 'anywhere',
            }}
          >
            <h4 style={{ margin: '0 0 8px 0' }}>Error Details</h4>
            {nodeFindings.map((finding, index) => (
              <div key={`${finding.category}-${index}`} style={{ marginBottom: '8px', fontSize: '13px' }}>
                <div><strong>Category:</strong> {finding.category}</div>
                <div><strong>Severity:</strong> {finding.severity}</div>
                <div><strong>Evidence:</strong> {finding.error}</div>
              </div>
            ))}
          </div>
        )}

        {children.length > 0 && (
          <ul
            style={{
              paddingLeft: '20px',
              borderLeft: '1px dashed #ccc',
              marginLeft: '10px',
              marginTop: '10px',
            }}
          >
            {children.map((child) => renderNode(child, nextAncestors))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div
      style={{
        padding: '1rem',
        border: '1px solid #ddd',
        borderRadius: '8px',
        marginTop: '1rem',
        backgroundColor: '#fafafa',
        overflowX: 'auto',
      }}
    >
      <h3 style={{ marginTop: 0 }}>Website Hierarchy</h3>

      <div style={{ marginBottom: '1rem', fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#e6f4ea', border: '1px solid #137333' }} />
          Success
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#fce8e6', border: '1px solid #c5221f' }} />
          Error / Restricted
        </span>
      </div>

      <ul style={{ padding: 0, margin: 0 }}>
        {rootNodes.map((node) => renderNode(node))}
      </ul>
    </div>
  );
}
