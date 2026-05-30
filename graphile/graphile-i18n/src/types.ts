/**
 * Types for the graphile-i18n v5 plugin.
 */

export interface I18nPluginOptions {
  /**
   * Column name on the translation table that stores the language code.
   * @default 'lang_code'
   */
  langCodeColumn?: string;

  /**
   * GraphQL field name for the language code in the locale object.
   * @default 'langCode'
   */
  langCodeGqlField?: string;

  /**
   * Column types eligible for translation overlay.
   * @default ['text', 'citext']
   */
  allowedTypes?: string[];

  /**
   * Fallback language codes when no Accept-Language header is provided.
   * @default ['en']
   */
  defaultLanguages?: string[];
}

export interface I18nTableInfo {
  /** Base table name */
  baseTable: string;
  /** Translation table name */
  translationTable: string;
  /** Schema name */
  schemaName: string;
  /** FK column on the translation table referencing the base table PK */
  fkColumn: string;
  /** Base table PK column name */
  pkColumn: string;
  /** Base table PK PostgreSQL type */
  pkType: string;
  /** Translatable field mappings: { gqlFieldName: { column, type, isNotNull } } */
  fields: Record<string, TranslatableField>;
}

export interface TranslatableField {
  column: string;
  type: string;
  isNotNull: boolean;
}
