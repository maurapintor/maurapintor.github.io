const SITE_CONFIG = window.SITE_CONFIG || {};
const PROJECTS_CONFIG = SITE_CONFIG.projects || {};
const TEACHING_CONFIG = SITE_CONFIG.teaching || {};
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

async function loadPapers() {
    const DATA_URL = 'assets/data/publications.json';

    function makeSkeletonMarkup(count = 5) {
        return `<div class="skeleton-list">${Array.from({ length: count }).map(() => '<div class="skeleton-item"></div>').join('')}</div>`;
    }

    function setActiveFilterButton(filterValue) {
        const buttons = document.querySelectorAll('#pubFilters .pub-filter');
        buttons.forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.filter === filterValue);
        });
    }

    function attachCopyHandlers() {
        document.querySelectorAll('.copy-bibtex').forEach(bubble => {
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
                setTimeout(() => { bubble.textContent = original; }, 1200);
            });
        });
    }

    function buildPubElement(pub) {
        const el = document.createElement('div');
        el.className = 'pub-item';
        const encodedBibtex = pub.bibtex ? encodeURIComponent(pub.bibtex) : '';
        const isPreprint = pub.filterType === 'preprint' || pub.isArxivOnly;

        let linksHtml = '';
        if (isPreprint) {
            // Preprint: (1) arXiv link  (2) BibTeX
            if (pub.arxivUrl) {
                linksHtml += `<a class="action-pill" href="${pub.arxivUrl}" target="_blank" rel="noopener noreferrer">Open arXiv</a>`;
            }
        } else {
            // Published: (1) publication link  (2) arXiv if available  (3) BibTeX
            if (pub.publicationUrl) {
                linksHtml += `<a class="action-pill" href="${pub.publicationUrl}" target="_blank" rel="noopener noreferrer">Open publication</a>`;
            }
            if (pub.arxivUrl) {
                linksHtml += `<a class="action-pill" href="${pub.arxivUrl}" target="_blank" rel="noopener noreferrer">Open arXiv</a>`;
            }
        }
        if (encodedBibtex) {
            linksHtml += `<button class="action-pill copy-bibtex" data-copy="${encodedBibtex}" data-encoded="true" data-success="Copied BibTeX" title="Click to copy BibTeX">Copy BibTeX</button>`;
        }

        const authorsHtml = (pub.authors || []).map(a => {
            const parts = a.split(',').map(s => s.trim());
            const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : a;
            return name === 'Maura Pintor' ? `<strong>${name}</strong>` : name;
        }).join(', ');

        el.innerHTML = `
            <div class="pub-head">
                <div class="pub-title">${pub.title}</div>
                <div class="pub-badges">
                    ${pub.isTopConference ? '<span class="pub-badge pub-badge-top">Top Conference</span>' : ''}
                    ${pub.isQ1Journal ? '<span class="pub-badge pub-badge-q1">Q1 Journal</span>' : ''}
                    ${pub.arxivUrl ? '<span class="pub-badge pub-badge-preprint">arXiv</span>' : ''}
                </div>
            </div>
            ${authorsHtml ? `<div class="pub-authors">${authorsHtml}</div>` : ''}
            <div class="pub-meta">${pub.year} • ${pub.venue} • ${pub.typeLabel}</div>
            <div class="pub-url-row">${linksHtml}</div>
        `;
        return el;
    }

    const list = document.getElementById('papers');
    const summaryEl = document.getElementById('pubSummary');

    try {
        list.innerHTML = makeSkeletonMarkup(6);
        list.classList.remove('pub-loading', 'pub-error');
        summaryEl.textContent = '';

        let publications;
        if (window.PUBLICATIONS_DATA) {
            publications = window.PUBLICATIONS_DATA;
        } else {
            const resp = await fetch(DATA_URL);
            if (!resp.ok) throw new Error(`Failed to load ${DATA_URL}: ${resp.status}`);
            publications = await resp.json();
        }

        if (!publications.length) {
            list.innerHTML = 'No publications found.';
            list.classList.add('pub-error');
            return;
        }

        const items = publications.map(pub => ({
            pub,
            element: buildPubElement(pub),
            year: Number.parseInt(pub.year, 10) || 0,
            filterType: pub.filterType || 'other',
            isArxivUnpublished: Boolean(pub.isArxivOnly),
            isTopConference: Boolean(pub.isTopConference),
            isQ1Journal: Boolean(pub.isQ1Journal),
        }));

        const state = {
            filter: 'all',
            sort: document.getElementById('pubSort').value || 'newest',
            items,
        };

        const formatDate = () => {
            try {
                return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
            } catch { return new Date().toISOString().slice(0, 10); }
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

            summaryEl.textContent = `Loaded from data • ${formatDate()} • ${visible.length}/${state.items.length} shown`;
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

        setActiveFilterButton(state.filter);
        renderList();
        attachCopyHandlers();

    } catch (e) {
        list.innerHTML = 'Could not load publications.';
        list.classList.remove('pub-loading');
        list.classList.add('pub-error');
        summaryEl.textContent = '';
    }
}

const papersLoadPromise = loadPapers();

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
