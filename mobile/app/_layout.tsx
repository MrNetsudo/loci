import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

function LociWordmark() {
  return (
    <View style={styles.wordmarkContainer}>
      <Text style={styles.wordmark}>LOCI</Text>
    </View>
  );
}

function SettingsButton() {
  return (
    <TouchableOpacity style={styles.settingsBtn} activeOpacity={0.7}>
      <Text style={styles.settingsIcon}>⚙</Text>
    </TouchableOpacity>
  );
}

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0a0a' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: '#0a0a0a' },
          headerShadowVisible: false,
          animation: 'slide_from_right',
          headerBackTitle: '',
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerTitle: () => <LociWordmark />,
            headerRight: () => <SettingsButton />,
            headerLeft: () => null,
          }}
        />
        <Stack.Screen
          name="auth"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="room/[id]"
          options={{
            title: 'Room',
            headerBackVisible: true,
          }}
        />
        <Stack.Screen
          name="venue/[id]"
          options={{
            title: 'Venue',
            headerBackVisible: true,
          }}
        />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  wordmarkContainer: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  wordmark: {
    color: '#6C63FF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 4,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.2)',
    marginRight: 4,
  },
  settingsIcon: {
    fontSize: 16,
    color: '#888',
  },
});
