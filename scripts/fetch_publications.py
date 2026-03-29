#!/usr/bin/env python3
"""Fetch publications from ORCID, enrich with Crossref metadata, resolve arXiv
IDs, generate BibTeX, and write a local JSON file consumed by the website.

All user-specific settings live in config/site-config.js.  This script reads
that file and has no hardcoded personal data of its own.

Usage:
    python scripts/fetch_publications.py [--config config/site-config.js]

The output is written to assets/data/publications.json (+ .js for file:// use).
"""

import argparse
import html
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote, urlparse

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

ORCID_API = "https://pub.orcid.org/v3.0"
CROSSREF_API = "https://api.crossref.org/works"
ARXIV_API = "http://export.arxiv.org/api/query"
OUTPUT_PATH = Path("assets/data/publications.json")

SESSION = requests.Session()

# ---------------------------------------------------------------------------
# Config parsing – extract values from the JS config file
# ---------------------------------------------------------------------------


def _extract_js_array(text: str, key: str) -> list[str] | None:
    """Try to pull a JS string-array value from config text."""
    pattern = rf'{key}\s*:\s*\[(.*?)\]'
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return None
    raw = m.group(1)
    return re.findall(r'''["']([^"']+)["']''', raw)


def _extract_js_string(text: str, key: str) -> str | None:
    """Pull a JS string value from config text."""
    m = re.search(rf'{key}\s*:\s*["\']([^"\']+)["\']', text)
    return m.group(1).strip() if m else None


def _extract_js_object(text: str, key: str) -> dict[str, str] | None:
    """Try to pull a simple JS {key: value} map from config text."""
    pattern = rf'{key}\s*:\s*\{{(.*?)\}}'
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return None
    raw = m.group(1)
    pairs = re.findall(r'''["']([^"']+)["']\s*:\s*["']([^"']+)["']''', raw)
    return dict(pairs)


def load_config(config_path: str) -> dict:
    """Parse the JS site-config.  All settings come from the config file."""
    p = Path(config_path)
    if not p.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    text = p.read_text(encoding="utf-8")

    # Site identity (used for User-Agent header)
    site_url = _extract_js_string(text, "url") or ""
    site_email = _extract_js_string(text, "email") or ""
    site_name = _extract_js_string(text, "name") or "AcademicSite"

    cfg = {
        "site_name": site_name,
        "site_url": site_url,
        "site_email": site_email,
        "orcid": _extract_js_string(text, "orcid") or "",
        "arxiv_author_feed": _extract_js_string(text, "arxivAuthorFeed") or "",
        "excluded_titles": _extract_js_array(text, "excludedTitles") or [],
        "top_conference_venues": _extract_js_array(text, "topConferenceVenues") or [],
        "top_conference_excluded": _extract_js_array(text, "topConferenceExcludedVenues") or [],
        "q1_journal_venues": _extract_js_array(text, "q1JournalVenues") or [],
        "journal_name_overrides": _extract_js_object(text, "journalNameOverrides") or {},
    }

    if not cfg["orcid"]:
        raise ValueError("Config must include publications.orcid")

    # Set up HTTP session with a proper User-Agent
    ua_parts = [site_name.replace(" ", ""), "1.0"]
    ua_extra = " ".join(f"({v})" for v in [site_url, f"mailto:{site_email}"] if v)
    SESSION.headers["User-Agent"] = f"{ua_parts[0]}/{ua_parts[1]} {ua_extra}".strip()

    return cfg


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", html.unescape(text or "").lower()).strip()


def clean_latex(text: str) -> str:
    """Strip common LaTeX markup so titles can be compared across sources."""
    t = text or ""
    t = re.sub(r"\\textbackslash\s*", "", t)
    t = re.sub(r"\\text\w+\{([^}]*)\}", r"\1", t)
    # Replace Greek letter commands with their names so both LaTeX and text forms match
    for cmd in ("ell", "sigma", "alpha", "beta", "gamma", "delta", "epsilon", "lambda", "mu", "pi", "theta"):
        t = re.sub(rf"\\{cmd}\b", cmd, t)
    t = re.sub(r"[\\{}$_^]", "", t)
    return t.strip()


def normalize_title_key(text: str) -> str:
    """Normalize a title for fuzzy matching: strip LaTeX, lowercase, alphanum only."""
    return normalize_key(clean_latex(text))


# Unicode equivalents for common LaTeX commands
_LATEX_UNICODE = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ",
    "epsilon": "ε", "lambda": "λ", "mu": "μ", "pi": "π",
    "theta": "θ", "sigma": "σ", "ell": "ℓ",
}


def clean_title_for_display(text: str) -> str:
    """Convert LaTeX markup in a title to readable Unicode text."""
    t = text or ""
    t = re.sub(r"\\textbackslash\s*", "\\\\", t)       # normalise \textbackslash → \\
    t = re.sub(r"\\text\w+\{([^}]*)\}", r"\1", t)     # \textit{x} → x
    for cmd, char in _LATEX_UNICODE.items():
        t = re.sub(rf"\\{cmd}\b", char, t)
    t = re.sub(r"[\\{}$^]", "", t)                      # strip remaining markup
    t = t.replace("_", "")                               # subscript underscores
    return re.sub(r"\s+", " ", t).strip()


def clean_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def is_meaningful_venue(text: str) -> bool:
    v = clean_space(text)
    if not v:
        return False
    low = v.lower()
    if low == "venue not specified":
        return False
    if re.match(r"^https?://", v, re.I):
        return False
    if re.search(
        r"\bonline record\b|\brepository\b|\biris\.unica\.it\b|\borcid\.org\b|\bcrossref\b|\bdoi\.org\b|\bpubmed\b|\bwikipedia\b",
        low,
    ):
        return False
    if re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", v, re.I):
        return False
    return True


def looks_institutional(text: str) -> bool:
    low = clean_space(text).lower()
    return bool(
        re.search(
            r"universit|dipartiment|department|facolt|faculty|istituto|institute|iris\.|repository|archiv|crossref|doi\.org|pubmed|wikidata",
            low,
        )
    )


def matches_venue_list(venue: str, normalized_list: list[str]) -> bool:
    vk = normalize_key(venue)
    if not vk or not normalized_list:
        return False
    return any(item in vk for item in normalized_list)


# ---------------------------------------------------------------------------
# Venue normalization (mirrors JS logic)
# ---------------------------------------------------------------------------

ACRONYM_MAP = {
    "acm": "ACM", "aaai": "AAAI", "acl": "ACL", "iclr": "ICLR",
    "icml": "ICML", "ijcai": "IJCAI", "ieee": "IEEE", "neurips": "NeurIPS",
    "nips": "NeurIPS", "cvpr": "CVPR", "iccv": "ICCV", "eccv": "ECCV",
    "wacv": "WACV", "kdd": "KDD", "usenix": "USENIX", "ml": "ML",
    "ai": "AI", "nlp": "NLP", "qa": "QA", "llm": "LLM",
    "icmlc": "ICMLC", "itasec": "ITASEC", "esann": "ESANN",
    "iot": "IoT", "cpscom": "CPSCom",
}
MINOR_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of",
    "on", "or", "the", "to", "with", "via",
}


def normalize_venue_name(value: str, overrides: dict[str, str]) -> str:
    inp = re.sub(r"[\s.;,:]+$", "", clean_space(html.unescape(value or "")))
    if not inp:
        return ""
    override = overrides.get(normalize_key(inp))
    if override:
        return override
    tokens = re.split(r"(\s+|[-/()])", inp)
    word_index = 0
    result = []
    for token in tokens:
        if re.match(r"^\s+$|^[-/()]$", token):
            result.append(token)
            continue
        lower = token.lower()
        is_upper = bool(re.match(r"^[A-Z0-9&.]+$", token))
        upper_letters = re.sub(r"[^A-Z]", "", token)
        is_likely_acronym = (
            (is_upper or (len(lower) >= 2 and lower.isalpha() and lower.isupper() == token.isupper()))
            and 0 < len(upper_letters if is_upper else lower) <= 7
            and lower not in MINOR_WORDS
        )
        if lower in ACRONYM_MAP:
            out = ACRONYM_MAP[lower]
        elif is_likely_acronym:
            out = token
        elif word_index > 0 and lower in MINOR_WORDS:
            out = lower
        else:
            out = lower[0].upper() + lower[1:] if lower else token
        word_index += 1
        result.append(out)
    normalized = "".join(result)
    return overrides.get(normalize_key(normalized), normalized)


# ---------------------------------------------------------------------------
# DOI / arXiv helpers
# ---------------------------------------------------------------------------


def normalize_doi(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    raw = re.sub(r"^doi\s*:\s*", "", raw, flags=re.I)
    raw = re.sub(r"^https?://doi\.org/", "", raw, flags=re.I)
    raw = re.sub(r"[\s.]+$", "", raw).strip()
    return raw or None


def is_arxiv_doi(doi: str) -> bool:
    return (doi or "").lower().startswith("10.48550/arxiv.")


def arxiv_id_from_doi(doi: str) -> str | None:
    if not is_arxiv_doi(doi):
        return None
    return re.sub(r"^10\.48550/arxiv\.", "", doi, flags=re.I).strip() or None


def parse_arxiv_id(text: str) -> str | None:
    if not text:
        return None
    normalized = re.sub(r"^arxiv:", "", text.strip(), flags=re.I)
    normalized = re.sub(r"[.,;\s]+$", "", normalized)
    if re.match(r"^[a-z\-.]+/[0-9]{7}(?:v\d+)?$", normalized, re.I):
        return normalized
    if re.match(r"^\d{4}\.\d{4,5}(?:v\d+)?$", normalized, re.I):
        return normalized
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#\s]+?)(?:\.pdf)?$", normalized, re.I)
    if m:
        return parse_arxiv_id(m.group(1))
    return None


def extract_arxiv_id_from_url(url: str) -> str | None:
    if not url:
        return None
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#\s]+?)(?:\.pdf)?$", url.strip(), re.I)
    if not m:
        return None
    return parse_arxiv_id(m.group(1))


def find_arxiv_id(external_ids: list[dict], doi: str | None, *urls: str) -> str | None:
    if doi and is_arxiv_doi(doi):
        aid = arxiv_id_from_doi(doi)
        if aid:
            return aid
    for eid in external_ids:
        if (eid.get("external-id-type") or "").lower() == "arxiv":
            val = eid.get("external-id-value", "")
            parsed = parse_arxiv_id(val)
            if parsed:
                return parsed
    for eid in external_ids:
        id_type = (eid.get("external-id-type") or "").lower()
        if id_type == "doi" and is_arxiv_doi(eid.get("external-id-value", "")):
            aid = arxiv_id_from_doi(eid["external-id-value"])
            if aid:
                return aid
        parsed = parse_arxiv_id(eid.get("external-id-value", ""))
        if parsed:
            return parsed
        parsed = extract_arxiv_id_from_url(
            (eid.get("external-id-url") or {}).get("value", "")
        )
        if parsed:
            return parsed
    for u in urls:
        parsed = extract_arxiv_id_from_url(u)
        if parsed:
            return parsed
    return None


def infer_year_from_arxiv_id(arxiv_id: str) -> str | None:
    if not arxiv_id:
        return None
    m = re.match(r"^(\d{2})(\d{2})\.", arxiv_id)
    if not m:
        return None
    yy = int(m.group(1))
    current_yy = time.localtime().tm_year % 100
    century = 2000 if yy <= current_yy + 1 else 1900
    return str(century + yy)


def get_doi_from_external_ids(external_ids: list[dict]) -> str | None:
    for eid in external_ids:
        if (eid.get("external-id-type") or "").lower() == "doi":
            return normalize_doi(eid.get("external-id-value"))
    return None


def get_best_work_url(external_ids: list[dict]) -> str | None:
    for eid in external_ids:
        url_obj = eid.get("external-id-url") or {}
        if url_obj.get("value"):
            return url_obj["value"]
    return None


def is_arxiv_url(url: str) -> bool:
    return bool(re.search(r"arxiv\.org/(abs|pdf)", url or "", re.I))


# ---------------------------------------------------------------------------
# arXiv API search by title
# ---------------------------------------------------------------------------


def fetch_arxiv_author_feed(feed_url: str) -> dict[str, dict]:
    """Fetch an arXiv author atom feed and return a map of normalized-title → entry dict.
    
    Each entry contains: arxiv_id, title, authors (comma-separated string).
    """
    result: dict[str, dict] = {}
    if not feed_url:
        return result
    try:
        resp = SESSION.get(feed_url, timeout=30)
        if resp.status_code != 200:
            log.warning("arXiv author feed returned %d", resp.status_code)
            return result
        root = ET.fromstring(resp.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            entry_title = re.sub(r"\s+", " ", (entry.findtext("atom:title", "", ns) or "").strip())
            entry_id = (entry.findtext("atom:id", "", ns) or "").strip()
            entry_authors = (entry.find("atom:author", ns).findtext("atom:name", "", ns) or "").strip() if entry.find("atom:author", ns) is not None else ""
            m = re.search(r"arxiv\.org/abs/(.+?)(?:v\d+)?$", entry_id)
            if m and entry_title:
                arxiv_id = m.group(1)
                key = normalize_title_key(entry_title)
                result[key] = {
                    "arxiv_id": arxiv_id,
                    "title": entry_title,
                    "authors": entry_authors,
                }
        log.info("arXiv author feed: %d papers", len(result))
    except Exception as exc:
        log.warning("Failed to fetch arXiv author feed: %s", exc)
    return result


# ---------------------------------------------------------------------------
# ORCID API
# ---------------------------------------------------------------------------


def fetch_orcid_works(orcid: str) -> list[dict]:
    url = f"{ORCID_API}/{orcid}/works"
    resp = SESSION.get(url, headers={"Accept": "application/json"}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    groups = data.get("group", [])
    summaries = []
    for g in groups:
        ws = g.get("work-summary", [])
        if ws:
            summaries.append(ws[0])
    return summaries


def fetch_orcid_work_detail(orcid: str, put_code: int) -> dict | None:
    url = f"{ORCID_API}/{orcid}/work/{put_code}"
    try:
        resp = SESSION.get(url, headers={"Accept": "application/json"}, timeout=15)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Crossref API
# ---------------------------------------------------------------------------


def fetch_crossref(doi: str) -> dict | None:
    if not doi:
        return None
    url = f"{CROSSREF_API}/{quote(doi, safe='')}"
    try:
        resp = SESSION.get(url, timeout=15)
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data.get("message")
    except Exception:
        return None


def extract_crossref_metadata(cr: dict | None) -> dict:
    if not cr:
        return {}
    title_list = cr.get("title", [])
    title = title_list[0] if title_list else ""
    container = (cr.get("container-title") or [""])[0]
    authors = []
    for a in cr.get("author", []):
        family = a.get("family", "")
        given = a.get("given", "")
        if family and given:
            authors.append({"family": family, "given": given})
        elif family:
            authors.append({"family": family, "given": ""})
    year = ""
    for date_field in ["published-print", "published-online", "published", "created"]:
        dp = cr.get(date_field, {}).get("date-parts", [[]])
        if dp and dp[0] and dp[0][0]:
            year = str(dp[0][0])
            break
    return {
        "title": title,
        "container_title": container,
        "authors": authors,
        "year": year,
        "publisher": cr.get("publisher", ""),
        "volume": cr.get("volume", ""),
        "issue": cr.get("issue", ""),
        "page": cr.get("page", ""),
        "type": cr.get("type", ""),
        "url": cr.get("URL", ""),
    }


# ---------------------------------------------------------------------------
# BibTeX generation
# ---------------------------------------------------------------------------


def bibtex_escape(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def make_bibtex_key(title: str, year: str, primary_author: str) -> str:
    author_part = re.sub(r"[^a-z0-9]", "", (primary_author or "author").lower())[:12]
    title_part = re.sub(r"[^a-z0-9]", "", (title or "work").lower())[:20]
    return f"{author_part or 'author'}{year or 'nd'}{title_part or 'work'}"


def crossref_entry_type(cr_type: str, raw_type: str) -> str:
    mapping = {
        "journal-article": "article",
        "proceedings-article": "inproceedings",
        "proceedings": "proceedings",
        "book-chapter": "incollection",
        "book-section": "incollection",
        "book": "book",
        "reference-entry": "incollection",
        "posted-content": "misc",
        "preprint": "misc",
    }
    if cr_type and cr_type in mapping:
        return mapping[cr_type]
    type_map = {
        "journal-article": "article",
        "conference-paper": "inproceedings",
        "book-chapter": "incollection",
        "book": "book",
        "edited-book": "book",
    }
    return type_map.get(raw_type, "misc")


def normalize_bibtex_pages(value: str) -> str:
    raw = clean_space(value)
    if not raw:
        return ""
    raw = re.sub(r"\s*[\u2013\u2014]\s*", "--", raw)
    raw = re.sub(r"\s*-\s*", "--", raw)
    return raw


def generate_bibtex(
    title: str,
    year: str,
    venue: str,
    doi: str | None,
    raw_type: str,
    url: str,
    crossref_meta: dict,
) -> str:
    cr_type = crossref_meta.get("type", "")
    entry_type = crossref_entry_type(cr_type, raw_type)
    authors = crossref_meta.get("authors", [])
    first_family = authors[0]["family"] if authors else "Author"
    best_title = clean_space(crossref_meta.get("title") or title or "Untitled work")
    best_year = clean_space(crossref_meta.get("year") or year or "n.d.")
    best_venue = clean_space(crossref_meta.get("container_title") or venue or "")
    key = make_bibtex_key(best_title, best_year, first_family)

    author_str = (
        " and ".join(f"{a['family']}, {a['given']}" if a.get("given") else a["family"] for a in authors)
        if authors
        else "Unknown authors"
    )

    fields = [
        f"  title = {{{bibtex_escape(best_title)}}}",
        f"  author = {{{bibtex_escape(author_str)}}}",
        f"  year = {{{bibtex_escape(best_year)}}}",
    ]
    if best_venue:
        if entry_type == "article":
            fields.append(f"  journal = {{{bibtex_escape(best_venue)}}}")
        elif entry_type in ("inproceedings", "incollection", "proceedings"):
            fields.append(f"  booktitle = {{{bibtex_escape(best_venue)}}}")
        elif entry_type == "misc":
            fields.append(f"  howpublished = {{{bibtex_escape(best_venue)}}}")
    publisher = crossref_meta.get("publisher", "")
    if publisher and entry_type != "article":
        fields.append(f"  publisher = {{{bibtex_escape(publisher)}}}")
    vol = crossref_meta.get("volume", "")
    if vol:
        fields.append(f"  volume = {{{bibtex_escape(str(vol))}}}")
    issue = crossref_meta.get("issue", "")
    if issue:
        fields.append(f"  number = {{{bibtex_escape(str(issue))}}}")
    page = crossref_meta.get("page", "")
    if page:
        fields.append(f"  pages = {{{bibtex_escape(normalize_bibtex_pages(page))}}}")
    if doi:
        fields.append(f"  doi = {{{bibtex_escape(doi)}}}")
    best_url = url or crossref_meta.get("url", "")
    if best_url:
        fields.append(f"  url = {{{bibtex_escape(best_url)}}}")

    return f"@{entry_type}{{{key},\n" + ",\n".join(fields) + "\n}"


# ---------------------------------------------------------------------------
# BibTeX from ORCID citation field
# ---------------------------------------------------------------------------


def extract_bibtex_field(bibtex: str, field: str) -> str:
    m = re.search(
        rf"(?:^|\n|,)\s*{field}\s*=\s*(\{{[^{{}}]*\}}|\"[^\"]*\")", bibtex, re.I
    )
    if not m:
        return ""
    raw = m.group(1).strip()
    if raw.startswith("{") or raw.startswith('"'):
        raw = raw[1:-1]
    return clean_space(re.sub(r"\\[{}]", "", raw))


def get_bibtex_from_orcid(detail: dict | None) -> str:
    if not detail:
        return ""
    citation = detail.get("citation") or {}
    ctype = (citation.get("citation-type") or "").lower()
    value = (citation.get("citation-value") or "").strip()
    if not value or ctype != "bibtex" or not value.startswith("@"):
        return ""
    return value


def get_venue_from_orcid_bibtex(detail: dict | None) -> str:
    if not detail:
        return ""
    bibtex = get_bibtex_from_orcid(detail)
    if not bibtex:
        return ""
    for field in ("journal", "booktitle"):
        v = extract_bibtex_field(bibtex, field)
        if is_meaningful_venue(v):
            return v
    return ""


def bibtex_matches(bibtex: str, doi: str | None, title: str) -> bool:
    if doi:
        bib_doi = normalize_doi(extract_bibtex_field(bibtex, "doi"))
        if bib_doi and bib_doi.lower() == doi.lower():
            return True
    if title:
        bib_title = normalize_key(extract_bibtex_field(bibtex, "title"))
        target = normalize_key(title)
        if bib_title and target and bib_title == target:
            return True
    return False


# ---------------------------------------------------------------------------
# Choose URLs
# ---------------------------------------------------------------------------


def is_preferred_url(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
        if "orcid.org" in host:
            return False
        if "cordis.europa.eu" in host:
            return False
    except Exception:
        pass
    return True


def choose_publication_url(doi: str | None, crossref_meta: dict, external_ids: list[dict], summary: dict, exclude_arxiv: bool = False) -> str:
    candidates = []
    if doi:
        candidates.append(f"https://doi.org/{doi}")
    cr_url = crossref_meta.get("url", "")
    if cr_url:
        candidates.append(cr_url)
    best = get_best_work_url(external_ids)
    if best:
        candidates.append(best)
    summary_url = (summary.get("url") or {}).get("value", "")
    if summary_url:
        candidates.append(summary_url)

    for c in candidates:
        c = c.strip()
        if not c:
            continue
        if exclude_arxiv and is_arxiv_url(c):
            continue
        if not is_preferred_url(c):
            continue
        return c
    return ""


def choose_arxiv_url(arxiv_id: str | None, title: str) -> dict:
    if arxiv_id:
        return {"url": f"https://arxiv.org/abs/{arxiv_id}", "exact": True}
    return {"url": "", "exact": False}


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def classify_work(
    raw_type: str, doi: str | None, venue: str, arxiv_id: str | None,
    external_ids: list[dict], pub_url: str, arxiv_url: str, title: str,
    top_keys: list[str], top_excluded_keys: list[str], q1_keys: list[str],
) -> dict:
    has_non_arxiv_doi = bool(doi and not is_arxiv_doi(doi))
    published_types = {"journal-article", "conference-paper", "book-chapter", "book", "edited-book"}
    has_published_type = raw_type in published_types
    is_published = has_non_arxiv_doi or has_published_type

    is_arxiv = bool(arxiv_id) or is_arxiv_doi(doi or "") or any(
        is_arxiv_url(u) for u in [pub_url, arxiv_url, title, venue] if u
    )
    generic_venue = not is_meaningful_venue(venue) or bool(re.search(r"repository record|online record", venue, re.I))
    is_arxiv_only = is_arxiv and not has_non_arxiv_doi and not has_published_type and generic_venue

    effective_type = "preprint" if (raw_type == "preprint" or is_arxiv_only) else raw_type

    is_top = (
        effective_type == "conference-paper"
        and matches_venue_list(venue, top_keys)
        and not matches_venue_list(venue, top_excluded_keys)
    )
    is_q1 = effective_type == "journal-article" and matches_venue_list(venue, q1_keys)

    filter_type = {
        "journal-article": "journal",
        "conference-paper": "conference",
        "preprint": "preprint",
    }.get(effective_type, "other")

    return {
        "effective_type": effective_type,
        "is_published": is_published,
        "is_top_conference": is_top,
        "is_q1_journal": is_q1,
        "is_arxiv_only": is_arxiv_only,
        "filter_type": filter_type,
    }


# ---------------------------------------------------------------------------
# Type label
# ---------------------------------------------------------------------------


def normalize_type_label(raw_type: str, venue: str) -> str:
    type_map = {
        "journal-article": "Journal article",
        "conference-paper": "Conference paper",
        "book-chapter": "Chapter contribution",
        "book": "Book",
        "edited-book": "Edited book",
        "preprint": "Preprint",
        "other": "Research output",
    }
    base = type_map.get(raw_type, (raw_type or "work").replace("-", " "))
    if raw_type == "book-chapter" and re.search(r"proceedings|conference|acm|ieee|springer lecture notes", venue or "", re.I):
        return "Conference proceedings chapter"
    return base


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def process_publications(cfg: dict) -> list[dict]:
    orcid = cfg["orcid"]
    excluded_titles = [t.lower() for t in cfg["excluded_titles"]]
    top_keys = [normalize_key(v) for v in cfg["top_conference_venues"] if normalize_key(v)]
    top_excluded_keys = [normalize_key(v) for v in cfg["top_conference_excluded"] if normalize_key(v)]
    q1_keys = [normalize_key(v) for v in cfg["q1_journal_venues"] if normalize_key(v)]
    overrides = {normalize_key(k): v for k, v in cfg["journal_name_overrides"].items()}

    log.info("Fetching ORCID works for %s ...", orcid)
    summaries = fetch_orcid_works(orcid)
    log.info("Found %d work groups", len(summaries))

    # Pre-fetch arXiv author feed for fast title-based lookup
    arxiv_feed_map = fetch_arxiv_author_feed(cfg.get("arxiv_author_feed", ""))

    best_by_title: dict[str, dict] = {}
    matched_feed_keys: set[str] = set()
    results = []

    for i, summary in enumerate(summaries):
        title = (summary.get("title", {}).get("title", {}).get("value") or "Untitled work")
        title_lower = title.lower()
        if any(exc in title_lower for exc in excluded_titles):
            log.debug("Excluding: %s", title)
            continue

        raw_type = summary.get("type", "work")
        external_ids = (summary.get("external-ids") or {}).get("external-id", [])
        doi = get_doi_from_external_ids(external_ids)
        put_code = summary.get("put-code")
        summary_journal = clean_space((summary.get("journal-title") or {}).get("value", ""))
        summary_source = clean_space(
            (summary.get("source", {}).get("source-name") or {}).get("value", "")
        )
        allow_source = raw_type != "journal-article" and not looks_institutional(summary_source)
        venue = (
            summary_journal
            if is_meaningful_venue(summary_journal)
            else (summary_source if allow_source and is_meaningful_venue(summary_source) else "")
        )

        # Crossref enrichment
        crossref_meta = {}
        if doi:
            log.debug("  Crossref: %s", doi)
            cr = fetch_crossref(doi)
            if cr:
                crossref_meta = extract_crossref_metadata(cr)
            time.sleep(0.1)  # polite rate limit

        # arXiv ID
        summary_url = (summary.get("url") or {}).get("value", "")
        best_url = get_best_work_url(external_ids)
        arxiv_id = find_arxiv_id(external_ids, doi, summary_url, best_url or "")

        # Look up in pre-fetched arXiv author feed
        title_feed_key = normalize_title_key(title)
        if not arxiv_id:
            feed_entry = arxiv_feed_map.get(title_feed_key)
            if feed_entry:
                arxiv_id = feed_entry["arxiv_id"]
                log.info("    arXiv (feed): %s", arxiv_id)
                log.debug("    feed key: %s → %s", title_feed_key[:60], feed_entry["title"][:60])
        if title_feed_key in arxiv_feed_map:
            matched_feed_keys.add(title_feed_key)

        year = (
            (summary.get("publication-date") or {}).get("year", {}).get("value")
            or crossref_meta.get("year")
            or infer_year_from_arxiv_id(arxiv_id)
            or "n.d."
        )

        # Venue enrichment
        if raw_type == "journal-article" and is_meaningful_venue(crossref_meta.get("container_title", "")):
            venue = crossref_meta["container_title"]
        if not is_meaningful_venue(venue) and is_meaningful_venue(crossref_meta.get("container_title", "")):
            venue = crossref_meta["container_title"]
        if not is_meaningful_venue(venue) and is_meaningful_venue(crossref_meta.get("publisher", "")):
            venue = crossref_meta["publisher"]

        # ORCID detail for venue / bibtex
        detail = None
        if not is_meaningful_venue(venue) and put_code:
            detail = fetch_orcid_work_detail(orcid, put_code)
            bib_venue = get_venue_from_orcid_bibtex(detail)
            if is_meaningful_venue(bib_venue):
                venue = bib_venue

        if not is_meaningful_venue(venue):
            venue = (
                "Conference proceedings (venue not listed in ORCID)"
                if raw_type == "conference-paper"
                else "Repository record"
            )

        venue = normalize_venue_name(venue, overrides)

        # URLs
        non_arxiv_pub_url = choose_publication_url(doi, crossref_meta, external_ids, summary, exclude_arxiv=True)
        arxiv_ref = choose_arxiv_url(arxiv_id, title)
        arxiv_url = arxiv_ref["url"]
        publication_url = non_arxiv_pub_url or arxiv_url

        # Classification
        cls = classify_work(
            raw_type, doi, venue, arxiv_id, external_ids,
            publication_url, arxiv_url, title,
            top_keys, top_excluded_keys, q1_keys,
        )
        effective_type = cls["effective_type"]

        if cls["is_arxiv_only"] and not is_meaningful_venue(venue):
            venue = "arXiv preprint"
        if cls["is_arxiv_only"] and re.search(r"repository record", venue, re.I):
            venue = "arXiv preprint"

        # BibTeX
        if not detail and put_code:
            detail = fetch_orcid_work_detail(orcid, put_code)
        orcid_bibtex = get_bibtex_from_orcid(detail)
        verified_orcid_bibtex = orcid_bibtex if bibtex_matches(orcid_bibtex, doi, title) else ""

        bibtex = verified_orcid_bibtex or generate_bibtex(
            title, year, venue, doi, effective_type,
            non_arxiv_pub_url or arxiv_url or publication_url,
            crossref_meta,
        )
        bibtex_source = "ORCID" if verified_orcid_bibtex else "Reconstructed from metadata"

        type_label = normalize_type_label(effective_type, venue)

        # Authors from crossref or ORCID
        authors = []
        if crossref_meta.get("authors"):
            authors = [
                f"{a['family']}, {a['given']}" if a.get("given") else a["family"]
                for a in crossref_meta["authors"]
            ]

        record = {
            "title": clean_title_for_display(title),
            "authors": authors,
            "year": year,
            "venue": venue,
            "rawType": raw_type,
            "effectiveType": effective_type,
            "typeLabel": type_label,
            "doi": doi or "",
            "arxivId": arxiv_id or "",
            "publicationUrl": non_arxiv_pub_url,
            "arxivUrl": arxiv_url,
            "bibtex": bibtex,
            "bibtexSource": bibtex_source,
            "isPublished": cls["is_published"],
            "isTopConference": cls["is_top_conference"],
            "isQ1Journal": cls["is_q1_journal"],
            "isArxivOnly": cls["is_arxiv_only"],
            "filterType": cls["filter_type"],
        }

        title_key = normalize_key(title)
        priority = 3 if cls["is_published"] else (2 if effective_type == "preprint" else 1)
        prev = best_by_title.get(title_key)
        if not prev or priority > prev["_priority"] or (
            priority == prev["_priority"] and (int(year) if year.isdigit() else 0) > prev.get("_year_int", 0)
        ):
            record["_priority"] = priority
            record["_year_int"] = int(year) if str(year).isdigit() else 0
            best_by_title[title_key] = record

        log.info("  [%d/%d] %s (%s)", i + 1, len(summaries), title[:60], year)

    # Deduplicate
    for rec in best_by_title.values():
        rec.pop("_priority", None)
        rec.pop("_year_int", None)
        results.append(rec)

    # Add arXiv-only papers not found in ORCID as preprints
    for feed_key, feed_entry in arxiv_feed_map.items():
        if feed_key in matched_feed_keys:
            continue
        # Skip excluded titles
        if any(exc in feed_entry["title"].lower() for exc in excluded_titles):
            continue
        arxiv_id = feed_entry["arxiv_id"]
        year = infer_year_from_arxiv_id(arxiv_id) or "n.d."
        arxiv_url = f"https://arxiv.org/abs/{arxiv_id}"
        authors_list = [a.strip() for a in feed_entry["authors"].split(",") if a.strip()]
        first_author = authors_list[0].split()[-1] if authors_list else "unknown"
        bibtex = generate_bibtex(
            feed_entry["title"], year, "arXiv preprint", None, "preprint",
            arxiv_url, {"authors": [{"family": a.split()[-1], "given": " ".join(a.split()[:-1])} for a in authors_list] if authors_list else []},
        )
        record = {
            "title": clean_title_for_display(feed_entry["title"]),
            "authors": authors_list,
            "year": year,
            "venue": "arXiv preprint",
            "rawType": "preprint",
            "effectiveType": "preprint",
            "typeLabel": "Preprint",
            "doi": "",
            "arxivId": arxiv_id,
            "publicationUrl": "",
            "arxivUrl": arxiv_url,
            "bibtex": bibtex,
            "bibtexSource": "Reconstructed from metadata",
            "isPublished": False,
            "isTopConference": False,
            "isQ1Journal": False,
            "isArxivOnly": True,
            "filterType": "preprint",
        }
        results.append(record)
        log.info("  arXiv-only preprint: %s (%s)", feed_entry["title"][:50], arxiv_id)

    results.sort(key=lambda r: -(int(r["year"]) if str(r["year"]).isdigit() else 0))
    return results


def main():
    parser = argparse.ArgumentParser(description="Fetch publications and save as JSON")
    parser.add_argument("--config", default="config/site-config.js", help="Path to site-config.js")
    args = parser.parse_args()

    cfg = load_config(args.config)
    publications = process_publications(cfg)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    json_str = json.dumps(publications, indent=2, ensure_ascii=False)
    OUTPUT_PATH.write_text(json_str + "\n", encoding="utf-8")

    # Also emit a JS file so the site works when opened via file:// protocol
    js_path = OUTPUT_PATH.with_suffix(".js")
    js_path.write_text(
        f"window.PUBLICATIONS_DATA = {json_str};\n",
        encoding="utf-8",
    )
    log.info("Wrote %d publications to %s (+ .js)", len(publications), OUTPUT_PATH)


if __name__ == "__main__":
    main()
