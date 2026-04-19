import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSpreadsheetStore } from '../store/spreadsheetStore';
import { CellStyle } from '../types/spreadsheet';

interface ToolbarProps {
  onImport: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface ToolBtnProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  textStyle?: object;
}

const ToolBtn = React.memo<ToolBtnProps>(({ label, active, disabled, onPress, textStyle }) => (
  <TouchableOpacity
    style={[styles.btn, active && styles.btnActive, disabled && styles.btnDisabled]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}
  >
    <Text style={[styles.btnText, active && styles.btnTextActive, textStyle, disabled && styles.btnTextDisabled]}>
      {label}
    </Text>
  </TouchableOpacity>
));
ToolBtn.displayName = 'ToolBtn';

const Sep = () => <View style={styles.sep} />;

const Toolbar: React.FC<ToolbarProps> = ({ onImport, onExport, onUndo, onRedo }) => {
  const {
    selection,
    getCell,
    setCellStyle,
    setRangeStyle,
    history,
    historyIndex,
  } = useSpreadsheetStore();

  const selectedCell = selection ? getCell(selection.cell) : undefined;
  const style: CellStyle = selectedCell?.style ?? {};

  const applyStyle = useCallback(
    (updates: Partial<CellStyle>) => {
      if (!selection) return;
      if (selection.range) setRangeStyle(selection.range, updates);
      else setCellStyle(selection.cell, updates);
    },
    [selection, setCellStyle, setRangeStyle],
  );

  const toggleBold = useCallback(() => applyStyle({ bold: !style.bold }), [applyStyle, style.bold]);
  const toggleItalic = useCallback(() => applyStyle({ italic: !style.italic }), [applyStyle, style.italic]);
  const toggleUnderline = useCallback(() => applyStyle({ underline: !style.underline }), [applyStyle, style.underline]);
  const setAlignLeft = useCallback(() => applyStyle({ align: 'left' }), [applyStyle]);
  const setAlignCenter = useCallback(() => applyStyle({ align: 'center' }), [applyStyle]);
  const setAlignRight = useCallback(() => applyStyle({ align: 'right' }), [applyStyle]);
  const toggleWrap = useCallback(() => applyStyle({ wrap: !style.wrap }), [applyStyle, style.wrap]);

  const increaseFontSize = useCallback(() => {
    const current = style.fontSize ?? 13;
    applyStyle({ fontSize: Math.min(current + 2, 36) });
  }, [applyStyle, style.fontSize]);

  const decreaseFontSize = useCallback(() => {
    const current = style.fontSize ?? 13;
    applyStyle({ fontSize: Math.max(current - 2, 8) });
  }, [applyStyle, style.fontSize]);

  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
      >
        <ToolBtn label="📂" onPress={onImport} />
        <ToolBtn label="💾" onPress={onExport} />

        <Sep />

        <ToolBtn label="↩" onPress={onUndo} disabled={!canUndo} />
        <ToolBtn label="↪" onPress={onRedo} disabled={!canRedo} />

        <Sep />

        <ToolBtn label="B" active={style.bold} onPress={toggleBold} textStyle={styles.boldLabel} />
        <ToolBtn label="I" active={style.italic} onPress={toggleItalic} textStyle={styles.italicLabel} />
        <ToolBtn label="U" active={style.underline} onPress={toggleUnderline} textStyle={styles.underlineLabel} />

        <Sep />

        <ToolBtn label="A-" onPress={decreaseFontSize} />
        <View style={styles.fontSizeBox}>
          <Text style={styles.fontSizeText}>{style.fontSize ?? 13}</Text>
        </View>
        <ToolBtn label="A+" onPress={increaseFontSize} />

        <Sep />

        <ToolBtn label="⬅" active={style.align === 'left' || !style.align} onPress={setAlignLeft} />
        <ToolBtn label="⬛" active={style.align === 'center'} onPress={setAlignCenter} />
        <ToolBtn label="➡" active={style.align === 'right'} onPress={setAlignRight} />

        <Sep />

        <ToolBtn label="↵" active={style.wrap} onPress={toggleWrap} />

        <Sep />

        {COLORS.map(color => (
          <TouchableOpacity
            key={color}
            style={[styles.swatch, { backgroundColor: color }]}
            onPress={() => applyStyle({ fontColor: color })}
          />
        ))}
      </ScrollView>
    </View>
  );
};

export default React.memo(Toolbar);

const COLORS = ['#202124', '#D93025', '#188038', '#1A73E8', '#F29900', '#9334E6'];

const styles = StyleSheet.create({
  container: {
    height: 44,
    backgroundColor: '#F8F9FA',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 2,
  },
  btn: {
    minWidth: 32,
    height: 30,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  btnActive: {
    backgroundColor: '#D2E3FC',
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    fontSize: 14,
    color: '#3C4043',
  },
  btnTextActive: {
    color: '#1A73E8',
  },
  btnTextDisabled: {
    color: '#9AA0A6',
  },
  boldLabel: {
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Georgia-Bold' : 'serif',
  },
  italicLabel: {
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? 'Georgia-Italic' : 'serif',
  },
  underlineLabel: {
    textDecorationLine: 'underline',
  },
  fontSizeBox: {
    minWidth: 28,
    height: 26,
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
  },
  fontSizeText: {
    fontSize: 11,
    color: '#202124',
  },
  sep: {
    width: 1,
    height: 20,
    backgroundColor: '#DADCE0',
    marginHorizontal: 4,
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    marginHorizontal: 1,
  },
});
