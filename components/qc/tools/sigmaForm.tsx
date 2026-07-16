/**
 * Shared TEa/Bias/CV input form used by the Six Sigma, Normalized OPSpecs
 * and QC Grid calculators. Validation mirrors the engine's guards so the
 * engine never throws in normal use.
 */
import { QCNumberField } from "@/components/qc/QCWidgets";
import { parseDecimal } from "@/components/qc/qcFormat";
import type { SigmaInputs } from "@/utils/qcCalculators";
import React, { useCallback, useState } from "react";

export type SigmaFormValues = { tea: string; bias: string; cv: string };
type SigmaFormErrors = Partial<Record<keyof SigmaFormValues, string>>;

const EMPTY: SigmaFormValues = { tea: "", bias: "", cv: "" };

export function useSigmaForm() {
  const [values, setValues] = useState<SigmaFormValues>(EMPTY);
  const [errors, setErrors] = useState<SigmaFormErrors>({});

  const setValue = useCallback((field: keyof SigmaFormValues, text: string) => {
    setValues((prev) => ({ ...prev, [field]: text }));
  }, []);

  /** Validate the given values (defaults to current state). Sets field errors. */
  const validate = useCallback(
    (source: SigmaFormValues): SigmaInputs | null => {
      const tea = parseDecimal(source.tea);
      const bias = parseDecimal(source.bias);
      const cv = parseDecimal(source.cv);
      const next: SigmaFormErrors = {};
      if (tea === null || tea <= 0) next.tea = "TEa must be greater than 0.";
      if (bias === null) next.bias = "Enter a valid bias (may be negative).";
      if (cv === null || cv <= 0) next.cv = "CV must be greater than 0.";
      setErrors(next);
      if (next.tea || next.bias || next.cv) return null;
      return { tea: tea as number, bias: bias as number, cv: cv as number };
    },
    [],
  );

  const reset = useCallback(() => {
    setValues(EMPTY);
    setErrors({});
  }, []);

  const restore = useCallback((saved: Record<string, string>) => {
    setValues({
      tea: saved.tea ?? "",
      bias: saved.bias ?? "",
      cv: saved.cv ?? "",
    });
    setErrors({});
  }, []);

  return { values, setValue, errors, validate, reset, restore };
}

export function SigmaInputFields({
  form,
}: {
  form: ReturnType<typeof useSigmaForm>;
}) {
  return (
    <>
      <QCNumberField
        label="Total allowable error (TEa)"
        value={form.values.tea}
        onChangeText={(text) => form.setValue("tea", text)}
        unit="%"
        placeholder="e.g. 10"
        error={form.errors.tea}
      />
      <QCNumberField
        label="Bias"
        value={form.values.bias}
        onChangeText={(text) => form.setValue("bias", text)}
        unit="%"
        placeholder="e.g. 2 (negative allowed)"
        allowNegative
        error={form.errors.bias}
      />
      <QCNumberField
        label="Coefficient of variation (CV)"
        value={form.values.cv}
        onChangeText={(text) => form.setValue("cv", text)}
        unit="%"
        placeholder="e.g. 1.5"
        error={form.errors.cv}
      />
    </>
  );
}
