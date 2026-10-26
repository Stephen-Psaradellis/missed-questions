const STOPWORDS = new Set([
  "a", "the", "and", "or", "but", "on", "in", "at", "for", "to", "of", "is", "are", "was", "were",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your",
  "his", "their", "our", "this", "that", "these", "those", "with", "can", "do", "does", "did", "will",
  "shall", "should", "could", "would", "as", "if", "then", "than", "because", "about", "from", "by",
  "what", "who", "when", "where", "why", "how", "which", "is", "are", "was", "were"
]);

const QUESTION_PREFIXES = [
  "who", "what", "when", "where", "why", "how", "is", "are", "can", "does", "do", "will", "which"
];

function removeMentions(text) {
  // remove tokens starting with @ plus trailing whitespace
  return text.replace(/(^|\s)@\S+/g, '').trim().replace(/\s+/g, ' ');
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[\p{P}$+<=>^`|~]/gu, ' ') // remove punctuation (except ? special case)
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t));
}

export function isQuestion(text) {
  if (!text) return false;
  let trimmed = text.trim();

  // ignore lines starting with command !
  if(trimmed.startsWith('!')) return false;

  const textNoMentions = removeMentions(trimmed);

  let wordsRaw = textNoMentions.split(/\s+/);

  // remove emote-only tokens (consider tokens with no \w as emotes)
  let words = wordsRaw.filter(w => w.match(/\w/));

  if(words.length > 25) return false; // too long, consider rant

  if(words.length < 3) {
    // short message under 3 words rejected unless specific cases
    if(trimmed.endsWith('?')) {
      if(words.length === 2) {
        return true; // 2-word messages ending with '?' count as questions
      }
      if(words.length === 1) {
        const firstWord = words[0].toLowerCase();
        if(QUESTION_PREFIXES.includes(firstWord)) {
          return true;
        }
      }
    }
    return false;
  }

  // ends with question mark?
  if(trimmed.endsWith('?')) return true;

  // starts with question prefix followed by space
  const firstWord = words[0].toLowerCase();
  if(QUESTION_PREFIXES.includes(firstWord)) return true;

  return false;
}

function jaccardSimilarity(a, b) {
  if(a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function normalizeTextForComparison(text) {
  // Lowercase, strip punctuation and whitespace for case-insensitive comparison keys
  return text.toLowerCase().replace(/[^\w]+/g, '');
}

export class QuestionBoard {
  constructor() {
    this.openQuestions = new Map(); // id -> {id,text,keyTokens,users:Set,ts,answered,firstTs, phrasingCounts: Map}
    this.answeredQuestions = new Map(); // id -> same
    this.nextId = 1;
  }

  clear() {
    this.openQuestions.clear();
    this.answeredQuestions.clear();
    this.nextId = 1;
  }

  tokensInText(tokens, text) {
    if(!tokens || tokens.size === 0) return false;
    const tokensInMsg = new Set(tokenize(text));
    for (let t of tokens) {
      if (!tokensInMsg.has(t)) return false;
    }
    return true;
  }

  normalize(text) {
    // MERGE KEY exactly as previously: normalize to token set (lowercase, drop stopwords and punctuation)
    const tokens = new Set(tokenize(text));
    return tokens;
  }

  add({user, text, ts}) {
    if(!isQuestion(text)) return false;

    const normalizedTokens = this.normalize(text);

    // strip @mentions from displayed text
    const displayText = removeMentions(text.trim());

    // prepare phrase normalization key for phrase tallying and display choosing
    const displayNorm = normalizeTextForComparison(displayText);

    // Merge into existing open question with similarity >= 0.5 (highest similarity)
    let bestMatchId = null;
    let bestScore = 0;

    for (let [id, q] of this.openQuestions.entries()) {
      const score = jaccardSimilarity(normalizedTokens, q.keyTokens);
      if(score >= 0.5 && score > bestScore) {
        bestScore = score;
        bestMatchId = id;
      }
    }

    if(bestMatchId !== null) {
      const q = this.openQuestions.get(bestMatchId);
      q.users.add(user.toLowerCase());
      if(ts > q.ts) q.ts = ts;

      // Update phrasing counts for display text tally
      const oldCount = q.phrasingCounts.get(displayNorm) || 0;
      q.phrasingCounts.set(displayNorm, oldCount + 1);

      // Update map of phrase normalized key -> phrase text
      if(!q.phrasingTextMap.has(displayNorm)) {
        q.phrasingTextMap.set(displayNorm, displayText);
      }

      // Determine preferred phrasing by count & length
      let maxCount = 0;
      let candidates = [];
      for(const [pNorm, count] of q.phrasingCounts.entries()) {
        if(count > maxCount) {
          maxCount = count;
          candidates = [pNorm];
        } else if(count === maxCount) {
          candidates.push(pNorm);
        }
      }
      // Pick the longest phrasing among candidates
      let chosenNorm = candidates[0];
      for(const c of candidates) {
        if(c.length > chosenNorm.length) chosenNorm = c;
      }

      let bestText = q.phrasingTextMap.get(chosenNorm) || q.text;
      if(bestText !== q.text) {
        q.text = bestText;
      }
      // Update keyTokens on merge to latest normalized tokens
      q.keyTokens = normalizedTokens;

      return true;
    }

    // No suitable match, add new question with phrasing counts initialized
    const phrasingCounts = new Map();
    phrasingCounts.set(displayNorm, 1);
    const phrasingTextMap = new Map();
    phrasingTextMap.set(displayNorm, displayText);

    const id = String(this.nextId++);
    this.openQuestions.set(id, {
      id,
      text: displayText,
      keyTokens: normalizedTokens,
      users: new Set([user.toLowerCase()]),
      ts,
      firstTs: ts,
      answered: false,
      phrasingCounts,
      phrasingTextMap
    });
    return true;
  }

  markAnswered(id) {
    if(this.openQuestions.has(id)) {
      const q = this.openQuestions.get(id);
      q.answered = true;
      this.openQuestions.delete(id);
      this.answeredQuestions.set(id, q);
      return true;
    }
    return false;
  }

  undo(id) {
    if(this.answeredQuestions.has(id)) {
      const q = this.answeredQuestions.get(id);
      q.answered = false;
      this.answeredQuestions.delete(id);
      this.openQuestions.set(id, q);
      return true;
    }
    return false;
  }

  isAnswered(id) {
    return this.answeredQuestions.has(id);
  }

  top(n=5) {
    const openArr = Array.from(this.openQuestions.values());
    openArr.sort((a,b) => {
      // rank by distinct users desc, then recency desc
      if(b.users.size !== a.users.size) return b.users.size - a.users.size;
      return b.ts - a.ts;
    });
    // convert to plain objects with users array and count
    return openArr.slice(0,n).map(q => ({
      id: q.id,
      text: q.text,
      count: q.users.size,
      users: Array.from(q.users),
      ts: q.ts,
      firstTs: q.firstTs
    }));
  }

  answeredList() {
    // return answered questions sorted by newest answered first (by ts)
    const arr = Array.from(this.answeredQuestions.values());
    arr.sort((a,b) => b.ts - a.ts);
    return arr.map(q => ({
      id: q.id,
      text: q.text,
      count: q.users.size,
      users: Array.from(q.users),
      ts: q.ts,
      firstTs: q.firstTs
    }));
  }

  toJSON() {
    return {
      nextId: this.nextId,
      openQuestions: Array.from(this.openQuestions.entries()).map(([id,q]) => ({
        id: q.id,
        text: q.text,
        users: Array.from(q.users),
        ts: q.ts,
        firstTs: q.firstTs,
        answered: q.answered,
        phrasingCounts: Array.from(q.phrasingCounts.entries()),
        phrasingTextMap: Array.from(q.phrasingTextMap.entries())
      })),
      answeredQuestions: Array.from(this.answeredQuestions.entries()).map(([id,q]) => ({
        id: q.id,
        text: q.text,
        users: Array.from(q.users),
        ts: q.ts,
        firstTs: q.firstTs,
        answered: q.answered,
        phrasingCounts: Array.from(q.phrasingCounts.entries()),
        phrasingTextMap: Array.from(q.phrasingTextMap.entries())
      }))
    };
  }

  fromJSON(obj) {
    this.nextId = obj.nextId || 1;
    this.openQuestions.clear();
    this.answeredQuestions.clear();
    if(obj.openQuestions) {
      obj.openQuestions.forEach(q => {
        this.openQuestions.set(q.id, {
          id: q.id,
          text: q.text,
          keyTokens: this.normalize(q.text),
          users: new Set(q.users),
          ts: q.ts,
          firstTs: q.firstTs,
          answered: q.answered || false,
          phrasingCounts: new Map(q.phrasingCounts || []),
          phrasingTextMap: new Map(q.phrasingTextMap || [])
        });
      });
    }
    if(obj.answeredQuestions) {
      obj.answeredQuestions.forEach(q => {
        this.answeredQuestions.set(q.id, {
          id: q.id,
          text: q.text,
          keyTokens: this.normalize(q.text),
          users: new Set(q.users),
          ts: q.ts,
          firstTs: q.firstTs,
          answered: q.answered || true,
          phrasingCounts: new Map(q.phrasingCounts || []),
          phrasingTextMap: new Map(q.phrasingTextMap || [])
        });
      });
    }
  }
}
