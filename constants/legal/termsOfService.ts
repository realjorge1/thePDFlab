/**
 * Terms of Service content for Inscribed
 * Structured data extracted from the original legal document.
 */

import type { LegalSection } from "./privacyPolicy";

export const TERMS_OF_SERVICE_LAST_UPDATED = "February 2026";

export const TERMS_OF_SERVICE_TITLE = "Terms of Service";

export const TERMS_OF_SERVICE_SUBTITLE =
  "Freemium · Subscription · AI";

export const TERMS_OF_SERVICE_SECTIONS: LegalSection[] = [
  {
    heading: "1. Acceptance of Terms",
    paragraphs: [
      "By accessing or using Inscribed, you agree to these Terms.",
      "If you do not agree, do not use the app.",
    ],
  },
  {
    heading: "2. Description of Service",
    paragraphs: ["Inscribed provides:"],
    bullets: [
      "Document viewing and editing",
      "Conversion tools",
      "File encryption and annotation",
      "AI-powered assistance",
      "Legal open-source content access",
      "Premium subscription features",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: [
          "Some features are free. Premium features require payment.",
        ],
      },
    ],
  },
  {
    heading: "3. Subscriptions and Payments",
    paragraphs: ["Premium features may require payment."],
    bullets: [
      "Fees are displayed before purchase.",
      "Subscriptions may auto-renew unless cancelled.",
      "Refund policies follow platform rules (Google Play / Apple App Store).",
      "We reserve the right to change pricing with notice.",
      "Failure to pay may result in feature restriction.",
    ],
  },
  {
    heading: "4. User Responsibilities",
    paragraphs: ["You agree not to:"],
    bullets: [
      "Upload illegal content",
      "Infringe copyrights",
      "Reverse engineer the app",
      "Abuse AI systems",
      "Attempt unauthorized access",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: ["You are solely responsible for your files."],
      },
    ],
  },
  {
    heading: "5. AI Disclaimer",
    paragraphs: ["AI responses:"],
    bullets: [
      "May contain inaccuracies",
      "Are not professional advice",
      "Should be independently verified",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: [
          "We are not liable for decisions made based on AI output.",
        ],
      },
    ],
  },
  {
    heading: "6. Intellectual Property",
    subsections: [
      {
        heading: "Your Content",
        paragraphs: [
          "You retain ownership of your documents.",
          "You grant us limited rights to process content solely to provide services.",
        ],
      },
      {
        heading: "Our Content",
        paragraphs: [
          "All software, branding, and intellectual property belong to Inscribed.",
        ],
      },
    ],
  },
  {
    heading: "7. File Encryption and Passwords",
    paragraphs: ["If you encrypt files:"],
    bullets: [
      "You are responsible for password management.",
      "We cannot recover lost passwords.",
    ],
  },
  {
    heading: "8. Limitation of Liability",
    paragraphs: [
      "To the maximum extent permitted by law, we are not liable for:",
    ],
    bullets: [
      "Data loss",
      "Service interruptions",
      "AI inaccuracies",
      "Indirect damages",
    ],
    subsections: [
      {
        heading: "",
        paragraphs: ["Use of the app is at your own risk."],
      },
    ],
  },
  {
    heading: "9. Termination",
    paragraphs: ["We may suspend or terminate access if:"],
    bullets: [
      "You violate these Terms",
      "Fraud or abuse is detected",
      "Legal compliance requires it",
    ],
  },
  {
    heading: "10. Governing Law",
    paragraphs: [
      "These Terms are governed by applicable law in the jurisdiction where the service operates.",
      "Disputes shall be resolved in that jurisdiction.",
    ],
  },
  {
    heading: "11. Changes to Terms",
    paragraphs: [
      "We may update these Terms at any time.",
      "Continued use after updates constitutes acceptance.",
    ],
  },
  {
    heading: "12. Contact",
    paragraphs: ["Inscribed\nFacebook: facebook.com/the-inscribedsoftware"],
  },
];
