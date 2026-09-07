/* Browser inference for the distilled bge-small coder (ONNX int8) with onnxruntime-web (wasm).
   Everything runs locally: the model file is fetched once and narratives never leave the browser. */
'use strict';

const NarrativeModel = (() => {
  const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
  const MODEL_URL = 'model/model_quantized.onnx';
  const VOCAB_URL = 'model/vocab.json';
  const LABELS_URL = 'model/labels.json';

  const state = { status: 'idle', session: null, tokenizer: null, labels: null, error: null, loadPromise: null };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.ort) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load onnxruntime-web from the CDN. Check the network connection.'));
      document.head.appendChild(s);
    });
  }

  async function fetchWithProgress(url, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Model file not found (${resp.status}) at ${url}`);
    const total = Number(resp.headers.get('content-length')) || 0;
    if (!resp.body || !resp.body.getReader) {
      const buf = await resp.arrayBuffer();
      onProgress(buf.byteLength, buf.byteLength);
      return buf;
    }
    const reader = resp.body.getReader();
    const chunks = []; let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      onProgress(received, total);
    }
    const out = new Uint8Array(received); let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  }

  /* onProgress({stage, loaded, total, fraction}) */
  function load(onProgress) {
    if (state.loadPromise) return state.loadPromise;
    const report = (stage, loaded, total) => onProgress && onProgress({ stage, loaded, total, fraction: total ? loaded / total : 0 });
    state.status = 'loading'; state.error = null;
    state.loadPromise = (async () => {
      try {
        report('runtime', 0, 0);
        await loadScript(ORT_CDN + 'ort.min.js');
        ort.env.wasm.wasmPaths = ORT_CDN;
        ort.env.wasm.numThreads = 1;   // single thread: works without cross-origin isolation headers
        report('tokenizer', 0, 0);
        const { tokenizer, labels } = await WordPiece.load(VOCAB_URL, LABELS_URL);
        state.tokenizer = tokenizer; state.labels = labels;
        const buf = await fetchWithProgress(MODEL_URL, (l, t) => report('model', l, t));
        report('session', 0, 0);
        state.session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        state.status = 'ready';
        report('ready', 1, 1);
      } catch (e) {
        state.status = 'error'; state.error = e; state.loadPromise = null;
        throw e;
      }
    })();
    return state.loadPromise;
  }

  function ranked(probs, names) {
    return Array.from(probs).map((p, i) => ({ code: names[i], p })).sort((a, b) => b.p - a.p);
  }

  async function predict(text) {
    if (state.status !== 'ready') throw new Error('Model is not loaded yet.');
    const enc = state.tokenizer.encode(text);
    const n = enc.inputIds.length;
    const ids = new ort.Tensor('int64', BigInt64Array.from(enc.inputIds.map(v => BigInt(v))), [1, n]);
    const mask = new ort.Tensor('int64', BigInt64Array.from(enc.attentionMask.map(v => BigInt(v))), [1, n]);
    const t0 = performance.now();
    const out = await state.session.run({ input_ids: ids, attention_mask: mask });
    const ms = performance.now() - t0;
    return {
      mechanism: ranked(out.p_mechanism.data, state.labels.mechanism),
      energy: ranked(out.p_energy.data, state.labels.energy_source),
      highEnergy: ranked(out.p_high_energy.data, state.labels.high_energy.map(Number)),
      tokens: enc.tokens, nTokens: n, truncated: enc.truncated, ms,
    };
  }

  return { load, predict, state };
})();
