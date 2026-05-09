import { BucketProvisionerPreset } from 'graphile-bucket-provisioner-plugin';
import type { GraphileConfig } from 'graphile-config';
import { ConnectionFilterPreset } from 'graphile-connection-filter';
import { createFolderOperatorFactory, GraphileLtreePreset } from 'graphile-ltree';
import { createPostgisOperatorFactory,GraphilePostgisPreset } from 'graphile-postgis';
import { PresignedUrlPreset } from 'graphile-presigned-url-plugin';
import { createMatchesOperatorFactory, createTrgmOperatorFactories,UnifiedSearchPreset } from 'graphile-search';
import { SqlExpressionValidatorPreset } from 'graphile-sql-expression-validator';
import { UploadPreset } from 'graphile-upload-plugin';

import { getBucketProvisionerConnection } from '../bucket-provisioner-resolver';
import {
  ConflictDetectorPreset,
  EnableAllFilterColumnsPreset,
  InflectorLoggerPreset,
  InflektPreset,
  ManyToManyOptInPreset,
  MetaSchemaPreset,
  MinimalPreset,
  NoUniqueLookupPreset,
  PgTypeMappingsPreset,
  RequiredInputPreset
} from '../plugins';
import { createBucketNameResolver, createEnsureBucketProvisioned, getAllowedOrigins,getPresignedUrlS3Config } from '../presigned-url-resolver';
import { constructiveUploadFieldDefinitions } from '../upload-resolver';

/**
 * Constructive PostGraphile v5 Preset
 *
 * This is the main preset that combines all our custom plugins and configurations.
 * It provides a clean, opinionated GraphQL API built from PostgreSQL.
 *
 * FEATURES:
 * - No Node/Relay features (keeps `id` as `id`, no global object identification)
 * - Custom inflection using inflekt library
 * - Conflict detection for multi-schema setups
 * - Inflector logging for debugging (enable with INFLECTOR_LOG=1)
 * - Primary key only lookups (no *ByEmail, *ByUsername, etc.)
 * - Connection filter plugin with all columns filterable
 * - Many-to-many relationships (opt-in via @behavior +manyToMany)
 * - Meta schema plugin (_meta query for introspection of tables, fields, indexes)
 * - PostGIS support (geometry/geography types, GeoJSON scalar — auto-detects PostGIS extension)
 * - PostGIS connection filter operators (spatial filtering on geometry/geography columns)
 * - Upload plugin (file upload to S3/MinIO for image, upload, attachment domain columns)
 * - Presigned URL plugin (requestUploadUrl mutation + downloadUrl computed field)
 * - Bucket provisioner plugin (auto-provisions S3 buckets on @storageBuckets table mutations,
 *   CORS management, provisionBucket mutation for manual/retry)
 * - SQL expression validator (validates @sqlExpression columns in mutations)
 * - PG type mappings (maps custom types like email, url to GraphQL scalars)
 * - pgvector search (auto-discovers vector columns: filter fields, distance computed fields,
 *   orderBy distance — zero config)
 * - pg_textsearch BM25 search (auto-discovers BM25 indexes: filter fields, score computed fields,
 *   orderBy score — zero config)
 * - pg_trgm fuzzy matching (similarTo/wordSimilarTo on text columns, similarity score fields,
 *   orderBy similarity — zero config, typo-tolerant)
 * - ltree support (auto-detects ltree columns, LTree scalar with file-path syntax,
 *   containment/glob filters — within, ancestorOf, glob)
 * - Aggregates (OPTIONAL — not included by default; add PgAggregatesPreset to extends to enable.
 *   Provides sum, avg, min, max, stddev, variance, distinctCount on connections,
 *   groupedAggregates with groupBy + having, orderBy relational aggregates,
 *   filter by relational aggregates — per-table opt-out via @behavior -aggregates)
 *
 * RELATION FILTERS:
 * - Enabled via connectionFilterRelations: true
 * - Forward: filter child by parent (e.g. allOrders(where: { clientByClientId: { name: { startsWith: "Acme" } } }))
 * - Backward: filter parent by children (e.g. allClients(where: { ordersByClientId: { some: { total: { greaterThan: 1000 } } } }))
 *
 * USAGE:
 * ```typescript
 * import { ConstructivePreset } from 'graphile-settings/presets';
 * import { makePgService } from 'postgraphile/adaptors/pg';
 *
 * const preset: GraphileConfig.Preset = {
 *   extends: [ConstructivePreset],
 *   pgServices: [
 *     makePgService({
 *       connectionString: DATABASE_URL,
 *       schemas: ['public'],
 *     }),
 *   ],
 * };
 * ```
 */
export const ConstructivePreset: GraphileConfig.Preset = {
  extends: [
    MinimalPreset,
    ConflictDetectorPreset,
    InflektPreset,
    InflectorLoggerPreset,
    NoUniqueLookupPreset,
    ConnectionFilterPreset({ connectionFilterRelations: true }),
    EnableAllFilterColumnsPreset,
    ManyToManyOptInPreset,
    MetaSchemaPreset,
    UnifiedSearchPreset({ fullTextScalarName: 'FullText', tsConfig: 'english' }),
    GraphilePostgisPreset,
    GraphileLtreePreset,
    UploadPreset({
      uploadFieldDefinitions: constructiveUploadFieldDefinitions,
      maxFileSize: 10 * 1024 * 1024 // 10MB
    }),
    PresignedUrlPreset({
      s3: getPresignedUrlS3Config,
      resolveBucketName: createBucketNameResolver(),
      ensureBucketProvisioned: createEnsureBucketProvisioned()
    }),
    BucketProvisionerPreset({
      connection: getBucketProvisionerConnection,
      allowedOrigins: getAllowedOrigins()
    }),
    SqlExpressionValidatorPreset(),
    PgTypeMappingsPreset,
    RequiredInputPreset
  ],
  /**
   * Disable PostGraphile core's condition argument entirely.
   * All filtering now lives under the `where` argument via our v5-native
   * graphile-connection-filter plugin (which renames the default `filter`
   * argument to `where` via `connectionFilterArgumentName: 'where'`).
   * Search, BM25, pgvector, and PostGIS filter fields all hook into
   * `isPgConnectionFilter` instead of `isPgCondition`.
   */
  disablePlugins: [
    'PgConditionArgumentPlugin',
    'PgConditionCustomFieldsPlugin'
  ],
  /**
   * Connection Filter Plugin Configuration
   *
   * These options control what fields appear in the `where` argument on connections.
   * Our v5-native graphile-connection-filter plugin controls relation filters via the
   * `connectionFilterRelations` option passed to ConnectionFilterPreset().
   *
   * NOTE: By default, PostGraphile v5 only allows filtering on INDEXED columns.
   * We override this with EnableAllFilterColumnsPreset to allow filtering on ALL columns.
   * This gives developers flexibility but requires monitoring for slow queries on
   * non-indexed columns.
   */
  schema: {
    /**
     * connectionFilterComputedColumns: false
     * Disables filtering on computed columns (functions that return a value for a row).
     * Computed columns can be expensive to filter on since they may not be indexed.
     * To selectively enable, use `@filterable` smart tag on specific functions.
     */
    connectionFilterComputedColumns: false,

    /**
     * connectionFilterSetofFunctions: false
     * Disables filtering on functions that return `setof` (multiple rows).
     * These can be expensive operations. To selectively enable, use `@filterable` smart tag.
     */
    connectionFilterSetofFunctions: false,

    /**
     * connectionFilterLogicalOperators: true (default)
     * Keeps `and`, `or`, `not` operators for combining filter conditions.
     * Example: where: { or: [{ name: { eq: "foo" } }, { name: { eq: "bar" } }] }
     */
    connectionFilterLogicalOperators: true,

    /**
     * connectionFilterArrays: true (default)
     * Allows filtering on PostgreSQL array columns.
     * Example: where: { tags: { contains: ["important"] } }
     */
    connectionFilterArrays: true,

    /**
     * connectionFilterOperatorFactories
     * Aggregates all satellite plugin operator factories into a single array.
     * graphile-config replaces (not concatenates) arrays when merging presets,
     * so we must explicitly collect all factories here at the top level.
     */
    connectionFilterOperatorFactories: [
      createMatchesOperatorFactory('FullText', 'english'),
      createTrgmOperatorFactories(),
      createPostgisOperatorFactory(),
      createFolderOperatorFactory()
    ]
    // NOTE: The UnifiedSearchPreset also registers matches + trgm operator factories.
    // graphile-config merges arrays from presets, so having them here as well is fine
    // and ensures they're present even if the preset order changes.
  }
};

export default ConstructivePreset;
