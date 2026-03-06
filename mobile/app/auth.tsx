/**
 * LOCI — Auth Screen
 * Email + name entry → OTP verification → home
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../lib/api';

const TOKEN_KEY = '@loci_token';
const USER_KEY = '@loci_user';

type AuthStep = 'entry' | 'otp';

export default function AuthScreen() {
  const [step, setStep] = useState<AuthStep>('entry');

  // Entry state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [entryLoading, setEntryLoading] = useState(false);
  const [entryError, setEntryError] = useState('');

  // OTP state
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const digitRefs = useRef<(TextInput | null)[]>([]);

  // Fade animation
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const fadeToStep = (newStep: AuthStep) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setStep(newStep);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  };

  // Resend countdown timer
  useEffect(() => {
    if (step !== 'otp') return;
    setResendCountdown(120);
    setCanResend(false);
    const interval = setInterval(() => {
      setResendCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          setCanResend(true);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  const validateEntry = () => {
    if (!name.trim() || name.trim().length < 2) {
      setEntryError('Name must be at least 2 characters');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setEntryError('Please enter a valid email address');
      return false;
    }
    return true;
  };

  const handleSendCode = async () => {
    setEntryError('');
    if (!validateEntry()) return;

    setEntryLoading(true);
    try {
      await api.auth.emailSignup(name.trim(), email.trim().toLowerCase());
      fadeToStep('otp');
    } catch (err: any) {
      const msg = err?.message || 'Failed to send code. Please try again.';
      setEntryError(msg);
    } finally {
      setEntryLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setOtpError('');
    try {
      await api.auth.emailSignup(name.trim(), email.trim().toLowerCase());
      setDigits(['', '', '', '', '', '']);
      setResendCountdown(120);
      setCanResend(false);
      // Restart timer
      const interval = setInterval(() => {
        setResendCountdown((c) => {
          if (c <= 1) {
            clearInterval(interval);
            setCanResend(true);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (err: any) {
      setOtpError(err?.message || 'Failed to resend code');
    }
  };

  const handleDigitChange = (value: string, index: number) => {
    // Only allow single digit
    const digit = value.replace(/[^0-9]/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setOtpError('');

    if (digit && index < 5) {
      digitRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits filled
    if (digit && index === 5) {
      const fullCode = newDigits.join('');
      if (fullCode.length === 6) {
        submitOtp(fullCode);
      }
    }
  };

  const handleDigitKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const submitOtp = useCallback(async (code: string) => {
    if (otpLoading) return;
    setOtpError('');
    setOtpLoading(true);
    try {
      const res = await api.auth.verifyOtp(name.trim(), email.trim().toLowerCase(), code);
      // Persist to AsyncStorage
      await AsyncStorage.setItem(TOKEN_KEY, res.token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
      api.setToken(res.token);
      router.replace('/');
    } catch (err: any) {
      const msg = err?.message || 'Invalid code. Please try again.';
      setOtpError(msg);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => digitRefs.current[0]?.focus(), 100);
    } finally {
      setOtpLoading(false);
    }
  }, [name, email, otpLoading]);

  const handleVerify = () => {
    const code = digits.join('');
    if (code.length !== 6) {
      setOtpError('Please enter all 6 digits');
      return;
    }
    submitOtp(code);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Text style={styles.wordmark}>LOCI</Text>
          <Text style={styles.tagline}>Walk in. Connect.</Text>
        </View>

        <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
          {step === 'entry' ? (
            <EntryForm
              name={name}
              email={email}
              loading={entryLoading}
              error={entryError}
              onNameChange={(v) => { setName(v); setEntryError(''); }}
              onEmailChange={(v) => { setEmail(v); setEntryError(''); }}
              onSubmit={handleSendCode}
            />
          ) : (
            <OtpForm
              email={email}
              digits={digits}
              loading={otpLoading}
              error={otpError}
              canResend={canResend}
              resendCountdown={resendCountdown}
              digitRefs={digitRefs}
              onDigitChange={handleDigitChange}
              onDigitKeyPress={handleDigitKeyPress}
              onVerify={handleVerify}
              onResend={handleResend}
              onBack={() => fadeToStep('entry')}
            />
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Entry Form ───────────────────────────────────────────
interface EntryFormProps {
  name: string;
  email: string;
  loading: boolean;
  error: string;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onSubmit: () => void;
}

function EntryForm({ name, email, loading, error, onNameChange, onEmailChange, onSubmit }: EntryFormProps) {
  const emailRef = useRef<TextInput>(null);

  return (
    <View>
      <Text style={styles.cardTitle}>Get started</Text>
      <Text style={styles.cardSubtitle}>Enter your name and email to continue</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Your Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Alex Rivera"
          placeholderTextColor="#444"
          value={name}
          onChangeText={onNameChange}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          editable={!loading}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Email Address</Text>
        <TextInput
          ref={emailRef}
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#444"
          value={email}
          onChangeText={onEmailChange}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          editable={!loading}
        />
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, loading && styles.btnDisabled]}
        onPress={onSubmit}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>Send Code →</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── OTP Form ─────────────────────────────────────────────
interface OtpFormProps {
  email: string;
  digits: string[];
  loading: boolean;
  error: string;
  canResend: boolean;
  resendCountdown: number;
  digitRefs: React.MutableRefObject<(TextInput | null)[]>;
  onDigitChange: (v: string, i: number) => void;
  onDigitKeyPress: (e: any, i: number) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}

function OtpForm({
  email, digits, loading, error, canResend, resendCountdown,
  digitRefs, onDigitChange, onDigitKeyPress, onVerify, onResend, onBack,
}: OtpFormProps) {
  return (
    <View>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.cardTitle}>Check your email</Text>
      <Text style={styles.cardSubtitle}>
        We sent a 6-digit code to{'\n'}
        <Text style={styles.emailHighlight}>{email}</Text>
      </Text>

      {/* 6 digit boxes */}
      <View style={styles.otpRow}>
        {digits.map((digit, i) => (
          <TextInput
            key={i}
            ref={(ref) => { digitRefs.current[i] = ref; }}
            style={[
              styles.otpBox,
              digit ? styles.otpBoxFilled : null,
            ]}
            value={digit}
            onChangeText={(v) => onDigitChange(v, i)}
            onKeyPress={(e) => onDigitKeyPress(e, i)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
            editable={!loading}
            caretHidden
          />
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, (loading || digits.join('').length !== 6) && styles.btnDisabled]}
        onPress={onVerify}
        disabled={loading || digits.join('').length !== 6}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>Verify →</Text>
        )}
      </TouchableOpacity>

      <View style={styles.resendRow}>
        {canResend ? (
          <TouchableOpacity onPress={onResend} activeOpacity={0.7}>
            <Text style={styles.resendLink}>Resend code</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.resendTimer}>
            Resend code in <Text style={styles.resendTimerBold}>{resendCountdown}s</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 48,
  },

  // Logo
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  wordmark: {
    color: '#6C63FF',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 8,
  },
  tagline: {
    color: '#555',
    fontSize: 14,
    marginTop: 6,
    letterSpacing: 1,
  },

  // Card
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: '#1e1e2e',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardSubtitle: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 28,
  },
  emailHighlight: {
    color: '#6C63FF',
    fontWeight: '600',
  },

  // Input
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a3a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
  },

  // OTP boxes
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 10,
  },
  otpBox: {
    width: 46,
    height: 58,
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#2a2a3a',
    borderRadius: 12,
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    lineHeight: Platform.OS === 'android' ? 58 : undefined,
  },
  otpBoxFilled: {
    borderColor: '#6C63FF',
    backgroundColor: 'rgba(108, 99, 255, 0.08)',
  },

  // Errors
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },

  // Buttons
  primaryBtn: {
    backgroundColor: '#6C63FF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
    minHeight: 52,
  },
  btnDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },

  // Resend
  resendRow: {
    marginTop: 20,
    alignItems: 'center',
  },
  resendLink: {
    color: '#6C63FF',
    fontSize: 14,
    fontWeight: '600',
  },
  resendTimer: {
    color: '#555',
    fontSize: 13,
  },
  resendTimerBold: {
    color: '#888',
    fontWeight: '600',
  },

  // Back button
  backBtn: {
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  backBtnText: {
    color: '#6C63FF',
    fontSize: 14,
    fontWeight: '600',
  },
});
