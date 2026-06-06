import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '@/constants/theme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
// Edge-to-edge aware status bar. The core RN <StatusBar backgroundColor> is a
// no-op under Android edge-to-edge (mandatory in SDK 54), so use expo-status-bar
// which only controls icon style.
import { StatusBar } from 'expo-status-bar';
import { GradientView } from './GradientView';

const SCREEN_H = Dimensions.get('window').height;
const CARD_HEIGHT = Math.min(Math.round(SCREEN_H * 0.62), 540);
const ONBOARDING_KEY = '@wi:onboarding_v1';

interface Props {
  onFinish: () => void;
}

type Phase = 'brand' | 'privacy' | 'welcome';

function PrivacyItem({ heading, body }: { heading: string; body: string }) {
  return (
    <View style={pvStyles.item}>
      <Text style={pvStyles.heading}>{heading}</Text>
      <Text style={pvStyles.body}>{body}</Text>
    </View>
  );
}

export function OnboardingScreen({ onFinish }: Props) {
  const [phase, setPhase] = useState<Phase>('brand');
  const [accepted, setAccepted] = useState(false);

  // Brand phase: hold for exactly 3 000 ms from mount
  useEffect(() => {
    const mountTime = Date.now();
    let cancelled = false;
    let brandTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      let isFirst = false;
      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_KEY);
        isFirst = stored === null;
      } catch {
        isFirst = false;
      }

      if (cancelled) return;

      const elapsed = Date.now() - mountTime;
      const remaining = Math.max(0, 3000 - elapsed);

      brandTimer = setTimeout(() => {
        if (cancelled) return;
        if (isFirst) {
          setPhase('privacy');
        } else {
          onFinish();
        }
      }, remaining);
    })();

    return () => {
      cancelled = true;
      if (brandTimer) clearTimeout(brandTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Welcome phase: hold for exactly 2 500 ms then open app
  useEffect(() => {
    if (phase !== 'welcome') return;
    const t = setTimeout(() => onFinish(), 2500);
    return () => clearTimeout(t);
  }, [phase, onFinish]);

  const handleAccept = useCallback(async () => {
    if (accepted) return;
    setAccepted(true);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'done');
    } catch {}
    setPhase('welcome');
  }, [accepted]);

  return (
    <View style={styles.root}>
      {/* Dark gradient behind → light (white) status-bar icons */}
      <StatusBar style="light" />

      <GradientView
        colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        {phase === 'brand' && (
          <View style={styles.brandContainer}>
            <Text style={styles.wordsText}>words</Text>
            <Text style={styles.inscribedText}>Inscribed</Text>
          </View>
        )}

        {phase === 'welcome' && (
          <View style={styles.welcomeContainer}>
            <Text style={styles.welcomeText}>welcome</Text>
          </View>
        )}

        {phase === 'privacy' && (
          <View style={styles.privacyCard}>
            <View style={styles.handle} />

            <Text style={styles.pvTitle}>Privacy Notice</Text>
            <Text style={styles.pvIntro}>
              By using words Inscribed, you acknowledge and agree to the following terms governing data access, device permissions, and the handling of your information.
            </Text>

            <ScrollView
              style={styles.pvScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.pvScrollContent}
            >
              <PrivacyItem
                heading="CAMERA"
                body="The application accesses your device camera exclusively to capture images for the purpose of document creation. Camera access is initiated solely upon your direct action and shall not be used for any other purpose."
              />
              <PrivacyItem
                heading="FILE AND STORAGE ACCESS"
                body="Access to device storage and file system directories is granted exclusively by you. Such access is used solely to open, manage, and save documents as directed. No file is accessed, read, or transmitted without your explicit instruction."
              />
              <PrivacyItem
                heading="USER CONTROL AND PERMISSIONS"
                body="All device permissions are granted at your discretion and may be revoked at any time through your device settings. The application shall not access any device resource for which permission has not been expressly granted."
              />
              <PrivacyItem
                heading="DATA HANDLING AND SECURITY"
                body="Your files and personal data are processed and stored securely. No document, file, or user data is transmitted to third parties or uploaded to remote servers without your knowledge and explicit action."
              />
            </ScrollView>

            <TouchableOpacity
              style={[styles.acceptBtn, accepted && styles.acceptBtnActive]}
              onPress={handleAccept}
              activeOpacity={0.8}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                {accepted && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.acceptLabel, accepted && styles.acceptLabelActive]}>
                {accepted ? 'Accepted — opening app…' : 'I have read and accept'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </GradientView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  fill: {
    flex: 1,
  },

  brandContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordsText: {
    // Match the home-screen "words Inscribed" branding: system sans-serif,
    // upright (no italic, no serif). Size/weight/spacing kept as designed.
    fontSize: 34,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.90)',
    letterSpacing: 1,
    includeFontPadding: false,
    lineHeight: 40,
  },
  inscribedText: {
    fontSize: 52,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
    includeFontPadding: false,
    lineHeight: 58,
  },

  welcomeContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: 50,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 1,
    includeFontPadding: false,
  },

  privacyCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: CARD_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 24,
  },
  handle: {
    width: 38,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  pvTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  pvIntro: {
    fontSize: 12.5,
    color: '#6B7280',
    lineHeight: 19,
    marginBottom: 14,
  },
  pvScroll: {
    flex: 1,
  },
  pvScrollContent: {
    paddingBottom: 6,
  },

  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 15,
    backgroundColor: '#F3F4F6',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  acceptBtnActive: {
    backgroundColor: '#EEF2FF',
    borderColor: colors.gradientStart,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxChecked: {
    backgroundColor: colors.gradientStart,
    borderColor: colors.gradientStart,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  acceptLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  acceptLabelActive: {
    color: colors.gradientStart,
  },
});

const pvStyles = StyleSheet.create({
  item: {
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  heading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  body: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
  },
});

export default OnboardingScreen;
