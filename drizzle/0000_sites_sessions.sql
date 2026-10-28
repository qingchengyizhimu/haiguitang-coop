CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  room_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('easy', 'normal', 'hard')),
  status TEXT NOT NULL CHECK (status IN ('playing', 'won', 'lost', 'ended', 'abandoned')),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  start_request_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_owner_start_request
  ON game_sessions(owner_id, start_request_id)
  WHERE start_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_owner_active_room
  ON game_sessions(owner_id, room_key)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS game_sessions_owner_updated
  ON game_sessions(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS game_sessions_owner_room_updated
  ON game_sessions(owner_id, room_key, updated_at DESC);
