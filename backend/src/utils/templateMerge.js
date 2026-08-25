function mergeTemplate(template, tokens) {
  let out = template;
  Object.keys(tokens).forEach((k) => {
    out = out.split(`{{${k}}}`).join(tokens[k] == null ? '' : String(tokens[k]));
  });
  return out;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wrapDocumentHtml(title, bodyText) {
  const escaped = bodyText.split('\n').map(escapeHtml).join('<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.6;color:#1c2b23;}
    h1{font-size:20px;border-bottom:2px solid #10293D;padding-bottom:10px;}
    .meta{color:#666;font-size:12px;margin-bottom:24px;}
    .footer{margin-top:48px;padding-top:16px;border-top:1px solid #ccc;font-size:11px;color:#888;}
  </style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Braco Group of Companies — generated ${new Date().toLocaleString()}</div>
  <div>${escaped}</div>
  <div class="footer">This document was generated from a standard template for internal use and should be reviewed by qualified legal counsel before execution. It does not constitute legal advice.</div>
  </body></html>`;
}

function buildContractTerm(employee) {
  const fmt = (d) => (d ? new Date(d).toLocaleDateString() : '[date to be confirmed]');
  if (employee.contract_type === 'temporary') {
    return `temporary position from ${fmt(employee.contract_start_date)} through ${fmt(employee.contract_end_date)}`;
  }
  if (employee.contract_type === 'permanent') {
    return `permanent position, effective ${fmt(employee.contract_start_date)}`;
  }
  return 'position with contract terms to be confirmed by HR';
}

module.exports = { mergeTemplate, wrapDocumentHtml, buildContractTerm };
