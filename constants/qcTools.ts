// ============================================
// FILE: constants/qcTools.ts
// Registry of the Westgard QC calculators.
// Shared by the hub screen, the [tool] route and the saved-runs store.
// ============================================
import type { LucideIcon } from "lucide-react-native";
import {
  Activity,
  ArrowLeftRight,
  ClipboardList,
  Grid3x3,
  Hash,
  Ruler,
  Sigma,
  Target,
  TestTubes,
  TrendingUp,
} from "lucide-react-native";

export type QcToolId =
  | "six-sigma"
  | "opspecs"
  | "replication"
  | "qc-grid"
  | "control-limits"
  | "rr-quantify"
  | "rr-record"
  | "dispersion"
  | "critical-n"
  | "lot-to-lot";

export type QcToolGroup = "method-validation" | "lot-verification";

export const QC_TOOL_GROUP_TITLES: Record<QcToolGroup, string> = {
  "method-validation": "Method Validation Tools",
  "lot-verification": "Reagent Lot Verification",
};

export interface QcToolDefinition {
  id: QcToolId;
  name: string;
  description: string;
  icon: LucideIcon;
  group: QcToolGroup;
  /** Per-tool accent hex — gives each calculator its own visual identity. */
  accent: string;
  /** Short technical descriptor shown as the screen subtitle. */
  tagline: string;
}

/** Display order mirrors the Westgard tool set. */
export const QC_TOOLS: QcToolDefinition[] = [
  {
    id: "six-sigma",
    name: "Six Sigma Calculator",
    description: "Sigma metric from TEa, bias and CV",
    icon: Sigma,
    group: "method-validation",
    accent: "#4F46E5",
    tagline: "Sigma-metric method validation",
  },
  {
    id: "opspecs",
    name: "Normalized OPSpecs Calculator",
    description: "QC rule recommendation for your sigma level",
    icon: Target,
    group: "method-validation",
    accent: "#7C3AED",
    tagline: "Operating specifications & rule selection",
  },
  {
    id: "replication",
    name: "Replication Calculator",
    description: "Imprecision (smeas) from replicate results",
    icon: TestTubes,
    group: "method-validation",
    accent: "#0EA5E9",
    tagline: "Imprecision from a replication study",
  },
  {
    id: "qc-grid",
    name: "Quality Control Grid Calculator",
    description: "Method decision chart with sigma zones",
    icon: Grid3x3,
    group: "method-validation",
    accent: "#0891B2",
    tagline: "Method decision chart (normalized)",
  },
  {
    id: "control-limits",
    name: "Control Limit Calculator",
    description: "Levey-Jennings ±1s/2s/3s limits",
    icon: Activity,
    group: "method-validation",
    accent: "#059669",
    tagline: "Levey-Jennings control limits",
  },
  {
    id: "rr-quantify",
    name: "Reportable Range: Quantifying Errors",
    description: "Regression, %error per level and the usable range",
    icon: TrendingUp,
    group: "method-validation",
    accent: "#DB2777",
    tagline: "Linearity regression & reportable range",
  },
  {
    id: "rr-record",
    name: "Reportable Range: Recording Results",
    description: "Per-level mean, SD and CV of replicates",
    icon: ClipboardList,
    group: "method-validation",
    accent: "#E11D48",
    tagline: "Per-level replicate statistics",
  },
  {
    id: "dispersion",
    name: "Dispersion Calculator",
    description: "n, mean, SD, variance, CV, SEM, range",
    icon: Ruler,
    group: "method-validation",
    accent: "#D97706",
    tagline: "Descriptive & dispersion statistics",
  },
  {
    id: "critical-n",
    name: "Critical Number of Test Samples",
    description: "Samples needed for the SD you must prove",
    icon: Hash,
    group: "method-validation",
    accent: "#65A30D",
    tagline: "Sample size for an SD claim (χ²)",
  },
  {
    id: "lot-to-lot",
    name: "Lot-to-Lot Comparison",
    description: "Verify a new reagent lot against the current lot",
    icon: ArrowLeftRight,
    group: "lot-verification",
    accent: "#0D9488",
    tagline: "Paired reagent lot verification",
  },
];

export function getQcTool(id: string | undefined): QcToolDefinition | null {
  return QC_TOOLS.find((t) => t.id === id) ?? null;
}
