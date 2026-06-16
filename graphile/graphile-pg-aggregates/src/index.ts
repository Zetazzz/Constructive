import { PgAggregatesAddAggregateTypesPlugin } from './AddAggregateTypesPlugin';
import { PgAggregatesAddConnectionAggregatesPlugin } from './AddConnectionAggregatesPlugin';
import { PgAggregatesAddConnectionGroupedAggregatesPlugin } from './AddConnectionGroupedAggregatesPlugin';
import { PgAggregatesAddGroupByAggregateEnumsPlugin } from './AddGroupByAggregateEnumsPlugin';
import { PgAggregatesAddGroupByAggregateEnumValuesForAttributesPlugin } from './AddGroupByAggregateEnumValuesForAttributesPlugin';
import { PgAggregatesAddHavingAggregateTypesPlugin } from './AddHavingAggregateTypesPlugin';
import { PgAggregatesSpecsPlugin } from './AggregateSpecsPlugin';
import { PgAggregatesSmartTagsPlugin } from './AggregatesSmartTagsPlugin';
import { PgAggregatesFilterRelationalAggregatesPlugin } from './FilterRelationalAggregatesPlugin';
import { PgAggregatesInflectorsPlugin } from './InflectionPlugin';
import { PgAggregatesOrderByAggregatesPlugin } from './OrderByAggregatesPlugin';

export const PgAggregatesPreset: GraphileConfig.Preset = {
  plugins: [
    PgAggregatesInflectorsPlugin,
    PgAggregatesSmartTagsPlugin,
    PgAggregatesSpecsPlugin,
    PgAggregatesAddGroupByAggregateEnumsPlugin,
    PgAggregatesAddGroupByAggregateEnumValuesForAttributesPlugin,
    PgAggregatesAddHavingAggregateTypesPlugin,
    PgAggregatesAddAggregateTypesPlugin,
    PgAggregatesAddConnectionAggregatesPlugin,
    PgAggregatesAddConnectionGroupedAggregatesPlugin,
    PgAggregatesOrderByAggregatesPlugin,
    PgAggregatesFilterRelationalAggregatesPlugin
  ]
};

export {
  AggregateGroupBySpec,
  AggregateSpec,
  AggregateTargetEntity
} from './interfaces';

export { PgAggregatesAddAggregateTypesPlugin };
export { PgAggregatesAddConnectionAggregatesPlugin };
export { PgAggregatesAddConnectionGroupedAggregatesPlugin };
export { PgAggregatesAddGroupByAggregateEnumsPlugin };
export { PgAggregatesAddGroupByAggregateEnumValuesForAttributesPlugin };
export { PgAggregatesAddHavingAggregateTypesPlugin };
export { PgAggregatesSpecsPlugin };
export { PgAggregatesSmartTagsPlugin };
export { PgAggregatesFilterRelationalAggregatesPlugin };
export { PgAggregatesInflectorsPlugin };
export { PgAggregatesOrderByAggregatesPlugin };

declare global {
  namespace GraphileBuild {
    interface AggregateSpecIds {
      sum: true;
      distinctCount: true;
      min: true;
      max: true;
      average: true;
      stddevSample: true;
      stddevPopulation: true;
      varianceSample: true;
      variancePopulation: true;
    }
    interface BehaviorStrings {
      'resource:groupedAggregates': true;
    }
  }
}
