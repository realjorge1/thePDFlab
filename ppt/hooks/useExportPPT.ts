// ─────────────────────────────────────────────
//  PPT Module — useExportPPT Hook
//  Manages export state + triggers generation
// ─────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { PPTPresentation, ExportResult } from '../types/ppt.types';
import { generatePPTX, sharePPTX } from '../services/pptxGenerator.service';

export type ExportStatus = 'idle' | 'generating' | 'success' | 'error';

export function useExportPPT() {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [progress, setProgress] = useState(0);

  const exportPPTX = useCallback(async (presentation: PPTPresentation) => {
    setStatus('generating');
    setProgress(0);
    setResult(null);

    // Simulate progress stages
    const tick = (pct: number) => setProgress(pct);

    try {
      tick(10);
      await new Promise(r => setTimeout(r, 50)); // yield to UI
      tick(30);

      const res = await generatePPTX(presentation);
      tick(90);

      setResult(res);
      setStatus(res.success ? 'success' : 'error');
      tick(100);
      return res;
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      const res: ExportResult = { success: false, error };
      setResult(res);
      setStatus('error');
      return res;
    }
  }, []);

  const shareFile = useCallback(
    async (filePath: string, title: string) => {
      await sharePPTX(filePath, title);
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setProgress(0);
  }, []);

  return { status, result, progress, exportPPTX, shareFile, reset };
}
