/**
 * Privacy Policy content for wordsInscribed
 * Structured data extracted from the original legal document.
 */

export interface LegalSubsection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  subsections?: LegalSubsection[];
}

export const PRIVACY_POLICY_LAST_UPDATED = "February 2026";

export const PRIVACY_POLICY_TITLE = "Privacy Policy";

export const PRIVACY_POLICY_SUBTITLE =
  "Freemium · Payments · AI Processing";

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    heading: "1. Introduction",
    paragraphs: [
      'Welcome to wordsInscribed ("we," "our," or "us").',
      "wordsInscribed is a document management and productivity application that allows users to:",
    ],
    bullets: [
      "View, create, edit, and convert documents",
      "Use AI-powered document assistance",
      "Download legally available open-source materials",
      "Store files locally",
      "Access premium features via subscription",
    ],
    subsections: [
      {
        paragraphs: [
          "We are committed to protecting your privacy and complying with applicable data protection laws including:",
        ],
        heading: "",
        bullets: [
          "GDPR (European Union)",
          "CCPA/CPRA (California)",
          "NDPR (Nigeria)",
          "Other applicable international regulations",
        ],
      },
      {
        heading: "",
        paragraphs: ["By using the app, you agree to this Privacy Policy."],
      },
    ],
  },
  {
    heading: "2. Information We Collect",
    subsections: [
      {
        heading: "2.1 Information We Collect",
        paragraphs: [
          "When you use the app, we may collect:",
        ],
        bullets: [
          "Device type and OS version",
          "App usage data",
          "Crash reports",
          "IP address (for security purposes)",
        ],
      },
      {
        heading: "",
        paragraphs: [
          "Documents you create or upload may be processed locally or temporarily on our servers depending on the feature used.",
        ],
      },
      {
        heading: "2.2 Payment Information",
        paragraphs: ["If you purchase premium features:"],
        bullets: [
          "Payments are processed through third-party payment processors (e.g., Google Play Billing, Apple In-App Purchases, or other processors).",
          "We do not store your full payment card details.",
          "We may store transaction IDs and subscription status for subscription management.",
        ],
      },
      {
        heading: "2.3 Device Permissions",
        paragraphs: [
          "wordsInscribed may request the following device permissions to enable certain features:",
        ],
        bullets: [
          "Camera (android.permission.CAMERA) — the app accesses your device camera to allow you to capture images and create documents (e.g., PDF files) directly from camera photos. Images are used solely to generate the document you request and are not uploaded, stored on our servers, or shared without your explicit action.",
          "Microphone — used for voice transcription features. Audio is processed locally or via a secure third-party service and is not stored beyond the session.",
          "Storage — used to read and save files on your device.",
        ],
      },
      {
        heading: "2.4 Document and File Data",
        paragraphs: ["You may upload, create, edit, or process:"],
        bullets: [
          "PDF files",
          "DOCX files",
          "EPUB files",
          "Text input",
          "Voice transcription data",
        ],
      },
      {
        heading: "",
        paragraphs: [
          "We do not claim ownership of your documents.",
          "Files may be:",
        ],
        bullets: [
          "Stored locally on your device",
          "Processed on secure backend servers",
        ],
      },
      {
        heading: "2.5 AI Processing",
        paragraphs: ["When you use AI features:"],
        bullets: [
          "Submitted content may be securely transmitted to third-party AI providers.",
          "Data is used solely to generate responses.",
          "We do not intentionally use your data to train AI models unless explicitly stated.",
          "AI outputs may be stored temporarily to improve session continuity.",
        ],
      },
    ],
  },
  {
    heading: "3. How We Use Information",
    paragraphs: ["We use your information to:"],
    bullets: [
      "Provide document tools and AI features",
      "Process subscriptions",
      "Improve app performance",
      "Prevent fraud and abuse",
      "Comply with legal obligations",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: ["We do not sell personal data."],
      },
    ],
  },
  {
    heading: "4. Legal Basis for Processing (GDPR Users)",
    paragraphs: ["We process data under:"],
    bullets: [
      "Consent",
      "Contract performance",
      "Legal obligations",
      "Legitimate interests (security, service improvement)",
    ],
  },
  {
    heading: "5. Data Retention",
    paragraphs: ["We retain data:"],
    bullets: [
      "As required for subscription management",
      "As required by law",
    ],
  },
  {
    heading: "6. Data Security",
    paragraphs: ["We implement:"],
    bullets: [
      "HTTPS encryption",
      "Secure backend architecture",
      "Access controls",
      "Industry-standard safeguards",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: ["However, no system is completely secure."],
      },
    ],
  },
  {
    heading: "7. Your Rights",
    paragraphs: ["Depending on jurisdiction, you may:"],
    bullets: [
      "Access your personal data",
      "Correct inaccurate data",
      "Request deletion",
      "Restrict processing",
      "Withdraw consent",
      "Request data portability",
      "Object to certain processing",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: [
          "To exercise your rights, contact us via our Facebook page: facebook.com/the-inscribedsoftware",
        ],
      },
    ],
  },
  {
    heading: "8. Children's Privacy",
    paragraphs: [
      "This app is not intended for children under 13 (or local minimum age).",
      "We do not knowingly collect children's data.",
    ],
  },
  {
    heading: "9. International Transfers",
    paragraphs: [
      "Your data may be processed in countries outside your residence. We ensure appropriate safeguards are in place.",
    ],
  },
  {
    heading: "10. Changes to This Policy",
    paragraphs: [
      "We may update this policy periodically.",
      "Continued use of the app after updates constitutes acceptance.",
    ],
  },
  {
    heading: "11. Contact",
    paragraphs: ["wordsInscribed\nFacebook: facebook.com/the-inscribedsoftware"],
  },
];
