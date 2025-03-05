import basePreset from "../graphile.config.js";
import { makePgService } from "postgraphile/adaptors/pg";
import { makeSchema } from "postgraphile";
import { grafast } from "postgraphile/grafast";
import { Pool } from "pg";

let queries: string[] = [];
let pool: Pool | undefined;

afterEach(() => {
  if (pool) {
    pool.end();
    pool = undefined;
  }
  queries.length = 0;
});

export async function getSchema() {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.TEST_DATABASE_URL ?? "postgres:///graphile_aggregates_test",
    });
    pool.on("error", () => {});
    pool.on("connect", (client) => {
      client.on("error", () => {});
      const oldQuery = client.query;
      client.query = function (...args: any) {
        if (typeof args[0] === "object" && args[0] !== null) {
          const { text } = args[0];
          queries.push(text);
        } else {
          queries.push("/* UNSUPPORTED QUERY CALL! */");
        }
        return oldQuery.apply(this, args) as any;
      };
    });
  }

  const preset: GraphileConfig.Preset = {
    extends: [basePreset],
    disablePlugins: ["MutationPlugin"],
    pgServices: [
      makePgService({
        pool,
        schemas: ["test"],
      }),
    ],
  };
  return await makeSchema(preset);
}

export function testGraphQL(
  source: string,
  variableValues?: Record<string, any>
) {
  return async function () {
    const { schema, resolvedPreset } = await getSchema();
    queries.length = 0;
    const result = await grafast({
      schema,
      source,
      variableValues,
      resolvedPreset,
      requestContext: {},
    });
    if ("next" in result) {
      throw new Error(`Don't support iterable result`);
    }

    const { data, errors } = result;
    if (errors) {
      expect(errors).toMatchSnapshot("errors");
    }
    expect(data).toMatchSnapshot("data");
    expect(queries).toMatchSnapshot("queries");
    // TODO: plan?

    return result;
  };
}
