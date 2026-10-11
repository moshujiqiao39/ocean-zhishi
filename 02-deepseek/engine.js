const OceanEngine = (() => {
  const STOP = new Set("的了是在和与及或被把对从到为也就都而及其这那什么怎么为什么如何有没有吗呢啊呀".split(""));

  function tokenize(text) {
    const raw = String(text || "").toLowerCase();
    const tokens = [];
    for (const word of raw.match(/[a-z0-9]+/g) || []) tokens.push(word);
    const chars = [...raw].filter((ch) => /[\u4e00-\u9fff]/.test(ch));
    for (let i = 0; i < chars.length; i += 1) {
      tokens.push(chars[i]);
      if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
      if (i + 2 < chars.length) tokens.push(chars[i] + chars[i + 1] + chars[i + 2]);
    }
    return tokens.filter((t) => t && !STOP.has(t));
  }

  function tf(tokens) {
    const map = new Map();
    tokens.forEach((t) => map.set(t, (map.get(t) || 0) + 1));
    const n = tokens.length || 1;
    map.forEach((v, k) => map.set(k, v / n));
    return map;
  }

  function build(entries) {
    const docs = entries.map((entry) => {
      const qaText = (entry.qa || []).map((x) => `${x.q} ${x.a}`).join(" ");
      const blob = [entry.title, entry.summary, entry.content, (entry.tags || []).join(" "), qaText].join(" ");
      return { entry, tokens: tokenize(blob), text: blob };
    });
    const df = new Map();
    docs.forEach((doc) => {
      new Set(doc.tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
    });
    const n = docs.length || 1;
    const idf = new Map();
    df.forEach((v, k) => idf.set(k, Math.log((n + 1) / (v + 1)) + 1));
    docs.forEach((doc) => {
      doc.vec = tf(doc.tokens);
    });
    return { docs, idf };
  }

  function cosine(queryTokens, doc, idf) {
    const q = tf(queryTokens);
    let dot = 0;
    let qn = 0;
    let dn = 0;
    q.forEach((qv, k) => {
      const w = (idf.get(k) || 0.4) * qv;
      qn += w * w;
      const dv = (doc.vec.get(k) || 0) * (idf.get(k) || 0.4);
      dot += w * dv;
    });
    doc.vec.forEach((dv, k) => {
      const w = dv * (idf.get(k) || 0.4);
      dn += w * w;
    });
    if (!qn || !dn) return 0;
    return dot / (Math.sqrt(qn) * Math.sqrt(dn));
  }

  function extraBoost(query, entry) {
    let score = 0;
    const q = query.toLowerCase();
    if (entry.title && q.includes(entry.title.slice(0, 2))) score += 0.04;
    (entry.tags || []).forEach((tag) => {
      if (q.includes(String(tag).toLowerCase())) score += 0.08;
    });
    (entry.qa || []).forEach((pair) => {
      if (pair.q && (q.includes(pair.q.slice(0, 4)) || pair.q.includes(q.slice(0, 4)))) score += 0.16;
    });
    return score;
  }

  function relevantSentences(text, queryTokens, limit = 3) {
    const parts = String(text || "").split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
    return parts
      .map((sentence) => {
        const tokens = new Set(tokenize(sentence));
        const overlap = queryTokens.filter((t) => tokens.has(t)).length;
        return { sentence, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((x) => x.sentence);
  }

  function bestQa(entry, query) {
    const qTokens = new Set(tokenize(query));
    let best = null;
    (entry.qa || []).forEach((pair) => {
      const tokens = tokenize(`${pair.q} ${pair.a}`);
      const overlap = tokens.filter((t) => qTokens.has(t)).length;
      const hit = overlap / Math.max(tokens.length, 4);
      if (!best || hit > best.hit) best = { pair, hit };
    });
    return best;
  }

  function search(model, query, topK = 5) {
    const queryTokens = tokenize(query);
    return model.docs
      .map((doc) => ({
        entry: doc.entry,
        score: cosine(queryTokens, doc, model.idf) + extraBoost(query, doc.entry),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  function answer(model, query) {
    const hits = search(model, query, 5);
    const top = hits[0];
    if (!top || top.score < 0.08) {
      return {
        title: "知识库里还没有足够接近的条目",
        text: "本地模型没有检索到足够匹配的海洋知识。换一个更具体的问法，例如“珊瑚为什么会白化”“马里亚纳海沟有多深”，或在开发者面板补充新知识后重新提问。",
        sources: [],
        confidence: 0,
        hits,
      };
    }

    const queryTokens = tokenize(query);
    const leadQa = bestQa(top.entry, query);
    const support = hits.slice(0, 3).flatMap((hit) => {
      const sentences = relevantSentences(hit.entry.content, queryTokens, hit === top ? 2 : 1);
      return sentences.map((sentence) => ({ title: hit.entry.title, sentence }));
    });

    let text = "";
    if (leadQa && leadQa.hit > 0.18) {
      text += leadQa.pair.a;
    } else {
      text += top.entry.summary || top.entry.content.slice(0, 80);
    }
    const extras = support
      .map((x) => x.sentence)
      .filter((s, i, arr) => s && arr.indexOf(s) === i && !text.includes(s.slice(0, 12)))
      .slice(0, 3);
    if (extras.length) {
      text += "\n\n补充来自本地知识库：\n" + extras.map((s) => "· " + s).join("\n");
    }

    const confidence = Math.max(0.18, Math.min(0.98, top.score * 1.8));
    return {
      title: top.entry.title,
      text,
      sources: hits.filter((h) => h.score > 0.08).map((h) => h.entry),
      confidence,
      hits,
    };
  }

  function contextBlock(hits, budget = 1800) {
    let used = 0;
    const chunks = [];
    hits.forEach((hit) => {
      const piece = `【${hit.entry.title}】${hit.entry.summary}\n${hit.entry.content}`;
      if (used + piece.length > budget) return;
      chunks.push(piece);
      used += piece.length;
    });
    return chunks.join("\n\n");
  }

  return { build, search, answer, contextBlock, tokenize };
})();
