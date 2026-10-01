# Docsup Mobile

The mobile client is intentionally kept as a separate Expo workspace. It shares the REST contract and validation package with the web client. Initialize it with `npx create-expo-app` when the mobile release train starts; use secure storage for session tokens and `expo-local-authentication` for the biometric gate. The API is designed so no sensitive document library is cached by default.
