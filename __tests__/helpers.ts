import { makeV4Preset } from "postgraphile/presets/v4";
import { makePgService } from "postgraphile/adaptors/pg";
import { makeSchema } from "postgraphile";
import { Pool } from "pg";

let pool: Pool | undefined;

afterEach(() => {
  if (pool) {
    pool.end();
    pool = undefined;
  }
});

export async function getSchema() {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.TEST_DATABASE_URL ?? "postgres:///graphile_aggregates_test",
    });
    pool.on("error", () => {});
    pool.on("connect", (client) => client.on("error", () => {}));
  }

  const preset: GraphileConfig.Preset = {
    extends: [makeV4Preset()],
    disablePlugins: ["MutationPlugin"],
    pgServices: [
      makePgService({
        pool,
        schemas: ["test"],
      }),
    ],
    grafast: {
      explain: ["plan"],
    },
  };
  return await makeSchema(preset);
}
