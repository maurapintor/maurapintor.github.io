const SITE_CONFIG = window.SITE_CONFIG || {};
const PUBLICATIONS_CONFIG = SITE_CONFIG.publications || {};
const PROJECTS_CONFIG = SITE_CONFIG.projects || {};
const TEACHING_CONFIG = SITE_CONFIG.teaching || {};
const PREPRINTS_CONFIG = PUBLICATIONS_CONFIG.preprints || {};
const PUBLISHED_TITLE_KEYS = new Set();
const EXCLUDE_PUBLISHED_FROM_PREPRINTS = Boolean(PREPRINTS_CONFIG.excludeAlreadyPublished);
let PROXY_BACKOFF_UNTIL = 0;

function isProxyBackoffActive() {
    return Date.now() < PROXY_BACKOFF_UNTIL;
}

function activateProxyBackoff(ms = 180000) {
    PROXY_BACKOFF_UNTIL = Math.max(PROXY_BACKOFF_UNTIL, Date.now() + Math.max(1000, Number(ms) || 0));
}

function hasNullOriginContext() {
    return window.location.protocol === 'file:' || window.location.origin === 'null';
}

function buildFetchSources(targetUrl, options = {}) {
    const includeProxy = options.includeProxy !== false;
    const sources = [];
    if (!hasNullOriginContext()) {
        sources.push({ url: targetUrl, isProxy: false, name: 'direct' });
    }
    if (includeProxy) {
        sources.push({ url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, isProxy: true, name: 'corsproxy' });
    }
    return sources;
}

function normalizePublicationTitleKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function loadPapers() {
    const ORCID = PUBLICATIONS_CONFIG.orcid || "0000-0002-1944-2875";
    const worksUrl = `https://pub.orcid.org/v3.0/${ORCID}/works`;
    const PUB_CACHE_KEY = `site_pub_cache_${ORCID}`;


    // Exclude publications by full title or any partial title match (case-insensitive).
    const EXCLUDED_PUBLICATION_TITLES = Array.isArray(PUBLICATIONS_CONFIG.excludedTitles)
        ? PUBLICATIONS_CONFIG.excludedTitles
        : [
            "AISec",
            "Cybersecurity and AI: The PRALab Research Experience",
            "ALOHA",
            "CoEvolution"
        ];
    const TOP_CONFERENCE_VENUES = Array.isArray(PUBLICATIONS_CONFIG.topConferenceVenues)
        ? PUBLICATIONS_CONFIG.topConferenceVenues
        : [
            "NeurIPS",
            "ICML",
            "ICLR",
            "AAAI",
            "IJCAI",
            "ACM CCS",
            "IEEE Symposium on Security and Privacy",
            "USENIX Security"
        ];
    const TOP_CONFERENCE_EXCLUDED_VENUES = Array.isArray(PUBLICATIONS_CONFIG.topConferenceExcludedVenues)
        ? PUBLICATIONS_CONFIG.topConferenceExcludedVenues
        : [
            "ICMLC"
        ];
    const Q1_JOURNAL_VENUES = Array.isArray(PUBLICATIONS_CONFIG.q1JournalVenues)
        ? PUBLICATIONS_CONFIG.q1JournalVenues
        : [
            "IEEE Transactions on Pattern Analysis and Machine Intelligence",
            "Pattern Recognition",
            "Machine Learning",
            "IEEE Transactions on Information Forensics and Security",
            "Artificial Intelligence",
            "ACM Computing Surveys",
            "Journal of Machine Learning Research",
            "Neural Networks",
            "Computers & Security",
            "Information Sciences",
        ];
    const JOURNAL_NAME_OVERRIDES = (PUBLICATIONS_CONFIG.journalNameOverrides && typeof PUBLICATIONS_CONFIG.journalNameOverrides === 'object')
        ? PUBLICATIONS_CONFIG.journalNameOverrides
        : {};

    function normalizeVenueKey(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    const TOP_CONFERENCE_KEYS = TOP_CONFERENCE_VENUES
        .map(normalizeVenueKey)
        .filter(Boolean);
    const TOP_CONFERENCE_EXCLUDED_KEYS = TOP_CONFERENCE_EXCLUDED_VENUES
        .map(normalizeVenueKey)
        .filter(Boolean);
    const Q1_JOURNAL_KEYS = Q1_JOURNAL_VENUES
        .map(normalizeVenueKey)
        .filter(Boolean);
    const JOURNAL_OVERRIDE_MAP = new Map(
        Object.entries(JOURNAL_NAME_OVERRIDES)
            .map(([from, to]) => [normalizeVenueKey(from), cleanSpace(to)])
            .filter(([from, to]) => from && to)
    );

    function normalizeVenueName(value) {
        const input = cleanSpace(value || '').replace(/[\s.;,:]+$/g, '');
        if (!input) return '';

        const directOverride = JOURNAL_OVERRIDE_MAP.get(normalizeVenueKey(input));
        if (directOverride) return directOverride;

        const acronymMap = new Map([
            ['acm', 'ACM'],
            ['aaai', 'AAAI'],
            ['acl', 'ACL'],
            ['iclr', 'ICLR'],
            ['icml', 'ICML'],
            ['ijcai', 'IJCAI'],
            ['ieee', 'IEEE'],
            ['neurips', 'NeurIPS'],
            ['nips', 'NeurIPS'],
            ['cvpr', 'CVPR'],
            ['iccv', 'ICCV'],
            ['eccv', 'ECCV'],
            ['wacv', 'WACV'],
            ['kdd', 'KDD'],
            ['usenix', 'USENIX'],
            ['ml', 'ML'],
            ['ai', 'AI'],
            ['nlp', 'NLP'],
            ['qa', 'QA'],
            ['llm', 'LLM'],
        ]);
        const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'via']);

        let wordIndex = 0;
        const normalized = input
            .split(/(\s+|[-/])/)
            .map((token) => {
                if (/^\s+$|^[-/]$/.test(token)) return token;

                const parts = token.match(/^(["'([{]*)(.*?)(["'\])}.,;:]*)$/);
                const prefix = parts?.[1] || '';
                const core = parts?.[2] || token;
                const suffix = parts?.[3] || '';

                if (!core) return token;

                const lower = core.toLowerCase();
                let nextCore;
                const isUpperToken = /^[A-Z0-9&.]+$/.test(core);
                const upperLetters = core.replace(/[^A-Z]/g, '');
                const isLikelyAcronym = isUpperToken
                    && upperLetters.length > 0
                    && upperLetters.length <= 5
                    && !minorWords.has(lower);

                if (acronymMap.has(lower)) {
                    nextCore = acronymMap.get(lower);
                } else if (isLikelyAcronym) {
                    nextCore = core;
                } else if (wordIndex > 0 && minorWords.has(lower)) {
                    nextCore = lower;
                } else {
                    nextCore = lower.charAt(0).toUpperCase() + lower.slice(1);
                }

                wordIndex += 1;
                return `${prefix}${nextCore}${suffix}`;
            })
            .join('');

        const normalizedOverride = JOURNAL_OVERRIDE_MAP.get(normalizeVenueKey(normalized));
        return normalizedOverride || normalized;
    }

    function matchesVenueList(venue, normalizedList) {
        const venueKey = normalizeVenueKey(venue);
        if (!venueKey || !normalizedList.length) return false;
        return normalizedList.some(item => venueKey.includes(item));
    }

    const crossrefCache = new Map();
    const doiBibtexCache = new Map();
    const orcidDetailCache = new Map();

    function makeSkeletonMarkup(count = 5) {
        return `<div class="skeleton-list">${Array.from({ length: count }).map(() => '<div class="skeleton-item"></div>').join('')}</div>`;
    }

    function savePubCache(items) {
        try {
            localStorage.setItem(PUB_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                items,
            }));
        } catch {
            // Ignore storage failures.
        }
    }

    function loadPubCache() {
        try {
            const raw = localStorage.getItem(PUB_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed?.items)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function getDoiFromExternalIds(externalIds) {
        const ids = externalIds?.['external-id'] || [];
        const doiEntry = ids.find(id => (id['external-id-type'] || '').toLowerCase() === 'doi');
        if (!doiEntry) return null;
        return normalizeDoiValue(doiEntry['external-id-value']);
    }

    function normalizeDoiValue(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        return raw
            .replace(/^doi\s*:\s*/i, '')
            .replace(/^https?:\/\/doi\.org\//i, '')
            .replace(/[\s.]+$/g, '')
            .trim() || null;
    }

    function getBestWorkUrl(externalIds) {
        const ids = externalIds?.['external-id'] || [];
        const withUrl = ids.find(id => id['external-id-url']?.value);
        return withUrl?.['external-id-url']?.value || null;
    }

    function normalizeExternalUrl(rawValue) {
        const raw = String(rawValue || '').trim();
        if (!raw) return '';

        const doiLike = raw.match(/^(?:doi\s*:\s*)?(10\.\d{4,9}\/.+)$/i);
        if (doiLike) {
            return `https://doi.org/${doiLike[1].trim()}`;
        }

        try {
            return new URL(raw).toString();
        } catch {
            try {
                return new URL(`https://${raw.replace(/^\/+/, '')}`).toString();
            } catch {
                return '';
            }
        }
    }

    function normalizeTitleKey(value) {
        return normalizePublicationTitleKey(value);
    }

    function isPreferredPublicationUrl(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            if (host.includes('orcid.org')) return false;
            if (host.includes('cordis.europa.eu')) return false;
            return true;
        } catch {
            return false;
        }
    }

    function isArxivDoi(value) {
        return (value || '').toLowerCase().startsWith('10.48550/arxiv.');
    }

    function isArxivUrl(url) {
        return /arxiv\.org\/(abs|pdf)/i.test(url || '');
    }

    function arxivIdFromDoi(doi) {
        if (!isArxivDoi(doi)) return '';
        return String(doi || '').replace(/^10\.48550\/arxiv\./i, '').trim();
    }

    function choosePublicationUrl({ doi, crossref, externalIds, summary, detail, excludeArxiv = false }) {
        const doiUrl = doi ? `https://doi.org/${doi}` : '';
        const candidates = [
            doiUrl,
            crossref?.crossrefUrl || '',
            getBestWorkUrl(externalIds),
            summary?.url?.value,
            detail?.url?.value,
        ];

        for (const candidate of candidates) {
            const normalized = normalizeExternalUrl(candidate);
            if (!normalized) continue;
            if (excludeArxiv && (isArxivUrl(normalized) || isArxivDoi(doi))) continue;
            if (!isPreferredPublicationUrl(normalized)) continue;
            return normalized;
        }
        return '';
    }

    function chooseArxivUrl({ title, arxivId, doi, externalIds, summary, detail }) {
        const fromDoi = arxivIdFromDoi(doi);
        const canonicalId = arxivId || fromDoi;
        if (canonicalId) {
            return { url: `https://arxiv.org/abs/${canonicalId}`, exact: true };
        }

        const candidates = [
            getBestWorkUrl(externalIds),
            summary?.url?.value,
            detail?.url?.value,
        ];

        for (const candidate of candidates) {
            const normalized = normalizeExternalUrl(candidate);
            if (normalized && isArxivUrl(normalized)) {
                return { url: normalized, exact: true };
            }
        }

        if (title) {
            return {
                url: `https://arxiv.org/search/?query=${encodeURIComponent(title)}&searchtype=title&abstracts=show&order=-announced_date_first&size=50`,
                exact: false,
            };
        }

        return { url: '', exact: false };
    }

    function getExternalIdList(externalIds) {
        return externalIds?.['external-id'] || [];
    }

    function extractArxivIdFromUrl(value) {
        if (!value) return null;
        const raw = String(value).trim();
        const directMatch = raw.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?$/i);
        if (!directMatch?.[1]) return null;
        return parseArxivId(directMatch[1]);
    }

    function parseArxivId(text) {
        if (!text) return null;
        const normalized = String(text).trim().replace(/^arxiv:/i, '').replace(/[.,;\s]+$/g, '');

        if (/^[a-z\-.]+\/[0-9]{7}(?:v\d+)?$/i.test(normalized)) return normalized;
        if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(normalized)) return normalized;

        return extractArxivIdFromUrl(normalized);
    }

    function findArxivId(externalIds, doi, ...candidateUrls) {
        const ids = getExternalIdList(externalIds);

        if (isArxivDoi(doi)) {
            const fromDoi = arxivIdFromDoi(doi);
            if (fromDoi) return fromDoi;
        }

        const arxivField = ids.find(id => (id['external-id-type'] || '').toLowerCase() === 'arxiv');
        if (arxivField?.['external-id-value']) {
            const parsed = parseArxivId(arxivField['external-id-value']);
            if (parsed) return parsed;
        }

        for (const id of ids) {
            const idType = (id['external-id-type'] || '').toLowerCase();
            if (idType === 'doi' && isArxivDoi(id['external-id-value'])) {
                const fromDoi = arxivIdFromDoi(id['external-id-value']);
                if (fromDoi) return fromDoi;
            }

            const parsedFromValue = parseArxivId(id['external-id-value']);
            if (parsedFromValue) return parsedFromValue;
            const parsedFromUrl = extractArxivIdFromUrl(id['external-id-url']?.value);
            if (parsedFromUrl) return parsedFromUrl;
        }

        for (const urlLike of candidateUrls) {
            const parsed = extractArxivIdFromUrl(urlLike);
            if (parsed) return parsed;
        }

        return null;
    }

    function inferYearFromArxivId(arxivId) {
        if (!arxivId) return null;
        const modernMatch = arxivId.match(/^(\d{2})(\d{2})\./);
        if (!modernMatch) return null;

        const yy = Number(modernMatch[1]);
        const currentYY = new Date().getFullYear() % 100;
        const century = yy <= currentYY + 1 ? 2000 : 1900;
        return String(century + yy);
    }

    function isArxivRecord(externalIds, doi, ...texts) {
        const arxivId = findArxivId(externalIds, doi, ...texts);
        if (arxivId) return true;
        if ((doi || '').toLowerCase().startsWith('10.48550/arxiv.')) return true;
        return texts.some(t => /arxiv\.org|\barxiv\b/i.test(t || ''));
    }

    function shorten(text, max = 220) {
        if (!text) return '';
        if (text.length <= max) return text;
        return `${text.slice(0, max).trimEnd()}...`;
    }

    function isMeaningfulVenue(value) {
        const text = cleanSpace(value || '');
        if (!text) return false;
        const lower = text.toLowerCase();
        if (lower === 'venue not specified') return false;
        if (/^https?:\/\//i.test(text)) return false;
        if (/\bonline record\b|\brepository\b|\biris\.unica\.it\b|\borcid\.org\b|\bcrossref\b|\bdoi\.org\b|\bpubmed\b|\bwikipedia\b/i.test(lower)) return false;
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) return false;
        return true;
    }

    function looksInstitutionalSource(value) {
        const text = cleanSpace(value || '');
        if (!text) return false;
        return /universit|university|dipartiment|department|facolt|faculty|istituto|institute|iris\.|repository|archiv|crossref|doi\.org|pubmed|wikidata/i.test(text.toLowerCase());
    }

    async function withTimeout(promise, timeoutMs, fallback) {
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise(resolve => {
                    timer = setTimeout(() => resolve(fallback), timeoutMs);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function mapWithConcurrency(items, limit, mapper) {
        const input = Array.isArray(items) ? items : [];
        const size = Math.max(1, Number(limit) || 1);
        const results = new Array(input.length);
        let cursor = 0;

        const workers = Array.from({ length: Math.min(size, input.length) }, async () => {
            while (true) {
                const index = cursor;
                cursor += 1;
                if (index >= input.length) break;

                try {
                    results[index] = await mapper(input[index], index);
                } catch {
                    results[index] = null;
                }
            }
        });

        await Promise.all(workers);
        return results;
    }

    function normalizeTypeLabel(rawType, venue) {
        const typeMap = {
            'journal-article': 'Journal article',
            'conference-paper': 'Conference paper',
            'book-chapter': 'Chapter contribution',
            'book': 'Book',
            'edited-book': 'Edited book',
            'preprint': 'Preprint',
            'other': 'Research output'
        };

        const baseLabel = typeMap[rawType] || (rawType || 'work').replace(/-/g, ' ');

        if (rawType === 'book-chapter' && /proceedings|conference|acm|ieee|springer lecture notes/i.test(venue || '')) {
            return 'Conference proceedings chapter';
        }

        return baseLabel;
    }

    function shouldExcludePublication(title) {
        const normalizedTitle = (title || '').toLowerCase();
        if (!normalizedTitle) return false;
        return EXCLUDED_PUBLICATION_TITLES
            .map(v => (v || '').toLowerCase().trim())
            .filter(Boolean)
            .some(pattern => normalizedTitle.includes(pattern));
    }

    async function fetchCrossrefMetadata(doi) {
        if (!doi) return null;
        if (crossrefCache.has(doi)) return crossrefCache.get(doi);

        try {
            const crossrefApiUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
            // Crossref enrichment is optional; avoid proxy traffic to reduce rate-limit errors.
            const sources = buildFetchSources(crossrefApiUrl, { includeProxy: false });

            let crData = null;
            for (const source of sources) {
                try {
                    if (source.isProxy && isProxyBackoffActive()) continue;

                    const crRes = await fetch(source.url, {
                        headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' }
                    });
                    if (source.isProxy && crRes.status === 429) {
                        activateProxyBackoff();
                        break;
                    }
                    if (!crRes.ok) break;

                    const payload = await crRes.text();
                    const direct = (() => {
                        try {
                            return JSON.parse(payload);
                        } catch {
                            return null;
                        }
                    })();

                    const extracted = (() => {
                        if (direct) return direct;
                        const start = payload.indexOf('{');
                        const end = payload.lastIndexOf('}');
                        if (start < 0 || end <= start) return null;
                        try {
                            return JSON.parse(payload.slice(start, end + 1));
                        } catch {
                            return null;
                        }
                    })();

                    if (extracted?.message) {
                        crData = extracted;
                        break;
                    }
                } catch {
                    break;
                }
            }

            if (!crData?.message) throw new Error('Crossref fetch failed');
            const msg = crData?.message || {};
            const containerTitle = msg['container-title']?.[0] || null;
            const title = msg.title?.[0] || null;
            const subtitle = msg.subtitle?.[0] || null;
            const publisher = msg.publisher || null;
            const crType = msg.type || null;
            const crossrefUrl = msg.URL || '';
            const authors = Array.isArray(msg.author) ? msg.author : [];
            const volume = msg.volume || null;
            const issue = msg.issue || null;
            const page = msg.page || msg['article-number'] || null;
            const crossrefYear = msg.issued?.['date-parts']?.[0]?.[0]
                || msg.created?.['date-parts']?.[0]?.[0]
                || msg.deposited?.['date-parts']?.[0]?.[0]
                || null;

            const parsed = {
                containerTitle,
                title,
                subtitle,
                publisher,
                crType,
                authors,
                volume,
                issue,
                page,
                crossrefUrl,
                crossrefYear: crossrefYear ? String(crossrefYear) : null
            };
            crossrefCache.set(doi, parsed);
            return parsed;
        } catch {
            crossrefCache.set(doi, null);
            return null;
        }
    }

    async function fetchOrcidWorkDetail(putCode) {
        if (!putCode) return null;
        if (orcidDetailCache.has(putCode)) return orcidDetailCache.get(putCode);

        try {
            const detailUrl = `https://pub.orcid.org/v3.0/${ORCID}/work/${putCode}`;
            const res = await fetch(detailUrl, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error('ORCID detail fetch failed');
            const data = await res.json();
            orcidDetailCache.set(putCode, data);
            return data;
        } catch {
            orcidDetailCache.set(putCode, null);
            return null;
        }
    }

    async function fetchDoiBibtex(doi) {
        if (!doi) return null;
        if (doiBibtexCache.has(doi)) return doiBibtexCache.get(doi);

        function extractBibtexCandidate(payload) {
            const text = String(payload || '').trim();
            if (!text) return null;
            if (text.startsWith('@')) return text;

            const codeBlock = text.match(/```(?:bibtex)?\s*([\s\S]*?@\w+\{[\s\S]*?)```/i);
            if (codeBlock?.[1]) return String(codeBlock[1]).trim();

            const inline = text.match(/(@\w+\{[\s\S]+)/);
            if (inline?.[1]) return String(inline[1]).trim();

            return null;
        }

        try {
            const doiUrl = `https://doi.org/${encodeURIComponent(doi)}`;
            // BibTeX enrichment is optional; avoid proxy traffic to reduce rate-limit errors.
            const sources = buildFetchSources(doiUrl, { includeProxy: false });

            for (const source of sources) {
                try {
                    if (source.isProxy && isProxyBackoffActive()) continue;

                    const doiRes = await fetch(source.url, {
                        headers: {
                            Accept: 'application/x-bibtex; charset=utf-8, text/plain;q=0.9, */*;q=0.5'
                        }
                    });
                    if (source.isProxy && doiRes.status === 429) {
                        activateProxyBackoff();
                        break;
                    }
                    if (!doiRes.ok) break;

                    const payload = await doiRes.text();
                    const parsed = extractBibtexCandidate(payload);
                    if (parsed) {
                        doiBibtexCache.set(doi, parsed);
                        return parsed;
                    }
                } catch {
                    break;
                }
            }

            doiBibtexCache.set(doi, null);
            return null;
        } catch {
            doiBibtexCache.set(doi, null);
            return null;
        }
    }

    function extractBibtexField(citationText, fieldName) {
        const text = String(citationText || '');
        if (!text) return '';
        const pattern = new RegExp(`(?:^|\\n|,)\\s*${fieldName}\\s*=\\s*(\\{[^{}]*\\}|\"[^\"]*\")`, 'i');
        const match = text.match(pattern);
        if (!match?.[1]) return '';
        const raw = match[1].trim();
        const unwrapped = raw.startsWith('{') || raw.startsWith('"') ? raw.slice(1, -1) : raw;
        return cleanSpace(unwrapped.replace(/\\[{}]/g, ''));
    }

    function getVenueFromOrcidCitation(detail) {
        const citation = detail?.citation;
        const type = String(citation?.['citation-type'] || '').toLowerCase();
        const value = citation?.['citation-value'] || '';
        if (!value || type !== 'bibtex') return '';

        const journal = extractBibtexField(value, 'journal');
        if (isMeaningfulVenue(journal)) return journal;

        const booktitle = extractBibtexField(value, 'booktitle');
        if (isMeaningfulVenue(booktitle)) return booktitle;

        return '';
    }

    function getBibtexFromOrcidCitation(detail) {
        const citation = detail?.citation;
        const type = String(citation?.['citation-type'] || '').toLowerCase();
        const value = String(citation?.['citation-value'] || '').trim();
        if (!value || type !== 'bibtex' || !value.startsWith('@')) return '';
        return value;
    }

    function bibtexHasMatchingDoi(bibtex, doi) {
        const target = normalizeDoiValue(doi || '');
        if (!bibtex || !target) return false;
        const found = normalizeDoiValue(extractBibtexField(bibtex, 'doi') || '');
        return Boolean(found && found.toLowerCase() === target.toLowerCase());
    }

    function bibtexHasMatchingTitle(bibtex, title) {
        if (!bibtex || !title) return false;
        const bibTitle = normalizeTitleKey(extractBibtexField(bibtex, 'title') || '');
        const targetTitle = normalizeTitleKey(title || '');
        if (!bibTitle || !targetTitle) return false;
        return bibTitle === targetTitle;
    }

    function bibtexEscape(value) {
        return (value || '')
            .replace(/\\/g, '\\\\')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/"/g, '\\"');
    }

    function makeBibtexKey(title, year, primaryAuthor) {
        const authorPart = (primaryAuthor || 'pintor')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
            .slice(0, 12);
        const titlePart = (title || 'work')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
            .slice(0, 20);
        return `${authorPart || 'pintor'}${year || 'nd'}${titlePart || 'work'}`;
    }

    function crossrefEntryType(crType, rawType) {
        const crossrefMap = {
            'journal-article': 'article',
            'proceedings-article': 'inproceedings',
            'proceedings': 'proceedings',
            'book-chapter': 'incollection',
            'book-section': 'incollection',
            'book': 'book',
            'reference-entry': 'incollection',
            'posted-content': 'misc',
            'preprint': 'misc',
        };
        if (crType && crossrefMap[crType]) return crossrefMap[crType];

        if (rawType === 'journal-article') return 'article';
        if (rawType === 'conference-paper') return 'inproceedings';
        if (rawType === 'book-chapter') return 'incollection';
        if (rawType === 'book' || rawType === 'edited-book') return 'book';
        return 'misc';
    }

    function formatBibtexAuthor(author) {
        const family = cleanSpace(author?.family || '');
        const given = cleanSpace(author?.given || '');
        const name = cleanSpace(author?.name || '');
        if (family && given) return `${family}, ${given}`;
        if (family) return family;
        if (name) return name;
        return '';
    }

    function normalizeBibtexPages(value) {
        const raw = cleanSpace(value || '');
        if (!raw) return '';
        return raw.replace(/\s*[\u2013\u2014]\s*/g, '--').replace(/\s*-\s*/g, '--');
    }

    function generateBibtex({ title, year, venue, doi, rawType, url, crossref }) {
        const entryType = crossrefEntryType(crossref?.crType, rawType);
        const authorList = (crossref?.authors || [])
            .map(formatBibtexAuthor)
            .filter(Boolean);
        const firstAuthorFamily = cleanSpace(crossref?.authors?.[0]?.family || '');
        const bestTitle = cleanSpace(crossref?.title || title || 'Untitled work');
        const bestYear = cleanSpace(crossref?.crossrefYear || year || 'n.d.');
        const bestVenue = cleanSpace(crossref?.containerTitle || venue || '');
        const key = makeBibtexKey(bestTitle, bestYear, firstAuthorFamily || 'pintor');
        const fields = [
            `  title = {${bibtexEscape(bestTitle)}}`,
            `  author = {${bibtexEscape(authorList.length ? authorList.join(' and ') : 'Pintor, Maura and others')}}`,
            `  year = {${bibtexEscape(bestYear)}}`
        ];

        if (bestVenue) {
            if (entryType === 'article') fields.push(`  journal = {${bibtexEscape(bestVenue)}}`);
            if (entryType === 'inproceedings' || entryType === 'incollection' || entryType === 'proceedings') fields.push(`  booktitle = {${bibtexEscape(bestVenue)}}`);
            if (entryType === 'misc') fields.push(`  howpublished = {${bibtexEscape(bestVenue)}}`);
        }
        if (crossref?.publisher && entryType !== 'article') fields.push(`  publisher = {${bibtexEscape(crossref.publisher)}}`);
        if (crossref?.volume) fields.push(`  volume = {${bibtexEscape(String(crossref.volume))}}`);
        if (crossref?.issue) fields.push(`  number = {${bibtexEscape(String(crossref.issue))}}`);
        if (crossref?.page) fields.push(`  pages = {${bibtexEscape(normalizeBibtexPages(crossref.page))}}`);
        if (doi) fields.push(`  doi = {${bibtexEscape(doi)}}`);
        if (url || crossref?.crossrefUrl) fields.push(`  url = {${bibtexEscape(url || crossref.crossrefUrl)}}`);

        return `@${entryType}{${key},\n${fields.join(',\n')}\n}`;
    }

    function attachCopyHandlers() {
        const bubbles = document.querySelectorAll('.copy-bibtex');
        bubbles.forEach(bubble => {
            bubble.addEventListener('click', async () => {
                const isEncoded = bubble.dataset.encoded === 'true';
                const raw = bubble.dataset.copy;
                const valueToCopy = isEncoded ? decodeURIComponent(raw || '') : (raw || '');
                if (!valueToCopy) return;

                const original = bubble.textContent;
                try {
                    await navigator.clipboard.writeText(valueToCopy);
                    bubble.textContent = bubble.dataset.success || 'Copied';
                } catch {
                    bubble.textContent = 'Copy failed';
                }

                setTimeout(() => {
                    bubble.textContent = original;
                }, 1200);
            });
        });
    }

    function getFilterType(rawType) {
        if (rawType === 'journal-article') return 'journal';
        if (rawType === 'conference-paper') return 'conference';
        if (rawType === 'preprint') return 'preprint';
        return 'other';
    }





    function setActiveFilterButton(filterValue) {
        const buttons = document.querySelectorAll('#pubFilters .pub-filter');
        buttons.forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.filter === filterValue);
        });
    }

    try {
        const res = await fetch(worksUrl, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error('Could not load ORCID works');

        const data = await res.json();

        const list = document.getElementById('papers');
        const summaryEl = document.getElementById('pubSummary');
        list.innerHTML = makeSkeletonMarkup(6);
        list.classList.remove('pub-loading', 'pub-error');
        summaryEl.textContent = '';

        const summaries = (data.group || [])
            .map(group => group['work-summary']?.[0])
            .filter(Boolean);

        if (!summaries.length) {
            list.innerHTML = "No publications found on ORCID.";
            list.classList.add('pub-error');
            return;
        }

        const bestByTitle = new Map();

        let renderedCount = 0;
        const cacheItems = [];

        const upsertRecord = (record) => {
            const prev = bestByTitle.get(record.titleKey);
            if (!prev) {
                bestByTitle.set(record.titleKey, record);
                return;
            }

            const betterPriority = record.priority > prev.priority;
            const betterYear = record.priority === prev.priority && record.year > prev.year;
            if (betterPriority || betterYear) {
                bestByTitle.set(record.titleKey, record);
            }
        };

        const candidateRecords = await mapWithConcurrency(summaries, 6, async (summary) => {
            const title = summary.title?.title?.value || 'Untitled work';
            if (shouldExcludePublication(title)) {
                return null;
            }
            const rawType = summary.type || 'work';
            const externalIds = summary['external-ids'];
            const doi = getDoiFromExternalIds(externalIds);
            const putCode = summary['put-code'];
            const summaryJournal = cleanSpace(summary?.['journal-title']?.value || '');
            const summarySource = cleanSpace(summary?.source?.['source-name']?.value || '');
            const allowSourceAsVenue = rawType !== 'journal-article' && !looksInstitutionalSource(summarySource);
            const initialVenue = isMeaningfulVenue(summaryJournal)
                ? summaryJournal
                : (allowSourceAsVenue && isMeaningfulVenue(summarySource) ? summarySource : '');
            const needsVenueEnrichment = !isMeaningfulVenue(initialVenue);
            const needsYearEnrichment = !summary['publication-date']?.year?.value;

            const doiBibtexPromise = doi
                ? withTimeout(fetchDoiBibtex(doi), 1300, null)
                : Promise.resolve(null);
            const crossrefPromise = doi && (needsVenueEnrichment || needsYearEnrichment)
                ? withTimeout(fetchCrossrefMetadata(doi), 1300, null)
                : Promise.resolve(null);

            const [doiBibtex, initialCrossref] = await Promise.all([doiBibtexPromise, crossrefPromise]);
            const crossref = initialCrossref || ((doi && !doiBibtex)
                ? await withTimeout(fetchCrossrefMetadata(doi), 1300, null)
                : null);

            const publicationUrlCandidate = summary?.url?.value || '';
            const arxivId = findArxivId(
                externalIds,
                doi,
                publicationUrlCandidate,
                summary?.url?.value,
                getBestWorkUrl(externalIds)
            );
            const year = summary['publication-date']?.year?.value
                || crossref?.crossrefYear
                || inferYearFromArxivId(arxivId)
                || 'n.d.';

            let venue = initialVenue || '';

            if (rawType === 'journal-article' && isMeaningfulVenue(crossref?.containerTitle)) {
                venue = crossref.containerTitle;
            }

            if (!isMeaningfulVenue(venue) && isMeaningfulVenue(crossref?.containerTitle)) {
                venue = crossref.containerTitle;
            }
            if (!isMeaningfulVenue(venue) && isMeaningfulVenue(crossref?.publisher)) {
                venue = crossref.publisher;
            }

            let detail = null;
            const needDetailForVenue = !isMeaningfulVenue(venue) && Boolean(putCode);
            if (needDetailForVenue) {
                detail = await withTimeout(fetchOrcidWorkDetail(putCode), 1200, null);
                const bibtexVenue = getVenueFromOrcidCitation(detail);
                if (isMeaningfulVenue(bibtexVenue)) {
                    venue = bibtexVenue;
                }
            }

            if (!isMeaningfulVenue(venue)) {
                venue = rawType === 'conference-paper'
                    ? 'Conference proceedings (venue not listed in ORCID)'
                    : 'Repository record';
            }

            venue = normalizeVenueName(venue);

            const nonArxivPublicationUrl = choosePublicationUrl({ doi, crossref, externalIds, summary, detail: null, excludeArxiv: true });
            const arxivRef = chooseArxivUrl({ title, arxivId, doi, externalIds, summary, detail: null });
            const arxivUrl = arxivRef.url;

            const publicationUrl = nonArxivPublicationUrl || arxivUrl;

            const isArxiv = isArxivRecord(externalIds, doi, publicationUrl, arxivUrl, title, venue);
            const hasNonArxivDoi = Boolean(doi && !doi.toLowerCase().startsWith('10.48550/arxiv.'));
            const publishedTypes = ['journal-article', 'conference-paper', 'book-chapter', 'book', 'edited-book'];
            const hasPublishedType = publishedTypes.includes(rawType);
            const isPublished = hasNonArxivDoi || hasPublishedType;
            const isArxivUnpublished = isArxiv && !isPublished;
            const genericVenue = !isMeaningfulVenue(venue) || /repository record|online record/i.test(venue);

            const isArxivOnly = isArxiv && !hasNonArxivDoi && !hasPublishedType && genericVenue;
            const effectiveType = (rawType === 'preprint' || isArxivOnly) ? 'preprint' : rawType;
            const type = normalizeTypeLabel(effectiveType, venue);
            const filterType = getFilterType(effectiveType);
            const isTopConference = effectiveType === 'conference-paper'
                && matchesVenueList(venue, TOP_CONFERENCE_KEYS)
                && !matchesVenueList(venue, TOP_CONFERENCE_EXCLUDED_KEYS);
            const isQ1Journal = effectiveType === 'journal-article' && matchesVenueList(venue, Q1_JOURNAL_KEYS);
            const isArxivPreprint = arxivRef.exact === true;

            if (isArxivOnly && !isMeaningfulVenue(venue)) {
                venue = 'arXiv preprint';
            }

            if (isArxivOnly && /repository record/i.test(venue)) {
                venue = 'arXiv preprint';
            }

            if (!detail && putCode && !doiBibtex) {
                detail = await withTimeout(fetchOrcidWorkDetail(putCode), 1200, null);
            }
            const verifiedDoiBibtex = bibtexHasMatchingDoi(doiBibtex, doi) ? doiBibtex : '';

            const orcidBibtexRaw = getBibtexFromOrcidCitation(detail);
            const orcidHasDoiMatch = bibtexHasMatchingDoi(orcidBibtexRaw, doi);
            const orcidHasTitleMatch = bibtexHasMatchingTitle(orcidBibtexRaw, title);
            const verifiedOrcidBibtex = (orcidHasDoiMatch || orcidHasTitleMatch) ? orcidBibtexRaw : '';

            const providedBibtex = verifiedDoiBibtex || verifiedOrcidBibtex;
            const bibtex = providedBibtex || generateBibtex({
                title,
                year,
                venue,
                doi,
                rawType: effectiveType,
                url: nonArxivPublicationUrl || arxivUrl || publicationUrl,
                crossref,
            });
            const bibtexSource = verifiedDoiBibtex
                ? 'Guaranteed match (DOI)'
                : (verifiedOrcidBibtex ? 'Guaranteed match (ORCID)' : 'Reconstructed from metadata');
            const encodedBibtex = bibtex ? encodeURIComponent(bibtex) : '';

            const li = document.createElement('div');
            li.className = 'pub-item';
            li.innerHTML = `
                <div class="pub-head">
                    <div class="pub-title">${title}</div>
                    <div class="pub-badges">
                        ${isTopConference ? '<span class="pub-badge pub-badge-top">Top Conference</span>' : ''}
                        ${isQ1Journal ? '<span class="pub-badge pub-badge-q1">Q1 Journal</span>' : ''}
                        ${isArxivPreprint ? '<span class="pub-badge pub-badge-preprint">arXiv Preprint</span>' : ''}
                    </div>
                </div>
                <div class="pub-meta">${year} • ${venue} • ${type}</div>
                <div class="pub-url-row">
                    ${(isPublished && nonArxivPublicationUrl) ? `<a class="action-pill" href="${nonArxivPublicationUrl}" target="_blank" rel="noopener noreferrer">Open publication</a>` : ''}
                    ${arxivUrl ? `<a class="action-pill" href="${arxivUrl}" target="_blank" rel="noopener noreferrer">${arxivRef.exact ? 'Open arXiv' : 'Find on arXiv'}</a>` : ''}
                    ${encodedBibtex ? `<button class="action-pill copy-bibtex" data-copy="${encodedBibtex}" data-encoded="true" data-success="Copied BibTeX" title="Click to copy BibTeX">Copy BibTeX</button>` : ''}
                    ${encodedBibtex ? `<span class="pub-note">${bibtexSource}</span>` : ''}
                </div>
            `;
            return {
                element: li,
                year: Number.parseInt(year, 10) || 0,
                filterType,
                isArxivPreprint,
                isArxivUnpublished,
                isTopConference,
                isQ1Journal,
                titleKey: normalizeTitleKey(title),
                priority: isPublished ? 3 : (effectiveType === 'preprint' ? 2 : 1),
            };
        });

        candidateRecords.filter(Boolean).forEach(upsertRecord);


        const toRecords = () => {
            cacheItems.length = 0;
            return Array.from(bestByTitle.values()).map(record => {
                cacheItems.push({
                    html: record.element.outerHTML,
                    year: record.year || 0,
                    filterType: record.filterType || 'other',
                    isArxivPreprint: Boolean(record.isArxivPreprint),
                    isArxivUnpublished: Boolean(record.isArxivUnpublished),
                    isTopConference: Boolean(record.isTopConference),
                    isQ1Journal: Boolean(record.isQ1Journal),
                });
                return {
                    element: record.element,
                    year: record.year || 0,
                    filterType: record.filterType || 'other',
                    isArxivPreprint: Boolean(record.isArxivPreprint),
                    isArxivUnpublished: Boolean(record.isArxivUnpublished),
                    isTopConference: Boolean(record.isTopConference),
                    isQ1Journal: Boolean(record.isQ1Journal),
                };
            });
        };

        const state = {
            filter: 'all',
            sort: document.getElementById('pubSort').value || 'newest',
            items: [],
        };

        renderedCount = state.items.length;

        const formatDate = () => {
            try {
                return new Intl.DateTimeFormat('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }).format(new Date());
            } catch {
                return new Date().toISOString().slice(0, 10);
            }
        };

        const renderList = () => {
            const visible = state.items
                .filter(item => {
                    if (state.filter === 'all') return true;
                    if (state.filter === 'preprint') return Boolean(item.isArxivUnpublished);
                    if (state.filter === 'top-conference') return Boolean(item.isTopConference);
                    if (state.filter === 'q1-journal') return Boolean(item.isQ1Journal);
                    return item.filterType === state.filter;
                })
                .sort((a, b) => state.sort === 'oldest' ? (a.year - b.year) : (b.year - a.year));

            list.innerHTML = '';
            list.classList.remove('pub-error');

            if (!visible.length) {
                list.classList.add('pub-error');
                list.textContent = 'No publications match the current filters.';
            } else {
                visible.forEach(item => list.appendChild(item.element));
            }

            const suffix = '';
            summaryEl.textContent = `Updated from ORCID on ${formatDate()} • ${visible.length}/${state.items.length} shown${suffix}`;
        };

        document.querySelectorAll('#pubFilters .pub-filter').forEach(button => {
            button.addEventListener('click', () => {
                state.filter = button.dataset.filter || 'all';
                setActiveFilterButton(state.filter);
                renderList();
            });
        });

        document.getElementById('pubSort').addEventListener('change', (event) => {
            state.sort = event.target.value || 'newest';
            renderList();
        });



        state.items = toRecords();
        renderedCount = state.items.length;
        PUBLISHED_TITLE_KEYS.clear();
        state.items.forEach(item => {
            if (item.filterType === 'preprint') return;
            const title = item.element?.querySelector('.pub-title')?.textContent || '';
            const key = normalizePublicationTitleKey(title);
            if (key) PUBLISHED_TITLE_KEYS.add(key);
        });

        setActiveFilterButton(state.filter);
        renderList();
        savePubCache(cacheItems);
        attachCopyHandlers();


    } catch (e) {
        const el = document.getElementById('papers');
        const summary = document.getElementById('pubSummary');
        const cached = loadPubCache();
        if (cached?.items?.length) {
            const records = cached.items.map(item => {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = item.html;
                return {
                    element: wrapper.firstElementChild,
                    year: item.year || 0,
                    filterType: item.filterType || 'other',
                    isArxivPreprint: Boolean(item.isArxivPreprint),
                    isArxivUnpublished: Boolean(item.isArxivUnpublished),
                    isTopConference: Boolean(item.isTopConference),
                    isQ1Journal: Boolean(item.isQ1Journal),
                };
            }).filter(item => item.element);

            PUBLISHED_TITLE_KEYS.clear();
            records.forEach(item => {
                if (item.filterType === 'preprint') return;
                const title = item.element?.querySelector('.pub-title')?.textContent || '';
                const key = normalizePublicationTitleKey(title);
                if (key) PUBLISHED_TITLE_KEYS.add(key);
            });

            el.innerHTML = '';
            records.sort((a, b) => b.year - a.year).forEach(item => el.appendChild(item.element));
            el.classList.remove('pub-loading', 'pub-error');
            summary.textContent = `Showing cached publications • Last sync ${new Date(cached.savedAt || Date.now()).toLocaleDateString('en-GB')}`;
            attachCopyHandlers();
            return;
        }

        el.innerHTML = "Could not load publications.";
        el.classList.remove('pub-loading');
        el.classList.add('pub-error');
        summary.textContent = '';
    }
}

const papersLoadPromise = loadPapers();

function xmlNodesByLocalName(root, localName) {
    const nsNodes = Array.from(root.getElementsByTagNameNS('*', localName));
    if (nsNodes.length) return nsNodes;
    return Array.from(root.getElementsByTagName(localName));
}

function firstXmlNodeText(root, localName) {
    const node = xmlNodesByLocalName(root, localName)[0];
    return cleanSpace(node?.textContent || '');
}

function firstXmlNodeAttr(root, localName, attrName, predicate) {
    const nodes = xmlNodesByLocalName(root, localName);
    const found = predicate
        ? nodes.find(predicate)
        : nodes[0];
    return cleanSpace(found?.getAttribute(attrName) || '');
}

function extractArxivEntryId(absUrl) {
    const match = String(absUrl || '').match(/\/abs\/([^?#\s]+)/i);
    return cleanSpace(match?.[1] || '');
}

function formatDateLabel(value) {
    const raw = cleanSpace(value || '');
    if (!raw) return 'Date unavailable';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(dt);
}

function extractFeedXml(payload) {
    const raw = String(payload || '').trim();
    if (!raw) return '';

    // Try simple extraction first
    const xmlIdx = raw.indexOf('<?xml');
    const feedIdx = raw.indexOf('<feed');
    const start = xmlIdx >= 0 ? xmlIdx : feedIdx;
    if (start >= 0) return raw.slice(start).trim();

    // Fallback: look for feed tag anywhere, even if wrapped in HTML
    const feedMatch = raw.match(/<feed[^>]*>[\s\S]*<\/feed>/i);
    if (feedMatch) return feedMatch[0];

    // Final fallback: look for entry tags
    const entriesMatch = raw.match(/<entry[^>]*>[\s\S]*<\/entry>/i);
    if (entriesMatch) {
        const wrapped = `<feed xmlns="http://www.w3.org/2005/Atom">${raw.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi)?.join('') || ''}</feed>`;
        return wrapped;
    }

    return '';
}

function parseArxivFeed(xmlPayload, maxItems) {
    const xmlText = extractFeedXml(xmlPayload);
    if (!xmlText) {
        console.debug('[arXiv] No XML feed found in payload');
        return [];
    }

    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
        console.debug('[arXiv] XML parse error:', doc.querySelector('parsererror')?.textContent);
        return [];
    }

    const entries = xmlNodesByLocalName(doc, 'entry');
    console.debug(`[arXiv] Found ${entries.length} entries in XML feed`);

    return entries.slice(0, Math.max(1, maxItems)).map((entry) => {
        const title = firstXmlNodeText(entry, 'title');
        const absUrl = firstXmlNodeText(entry, 'id')
            || firstXmlNodeAttr(entry, 'link', 'href', (node) => (node.getAttribute('rel') || '').toLowerCase() === 'alternate')
            || '';
        const pdfUrl = firstXmlNodeAttr(entry, 'link', 'href', (node) => {
            const href = node.getAttribute('href') || '';
            const titleAttr = (node.getAttribute('title') || '').toLowerCase();
            const typeAttr = (node.getAttribute('type') || '').toLowerCase();
            return titleAttr === 'pdf' || typeAttr === 'application/pdf' || /\/pdf\//i.test(href);
        });
        const published = firstXmlNodeText(entry, 'published') || firstXmlNodeText(entry, 'updated');
        const category = firstXmlNodeAttr(entry, 'primary_category', 'term') || firstXmlNodeAttr(entry, 'category', 'term');

        return {
            title: title || 'Untitled preprint',
            absUrl,
            pdfUrl,
            arxivId: extractArxivEntryId(absUrl),
            published,
            category,
        };
    }).filter(item => item.absUrl || item.title);
}

function inferPublishedFromArxivId(arxivId) {
    const id = cleanSpace(arxivId || '').replace(/^arxiv:/i, '').replace(/v\d+$/i, '');
    const m = id.match(/^(\d{2})(\d{2})\./);
    if (!m) return '';

    const yy = Number(m[1]);
    const mm = Math.min(12, Math.max(1, Number(m[2])));
    const currentYY = new Date().getFullYear() % 100;
    const fullYear = yy <= currentYY + 1 ? (2000 + yy) : (1900 + yy);
    return `${fullYear}-${String(mm).padStart(2, '0')}-01`;
}

function parseArxivAuthorMarkdown(markdownPayload, maxItems) {
    const raw = String(markdownPayload || '');
    if (!raw) {
        console.debug('[arXiv] Empty markdown payload');
        return [];
    }

    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const items = [];

    const pushItem = (seed, titleParts) => {
        if (!seed?.arxivId || !seed?.absUrl) return;
        const title = cleanSpace(titleParts.join(' ').replace(/\s+/g, ' ')) || `arXiv:${seed.arxivId}`;
        items.push({
            title,
            absUrl: seed.absUrl,
            pdfUrl: seed.pdfUrl || '',
            arxivId: seed.arxivId,
            published: inferPublishedFromArxivId(seed.arxivId),
            category: '',
        });
    };

    for (let i = 0; i < lines.length && items.length < Math.max(1, maxItems); i += 1) {
        const line = lines[i];

        // Try pattern 1: [number] [arXiv:ID](url)
        let itemMatch = line.match(/^\s*\[\d+\]\s+\[arXiv:([^\]]+)\]\((https?:\/\/(?:www\.)?arxiv\.org\/abs\/[^\s)]+)/i);

        // Try pattern 2: plain arXiv ID in text like "2301.12345"
        if (!itemMatch) {
            itemMatch = line.match(/(?:^|\s)(arxiv[:\s]*)?(\d{4}\.\d{4,5}(?:v\d+)?)\s/i);
            if (itemMatch?.[2]) {
                const arxivId = itemMatch[2];
                // Construct URLs for this ID
                const absUrl = `https://arxiv.org/abs/${arxivId}`;
                const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

                let titleParts = [];
                // Try to extract title from nearby lines
                for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++) {
                    const candidate = lines[j].trim();
                    if (candidate && !/^\[|\barxiv\b/i.test(candidate) && candidate.length > 10) {
                        titleParts.push(candidate);
                    }
                }
                pushItem({ arxivId, absUrl, pdfUrl }, titleParts.length ? titleParts : [arxivId]);
                continue;
            }
        }

        if (!itemMatch) continue;

        const arxivId = cleanSpace(itemMatch[1] || '');
        const absUrl = cleanSpace(itemMatch[2] || '');
        const pdfUrl = cleanSpace((line.match(/\[pdf\]\((https?:\/\/arxiv\.org\/pdf\/[^\s)]+)/i) || [])[1] || '');

        let j = i + 1;
        while (j < lines.length && !/^\s*Title\s*:/i.test(lines[j])) {
            if (/^\s*\[\d+\]\s+\[arXiv:/i.test(lines[j])) break;
            j += 1;
        }

        const titleParts = [];
        if (j < lines.length && /^\s*Title\s*:/i.test(lines[j])) {
            titleParts.push(lines[j].replace(/^\s*Title\s*:\s*/i, '').trim());
            j += 1;
            while (j < lines.length) {
                const next = lines[j].trim();
                if (!next) break;
                if (/^(Comments|Subjects|Authors)\s*:/i.test(next)) break;
                if (/^\[\d+\]\s+\[arXiv:/i.test(next)) break;
                titleParts.push(next);
                j += 1;
            }
        }

        pushItem({ arxivId, absUrl, pdfUrl }, titleParts);
    }

    console.debug(`[arXiv] Parsed ${items.length} items from markdown`);
    return items;
}

function parseArxivPayload(payload, maxItems) {
    const parsedFeed = parseArxivFeed(payload, maxItems);
    if (parsedFeed.length) {
        console.debug(`[arXiv] Using Atom feed: ${parsedFeed.length} entries`);
        return parsedFeed;
    }
    console.debug('[arXiv] Atom feed empty, trying markdown fallback');
    const parsedMarkdown = parseArxivAuthorMarkdown(payload, maxItems);
    if (parsedMarkdown.length) {
        console.debug(`[arXiv] Using markdown fallback: ${parsedMarkdown.length} entries`);
    }
    return parsedMarkdown;
}

function parseDblpPayload(payload) {
    const text = String(payload || '').trim();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

function normalizeDblpEes(eeField) {
    if (!eeField) return [];
    if (Array.isArray(eeField)) return eeField.map(v => cleanSpace(v)).filter(Boolean);
    return [cleanSpace(eeField)].filter(Boolean);
}

function parseDblpPreprints(payload, maxItems) {
    const parsed = parseDblpPayload(payload);
    const hits = parsed?.result?.hits?.hit;
    const list = Array.isArray(hits) ? hits : (hits ? [hits] : []);
    const out = [];

    for (const hit of list) {
        if (out.length >= Math.max(1, maxItems)) break;
        const info = hit?.info || {};
        const ees = normalizeDblpEes(info.ee);
        const absUrl = ees.find(url => /arxiv\.org\/abs\//i.test(url)) || '';
        if (!absUrl) continue;

        const arxivId = extractArxivEntryId(absUrl);
        const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : (ees.find(url => /arxiv\.org\/pdf\//i.test(url)) || '');
        const year = cleanSpace(info.year || '');
        out.push({
            title: cleanSpace(info.title || 'Untitled preprint'),
            absUrl,
            pdfUrl,
            arxivId,
            published: year ? `${year}-01-01` : '',
            category: cleanSpace(info.venue || ''),
        });
    }

    return out;
}

async function loadDblpPreprintsByOrcid(orcid, maxItems) {
    const dblpUrl = `https://dblp.org/search/publ/api?q=orcid:${encodeURIComponent(orcid)}&h=${Math.max(10, Math.min(200, maxItems * 5))}&format=json`;
    const sources = buildFetchSources(dblpUrl);

    for (const source of sources) {
        try {
            if (source.isProxy && isProxyBackoffActive()) continue;

            const res = await fetch(source.url, {
                headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' }
            });

            if (source.isProxy && res.status === 429) {
                activateProxyBackoff();
                break;
            }
            if (!res.ok) break;

            const payload = await res.text();
            const items = parseDblpPreprints(payload, maxItems);
            if (items.length) {
                console.debug(`[arXiv] DBLP fallback returned ${items.length} arXiv-linked preprints via ${source.name}`);
                return items;
            }
        } catch {
            break;
        }
    }

    return [];
}

function dedupePreprintsAgainstPublished(items) {
    if (!EXCLUDE_PUBLISHED_FROM_PREPRINTS) return items || [];
    return (items || []).filter(item => {
        const key = normalizePublicationTitleKey(item?.title || '');
        if (!key) return false;
        return !PUBLISHED_TITLE_KEYS.has(key);
    });
}

async function loadArxivPapersIntoList() {
    // Merge arXiv papers into main publications list
    const maxItems = Math.max(1, Number(PREPRINTS_CONFIG.maxItems) || 20);

    try {
        await papersLoadPromise.catch(() => null);
        let parsedEntries = [];
        const orcid = cleanSpace(PUBLICATIONS_CONFIG.orcid || '0000-0002-1944-2875');
        const feedUrl = `https://arxiv.org/a/${orcid}.atom2`;
        console.debug(`[arXiv] Loader start: orcid=${orcid}, maxItems=${maxItems}, origin=${window.location.origin || 'null'}`);
        console.debug(`[arXiv] Trying ORCID atom feed: ${feedUrl}`);

        if (hasNullOriginContext()) {
            console.warn('[arXiv] origin is null/file://, skipping direct feed fetch to avoid CORS noise');
        }
        const fetchStrategies = buildFetchSources(feedUrl);

        let payload = '';
        let strategy = '';

        for (const strat of fetchStrategies) {
            try {
                if (strat.isProxy && isProxyBackoffActive()) {
                    console.debug('[arXiv] Proxy backoff active, skipping proxy attempt');
                    continue;
                }
                console.debug(`[arXiv] Fetch attempt via ${strat.name}: ${strat.url}`);
                const res = await fetch(strat.url);
                console.debug(`[arXiv] Response via ${strat.name}: status=${res.status}, ok=${res.ok}`);
                if (strat.isProxy && res.status === 429) {
                    console.warn('[arXiv] Proxy rate limited (429), activating backoff');
                    activateProxyBackoff();
                    break;
                }
                if (!res.ok) break;

                const text = await res.text();
                const trimmed = text?.trim() || '';
                console.debug(`[arXiv] Payload via ${strat.name}: chars=${trimmed.length}`);
                if (!trimmed) break;

                payload = trimmed;
                strategy = strat.name;
                break;
            } catch (err) {
                console.warn(`[arXiv] Fetch error via ${strat.name}: ${err?.message || err}`);
                break;
            }
        }

        if (!payload) {
            console.warn('[arXiv] ORCID atom feed fetch failed: all strategies failed');
            return;
        }

        console.debug(`[arXiv] Parsing payload from strategy=${strategy}`);
        parsedEntries = parseArxivPayload(payload, maxItems);
        console.debug(`[arXiv] Parsed entries count=${parsedEntries.length}`);
        if (parsedEntries.length) {
            const preview = parsedEntries.slice(0, 3).map(item => item.title).join(' | ');
            console.debug(`[arXiv] Successfully found ${parsedEntries.length} papers via ORCID feed (${strategy})`);
            console.debug(`[arXiv] Top titles: ${preview}`);
        }

        if (!parsedEntries.length) {
            console.warn('[arXiv] No arXiv papers found from feed, trying DBLP fallback');
            parsedEntries = await loadDblpPreprintsByOrcid(orcid, maxItems);
            if (!parsedEntries.length) {
                console.warn('[arXiv] No preprints found from arXiv feed or DBLP fallback');
                return;
            }
        }

        // Deduplicate against published papers
        const beforeDedupe = parsedEntries.length;
        parsedEntries = dedupePreprintsAgainstPublished(parsedEntries);
        console.debug(`[arXiv] Deduped preprints: before=${beforeDedupe}, after=${parsedEntries.length}, publishedTitleKeys=${PUBLISHED_TITLE_KEYS.size}`);

        if (!parsedEntries.length) {
            console.warn('[arXiv] All arXiv papers already in published list');
            return;
        }

        // Add arXiv papers to the main papers list
        const papersList = document.getElementById('papers');
        if (!papersList) {
            console.warn('[arXiv] #papers container not found');
            return;
        }

        parsedEntries.forEach(item => {
            const card = document.createElement('div');
            card.className = 'pub-item';
            card.dataset.filter = 'preprint';
            card.dataset.year = item.published?.substring(0, 4) || '0000';

            const dateLabel = formatDateLabel(item.published);
            const metaBits = [dateLabel];
            if (item.arxivId) metaBits.push(`arXiv:${item.arxivId}`);
            if (item.category) metaBits.push(item.category);

            card.innerHTML = `
                <div class="pub-head">
                    <div class="pub-title">${item.title}</div>
                    <div class="pub-badges">
                        <span class="pub-badge pub-badge-preprint">arXiv Preprint</span>
                    </div>
                </div>
                <div class="pub-meta">${metaBits.join(' • ')}</div>
                <div class="pub-url-row">
                    ${item.absUrl ? `<a class="action-pill" href="${item.absUrl}" target="_blank" rel="noopener noreferrer">Open arXiv</a>` : ''}
                    ${item.pdfUrl ? `<a class="action-pill" href="${item.pdfUrl}" target="_blank" rel="noopener noreferrer">PDF</a>` : ''}
                </div>
            `;

            papersList.appendChild(card);
        });

        console.debug(`[arXiv] Added ${parsedEntries.length} arXiv papers to publications list`);
    } catch (err) {
        console.error('[arXiv] Error loading arXiv papers for main list:', err);
    }
}

// Start loading arXiv papers after main papers are loaded
papersLoadPromise.then(() => {
    setTimeout(loadArxivPapersIntoList, 100);
}).catch(() => {
    setTimeout(loadArxivPapersIntoList, 100);
});

// Add your CORDIS project pages here (one URL per string).
const CORDIS_PROJECT_URLS = Array.isArray(PROJECTS_CONFIG.cordisUrls)
    ? PROJECTS_CONFIG.cordisUrls
    : [
        "https://cordis.europa.eu/project/id/101168560",
        "https://cordis.europa.eu/project/id/101120393",
        "https://cordis.europa.eu/project/id/101070617",
        "https://cordis.europa.eu/project/id/952647",
        "https://cordis.europa.eu/project/id/780788"
    ];
const EU_PROJECT_LOGO_SRC = 'assets/images/eu-flag.jpg';

function normalizeProjectEntries() {
    if (Array.isArray(PROJECTS_CONFIG.items)) {
        return PROJECTS_CONFIG.items.map((item, index) => {
            if (typeof item === 'string') {
                return { source: 'cordis', url: item, funding: 'eu', id: `project-${index}` };
            }

            return {
                source: item?.source || (item?.url && /cordis\.europa\.eu/i.test(item.url) ? 'cordis' : 'manual'),
                funding: item?.funding || (item?.url && /cordis\.europa\.eu/i.test(item.url) ? 'eu' : 'other'),
                ...item,
                id: item?.id || `project-${index}`,
            };
        });
    }

    return CORDIS_PROJECT_URLS.map((url, index) => ({
        id: `cordis-${index}`,
        source: 'cordis',
        funding: 'eu',
        url,
    }));
}

function parseCordisProjectId(url) {
    const match = (url || '').match(/\/project\/id\/(\d+)/i);
    return match ? match[1] : '';
}

function cleanSpace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeAcronym(value) {
    return cleanSpace(value).replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '');
}

function normalizeProjectTitle(value) {
    return cleanSpace(value).replace(/[\s.]+$/g, '');
}

function toSmartTitleCase(value) {
    const raw = cleanSpace(value);
    if (!raw) return '';

    const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);

    return raw
        .toLowerCase()
        .split(/(\s+|-|\/)/)
        .map((token, index) => {
            if (/^\s+$|^[-\/]$/.test(token)) return token;
            if (/^[ivxlcdm]+$/i.test(token) && token.length <= 5) return token.toUpperCase();
            if (/^[a-z]*\d+[a-z\d]*$/i.test(token)) return token.toUpperCase();
            if (token.length <= 2 && /^[a-z]+$/i.test(token) && token === token.toLowerCase() && !minorWords.has(token)) return token.toUpperCase();
            if (index !== 0 && minorWords.has(token)) return token;
            return token.charAt(0).toUpperCase() + token.slice(1);
        })
        .join('');
}

function pickMatch(text, regexes, group = 1) {
    for (const regex of regexes) {
        const m = text.match(regex);
        if (m?.[group]) return cleanSpace(m[group]);
    }
    return '';
}

function getJsonLdRecords(doc) {
    if (!doc) return [];
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    const records = [];
    for (const script of scripts) {
        const payload = script.textContent || '';
        if (!payload.trim()) continue;
        try {
            const parsed = JSON.parse(payload);
            if (Array.isArray(parsed)) {
                records.push(...parsed);
            } else {
                records.push(parsed);
            }
        } catch {
            // Ignore malformed JSON-LD blocks.
        }
    }
    return records.filter(r => r && typeof r === 'object');
}

function deriveProjectType(text, programmeCode, programmeName) {
    const source = `${text}\n${programmeCode}\n${programmeName}`.toUpperCase();
    if (/\bH2020\b|HORIZON 2020/.test(source)) return 'Horizon 2020';
    if (/\bHORIZON[-\s]?EU(?:ROPE)?\b|\bHEU\b/.test(source)) return 'Horizon Europe';
    if (/\bFP7\b/.test(source)) return 'FP7';
    if (/\bFP6\b/.test(source)) return 'FP6';
    if (/\bFP5\b/.test(source)) return 'FP5';
    return 'EU Research Programme';
}

function extractCordisProgrammeInfo(text) {
    const programmeBullet = text.match(/(?:^|\n)\s*\*\s*([A-Z0-9][A-Z0-9.\-]{3,})\s*-\s*([^\n]+)/i);
    if (programmeBullet?.[1]) {
        return {
            programmeCode: cleanSpace(programmeBullet[1]),
            programme: cleanSpace(`${programmeBullet[1]} - ${programmeBullet[2] || ''}`),
        };
    }

    const programmeId = text.match(/programme\/id\/([A-Z0-9_\-.]+)/i);
    if (programmeId?.[1]) {
        return {
            programmeCode: cleanSpace(programmeId[1]),
            programme: cleanSpace(programmeId[1]),
        };
    }

    const fundedUnder = pickMatch(text, [
        /Funded under[\s\S]{0,260}?\n\s*([A-Z0-9.\-]{4,}\s*-\s*[^\n]+)/i
    ]);
    if (fundedUnder) {
        const code = pickMatch(fundedUnder, [/^([A-Z0-9.\-]{4,})\s*-/i]);
        return {
            programmeCode: code,
            programme: fundedUnder,
        };
    }

    return {
        programmeCode: '',
        programme: '',
    };
}

function extractCordisCallId(text) {
    function normalizeCallId(value) {
        const decoded = (() => {
            try {
                return decodeURIComponent(value || '');
            } catch {
                return value || '';
            }
        })();
        return cleanSpace(decoded)
            .replace(/[)\].,;:]+$/g, '')
            .toUpperCase();
    }

    function isLikelyCallId(value) {
        const id = normalizeCallId(value);
        if (!id) return false;
        if (id === 'PROJECT' || id === 'CALL') return false;
        // CORDIS call IDs are usually hyphenated and include digits.
        if (!/-/.test(id) || !/\d/.test(id)) return false;
        return /^(H2020|HORIZON|ERC|MSCA|DIGITAL|CERV|EU)[A-Z0-9\-]+$/.test(id);
    }

    const fromIdentifier = pickMatch(text, [
        /call\/identifier=%27([^%']+)%27/i,
        /call\/identifier=([^&\s]+)/i
    ]);
    if (isLikelyCallId(fromIdentifier)) return normalizeCallId(fromIdentifier);

    const fromLabel = pickMatch(text, [
        /\(opens in new window\)\s*([A-Z0-9\-]{8,})/,
        /(?:^|\n)\s*Topic\(s\)\s*[:\-]?\s*([A-Z0-9\-]{8,})/,
        /\b((?:H2020|HORIZON)[A-Z0-9\-]{8,})\b/
    ]);
    return isLikelyCallId(fromLabel) ? normalizeCallId(fromLabel) : '';
}

function extractCordisData(content, url) {
    const isHtml = /<html|<head|<body|<meta|<h1/i.test(content);
    const doc = isHtml ? new DOMParser().parseFromString(content, 'text/html') : null;
    const jsonLdRecords = getJsonLdRecords(doc);

    const textSource = isHtml
        ? (doc.body && doc.body.innerText ? doc.body.innerText : (doc.documentElement && doc.documentElement.textContent ? doc.documentElement.textContent : ''))
        : content;
    const text = String(textSource || '').replace(/\r\n/g, '\n');

    const ogTitle = isHtml ? cleanSpace(
        (doc.querySelector('meta[property="og:title"]') && doc.querySelector('meta[property="og:title"]').getAttribute('content'))
        || ''
    ) : '';

    const pageTitle = isHtml ? cleanSpace(
        (doc.querySelector('h1') && doc.querySelector('h1').textContent)
        || ogTitle
        || ''
    ) : '';

    const rawTitle = pageTitle || pickMatch(text, [
        /^Title:\s*(.+)$/mi,
        /^#\s*([^\n|]+)(?:\||$)/m
    ]) || `CORDIS Project ${parseCordisProjectId(url)}`;

    const objective = cleanSpace(
        (isHtml ? (doc.querySelector('meta[name="description"]') && doc.querySelector('meta[name="description"]').getAttribute('content')) : '')
        || pickMatch(text, [
            /##\s*Objective\s*\n+([\s\S]{80,2400}?)(?=\n##\s|\n###\s|$)/i,
            /Objective\s*[:\-]\s*([^\n]{20,600})/i
        ])
    );

    const acronymFromJsonLd = normalizeAcronym(
        jsonLdRecords.map(r => r.acronym || r.identifier || '').find(Boolean) || ''
    );

    const acronymFromOgTitle = pickMatch(ogTitle, [
        /\|\s*([^|]{2,40})\s*\|\s*Project\s*\|/i
    ]);

    const acronymFromText = pickMatch(text, [
        /Project short name\s*[:\-]?\s*([^\n|]{2,60})/i,
        /Project acronym\s*[:\-]?\s*([^\n|]{2,60})/i,
        /\|\s*([A-Z][A-Z0-9\-]{1,30})\s*\|\s*Project\s*\|/i,
        /Acronym\s*[:\-]?\s*([^\n|]{2,40})/i,
        /^#\s*[^\n|]+\|\s*([^\n|]{2,40})\s*\|\s*Project\s*\|/mi
    ]);
    const acronymFromPageTitle = pickMatch(pageTitle, [
        /\|\s*([^|]{2,40})\s*\|\s*Project\s*\|/i
    ]);
    const acronym = normalizeAcronym(acronymFromJsonLd || acronymFromOgTitle || acronymFromText || acronymFromPageTitle);

    const programmeInfo = extractCordisProgrammeInfo(text);
    const programmeCode = programmeInfo.programmeCode;
    const programme = programmeInfo.programme;

    const startDate = pickMatch(text, [
        /Start date\s*[:\-]?\s*([^\n]{3,40})/i
    ]);
    const endDate = pickMatch(text, [
        /End date\s*[:\-]?\s*([^\n]{3,40})/i
    ]);

    const projectType = deriveProjectType(text, programmeCode, programme);
    const callId = extractCordisCallId(text);

    const title = normalizeProjectTitle(toSmartTitleCase(rawTitle));
    return {
        title,
        objective,
        acronym,
        programme,
        programmeCode,
        projectType,
        callId,
        startDate,
        endDate,
        url,
        funding: 'eu',
        fundingLabel: 'Funded by the European Union',
        fundingLogoSrc: EU_PROJECT_LOGO_SRC,
    };
}

function getProjectFundingInfo(project, entry) {
    const normalizedFunding = String(entry?.funding || project?.funding || '').trim().toLowerCase();
    const isEuFunding = normalizedFunding === 'eu' || normalizedFunding === 'european-union' || project?.funding === 'eu';

    if (isEuFunding) {
        return {
            label: entry?.fundingLabel || project?.fundingLabel || 'Funded by the European Union',
            logoSrc: entry?.fundingLogoSrc || project?.fundingLogoSrc || EU_PROJECT_LOGO_SRC,
            theme: 'eu',
        };
    }

    if (entry?.fundingLabel || entry?.fundingLogoSrc) {
        return {
            label: entry.fundingLabel || 'Funded project',
            logoSrc: entry.fundingLogoSrc || '',
            theme: 'generic',
        };
    }

    return null;
}

function makeProjectCard(project, entry, errorMessage) {
    const card = document.createElement('div');
    card.className = 'project-item';

    const fundingInfo = getProjectFundingInfo(project, entry);
    if (fundingInfo) {
        const fundingBlock = document.createElement('div');
        fundingBlock.className = `project-funding project-funding--${fundingInfo.theme}`;

        if (fundingInfo.logoSrc) {
            const logo = document.createElement('img');
            logo.className = 'project-funding__logo';
            logo.src = fundingInfo.logoSrc;
            logo.alt = fundingInfo.theme === 'eu' ? 'European Union flag' : 'Project funding logo';
            fundingBlock.appendChild(logo);
        }

        const copy = document.createElement('div');
        copy.className = 'project-funding__copy';

        const eyebrow = document.createElement('div');
        eyebrow.className = 'project-funding__eyebrow';
        eyebrow.textContent = fundingInfo.theme === 'eu' ? 'EU Project' : 'Funded Project';
        copy.appendChild(eyebrow);

        const label = document.createElement('div');
        label.className = 'project-funding__label';
        label.textContent = fundingInfo.label;
        copy.appendChild(label);

        fundingBlock.appendChild(copy);
        card.appendChild(fundingBlock);
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'project-title';
    const hasAcronymInTitle = project.acronym && new RegExp(`\\b${project.acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(project.title || '');
    const titleWithAcronym = (project.acronym && !hasAcronymInTitle)
        ? `${project.title} (${project.acronym})`
        : project.title;
    titleEl.textContent = errorMessage ? 'Could not load CORDIS project details' : titleWithAcronym;
    card.appendChild(titleEl);

    const linkMeta = document.createElement('div');
    linkMeta.className = 'project-meta';
    const link = document.createElement('a');
    link.href = project.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'CORDIS page';
    linkMeta.appendChild(link);
    card.appendChild(linkMeta);

    const details = document.createElement('div');
    details.className = 'project-meta';
    const bits = [];
    if (project.projectType) bits.push(project.projectType);
    if (project.acronym) bits.push(`Short name: ${project.acronym}`);
    if (project.callId) bits.push(`Call: ${project.callId}`);
    if (project.programme) {
        bits.push(project.programme);
    } else if (project.programmeCode) {
        bits.push(project.programmeCode);
    }
    if (project.startDate || project.endDate) bits.push(`${project.startDate || '?'} - ${project.endDate || '?'}`);
    details.textContent = bits.join(' | ');
    if (bits.length) card.appendChild(details);

    const desc = document.createElement('p');
    desc.className = 'project-desc';
    desc.textContent = errorMessage || project.objective || 'Objective not available from CORDIS metadata.';
    card.appendChild(desc);

    return card;
}

function makeManualProjectCard(entry) {
    const project = {
        title: cleanSpace(entry?.title || 'Project'),
        objective: cleanSpace(entry?.description || entry?.objective || ''),
        acronym: cleanSpace(entry?.acronym || ''),
        programme: cleanSpace(entry?.programme || ''),
        programmeCode: cleanSpace(entry?.programmeCode || ''),
        projectType: cleanSpace(entry?.projectType || ''),
        callId: cleanSpace(entry?.callId || ''),
        startDate: cleanSpace(entry?.startDate || ''),
        endDate: cleanSpace(entry?.endDate || ''),
        url: cleanSpace(entry?.url || ''),
        funding: cleanSpace(entry?.funding || ''),
        fundingLabel: cleanSpace(entry?.fundingLabel || ''),
        fundingLogoSrc: cleanSpace(entry?.fundingLogoSrc || ''),
    };

    return makeProjectCard(project, entry, '');
}

async function fetchCordisProject(entry) {
    const normalized = /^https?:\/\//i.test(entry.url) ? entry.url : `https://${entry.url}`;
    const sources = buildFetchSources(normalized);

    let lastError = '';

    for (const source of sources) {
        try {
            if (source.isProxy && isProxyBackoffActive()) continue;

            const res = await fetch(source.url, {
                headers: { 'Accept': 'text/html, text/plain;q=0.9, */*;q=0.8' }
            });
            if (source.isProxy && res.status === 429) {
                activateProxyBackoff();
                lastError = 'HTTP 429';
                break;
            }
            if (!res.ok) {
                lastError = `HTTP ${res.status}`;
                break;
            }

            const html = await res.text();
            if (!html || html.length < 200) {
                lastError = 'empty response';
                break;
            }

            return makeProjectCard(extractCordisData(html, normalized), { ...entry, url: normalized }, '');
        } catch (err) {
            lastError = err instanceof Error ? err.message : 'network error';
            break;
        }
    }

    return makeProjectCard(
        { url: normalized, funding: entry?.funding, fundingLabel: entry?.fundingLabel, fundingLogoSrc: entry?.fundingLogoSrc },
        entry,
        `Unable to fetch or parse this CORDIS URL (${lastError || 'request failed'}).`
    );
}

async function loadCordisProjects() {
    const list = document.getElementById('projectsList');
    const PROJECT_CACHE_KEY = 'site_projects_cache_v6';

    function makeSkeletonMarkup(count = 4) {
        return `<div class="skeleton-list">${Array.from({ length: count }).map(() => '<div class="skeleton-item"></div>').join('')}</div>`;
    }

    function saveProjectsCache(items) {
        try {
            localStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
        } catch {
            // Ignore storage failures.
        }
    }

    function loadProjectsCache() {
        try {
            const raw = localStorage.getItem(PROJECT_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed?.items)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    list.innerHTML = makeSkeletonMarkup(4);
    list.classList.remove('pub-loading', 'pub-error');

    const entries = normalizeProjectEntries().filter(entry => cleanSpace(entry?.url || entry?.title || ''));
    if (!entries.length) {
        list.classList.add('pub-error');
        list.textContent = 'No projects configured yet. Add entries in config/site-config.js.';
        return;
    }

    try {
        const cards = await Promise.all(entries.map(entry => entry.source === 'cordis' ? fetchCordisProject(entry) : Promise.resolve(makeManualProjectCard(entry))));
        list.innerHTML = '';
        cards.forEach(card => list.appendChild(card));
        saveProjectsCache(cards.map(card => card.outerHTML));
    } catch {
        const cached = loadProjectsCache();
        if (cached?.items?.length) {
            list.innerHTML = '';
            cached.items.forEach(html => {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;
                if (wrapper.firstElementChild) list.appendChild(wrapper.firstElementChild);
            });
            return;
        }

        list.innerHTML = 'Could not load projects.';
        list.classList.add('pub-error');
    }
}

loadCordisProjects();

function formatTeachingRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'teaching_assistant' || normalized === 'assistant' || normalized === 'ta') {
        return 'Teaching Assistant';
    }
    return 'Main Teacher';
}

function matchCourseField(text, regexes, group = 1) {
    for (const regex of regexes) {
        const match = text.match(regex);
        if (match?.[group]) return cleanSpace(match[group]);
    }
    return '';
}

function stripMarkdownValue(value) {
    return cleanSpace(String(value || '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' '));
}

function extractFieldByLabel(text, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexes = [
        new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*\\s*)?${escaped}\\s*:\\s*(?:\\*\\*\\s*)?([^\\n]+)`, 'i'),
        new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([^\\n]+)`, 'i')
    ];

    const raw = matchCourseField(text, regexes);
    return stripMarkdownValue(raw);
}

function extractUnicaHeading(text, doc) {
    const h1Text = stripMarkdownValue(cleanSpace(doc?.querySelector('h1')?.textContent || ''));
    const h1Match = h1Text.match(/\[([^\]]+)\]\s*-\s*(.+)/);
    if (h1Match?.[1] && h1Match?.[2]) {
        return { code: cleanSpace(h1Match[1]), title: cleanSpace(h1Match[2]) };
    }

    const lineMatch = text.match(/\[([^\]]+)\]\s*-\s*([^\n]+)/i);
    if (lineMatch?.[1] && lineMatch?.[2]) {
        return { code: cleanSpace(lineMatch[1]), title: stripMarkdownValue(lineMatch[2]) };
    }

    const mdHeading = matchCourseField(text, [/^#\s*([^\n]+)$/m]);
    const mdHeadingClean = stripMarkdownValue(mdHeading);
    const mdMatch = mdHeadingClean.match(/\[([^\]]+)\]\s*-\s*(.+)/);
    if (mdMatch?.[1] && mdMatch?.[2]) {
        return { code: cleanSpace(mdMatch[1]), title: cleanSpace(mdMatch[2]) };
    }

    const titleTag = stripMarkdownValue(cleanSpace(doc?.querySelector('title')?.textContent || ''));
    if (titleTag) return { code: '', title: titleTag };

    return { code: '', title: '' };
}

function parseUnicaCourseParams(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('insegnamenti');
        if (idx < 0) return null;

        const anno = parts[idx + 1] || parts[1] || parsed.searchParams.get('anno') || '';
        const corsoCod = parts[2] || parsed.searchParams.get('corso_cod') || '';
        // Path shape is usually: /insegnamenti/{aa_offerta}/{cod_af}/{aa_ordinamento}/{af_percorso}
        const insegnamento = parts[idx + 2] || parsed.searchParams.get('insegnamento') || '';
        const ordinamentoFromPath = parts[idx + 3] || '';
        const corsoAaFromPath = parsed.searchParams.get('coorte') || parts[idx + 3] || '';
        const afPercorso = parts[idx + 4] || parsed.searchParams.get('af_percorso') || '';

        const ordinamentoAa = parsed.searchParams.get('annoOrdinamento')
            || parsed.searchParams.get('ordinamento_aa')
            || ordinamentoFromPath;
        const corsoAa = parsed.searchParams.get('coorte')
            || parsed.searchParams.get('corso_aa')
            || corsoAaFromPath
            || anno;
        const schemaId = parsed.searchParams.get('schemaid') || parsed.searchParams.get('schema_id') || '';

        if (!anno || !corsoCod || !insegnamento || !ordinamentoAa || !afPercorso) return null;

        return {
            anno,
            insegnamento,
            ordinamento_aa: ordinamentoAa,
            af_percorso: afPercorso,
            corso_cod: corsoCod,
            corso_aa: corsoAa,
            schema_id: schemaId,
        };
    } catch {
        return null;
    }
}

function toReadableCase(value) {
    const text = cleanSpace(value || '');
    if (!text) return '';
    if (/[a-z]/.test(text)) return text;

    // Keep structured codes as-is, e.g. ING-INF/05.
    if (/^[A-Z0-9]+(?:[-_/][A-Z0-9]+)+$/.test(text) && /\d/.test(text)) return text;

    const minor = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);
    return text
        .toLowerCase()
        .split(/(\s+|-|\/)/)
        .map((token, index) => {
            if (/^\s+$|^[-\/]$/.test(token)) return token;
            if (index !== 0 && minor.has(token)) return token;
            return token.charAt(0).toUpperCase() + token.slice(1);
        })
        .join('');
}

function normalizeHoursValue(value) {
    const text = cleanSpace(value || '');
    if (!text) return '';

    const numeric = text.match(/\d+(?:[.,]\d+)?/);
    if (numeric?.[0]) return numeric[0].replace(',', '.');

    return text
        .replace(/\bore\b/ig, '')
        .replace(/\bhours?\b/ig, '')
        .trim();
}

async function fetchUnicaCourseApi(courseUrl, courseSeed) {
    const params = parseUnicaCourseParams(courseUrl);
    if (!params) return null;

    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value) query.set(key, value);
    });

    const endpoint = `https://unica.coursecatalogue.cineca.it/api/v1/insegnamento?${query.toString()}`;
    const res = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    const title = toReadableCase(data.des_en || courseSeed?.title || 'Course');
    const code = cleanSpace(data.adCod || data.cod || '');
    const degreeCourse = toReadableCase(data.corso_des_en || '');
    const courseType = toReadableCase(data.tipo_corso_des_en || '');
    const durationValue = data?.durata?.totale;
    const duration = Number.isFinite(durationValue) ? String(durationValue) : normalizeHoursValue(data.durata || '');
    const subjectArea = cleanSpace(data.ssd || data.settore || '');

    return {
        title,
        code,
        degreeCourse,
        courseType,
        duration,
        subjectArea,
        role: courseSeed?.role,
        url: courseUrl,
    };
}

function extractUnicaCourseData(content, url, courseSeed) {
    const isHtml = /<html|<head|<body|<meta|<h1/i.test(content);
    const doc = isHtml ? new DOMParser().parseFromString(content, 'text/html') : null;

    const textSource = isHtml
        ? (doc.body && doc.body.innerText ? doc.body.innerText : (doc.documentElement && doc.documentElement.textContent ? doc.documentElement.textContent : ''))
        : content;

    const text = String(textSource || '').replace(/\r\n/g, '\n');

    const heading = extractUnicaHeading(text, doc);

    const title = toReadableCase(heading.title || courseSeed?.title || 'Course');
    const code = cleanSpace(heading.code);
    const degreeCourse = toReadableCase(extractFieldByLabel(text, 'Corso di studi'));
    const courseType = toReadableCase(extractFieldByLabel(text, 'Tipo di corso'));
    const duration = normalizeHoursValue(extractFieldByLabel(text, 'Durata'));
    const subjectArea = extractFieldByLabel(text, 'Settore scientifico disciplinare');

    return {
        title,
        code,
        degreeCourse,
        courseType,
        duration,
        subjectArea,
        role: courseSeed?.role,
        url,
    };
}

async function fetchUnicaCourse(course) {
    const rawUrl = cleanSpace(course?.url || '');
    if (!rawUrl) {
        return {
            data: {
                title: cleanSpace(course?.title || 'Course'),
                role: course?.role,
                url: '',
            },
            error: 'missing-url',
        };
    }

    const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    try {
        const apiData = await fetchUnicaCourseApi(normalized, course);
        if (apiData) {
            return {
                data: apiData,
                error: '',
            };
        }
    } catch {
        // Ignore API failures and continue with scrape fallback.
    }

    const sources = buildFetchSources(normalized);

    let lastError = '';

    for (const source of sources) {
        try {
            if (source.isProxy && isProxyBackoffActive()) continue;

            const res = await fetch(source.url, {
                headers: { 'Accept': 'text/html, text/plain;q=0.9, */*;q=0.8' }
            });

            if (source.isProxy && res.status === 429) {
                activateProxyBackoff();
                lastError = 'HTTP 429';
                break;
            }

            if (!res.ok) {
                lastError = `HTTP ${res.status}`;
                break;
            }

            const payload = await res.text();
            if (!payload || payload.length < 200) {
                lastError = 'empty response';
                break;
            }

            return {
                data: extractUnicaCourseData(payload, normalized, course),
                error: '',
            };
        } catch (err) {
            lastError = err instanceof Error ? err.message : 'network error';
            break;
        }
    }

    return {
        data: {
            title: cleanSpace(course?.title || 'Course'),
            role: course?.role,
            url: normalized,
        },
        error: lastError || 'request failed',
    };
}

function makeTeachingCard(courseData, errorMessage) {
    const card = document.createElement('div');
    card.className = 'project-item';

    const titleEl = document.createElement('div');
    titleEl.className = 'project-title';
    const titleBits = [courseData.title];
    if (courseData.code) titleBits.unshift(`[${courseData.code}]`);
    titleEl.textContent = titleBits.filter(Boolean).join(' ');
    card.appendChild(titleEl);

    const roleMeta = document.createElement('div');
    roleMeta.className = 'project-meta';
    roleMeta.textContent = `Role: ${formatTeachingRole(courseData.role)}`;
    card.appendChild(roleMeta);

    const badgeValues = [
        `Course: ${courseData.degreeCourse || 'Not available'}`,
        `Type: ${courseData.courseType || 'Not available'}`,
        `Hours: ${courseData.duration || 'Not available'}`,
        `Subject area: ${courseData.subjectArea || 'Not available'}`
    ];

    if (badgeValues.length) {
        const badgeRow = document.createElement('div');
        badgeRow.className = 'teaching-badge-row';
        badgeValues.forEach(value => {
            const badge = document.createElement('span');
            badge.className = 'teaching-info-badge';
            badge.textContent = value;
            badgeRow.appendChild(badge);
        });
        card.appendChild(badgeRow);
    }

    const desc = document.createElement('p');
    desc.className = 'project-desc';
    desc.textContent = errorMessage
        ? `Could not fetch full course metadata (${errorMessage}).`
        : (badgeValues.length ? 'Details loaded from UNICA catalogue.' : 'Course details loaded from UNICA catalogue.');
    card.appendChild(desc);

    if (courseData.url) {
        const actions = document.createElement('div');
        actions.className = 'pub-url-row';

        const link = document.createElement('a');
        link.className = 'action-pill';
        link.href = courseData.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Course page';

        actions.appendChild(link);
        card.appendChild(actions);
    }

    return card;
}

async function renderTeachingCourses() {
    const list = document.getElementById('teachingList');
    if (!list) return;

    const courses = Array.isArray(TEACHING_CONFIG.courses)
        ? TEACHING_CONFIG.courses
        : [];

    const configKey = courses
        .map(course => `${cleanSpace(course?.url || '')}|${cleanSpace(course?.role || '')}`)
        .join('||');
    const TEACHING_CACHE_KEY = `site_teaching_cache_v6_${encodeURIComponent(configKey)}`;

    function makeSkeletonMarkup(count = 3) {
        return `<div class="skeleton-list">${Array.from({ length: count }).map(() => '<div class="skeleton-item"></div>').join('')}</div>`;
    }

    function saveTeachingCache(items) {
        try {
            localStorage.setItem(TEACHING_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
        } catch {
            // Ignore storage failures.
        }
    }

    function loadTeachingCache() {
        try {
            const raw = localStorage.getItem(TEACHING_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed?.items)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    list.innerHTML = makeSkeletonMarkup(Math.max(1, courses.length));
    list.classList.remove('pub-loading', 'pub-error');

    if (!courses.length) {
        list.classList.add('pub-error');
        list.textContent = 'No teaching courses configured yet. Add entries with only url and role in config/site-config.js.';
        return;
    }

    try {
        const fetched = await Promise.all(courses.map(fetchUnicaCourse));
        const cards = fetched.map(item => makeTeachingCard(item.data, item.error));
        list.innerHTML = '';
        cards.forEach(card => list.appendChild(card));
        saveTeachingCache(cards.map(card => card.outerHTML));
    } catch {
        const cached = loadTeachingCache();
        if (cached?.items?.length) {
            list.innerHTML = '';
            cached.items.forEach(html => {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;
                if (wrapper.firstElementChild) list.appendChild(wrapper.firstElementChild);
            });
            return;
        }

        list.innerHTML = 'Could not load teaching courses.';
        list.classList.add('pub-error');
    }
}

renderTeachingCourses();
