// Referencia sin optimizar del commit 4afbd249, sólo para pruebas.
function getPosMatches(query){
  const q = normalizeForSearch(query);
  const qDigits = String(query||'').replace(/\D/g,'');
  if(!q && !qDigits) return [];
  const items = (STATE.products||[]).filter(p=>p && !p.deleted);
  const scored = [];
  for(const p of items){
    const nameNorm = normalizeForSearch(p.name);
    const catNorm = normalizeForSearch(p.category);
    const codeNorm = String(p.barcode||'').replace(/\D/g,'');
    const nameMatch = q && (nameNorm.includes(q) || matchLettersOrdered(q, nameNorm));
    const catMatch = q && (catNorm.includes(q) || matchLettersOrdered(q, catNorm));
    const codeMatch = qDigits && codeNorm.includes(qDigits);
    if(!(nameMatch || catMatch || codeMatch)) continue;

    let score = 0;
    if(q && nameNorm.startsWith(q)) score += 4;
    else if(q && nameNorm.includes(q)) score += 3;
    else if(q && matchLettersOrdered(q, nameNorm)) score += 1;
    if(qDigits && codeNorm === qDigits) score += 3;
    else if(qDigits && codeNorm.includes(qDigits)) score += 2;
    if(getAvailableQtyForSale(p) <= 0) score -= 1;
    scored.push({ p, score });
  }
  scored.sort((a,b)=> b.score - a.score);
  return scored.slice(0, 8).map(s => s.p);
}
