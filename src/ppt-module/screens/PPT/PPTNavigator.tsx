// ─────────────────────────────────────────────
//  PPT Module — PPTNavigator
//  Coordinates navigation between all PPT screens.
// ─────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { PPTHomeScreen } from './PPTHomeScreen';
import { PPTCreatorScreen } from './PPTCreatorScreen';
import { PPTOpenEditScreen } from './PPTOpenEditScreen';
import { PPTViewerScreen } from './PPTViewerScreen';
import { PPTPresentation, ThemeId } from '../../types/ppt.types';

type PPTScreen = 'home' | 'create' | 'openEdit' | 'viewer';

interface PPTNavigatorProps {
  onExit?: () => void;
}

export const PPTNavigator: React.FC<PPTNavigatorProps> = ({ onExit }) => {
  const [screen, setScreen] = useState<PPTScreen>('home');
  const [initialThemeId, setInitialThemeId] = useState<ThemeId | undefined>(undefined);
  const [viewerPresentation, setViewerPresentation] =
    useState<PPTPresentation | null>(null);

  const goHome = useCallback(() => setScreen('home'), []);
  const goCreate = useCallback((themeId?: ThemeId) => {
    setInitialThemeId(themeId);
    setScreen('create');
  }, []);
  const goOpenEdit = useCallback(() => setScreen('openEdit'), []);
  const goViewer = useCallback((p: PPTPresentation) => {
    setViewerPresentation(p);
    setScreen('viewer');
  }, []);

  return (
    <View style={styles.container}>
      {screen === 'home' && (
        <PPTHomeScreen
          onCreateNew={goCreate}
          onOpenExisting={goOpenEdit}
          onExit={onExit}
        />
      )}

      {screen === 'create' && (
        <PPTCreatorScreen
          onGoBack={goHome}
          initialThemeId={initialThemeId}
        />
      )}

      {screen === 'openEdit' && (
        <PPTOpenEditScreen
          onViewPresentation={goViewer}
          onGoBack={goHome}
        />
      )}

      {screen === 'viewer' && viewerPresentation && (
        <PPTViewerScreen
          presentation={viewerPresentation}
          onClose={goHome}
          onEdit={goOpenEdit}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
});
