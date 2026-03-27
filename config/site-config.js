window.SITE_CONFIG = Object.freeze({
  analytics: {
    measurementId: "G-73151SSBC1"
  },
  publications: {
    orcid: "0000-0002-1944-2875",
    excludedTitles: [
      "AISec",
      "Cybersecurity and AI: The PRALab Research Experience",
      "ALOHA",
      "CoEvolution"
    ],
    // Match is done against publication venue text (case-insensitive partial match).
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
    // Optional manual exclusions to avoid false positives (example: "ICMLC").
    topConferenceExcludedVenues: [
      "ICMLC"
    ],
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
      "Computers & Security",
    ],
    // Optional canonicalization map: key is incoming venue text, value is preferred display name.
    journalNameOverrides: {
      "ieee tifs": "IEEE Transactions on Information Forensics and Security",
      "international conference on representation learning": "International Conference on Learning Representations (ICLR)",
      "international conference on learning representations": "International Conference on Learning Representations (ICLR)"
    }
  },
  projects: {
    cordisUrls: [
      "https://cordis.europa.eu/project/id/101168560",
      "https://cordis.europa.eu/project/id/101120393",
      "https://cordis.europa.eu/project/id/101070617",
      "https://cordis.europa.eu/project/id/952647",
      "https://cordis.europa.eu/project/id/780788"
    ]
    // Optional future format:
    // items: [
    //   { source: "cordis", funding: "eu", url: "https://cordis.europa.eu/project/id/..." },
    //   { source: "manual", funding: "other", title: "Project title", description: "Short description", url: "https://...", fundingLabel: "Funded by ..." }
    // ]
  },
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
        "role": "teaching_assistant",
        "url": "https://unica.coursecatalogue.cineca.it/corsi/2025/11205/insegnamenti/2026/21423/2025/9999?schemaid=5194"
      }
    ]
  }
});
