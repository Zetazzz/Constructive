-- Integration test seed for graphile-ltree
-- Requires postgres-plus:18 image with ltree extension

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE SCHEMA IF NOT EXISTS ltree_test;

-- Files table with an ltree path column
CREATE TABLE ltree_test.files (
  id serial PRIMARY KEY,
  filename text NOT NULL,
  path ltree NOT NULL
);

-- GiST index for ltree containment queries
CREATE INDEX idx_files_path ON ltree_test.files USING gist(path);

-- Seed data: a small directory tree
INSERT INTO ltree_test.files (id, filename, path) VALUES
  (1, 'root.txt',        'root'),
  (2, 'readme.md',       'projects'),
  (3, 'alpha-spec.pdf',  'projects.alpha'),
  (4, 'contract.pdf',    'projects.alpha.docs'),
  (5, 'design.png',      'projects.alpha.docs.images'),
  (6, 'budget.xlsx',     'projects.alpha.finance'),
  (7, 'beta-spec.pdf',   'projects.beta'),
  (8, 'proposal.docx',   'projects.beta.docs'),
  (9, 'avatar.jpg',      'users.alice'),
  (10, 'notes.txt',      'users.bob');

SELECT setval('ltree_test.files_id_seq', 10);

-- Categories table with ltree for testing on a second table
CREATE TABLE ltree_test.categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  tree_path ltree NOT NULL
);

CREATE INDEX idx_categories_tree ON ltree_test.categories USING gist(tree_path);

INSERT INTO ltree_test.categories (id, name, tree_path) VALUES
  (1, 'Electronics',    'shop.electronics'),
  (2, 'Laptops',        'shop.electronics.laptops'),
  (3, 'Phones',         'shop.electronics.phones'),
  (4, 'Clothing',       'shop.clothing'),
  (5, 'Shirts',         'shop.clothing.shirts');

SELECT setval('ltree_test.categories_id_seq', 5);
