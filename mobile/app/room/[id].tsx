/**
 * LOCI — Room Screen
 * Real-time chat room for a venue.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import * as api from '../../lib/api';
import { subscribeToRoom } from '../../lib/supabase';
import type { Message, Room } from '../../lib/api';

export default function RoomScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ── Load room + message history ──────────────────────────
  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        // Join room
        const joinResult = await api.rooms.join(roomId);
        setRoom(joinResult.room);
        navigation.setOptions({ title: `Room · ${joinResult.room.occupancy} here` });

        // Load message history
        const msgRes = await api.messages.list(roomId);
        setMessages(msgRes.messages);
      } catch (e: any) {
        if (e.error === 'NOT_PRESENT') {
          router.back(); // kicked out — no longer at venue
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      // Leave room on unmount
      api.rooms.leave(roomId).catch(() => {});
      api.presence.leave('').catch(() => {});
      unsubscribeRef.current?.();
    };
  }, [roomId]);

  // ── Subscribe to real-time messages ──────────────────────
  useEffect(() => {
    if (!roomId) return;
    unsubscribeRef.current = subscribeToRoom(roomId, (payload) => {
      const newMsg = payload.new as Message;
      setMessages((prev) => {
        if (prev.find((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => unsubscribeRef.current?.();
  }, [roomId]);

  // ── Send message ─────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sending || !roomId) return;
    setSending(true);
    setInputText('');
    try {
      await api.messages.send(roomId, text);
    } catch (e: any) {
      setInputText(text); // restore on error
      if (e.error === 'NOT_PRESENT') {
        router.back();
      }
    } finally {
      setSending(false);
    }
  }, [inputText, sending, roomId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
        <Text style={styles.loadingText}>Joining room…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Message list */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.messageList}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyRoom}>
            <Text style={styles.emptyRoomText}>🔥 You're the first one here. Start the conversation!</Text>
          </View>
        }
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Say something…"
          placeholderTextColor="#555"
          multiline
          maxLength={1000}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!inputText.trim() || sending}
        >
          <Text style={styles.sendBtnText}>{sending ? '…' : '➤'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={styles.bubble}>
      <View style={styles.bubbleHeader}>
        <Text style={styles.bubbleName}>
          {message.user?.display_name ?? 'Anonymous'}
        </Text>
        <Text style={styles.bubbleTime}>{time}</Text>
      </View>
      <Text style={styles.bubbleText}>{message.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 12 },
  messageList: { padding: 16, paddingBottom: 8, gap: 8 },
  bubble: {
    backgroundColor: '#111', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#1e1e1e',
  },
  bubbleHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  bubbleName: { color: '#6C63FF', fontSize: 13, fontWeight: '600' },
  bubbleTime: { color: '#444', fontSize: 11 },
  bubbleText: { color: '#ddd', fontSize: 15, lineHeight: 22 },
  emptyRoom: { padding: 32, alignItems: 'center' },
  emptyRoomText: { color: '#555', textAlign: 'center', lineHeight: 24 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 12, borderTopWidth: 1, borderTopColor: '#1e1e1e',
    backgroundColor: '#0a0a0a', gap: 8,
  },
  input: {
    flex: 1, backgroundColor: '#111', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: '#fff', fontSize: 15, maxHeight: 100,
    borderWidth: 1, borderColor: '#222',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#6C63FF', justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#2a2a2a' },
  sendBtnText: { color: '#fff', fontSize: 18 },
});
