# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.2.1](https://github.com/constructive-io/constructive/compare/@constructive-io/express-context@0.2.0...@constructive-io/express-context@0.2.1) (2026-05-23)

### Bug Fixes

- **loaders:** use composite cache key (databaseId:apiId) ([9649164](https://github.com/constructive-io/constructive/commit/96491643e58e341626c5dafe845009663642ad3e))

# 0.2.0 (2026-05-23)

### Bug Fixes

- add back Express.Request properties that express-context reads ([35af13a](https://github.com/constructive-io/constructive/commit/35af13a33e7d0bb5a087584a8f8a3fdd94ada17d))
- restore original server types, remove re-exports from express-context ([f4e7624](https://github.com/constructive-io/constructive/commit/f4e7624a36145b01f5d438a6177bf389cba80ae6))

### Features

- add @constructive-io/express-context package + wire into server ([2d46e0b](https://github.com/constructive-io/constructive/commit/2d46e0b419654c161ae90140b47515df16897ae4)), closes [constructive-io/constructive-planning#917](https://github.com/constructive-io/constructive-planning/issues/917)
- **express-context:** add modular per-database cached lookup system ([1356633](https://github.com/constructive-io/constructive/commit/135663385951e72da5a8d0644122f21e4650c228))
- **pg-query-context:** add callback-based withPgClient API ([8f13b6d](https://github.com/constructive-io/constructive/commit/8f13b6d620ffdb001c017798c7deed6c8776bee0))
