// Mede o site local com o Lighthouse (mesmo motor do PageSpeed).
//   node scripts/lighthouse.cjs [url ...]          padrão: home, catálogo, loja e um produto
//   LH_FORM=desktop node scripts/lighthouse.cjs     mede no modo computador (padrão: celular)
// Pré-requisito: servidor local rodando (npm run dev, porta 4173).
// Saída: notas de todas as categorias + o que ainda está falhando, e o JSON completo em qa/lighthouse/.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FORM = process.env.LH_FORM === 'desktop' ? 'desktop' : 'mobile';
const base = 'http://localhost:4173';
const urls = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/catalogo', '/loja', '/produto/reta'];
const out = path.join(__dirname, '..', 'qa', 'lighthouse');
fs.mkdirSync(out, { recursive: true });

for (const u of urls) {
  const url = u.startsWith('http') ? u : base + u;
  const nome = (u.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '_') || 'home') + '-' + FORM;
  const arq = path.join(out, nome + '.json');
  const preset = FORM === 'desktop' ? ' --preset=desktop' : '';
  execSync(`npx -y lighthouse@13 "${url}" --quiet${preset} --output=json --output-path="${arq}" --chrome-path="${CHROME}" "--chrome-flags=--headless=new --no-sandbox"`, { stdio: 'ignore' });
  const r = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const a = r.audits;
  const notas = Object.values(r.categories).map(c => {
    if (c.score !== null) return `${c.title} ${Math.round(c.score * 100)}`;
    const refs = c.auditRefs.filter(x => x.weight > 0 && a[x.id] && a[x.id].score !== null);
    return `${c.title} ${refs.filter(x => a[x.id].score >= 0.9).length}/${refs.length}`;
  });
  console.log(`\n${u} [${FORM}]  ${notas.join(' · ')}`);
  console.log(`  FCP ${a['first-contentful-paint'].displayValue} · LCP ${a['largest-contentful-paint'].displayValue} · TBT ${a['total-blocking-time'].displayValue} · CLS ${a['cumulative-layout-shift'].displayValue}`);
  for (const [id, au] of Object.entries(a)) {
    if (au.score !== null && au.score < 0.9 && !['metric', 'informative', 'manual', 'notApplicable'].includes(au.scoreDisplayMode))
      console.log(`  - ${id}: ${au.title}${au.displayValue ? ' (' + au.displayValue + ')' : ''}`);
  }
}
