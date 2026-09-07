/* WordPiece tokenizer for the bge-small student model (BERT uncased).
   Mirrors the HuggingFace tokenizers pipeline stored in tokenizer.json:
   BertNormalizer (clean_text, handle_chinese_chars, strip_accents when lowercasing, lowercase),
   BertPreTokenizer (whitespace split, punctuation isolated), WordPiece (greedy longest match, ## prefix,
   max 100 chars per word, [UNK] for words that cannot be split), TemplateProcessing [CLS] A [SEP],
   truncation to max_length tokens including the two special tokens.
   The Python file tests/test_tokenizer.py is a line by line port of this logic and is checked
   against the HuggingFace tokenizer on corpus narratives. Keep the two in sync. */
'use strict';

const WordPiece = (() => {
  const CJK = [[0x4E00, 0x9FFF], [0x3400, 0x4DBF], [0x20000, 0x2A6DF], [0x2A700, 0x2B73F],
               [0x2B740, 0x2B81F], [0x2B920, 0x2CEAF], [0xF900, 0xFAFF], [0x2F800, 0x2FA1F]];
  const RE_OTHER = /\p{C}/u;          // general categories Cc, Cf, Cn, Co, Cs
  const RE_MN = /\p{Mn}/u;            // nonspacing marks (accents after NFD)
  const RE_PUNCT = /[!-\/:-@\[-`{-~]|\p{P}/u;  // ASCII punctuation ranges or Unicode P*

  function isCjk(cp) {
    for (const [a, b] of CJK) if (cp >= a && cp <= b) return true;
    return false;
  }
  function isWhitespace(ch) {
    return ch === '\t' || ch === '\n' || ch === '\r' || /\s/.test(ch);
  }
  function isControl(ch) {
    if (ch === '\t' || ch === '\n' || ch === '\r') return false;
    return RE_OTHER.test(ch);
  }
  function isPunct(ch) { return RE_PUNCT.test(ch); }

  class Tokenizer {
    constructor(vocab, opts) {
      this.vocab = vocab;
      this.index = new Map();
      vocab.forEach((w, i) => this.index.set(w, i));
      this.clsId = opts.cls_id; this.sepId = opts.sep_id; this.unkId = opts.unk_id; this.padId = opts.pad_id;
      this.maxLength = opts.max_length || 256;
      this.maxInputCharsPerWord = 100;
      this.unkToken = vocab[this.unkId];
    }

    normalize(text) {
      // clean_text: drop NUL, U+FFFD and control characters; map whitespace to a single space
      let out = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === 0 || cp === 0xFFFD || isControl(ch)) continue;
        out.push(isWhitespace(ch) ? ' ' : ch);
      }
      // handle_chinese_chars: pad CJK ideographs with spaces
      let s = '';
      for (const ch of out) s += isCjk(ch.codePointAt(0)) ? ' ' + ch + ' ' : ch;
      // strip_accents (enabled because lowercase is true): NFD then remove nonspacing marks
      let t = '';
      for (const ch of s.normalize('NFD')) if (!RE_MN.test(ch)) t += ch;
      // lowercase
      return t.toLowerCase();
    }

    preTokenize(text) {
      const words = [];
      let cur = '';
      for (const ch of text) {
        if (isWhitespace(ch)) {
          if (cur) { words.push(cur); cur = ''; }
        } else if (isPunct(ch)) {
          if (cur) { words.push(cur); cur = ''; }
          words.push(ch);
        } else {
          cur += ch;
        }
      }
      if (cur) words.push(cur);
      return words;
    }

    wordpiece(word) {
      const chars = Array.from(word);
      if (chars.length > this.maxInputCharsPerWord) return [this.unkToken];
      const pieces = [];
      let start = 0;
      while (start < chars.length) {
        let end = chars.length;
        let found = null;
        while (start < end) {
          let sub = chars.slice(start, end).join('');
          if (start > 0) sub = '##' + sub;
          if (this.index.has(sub)) { found = sub; break; }
          end -= 1;
        }
        if (found === null) return [this.unkToken];
        pieces.push(found);
        start = end;
      }
      return pieces;
    }

    tokenize(text) {
      const tokens = [];
      for (const w of this.preTokenize(this.normalize(text))) for (const p of this.wordpiece(w)) tokens.push(p);
      return tokens;
    }

    encode(text) {
      let tokens = this.tokenize(text);
      const truncated = tokens.length > this.maxLength - 2;
      if (truncated) tokens = tokens.slice(0, this.maxLength - 2);
      const ids = [this.clsId, ...tokens.map(t => this.index.get(t)), this.sepId];
      return { inputIds: ids, attentionMask: ids.map(() => 1), tokens: [this.vocab[this.clsId], ...tokens, this.vocab[this.sepId]], truncated };
    }
  }

  async function load(vocabUrl, labelsUrl) {
    const [vocab, labels] = await Promise.all([fetch(vocabUrl).then(r => r.json()), fetch(labelsUrl).then(r => r.json())]);
    return { tokenizer: new Tokenizer(vocab, labels), labels };
  }

  return { Tokenizer, load };
})();
