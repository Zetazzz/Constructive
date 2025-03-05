const { postgraphilePresetAmber } = require("postgraphile/presets/amber");
const {
  PostGraphileConnectionFilterPreset,
} = require("postgraphile-plugin-connection-filter");
const { PgAggregatesPreset } = require("./dist/index.js");
const { makePgService } = require("@dataplan/pg/adaptors/pg");

/** @type {GraphileConfig.Preset} */
const preset = {
  extends: [
    postgraphilePresetAmber,
    PostGraphileConnectionFilterPreset,
    PgAggregatesPreset,
  ],
  pgServices: [
    makePgService({
      connectionString: "postgres:///graphile_aggregates",
      schemas: ["test"],
    }),
  ],
  grafast: {
    explain: true,
  },
};

// export default preset;
module.exports = preset;
