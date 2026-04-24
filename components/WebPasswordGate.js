import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from "react-native";

const WEB_PREVIEW_PASSWORD = "aswaat-bro";
const STORAGE_KEY = "aswaat_web_preview_ok";

/**
 * Full-screen gate for Expo web only. Native apps render children unchanged.
 */
export default function WebPasswordGate({ children, onUnlocked }) {
  if (Platform.OS !== "web") {
    return children;
  }

  return <WebPasswordGateInner onUnlocked={onUnlocked}>{children}</WebPasswordGateInner>;
}

function WebPasswordGateInner({ children, onUnlocked }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const submit = useCallback(() => {
    const trimmed = password.trim();
    if (trimmed === WEB_PREVIEW_PASSWORD) {
      setError("");
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, "1");
        }
      } catch {
        /* ignore quota / private mode */
      }
      setUnlocked(true);
      onUnlocked?.();
      return;
    }
    setError("That password is not correct.");
  }, [password, onUnlocked]);

  if (unlocked) {
    return children;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Aswaat</Text>
        <Text style={styles.subtitle}>Web preview — enter the password to continue.</Text>
        <TextInput
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (error) setError("");
          }}
          placeholder="Password"
          placeholderTextColor="#6b6b70"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={submit} activeOpacity={0.85}>
          <Text style={styles.buttonLabel}>Continue</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#121214",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#1f1f22",
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: "#2e2e32",
  },
  title: {
    fontSize: 26,
    fontWeight: "600",
    color: "#f4f4f5",
    letterSpacing: 0.3,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#a1a1aa",
    textAlign: "center",
    marginBottom: 24,
  },
  input: {
    backgroundColor: "#2a2a2e",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#fafafa",
    marginBottom: 8,
  },
  error: {
    color: "#f87171",
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#e4e4e7",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#18181b",
  },
});
