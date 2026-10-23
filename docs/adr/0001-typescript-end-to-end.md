# TypeScript end to end with Expo, Supabase and the MCP TS SDK

KIM is built by coding agents, so the stack favours mainstream, strongly typed tools that agents produce reliably: Expo (React Native) for iOS and Android, Supabase for auth, database and scheduled jobs, and the official MCP TypeScript SDK for the Capture server. One language lets the app, backend and MCP server share types.

## Considered Options

- **Rust** (Dioxus or Slint UI, or a Crux shared core): its compiler gives agents a strong feedback loop, but mobile Rust tooling is young and agent output for it is far less reliable. Rejected for the app; still an option for a future heavy backend service.
- **Flutter**: solid, but splits the codebase into Dart and TypeScript, since the MCP server stays in TypeScript.
