import { useState } from 'react';

type Page = { url: string; status?: number | null; parent?: string | null; children?: Page[] };
type Finding = { category: string; severity: string; url: string; error: string };

export default function TreeDiagram({ pages, findings }: { pages: Page[], findings: Finding[] }) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Build Tree
  const rootNodes: Page[] = [];
  const map: Record<string, Page> = {};

  pages.forEach(p => {
    map[p.url] = { ...p, children: [] };
  });

  pages.forEach(p => {
    if (p.parent && map[p.parent]) {
      map[p.parent].children!.push(map[p.url]);
    } else {
      rootNodes.push(map[p.url]);
    }
  });

  if (pages.length === 0) {
    return <div style={{ marginTop: '1rem' }}>No pages discovered yet.</div>;
  }

  const renderNode = (node: Page) => {
    const nodeFindings = findings.filter(f => f.url === node.url);
    const hasError = nodeFindings.length > 0;
    
    // Determine status color/label
    let bgColor = '#e6f4ea';
    let borderColor = '#137333';
    let label = node.status ? `HTTP ${node.status}` : 'Scanned';

    if (hasError) {
      bgColor = '#fce8e6';
      borderColor = '#c5221f';
      const cat = nodeFindings[0].category;
      label = cat;
      if (cat === 'Page Not Found') label = '404 — Page Not Found';
      if (cat === 'Access Restricted') label = 'Access Restricted — Not Accessed';
    }

    const isSelected = selectedNode === node.url;

    return (
      <li key={node.url} style={{ listStyleType: 'none', position: 'relative', paddingLeft: '20px', marginTop: '10px' }}>
        <div 
          onClick={() => setSelectedNode(node.url)}
          style={{
            border: `2px solid ${isSelected ? '#1a73e8' : borderColor}`,
            backgroundColor: bgColor,
            padding: '8px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'inline-block',
            boxShadow: isSelected ? '0 0 0 2px rgba(26,115,232,0.3)' : 'none'
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '14px', wordBreak: 'break-all' }}>{node.url}</div>
          <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>
            {hasError && <strong style={{ color: '#c5221f' }}>{label}</strong>}
            {!hasError && <span>{label}</span>}
          </div>
        </div>

        {isSelected && hasError && (
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '4px', maxWidth: '400px' }}>
            <h4 style={{ margin: '0 0 8px 0' }}>Error Details</h4>
            {nodeFindings.map((f, i) => (
              <div key={i} style={{ marginBottom: '8px', fontSize: '13px' }}>
                <div><strong>Category:</strong> {f.category}</div>
                <div><strong>Severity:</strong> {f.severity}</div>
                <div><strong>Evidence:</strong> {f.error}</div>
              </div>
            ))}
          </div>
        )}

        {node.children && node.children.length > 0 && (
          <ul style={{ paddingLeft: '20px', borderLeft: '1px dashed #ccc', marginLeft: '10px', marginTop: '10px' }}>
            {node.children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '8px', marginTop: '1rem', backgroundColor: '#fafafa', overflowX: 'auto' }}>
      <h3 style={{ marginTop: 0 }}>Website Hierarchy</h3>
      <div style={{ marginBottom: '1rem', fontSize: '12px', display: 'flex', gap: '15px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#e6f4ea', border: '1px solid #137333' }}></div> Success
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#fce8e6', border: '1px solid #c5221f' }}></div> Error / Restricted
        </span>
      </div>
      <ul style={{ padding: 0, margin: 0 }}>
        {rootNodes.map(renderNode)}
      </ul>
    </div>
  );
}
