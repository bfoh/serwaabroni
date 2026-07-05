# Twi Voice for SerwaaBroni — Design Spec

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## 1. Summary

Add Twi as a second spoken language for the SerwaaBroni agent, alongside English.
A manual **EN / TW** toggle switches the input/output pipeline:

- **English (unchanged):** browser Web Speech in, browser TTS out.
- **Twi:** record audio → GhanaNLP Khaya ASR → translate Twi→English → the
  existing Claude agent → English reply → translate English→Twi → Khaya TTS →
  play the Twi audio and show the Twi text.

The Khaya API key and endpoints live server-side in a new `serwaa-speech` edge
function. The feature ships **dormant**: the toggle works, but until the key and
endpoints are configured the agent says "Twi voice isn't set up yet" and stays
in English. No changes to the agent's tools, confirm cards, or money logic.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Provider | GhanaNLP Khaya (ASR + translate + TTS) for Twi; browser Web Speech for English |
| Language selection | Manual EN / TW toggle in the agent sheet (persisted) |
| Twi round-trip | Full: understand Twi and reply in Twi |
| Reply display in Twi mode | Show the Twi translation (from the `speak` call) as the assistant bubble |
| Endpoints | Env-configurable (owner pastes exact ASR/TTS URLs + speaker from their Khaya dashboard); translate defaults to the known URL |
| Availability | Build now; dormant until `KHAYA_API_KEY` (+ URLs) are set as Supabase secrets |
| Money safety | Confirm cards unchanged — figures shown, tap-to-confirm; a Twi mishear cannot silently save |

## 3. Known Khaya facts

- Host: `https://translation-api.ghananlp.org`.
- Auth header: `Ocp-Apim-Subscription-Key: <KHAYA_API_KEY>`.
- Translate: `POST /v1/translate`, JSON `{ "in": "<text>", "lang": "en-tw" | "tw-en" }`.
- ASR base `/asr/v3/` (discovery: `GET /asr/v3/languages`); Twi language code `tw`.
- TTS base `/tts/v2/` (discovery: `GET /tts/v2/speakers`).
- The exact **transcribe** and **synthesize** POST paths and a Twi **speaker id**
  are read from the owner's subscribed product pages and supplied via env, so the
  integration does not hardcode a guess.

## 4. Edge function `serwaa-speech`

`supabase/functions/serwaa-speech/index.ts`. Same auth/secret/try-catch pattern
as `serwaa-agent` (validate `userJwt` via GoTrue; CORS-safe JSON errors). Env:

- `KHAYA_API_KEY` (required to be non-dormant).
- `KHAYA_TRANSLATE_URL` (default `https://translation-api.ghananlp.org/v1/translate`).
- `KHAYA_ASR_URL` (e.g. `https://translation-api.ghananlp.org/asr/v3/transcribe`).
- `KHAYA_TTS_URL` (e.g. `https://translation-api.ghananlp.org/tts/v2/tts`).
- `KHAYA_TWI_SPEAKER` (a Twi speaker id from `/tts/v2/speakers`).

Register in `supabase/config.toml` with `verify_jwt = false`.

Request `{ userJwt, action, ... }`:

- **`action: 'transcribe'`** — `{ audioBase64, mimeType }`:
  1. POST the decoded audio to `KHAYA_ASR_URL` with `?language=tw`, header key,
     `Content-Type: <mimeType>` → Twi transcript.
  2. POST `{ in: twi, lang: 'tw-en' }` to `KHAYA_TRANSLATE_URL` → English.
  3. Respond `{ twi, english }`.
- **`action: 'speak'`** — `{ text }` (English):
  1. POST `{ in: text, lang: 'en-tw' }` to translate → Twi.
  2. POST `{ text: twi, language: 'tw', speaker_id: KHAYA_TWI_SPEAKER }` to
     `KHAYA_TTS_URL` → audio bytes → base64.
  3. Respond `{ twi, audioBase64, mimeType }`.
- If `KHAYA_API_KEY` is unset → `{ error: 'twi_not_configured' }` (HTTP 501). The
  ASR/TTS response parsing tolerates either JSON (`{ text }`/base64) or raw bytes;
  the exact shape is confirmed against the live API during owner testing and any
  small adjustment stays inside this function.

## 5. Client

- `src/lib/agent/audio.ts` — `recordAudio(opts?): Promise<{ blob: Blob; mimeType: string }>`
  via `MediaRecorder` (getUserMedia), stopping on a short silence timeout or an
  explicit `stop()`. Exposes `stopRecording()`. Twi needs raw audio because
  browser Web Speech only transcribes English.
- `src/lib/agent/khaya.ts`:
  - `transcribeTwi(blob, mimeType): Promise<{ twi: string; english: string }>`
  - `speakTwi(text): Promise<{ twi: string; audioBase64: string; mimeType: string }>`
  - `playBase64Audio(base64, mimeType): Promise<void>`
  - Both POST to `serwaa-speech` with the anon-key-Bearer + `userJwt`-in-body
    pattern; throw a typed error on `twi_not_configured`.
- `src/hooks/useAgent.ts`:
  - `language: 'en' | 'tw'` state (persisted in `localStorage`), plus
    `setLanguage`.
  - The conversation loop branches: EN → `listenOnce` (as today); TW →
    `recordAudio` → `transcribeTwi` → feed the English text to the existing
    `sendText` pipeline; on `twi_not_configured` it shows a one-time notice and
    reverts to EN.
  - A single `respond(text)` helper replaces the scattered
    `pushMessage(assistant)+speak(...)` pairs: EN → push English + browser
    `speak`; TW → `speakTwi(text)` → push the returned Twi text + play the Twi
    audio (falling back to browser speak if Khaya fails). Used for normal
    replies, receipt prompts, confirm results, and the greeting.
- `src/components/agent/AgentSheet.tsx` — a small **EN / TW** segmented toggle in
  the sheet header wired to `language`/`setLanguage`.

## 6. Latency & cost (flagged)

A Twi turn is record + 2 Khaya calls (transcribe bundles ASR+translate; speak
bundles translate+TTS) + 1 Claude call — slower than English by design. Owner
absorbs Khaya cost; the confirm card is optimistic (already fast) regardless of
language.

## 7. Testing

- Unit-test the pure pieces: `khaya.ts` response normalization
  (`normalizeTranscribe`, `normalizeSpeak`) with mocked fetch; the language
  branch of the turn loop via injected deps where practical.
- Edge function verified manually by the owner once the key + URLs are set
  (transcribe a Twi clip; speak an English reply and hear Twi).
- The EN path and all existing agent tests must remain green.

## 8. Phasing

- **This spec:** edge fn + client + toggle + full Twi loop (dormant without key).
- **Later:** Twi slot re-ask on low ASR confidence; caching common phrases; a
  Twi word-number normalizer.

## 9. Pros / Cons

**Pros**
- Real accessibility for Twi-speaking, low-literacy traders — the differentiator.
- Reuses the entire agent brain unchanged (English in the middle); English stays
  fast.
- Keys server-side; dormant-safe; money confirm unchanged.

**Cons / risks**
- Twi ASR accuracy imperfect (noisy markets, code-switching) → mitigated by the
  confirm card and (later) slot re-ask.
- Higher latency and recurring Khaya cost for Twi turns.
- Exact ASR/TTS request/response shapes finalized against the live API during
  owner testing (contained to the edge function).

## 10. Out of scope

- Auto language detection; Twi text input (typing); other Ghanaian languages;
  offline Twi.
