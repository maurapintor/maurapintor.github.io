window.SITE_CONFIG = Object.freeze({
  // ── Site identity ────────────────────────────────────────────────────────
  // Used in API request headers (User-Agent) and meta info.
  site: {
    name: "Maura Pintor",
    url: "https://maurapintor.github.io",
    email: "maura.pintor@unica.it"
  },

  // ── Analytics ────────────────────────────────────────────────────────────
  analytics: {
    measurementId: "G-73151SSBC1"
  },

  // ── Publications ─────────────────────────────────────────────────────────
  // Fetched by scripts/fetch_publications.py and displayed in the site.
  publications: {
    // ORCID iD — primary source for the publication list.
    orcid: "0000-0002-1944-2875",
    // arXiv author Atom feed — used to resolve arXiv IDs and discover preprints.
    arxivAuthorFeed: "http://arxiv.org/a/pintor_m_1.atom2",
    // Titles to skip entirely (case-insensitive exact match).
    excludedTitles: [
      "AISec",
      "Cybersecurity and AI: The PRALab Research Experience",
      "ALOHA",
      "CoEvolution"
    ],
    // Venue substrings that mark a paper as "Top Conference" (case-insensitive).
    topConferenceVenues: [
      "NeurIPS",
      "ICML",
      "ICLR",
      "AAAI",
      "IJCAI",
      "ACM CCS",
      "IEEE Symposium on Security and Privacy",
      "USENIX Security"
    ],
    // Venue substrings to exclude from top-conference matching (avoids false positives).
    topConferenceExcludedVenues: [
      "ICMLC"
    ],
    // Venue substrings that mark a journal paper as "Q1 Journal" (case-insensitive).
    q1JournalVenues: [
      "IEEE Transactions on Pattern Analysis and Machine Intelligence",
      "Pattern Recognition",
      "Machine Learning",
      "IEEE Transactions on Information Forensics and Security",
      "Artificial Intelligence",
      "ACM Computing Surveys",
      "Journal of Machine Learning Research",
      "Neural Networks",
      "Journal of Systems and Software",
      "Neurocomputing",
      "Information Sciences",
      "Computers & Security"
    ],
    // Map incoming venue text (lowercase key) → preferred display name.
    journalNameOverrides: {
      "ieee tifs": "IEEE Transactions on Information Forensics and Security",
      "international conference on representation learning": "International Conference on Learning Representations (ICLR)",
      "international conference on learning representations": "International Conference on Learning Representations (ICLR)"
    }
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  projects: {
    cordisUrls: [
      "https://cordis.europa.eu/project/id/101168560",
      "https://cordis.europa.eu/project/id/101120393",
      "https://cordis.europa.eu/project/id/101070617",
      "https://cordis.europa.eu/project/id/952647",
      "https://cordis.europa.eu/project/id/780788"
    ]
  },

  // ── Teaching ─────────────────────────────────────────────────────────────
  teaching: {
    courses: [
      {
        role: "main_teacher",
        url: "https://unica.coursecatalogue.cineca.it/corsi/2025/11199/insegnamenti/2027/21674/2025/2?schemaid=5185"
      },
      {
        role: "teaching_assistant",
        url: "https://unica.coursecatalogue.cineca.it/corsi/2025/11205/insegnamenti/2025/19944/2025/9999?coorte=2025&schemaid=5194"
      },
      {
        role: "teaching_assistant",
        url: "https://unica.coursecatalogue.cineca.it/corsi/2025/11205/insegnamenti/2026/21423/2025/9999?schemaid=5194"
      }
    ]
  }
});
