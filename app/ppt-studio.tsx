import React from 'react';
import { useRouter } from 'expo-router';
import { PPTNavigator } from '@/src/ppt-module';

export default function PPTStudioScreen() {
  const router = useRouter();
  return <PPTNavigator onExit={() => router.back()} />;
}
