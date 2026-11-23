-- Continents, so an alert can be mapped to a whole continent (e.g. "Europe")
-- without listing every country in it. Codes match src/lib/geo/continents.ts.
INSERT INTO geographies (code, iso_code, level, display_name)
VALUES
  ('CONT-AF', NULL, 'region', 'Africa'),
  ('CONT-AS', NULL, 'region', 'Asia'),
  ('CONT-EU', NULL, 'region', 'Europe'),
  ('CONT-NA', NULL, 'region', 'North America'),
  ('CONT-SA', NULL, 'region', 'South America'),
  ('CONT-OC', NULL, 'region', 'Oceania'),
  ('CONT-AN', NULL, 'region', 'Antarctica')
ON CONFLICT (code) DO NOTHING;
