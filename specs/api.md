# API Specification - my-usagi

## Overview
Cloudflare Workers-based API for a conversational rabbit pet app for 3-year-olds.

## Endpoints

### 1. Session Management

#### POST /api/session/start
Start a new conversation session with the rabbit.

**Request:**
```json
{
  "childId": "string (optional, for tracking)"
}
```

**Response:**
```json
{
  "sessionId": "string (UUID)",
  "rabbitGreeting": "string (初回挨拶メッセージ)",
  "ttsAudioUrl": "string (R2 URL to greeting audio)"
}
```

#### GET /api/session/:sessionId
Get current session state.

**Response:**
```json
{
  "sessionId": "string",
  "active": "boolean",
  "turnCount": "number",
  "lastActivity": "ISO8601 timestamp"
}
```

### 2. Conversation

#### POST /api/conversation/audio
Process audio input from child.

**Request:**
- Content-Type: multipart/form-data
- Fields:
  - `sessionId`: string
  - `audio`: binary (WebM/Opus format from MediaRecorder)
  - `timestamp`: ISO8601 string

**Response:**
```json
{
  "transcription": "string (child's speech)",
  "rabbitResponse": "string (rabbit's reply)",
  "ttsAudioUrl": "string (R2 URL to response audio)",
  "turnId": "string (UUID for this exchange)",
  "vocabularyDetected": ["word1", "word2"]
}
```

#### POST /api/conversation/text
Fallback text input (for testing/debugging).

**Request:**
```json
{
  "sessionId": "string",
  "text": "string"
}
```

**Response:**
```json
{
  "rabbitResponse": "string",
  "ttsAudioUrl": "string",
  "turnId": "string"
}
```

### 3. Parent Dashboard

#### GET /api/parent/logs
Get conversation logs for analysis.

**Query Parameters:**
- `childId`: string (optional)
- `startDate`: ISO8601 (optional)
- `endDate`: ISO8601 (optional)
- `limit`: number (default: 50, max: 500)

**Response:**
```json
{
  "logs": [
    {
      "turnId": "string",
      "sessionId": "string",
      "timestamp": "ISO8601",
      "childInput": "string",
      "rabbitResponse": "string",
      "vocabularyUsed": ["word1", "word2"],
      "audioUrls": {
        "childAudio": "string (R2 URL)",
        "rabbitAudio": "string (R2 URL)"
      }
    }
  ],
  "total": "number"
}
```

#### GET /api/parent/vocabulary
Get vocabulary development data.

**Query Parameters:**
- `childId`: string (optional)
- `period`: "week" | "month" | "all" (default: "month")

**Response:**
```json
{
  "vocabularyGrowth": [
    {
      "date": "YYYY-MM-DD",
      "uniqueWords": "number",
      "newWords": ["word1", "word2"]
    }
  ],
  "totalUniqueWords": "number",
  "mostUsedWords": [
    { "word": "string", "count": "number" }
  ]
}
```

#### GET /api/parent/highlights
Get interesting/notable conversation moments.

**Response:**
```json
{
  "highlights": [
    {
      "turnId": "string",
      "timestamp": "ISO8601",
      "type": "new_word" | "long_sentence" | "emotional_moment",
      "description": "string",
      "excerpt": "string"
    }
  ]
}
```

### 4. Health & Maintenance

#### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "services": {
    "d1": "ok",
    "r2": "ok",
    "queues": "ok"
  }
}
```

## Durable Objects

### ConversationSession
Manages state for an active conversation session.

**Methods:**
- `fetch(request)`: Handle requests for this session
- `alarm()`: Cleanup inactive sessions after timeout

**State:**
- Session metadata
- Recent conversation context (last 5 turns)
- Vocabulary tracking for this session

## Security Considerations

1. **Prompt Injection Protection**
   - Sanitize all child input before sending to LLM
   - Use system prompts that restrict rabbit persona
   - Validate responses don't contain inappropriate content

2. **Privacy**
   - No PII in logs unless explicitly provided by parent
   - Audio files encrypted at rest in R2
   - Session IDs are non-guessable UUIDs

3. **Rate Limiting**
   - Per-session rate limit: 30 requests/minute
   - Per-IP rate limit: 100 requests/minute
   - Prevent abuse of audio processing endpoints

## Error Responses

All errors follow this format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {} // optional
  }
}
```

Common error codes:
- `SESSION_NOT_FOUND`: Invalid or expired session
- `AUDIO_PROCESSING_FAILED`: ASR failed
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `INVALID_REQUEST`: Malformed request
