"""
링크비트 가수 찾기
유튜브 영상의 '진짜 부른 사람'을 최대한 맞춰요. 정확한 순서대로:
  1) 유튜브 음악 정보 (yt-dlp 의 artist/artists — 공식 뮤비, '- Topic' 채널 등)
  2) 영상 제목 형식 ("[MV] 가수 _ 곡", "가수 '곡' MV", "가수 - 곡 (Official Video)" ...)
  3) 채널 이름 ("가수 - Topic", "가수VEVO", "가수 Official") — 소속사·유통·방송사·가사 채널은 제외
  4) (서버에서만) 애플 음악 검색으로 '곡 - 가수' / '가수 - 곡' 중 어느 쪽인지 확인, 가수가 없는 제목도 검색
반환: (가수, 출처)  출처 = youtube | title | channel | search | "" (못 찾음)
"""
import json
import re
import threading
import time
import urllib.parse
import urllib.request

# 가수가 아닌 채널(소속사, 유통사, 방송사, 가사·모음 채널 등)
_LABEL_RE = re.compile(
    r"(labels?|entertainment|\bent\b|\brecords?\b|recordings|smtown|1thek|원더케이|stone ?music|genie ?music|"
    r"\bmnet\b|\bkbs\b|\bmbc\b|\bsbs\b|jtbc|\btvn\b|dingo|딩고|\bm2\b|studio|\btv\b|lyrics?|가사|playlist|"
    r"플레이리스트|kpop|k-pop|cover|노래방|karaoke|official music|music ?channel|vevo$)",
    re.I,
)
# 제목에서 지울 꼬리표: [MV], (Official Video), [가사] 등
_TAG_WORDS = r"(?:official|mv|m/v|music ?video|video|audio|lyrics?|가사|live|visuali[sz]er|performance|teaser|4k|hd|special|clip|eng|sub|자막)"
_LEAD_TAG = re.compile(r"^\s*[\[【(〔]\s*[^\]】)〕]{0,24}[\]】)〕]\s*")
_ANY_TAG = re.compile(r"\s*[\[【(〔][^\]】)〕]*" + _TAG_WORDS + r"[^\]】)〕]*[\]】)〕]", re.I)
_TRAIL_WORDS = re.compile(r"\s*(?:official\s*)?(?:m/?v|music ?video|video|audio|lyric video|live|performance)\s*$", re.I)
_QUOTE = re.compile(r"^(.{1,60}?)\s*['‘“\"「『](.+?)['’”\"」』]")
_SEP = re.compile(r"\s+[-–—_|]\s+|\s*[_|]\s*")


_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]+")


def _clean_name(s):
    s = _EMOJI.sub("", s or "")
    s = _TRAIL_WORDS.sub("", s).strip(" -–—_|·:/")
    s = re.sub(r"\s{2,}", " ", s)
    return s if 1 <= len(s) <= 50 else ""


def clean_title(title):
    """앞뒤 꼬리표([MV], (Official Video) 등)를 뗀 제목"""
    t = title or ""
    for _ in range(3):
        t2 = _LEAD_TAG.sub("", t)
        if t2 == t:
            break
        t = t2
    t = _ANY_TAG.sub("", t)
    return re.sub(r"\s{2,}", " ", t).strip()


_LYRIC_HINT = re.compile(r"(가사|lyrics?|노래방|karaoke|playlist|플레이리스트)", re.I)
# 한국어 조사·어미로 끝나는 낱말 (곡 제목에 흔하고 가수 이름에는 드묾)
# (이름 끝에도 흔한 은·는·야·지·다 같은 글자는 넣지 않음 — '카린야' 같은 이름을 곡 제목으로 오해하지 않게)
_PARTICLE = re.compile(r"[가-힣](?:을|를|에|에서|의|으로|처럼|까지|보다|하는|했던|라도|인데|에게)(?=[\s,.!?~]|$)")
# 여러 명이 함께 부른 표시 (&, ×, x, 쉼표, feat.) — 이런 쪽은 가수 이름
_COLLAB = re.compile(r"(\s*[&×,]\s*|\s+[xX]\s+|\bfeat\.?|\bft\.|\bwith\b)", re.I)


def _norm(x):
    x = re.sub(r"[(\[【].*?[)\]】]", " ", (x or "").lower())
    return re.sub(r"[^0-9a-z가-힣ぁ-んァ-ン一-龥]", "", x)


def _similar(x, y):
    a, b = _norm(x), _norm(y)
    if not a or not b:
        return False
    return a == b or (min(len(a), len(b)) >= 2 and (a in b or b in a))


def _title_likeness(x):
    """클수록 '곡 제목' 같음: 띄어쓰기, 조사, 길이. '아이유(IU)'처럼 괄호 영문 병기는 가수 쪽"""
    x = x or ""
    score = x.count(" ") + 2 * len(_PARTICLE.findall(x)) + (1 if len(x) >= 9 else 0)
    if re.search(r"[가-힣]+\s*\([A-Za-z0-9 .&'-]+\)|[A-Za-z]+\s*\([가-힣 ]+\)", x):
        score -= 2
    return score


# 커버: "cover by 이라온", "(Cover by 이라온)", "이라온 커버" → 실제로 부른 사람
_COVER = re.compile(r"(?:cover(?:ed)?\s*by|커버\s*by|커버\s*:)\s*([^()\[\]【】|/]+?)\s*(?:[)\]】]|$|\s[-|/]\s)", re.I)
# 제목 앞에 붙인 문구(가사 한 줄, 소개 등) + ':' 뒤에 '가수 - 곡'
_HOOK = re.compile(r"^.{2,80}?\s*[:：]\s+(?=\S.*\s[-–—_|]\s)")


def cover_artist(title):
    m = _COVER.search(_EMOJI.sub("", title or ""))
    return _clean_name(m.group(1)) if m else ""


def split_title(title):
    """('quote', 가수, 곡) / ('pair', 앞, 뒤) / ('slash', 곡, 가수) / (None, 정리된 제목, '')"""
    t = _EMOJI.sub("", title or "")
    t = re.sub(r"\(?\s*(?:cover(?:ed)?\s*by|커버\s*by)[^)\]]*\)?", "", t, flags=re.I)   # 커버 표시는 따로 처리
    t = clean_title(_HOOK.sub("", t))
    if not t:
        return None, "", ""
    m = _QUOTE.match(t)                       # 가수 '곡'
    if m and m.group(1).strip():
        return "quote", _clean_name(m.group(1)), m.group(2).strip()
    parts = [p for p in _SEP.split(t, maxsplit=1) if p.strip()]
    if len(parts) == 2:
        return "pair", _clean_name(parts[0]), _clean_name(parts[1])
    if " / " in t:                            # 곡 / 가수 (일본식 표기)
        a, b = t.rsplit(" / ", 1)
        return "slash", a.strip(), _clean_name(b)
    return None, t, ""


_KANA_KANJI = re.compile(r"[ぁ-んァ-ン一-龥]")


def _paren_is_title(x):
    """'사랑 감기에 실려(恋風邪にのせて)', '도쿄 플래시(Tokyo Flash)' 처럼 괄호 안이 원제인 쪽 → 곡"""
    m = re.search(r"[(（]([^()（）]+)[)）]\s*$", x or "")
    if not m:
        return False
    inner = m.group(1).strip()
    return bool(_KANA_KANJI.search(inner)) or len(inner.split()) >= 2


def _matches_known(x, known):
    if not known or not x:
        return False
    for k in known:
        if _similar(x, k) or _same_sound(x, k):
            return True
    return False


def _pick_pair(a, b, title="", channel="", info=None, lookup=None, known=None, chan_order=None):
    """'A - B' 에서 가수 쪽 고르기"""
    track = (info or {}).get("track") if isinstance(info, dict) else None
    if track:                                  # 유튜브가 알려준 곡 이름과 같은 쪽이 곡
        if _similar(track, a) and not _similar(track, b):
            return b
        if _similar(track, b) and not _similar(track, a):
            return a
    ch = from_channel(channel)
    if ch:                                     # 채널(가수) 이름과 같은 쪽이 가수
        if _similar(ch, b) and not _similar(ch, a):
            return b
        if _similar(ch, a) and not _similar(ch, b):
            return a
    if chan_order and channel in chan_order:  # 방장이 고쳐서 배운 '이 채널의 순서'
        return a if chan_order[channel] == "left" else b
    ka, kb = _matches_known(a, known), _matches_known(b, known)
    if ka != kb:                               # 이미 아는 가수 이름과 같은 쪽 (발음이 같은 한글/영어 포함)
        return a if ka else b
    pa, pb = _paren_is_title(a), _paren_is_title(b)
    if pa != pb:                               # 괄호 속 원제가 붙은 쪽이 곡
        return b if pa else a
    if lookup:                                 # 음악 검색: 실제 곡·가수 이름과 맞춰 봄
        for art, trk in lookup(f"{a} {b}"):
            if _similar(trk, a) and _similar(art, b):
                return b
            if _similar(trk, b) and _similar(art, a):
                return a
    ca, cb = bool(_COLLAB.search(a)), bool(_COLLAB.search(b))
    if ca != cb:                               # 함께 부른 표시가 있는 쪽이 가수
        return a if ca else b
    sa, sb = _title_likeness(a), _title_likeness(b)
    if abs(sa - sb) >= 3:                      # 확실히 더 '제목 같은' 쪽이 곡 (애매하면 넘어감)
        return a if sa < sb else b
    if re.match(r"^\s*[\[【(]\s*(?:가사|lyrics?)", title or "", re.I):
        return b                               # 맨 앞이 [가사] 인 영상은 보통 '곡 - 가수'
    return a


def from_title(title, channel="", info=None, lookup=None, known=None, chan_order=None):
    c = cover_artist(title)
    if c:                                      # 커버 영상은 실제로 부른 사람
        return c
    kind, a, b = split_title(title)
    if kind == "quote":
        return a
    if kind == "pair":
        return _pick_pair(a, b, title, channel, info, lookup, known, chan_order)
    if kind == "slash":
        return b
    return ""


def from_channel(channel):
    c = (channel or "").strip()
    if not c:
        return ""
    if c.lower().endswith(" - topic"):        # 유튜브 뮤직 자동 생성 채널
        return _clean_name(c[:-8])
    if re.search(r"vevo$", c, re.I) and len(c) > 4:
        return _clean_name(re.sub(r"\s*vevo$", "", c, flags=re.I))
    if _LABEL_RE.search(c):
        return ""
    c = re.sub(r"\s*(?:official|공식|오피셜)\s*(?:channel|youtube|채널)?\s*$", "", c, flags=re.I)
    return _clean_name(c)


def from_info(info):
    """yt-dlp 정보에서 유튜브가 붙여둔 가수 정보"""
    if not isinstance(info, dict):
        return ""
    arts = info.get("artists")
    if isinstance(arts, list) and arts:
        names = [str(a).strip() for a in arts if str(a).strip()]
        if names:
            return ", ".join(dict.fromkeys(names))[:80]
    for k in ("artist", "creator"):
        v = info.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()[:80]
    return ""


def _strong_channel(channel):
    return bool(re.search(r"( - topic|vevo|official|공식|오피셜)\s*$", (channel or "").strip(), re.I))


# ---------------- 음악 검색 (애플 아이튠즈 검색 API: 무료, 가입·키 필요 없음)
_LOOK_LOCK = threading.Lock()
_LOOK_LAST = [0.0]
_LOOK_CACHE = {}


def itunes_lookup(term, limit=10):
    """검색어로 (가수, 곡) 목록. 실패하면 빈 목록. 분당 호출 제한이 있어 1.5초 간격으로."""
    term = (term or "").strip()[:120]
    if not term:
        return []
    if term in _LOOK_CACHE:
        return _LOOK_CACHE[term]
    with _LOOK_LOCK:
        wait = 1.5 - (time.time() - _LOOK_LAST[0])
        if wait > 0:
            time.sleep(wait)
        _LOOK_LAST[0] = time.time()
        out = []
        try:
            q = urllib.parse.urlencode({"term": term, "entity": "song", "limit": limit, "country": "KR"})
            req = urllib.request.Request("https://itunes.apple.com/search?" + q, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=6) as r:
                d = json.loads(r.read().decode("utf-8"))
            for it in d.get("results", []):
                if it.get("artistName") and it.get("trackName"):
                    out.append((str(it["artistName"]), str(it["trackName"])))
        except Exception:
            return []          # 네트워크 문제는 저장하지 않고 다음에 다시
        _LOOK_CACHE[term] = out
        return out


def _search_artist(title_only, lookup):
    """가수가 안 적힌 제목: 곡 이름이 똑같은 검색 결과의 가수"""
    want = _norm(title_only)
    if len(want) < 2:
        return ""
    for art, trk in lookup(title_only):
        if _norm(trk) == want:
            return art[:80]
    return ""


def guess(info=None, title="", channel="", online=False, known=None, chan_order=None):
    """online=True 면 음악 검색도 사용 (서버의 작업 스레드에서만)
    known: 이미 아는 가수 이름들, chan_order: {채널: 'left'|'right'} (방장이 고친 것에서 배움)"""
    lookup = itunes_lookup if online else None
    c = cover_artist(title)
    if c:
        return c, "title"
    a = from_info(info)
    if a:
        return a, "youtube"
    a = from_title(title, channel, info, lookup, known, chan_order)
    if a:
        return a, "title"
    if _strong_channel(channel):
        a = from_channel(channel)
        if a:
            return a, "channel"
    if lookup:
        kind, t, _ = split_title(title)
        a = _search_artist((info or {}).get("track") or t, lookup)
        if a:
            return a, "search"
    a = from_channel(channel)
    if a:
        return a, "channel"
    return "", ""


# ---------------- 같은 가수 묶기 (한글/영어 표기, 괄호 병기)
_L = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
_V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
_T = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']
_HANGUL = re.compile(r"[가-힣]")
_LATIN = re.compile(r"[A-Za-z]")


def romanize(s):
    """한글을 소리 나는 대로 로마자로 (바운디 → baundi)"""
    out = []
    for ch in s:
        c = ord(ch) - 0xAC00
        if 0 <= c < 11172:
            out.append(_L[c // 588] + _V[(c % 588) // 28] + _T[c % 28])
        else:
            out.append(ch)
    return "".join(out)


def _sound(s):
    """발음 비교용으로 단순하게: 비슷한 소리를 같은 글자로 (v→b→p, d→t, z→j, r→l, y→i, w→u ...)"""
    if _HANGUL.search(s):
        # 외래어 표기의 '으'(스·브·크·트…)는 원래 발음에 없는 소리라 뺌
        x = re.sub(r"eu", "", romanize(s).lower())
    else:
        x = s.lower()
        x = re.sub(r"c(?=[eiy])", "s", x)                          # ace, twice → s 소리
        x = re.sub(r"(?<=[a-z][bcdfgklmnprstvz])e\b", "", x)      # 끝의 소리 안 나는 e (vibe, five)
    x = re.sub(r"[^a-z]", "", x)
    for a, b in (("ph", "p"), ("ch", "j"), ("sh", "s"), ("th", "t"), ("ng", "n"), ("ck", "k"), ("eo", "o"), ("eu", "u"),
                 ("ae", "e"), ("oe", "e"), ("ee", "i"), ("oo", "u"), ("ea", "i")):
        x = x.replace(a, b)
    x = x.translate(str.maketrans("fvbdgczqxrwy", "ppptkkjkslui"))
    x = x.replace("h", "")
    return re.sub(r"(.)\1+", r"\1", x)


def _same_sound(a, b):
    import difflib
    sa, sb = _sound(a), _sound(b)
    if len(sa) < 3 or len(sb) < 3:
        return False
    ka, kb = re.sub(r"[aeiou]", "", sa), re.sub(r"[aeiou]", "", sb)
    ratio = difflib.SequenceMatcher(None, sa, sb).ratio()
    if ka == kb and len(ka) >= 2 and sa[0] == sb[0] or ka == kb and len(ka) >= 2 and ka[0] == kb[0]:
        return ratio >= 0.55
    return ka == kb and ratio >= 0.85


_PAREN_ALT = re.compile(r"^\s*([^()]+?)\s*[(（]\s*([^()]+?)\s*[)）]\s*$")


def _parts(name):
    m = _PAREN_ALT.match(name or "")
    return [m.group(1).strip(), m.group(2).strip()] if m else [(name or "").strip()]


def unify(names, preferred=()):
    """같은 가수의 다른 표기를 묶어서 {원래 이름: 통일된 이름}.
    names: 곡마다의 가수 이름 목록(중복 포함), preferred: 방장이 직접 고친 이름(우선)"""
    from collections import Counter
    count = Counter(n for n in names if n)
    keys = {}                              # 정규화 키 → 대표 노드
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    def node(text):
        k = _norm(text)
        if not k:
            return None
        if k not in parent:
            parent[k] = k
            keys[k] = text
        return k

    raw_node = {}
    for raw in count:
        ps = [node(p) for p in _parts(raw)]
        ps = [p for p in ps if p]
        rn = node(raw)
        if not rn:
            continue
        raw_node[raw] = rn
        for p in ps:
            union(rn, p)
    # 한글 이름 ↔ 영어 이름 발음 비교
    hangul = [k for k, t in keys.items() if _HANGUL.search(t) and not _LATIN.search(t)]
    latin = [k for k, t in keys.items() if _LATIN.search(t) and not _HANGUL.search(t)]
    for h in hangul:
        for l in latin:
            if find(h) != find(l) and _same_sound(keys[h], keys[l]):
                union(h, l)
    groups = {}
    for raw, rn in raw_node.items():
        groups.setdefault(find(rn), []).append(raw)
    pref = [p for p in preferred if p]
    out = {}
    for members in groups.values():
        chosen = None
        for p in reversed(pref):           # 방장이 고친 이름이 있으면 그걸로
            if p in members:
                chosen = p
                break
        if not chosen:
            def rank(n):
                both = bool(_HANGUL.search(n)) and bool(_LATIN.search(n))
                return (count[n], both, bool(_HANGUL.search(n)), len(n))
            chosen = max(members, key=rank)
        for m in members:
            out[m] = chosen
    return out


def learn_order(title, artist_name):
    """방장이 고친 가수가 제목의 앞쪽/뒤쪽 중 어디였는지 ('left'/'right'/None)"""
    kind, a, b = split_title(title)
    if kind != "pair" or not artist_name:
        return None
    ia = _similar(artist_name, a) or _same_sound(artist_name, a)
    ib = _similar(artist_name, b) or _same_sound(artist_name, b)
    if ia and not ib:
        return "left"
    if ib and not ia:
        return "right"
    return None
