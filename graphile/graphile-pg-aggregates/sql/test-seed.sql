-- Test seed for graphile-pg-aggregates
-- Creates tables covering aggregate scenarios: numeric aggregates, groupBy, having,
-- relational aggregates (ordering + filtering parents by child aggregates)

CREATE SCHEMA IF NOT EXISTS agg_test;

-- ============================================================================
-- PARENT TABLE (for relational aggregate tests)
-- ============================================================================
CREATE TABLE agg_test.teams (
  id serial PRIMARY KEY,
  name text NOT NULL,
  division text NOT NULL
);

-- ============================================================================
-- CHILD TABLE (numeric columns for aggregating)
-- ============================================================================
CREATE TABLE agg_test.players (
  id serial PRIMARY KEY,
  team_id int NOT NULL REFERENCES agg_test.teams(id),
  name text NOT NULL,
  position text NOT NULL,
  goals int NOT NULL DEFAULT 0,
  assists int NOT NULL DEFAULT 0,
  salary numeric(12,2) NOT NULL DEFAULT 0,
  rating float
);

CREATE INDEX idx_players_team_id ON agg_test.players(team_id);

-- ============================================================================
-- STANDALONE TABLE (for basic aggregate + groupBy tests)
-- ============================================================================
CREATE TABLE agg_test.matches (
  id serial PRIMARY KEY,
  home_team_id int NOT NULL REFERENCES agg_test.teams(id),
  away_team_id int NOT NULL REFERENCES agg_test.teams(id),
  season text NOT NULL,
  home_score int NOT NULL DEFAULT 0,
  away_score int NOT NULL DEFAULT 0,
  attendance int
);

CREATE INDEX idx_matches_home_team_id ON agg_test.matches(home_team_id);
CREATE INDEX idx_matches_away_team_id ON agg_test.matches(away_team_id);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Teams
INSERT INTO agg_test.teams (name, division) VALUES
  ('Red Hawks', 'North'),
  ('Blue Jays', 'North'),
  ('Green Lions', 'South'),
  ('Gold Eagles', 'South');

-- Players (spread across teams with varying stats)
INSERT INTO agg_test.players (team_id, name, position, goals, assists, salary, rating) VALUES
  -- Red Hawks (team 1): 3 players, goals sum = 25
  (1, 'Alice', 'Forward', 15, 8, 90000.00, 4.5),
  (1, 'Bob', 'Midfielder', 7, 12, 75000.00, 3.8),
  (1, 'Carol', 'Defender', 3, 5, 65000.00, 4.1),
  -- Blue Jays (team 2): 3 players, goals sum = 18
  (2, 'Dave', 'Forward', 12, 6, 85000.00, 4.2),
  (2, 'Eve', 'Midfielder', 4, 15, 70000.00, 3.9),
  (2, 'Frank', 'Defender', 2, 3, 60000.00, NULL),
  -- Green Lions (team 3): 2 players, goals sum = 22
  (3, 'Grace', 'Forward', 18, 10, 95000.00, 4.8),
  (3, 'Hank', 'Midfielder', 4, 9, 68000.00, 3.5),
  -- Gold Eagles (team 4): 2 players, goals sum = 9
  (4, 'Ivy', 'Forward', 8, 4, 72000.00, 4.0),
  (4, 'Jack', 'Defender', 1, 2, 55000.00, 3.2);

-- Matches (for groupBy season tests)
INSERT INTO agg_test.matches (home_team_id, away_team_id, season, home_score, away_score, attendance) VALUES
  (1, 2, '2024', 3, 1, 15000),
  (3, 4, '2024', 2, 2, 12000),
  (1, 3, '2024', 1, 0, 18000),
  (2, 4, '2024', 4, 1, 11000),
  (1, 4, '2025', 2, 3, 16000),
  (2, 3, '2025', 0, 1, 13000),
  (3, 1, '2025', 2, 2, 14000),
  (4, 2, '2025', 1, 1, NULL);
