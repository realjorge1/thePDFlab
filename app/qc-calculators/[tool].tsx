import { QCScreenShell } from "@/components/qc/QCScreenShell";
import { ControlLimitsTool } from "@/components/qc/tools/ControlLimitsTool";
import { CriticalNTool } from "@/components/qc/tools/CriticalNTool";
import { DispersionTool } from "@/components/qc/tools/DispersionTool";
import { LotToLotTool } from "@/components/qc/tools/LotToLotTool";
import { OpSpecsTool } from "@/components/qc/tools/OpSpecsTool";
import { QcGridTool } from "@/components/qc/tools/QcGridTool";
import { ReplicationTool } from "@/components/qc/tools/ReplicationTool";
import { RRQuantifyTool } from "@/components/qc/tools/RRQuantifyTool";
import { RRRecordTool } from "@/components/qc/tools/RRRecordTool";
import { SixSigmaTool } from "@/components/qc/tools/SixSigmaTool";
import { getQcTool } from "@/constants/qcTools";
import { useTheme } from "@/services/ThemeProvider";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Text } from "react-native";

/**
 * Single dynamic route for all QC calculator screens. The tool id selects
 * the calculator component; `pairs` carries the Recording Results →
 * Quantifying Errors handoff (in-memory route param, never touches disk).
 */
export default function QCCalculatorScreen() {
  const { colors: t } = useTheme();
  const params = useLocalSearchParams<{ tool?: string; pairs?: string }>();
  const tool = getQcTool(params.tool);

  if (!tool) {
    return (
      <QCScreenShell title="QC Calculators">
        <Text style={{ color: t.textSecondary, fontSize: 14 }}>
          This calculator does not exist. Go back and pick one from the list.
        </Text>
      </QCScreenShell>
    );
  }

  return (
    <QCScreenShell title={tool.name} subtitle={tool.tagline}>
      {tool.id === "six-sigma" ? <SixSigmaTool /> : null}
      {tool.id === "opspecs" ? <OpSpecsTool /> : null}
      {tool.id === "replication" ? <ReplicationTool /> : null}
      {tool.id === "qc-grid" ? <QcGridTool /> : null}
      {tool.id === "control-limits" ? <ControlLimitsTool /> : null}
      {tool.id === "rr-quantify" ? (
        <RRQuantifyTool initialPairs={params.pairs} />
      ) : null}
      {tool.id === "rr-record" ? <RRRecordTool /> : null}
      {tool.id === "dispersion" ? <DispersionTool /> : null}
      {tool.id === "critical-n" ? <CriticalNTool /> : null}
      {tool.id === "lot-to-lot" ? <LotToLotTool /> : null}
    </QCScreenShell>
  );
}
